/**
 * src/economy/budget.ts — الموازنة: سقوف صرف مُلزمة لا إرشادية (المرحلة 25)
 * المالك: وزارة المالية — والسقف يُقرّه التاج لا هي
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل amend_policy هدفه بند الموازنة، وسقف صحيح موجب، ومدة معلنة
 * المخرجات: بند موازنة مُلزم يُحجز عليه ويُسقط ما لم يُصرف، أو رفض بسبب موثّق
 * التبعيات: بوابة التاج، السجل غير القابل للمحو، config/economy.yaml (السقف الكلي)
 * الصلاحيات: الإقرار والتعديل بأمر ملكي؛ والحجز للخزانة وحدها
 * السجلات: appropriation_declared / appropriation_amended / appropriation_exceeded /
 *           budget_reserved / budget_released / appropriation_lapsed / budget_refused
 * ثوابت هذه الوحدة:
 *   1) **السقف مُلزم لا إرشادي**: أي حجز يتجاوز المتاح مرفوض — ولا تجاوز «بموافقة لاحقة»
 *   2) **السقف يُعدَّل بأمر معلن لا يُخترق بصمت**: التعديل يُسجَّل بالقيمتين معًا (من/إلى)
 *   3) لا يُنقص السقف إلى ما دون المصروف فعلًا: الماضي لا يُلغى بقرار حاضر
 *   4) **مجموع البنود لا يتجاوز السقف الكلي المعلن** في التهيئة
 *   5) البند لصاحب قائم: لا موازنة لجهة لا وجود لها — وبلا مصدر تحقق يُرفض الإقرار (فشل مغلق)
 *   6) **لا ترحيل صامت**: ما لم يُصرف حتى نهاية الفترة يسقط ويُسجَّل سقوطه، ولا يُنقل تلقائيًّا
 *   7) لا حجز بعد نهاية الفترة ولو بقي متاح: المدة شرط لا زينة
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ تجاوز السقف ⇒ رفض مسجَّل؛
 *   جهة غير قائمة ⇒ رفض؛ فترة منقضية ⇒ رفض؛ ترحيل ⇒ رفض دائم
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { FINANCE_MINISTRY, isValidAmount } from './ledger';
import type { DurableSink } from '../data/persistence';

/** الجهة الوحيدة التي تحجز على بند: الخزانة — والحجز لا يقع من صاحب البند */
export const TREASURY_ACTOR: EntityId = 'treasury:general';

export interface Appropriation {
  readonly line: string;
  readonly owner: EntityId;
  readonly ceiling: number;
  readonly spent: number;
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly commandId: string;
  readonly lapsedAt: number | null;
  readonly lapsedAmount: number | null;
}

export interface AppropriationInput {
  readonly line: string;
  readonly owner: EntityId;
  readonly ceiling: number;
  readonly periodStart: number;
  readonly periodEnd: number;
}

export type BudgetResult =
  | { readonly ok: true; readonly appropriation: Appropriation; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** مصدر يتحقق من وجود صاحب البند (وزارة أو إقليم) — فشل مغلق قبل الربط (ثابت 5) */
export type OwnerProbe = (owner: EntityId) => boolean;

export interface BudgetDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  /** السقف الكلي المعلن في config/economy.yaml (ثابت 4) */
  readonly ceilingTotal: number;
  /**
   * سقفُ عددِ البنود المسجَّلة المعلن في config/economy.yaml (T-49).
   * غيرُ السقف الكليّ: ذاك يحدّ المال، وهذا يحدّ الجدول — ومائةُ ألفِ بندٍ
   * بريالٍ واحد تمرّ من الأوّل ولا تمرّ من الثاني.
   */
  readonly maxLines: number;
  /** هل يُسمح بالترحيل؟ معلن في التهيئة، وقيمته الملزمة: لا (ثابت 6) */
  readonly carryoverAllowed: boolean;
  readonly actorId?: EntityId;
}

export class Budget {
  private readonly lines = new Map<string, Appropriation>();
  private readonly actorId: EntityId;
  private ownerProbe: OwnerProbe | null = null;
  private sink: DurableSink | null = null;

  constructor(private readonly deps: BudgetDeps) {
    this.actorId = deps.actorId ?? FINANCE_MINISTRY;
  }

  /**
   * ربط مصدر التحقق من صاحب البند. لا سجل تدقيق هنا عن قصد (درس المرحلة 23):
   * التأسيس يُختم بـ state_online وحده، وغياب الربط ليس صامتًا لأن الإقرار يُرفض ويُسجَّل.
   */
  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /**
   * كلُّ تغييرٍ على بندٍ يمرّ من هنا: يُخزَّن ثم يُدوَّن (T-125).
   * والبابُ واحدٌ عن قصد: بابٌ ثانٍ يُغري بتغييرٍ لا يُدوَّن — وذاك عينُ الفجوة.
   */
  private commit(appropriation: Appropriation): void {
    this.lines.set(appropriation.line, appropriation);
    this.sink?.record('budget_appropriation', { appropriation });
  }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت بنودًا مشهودةً ولا يُقرّ بندًا من عنده.
   * ويرفض ما يخرق ثابت 4: مجموعُ سقوفٍ فوق السقف الكلّي المعلن ⇒
   * RECOVERY_BUDGET_CEILING_TOTAL — فلا يُدخل الإقلاعُ ما ترفضه البوابة.
   */
  restore(lines: readonly Appropriation[], by: EntityId): void {
    let ceilings = 0;
    for (const line of lines) {
      if (line.lapsedAt === null) ceilings += line.ceiling;
      if (line.spent > line.ceiling) throw new Error('RECOVERY_BUDGET_OVERSPENT');
    }
    if (ceilings > this.deps.ceilingTotal) throw new Error('RECOVERY_BUDGET_CEILING_TOTAL');
    // T-49: والعددُ كالمبلغ — ما يُرفض إقرارًا لا يُقبل إرجاعًا، وإلّا صار بابُ
    // الإقلاع ثغرةً يدخل منها ما حُرس عنه البابُ الأوّل.
    if (lines.length > this.deps.maxLines) throw new Error('RECOVERY_BUDGET_LINE_CAP');
    this.lines.clear();
    for (const line of lines) this.lines.set(line.line, { ...line });
    this.deps.audit.append(by, 'budget_restored', {
      lines: this.lines.size, active: this.active().length,
      ceilings: this.totalCeilings(), spent: this.totalSpent(),
    });
  }

  bindOwnerProbe(probe: OwnerProbe): void {
    this.ownerProbe = probe;
  }

  /** 1) إقرار بند: بأمر ملكي، لصاحب قائم، وتحت السقف الكلي (ثوابت 4 و5) */
  declare(command: SignedRoyalCommand, input: AppropriationInput, now = Date.now()): BudgetResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): BudgetResult => {
      const entry = this.deps.audit.append(this.actorId, 'budget_refused', {
        line: input.line, reason, mode: 'declare', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (!input.line.startsWith('budget:')) return refuse('معرّف البند يجب أن يبدأ بـ budget:');
    const existing = this.lines.get(input.line);
    if (existing && existing.lapsedAt === null) return refuse('بند بهذا المعرّف قائم');
    // T-49: الساقطُ لا يُمحى من الجدول، فالعددُ ينمو ولا يرجع. وإعادةُ إقرارِ
    // بندٍ ساقطٍ تستبدل صفًّا ولا تزيد عددًا، فلا تُحسب على السقف.
    if (!existing && this.lines.size >= this.deps.maxLines) {
      return refuse(
        `سقف عدد بنود الموازنة المعلن بلغ: ${this.lines.size}/${this.deps.maxLines}`
        + ' — لا يُقرّ بندٌ جديد حتّى يُرفع السقف إعلانًا لا في الكود',
        { lines: this.lines.size, maxLines: this.deps.maxLines },
      );
    }
    if (!isValidAmount(input.ceiling)) return refuse('سقف غير سليم: عدد صحيح موجب');
    if (input.periodEnd <= input.periodStart) return refuse('فترة غير صالحة: النهاية قبل البداية');
    if (input.periodEnd <= now) return refuse('لا إقرار لبند فترته منقضية');
    if (input.owner === this.actorId) return refuse('وزارة المالية لا تقرّ بندًا لنفسها (RULE-005)');
    if (command.payload.issuedBy === input.owner) {
      return refuse('صاحب البند لا يقرّ موازنته (RULE-005)');
    }
    if (this.ownerProbe === null) {
      return refuse('لا مصدر يتحقق من صاحب البند — الإقرار مرفوض حتى يُربط (ثابت 5)');
    }
    if (!this.ownerProbe(input.owner)) {
      return refuse('صاحب البند غير قائم: لا موازنة لجهة لا وجود لها', { owner: input.owner });
    }
    const committed = this.totalCeilings() + input.ceiling;
    if (committed > this.deps.ceilingTotal) {
      return refuse('تجاوز السقف الكلي المعلن في التهيئة (ثابت 4)', {
        ceilingTotal: this.deps.ceilingTotal, requested: committed,
      });
    }

    const authorized = this.authorize(command, input.line, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const appropriation: Appropriation = {
      line: input.line, owner: input.owner, ceiling: input.ceiling, spent: 0,
      periodStart: input.periodStart, periodEnd: input.periodEnd,
      commandId: command.payload.commandId, lapsedAt: null, lapsedAmount: null,
    };
    this.commit(appropriation);
    const entry = this.deps.audit.append(this.actorId, 'appropriation_declared', {
      line: appropriation.line, owner: appropriation.owner, ceiling: appropriation.ceiling,
      periodStart: appropriation.periodStart, periodEnd: appropriation.periodEnd,
      commandId: appropriation.commandId,
    });
    return { ok: true, appropriation, auditId: entry.hash };
  }

  /** 2) تعديل السقف: بأمر ملكي، بالقيمتين مسجَّلتين، ولا ينزل تحت المصروف (ثوابت 2 و3) */
  amend(
    command: SignedRoyalCommand, line: string, newCeiling: number, reason: string, now = Date.now(),
  ): BudgetResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): BudgetResult => {
      const entry = this.deps.audit.append(this.actorId, 'budget_refused', {
        line, reason: why, mode: 'amend', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.lines.get(line);
    if (!current || current.lapsedAt !== null) return refuse('بند غير قائم');
    if (!isValidAmount(newCeiling)) return refuse('سقف غير سليم: عدد صحيح موجب');
    if (reason.trim().length < 3) return refuse('لا تعديل سقف بلا سبب معلن (RULE-006)');
    if (newCeiling === current.ceiling) return refuse('لا تعديل بلا تغيير');
    if (newCeiling < current.spent) {
      return refuse('لا يُنقص السقف إلى ما دون المصروف فعلًا (ثابت 3)', {
        spent: current.spent, requested: newCeiling,
      });
    }
    const committed = this.totalCeilings() - current.ceiling + newCeiling;
    if (committed > this.deps.ceilingTotal) {
      return refuse('تجاوز السقف الكلي المعلن (ثابت 4)', { ceilingTotal: this.deps.ceilingTotal });
    }

    const authorized = this.authorize(command, line, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const updated: Appropriation = { ...current, ceiling: newCeiling };
    this.commit(updated);
    const entry = this.deps.audit.append(this.actorId, 'appropriation_amended', {
      line, from: current.ceiling, to: newCeiling, spent: current.spent,
      reason: reason.trim(), commandId: command.payload.commandId,
    });
    return { ok: true, appropriation: updated, auditId: entry.hash };
  }

  /**
   * 3) الحجز: الفحص الذي يجعل السقف مُلزمًا (ثوابت 1 و7).
   * تستدعيه الخزانة قبل الصرف، فإن رُفض لم يقع صرف — ولا يقع نصفه.
   */
  reserve(
    line: string, amount: number, by: EntityId, purpose: string, now = Date.now(),
  ): BudgetResult {
    const refuse = (why: string, kind = 'budget_refused', extra: Record<string, unknown> = {}): BudgetResult => {
      const entry = this.deps.audit.append(this.actorId, kind, {
        line, amount, reason: why, mode: 'reserve', by, ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.lines.get(line);
    if (!current || current.lapsedAt !== null) return refuse('بند غير قائم');
    if (by !== TREASURY_ACTOR) return refuse('الحجز للخزانة وحدها');
    if (!isValidAmount(amount)) return refuse('مبلغ غير سليم: عدد صحيح موجب');
    if (purpose.trim().length < 3) return refuse('لا حجز بلا غرض معلن (RULE-006)');
    if (now < current.periodStart) return refuse('لا حجز قبل بداية الفترة (ثابت 7)');
    if (now > current.periodEnd) {
      return refuse('الفترة منقضية: لا حجز ولو بقي متاح (ثابت 7)', 'budget_refused', {
        periodEnd: current.periodEnd,
      });
    }
    const available = current.ceiling - current.spent;
    if (amount > available) {
      // سجل مخصَّص باسمه: تجاوز السقف واقعة تُرى في السجل لا رفضًا عامًّا
      return refuse('تجاوز سقف البند: السقف مُلزم لا إرشادي (ثابت 1)', 'appropriation_exceeded', {
        ceiling: current.ceiling, spent: current.spent, available, requested: amount,
      });
    }

    const updated: Appropriation = { ...current, spent: current.spent + amount };
    this.commit(updated);
    const entry = this.deps.audit.append(this.actorId, 'budget_reserved', {
      line, amount, purpose: purpose.trim(), spent: updated.spent,
      remaining: updated.ceiling - updated.spent,
    });
    return { ok: true, appropriation: updated, auditId: entry.hash };
  }

  /**
   * 4) فكّ الحجز: إن فشل الصرف بعد الحجز رُدّ المبلغ إلى البند.
   * سببه: صرفٌ فشل قيده لا يجوز أن يستهلك سقفًا — وإلا نقص المتاح بلا مصروف مقابل.
   */
  release(line: string, amount: number, by: EntityId, reason: string, now = Date.now()): BudgetResult {
    const refuse = (why: string): BudgetResult => {
      const entry = this.deps.audit.append(this.actorId, 'budget_refused', {
        line, amount, reason: why, mode: 'release',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.lines.get(line);
    if (!current) return refuse('بند غير قائم');
    if (by !== TREASURY_ACTOR) return refuse('فكّ الحجز للخزانة وحدها');
    if (!isValidAmount(amount)) return refuse('مبلغ غير سليم');
    if (amount > current.spent) return refuse('لا فكّ لأكثر من المحجوز');

    const updated: Appropriation = { ...current, spent: current.spent - amount };
    this.commit(updated);
    const entry = this.deps.audit.append(this.actorId, 'budget_released', {
      line, amount, reason: reason.trim(), spent: updated.spent, at: now,
    });
    return { ok: true, appropriation: updated, auditId: entry.hash };
  }

  /** 5) السقوط: ما لم يُصرف حتى نهاية الفترة يسقط ويُسجَّل (ثابت 6) */
  lapse(line: string, now = Date.now()): BudgetResult {
    const refuse = (why: string): BudgetResult => {
      const entry = this.deps.audit.append(this.actorId, 'budget_refused', {
        line, reason: why, mode: 'lapse',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.lines.get(line);
    if (!current) return refuse('بند غير قائم');
    if (current.lapsedAt !== null) return refuse('بند ساقط سابقًا');
    if (now <= current.periodEnd) return refuse('لا سقوط قبل نهاية الفترة');

    const unspent = current.ceiling - current.spent;
    const lapsed: Appropriation = { ...current, lapsedAt: now, lapsedAmount: unspent };
    this.commit(lapsed);
    const entry = this.deps.audit.append(this.actorId, 'appropriation_lapsed', {
      line, ceiling: current.ceiling, spent: current.spent, lapsedAmount: unspent,
      carryover: 'forbidden',
    });
    return { ok: true, appropriation: lapsed, auditId: entry.hash };
  }

  /**
   * 6) الترحيل: مرفوض دائمًا ما دام الإعلان يمنعه (ثابت 6).
   * نُعلن الرفض بدالة لا بغياب دالة: من يبحث عن الترحيل يجده مرفوضًا مسجَّلًا،
   * لا يجده غائبًا فيظن أنه سهو فيضيفه.
   */
  carryOver(line: string, toLine: string, requester: EntityId): BudgetResult {
    const entry = this.deps.audit.append(this.actorId, 'budget_refused', {
      line, toLine, requester, mode: 'carry_over',
      reason: 'لا ترحيل صامت: ما سقط لا يُنقل، ويُقرّ بندٌ جديد بأمر ملكي (ثابت 6)',
      declared: 'config/economy.yaml → budget.carryover = forbidden',
      carryoverAllowed: this.deps.carryoverAllowed,
    });
    return {
      ok: false,
      reason: 'الترحيل ممنوع بإعلان التهيئة: يُقرّ بند جديد بأمر ملكي لا يُنقل الساقط',
      auditId: entry.hash,
    };
  }

  available(line: string): number {
    const current = this.lines.get(line);
    if (!current || current.lapsedAt !== null) return 0;
    return current.ceiling - current.spent;
  }

  get(line: string): Appropriation | null { return this.lines.get(line) ?? null; }
  active(): readonly Appropriation[] {
    return [...this.lines.values()].filter((a) => a.lapsedAt === null);
  }

  totalCeilings(): number {
    let total = 0;
    for (const line of this.lines.values()) {
      if (line.lapsedAt === null) total += line.ceiling;
    }
    return total;
  }

  totalSpent(): number {
    let total = 0;
    for (const line of this.lines.values()) total += line.spent;
    return total;
  }

  report(): {
    lines: number; active: number; ceilings: number; spent: number;
    ceilingTotal: number; headroom: number; carryoverAllowed: boolean;
    /** سقفُ العدد المعلن وما بقي منه (T-49) — سقفٌ لا يُرى في التقرير يُفاجئ من يبلغه */
    maxLines: number; lineHeadroom: number;
  } {
    return {
      lines: this.lines.size, active: this.active().length, ceilings: this.totalCeilings(),
      spent: this.totalSpent(), ceilingTotal: this.deps.ceilingTotal,
      headroom: this.deps.ceilingTotal - this.totalCeilings(),
      carryoverAllowed: this.deps.carryoverAllowed,
      maxLines: this.deps.maxLines, lineHeadroom: this.deps.maxLines - this.lines.size,
    };
  }

  private authorize(command: SignedRoyalCommand, line: string, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      return { allowed: false, reason: 'الموازنة تُقرّ بفعل amend_policy وحده', auditId: '' };
    }
    if (command.payload.target !== line) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق بند الموازنة', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
