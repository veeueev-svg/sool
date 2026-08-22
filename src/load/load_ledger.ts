/**
 * src/load/load_ledger.ts — دفتر الحمل: مصير معلن لكل أمر تحت الضغط (المرحلة 33)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: معرّفات الأوامر المُدرجة في قناة الأوامر ومصائرها المُعلنة
 * المخرجات: تقرير مطابقة بين دفترين مستقلّين، ورقم فقد صريح لا يُقرَّب
 * التبعيات: سجل التدقيق (كل إدراج ومصير ومطابقة يُسجَّل) — ولا تبعية على القناة نفسها
 * الصلاحيات: القياس والمطابقة والتصعيد فقط. الدفتر لا يعتمد أمرًا ولا ينفّذه (RULE-004)
 * السجلات: load_command_declared / load_command_settled / load_command_duplicate_declaration /
 *           load_settlement_unknown_command / load_settlement_repeated / load_reconciled /
 *           load_loss_detected / escalated_to_king
 * حالات الفشل (كلها مغلقة):
 *   - مصير لأمر غير مُدرج ⇒ رفض مسجَّل، ولا يُنشأ سجل من العدم
 *   - مصير ثانٍ لأمر مستقرّ ⇒ رفض مسجَّل، والمصير الأول يبقى
 *   - اختلاف الدفتر عن القناة ⇒ التقرير غير سليم ويُصعَّد، ولا يُسوّى صامتًا
 * اختبارات الوحدة: tests/load/load_ledger.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت هذه الوحدة:
 *   1) **حجّتان لرقم واحد**: عدد الأوامر يُقاس من دفتر مستقل ومن القناة، والاختلاف خللٌ
 *      لا يُرجَّح فيه أحد الطرفين. (درس T-56: رقمٌ بحجّة واحدة ليس مقيسًا.)
 *   2) **لكل أمر مصير معلن**: مُدرج بلا مصير، أو مصير بلا إدراج، كلاهما فقد يُحتسب.
 *   3) **الفقد لا يُرخَّص**: سقف الفقد يأتي من التهيئة وقيمته صفر، ومقارنته `>` لا `>=`.
 *   4) **المطابقة لا تُصلِح**: الدفتر يُعلن الخلل ولا يُعدّل أحد الطرفين ليوافق الآخر.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';

/** المصائر النهائية المعلنة لأمر داخل القناة — «معلّق» ليس مصيرًا */
export type LoadFate = 'executed' | 'denied' | 'failed';

/** ما يقرؤه الدفتر من القناة: معرّف وحالة. لا يقرأ الدفتر أكثر من ذلك بقصد. */
export interface ChannelObservation {
  readonly commandId: string;
  readonly status: 'pending' | 'denied' | 'executed' | 'failed';
}

export interface LoadMismatch {
  readonly commandId: string;
  readonly code: string;
}

export interface LoadLedgerReport {
  readonly declared: number;
  readonly settled: number;
  readonly byFate: Readonly<Record<LoadFate, number>>;
  readonly observed: number;
  readonly pendingInChannel: number;
  readonly lost: number;
  readonly mismatches: readonly LoadMismatch[];
  readonly maxLoss: number;
  readonly sound: boolean;
}

export interface LoadLedgerDeps {
  readonly audit: AppendOnlyLog;
  /** جهة القياس — من التهيئة، وهي ليست جهة تنفيذ (RULE-004) */
  readonly authority: EntityId;
  /** سقف الفقد من التهيئة؛ قيمته المعلنة صفر ولا تُخفَّف من داخل الوحدة (RULE-005) */
  readonly maxLoss: number;
}

export class LoadLedger {
  private readonly fates = new Map<string, LoadFate | null>();

  constructor(private readonly deps: LoadLedgerDeps) {
    if (!Number.isSafeInteger(deps.maxLoss) || deps.maxLoss < 0) {
      throw new Error('LOAD_LEDGER_MAX_LOSS_INVALID');
    }
    deps.audit.append(deps.authority, 'load_ledger_online', { maxLoss: deps.maxLoss });
  }

  /** إدراج أمر في الدفتر لحظة تقديمه للقناة. الإدراج المتكرر مرفوض ومسجَّل. */
  declare(commandId: string): boolean {
    if (!commandId) {
      this.deps.audit.append(this.deps.authority, 'load_command_duplicate_declaration', {
        commandId, reason: 'LOAD_COMMAND_ID_EMPTY',
      });
      return false;
    }
    if (this.fates.has(commandId)) {
      this.deps.audit.append(this.deps.authority, 'load_command_duplicate_declaration', { commandId });
      return false;
    }
    this.fates.set(commandId, null);
    this.deps.audit.append(this.deps.authority, 'load_command_declared', { commandId });
    return true;
  }

  /** تثبيت مصير أمر مُدرج. لا مصير لغير مُدرج، ولا مصير ثانٍ لمستقرّ. */
  settle(commandId: string, fate: LoadFate): boolean {
    if (!this.fates.has(commandId)) {
      this.deps.audit.append(this.deps.authority, 'load_settlement_unknown_command', { commandId, fate });
      return false;
    }
    const current = this.fates.get(commandId) ?? null;
    if (current !== null) {
      this.deps.audit.append(this.deps.authority, 'load_settlement_repeated', {
        commandId, kept: current, refused: fate,
      });
      return false;
    }
    this.fates.set(commandId, fate);
    this.deps.audit.append(this.deps.authority, 'load_command_settled', { commandId, fate });
    return true;
  }

  fateOf(commandId: string): LoadFate | null {
    return this.fates.get(commandId) ?? null;
  }

  get declaredCount(): number {
    return this.fates.size;
  }

  /**
   * مطابقة الدفتر بالقناة. لا تُعدّل شيئًا: تُحصي وتُعلن وتُصعّد عند الخلل.
   * الفقد = (مُدرج لا سجل له في القناة) + (سجل في القناة بقي معلّقًا بعد المعالجة).
   */
  reconcile(observations: readonly ChannelObservation[]): LoadLedgerReport {
    const mismatches: LoadMismatch[] = [];
    const byFate: Record<LoadFate, number> = { executed: 0, denied: 0, failed: 0 };
    for (const fate of this.fates.values()) if (fate) byFate[fate] += 1;

    const seen = new Set<string>();
    let pendingInChannel = 0;
    for (const observation of observations) {
      if (seen.has(observation.commandId)) {
        mismatches.push({ commandId: observation.commandId, code: 'DUPLICATE_CHANNEL_RECORD' });
        continue;
      }
      seen.add(observation.commandId);
      if (!this.fates.has(observation.commandId)) {
        mismatches.push({ commandId: observation.commandId, code: 'COMMAND_WITHOUT_BOOK' });
        continue;
      }
      const booked = this.fates.get(observation.commandId) ?? null;
      if (observation.status === 'pending') {
        pendingInChannel += 1;
        if (booked !== null) mismatches.push({ commandId: observation.commandId, code: 'SETTLED_WHILE_PENDING' });
        continue;
      }
      if (booked === null) {
        mismatches.push({ commandId: observation.commandId, code: 'UNSETTLED_TERMINAL' });
        continue;
      }
      if (booked !== observation.status) {
        mismatches.push({ commandId: observation.commandId, code: 'FATE_MISMATCH' });
      }
    }

    let missingFromChannel = 0;
    for (const commandId of this.fates.keys()) {
      if (!seen.has(commandId)) {
        missingFromChannel += 1;
        mismatches.push({ commandId, code: 'BOOK_WITHOUT_COMMAND' });
      }
    }

    const settled = byFate.executed + byFate.denied + byFate.failed;
    const lost = missingFromChannel + pendingInChannel;
    const sound = lost <= this.deps.maxLoss && mismatches.length === 0;
    const report: LoadLedgerReport = {
      declared: this.fates.size, settled, byFate, observed: seen.size,
      pendingInChannel, lost, mismatches, maxLoss: this.deps.maxLoss, sound,
    };
    this.deps.audit.append(this.deps.authority, 'load_reconciled', {
      declared: report.declared, settled: report.settled, observed: report.observed,
      lost: report.lost, mismatches: mismatches.length, sound,
    });
    if (!sound) {
      this.deps.audit.append(this.deps.authority, 'load_loss_detected', {
        lost: report.lost, maxLoss: this.deps.maxLoss,
        codes: [...new Set(mismatches.map((m) => m.code))],
      });
      this.deps.audit.append(this.deps.authority, 'escalated_to_king', {
        reason: 'فقد أوامر أو اختلاف دفترين تحت الضغط', lost: report.lost,
      });
    }
    return report;
  }
}
