/**
 * src/economy/treasury.ts — الخزانة: لا تصرف ما لا تملك ولا ما لم يُقرّ (المرحلة 25)
 * المالك: وزارة المالية — تحت التاج، ورصيدها هو الدفتر لا دفترها الخاص
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: طلب صرف على بند موازنة قائم، ولما فوق الحدّ المعلن: أمر ملكي معتمد
 * المخرجات: صرف مقيَّد بطرفين مع حجز على البند، أو رفض بسبب موثّق
 * التبعيات: الدفتر المزدوج، الموازنة، بوابة التاج، config/economy.yaml
 * الصلاحيات: الصرف لوزارة المالية بعد حجز الموازنة؛ والتجميد بأمر ملكي
 * السجلات: disbursement_executed / disbursement_refused / treasury_frozen /
 *           treasury_unfrozen / revenue_received
 * ثوابت هذه الوحدة:
 *   1) **لا سحب على المكشوف**: لا صرف يزيد على رصيد الخزانة في الدفتر
 *   2) **لا صرف بلا بند موازنة قائم**: المال المتاح ليس إذنًا بالصرف
 *   3) **ما فوق الحدّ المعلن لا يُصرف إلا بأمر ملكي** معتمد هدفه حساب الخزانة
 *   4) **لا صرف نصفه واقع**: إن فشل قيد الدفتر فُكّ الحجز، فلا سقف يُستهلك بلا مصروف
 *   5) الصارف ليس المستفيد: لا يصرف أحد لنفسه ولو في نطاق اختصاصه
 *   6) **لا رصيد موازٍ**: الخزانة لا تحتفظ بعدّاد خاص — رصيدها استعلام من الدفتر (حجّة واحدة)
 *   7) الخزانة المجمَّدة لا تصرف شيئًا ولو كان مُقرًّا ومموَّلًا — والتجميد والفكّ بأمر ملكي
 *   8) **لا يخرج مال بغياب النبض الملكي** (RULE-007): في الوضع الحمائي أو المتوقف
 *      يُرفض الصرف ولو كان دون الحدّ ومُقرًّا. والقبض (receive) يبقى جائزًا
 *      عن قصد: حجز الوارد لا يحمي الدولة بل يُخرج المال من الدفتر إلى العدم.
 * حالات الفشل (كلها مغلقة): رصيد لا يكفي ⇒ رفض؛ بند غير قائم أو منقضٍ ⇒ رفض؛
 *   تجاوز الحدّ بلا أمر ⇒ رفض؛ فشل القيد ⇒ فكّ الحجز ورفض؛ خزانة مجمَّدة ⇒ رفض
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { Decision, EntityId, SignedRoyalCommand, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { Ledger, FINANCE_MINISTRY, isValidAmount } from './ledger';
import { Budget, TREASURY_ACTOR } from './budget';

export interface DisbursementInput {
  readonly line: string;
  readonly amount: number;
  readonly to: string;
  readonly purpose: string;
  readonly by: EntityId;
}

export interface Disbursement {
  readonly disbursementId: string;
  readonly line: string;
  readonly amount: number;
  readonly to: string;
  readonly purpose: string;
  readonly by: EntityId;
  readonly at: number;
  readonly royalCommandId: string | null;
  readonly entryId: string;
}

export type TreasuryResult =
  | { readonly ok: true; readonly disbursement: Disbursement; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export type FreezeResult =
  | { readonly ok: true; readonly frozen: boolean; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface TreasuryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ledger: Ledger;
  readonly budget: Budget;
  readonly account: string;
  /** ما فوقه يلزمه أمر ملكي (ثابت 3) — معلن في config/economy.yaml */
  readonly singleDisbursementMax: number;
  /** هل يُسمح بالسحب على المكشوف؟ معلن في التهيئة، وقيمته الملزمة: لا */
  readonly overdraftAllowed: boolean;
  /**
   * قارئ وضع الدولة لحظةً بلحطة (ثابت 8). يُمرَّر لأن `gateway.mode`
   * يُقيّم بزمن النِّداء لا بزمن العملية، والصرف يُحكم بزمنه هو.
   * وغيابه ليس ثغرة صامتة: يُستعاض عنه بقراءة البوابة.
   */
  readonly modeAt?: (now: number) => StateMode;
  readonly actorId?: EntityId;
}

export class Treasury {
  private readonly disbursements: Disbursement[] = [];
  private readonly actorId: EntityId;
  private frozen = false;
  private frozenReason: string | null = null;
  private sequence = 0;

  constructor(private readonly deps: TreasuryDeps) {
    this.actorId = deps.actorId ?? FINANCE_MINISTRY;
  }

  /**
   * 1) الصرف: ترتيب الفحوص مقصود ومُلزم (ثوابت 1–5 و7).
   * تجميد ← جهة ← مبلغ ← غرض ← مستفيد ← بند قائم ← حدّ الأمر الملكي ← رصيد ← حجز ← قيد.
   * وأي فشل بعد الحجز يفكّه (ثابت 4).
   */
  disburse(
    input: DisbursementInput, now = Date.now(), command?: SignedRoyalCommand,
  ): TreasuryResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): TreasuryResult => {
      const entry = this.deps.audit.append(this.actorId, 'disbursement_refused', {
        line: input.line, amount: input.amount, to: input.to, reason, by: input.by, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (this.frozen) {
      return refuse('الخزانة مجمَّدة: لا صرف ولو كان مُقرًّا ومموَّلًا (ثابت 7)', {
        frozenReason: this.frozenReason,
      });
    }
    // ثابت 8: المال لا يتحرك بغياب التاج — يُفحص قبل كل شيء بعد التجميد
    const mode = this.deps.modeAt ? this.deps.modeAt(now) : this.deps.gateway.mode;
    if (mode !== 'normal') {
      return refuse('لا خروج للمال خارج الوضع الطبيعي (RULE-007 — ثابت 8)', { mode });
    }
    if (input.by !== FINANCE_MINISTRY) return refuse('الصرف لوزارة المالية وحدها');
    if (!isValidAmount(input.amount)) return refuse('مبلغ غير سليم: عدد صحيح موجب بالوحدات الصغرى');
    if (input.purpose.trim().length < 3) return refuse('لا صرف بلا غرض معلن (RULE-006)');
    if (input.to === input.by || input.to === this.deps.account) {
      return refuse('الصارف ليس المستفيد ولا الخزانة نفسها (ثابت 5)');
    }
    if (!this.deps.ledger.hasAccount(input.to)) {
      return refuse('حساب المستفيد غير مفتوح في الدفتر');
    }

    const appropriation = this.deps.budget.get(input.line);
    if (!appropriation || appropriation.lapsedAt !== null) {
      return refuse('لا صرف بلا بند موازنة قائم: المال المتاح ليس إذنًا بالصرف (ثابت 2)');
    }

    // ثابت 3: ما فوق الحدّ المعلن يلزمه أمر ملكي معتمد — والحدّ ليس اقتراحًا
    let royalCommandId: string | null = null;
    if (input.amount > this.deps.singleDisbursementMax) {
      if (!command) {
        return refuse('مبلغ فوق الحدّ المعلن بلا أمر ملكي (ثابت 3)', {
          singleDisbursementMax: this.deps.singleDisbursementMax,
        });
      }
      const authorized = this.authorize(command, now);
      if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);
      royalCommandId = command.payload.commandId;
    }

    // ثابت 1: الرصيد من الدفتر لا من عدّاد خاص (ثابت 6)
    const balance = this.balance();
    if (!this.deps.overdraftAllowed && input.amount > balance) {
      return refuse('رصيد الخزانة لا يكفي — لا سحب على المكشوف (ثابت 1)', {
        balance, requested: input.amount,
      });
    }

    const reserved = this.deps.budget.reserve(
      input.line, input.amount, TREASURY_ACTOR, input.purpose, now,
    );
    if (!reserved.ok) return refuse(`حجز الموازنة مرفوض: ${reserved.reason}`);

    this.sequence += 1;
    const disbursementId = `disb:${this.sequence}`;
    const posted = this.deps.ledger.post({
      entryId: disbursementId,
      memo: `صرف على ${input.line}: ${input.purpose.trim()}`,
      lines: [
        { account: input.to, debit: input.amount },
        { account: this.deps.account, credit: input.amount },
      ],
      by: input.by,
    }, now);

    if (!posted.ok) {
      // ثابت 4: لا صرف نصفه واقع — يُفكّ الحجز فلا يُستهلك سقف بلا مصروف
      this.deps.budget.release(
        input.line, input.amount, TREASURY_ACTOR, `فشل قيد الصرف: ${posted.reason}`, now,
      );
      return refuse(`قيد الصرف مرفوض فُكّ الحجز: ${posted.reason}`, { released: input.amount });
    }

    const disbursement: Disbursement = {
      disbursementId, line: input.line, amount: input.amount, to: input.to,
      purpose: input.purpose.trim(), by: input.by, at: now, royalCommandId,
      entryId: posted.entry.entryId,
    };
    this.disbursements.push(disbursement);
    const entry = this.deps.audit.append(this.actorId, 'disbursement_executed', {
      disbursementId, line: input.line, amount: input.amount, to: input.to,
      purpose: disbursement.purpose, entryId: disbursement.entryId,
      royalCommandId, remaining: this.deps.budget.available(input.line),
      balanceAfter: this.balance(),
    });
    return { ok: true, disbursement, auditId: entry.hash };
  }

  /** 2) الإيراد الوارد: يُقيَّد بطرفين، ولا يُعتبر إذنًا بالصرف */
  receive(
    amount: number, source: string, revenueAccount: string, memo: string, now = Date.now(),
  ): TreasuryResult {
    const refuse = (reason: string): TreasuryResult => {
      const entry = this.deps.audit.append(this.actorId, 'disbursement_refused', {
        mode: 'receive', amount, source, reason,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (!isValidAmount(amount)) return refuse('مبلغ غير سليم: عدد صحيح موجب');
    if (memo.trim().length < 3) return refuse('لا إيراد بلا بيان معلن');
    if (!this.deps.ledger.hasAccount(revenueAccount)) return refuse('حساب الإيراد غير مفتوح');

    this.sequence += 1;
    const receiptId = `rcpt:${this.sequence}`;
    const posted = this.deps.ledger.post({
      entryId: receiptId, memo: memo.trim(),
      lines: [
        { account: this.deps.account, debit: amount },
        { account: revenueAccount, credit: amount },
      ],
      by: this.actorId,
    }, now);
    if (!posted.ok) return refuse(`قيد الإيراد مرفوض: ${posted.reason}`);

    const receipt: Disbursement = {
      disbursementId: receiptId, line: 'revenue', amount, to: this.deps.account,
      purpose: memo.trim(), by: this.actorId, at: now, royalCommandId: null,
      entryId: posted.entry.entryId,
    };
    const entry = this.deps.audit.append(this.actorId, 'revenue_received', {
      receiptId, amount, source, entryId: receipt.entryId, balanceAfter: this.balance(),
    });
    return { ok: true, disbursement: receipt, auditId: entry.hash };
  }

  /** 3) التجميد: بأمر ملكي بفعل declare_emergency — يوقف كل صرف (ثابت 7) */
  freeze(command: SignedRoyalCommand, reason: string, now = Date.now()): FreezeResult {
    const refuse = (why: string): FreezeResult => {
      const entry = this.deps.audit.append(this.actorId, 'disbursement_refused', {
        mode: 'freeze', reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (this.frozen) return refuse('الخزانة مجمَّدة سابقًا');
    if (reason.trim().length < 3) return refuse('لا تجميد بلا سبب معلن (RULE-006)');
    if (command.payload.action !== 'declare_emergency') {
      return refuse('التجميد بفعل declare_emergency وحده');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    this.frozen = true;
    this.frozenReason = reason.trim();
    const entry = this.deps.audit.append(this.actorId, 'treasury_frozen', {
      reason: this.frozenReason, commandId: command.payload.commandId, balance: this.balance(),
    });
    return { ok: true, frozen: true, auditId: entry.hash };
  }

  /** 4) فكّ التجميد: بأمر ملكي كذلك — لا يفكّه من طلبه ولا مضيّ الوقت */
  unfreeze(command: SignedRoyalCommand, reason: string, now = Date.now()): FreezeResult {
    const refuse = (why: string): FreezeResult => {
      const entry = this.deps.audit.append(this.actorId, 'disbursement_refused', {
        mode: 'unfreeze', reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (!this.frozen) return refuse('الخزانة غير مجمَّدة');
    if (reason.trim().length < 3) return refuse('لا فكّ تجميد بلا سبب معلن');
    if (command.payload.action !== 'declare_emergency') {
      return refuse('فكّ التجميد بفعل declare_emergency وحده');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    this.frozen = false;
    const previous = this.frozenReason;
    this.frozenReason = null;
    const entry = this.deps.audit.append(this.actorId, 'treasury_unfrozen', {
      reason: reason.trim(), previous, commandId: command.payload.commandId,
    });
    return { ok: true, frozen: false, auditId: entry.hash };
  }

  /** ثابت 6: الرصيد استعلام من الدفتر — ولا عدّاد يُصدّق دونه */
  balance(): number { return this.deps.ledger.balance(this.deps.account); }
  isFrozen(): boolean { return this.frozen; }
  history(): readonly Disbursement[] { return [...this.disbursements]; }
  disbursement(id: string): Disbursement | null {
    return this.disbursements.find((d) => d.disbursementId === id) ?? null;
  }

  report(): {
    account: string; balance: number; frozen: boolean; disbursements: number;
    totalDisbursed: number; singleDisbursementMax: number; overdraftAllowed: boolean;
  } {
    let total = 0;
    for (const d of this.disbursements) {
      if (d.line !== 'revenue') total += d.amount;
    }
    return {
      account: this.deps.account, balance: this.balance(), frozen: this.frozen,
      disbursements: this.disbursements.length, totalDisbursed: total,
      singleDisbursementMax: this.deps.singleDisbursementMax,
      overdraftAllowed: this.deps.overdraftAllowed,
    };
  }

  private authorize(command: SignedRoyalCommand, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      return { allowed: false, reason: 'الصرف الكبير بفعل amend_policy هدفه حساب الخزانة', auditId: '' };
    }
    if (command.payload.target !== this.deps.account) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق حساب الخزانة', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
