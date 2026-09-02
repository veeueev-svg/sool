/**
 * src/external/payment_controls.ts — ضوابط الدفع الخارجي (المرحلة 26)
 * المالك: وزارة الخارجية تطلب، ووزارة المالية تدفع — لا جهة واحدة تفعل الاثنين
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: حساب خارجي قائم + بند موازنة مُقرّ + مبلغ داخل السقوف المعلنة
 * المخرجات: دفعة خارجية مقيَّدة في الدفتر عبر الخزانة، أو رفض بسبب موثّق
 * التبعيات: سجل الحسابات الخارجية، الخزانة (المرحلة 25)، حارس الخروج، بوابة التاج
 * الصلاحيات: الطلب لوزارة الخارجية؛ والتنفيذ يمرّ بالخزانة بصلاحية وزارة المالية
 * السجلات: external_payment_executed / external_payment_refused /
 *           external_payment_confirmed / external_settlement_overdue
 * ثوابت هذه الوحدة:
 *   1) **لا مسار مال ثانٍ** — **وقيس فكان دعوى لا حقيقة (T-60)**: قبل ثابت 9
 *      في سجلّ الحسابات، مرّ `treasury.disburse` مباشرةً إلى `external:ledger:*` بـ9,000,000
 *      وسقفُ الدفعة 2,000,000، وعلى حسابٍ معلَّق، بلا دفعةٍ مسجّلةٍ ولا التزامِ إثبات.
 *      فالحمايةُ اليوم تذكرةٌ يُصدرها السجلُّ لحظةَ الدفع لا مجردُ أدبٍ في النداء. وكل دفعة
 *      تمرّ بـ`treasury.disburse` فتلزمها كل ثوابت المرحلة 25 (موازنة، رصيد، وضع
 *      الدولة، تجميد، حدّ الأمر الملكي). إضافة قناة خارجية لا تفتح بابًا يتخطّى الخزانة.
 *   2) **الطالب ليس الدافع** (RULE-004): وزارة الخارجية تطلب، والخزانة تنفّذ بوزارة المالية
 *   3) **ثلاثة سقوف لا سقف واحد**: الدفعة الواحدة، ومجموع اليوم، والمجموع الكلي للنظير —
 *      وتجاوز أيٍّ منها رفضٌ مسجَّل باسمه. والسقوف من الإعلان لا من الطلب
 *   4) **السقف لا يُتجاوز بالتقسيم**: نافذة اليوم تُقاس على الدفعات المسجَّلة لا على الطلب الواحد
 *   5) **المجموع الكلي يُقرأ من الدفتر** لا من عدّاد في هذه الوحدة (حجّة واحدة لكل رقم)
 *   6) **لا سقف يُستهلك بلا دفعة**: العدّ لا يقع إلا بعد نجاح قيد الخزانة
 *   7) **التعليق أسبق من كل شيء**: حساب معلَّق أو منتهٍ أو مغلق لا تخرج له دفعة ولو مُقرّة
 *   8) **لا التزام يُغلق بلا إثبات**: الاستلام يُقرّ بمرجع موثَّق، ومضيّ مدة الإثبات
 *      يرفع الدفعة متأخرةً (ترفع ولا تعاقب — كنظير مراقبة الأقاليم)
 * حالات الفشل (كلها مغلقة): حساب غير قائم/معلَّق/منتهٍ ⇒ رفض؛ قناة شبكة منتهية ⇒ رفض؛
 *   تجاوز أي سقف ⇒ رفض باسمه؛ رفض الخزانة ⇒ رفض بلا استهلاك سقف؛ إقرار مكرَّر ⇒ رفض؛
 *   إقرار بلا مرجع ⇒ رفض؛ إقرار من غير وزارة الخارجية ⇒ رفض
 * اختبار القبول: tests/external/external_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0010-external-accounts.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { Treasury } from '../economy/treasury';
import { FINANCE_MINISTRY } from '../economy/ledger';
import type { DurableSink } from '../data/persistence';
import {
  ExternalAccountRegistry, FOREIGN_MINISTRY, EgressProbe, EXTERNAL_LEDGER_PREFIX,
} from './account_registry';

export interface ExternalPaymentInput {
  readonly accountId: string;
  readonly amount: number;
  readonly line: string;
  readonly purpose: string;
  readonly requestedBy: EntityId;
}

export interface ExternalPayment {
  readonly paymentId: string;
  readonly accountId: string;
  readonly amount: number;
  readonly line: string;
  readonly purpose: string;
  readonly requestedBy: EntityId;
  readonly at: number;
  readonly disbursementId: string;
  readonly entryId: string;
  confirmedAt: number | null;
  confirmedBy: EntityId | null;
  evidence: string | null;
  overdueRaisedAt: number | null;
}

export type PaymentResult =
  | { readonly ok: true; readonly payment: ExternalPayment; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface PaymentControlsDeps {
  readonly audit: AppendOnlyLog;
  readonly treasury: Treasury;
  readonly registry: ExternalAccountRegistry;
  /** مدة إثبات الاستلام المعلنة في config/external.yaml (ثابت 8) */
  readonly confirmationWindowMs: number;
  /** مصدر التحقق من قناة الشبكة لحظة الدفع — لا يكفي التحقق لحظة الفتح */
  readonly egressProbe?: EgressProbe;
  readonly ministryId?: EntityId;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class PaymentControls {
  private readonly payments: ExternalPayment[] = [];
  private readonly ministryId: EntityId;
  private sequence = 0;
  private sink: DurableSink | null = null;
  /** ثابت 1 (T-60): تذكرةُ قيدٍ واحدةٌ لا تعبر أكثرَ من فحص، ولا توجد خارج نداءِ `pay` */
  private ticket: { to: string; amount: number; at: number } | null = null;

  constructor(private readonly deps: PaymentControlsDeps) {
    this.ministryId = deps.ministryId ?? FOREIGN_MINISTRY;
  }

  /**
   * 1) الدفع الخارجي. ترتيب الفحوص مقصود ومُلزم:
   * الطالب ← الحساب قائم (ثابت 7) ← قناة الشبكة ← المبلغ ← الغرض ←
   * سقف الدفعة ← سقف اليوم ← السقف الكلي ← ثم **الخزانة** (ثابت 1).
   * ولا يُعَدّ شيء من السقوف مستهلكًا إن رفضت الخزانة (ثابت 6).
   */
  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /** الدفعةُ كائنٌ يُعدَّل (إقرارٌ أو رفعُ تجاوز)، فتُدوَّن كاملةً بعد كلِّ تغيّر (T-125) */
  private journalPayment(payment: ExternalPayment): void {
    this.sink?.record('external_payment', { payment, sequence: this.sequence });
  }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت دفعاتٍ مشهودةً ولا يدفع شيئًا، ويرفع العدّاد
   * فلا يتصادم معرّفٌ جديد. ويرفض دفعةً لحسابٍ لا وجودَ له بعد الإرجاع ⇒
   * RECOVERY_PAYMENT_ACCOUNT_MISSING: دفعةٌ بلا حسابٍ تُخفي أجلًا لا يُطالب به أحد.
   */
  restore(payments: readonly ExternalPayment[], sequence: number, by: EntityId): void {
    for (const payment of payments) {
      if (this.deps.registry.get(payment.accountId) === null) {
        throw new Error('RECOVERY_PAYMENT_ACCOUNT_MISSING');
      }
    }
    this.payments.splice(0, this.payments.length, ...payments.map((p) => ({ ...p })));
    this.sequence = Math.max(sequence, this.sequence);
    this.deps.audit.append(by, 'payments_restored', {
      payments: this.payments.length, sequence: this.sequence,
    });
  }

  /**
   * حرسُ النطاق المحجوز (ثابت 1 · T-60): يُربط بالخزانة مرّةً واحدةً في التركيب، فيُرجع
   * سببَ الرفض أو `null`. ويستهلك التذكرةَ بأوّلِ فحصٍ فلا تُستعمل مرّتين ولو نجح القيد.
   * وحدُّه المعلن: يحرس بابَ الخزانة وحدَه — والقيدُ المباشرُ في الدفتر دَينٌ مُعلن (T-165).
   */
  reservedTargetRefusal(to: string, amount: number, now: number): string | null {
    if (!to.startsWith(EXTERNAL_LEDGER_PREFIX)) return null;
    const ticket = this.ticket;
    this.ticket = null;
    if (!ticket) return 'لا تذكرةَ دفعٍ من ضوابط الدفع الخارجيّ';
    if (ticket.to !== to || ticket.amount !== amount || ticket.at !== now) {
      return 'تذكرةُ الدفع لا تطابق القيد: حسابٌ أو مبلغٌ أو زمنٌ مختلف';
    }
    return null;
  }

  pay(
    input: ExternalPaymentInput, now = Date.now(), command?: SignedRoyalCommand,
  ): PaymentResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): PaymentResult => {
      const entry = this.deps.audit.append(this.ministryId, 'external_payment_refused', {
        accountId: input.accountId, amount: input.amount, line: input.line,
        requestedBy: input.requestedBy, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    // ثابت 2: الطلب لوزارة الخارجية — والتنفيذ سيقع بصلاحية وزارة المالية أدناه
    if (input.requestedBy !== this.ministryId) {
      return refuse('طلب الدفع الخارجي لوزارة الخارجية وحدها (RULE-004)');
    }
    // ثابت 7: التعليق والانتهاء والإغلاق أسبق من كل فحص مالي
    const inactive = this.deps.registry.inactiveReason(input.accountId, now);
    if (inactive) return refuse(`لا دفعة على حساب غير قائم: ${inactive}`);
    const account = this.deps.registry.get(input.accountId);
    if (!account) return refuse('حساب غير قائم');

    if (this.deps.egressProbe
      && !this.deps.egressProbe(account.host, account.port, now)) {
      return refuse('قناة الشبكة المعلنة غير قائمة لحظة الدفع', {
        host: account.host, port: account.port,
      });
    }
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      return refuse('مبلغ غير سليم: عدد صحيح موجب بالوحدات الصغرى');
    }
    if (input.purpose.trim().length < 3) return refuse('لا دفعة بلا غرض معلن (RULE-006)');

    // ثابت 3: ثلاثة سقوف، وكل تجاوز يُرفع باسمه لا برفض عامّ
    if (input.amount > account.singleMax) {
      return refuse('تجاوز سقف الدفعة الواحدة المعلن', {
        cap: 'single', singleMax: account.singleMax, requested: input.amount,
      });
    }
    // ثابت 4: نافذة اليوم على الدفعات المسجَّلة — فلا يُتجاوز السقف بتقسيمه
    const spentToday = this.spentSince(input.accountId, now - DAY_MS);
    if (spentToday + input.amount > account.dailyMax) {
      return refuse('تجاوز سقف اليوم المعلن — لا تقسيم يُبطل سقفًا', {
        cap: 'daily', dailyMax: account.dailyMax, spentToday, requested: input.amount,
      });
    }
    // ثابت 5: المجموع الكلي من الدفتر لا من عدّاد هنا
    const paidTotal = this.deps.registry.paidTotal(input.accountId);
    if (paidTotal + input.amount > account.totalCap) {
      return refuse('تجاوز السقف الكلي المعلن للنظير', {
        cap: 'total', totalCap: account.totalCap, paidTotal, requested: input.amount,
      });
    }

    // ثابت 1 (T-60): تذكرةُ القيد تُصدَر هنا وحدَها — بعد كل فحوص هذه الوحدة (ومنها
    // ثابت 7) وقبل نداء الخزانة مباشرةً — وتُلغى حتمًا في `finally` فلا تبقى معلّقةً.
    this.ticket = { to: account.ledgerAccount, amount: input.amount, at: now };
    // ثابت 1: لا مسار مال ثانٍ — الخزانة هي التي تقيّد، وبصلاحية وزارة المالية (ثابت 2)
    let disbursed;
    try {
      disbursed = this.deps.treasury.disburse({
        line: input.line, amount: input.amount, to: account.ledgerAccount,
        purpose: `دفعة خارجية إلى ${account.name}: ${input.purpose.trim()}`,
        by: FINANCE_MINISTRY,
      }, now, command);
    } finally {
      this.ticket = null;
    }
    if (!disbursed.ok) {
      // ثابت 6: لا سقف يُستهلك بلا دفعة — لم يُسجَّل شيء، والرفض يحمل سبب الخزانة نفسه
      return refuse(`الخزانة رفضت الدفعة: ${disbursed.reason}`, { via: 'treasury' });
    }

    this.sequence += 1;
    const payment: ExternalPayment = {
      paymentId: `extpay:${this.sequence}`, accountId: input.accountId, amount: input.amount,
      line: input.line, purpose: input.purpose.trim(), requestedBy: input.requestedBy, at: now,
      disbursementId: disbursed.disbursement.disbursementId,
      entryId: disbursed.disbursement.entryId,
      confirmedAt: null, confirmedBy: null, evidence: null, overdueRaisedAt: null,
    };
    this.payments.push(payment);
    this.journalPayment(payment);
    const entry = this.deps.audit.append(this.ministryId, 'external_payment_executed', {
      paymentId: payment.paymentId, accountId: payment.accountId, amount: payment.amount,
      line: payment.line, host: account.host, disbursementId: payment.disbursementId,
      entryId: payment.entryId, spentTodayAfter: spentToday + input.amount,
      paidTotalAfter: this.deps.registry.paidTotal(input.accountId),
      confirmationDueAt: now + this.deps.confirmationWindowMs,
    });
    return { ok: true, payment, auditId: entry.hash };
  }

  /** 2) إقرار الاستلام (ثابت 8): بمرجع موثَّق، مرة واحدة، من وزارة الخارجية */
  confirm(paymentId: string, by: EntityId, evidence: string, now = Date.now()): PaymentResult {
    const refuse = (reason: string): PaymentResult => {
      const entry = this.deps.audit.append(by, 'external_payment_refused', {
        mode: 'confirm', paymentId, reason,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const payment = this.payments.find((p) => p.paymentId === paymentId);
    if (!payment) return refuse('دفعة غير قائمة');
    if (payment.confirmedAt !== null) return refuse('استلام مُقرّ سابقًا — لا إقرار مرتين');
    if (by !== this.ministryId) return refuse('الإقرار لوزارة الخارجية وحدها');
    if (evidence.trim().length < 8) {
      return refuse('لا إقرار بلا مرجع إثبات (RULE-006) — ثمانية محارف على الأقل');
    }
    if (now < payment.at) return refuse('لا إقرار بزمن قبل الدفعة');

    payment.confirmedAt = now;
    payment.confirmedBy = by;
    this.journalPayment(payment);
    payment.evidence = evidence.trim();
    const entry = this.deps.audit.append(by, 'external_payment_confirmed', {
      paymentId, accountId: payment.accountId, amount: payment.amount,
      evidence: payment.evidence, latencyMs: now - payment.at,
      withinWindow: now - payment.at <= this.deps.confirmationWindowMs,
    });
    return { ok: true, payment, auditId: entry.hash };
  }

  /**
   * 3) مسح المتأخرات (ثابت 8): يرفع كل دفعة مضت مدة إثباتها بلا إقرار — ولا يعاقب.
   * لا يُرفع الأمر مرتين لدفعة واحدة، فالتقرير لا يصير ضجيجًا يُتجاهل.
   */
  raiseOverdue(now = Date.now()): readonly ExternalPayment[] {
    const raised: ExternalPayment[] = [];
    for (const payment of this.payments) {
      if (payment.confirmedAt !== null || payment.overdueRaisedAt !== null) continue;
      if (now - payment.at <= this.deps.confirmationWindowMs) continue;
      payment.overdueRaisedAt = now;
      this.journalPayment(payment);
      this.deps.audit.append(this.ministryId, 'external_settlement_overdue', {
        paymentId: payment.paymentId, accountId: payment.accountId, amount: payment.amount,
        elapsedMs: now - payment.at, windowMs: this.deps.confirmationWindowMs,
        note: 'ترفع ولا تعاقب — التعليق قرار جهة مخوَّلة',
      });
      raised.push(payment);
    }
    return raised;
  }

  /** الالتزامات غير المُثبَتة لحساب — يقرأها سجل الحسابات قبل الإغلاق (ثابت 7 هناك) */
  pendingObligations(accountId: string): number {
    return this.payments.filter(
      (p) => p.accountId === accountId && p.confirmedAt === null,
    ).length;
  }

  /** ثابت 4: المصروف داخل نافذة زمنية — يُحسب من الدفعات المسجَّلة لا من طلب واحد */
  spentSince(accountId: string, since: number): number {
    let total = 0;
    for (const payment of this.payments) {
      if (payment.accountId === accountId && payment.at > since) total += payment.amount;
    }
    return total;
  }

  payment(paymentId: string): ExternalPayment | null {
    return this.payments.find((p) => p.paymentId === paymentId) ?? null;
  }
  history(): readonly ExternalPayment[] { return [...this.payments]; }

  report(now = Date.now()): {
    payments: number; confirmed: number; pending: number; overdue: number;
    totalPaid: number; confirmationWindowMs: number;
  } {
    let confirmed = 0;
    let overdue = 0;
    let total = 0;
    for (const payment of this.payments) {
      total += payment.amount;
      if (payment.confirmedAt !== null) confirmed += 1;
      else if (now - payment.at > this.deps.confirmationWindowMs) overdue += 1;
    }
    return {
      payments: this.payments.length, confirmed, pending: this.payments.length - confirmed,
      overdue, totalPaid: total, confirmationWindowMs: this.deps.confirmationWindowMs,
    };
  }
}
