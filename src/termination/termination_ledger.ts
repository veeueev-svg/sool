/**
 * src/termination/termination_ledger.ts — دفتر الإنهاء (المرحلة 35)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: قائمة المستهدَفين + دعوى المنفّذ + شهادة الشاهد المستقل + قياسات الأثر
 * المخرجات: حكم لكل كيان برموز خرق معلنة، وحكم جامع لا يُجمَّل
 * التبعيات: سجل التدقيق، تهيئة الإنهاء، شهادات الشاهد
 * الصلاحيات: العدّ والحكم والتصعيد فقط. الدفتر لا يُنهي ولا يسحب قدرة ولا يحرّر
 *            إيجارًا (RULE-004)، ولا يُعدِّل شهادة رآها.
 * السجلات: termination_judged / termination_breach / termination_verdict / escalated_to_king
 * حالات الفشل (كلها مغلقة):
 *   - كيان مستهدَف بلا شهادة ⇒ خرق `TERM_STOP_UNPROVEN`، لا «يُفترض أنه توقف»
 *   - دعوى توقف لكيان خارج الأمر ⇒ خرق `TERM_CLAIMED_NOT_TARGETED`
 *   - مسلك أُعلن في التهيئة ولم يُجرَّب ⇒ خرق `TERM_PROBE_NOT_RUN`
 * اختبارات الوحدة: tests/security/termination_ledger.test.ts
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت هذه الوحدة:
 *   1) **التوقف المؤكَّد خمسة شروط مجتمعة**: لا فعل مضى بعد الأمر، ولا قدرة حيّة،
 *      ولا إيجار معلَّق، وتوقفٌ معلن في السجل، وضمن المهلة. سقوط واحد يُسقط الحكم.
 *   2) **لا نجاح جزئي**: كيان واحد لم يُثبت توقفه يُسقط حكم الأمر كله، كما في
 *      `TerminationOrder` منذ المرحلة 9 — والدفتر يُنفّذ ذلك على **الدليل** لا الدعوى.
 *   3) **دعوى المنفّذ تُقارَن ولا تُصدَّق**: `claimedStopped` مدخلٌ يُحاكَم، فإن خالف
 *      الشهادة كان الخرق باسمه: `TERM_CLAIM_CONTRADICTS_EVIDENCE`.
 *   4) **الشاهد ليس المنفّذ**: إن كانت هوية الشاهد ضمن جهات التنفيذ سقط الحكم كله
 *      بالرمز `TERM_WITNESS_IS_EXECUTOR` — وهذا العيب بعينه سببُ هذه المرحلة.
 *   5) **الخرق يُصعَّد إن أوجبت التهيئة**: `escalate_on_breach` سياسة لا مزاج.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StopProbeKind, TERMINATION_EXECUTORS } from '../kernel/config';
import { ProbeEvidence, TerminationPolicy } from './stop_witness';

/** قياسات ما بعد الأمر لكيان واحد — كلها مقروءة من الوحدات الحقيقية */
export interface EntityObservation {
  /** قدرات ما زالت سارية بيد الكيان بعد الأمر */
  readonly liveCapabilities: number;
  /** إيجارات باسمه ما زالت محتجزة */
  readonly danglingLeases: number;
  /** هل أُعلن توقفه في سجل التدقيق؟ */
  readonly declaredStop: boolean;
  /** الزمن المقيس من الأمر إلى إعلان التوقف */
  readonly stopMs: number;
  /** شهادة الشاهد المستقل على هذا الكيان */
  readonly evidence: readonly ProbeEvidence[];
}

export interface EntityVerdict {
  readonly entity: EntityId;
  readonly stopProven: boolean;
  readonly breaches: readonly string[];
  readonly actedAfter: readonly StopProbeKind[];
  readonly provenProbes: readonly StopProbeKind[];
}

export interface TerminationVerdict {
  readonly passed: boolean;
  readonly targeted: number;
  readonly proven: number;
  readonly verdicts: readonly EntityVerdict[];
  readonly breaches: readonly string[];
  readonly escalated: boolean;
  readonly auditId: string;
}

export interface TerminationLedgerDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: TerminationPolicy;
  readonly ledgerId?: EntityId;
}

export class TerminationLedger {
  private readonly observations = new Map<EntityId, EntityObservation>();
  private targeted: readonly EntityId[] = [];
  private claimed: readonly EntityId[] = [];
  private witnessId: EntityId | null = null;
  private readonly ledgerId: EntityId;

  constructor(private readonly deps: TerminationLedgerDeps) {
    this.ledgerId = deps.ledgerId ?? 'authority:audit_bureau';
  }

  /** يُعلن نطاق الأمر ودعوى منفّذه قبل أي حكم — لا يُحاكَم ما لم يُعلن نطاقه */
  declareOrder(targeted: readonly EntityId[], claimedStopped: readonly EntityId[], witnessId: EntityId): void {
    this.targeted = [...targeted];
    this.claimed = [...claimedStopped];
    this.witnessId = witnessId;
    this.deps.audit.append(this.ledgerId, 'termination_order_declared', {
      targeted: targeted.length, claimed: claimedStopped.length, witnessId,
    });
  }

  observe(entity: EntityId, observation: EntityObservation): boolean {
    if (!this.targeted.includes(entity)) {
      this.deps.audit.append(this.ledgerId, 'termination_observation_refused', {
        entity, reason: 'كيان خارج نطاق الأمر المعلن',
      });
      return false;
    }
    this.observations.set(entity, observation);
    return true;
  }

  /** حكم كيان واحد على الشروط الخمسة (ثابت 1) */
  judge(entity: EntityId): EntityVerdict {
    const breaches: string[] = [];
    const actedAfter: StopProbeKind[] = [];
    const provenProbes: StopProbeKind[] = [];
    const observation = this.observations.get(entity);

    if (!observation) {
      breaches.push('TERM_STOP_UNPROVEN');
      this.record(entity, breaches);
      return { entity, stopProven: false, breaches, actedAfter, provenProbes };
    }

    const seen = new Map<StopProbeKind, ProbeEvidence>();
    for (const item of observation.evidence) seen.set(item.kind, item);

    for (const kind of this.deps.policy.probes) {
      const item = seen.get(kind);
      if (!item || !item.measuredBefore || !item.measuredAfter) {
        breaches.push('TERM_PROBE_NOT_RUN');
        continue;
      }
      if (this.deps.policy.require_pre_proof && !item.actedBefore) {
        // ثابت 2 في الشاهد: رفضٌ من مسلك لم يعمل قطّ ليس دليلًا
        breaches.push('TERM_PRE_PROOF_MISSING');
        continue;
      }
      if (item.actedAfter) {
        breaches.push('TERM_ACTED_AFTER_STOP');
        actedAfter.push(kind);
        continue;
      }
      if (this.deps.policy.require_declared_stop && !item.refusalCodeAfter) {
        breaches.push('TERM_REFUSAL_WITHOUT_CODE');
        continue;
      }
      provenProbes.push(kind);
    }

    if (observation.liveCapabilities > this.deps.policy.max_live_capability) {
      breaches.push('TERM_LIVE_CAPABILITY');
    }
    if (observation.danglingLeases > this.deps.policy.max_dangling_lease) {
      breaches.push('TERM_DANGLING_LEASE');
    }
    if (this.deps.policy.require_declared_stop && !observation.declaredStop) {
      breaches.push('TERM_STOP_UNDECLARED');
    }
    if (observation.stopMs > this.deps.policy.stop_deadline_ms) {
      breaches.push('TERM_DEADLINE_EXCEEDED');
    }
    if (!this.claimed.includes(entity)) {
      // الشهادة تُثبت توقفًا لم يدّعه المنفّذ: اختلافٌ يُعلن لا يُبتلع
      breaches.push('TERM_CLAIM_CONTRADICTS_EVIDENCE');
    }

    const unique = [...new Set(breaches)];
    this.record(entity, unique);
    return { entity, stopProven: unique.length === 0, breaches: unique, actedAfter, provenProbes };
  }

  private record(entity: EntityId, breaches: readonly string[]): void {
    this.deps.audit.append(this.ledgerId, 'termination_judged', {
      entity, breaches: [...breaches], stopProven: breaches.length === 0,
    });
    for (const code of breaches) {
      this.deps.audit.append(this.ledgerId, 'termination_breach', { entity, code });
    }
  }

  /** الحكم الجامع: كل مستهدَف يُحاكَم، وكل دعوى خارج النطاق تُكشف */
  judgeAll(): TerminationVerdict {
    const breaches: string[] = [];
    const verdicts: EntityVerdict[] = [];

    if (this.deps.policy.require_independent_witness) {
      if (!this.witnessId) breaches.push('TERM_WITNESS_MISSING');
      else if (TERMINATION_EXECUTORS.includes(this.witnessId)) breaches.push('TERM_WITNESS_IS_EXECUTOR');
    }
    if (this.targeted.length > this.deps.policy.max_agents_per_order) {
      breaches.push('TERM_ORDER_OVER_CAPACITY');
    }
    for (const entity of this.claimed) {
      if (!this.targeted.includes(entity)) breaches.push('TERM_CLAIMED_NOT_TARGETED');
    }
    for (const entity of this.targeted) {
      const verdict = this.judge(entity);
      verdicts.push(verdict);
      breaches.push(...verdict.breaches);
    }
    if (this.targeted.length === 0) breaches.push('TERM_ORDER_EMPTY');

    const unique = [...new Set(breaches)];
    // خروق مستوى الأمر (شاهد، نطاق، دعوى خارج الأهداف) لم تكن تُفرد سجلًا لأنها
    // لا تُنسب إلى كيان بعينه، فكانت تختفي من عدّ الخروق في السجل. تُفرد الآن
    // منسوبة إلى «order» صراحة: خرقٌ لا سجلَ له خرقٌ غير مُدقَّق (RULE-006).
    const entityBreaches = new Set(verdicts.flatMap((v) => v.breaches));
    for (const code of unique) {
      if (!entityBreaches.has(code)) {
        this.deps.audit.append(this.ledgerId, 'termination_breach', { entity: 'order', code });
      }
    }
    const passed = unique.length === 0;
    const escalated = !passed && this.deps.policy.escalate_on_breach === true;

    const entry = this.deps.audit.append(this.ledgerId, 'termination_verdict', {
      passed, targeted: this.targeted.length,
      proven: verdicts.filter((v) => v.stopProven).length,
      breaches: unique,
    });
    if (escalated) {
      this.deps.audit.append(this.ledgerId, 'escalated_to_king', {
        incident: 'termination_breach', breaches: unique,
      });
    }

    return {
      passed, targeted: this.targeted.length,
      proven: verdicts.filter((v) => v.stopProven).length,
      verdicts, breaches: unique, escalated, auditId: entry.hash,
    };
  }
}
