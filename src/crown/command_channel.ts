/**
 * src/crown/command_channel.ts — قناة الأوامر المستمرة (المرحلة 7)
 * المالك: حرس التاج
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أوامر ملكية موقّعة | المخرجات: تنفيذ مرة واحدة فقط + حالة محفوظة على القرص
 * التبعيات: بوابة التاج (الاعتماد)، السجل غير القابل للمحو (الأثر)
 * الصلاحيات: النقل والتنفيذ المفوَّض فقط — القناة لا تعتمد بنفسها (RULE-004)
 * ثوابت:
 *   - «مرة واحدة فقط»: أمر نُفِّذ لا يُنفَّذ مرة أخرى ولو أُعيد إرساله بعد إعادة التشغيل
 *   - الفشل الجزئي قابل لإعادة المحاولة حتى سقف معلن، ثم يُصنَّف فاشلًا نهائيًا ويُرفع للملك
 *   - الحالة تُحفظ على القرص بعد كل تغيير: انقطاع العملية لا يُفقد الأثر
 * حالات الفشل (كلها مغلقة):
 *   - أمر مرفوض من البوابة ⇒ لا تنفيذ، ويُثبَّت الرفض ولا يُعاد
 *   - المنفّذ يرمي استثناءً ⇒ إعادة محاولة مسجَّلة، ولا يُعلَن نجاح
 *   - ملف الحالة معدَّل بما يخالف بصمته ⇒ التحميل يُرفض
 * اختبار القبول: tests/crown/command_channel.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — بوابة التاج وقناة الأوامر
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from './crown_gateway';
import { canonicalize, sha256 } from '../identity/keys';

export type CommandStatus = 'pending' | 'denied' | 'executed' | 'failed';

export interface ChannelRecord {
  readonly commandId: string;
  readonly command: SignedRoyalCommand;
  status: CommandStatus;
  attempts: number;
  lastError: string | null;
  decidedAt: number | null;
}

export interface ChannelFile {
  readonly version: 1;
  readonly savedAt: number;
  readonly checksum: string;
  readonly records: readonly ChannelRecord[];
}

export interface ProcessOutcome {
  readonly commandId: string;
  readonly status: CommandStatus;
  readonly reason: string;
}

/** المنفّذ المفوَّض: ينفّذ الأثر الفعلي للأمر بعد اعتماد البوابة. رمي استثناء = فشل قابل لإعادة المحاولة */
export type CommandExecutor = (command: SignedRoyalCommand) => void;

export class CommandChannel {
  private readonly records = new Map<string, ChannelRecord>();

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly statePath: string,
    private readonly maxAttempts = 3,
  ) {
    const dir = dirname(statePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(statePath)) this.restore();
    this.audit.append('authority:crown_guard', 'command_channel_online', {
      restored: this.records.size, maxAttempts,
    });
  }

  /** إدراج أمر في القناة — الإدراج المتكرر لا يُنشئ سجلًا ثانيًا */
  submit(command: SignedRoyalCommand): ChannelRecord {
    const id = command.payload.commandId;
    const existing = this.records.get(id);
    if (existing) {
      this.audit.append(command.payload.issuedBy, 'command_duplicate_submission', {
        commandId: id, status: existing.status,
      });
      return existing;
    }
    const record: ChannelRecord = {
      commandId: id, command, status: 'pending', attempts: 0, lastError: null, decidedAt: null,
    };
    this.records.set(id, record);
    this.audit.append(command.payload.issuedBy, 'command_enqueued', { commandId: id, action: command.payload.action });
    this.persist();
    return record;
  }

  /** معالجة كل المعلّق: اعتماد ثم تنفيذ مرة واحدة، مع إعادة محاولة عند الفشل الجزئي */
  process(executor: CommandExecutor, now = Date.now()): readonly ProcessOutcome[] {
    const outcomes: ProcessOutcome[] = [];
    for (const record of this.records.values()) {
      if (record.status !== 'pending') continue; // «مرة واحدة فقط»

      const decision = this.gateway.authorize(record.command, now);
      if (!decision.allowed) {
        record.status = 'denied';
        record.decidedAt = now;
        record.lastError = decision.reason;
        this.audit.append('authority:crown_guard', 'command_channel_denied', {
          commandId: record.commandId, reason: decision.reason,
        });
        outcomes.push({ commandId: record.commandId, status: 'denied', reason: decision.reason });
        continue;
      }

      record.attempts += 1;
      try {
        executor(record.command);
        record.status = 'executed';
        record.decidedAt = now;
        record.lastError = null;
        this.audit.append('authority:crown_guard', 'command_channel_executed', {
          commandId: record.commandId, attempts: record.attempts,
        });
        outcomes.push({ commandId: record.commandId, status: 'executed', reason: 'نُفِّذ مرة واحدة' });
      } catch (err) {
        const message = (err as Error).message;
        record.lastError = message;
        if (record.attempts >= this.maxAttempts) {
          record.status = 'failed';
          record.decidedAt = now;
          this.audit.append('authority:crown_guard', 'command_channel_failed_final', {
            commandId: record.commandId, attempts: record.attempts, error: message,
          });
          this.audit.append('authority:crown_guard', 'escalated_to_king', {
            commandId: record.commandId, reason: 'فشل نهائي في تنفيذ أمر ملكي',
          });
          outcomes.push({ commandId: record.commandId, status: 'failed', reason: message });
        } else {
          this.audit.append('authority:crown_guard', 'command_channel_retry_scheduled', {
            commandId: record.commandId, attempts: record.attempts, error: message,
          });
          outcomes.push({ commandId: record.commandId, status: 'pending', reason: `إعادة محاولة: ${message}` });
        }
      }
      this.persist();
    }
    this.persist();
    return outcomes;
  }

  statusOf(commandId: string): CommandStatus | null {
    return this.records.get(commandId)?.status ?? null;
  }

  attemptsOf(commandId: string): number {
    return this.records.get(commandId)?.attempts ?? 0;
  }

  counts(): Readonly<Record<CommandStatus, number>> {
    const out: Record<CommandStatus, number> = { pending: 0, denied: 0, executed: 0, failed: 0 };
    for (const r of this.records.values()) out[r.status] += 1;
    return out;
  }

  list(): readonly ChannelRecord[] {
    return [...this.records.values()].map((r) => ({ ...r }));
  }

  /** حفظ الحالة مع بصمة — أي تعديل خارجي يُكشف عند التحميل */
  private persist(now = Date.now()): void {
    const records = [...this.records.values()];
    const file: ChannelFile = {
      version: 1, savedAt: now, checksum: sha256(canonicalize(records)), records,
    };
    writeFileSync(this.statePath, JSON.stringify(file), 'utf8');
  }

  private restore(): void {
    const file = JSON.parse(readFileSync(this.statePath, 'utf8')) as ChannelFile;
    if (file.version !== 1) throw new Error('إصدار ملف قناة غير مدعوم');
    if (sha256(canonicalize(file.records)) !== file.checksum) {
      throw new Error('بصمة ملف قناة الأوامر لا تطابق محتواه — تلاعب مكتشف');
    }
    for (const r of file.records) this.records.set(r.commandId, { ...r });
  }
}
