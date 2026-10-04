/**
 * src/data/rehydrate_fiscal.ts — إرجاعُ الماليّة والنافذة الخارجيّة من اليوميّة (المرحلة 39 — T-125)
 * المالك: وزارة البيانات | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: قيودُ يوميّةٍ متحقَّقةُ السلسلة + الأنظمةُ المستهدفة (خزينة، موازنة، جباية،
 *            وحدة رقميّة، سجلُّ حساباتٍ خارجيّة، ضوابطُ دفع، خطرُ نظير)
 * المخرجات: تقريرُ إرجاعٍ معدود لكلِّ نظام + قائمةُ الصامتين
 * التبعيات: `persistence.ts` — والأنظمةُ تُستدعى عبر أبوابها المعلنة لا عبر حقولها
 * الصلاحيات: الاستعادةُ فقط. لا تصرف ولا تُقرّ بندًا ولا تفتح حسابًا ولا تُصدر وحدة
 * السجلات: كلُّ نظامٍ يُقيّد استعادتَه بنفسه في السجل الأبدي (RULE-006)
 *
 * ثوابت هذه الوحدة:
 *   1) **الإرجاعُ إعادةُ بناءِ حالةٍ لا إعادةُ تنفيذِ أفعال** (كثابت 1 في `rehydrate_state.ts`):
 *      لا تُنادى `disburse` ولا `declare` ولا `issue` ولا `pay` ثانيةً — نداؤها يُقيّد
 *      في الدفتر قيدًا ثانيًا لصرفٍ واحد، وذاك خلقُ مالٍ باسم الاستعادة.
 *   2) **فُصلت عن `rehydrate_state.ts` لسببٍ لا لتنظيم**: سبعةُ أنظمةٍ في وحدةٍ واحدة
 *      تُخرجها فوق سقف 400 سطرًا، والسقفُ حدٌّ لا زينة (البند T-113).
 *   3) **ترتيبُ الأبواب مُلزَم**: الحساباتُ الخارجيّة تُرجَع **قبل** الدفعات، لأنّ بابَ
 *      الدفعات يرفض دفعةً لحسابٍ غير قائم — وترتيبٌ معكوسٌ يُسقط دفعاتٍ صحيحة.
 *      والخزينةُ تُرجَع بعد الدفتر (يتحقّق بابُها من قيدِ كلِّ مصروف).
 *   4) **الصامتُ يُعلن لا يُخمَّن** (كثابت 4 هناك): نظامٌ رُبط ولم تشهد له اليوميّةُ بقيدٍ
 *      يُذكر في `silent[]` ولا تُختلق له قيمةٌ صفريّةٌ تُقرأ كأنّها حقّ (RULE-001/008).
 *   5) **الحالةُ يُغني أحدثُها والواقعةُ تُجمع بترتيبها**: البندُ والالتزامُ والحسابُ
 *      والدفعةُ تُفتاح بمعرّفها فيُبقى الأحدث؛ والمصروفُ والتقديرُ والخرقُ تُلحَق
 *      بترتيبها — وهو عينُ قسمة `durableIdentity` في `journal_compaction.ts`.
 *
 * حالات الفشل (كلها مغلقة، وكلها من أبواب الأنظمة لا من هنا):
 *   مصروفٌ بلا قيدٍ في الدفتر ⇒ RECOVERY_TREASURY_ENTRY_MISSING ·
 *   مجموعُ سقوفٍ فوق المعلن ⇒ RECOVERY_BUDGET_CEILING_TOTAL · بندٌ مصروفُه فوق سقفه ⇒
 *   RECOVERY_BUDGET_OVERSPENT · محصَّلٌ بلا إيصال ⇒ RECOVERY_TAX_RECEIPT_MISSING ·
 *   عرضٌ فوق سقفه ⇒ RECOVERY_UNIT_SUPPLY_MAX · عدّادٌ يخالف الدفتر ⇒
 *   RECOVERY_UNIT_INCONSISTENT · حسابٌ لنظيرٍ غير معلن ⇒ RECOVERY_ACCOUNT_UNDECLARED ·
 *   دفعةٌ لحسابٍ مفقود ⇒ RECOVERY_PAYMENT_ACCOUNT_MISSING · نوعُ خطرٍ غير معلن ⇒
 *   RECOVERY_RISK_KIND_UNDECLARED
 * اختبار القبول: tests/data/rehydrate_fiscal.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0031-fiscal-durability.md
 */
import type { EntityId } from '../kernel/types';
import type { DurableRecord } from './persistence';
import type { Appropriation, Budget } from '../economy/budget';
import type { Disbursement, Treasury } from '../economy/treasury';
import type { Levy, RateAmendmentRecovery, RevenueService } from '../economy/tax';
import type { DigitalUnit } from '../economy/digital_unit';
import type { ExternalAccount, ExternalAccountRegistry } from '../external/account_registry';
import type { ExternalPayment, PaymentControls } from '../external/payment_controls';
import type { BreachNote, PartnerRisk, RiskAssessment } from '../external/partner_risk';

/** الأنظمةُ التي تُرجَع؛ غيابُ أيِّها يعني «لا إرجاع له» لا «إرجاعٌ فارغ» */
export interface FiscalTargets {
  readonly treasury?: Treasury;
  readonly budget?: Budget;
  readonly revenue?: RevenueService;
  readonly unit?: DigitalUnit;
  readonly accounts?: ExternalAccountRegistry;
  readonly payments?: PaymentControls;
  readonly risk?: PartnerRisk;
}

export interface RehydrateFiscalReport {
  readonly disbursements: number;
  readonly treasuryFrozen: boolean;
  readonly budgetLines: number;
  readonly levies: number;
  /** تعديلاتُ النِّسَبِ المُرجَعةُ من شاهدِ السجلِ الأبديّ (الجلسة 2 · W-2026-065) */
  readonly rateAmendments: number;
  readonly unitIssued: number;
  readonly unitBurned: number;
  readonly accounts: number;
  readonly payments: number;
  readonly assessments: number;
  readonly breaches: number;
  /** أنظمةٌ رُبطت لكنّ اليوميّة لم تشهد لها بقيدٍ واحد — تُعلن ولا تُخفى (ثابت 4) */
  readonly silent: readonly string[];
}

interface Collected {
  disbursements: Disbursement[];
  treasurySequence: number;
  frozen: boolean;
  frozenReason: string | null;
  treasurySeen: boolean;
  lines: Map<string, Appropriation>;
  budgetSeen: boolean;
  levies: Map<string, Levy>;
  levySequence: number;
  revenueSeen: boolean;
  /** تعديلاتُ النِّسَبِ بشاهدِ السجلِ الأبديِّ بترتيبِ قيودِه (الجلسة 2 · W-2026-065) */
  rateAmendments: RateAmendmentRecovery[];
  unitIssued: number;
  unitBurned: number;
  unitSeen: boolean;
  accounts: Map<string, ExternalAccount>;
  accountsSeen: boolean;
  payments: Map<string, ExternalPayment>;
  paymentOrder: string[];
  paymentSequence: number;
  paymentsSeen: boolean;
  assessments: RiskAssessment[];
  breaches: BreachNote[];
  riskSequence: number;
  riskSeen: boolean;
}

function empty(): Collected {
  return {
    disbursements: [], treasurySequence: 0, frozen: false, frozenReason: null,
    treasurySeen: false,
    lines: new Map(), budgetSeen: false,
    levies: new Map(), levySequence: 0, revenueSeen: false, rateAmendments: [],
    unitIssued: 0, unitBurned: 0, unitSeen: false,
    accounts: new Map(), accountsSeen: false,
    payments: new Map(), paymentOrder: [], paymentSequence: 0, paymentsSeen: false,
    assessments: [], breaches: [], riskSequence: 0, riskSeen: false,
  };
}

/** ثابت 5: يُجمع القيدُ الواحد في مكانه من اللقطة، ولا يُنفَّذ فعلٌ هنا */
function collect(state: Collected, entry: DurableRecord, payload: Record<string, unknown>): void {
  const seq = typeof payload.sequence === 'number' ? payload.sequence : 0;
  switch (entry.kind) {
    case 'treasury_disbursement': {
      state.treasurySeen = true;
      const disbursement = payload.disbursement as Disbursement | undefined;
      // واقعةٌ تُلحَق بترتيبها؛ ومعرّفٌ مكرَّرٌ يعني يوميّةً مشكوكة فنُبقي الأوّل.
      if (disbursement && typeof disbursement.entryId === 'string'
        && !state.disbursements.some((d) => d.entryId === disbursement.entryId)) {
        state.disbursements.push({ ...disbursement });
      }
      state.treasurySequence = Math.max(state.treasurySequence, seq);
      return;
    }
    case 'treasury_state':
      state.treasurySeen = true;
      state.frozen = payload.frozen === true;
      state.frozenReason = typeof payload.frozenReason === 'string' ? payload.frozenReason : null;
      state.treasurySequence = Math.max(state.treasurySequence, seq);
      return;
    case 'budget_appropriation': {
      state.budgetSeen = true;
      const appropriation = payload.appropriation as Appropriation | undefined;
      if (appropriation && typeof appropriation.line === 'string') {
        state.lines.set(appropriation.line, { ...appropriation });
      }
      return;
    }
    case 'tax_levy': {
      state.revenueSeen = true;
      const levy = payload.levy as Levy | undefined;
      if (levy && typeof levy.levyId === 'string') state.levies.set(levy.levyId, { ...levy });
      state.levySequence = Math.max(state.levySequence, seq);
      return;
    }
    case 'unit_supply':
      state.unitSeen = true;
      if (typeof payload.issued === 'number') state.unitIssued = payload.issued;
      if (typeof payload.burned === 'number') state.unitBurned = payload.burned;
      return;
    case 'external_account': {
      state.accountsSeen = true;
      const account = payload.account as ExternalAccount | undefined;
      if (account && typeof account.accountId === 'string') {
        state.accounts.set(account.accountId, { ...account });
      }
      return;
    }
    case 'external_payment': {
      state.paymentsSeen = true;
      const payment = payload.payment as ExternalPayment | undefined;
      if (payment && typeof payment.paymentId === 'string') {
        if (!state.payments.has(payment.paymentId)) state.paymentOrder.push(payment.paymentId);
        state.payments.set(payment.paymentId, { ...payment });
      }
      state.paymentSequence = Math.max(state.paymentSequence, seq);
      return;
    }
    case 'partner_assessment': {
      state.riskSeen = true;
      const assessment = payload.assessment as RiskAssessment | undefined;
      if (assessment && typeof assessment.assessmentId === 'string'
        && !state.assessments.some((a) => a.assessmentId === assessment.assessmentId)) {
        state.assessments.push({ ...assessment });
      }
      state.riskSequence = Math.max(state.riskSequence, seq);
      return;
    }
    case 'partner_breach': {
      state.riskSeen = true;
      const breach = payload.breach as BreachNote | undefined;
      if (breach && typeof breach.counterparty === 'string') state.breaches.push({ ...breach });
      return;
    }
    // الجلسة 2 · W-2026-065 (RATE_AMENDMENT_HISTORY_NOT_DURABLE): تعديلُ النسبةِ لا
    // يوميّةَ حالةٍ خاصّةً به — شاهدُه قيدُه في السلسلةِ الأبديّةِ (audit_entry لا
    // يُسقَطُ بالضغطِ ولا يُنسَخ)، فمن قيودِه يُعادُ بناءُ سجلِ النِّسَبِ والأوامر.
    case 'audit_entry': {
      if (payload.kind !== 'rate_amended') return;
      state.revenueSeen = true;
      const detail = payload.detail as Record<string, unknown> | undefined;
      const base = detail?.base;
      const ratePerMille = detail?.to;
      const declaredAt = detail?.effectiveFrom;
      const commandId = detail?.commandId;
      if (typeof base === 'string' && typeof ratePerMille === 'number'
        && typeof declaredAt === 'number' && typeof commandId === 'string') {
        state.rateAmendments.push({ base, ratePerMille, declaredAt, commandId });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * يُرجع الأنظمةَ الماليّةَ والخارجيّةَ من قيودِ يوميّةٍ **متحقَّقةِ السلسلة سابقًا**.
 * لا تتحقّق هذه الوحدة من السلسلة: التحقّقُ بابُه `StateJournal.verify()`.
 * ويُنادى **بعد** `rehydrateStateFromJournal` لا قبله (ثابت 3).
 */
export function rehydrateFiscalFromJournal(
  entries: readonly DurableRecord[],
  targets: FiscalTargets,
  by: EntityId,
): RehydrateFiscalReport {
  const state = empty();
  for (const entry of entries) {
    const payload = entry.payload as Record<string, unknown> | null;
    if (payload === null || typeof payload !== 'object') continue;
    collect(state, entry, payload);
  }

  const silent: string[] = [];
  const door = (system: string, target: unknown, seen: boolean, run: () => void): void => {
    if (target === undefined) return;
    if (!seen) { silent.push(system); return; }
    run();
  };

  // ثابت 3: الموازنةُ والحساباتُ أوّلًا، فأبوابُ الصرفِ والدفعِ تسأل عنهما.
  door('budget', targets.budget, state.budgetSeen, () => {
    targets.budget!.restore([...state.lines.values()], by);
  });
  door('accounts', targets.accounts, state.accountsSeen, () => {
    targets.accounts!.restore([...state.accounts.values()], by);
  });
  door('treasury', targets.treasury, state.treasurySeen, () => {
    targets.treasury!.restore({
      disbursements: state.disbursements, frozen: state.frozen,
      frozenReason: state.frozenReason, sequence: state.treasurySequence,
    }, by);
  });
  door('revenue', targets.revenue, state.revenueSeen, () => {
    targets.revenue!.restore([...state.levies.values()], state.levySequence, by);
    targets.revenue!.restoreRateAmendments(state.rateAmendments, by);
  });
  door('unit', targets.unit, state.unitSeen, () => {
    targets.unit!.restore(state.unitIssued, state.unitBurned, by);
  });
  door('payments', targets.payments, state.paymentsSeen, () => {
    targets.payments!.restore(
      state.paymentOrder.map((id) => state.payments.get(id)!), state.paymentSequence, by,
    );
  });
  door('risk', targets.risk, state.riskSeen, () => {
    targets.risk!.restore(state.assessments, state.breaches, state.riskSequence, by);
  });

  return {
    disbursements: state.disbursements.length,
    treasuryFrozen: state.frozen,
    budgetLines: state.lines.size,
    levies: state.levies.size,
    rateAmendments: state.rateAmendments.length,
    unitIssued: state.unitIssued,
    unitBurned: state.unitBurned,
    accounts: state.accounts.size,
    payments: state.payments.size,
    assessments: state.assessments.length,
    breaches: state.breaches.length,
    silent,
  };
}
