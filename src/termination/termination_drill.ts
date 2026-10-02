/**
 * src/termination/termination_drill.ts — تمرين الإنهاء (المرحلة 35)
 * المالك: ديوان التدقيق (المُشغّل)، وحرس التاج ينفّذ الأمر
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر إنهاء واحد + شاهد مستقل + دفتر حكم
 * المخرجات: حكم واحد لا يُجزَّأ على «إيقاف كل الوكلاء بأمر واحد وتأكيد التوقف الفعلي»
 * التبعيات: الشاهد، الدفتر، منفّذ الأمر، سجل التدقيق، مفتاح الإيقاف
 * الصلاحيات: التشغيل والقياس فقط. التمرين لا يُوقف الدولة ولا يرفع سقفًا ولا يمنح
 *            قدرة، ولا يُشغّله منفّذُ الإنهاء (RULE-004).
 * السجلات: termination_drill_started / termination_drill_refused / termination_drill_finished
 * حالات الفشل (كلها مغلقة):
 *   - مُشغّل من جهات التنفيذ ⇒ رفض `TERMDRILL_RUNNER_IS_EXECUTOR`
 *   - دولة موقوفة أو غير طبيعية ⇒ رفض: قياسٌ على دولة موقوفة يقيس الإيقاف لا الإنهاء
 *   - لا وكلاء أحياء ⇒ رفض `TERMDRILL_NO_TARGETS`: تمرين بلا هدف يمرّ دائمًا
 *   - أمر لم يُنفَّذ (رفضته البوابة) ⇒ التمرين يفشل ولا يُعيد المحاولة بصلاحية أخرى
 * اختبارات الوحدة: tests/security/termination_drill.test.ts
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت هذه الوحدة:
 *   1) **الترتيب مُلزم**: شهادة قبلية ← أمر واحد ← شهادة بعدية ← ختم ← حكم.
 *      تقديم الأمر على الشهادة القبلية يُفقد المقارنة معناها.
 *   2) **أمر واحد لا أوامر**: شرط القبول «بأمر واحد»؛ فالتمرين يُصدر أمرًا واحدًا
 *      ولا يُكمل ما فات بأمر ثانٍ، وإلا صار يقيس المثابرة لا الإنهاء.
 *   3) **التمرين لا يُصلح ما يقيس**: لا يحرّر إيجارًا ولا يسحب قدرة بعد الأمر.
 *   4) **الحكم واحد لا يُجزَّأ**: يُرجع حكم الدفتر كما هو، ولا يُعيد صياغته نجاحًا.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { TERMINATION_EXECUTORS } from '../kernel/config';
import { StopWitness, TerminationPolicy } from './stop_witness';
import { EntityObservation, TerminationLedger, TerminationVerdict } from './termination_ledger';

/** منفّذ الأمر: يُصدر إنهاءً واحدًا ويُبلّغ عمّن يدّعي إيقافه */
export interface OrderExecutor {
  execute(targets: readonly EntityId[]): {
    readonly executed: boolean;
    readonly claimedStopped: readonly EntityId[];
    readonly reason: string;
    /** T-101: الزمنُ المقيسُ لكلِّ كيانٍ من المنفّذ نفسِه — لا من القارئ ولا صفرًا مفترضًا */
    readonly stopMs: Readonly<Record<EntityId, number>>;
  };
}

/** T-101: كيانٌ لا زمنَ مقيسًا له يُحكم عليه بأنه تجاوز المهلة — الغيابُ ليس صفرًا */
export const UNMEASURED_STOP_MS = Number.MAX_SAFE_INTEGER;

/** قارئ القياسات بعد الأمر — يقرأ الوحدات الحقيقية ولا يدّعي عنها */
export interface ObservationReader {
  read(entity: EntityId): Omit<EntityObservation, 'evidence' | 'stopMs'>;
}

export interface TerminationDrillDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly witness: StopWitness;
  readonly ledger: TerminationLedger;
  readonly executor: OrderExecutor;
  readonly reader: ObservationReader;
  readonly policy: TerminationPolicy;
  readonly mode: () => string;
}

export type DrillOutcome =
  | { readonly ran: false; readonly code: string; readonly reason: string }
  | { readonly ran: true; readonly verdict: TerminationVerdict };

export class TerminationDrill {
  constructor(private readonly deps: TerminationDrillDeps) {}

  run(runBy: EntityId, targets: readonly EntityId[]): DrillOutcome {
    const refuse = (code: string, reason: string): DrillOutcome => {
      this.deps.audit.append(runBy, 'termination_drill_refused', { code, reason });
      return { ran: false, code, reason };
    };

    if (TERMINATION_EXECUTORS.includes(runBy)) {
      return refuse('TERMDRILL_RUNNER_IS_EXECUTOR', 'من ينفّذ الإنهاء لا يُشغّل تمرين الحكم عليه');
    }
    if (this.deps.killSwitch.status.engaged) {
      return refuse('TERMDRILL_STATE_HALTED', 'قياس على دولة موقوفة يقيس الإيقاف لا الإنهاء');
    }
    if (this.deps.mode() !== 'normal') {
      return refuse('TERMDRILL_STATE_ABNORMAL', 'لا تمرين إنهاء على دولة غير طبيعية');
    }
    if (targets.length === 0) {
      return refuse('TERMDRILL_NO_TARGETS', 'تمرين بلا هدف يمرّ دائمًا فلا يُثبت شيئًا');
    }
    if (targets.length > this.deps.policy.max_agents_per_order) {
      return refuse('TERMDRILL_OVER_CAPACITY', 'نطاق يتجاوز سقف الأمر المعلن في termination.yaml');
    }

    this.deps.audit.append(runBy, 'termination_drill_started', { targets: targets.length });

    // 1) الشهادة القبلية: كل مسلك يجب أن يعمل الآن، وإلا فرفضه لاحقًا بلا معنى
    for (const entity of targets) this.deps.witness.proveBefore(entity);

    // 2) أمر واحد لا غير (ثابت 2)
    const order = this.deps.executor.execute(targets);
    if (!order.executed) {
      return refuse('TERMDRILL_ORDER_REFUSED', `أمر الإنهاء لم يُنفَّذ: ${order.reason}`);
    }

    // 3) الشهادة البعدية بالمسالك نفسها
    for (const entity of targets) {
      this.deps.witness.proveAfter(entity);
      this.deps.witness.seal(entity);
    }

    // 4) الحكم — الدفتر يحكم، والتمرين لا يُعيد صياغته (ثابت 4)
    this.deps.ledger.declareOrder(targets, order.claimedStopped, this.deps.witness.witnessId);
    for (const entity of targets) {
      this.deps.ledger.observe(entity, {
        ...this.deps.reader.read(entity),
        stopMs: order.stopMs[entity] ?? UNMEASURED_STOP_MS,
        evidence: this.deps.witness.evidenceFor(entity),
      });
    }
    const verdict = this.deps.ledger.judgeAll();

    this.deps.audit.append(runBy, 'termination_drill_finished', {
      passed: verdict.passed, targeted: verdict.targeted, proven: verdict.proven,
      breaches: [...verdict.breaches],
    });
    return { ran: true, verdict };
  }
}
