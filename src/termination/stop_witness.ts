/**
 * src/termination/stop_witness.ts — الشاهد المستقل على التوقف (المرحلة 35)
 * المالك: ديوان التدقيق (الشاهد)، وينفّذ الإنهاءَ حرسُ التاج — وهما لا يجتمعان
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: كيان مستهدَف + مسالك حقيقية تُجرَّب بهويته قبل الأمر وبعده
 * المخرجات: شهادة لكل مسلك: هل مضى قبل؟ هل مضى بعد؟ وبأي رمز رُفض؟
 * التبعيات: سجل التدقيق، تهيئة الإنهاء. **لا يعتمد على من نفّذ الإنهاء** عمدًا.
 * الصلاحيات: التجريب والشهادة فقط. الشاهد لا يُنهي أحدًا ولا يسحب قدرة ولا يحرّر
 *            إيجارًا (RULE-004): من يشهد لا يصنع ما يشهد عليه.
 * السجلات: stop_probe_pre / stop_probe_post / stop_probe_unproven / stop_witness_sealed
 * حالات الفشل (كلها مغلقة):
 *   - مسلك رمى استثناءً ⇒ يُحتسب «لم يمضِ» برمز `PROBE_THREW`، ولا يُسقط الشهادة كلها
 *   - شهادة بعدية بلا شهادة قبلية ⇒ تُرفض ولا تُحتسب قبولًا
 *   - ختمٌ ثانٍ لكيان مختوم ⇒ يُرفض: الشهادة تُكتب مرة ولا تُنقَّح بعد رؤية الحكم
 * اختبارات الوحدة: tests/security/stop_witness.test.ts
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت هذه الوحدة:
 *   1) **الدعوى ليست دليلًا**: `stop()` أعادت `true` لا تعني توقفًا. الدليل أن
 *      فعلًا حقيقيًّا جُرّب بهوية الوكيل **بعد** الأمر فرُفض برمز معلن. هذا نقلٌ
 *      حرفيّ لدرس المرحلة 34: `healed()` لا `heal()`.
 *   2) **الرفض بلا إثبات قبليّ لا يُقبل**: مسلك معطوب أصلًا يرفض كل شيء دائمًا،
 *      فيمنح خضرةً بلا مقابل. لذا يُشترط `actedBefore === true` قبل قبول أي رفض.
 *   3) **الشاهد لا يُصلح**: إن رأى إيجارًا معلَّقًا أو قدرةً حيّة لم يحرّرها ولم
 *      يسحبها — من أصلح الخرق أثناء قياسه أضاع الدليل (درس المرحلة 34).
 *   4) **الشهادة تُختم**: بعد `seal` لا تُقبل قياسات جديدة، فلا تُعدَّل الأدلة
 *      بعد ظهور الحكم.
 *   5) **الاستثناء ليس توقفًا**: مسلك انهار لا يُعدّ رفضًا مؤدَّبًا؛ يُسجَّل رمزه
 *      المميَّز كي لا يُشترى القبول بمسلك يكسره التمرين نفسه.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { StopProbeKind, TerminationConfig } from '../kernel/config';

export type TerminationPolicy = TerminationConfig['policy'];

/** نتيجة محاولة واحدة على مسلك حقيقي */
export interface ProbeAttempt {
  /** هل مضى الفعل فعلًا؟ `true` بعد الأمر تعني أن الوكيل ما زال يعمل */
  readonly acted: boolean;
  /** رمز الرفض المعلن إن رُفض — رفضٌ بلا رمز رفضٌ غير موثَّق */
  readonly refusalCode: string | null;
}

/** مسلك يُجرَّب بهوية الكيان عبر وحدة حقيقية لا عبر علم في الاختبار */
export interface StopProbe {
  readonly kind: StopProbeKind;
  attempt(entity: EntityId): ProbeAttempt;
}

/** شهادة مسلك واحد على كيان واحد */
export interface ProbeEvidence {
  readonly kind: StopProbeKind;
  /** هل مضى المسلك قبل الأمر؟ إن لم يمضِ فالمسلك لا يصلح شاهدًا */
  readonly actedBefore: boolean;
  /** هل مضى بعد الأمر؟ */
  readonly actedAfter: boolean;
  readonly refusalCodeBefore: string | null;
  readonly refusalCodeAfter: string | null;
  readonly measuredBefore: boolean;
  readonly measuredAfter: boolean;
}

/** رمز استثناء مسلك — يُميَّز عن الرفض المؤدَّب */
export const PROBE_THREW = 'PROBE_THREW';
/**
 * T-100 (W-2026-051): مسلكٌ أعاد وعدًا (Promise) يفتح نافذةً بين مسلكٍ ومسلك يتصرّف فيها الكيان —
 * فالجولةُ متزامنةٌ بعقد: كلُّ المسالك في دورةٍ واحدةٍ لا تُسلِّم الحلقة، وما خرج عنه يُسمّى ولا يُحتسب.
 */
export const PROBE_ASYNC = 'PROBE_ASYNC';

export interface StopWitnessDeps {
  readonly audit: AppendOnlyLog;
  readonly policy: TerminationPolicy;
  readonly probes: readonly StopProbe[];
  /** هوية الشاهد — يجب أن تطابق `witness_authority` في التهيئة */
  readonly witnessId?: EntityId;
}

interface Cell {
  actedBefore: boolean;
  actedAfter: boolean;
  refusalCodeBefore: string | null;
  refusalCodeAfter: string | null;
  measuredBefore: boolean;
  measuredAfter: boolean;
}

export class StopWitness {
  private readonly cells = new Map<EntityId, Map<StopProbeKind, Cell>>();
  private readonly sealed = new Set<EntityId>();
  readonly witnessId: EntityId;

  constructor(private readonly deps: StopWitnessDeps) {
    this.witnessId = deps.witnessId ?? (deps.policy.witness_authority as EntityId);
  }

  /** المسالك المعلنة في التهيئة والمتوفّرة فعلًا — ما أُعلن ولم يُقدَّم يُكشف في الحكم */
  get declaredProbes(): readonly StopProbeKind[] {
    return [...this.deps.policy.probes];
  }

  private cell(entity: EntityId, kind: StopProbeKind): Cell {
    let row = this.cells.get(entity);
    if (!row) { row = new Map(); this.cells.set(entity, row); }
    let cell = row.get(kind);
    if (!cell) {
      cell = {
        actedBefore: false, actedAfter: false,
        refusalCodeBefore: null, refusalCodeAfter: null,
        measuredBefore: false, measuredAfter: false,
      };
      row.set(kind, cell);
    }
    return cell;
  }

  private run(probe: StopProbe, entity: EntityId): ProbeAttempt {
    try {
      const outcome = probe.attempt(entity);
      if (typeof (outcome as unknown as { then?: unknown })?.then === 'function') {
        return { acted: false, refusalCode: PROBE_ASYNC };
      }
      return { acted: outcome.acted === true, refusalCode: outcome.refusalCode ?? null };
    } catch {
      // ثابت 5: الانهيار ليس رفضًا مؤدَّبًا، ويُسمّى باسمه
      return { acted: false, refusalCode: PROBE_THREW };
    }
  }

  /**
   * الشهادة القبلية: تُثبت أن كل مسلك **كان يعمل** قبل الأمر.
   * بلا هذه الخطوة تصير كل خضرةٍ بعدها بلا معنى (ثابت 2).
   */
  proveBefore(entity: EntityId): readonly ProbeEvidence[] {
    if (this.sealed.has(entity)) return this.evidenceFor(entity);
    const sweepStart = performance.now();
    for (const probe of this.deps.probes) {
      const attempt = this.run(probe, entity);
      const cell = this.cell(entity, probe.kind);
      cell.actedBefore = attempt.acted;
      cell.refusalCodeBefore = attempt.refusalCode;
      cell.measuredBefore = true;
      this.deps.audit.append(this.witnessId, 'stop_probe_pre', {
        entity, probe: probe.kind, acted: attempt.acted, refusalCode: attempt.refusalCode,
      });
      if (!attempt.acted) {
        this.deps.audit.append(this.witnessId, 'stop_probe_unproven', {
          entity, probe: probe.kind,
          reason: 'المسلك لم يعمل قبل الأمر فلا يصلح شاهدًا على التوقف',
        });
      }
    }
    this.sweep(entity, 'pre', sweepStart);
    return this.evidenceFor(entity);
  }

  /** الشهادة البعدية: تُجرَّب المسالك نفسها بعد الأمر، ويُطلب رفضٌ برمز معلن */
  proveAfter(entity: EntityId): readonly ProbeEvidence[] {
    if (this.sealed.has(entity)) return this.evidenceFor(entity);
    const sweepStart = performance.now();
    for (const probe of this.deps.probes) {
      const attempt = this.run(probe, entity);
      const cell = this.cell(entity, probe.kind);
      cell.actedAfter = attempt.acted;
      cell.refusalCodeAfter = attempt.refusalCode;
      cell.measuredAfter = true;
      this.deps.audit.append(this.witnessId, 'stop_probe_post', {
        entity, probe: probe.kind, acted: attempt.acted, refusalCode: attempt.refusalCode,
      });
    }
    this.sweep(entity, 'post', sweepStart);
    return this.evidenceFor(entity);
  }

  /** T-100: الجولةُ كلُّها في دورةٍ متزامنةٍ واحدة — يُقيَّد زمنُها وعددُ مسالكها شاهدًا على أنّ لا نافذة */
  private sweep(entity: EntityId, phase: 'pre' | 'post', startedAt: number): void {
    this.deps.audit.append(this.witnessId, 'stop_probe_sweep', {
      entity, phase, probes: this.deps.probes.length, atomic: true,
      sweepMs: Number((performance.now() - startedAt).toFixed(3)),
    });
  }

  evidenceFor(entity: EntityId): readonly ProbeEvidence[] {
    const row = this.cells.get(entity);
    if (!row) return [];
    return [...row.entries()].map(([kind, cell]) => ({ kind, ...cell }));
  }

  witnessed(): readonly EntityId[] {
    return [...this.cells.keys()];
  }

  isSealed(entity: EntityId): boolean {
    return this.sealed.has(entity);
  }

  /** ختم الشهادة: بعده لا تُقبل قياسات جديدة (ثابت 4) */
  seal(entity: EntityId): boolean {
    if (this.sealed.has(entity)) return false;
    this.sealed.add(entity);
    this.deps.audit.append(this.witnessId, 'stop_witness_sealed', {
      entity, probes: this.evidenceFor(entity).length,
    });
    return true;
  }
}
