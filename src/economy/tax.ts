/**
 * src/economy/tax.ts — الرسوم: لا رسم إلا بنصّ معلن سابق للواقعة (المرحلة 25)
 * المالك: وزارة المالية — والإعفاء للتاج وحده
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: وعاء معلن في config/economy.yaml، ومبلغ أساس صحيح موجب، ولحظة الواقعة
 * المخرجات: تقدير ثم تحصيل مقيَّد في الدفتر بإيصال، أو رفض بسبب موثّق
 * التبعيات: الخزانة (القيد)، الدفتر، بوابة التاج (الإعفاء)، تهيئة الاقتصاد (النِسَب)
 * الصلاحيات: التقدير والتحصيل لوزارة المالية؛ والإعفاء بأمر ملكي وحده
 * السجلات: levy_assessed / levy_collected / levy_refused / levy_waived
 * ثوابت هذه الوحدة:
 *   1) **لا رسم بلا نصّ معلن**: وعاء غير معلن في التهيئة ⇒ رفض (RULE-005)
 *   2) **لا أثر رجعي**: واقعة قبل تاريخ إعلان النسبة لا تُطالَب بها —
 *      نظير عدم رجعية القوانين في المرحلة 22
 *   3) **لا كسور عائمة**: الحساب بالأجزاء من الألف وبقسمة صحيحة، والباقي لمصلحة المكلَّف
 *   4) التقدير ليس تحصيلًا: مرحلتان منفصلتان، ولا تحصيل بلا تقدير سابق
 *   5) **لا تحصيل مرتين** لنفس التقدير
 *   6) **لا إعفاء إلا بأمر ملكي**: ولا يُعفي المكلَّفُ نفسه (RULE-005)
 *   7) كل تحصيل قيدٌ مزدوج في الدفتر بإيصال — لا مال يدخل بلا أثر
 * حالات الفشل (كلها مغلقة): وعاء غير معلن ⇒ رفض؛ واقعة سابقة للإعلان ⇒ رفض؛
 *   تحصيل بلا تقدير أو مكرَّر ⇒ رفض؛ فشل القيد ⇒ لا تحصيل؛ إعفاء ذاتي ⇒ رفض
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { FINANCE_MINISTRY, isValidAmount } from './ledger';
import { Treasury } from './treasury';
import type { DurableSink } from '../data/persistence';

/** هدف الأمر الملكي لكل إعفاء */
export const REVENUE_TARGET: EntityId = 'economy:revenue';

/** نسبة معلنة: بالأجزاء من الألف، ومن تاريخ معلن لا قبله */
export interface RateDeclaration {
  readonly base: string;
  readonly ratePerMille: number;
  readonly declaredAt: number;
}

export type LevyStatus = 'assessed' | 'collected' | 'waived';

export interface Levy {
  readonly levyId: string;
  readonly base: string;
  readonly payer: EntityId;
  readonly amountBase: number;
  readonly ratePerMille: number;
  readonly levied: number;
  readonly status: LevyStatus;
  readonly occurredAt: number;
  readonly assessedAt: number;
  readonly collectedAt: number | null;
  readonly receiptEntryId: string | null;
  readonly waiveReason: string | null;
}

export type LevyResult =
  | { readonly ok: true; readonly levy: Levy; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface RevenueDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly treasury: Treasury;
  readonly revenueAccount: string;
  /** النِسَب المعلنة في config/economy.yaml (ثابت 1) */
  readonly rates: readonly RateDeclaration[];
  /** هل يُسمح بالأثر الرجعي؟ معلن في التهيئة، وقيمته الملزمة: لا (ثابت 2) */
  readonly retroactiveAllowed: boolean;
  readonly actorId?: EntityId;
}

export class RevenueService {
  private readonly levies = new Map<string, Levy>();
  private readonly actorId: EntityId;
  private sequence = 0;
  private sink: DurableSink | null = null;

  constructor(private readonly deps: RevenueDeps) {
    this.actorId = deps.actorId ?? FINANCE_MINISTRY;
  }

  /** 1) التقدير: بنصّ معلن، وبلا أثر رجعي، وبحساب صحيح (ثوابت 1–4) */
  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /** كلُّ تغييرٍ على التزامٍ يمرّ من هنا: يُخزَّن ثم يُدوَّن (T-125) */
  private commit(levy: Levy): void {
    this.levies.set(levy.levyId, levy);
    this.sink?.record('tax_levy', { levy, sequence: this.sequence });
  }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت التزاماتٍ مشهودةً ويرفع العدّاد فلا يتصادم
   * معرّفٌ جديدٌ بقديم. ويرفض ما لا يُصدَّق: محصَّلٌ بلا قيدِ إيصالٍ في الدفتر ⇒
   * RECOVERY_TAX_RECEIPT_MISSING — فالمُحصَّلُ دعوى، وقيدُ الدفتر شاهدُها.
   */
  restore(levies: readonly Levy[], sequence: number, by: EntityId): void {
    for (const levy of levies) {
      if (levy.status !== 'collected') continue;
      if (levy.receiptEntryId === null) throw new Error('RECOVERY_TAX_RECEIPT_MISSING');
    }
    this.levies.clear();
    for (const levy of levies) this.levies.set(levy.levyId, { ...levy });
    this.sequence = Math.max(sequence, this.sequence);
    this.deps.audit.append(by, 'revenue_restored', {
      levies: this.levies.size, collectedTotal: this.collectedTotal(), sequence: this.sequence,
    });
  }

  assess(
    base: string, payer: EntityId, amountBase: number, occurredAt: number, now = Date.now(),
  ): LevyResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        base, payer, amountBase, reason, mode: 'assess', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const rate = this.deps.rates.find((r) => r.base === base);
    if (!rate) {
      return refuse('وعاء غير معلن في config/economy.yaml — لا رسم بلا نصّ (ثابت 1)', {
        declared: this.deps.rates.map((r) => r.base),
      });
    }
    if (!isValidAmount(amountBase)) return refuse('أساس غير سليم: عدد صحيح موجب');
    if (payer.trim().length === 0) return refuse('لا رسم على مكلَّف مجهول (RULE-006)');
    if (payer === this.actorId) return refuse('لا رسم على وزارة المالية من نفسها');
    if (!this.deps.retroactiveAllowed && occurredAt < rate.declaredAt) {
      return refuse('واقعة سابقة لإعلان النسبة — لا أثر رجعي (ثابت 2)', {
        occurredAt, declaredAt: rate.declaredAt,
      });
    }
    if (occurredAt > now) return refuse('لا تقدير لواقعة لم تقع بعد');

    // ثابت 3: قسمة صحيحة، والباقي لمصلحة المكلَّف — لا تقريب لأعلى ولا فاصلة عائمة
    const levied = Math.floor((amountBase * rate.ratePerMille) / 1000);
    if (levied <= 0) {
      return refuse('الرسم المحتسب صفر — لا تقدير بلا مبلغ', {
        amountBase, ratePerMille: rate.ratePerMille,
      });
    }

    this.sequence += 1;
    const levy: Levy = {
      levyId: `levy:${this.sequence}`, base, payer, amountBase,
      ratePerMille: rate.ratePerMille, levied, status: 'assessed',
      occurredAt, assessedAt: now, collectedAt: null, receiptEntryId: null, waiveReason: null,
    };
    this.commit(levy);
    const entry = this.deps.audit.append(this.actorId, 'levy_assessed', {
      levyId: levy.levyId, base, payer, amountBase, ratePerMille: levy.ratePerMille,
      levied, occurredAt, declaredAt: rate.declaredAt,
    });
    return { ok: true, levy, auditId: entry.hash };
  }

  /** 2) التحصيل: مرة واحدة، بقيد مزدوج وإيصال (ثوابت 4 و5 و7) */
  collect(levyId: string, now = Date.now()): LevyResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        levyId, reason, mode: 'collect', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const levy = this.levies.get(levyId);
    if (!levy) return refuse('لا تقدير بهذا المعرّف — لا تحصيل بلا تقدير (ثابت 4)');
    if (levy.status === 'collected') return refuse('محصَّل سابقًا — لا تحصيل مرتين (ثابت 5)');
    if (levy.status === 'waived') return refuse('معفيّ بأمر ملكي — لا تحصيل بعده');

    const received = this.deps.treasury.receive(
      levy.levied, levy.payer, this.deps.revenueAccount,
      `تحصيل رسم ${levy.base} من ${levy.payer} (${levy.levyId})`, now,
    );
    if (!received.ok) return refuse(`قيد التحصيل مرفوض: ${received.reason}`);

    const collected: Levy = {
      ...levy, status: 'collected', collectedAt: now,
      receiptEntryId: received.disbursement.entryId,
    };
    this.commit(collected);
    const entry = this.deps.audit.append(this.actorId, 'levy_collected', {
      levyId, base: levy.base, payer: levy.payer, levied: levy.levied,
      receiptEntryId: collected.receiptEntryId,
    });
    return { ok: true, levy: collected, auditId: entry.hash };
  }

  /** 3) الإعفاء: بأمر ملكي وحده، ولا يُعفي المكلَّف نفسه (ثابت 6) */
  waive(
    command: SignedRoyalCommand, levyId: string, reason: string, now = Date.now(),
  ): LevyResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        levyId, reason: why, mode: 'waive', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const levy = this.levies.get(levyId);
    if (!levy) return refuse('لا تقدير بهذا المعرّف');
    if (levy.status === 'collected') return refuse('لا إعفاء بعد التحصيل: التصحيح بقيد معاكس معلن');
    if (levy.status === 'waived') return refuse('معفيّ سابقًا');
    if (reason.trim().length < 3) return refuse('لا إعفاء بلا سبب معلن (RULE-006)');
    if (command.payload.issuedBy === levy.payer) {
      return refuse('لا يُعفي المكلَّف نفسه (ثابت 6 و RULE-005)', { payer: levy.payer });
    }
    if (command.payload.action !== 'amend_policy') {
      return refuse('الإعفاء بفعل amend_policy وحده');
    }
    if (command.payload.target !== REVENUE_TARGET) {
      return refuse(`هدف الأمر يجب أن يكون ${REVENUE_TARGET}`);
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const waived: Levy = { ...levy, status: 'waived', waiveReason: reason.trim() };
    this.commit(waived);
    const entry = this.deps.audit.append(this.actorId, 'levy_waived', {
      levyId, payer: levy.payer, levied: levy.levied, reason: waived.waiveReason,
      commandId: command.payload.commandId,
    });
    return { ok: true, levy: waived, auditId: entry.hash };
  }

  rateFor(base: string): RateDeclaration | null {
    return this.deps.rates.find((r) => r.base === base) ?? null;
  }

  get(levyId: string): Levy | null { return this.levies.get(levyId) ?? null; }
  outstanding(): readonly Levy[] {
    return [...this.levies.values()].filter((l) => l.status === 'assessed');
  }

  collectedTotal(): number {
    let total = 0;
    for (const levy of this.levies.values()) {
      if (levy.status === 'collected') total += levy.levied;
    }
    return total;
  }

  report(): {
    bases: number; assessed: number; collected: number; waived: number;
    collectedTotal: number; retroactiveAllowed: boolean;
  } {
    const all = [...this.levies.values()];
    return {
      bases: this.deps.rates.length,
      assessed: all.filter((l) => l.status === 'assessed').length,
      collected: all.filter((l) => l.status === 'collected').length,
      waived: all.filter((l) => l.status === 'waived').length,
      collectedTotal: this.collectedTotal(),
      retroactiveAllowed: this.deps.retroactiveAllowed,
    };
  }
}
