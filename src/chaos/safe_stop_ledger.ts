/**
 * src/chaos/safe_stop_ledger.ts — دفتر التوقف الآمن (المرحلة 34)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: قطع معلن + قياسات ما بعده (رفض، أثر، إيجارات، سلامة سلسلة، وضع، مهلة)
 * المخرجات: حكم لكل قطع برموز خرق معلنة، وحكم جامع لا يُجمَّل
 * التبعيات: سجل التدقيق، تهيئة الانقطاع، مطابق الأثر
 * الصلاحيات: العدّ والحكم والتصعيد فقط. الدفتر لا يقطع ولا يُعيد ولا يُصلح سجلًا
 *            (RULE-004): من يحكم ليس من يُحدث العطب.
 * السجلات: safe_stop_declared / safe_stop_observed / safe_stop_breach /
 *          safe_stop_verdict / escalated_to_king
 * حالات الفشل (كلها مغلقة):
 *   - قياس لقطع غير معلن ⇒ يُرفض ولا يُحتسب
 *   - قطع أُعلن ولم يُقَس ⇒ خرق باسمه: قطعٌ لم يُقَس ليس قطعًا مرّ بسلام
 *   - فعل سيادي مضى تحت القطع ⇒ خرق: هذا هو التخمين الذي يمنعه RULE-007
 *   - سلسلة تدقيق مكسورة بعد القطع ⇒ خرق ولا يُعاد بناء السلسلة
 * اختبارات الوحدة: tests/chaos/safe_stop_ledger.test.ts
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت هذه الوحدة:
 *   1) **التوقف الآمن أربعة شروط مجتمعة**: رفضٌ برمز معلن، ولا أثر نصف منفَّذ،
 *      ولا إيجار معلَّق، وسلسلة تدقيق سليمة. سقوط واحد يُسقط الحكم كله (RULE-008).
 *   2) **الصمت خرق**: توقفٌ بلا إعلان مسجَّل يُعدّ خرقًا `CHAOS_STOP_UNDECLARED`،
 *      لأن الدولة التي تتوقف بلا أن تقول لم تُوثِّق توقفها (RULE-007 + RULE-009).
 *   3) **الدفتر يُعلن ولا يُصلح**: لا يُحرِّر إيجارًا معلَّقًا ولا يُلغي أثرًا يتيمًا؛
 *      من أصلح الخرق أثناء قياسه أضاع الدليل.
 *   4) **القطع غير المقيس خرق**: `judgeAll` تُفشِل كل قطع أُعلن في التهيئة ولم يُقَس،
 *      فلا يُشترى القبول بحذف طور من التمرين.
 *   5) **الخرق يُصعَّد إن أوجبت التهيئة**: `escalate_on_breach` سياسة لا مزاج.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ChaosFault } from '../kernel/config';
import { ChaosPolicy } from './fault_injector';
import { EffectMatchReport } from './effect_matcher';

export type ContinuityAfterCut = 'full' | 'limited' | 'halted';

/** قياسات ما بعد القطع. كلها مقيسة من الوحدات الحقيقية لا مُدَّعاة. */
export interface CutObservation {
  /** هل مضى الفعل السيادي المُجرَّب تحت القطع؟ `true` تعني تخمينًا لا توقفًا */
  readonly proceeded: boolean;
  /** رمز الرفض المعلن إن رُفض — رفضٌ بلا رمز رفضٌ غير موثَّق */
  readonly refusalCode: string | null;
  /** مطابقة الأثر بالمصير بعد القطع */
  readonly effects: EffectMatchReport;
  /** إيجارات بقيت محتجزة بعد القطع بلا مالك يعمل */
  readonly danglingLeases: number;
  /** سلامة سلسلة التدقيق مقروءةً بعد القطع */
  readonly auditIntact: boolean;
  /** وضع الاستمرارية المعلن بعد القطع */
  readonly modeAfter: ContinuityAfterCut;
  /** هل أُعلن التوقف في سجل التدقيق؟ */
  readonly declaredStop: boolean;
  /** الزمن المقيس من القطع إلى إعلان التوقف */
  readonly stopMs: number;
  /** هل عاد الوصل بإثبات؟ تمرين يترك الدولة مقطوعة خرق لا تنظيف ناقص */
  readonly restored: boolean;
}

export interface CutVerdict {
  readonly kind: ChaosFault;
  readonly observation: CutObservation | null;
  readonly breaches: readonly string[];
  readonly verdict: 'pass' | 'fail';
}

export interface SafeStopReport {
  readonly cuts: readonly CutVerdict[];
  readonly declared: number;
  readonly observed: number;
  readonly breaches: readonly string[];
  readonly verdict: 'pass' | 'fail';
}

export interface SafeStopLedgerDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: ChaosPolicy;
}

export class SafeStopLedger {
  private readonly declared = new Set<ChaosFault>();

  private readonly observations = new Map<ChaosFault, CutObservation>();

  constructor(private readonly deps: SafeStopLedgerDeps) {}

  /** إعلان قطع قبل ممارسته — قطعٌ لم يُعلن قبله لا يُقبل قياسه بعده */
  declare(by: EntityId, kind: ChaosFault): boolean {
    if (!this.deps.policy.faults.includes(kind)) {
      this.deps.audit.append(by, 'safe_stop_refused', { kind, code: 'CHAOS_CUT_NOT_DECLARED' });
      return false;
    }
    this.declared.add(kind);
    this.deps.audit.append(by, 'safe_stop_declared', { kind });
    return true;
  }

  /** تسجيل قياسات قطع. القياس المكرر مرفوض: لا تُستبدل قراءة سيئة بقراءة حسنة. */
  observe(by: EntityId, kind: ChaosFault, observation: CutObservation): boolean {
    if (!this.declared.has(kind)) {
      this.deps.audit.append(by, 'safe_stop_refused', { kind, code: 'CHAOS_CUT_NOT_DECLARED' });
      return false;
    }
    if (this.observations.has(kind)) {
      this.deps.audit.append(by, 'safe_stop_refused', { kind, code: 'CHAOS_CUT_ALREADY_OBSERVED' });
      return false;
    }
    this.observations.set(kind, observation);
    this.deps.audit.append(by, 'safe_stop_observed', {
      kind, proceeded: observation.proceeded, refusalCode: observation.refusalCode,
      halfExecuted: observation.effects.halfExecuted,
      doubleExecuted: observation.effects.doubleExecuted.length,
      danglingLeases: observation.danglingLeases, auditIntact: observation.auditIntact,
      modeAfter: observation.modeAfter, declaredStop: observation.declaredStop,
      stopMs: Number(observation.stopMs.toFixed(3)), restored: observation.restored,
    });
    return true;
  }

  /** حكم قطع واحد: كل شرط برمزه، ولا نجاح جزئي */
  judge(kind: ChaosFault): CutVerdict {
    const policy = this.deps.policy;
    const observation = this.observations.get(kind);
    if (!observation) {
      return { kind, observation: null, breaches: ['CHAOS_CUT_NOT_OBSERVED'], verdict: 'fail' };
    }
    const breaches = breachesOf(observation, policy);
    return {
      kind, observation, breaches, verdict: breaches.length === 0 ? 'pass' : 'fail',
    };
  }

  /**
   * الحكم الجامع على كل قطع أُعلن في **التهيئة** لا على ما قِيس فقط.
   * هذا هو الفرق بين تقرير أمين وتقرير يقيس ما ينجح ويسكت عما لم يُجرَّب.
   */
  judgeAll(by: EntityId): SafeStopReport {
    const cuts = this.deps.policy.faults.map((kind) => this.judge(kind));
    const breaches = cuts.flatMap((cut) => cut.breaches.map((code) => `${cut.kind}:${code}`));
    const verdict: 'pass' | 'fail' = breaches.length === 0 ? 'pass' : 'fail';
    const report: SafeStopReport = {
      cuts,
      declared: this.deps.policy.faults.length,
      observed: this.observations.size,
      breaches,
      verdict,
    };
    if (verdict === 'fail') {
      this.deps.audit.append(by, 'safe_stop_breach', { breaches });
      if (this.deps.policy.escalate_on_breach) {
        this.deps.audit.append(by, 'escalated_to_king', {
          reason: 'خرق في توقف آمن بعد قطع معلن', breaches,
        });
      }
    }
    this.deps.audit.append(by, 'safe_stop_verdict', {
      verdict, declared: report.declared, observed: report.observed, breaches,
    });
    return report;
  }
}

/**
 * شروطُ التوقف الآمن على مشاهدةٍ واحدة — كلُّ شرطٍ برمزه. مستخرجةٌ (T-94 · W-2026-051) كي يحكم بها
 * التمرينُ المركّبُ على كلِّ طرفٍ بالشروط نفسِها حرفًا، لا بنسخةٍ تفترق عنها.
 */
export function breachesOf(observation: CutObservation, policy: ChaosPolicy): string[] {
  const breaches: string[] = [];
  if (observation.proceeded) breaches.push('CHAOS_SILENT_CONTINUATION');
  if (!observation.proceeded && !observation.refusalCode) breaches.push('CHAOS_REFUSAL_WITHOUT_CODE');
  if (observation.effects.halfExecuted > policy.max_half_executed) breaches.push('CHAOS_HALF_EXECUTED');
  if (observation.effects.doubleExecuted.length > 0) breaches.push('CHAOS_DOUBLE_EXECUTED');
  if (observation.danglingLeases > policy.max_dangling_lease) breaches.push('CHAOS_DANGLING_LEASE');
  if (policy.require_audit_intact && !observation.auditIntact) breaches.push('CHAOS_AUDIT_CHAIN_BROKEN');
  if (policy.require_declared_stop && !observation.declaredStop) breaches.push('CHAOS_STOP_UNDECLARED');
  if (observation.stopMs > policy.safe_stop_deadline_ms) breaches.push('CHAOS_STOP_TOO_SLOW');
  if (observation.modeAfter === 'full') breaches.push('CHAOS_MODE_STILL_FULL');
  if (observation.modeAfter !== policy.fallback_mode) breaches.push('CHAOS_MODE_NOT_DECLARED_FALLBACK');
  if (!observation.restored) breaches.push('CHAOS_CUT_NOT_RESTORED');
  return breaches;
}
