/**
 * src/external/partner_risk.ts — تقدير مخاطر الشريك الخارجي (المرحلة 27)
 * المالك: ديوان التدقيق — يقدّر ولا يقترح، ولا يوقّع
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نوع عقد معلن في config/contracts.yaml + عوامل مخاطر معلنة فيه
 * المخرجات: درجة مخاطر محسوبة من إعلان، لها زمن ومدة صلاحية — أو رفض بسبب موثّق
 * التبعيات: سجل التدقيق (كل تقدير وكل إخلال قيدٌ لا يُمحى)
 * الصلاحيات: التقدير لديوان التدقيق وحده؛ ولا يقدّر مقترحُ العقد مخاطره (RULE-004)
 * السجلات: partner_risk_assessed / partner_risk_refused / partner_breach_noted
 * ثوابت هذه الوحدة:
 *   1) **الدرجة تُحسب من إعلان لا من رأي**: عامل غير معلن في التهيئة ⇒ يُرفض التقدير
 *      كلّه لأجله (فشل مغلق) — فلا تُدخَل مخاطرة بلا وزن معلن، ولا تُهمَل بلا بيان
 *   2) **من يقترح لا يقدّر** (RULE-004): المقدِّر جهة معلنة غير جهة الاقتراح
 *   3) **لا تقدير أبديّ**: التقدير يبلى بمضي مدة المراجعة المعلنة، والبالي لا يُوقَّع عليه
 *   4) **لا تقدير بأثر رجعي ولا مستقبلي**: زمن التقدير هو زمن تسجيله
 *   5) **السقف من التهيئة لا من المقدِّر**: لا يرفع المقدِّر سقف الدرجة المقبولة
 *   6) **لا تقدير يُمحى**: التقديرات سلسلة تُضاف، والأحدث يُقرأ والقديم باقٍ للتدقيق
 *   7) **الإخلال يُثقل الدرجة ولا يُنسى**: كل إخلال موثَّق يزيد الدرجة الفعلية بقيمة
 *      معلنة، فلا يعود الشريك المخلّ إلى درجته الأولى بتقدير جديد يتجاهل تاريخه
 *   8) **لا شريك خارج النظائر المعلنة** (RULE-005): التقدير لا يُنشئ شريكًا
 * حالات الفشل (كلها مغلقة): نوع غير معلن ⇒ رفض؛ مقدِّر غير مخوَّل ⇒ رفض؛
 *   عامل غير معلن ⇒ رفض؛ عامل مكرَّر ⇒ رفض؛ مبرّر أقصر من ثلاثة أحرف ⇒ رفض؛
 *   زمن مستقبلي ⇒ رفض؛ لا تقدير ⇒ العقد مرفوض (لا افتراض سلامة)
 * اختبار القبول: tests/external/external_contracts_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0011-external-contracts.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import type { DurableSink } from '../data/persistence';

/** ديوان التدقيق: صاحب الاختصاص في تقدير المخاطر — يقدّر ولا يقترح */
export const RISK_ASSESSOR: EntityId = 'authority:audit_bureau';

/** نوع عقد معلن — وزنه الأساسي إعلان لا اجتهاد (ثابت 1) */
export interface DeclaredContractKind {
  readonly id: string;
  readonly name: string;
  readonly counterparty: string;
  readonly purpose: string;
  readonly maxValue: number;
  readonly riskWeight: number;
}

export interface RiskAssessment {
  readonly assessmentId: string;
  readonly kindId: string;
  readonly counterparty: string;
  readonly factors: readonly string[];
  /** الدرجة المحسوبة لحظة التقدير: وزن النوع + أوزان العوامل المعلنة */
  readonly score: number;
  readonly assessedBy: EntityId;
  readonly assessedAt: number;
  readonly expiresAt: number;
  readonly justification: string;
}

export interface BreachNote {
  readonly counterparty: string;
  readonly reason: string;
  readonly notedBy: EntityId;
  readonly at: number;
}

export type RiskResult =
  | { readonly ok: true; readonly assessment: RiskAssessment; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AssessInput {
  readonly kindId: string;
  readonly factors: readonly string[];
  readonly assessedBy: EntityId;
  readonly justification: string;
}

export interface PartnerRiskDeps {
  readonly audit: AppendOnlyLog;
  readonly kinds: readonly DeclaredContractKind[];
  /** أوزان عوامل المخاطر المعلنة في config/contracts.yaml (ثابت 1) */
  readonly riskFactors: Readonly<Record<string, number>>;
  /** سقف الدرجة المقبولة — من التهيئة لا من المقدِّر (ثابت 5) */
  readonly maxScore: number;
  /** مدة صلاحية التقدير (ثابت 3) */
  readonly reviewIntervalMs: number;
  /** ما يُضاف إلى الدرجة لكل إخلال موثَّق (ثابت 7) */
  readonly breachPenalty: number;
  /** جهة الاقتراح — لا تُقبل مقدِّرةً (ثابت 2) */
  readonly proposerId: EntityId;
  readonly assessorId?: EntityId;
}

export class PartnerRisk {
  /** ثابت 6: سلسلة تُضاف ولا تُمحى — الأحدث يُقرأ والقديم باقٍ */
  private readonly assessments: RiskAssessment[] = [];
  private readonly breaches: BreachNote[] = [];
  private readonly kinds = new Map<string, DeclaredContractKind>();
  private readonly assessorId: EntityId;
  private sequence = 0;
  private sink: DurableSink | null = null;

  constructor(private readonly deps: PartnerRiskDeps) {
    this.assessorId = deps.assessorId ?? RISK_ASSESSOR;
    for (const kind of deps.kinds) this.kinds.set(kind.id, kind);
  }

  /**
   * 1) تقدير مخاطر شريك لنوع عقد معلن.
   * ترتيب الفحوص مقصود: النوع ← المقدِّر ← المبرّر ← الزمن ← العوامل (معلنة وغير مكرَّرة).
   * ولا يمنع ارتفاعُ الدرجة التسجيلَ: الدرجة العالية تُسجَّل ثم يمنع **العقدُ** لأجلها،
   * فلا يُخفى تقديرٌ سيّئ بإسقاطه من السجل (RULE-006).
   */
  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت تقديراتٍ وخروقًا مشهودةً ولا يُقدِّر من عنده.
   * ويرفض تقديرًا لنوعِ خطرٍ لم يُعلن في التهيئة ⇒ RECOVERY_RISK_KIND_UNDECLARED:
   * نوعٌ يُمحى من التهيئة لا يُعاد إحياؤه بيوميّةٍ قديمة (RULE-005).
   */
  restore(
    assessments: readonly RiskAssessment[], breaches: readonly BreachNote[],
    sequence: number, by: EntityId,
  ): void {
    for (const assessment of assessments) {
      if (!this.kinds.has(assessment.kindId)) throw new Error('RECOVERY_RISK_KIND_UNDECLARED');
    }
    this.assessments.splice(0, this.assessments.length, ...assessments.map((a) => ({ ...a })));
    this.breaches.splice(0, this.breaches.length, ...breaches.map((b) => ({ ...b })));
    this.sequence = Math.max(sequence, this.sequence);
    this.deps.audit.append(by, 'partner_risk_restored', {
      assessments: this.assessments.length, breaches: this.breaches.length,
      sequence: this.sequence,
    });
  }

  assess(input: AssessInput, now = Date.now()): RiskResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): RiskResult => {
      const entry = this.deps.audit.append(this.assessorId, 'partner_risk_refused', {
        kindId: input.kindId, assessedBy: input.assessedBy, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const kind = this.kinds.get(input.kindId);
    if (!kind) {
      return refuse('نوع عقد غير معلن في التهيئة — التقدير لا يُنشئ نوعًا (ثابت 8)');
    }
    // ثابت 2: من يقترح العقد لا يقدّر مخاطره
    if (input.assessedBy === this.deps.proposerId) {
      return refuse('لا يقدّر مخاطرَ العقد مقترحُه (RULE-004)');
    }
    if (input.assessedBy !== this.assessorId) {
      return refuse('التقدير لديوان التدقيق وحده');
    }
    if (input.justification.trim().length < 3) {
      return refuse('لا تقدير بلا مبرّر معلن (RULE-006)');
    }
    // ثابت 4: التقدير يقع في زمنه — لا يُسجَّل تقدير لزمن لم يأت
    if (!Number.isSafeInteger(now) || now <= 0) {
      return refuse('زمن تقدير غير صالح');
    }
    const seen = new Set<string>();
    let score = kind.riskWeight;
    for (const factor of input.factors) {
      if (seen.has(factor)) {
        return refuse('عامل مخاطر مكرَّر — التكرار يضخّم الدرجة بلا معنى', { factor });
      }
      seen.add(factor);
      const weight = this.deps.riskFactors[factor];
      // ثابت 1 (فشل مغلق): عامل بلا وزن معلن لا يُهمَل ولا يُقدَّر بالحدس
      if (weight === undefined) {
        return refuse('عامل مخاطر غير معلن في التهيئة — لا وزن بالحدس (ثابت 1)', { factor });
      }
      score += weight;
    }

    this.sequence += 1;
    const assessment: RiskAssessment = {
      assessmentId: `risk:${this.sequence}`,
      kindId: kind.id, counterparty: kind.counterparty,
      factors: [...input.factors], score,
      assessedBy: input.assessedBy, assessedAt: now,
      expiresAt: now + this.deps.reviewIntervalMs,
      justification: input.justification.trim(),
    };
    this.assessments.push(assessment);
    this.sink?.record('partner_assessment', { assessment, sequence: this.sequence });
    const entry = this.deps.audit.append(this.assessorId, 'partner_risk_assessed', {
      assessmentId: assessment.assessmentId, kindId: kind.id, counterparty: kind.counterparty,
      factors: assessment.factors, score, baseWeight: kind.riskWeight,
      maxScore: this.deps.maxScore, acceptable: this.isAcceptable(kind.id, now),
      expiresAt: assessment.expiresAt,
    });
    return { ok: true, assessment, auditId: entry.hash };
  }

  /**
   * 2) تسجيل إخلال موثَّق (ثابت 7): يُثقل درجة الشريك الفعلية ولا يُمحى بتقدير جديد.
   * سببه: الشريك الذي أخلّ مرة ليس كالذي لم يُخِلّ، ولو تشابه ملفّاهما على الورق.
   */
  noteBreach(by: EntityId, counterparty: string, reason: string, now = Date.now()): boolean {
    if (reason.trim().length < 3) {
      this.deps.audit.append(by, 'partner_risk_refused', {
        mode: 'breach', counterparty, reason: 'لا إخلال يُسجَّل بلا بيان',
      });
      return false;
    }
    const breach: BreachNote = { counterparty, reason: reason.trim(), notedBy: by, at: now };
    this.breaches.push(breach);
    this.sink?.record('partner_breach', { breach });
    this.deps.audit.append(by, 'partner_breach_noted', {
      counterparty, reason: reason.trim(), at: now,
      breaches: this.breachCount(counterparty), penalty: this.deps.breachPenalty,
    });
    return true;
  }

  /** أحدث تقدير قائم (غير بالٍ) لنوع عقد — أو لا شيء (ثوابت 3 و6) */
  latest(kindId: string, now = Date.now()): RiskAssessment | null {
    for (let i = this.assessments.length - 1; i >= 0; i -= 1) {
      const candidate = this.assessments[i] as RiskAssessment;
      if (candidate.kindId !== kindId) continue;
      return candidate.expiresAt > now ? candidate : null;
    }
    return null;
  }

  /** كل التقديرات المسجَّلة لنوع (بالياتها وقائماتها) — لا شيء يُمحى (ثابت 6) */
  history(kindId?: string): readonly RiskAssessment[] {
    return kindId === undefined
      ? [...this.assessments]
      : this.assessments.filter((a) => a.kindId === kindId);
  }

  breachCount(counterparty: string): number {
    return this.breaches.filter((b) => b.counterparty === counterparty).length;
  }

  /**
   * الدرجة الفعلية = درجة أحدث تقدير قائم + عقوبة كل إخلال موثَّق (ثابت 7).
   * تُرجع `null` إن لم يكن هناك تقدير قائم — و«لا تقدير» ليست «مخاطرة صفرًا».
   */
  effectiveScore(kindId: string, now = Date.now()): number | null {
    const latest = this.latest(kindId, now);
    if (!latest) return null;
    return latest.score + this.breachCount(latest.counterparty) * this.deps.breachPenalty;
  }

  /** هل الدرجة الفعلية دون السقف المعلن؟ لا تقدير ⇒ لا قبول (لا افتراض سلامة) */
  isAcceptable(kindId: string, now = Date.now()): boolean {
    const score = this.effectiveScore(kindId, now);
    return score !== null && score <= this.deps.maxScore;
  }

  /** سبب عدم القبول — حتى لا يكون الرفض بلا بيان (RULE-006) */
  unacceptableReason(kindId: string, now = Date.now()): string | null {
    const latest = this.latest(kindId, now);
    if (!latest) {
      const stale = this.assessments.some((a) => a.kindId === kindId);
      return stale
        ? 'تقدير المخاطر بالٍ — انقضت مدة المراجعة المعلنة (ثابت 3)'
        : 'لا تقدير مخاطر قائم لهذا النوع — ولا افتراض سلامة';
    }
    const score = latest.score + this.breachCount(latest.counterparty) * this.deps.breachPenalty;
    if (score > this.deps.maxScore) {
      return `درجة المخاطر ${score} تتجاوز السقف المعلن ${this.deps.maxScore}`;
    }
    return null;
  }

  /** التقديرات البالية لأنواع لها تقدير سابق — تُرفع للمراجعة ولا تُصحَّح تلقائيًّا */
  staleKinds(now = Date.now()): readonly string[] {
    const all = new Set(this.assessments.map((a) => a.kindId));
    return [...all].filter((kindId) => this.latest(kindId, now) === null);
  }

  declaredKinds(): readonly DeclaredContractKind[] { return [...this.kinds.values()]; }

  kind(kindId: string): DeclaredContractKind | null { return this.kinds.get(kindId) ?? null; }

  report(now = Date.now()): {
    kinds: number; assessments: number; acceptable: number; stale: number;
    breaches: number; maxScore: number; breachPenalty: number;
  } {
    let acceptable = 0;
    for (const kindId of this.kinds.keys()) if (this.isAcceptable(kindId, now)) acceptable += 1;
    return {
      kinds: this.kinds.size, assessments: this.assessments.length, acceptable,
      stale: this.staleKinds(now).length, breaches: this.breaches.length,
      maxScore: this.deps.maxScore, breachPenalty: this.deps.breachPenalty,
    };
  }
}
