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
 *   - **النيّة تُثبَّت قبل الأثر**: قبل استدعاء المنفّذ تُكتب المحاولة على القرص. عيب كشفه
 *     تمرين الانقطاع في المرحلة 34 (البند T-90): كان الأثر يجري ثم يُحفظ، فانقطاع القرص
 *     كان يُنتج أمرًا نُفِّذ في الذاكرة ومعلَّق على القرص — أي تنفيذًا مزدوجًا بعد إعادة
 *     التشغيل. الدواء تقديم الكتابة على الأثر، لا تخفيف الضمان.
 *   - **سلسلة التدقيق تُصحِّح اللقطة**: أمرٌ سجّل التدقيق تنفيذه لا يُنفَّذ ثانيًا ولو قال
 *     ملف الحالة إنه معلَّق (RULE-006: السجل لا يُمحى فهو المرجع عند التعارض).
 *   - الحفظ لقطة + يوميّة: كل تغيير يُلحَق سطرًا مبصومًا في اليوميّة، واللقطة الكاملة تُكتب
 *     عند الطيّ. (عيب كشفه تمرين الضغط في المرحلة 33: إعادة كتابة الملف كاملًا بعد كل
 *     تغيير كلفتها تربيعية — 500 أمر كلّفت 88 مللي ثانية للأمر الواحد. الدواء تغيير
 *     طريقة الحفظ لا تخفيف العتبة.)
 * حالات الفشل (كلها مغلقة):
 *   - أمر مرفوض من البوابة ⇒ لا تنفيذ، ويُثبَّت الرفض ولا يُعاد
 *   - المنفّذ يرمي استثناءً ⇒ إعادة محاولة مسجَّلة، ولا يُعلَن نجاح
 *   - ملف الحالة معدَّل بما يخالف بصمته ⇒ التحميل يُرفض
 *   - فشل الكتابة على القرص ⇒ تراجعٌ معلن أو تصعيد للملك ورمي استثناء برمز معلن،
 *     ولا يُكمَل العمل على حالة لا تُثبَّت (T-90: توقف معلن لا حالة مجهولة)
 * اختبار القبول: tests/crown/command_channel.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — بوابة التاج وقناة الأوامر
 */
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from './crown_gateway';
import { canonicalize, sha256 } from '../identity/keys';
import { withChannelLock } from './command_channel_lock';

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

/** سطر يوميّة: سجل واحد مع بصمته. البصمة تكشف التعديل الخارجي كما تكشفه بصمة اللقطة. */
export interface ChannelJournalLine {
  readonly checksum: string;
  readonly record: ChannelRecord;
}

/**
 * سقف الطيّ: بعد هذا العدد من الأسطر تُكتب لقطة كاملة وتُمحى اليوميّة.
 * القيمة معلنة كي يبقى وقت الاستعادة محدودًا، ولا تُقاس بها الصحة بل الكلفة.
 */
export const CHANNEL_JOURNAL_COMPACT_AT = 256;

/**
 * دون هذا العدد من السجلات تُكتب اللقطة الكاملة بعد كل تغيير: كلفتها مهملة،
 * وملف الحالة يبقى مقروءًا كاملاً للتدقيق اليدوي. اليوميّة دواء للحمل لا أسلوب دائم.
 */
export const CHANNEL_SNAPSHOT_ALWAYS_UNDER = 32;

/**
 * رمز فشل التثبيت على القرص. يُرمى نصًّا في رسالة الاستثناء كي يُميَّز عن أي خطأ آخر،
 * فرفضٌ بلا رمز رفضٌ غير موثَّق (المرحلة 34).
 */
export const CHANNEL_PERSIST_FAILED = 'CHANNEL_PERSIST_FAILED';

/**
 * وسم السجل الذي صُحِّح من سلسلة التدقيق بعد انقطاع: أُعلن تنفيذه في السجل ولم
 * يُثبَّت في اللقطة. يُثبَّت في `lastError` كي يبقى التصحيح مقروءًا لا صامتًا.
 */
export const CHANNEL_RECONCILED_FROM_AUDIT = 'CHANNEL_RECONCILED_FROM_AUDIT';

/**
 * رمز فشل القراءة عند بناء القناة. مسارُ حالةٍ لا يُقرأ (مجلد باسم الملف، أو قرص
 * معطوب) كان يُخرج خطأ نظامٍ خامًا لا رمز له، فيصير الرفض غير موثَّق. القراءة الآن
 * ملفوفة: يبقى سبب النظام في الرسالة، ويُقدَّم الرمز عليه (المرحلة 34).
 */
export const CHANNEL_RESTORE_FAILED = 'CHANNEL_RESTORE_FAILED';

export interface ProcessOutcome {
  readonly commandId: string;
  readonly status: CommandStatus;
  readonly reason: string;
}

/** المنفّذ المفوَّض: ينفّذ الأثر الفعلي للأمر بعد اعتماد البوابة. رمي استثناء = فشل قابل لإعادة المحاولة */
export type CommandExecutor = (command: SignedRoyalCommand) => void;

export class CommandChannel {
  private readonly records = new Map<string, ChannelRecord>();

  private readonly journalPath: string;

  private readonly lockPath: string;

  private journalLines = 0;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly statePath: string,
    private readonly maxAttempts = 3,
  ) {
    this.journalPath = `${statePath}.journal`;
    this.lockPath = `${statePath}.lock`;
    const dir = dirname(statePath);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    // الاستعادة تتم تحت القفل: عمليةٌ تنشئ القناة بينما تكتب أخرى لقطةً نصفها
    // ستقرأ كسرًا. القفل يُأخَذ للاستعادة الأولية كي تكتمل دورة القراءة بلا تداخل.
    this.withLock(() => {
      if (existsSync(statePath)) {
        this.restore();
        this.reconcileFromAudit();
      }
      else if (existsSync(this.journalPath)) {
        // يوميّة بلا لقطة: أثرٌ بلا أصل. الفشل مغلق ولا يُخمَّن ما ضاع.
        throw new Error('يوميّة قناة أوامر بلا لقطة — حالة غير مكتملة');
      }
    });
    this.audit.append('authority:crown_guard', 'command_channel_online', {
      restored: this.records.size, maxAttempts,
    });
  }

  /** غلافٌ صغيرٌ يمرّر مسار القفل إلى المنطق المفصول في `command_channel_lock.ts`. */
  private withLock<T>(fn: () => T): T {
    return withChannelLock({ audit: this.audit, lockPath: this.lockPath }, fn);
  }

  /** إدراج أمر في القناة — الإدراج المتكرر لا يُنشئ سجلًا ثانيًا */
  submit(command: SignedRoyalCommand): ChannelRecord {
    const id = command.payload.commandId;
    // دورة restore→mutate→save تحت قفلٍ واحد: الذاكرةُ المحليّةُ قد تكون قديمةً.
    return this.withLock(() => {
      this.reloadFromDisk();
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
      // القبول لا يُعلن قبل تثبيته: إن تعذّر الحفظ يُمحى السجل من الذاكرة كي لا يبقى
      // أمرٌ مقبولٌ بلا أثر على القرص — وهي الحالة المجهولة التي يمنعها البند T-90.
      try {
        this.save(record);
      } catch (err) {
        this.records.delete(id);
        this.audit.append('authority:crown_guard', 'command_channel_persist_failed', {
          commandId: id, stage: 'submit', code: CHANNEL_PERSIST_FAILED, error: (err as Error).message,
        });
        throw new Error(`${CHANNEL_PERSIST_FAILED} — تعذّر تثبيت أمر على القرص فلم يُقبل`);
      }
      this.audit.append(command.payload.issuedBy, 'command_enqueued', { commandId: id, action: command.payload.action });
      return record;
    });
  }

  /** إعادة تحميل الحالة من القرص تحت القفل قبل كل تحويل — الذاكرة المحليّة قد تكون قديمة. */
  private reloadFromDisk(): void {
    // فشلُ القراءة لا يُفرغ الذاكرة: يُترك لـ`save` تكتشفه عند الكتابة برمزها الصحيح.
    if (!existsSync(this.statePath)) {
      this.records.clear();
      this.journalLines = 0;
      if (existsSync(this.journalPath)) {
        throw new Error('يوميّة قناة أوامر بلا لقطة — حالة غير مكتملة');
      }
      return;
    }
    // مسارٌ ليس ملفًا عاديًا (مجلدٌ من اختبار قطع القرص): لا يُخمَّن ما ضاع.
    if (!statSync(this.statePath).isFile()) return;
    this.records.clear();
    this.journalLines = 0;
    this.restore();
    this.reconcileFromAudit();
  }

  /** معالجة كل المعلّق: اعتماد ثم تنفيذ مرة واحدة، مع إعادة محاولة عند الفشل الجزئي */
  process(executor: CommandExecutor, now = Date.now()): readonly ProcessOutcome[] {
    // دورة restore→mutate→save تحت قفلٍ واحد: التنفيذُ المتوازي على نفس الملف
    // هو عينُ التزاحم الذي يكسر «مرة واحدة فقط».
    return this.withLock(() => {
      this.reloadFromDisk();
      const outcomes: ProcessOutcome[] = [];
      for (const record of this.records.values()) {
        if (record.status !== 'pending') continue; // «مرة واحدة فقط»

        const decision = this.gateway.authorize(record.command, now);
        if (!decision.allowed) {
          record.status = 'denied';
          record.decidedAt = now;
          record.lastError = decision.reason;
          // الرفضُ يُثبَّت على القرص قبل المتابعة: فرعُ الرفض كان يقفز فوق كتلة الحفظ
          // بـ`continue`، فتبقى حالةُ `denied` في الذاكرةِ فقط بينما القرصُ يحملُ `pending`.
          try {
            this.save(record);
          } catch (err) {
            this.audit.append('authority:crown_guard', 'command_channel_persist_failed', {
              commandId: record.commandId, stage: 'denial', code: CHANNEL_PERSIST_FAILED, error: (err as Error).message,
            });
            throw new Error(`${CHANNEL_PERSIST_FAILED} — تعذّر تثبيت رفض أمر`);
          }
          this.audit.append('authority:crown_guard', 'command_channel_denied', {
            commandId: record.commandId, reason: decision.reason,
          });
          outcomes.push({ commandId: record.commandId, status: 'denied', reason: decision.reason });
          continue;
        }

        record.attempts += 1;
        // تثبيت النيّة قبل الأثر: منفّذٌ يجري على قرص لا يُكتب عليه يُنتج تنفيذًا لا سجل له.
        try {
          this.save(record);
        } catch (err) {
          record.attempts -= 1;
          this.audit.append('authority:crown_guard', 'command_channel_persist_failed', {
            commandId: record.commandId, stage: 'intent', code: CHANNEL_PERSIST_FAILED, error: (err as Error).message,
          });
          this.audit.append('authority:crown_guard', 'escalated_to_king', {
            commandId: record.commandId, reason: 'تعذّر تثبيت نيّة التنفيذ — لا أثر بلا سجل',
          });
          throw new Error(`${CHANNEL_PERSIST_FAILED} — تعذّر تثبيت نيّة تنفيذ أمر`);
        }
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
        // بعد كل تغيير، لا بعد الدفعة. وإن تعذّر التثبيت هنا فالأثر قد جرى بالفعل:
        // لا تراجع، بل تصعيد ورمي استثناء — والسجل يبقى مرجعًا يُصحِّح اللقطة عند العودة.
        try {
          this.save(record);
        } catch (err) {
          this.audit.append('authority:crown_guard', 'command_channel_persist_failed', {
            commandId: record.commandId, stage: 'outcome', code: CHANNEL_PERSIST_FAILED, error: (err as Error).message,
          });
          this.audit.append('authority:crown_guard', 'escalated_to_king', {
            commandId: record.commandId, reason: 'تعذّر تثبيت نتيجة أمر بعد جريان أثره',
          });
          throw new Error(`${CHANNEL_PERSIST_FAILED} — تعذّر تثبيت نتيجة أمر`);
        }
      }
      return outcomes;
    });
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
    // قراءةٌ تحت القفل: ذاكرةُ العمليةِ قد تكون قديمةً بعد كتابةِ الأخرى.
    return this.withLock(() => {
      this.reloadFromDisk();
      return [...this.records.values()].map((r) => ({ ...r }));
    });
  }

  /**
   * حفظ تغيير واحد: سطر يوميّة مبصوم، أو لقطة كاملة عند بلوغ سقف الطيّ.
   * الضمان نفسه (لا تغيير في الذاكرة بلا أثر على القرص) بكلفة خطية لا تربيعية.
   */
  private save(record: ChannelRecord): void {
    if (this.records.size <= CHANNEL_SNAPSHOT_ALWAYS_UNDER
      || this.journalLines >= CHANNEL_JOURNAL_COMPACT_AT) { this.persist(); return; }
    const line: ChannelJournalLine = { checksum: sha256(canonicalize(record)), record };
    appendFileSync(this.journalPath, `${JSON.stringify(line)}\n`, 'utf8');
    this.journalLines += 1;
  }

  /** كتابة اللقطة الكاملة مع بصمة، ومحو اليوميّة — أي تعديل خارجي يُكشف عند التحميل */
  private persist(now = Date.now()): void {
    const records = [...this.records.values()];
    const file: ChannelFile = {
      version: 1, savedAt: now, checksum: sha256(canonicalize(records)), records,
    };
    writeFileSync(this.statePath, JSON.stringify(file), 'utf8');
    if (existsSync(this.journalPath)) rmSync(this.journalPath);
    this.journalLines = 0;
  }

  private restore(): void {
    let text: string;
    try { text = readFileSync(this.statePath, 'utf8'); }
    catch (err) {
      throw new Error(`${CHANNEL_RESTORE_FAILED} — تعذّر قراءة ملف حالة القناة: ${(err as Error).message}`);
    }
    const file = JSON.parse(text) as ChannelFile;
    if (file.version !== 1) throw new Error('إصدار ملف قناة غير مدعوم');
    if (sha256(canonicalize(file.records)) !== file.checksum) {
      throw new Error('بصمة ملف قناة الأوامر لا تطابق محتواه — تلاعب مكتشف');
    }
    for (const r of file.records) this.records.set(r.commandId, { ...r });
    if (!existsSync(this.journalPath)) return;
    const lines = readFileSync(this.journalPath, 'utf8').split('\n').filter((l) => l.length > 0);
    for (const raw of lines) {
      const line = JSON.parse(raw) as ChannelJournalLine;
      if (sha256(canonicalize(line.record)) !== line.checksum) {
        throw new Error('بصمة سطر يوميّة القناة لا تطابق محتواه — تلاعب مكتشف');
      }
      this.records.set(line.record.commandId, { ...line.record });
    }
    this.journalLines = lines.length;
  }

  /**
   * تصحيح اللقطة من سلسلة التدقيق بعد انقطاع: أمرٌ سُجِّل تنفيذه ولم تُثبَّت نتيجته
   * يُقرأ منفَّذًا لا معلَّقًا، فلا يُنفَّذ مرة ثانية. المرجع عند التعارض هو السجل
   * غير القابل للمحو لا الملف القابل للكتابة (RULE-006)، والتصحيح نفسه يُسجَّل.
   */
  private reconcileFromAudit(): void {
    const executedAt = new Map<string, number>();
    for (const entry of this.audit.find('command_channel_executed')) {
      const id = (entry.detail as { commandId?: unknown }).commandId;
      if (typeof id === 'string') executedAt.set(id, entry.at);
    }
    const reconciled: string[] = [];
    for (const record of this.records.values()) {
      if (record.status !== 'pending') continue;
      const at = executedAt.get(record.commandId);
      if (at === undefined) continue;
      record.status = 'executed';
      record.decidedAt = at;
      record.lastError = CHANNEL_RECONCILED_FROM_AUDIT;
      reconciled.push(record.commandId);
    }
    if (reconciled.length === 0) return;
    this.audit.append('authority:crown_guard', 'command_channel_reconciled', {
      count: reconciled.length, commandIds: reconciled,
    });
    this.persist();
  }
}
