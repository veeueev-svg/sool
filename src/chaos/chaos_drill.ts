/**
 * src/chaos/chaos_drill.ts — تمرين الانقطاع المعلن (المرحلة 34)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/chaos.yaml + حاقن قطوع + دفتر توقف آمن + مِجَسّ لكل قطع
 * المخرجات: تقرير توقف آمن لكل قطع بأرقام مقيسة وحُكم جامع لا يُجمَّل
 * التبعيات: حاقن القطوع ودفتر التوقف الآمن (هذه المرحلة)، مفتاح الإيقاف (المرحلة 9)،
 *           سجل التدقيق (المرحلة 3)، وضع الدولة كما تراه البوابة (المرحلة 6)
 * الصلاحيات: القطع والقياس والتصعيد فقط. التمرين لا يعتمد أمرًا ولا يوقف الدولة
 *            ولا يرفع سقفًا ولا يُصلح خرقًا (RULE-004 و RULE-005).
 * السجلات: chaos_drill_online / chaos_drill_started / chaos_drill_refused /
 *          chaos_cut_measured / chaos_drill_report
 * حالات الفشل (كلها مغلقة):
 *   - مُشغّل غير جهة التهيئة ⇒ رفض مسجَّل ولا قطع
 *   - دولة غير طبيعية (إيقاف أو حماية) ⇒ رفض: لا يُقطع عن دولة مقطوعة أصلًا فيُنسب
 *     توقفها إلى القطع الجديد (RULE-007)
 *   - قطع بلا مِجَسّ ⇒ رفض مسجَّل، ويظهر في الحكم `CHAOS_CUT_NOT_OBSERVED` لا يُتجاوز
 *   - قطع لم تعد الدولة منه بإثبات ⇒ خرق `CHAOS_CUT_NOT_RESTORED` ولا تكميل صامت
 * اختبارات الوحدة: tests/chaos/chaos_drill.test.ts
 * اختبار القبول: tests/chaos/chaos_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0018-chaos-drills.md
 * ثوابت هذه الوحدة:
 *   1) **لا قطع بلا فعل سيادي تحته**: القطع الذي لم يُجرَّب تحته فعلٌ لا يُثبت شيئًا،
 *      فالمِجَسّ ملزَم بمحاولة واحدة على الأقل ونتيجتها هي القياس.
 *   2) **الرفض يجب أن يكون برمز**: توقفٌ بلا رمز معلن توقفٌ غير موثَّق، وهو خرق
 *      باسمه لا حالة مقبولة.
 *   3) **العودة قبل القطع التالي**: لا يُحقن قطعٌ ثانٍ قبل إثبات عودة الأول، وإلا
 *      كان التوقف بسببين لا يُعرف أيهما كفى.
 *   4) **الحكم على المعلن لا على المقيس**: `run` تحكم على كل قطع في `chaos.yaml`،
 *      فحذف طور من التمرين يُفشِله ولا يُقصِّره.
 *   5) **من يقطع لا يُبرِّئ**: القياس بيد جهة تدقيق، والحكم في دفتر مستقل، والتنفيذ
 *      في القناة — ثلاث جهات لا واحدة (RULE-004).
 */
import { EntityId, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { ChaosFault } from '../kernel/config';
import { ChaosPolicy, FaultInjector, FaultSeam } from './fault_injector';
import {
  ContinuityAfterCut, CutObservation, SafeStopLedger, SafeStopReport, breachesOf,
} from './safe_stop_ledger';
import { EffectMatchReport } from './effect_matcher';

/** نتيجة الفعل السيادي المُجرَّب تحت القطع */
export interface CutAttempt {
  readonly proceeded: boolean;
  readonly refusalCode: string | null;
}

/** قياسات ما بعد القطع، مقروءة من الوحدات الحقيقية */
export interface CutMeasurement {
  readonly effects: EffectMatchReport;
  readonly danglingLeases: number;
  readonly auditIntact: boolean;
  readonly modeAfter: ContinuityAfterCut;
  readonly declaredStop: boolean;
}

/**
 * مِجَسّ قطع: يملك مقعده الحقيقي، ويُجرِّب فعلًا سياديًا تحت القطع، ويقيس ما بعده.
 * يُمرَّر من فوق لأن التمرين لا يعرف بواطن الوحدات ولا يخترع لنفسه نظامًا يقيسه.
 */
export interface CutProbe {
  readonly kind: ChaosFault;
  readonly seam: FaultSeam;
  readonly attempt: (probeCommands: number) => CutAttempt;
  readonly measure: (probeCommands: number) => CutMeasurement;
}

export interface ChaosDrillDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly injector: FaultInjector;
  readonly ledger: SafeStopLedger;
  readonly policy: ChaosPolicy;
  /** وضع الدولة كما تراه البوابة — التمرين يقرؤه ولا يغيّره */
  readonly mode: () => StateMode;
}

/**
 * T-94 (W-2026-051): مشاهدةُ قطعٍ مركّب — **عقدُ الإسناد**: التوقفُ تحت زوجٍ يُسند إلى الزوج معًا
 * (`attribution: 'joint'`)، ولكلِّ طرفٍ مشاهدتُه وخروقُه بشروطِ القطعِ المنفرد نفسِها. ولا تُدوَّن في
 * دفتر القطوع المنفردة: نجاحُ الزوج لا يشهد لأحدِ طرفيه بأنّه يكفي وحده.
 */
export interface CompoundObservation {
  readonly kinds: readonly ChaosFault[];
  readonly attribution: 'joint';
  readonly parts: readonly { readonly kind: ChaosFault; readonly observation: CutObservation; readonly breaches: readonly string[] }[];
  readonly stopMs: number;
  readonly breaches: readonly string[];
  readonly verdict: 'pass' | 'fail';
}

export type ChaosOutcome<T> =
  | { readonly ok: true; readonly report: T }
  | { readonly ok: false; readonly code: string };

export class ChaosDrill {
  private readonly probes = new Map<ChaosFault, CutProbe>();

  constructor(private readonly deps: ChaosDrillDeps) {
    deps.audit.append(deps.policy.drill_authority, 'chaos_drill_online', {
      faults: [...deps.policy.faults],
      probeCommands: deps.policy.probe_commands,
      deadlineMs: deps.policy.safe_stop_deadline_ms,
      fallbackMode: deps.policy.fallback_mode,
    });
  }

  /** تسجيل مِجَسّ ومقعده. المقعد يُسجَّل في الحاقن ولا يُستعمل من هنا مباشرة. */
  registerProbe(by: EntityId, probe: CutProbe): { ok: boolean; code?: string } {
    if (by !== this.deps.policy.drill_authority) {
      this.refuse(by, probe.kind, 'CHAOS_PROBE_UNAUTHORIZED');
      return { ok: false, code: 'CHAOS_PROBE_UNAUTHORIZED' };
    }
    if (probe.kind !== probe.seam.kind) {
      this.refuse(by, probe.kind, 'CHAOS_PROBE_SEAM_MISMATCH');
      return { ok: false, code: 'CHAOS_PROBE_SEAM_MISMATCH' };
    }
    if (this.probes.has(probe.kind)) {
      this.refuse(by, probe.kind, 'CHAOS_PROBE_ALREADY_REGISTERED');
      return { ok: false, code: 'CHAOS_PROBE_ALREADY_REGISTERED' };
    }
    const registered = this.deps.injector.register(by, probe.seam);
    if (!registered.ok) {
      this.refuse(by, probe.kind, registered.code);
      return { ok: false, code: registered.code };
    }
    this.probes.set(probe.kind, probe);
    this.deps.audit.append(by, 'chaos_probe_registered', { kind: probe.kind });
    return { ok: true };
  }

  /** بوابة كل قطع: الجهة ثم الإيقاف ثم وضع الدولة. الرفض مسجَّل باسم سببه. */
  private admit(by: EntityId, kind: ChaosFault | 'all'): string | null {
    if (by !== this.deps.policy.drill_authority) return this.refuse(by, kind, 'CHAOS_DRILL_UNAUTHORIZED');
    if (this.deps.killSwitch.status.engaged) return this.refuse(by, kind, 'CHAOS_DRILL_HALTED');
    if (this.deps.mode() !== 'normal') return this.refuse(by, kind, 'CHAOS_DRILL_STATE_NOT_NORMAL');
    return null;
  }

  private refuse(by: EntityId, kind: ChaosFault | 'all', code: string): string {
    this.deps.audit.append(by, 'chaos_drill_refused', { kind, code });
    return code;
  }

  /**
   * قطع واحد كامل: إعلان ← حقن ← فعل سيادي تحت القطع ← قياس ← عودة بإثبات ← قيد.
   * الزمن المقيس هو من لحظة الحقن إلى تمام القياس الذي يُقرأ منه إعلان التوقف.
   */
  cut(by: EntityId, kind: ChaosFault, now = Date.now()): ChaosOutcome<CutObservation> {
    const denial = this.admit(by, kind);
    if (denial) return { ok: false, code: denial };
    const probe = this.probes.get(kind);
    if (!probe) return { ok: false, code: this.refuse(by, kind, 'CHAOS_PROBE_MISSING') };
    if (this.deps.injector.activeFaults().length > 0) {
      return { ok: false, code: this.refuse(by, kind, 'CHAOS_CUT_OVERLAP') };
    }
    if (!this.deps.ledger.declare(by, kind)) {
      return { ok: false, code: this.refuse(by, kind, 'CHAOS_CUT_NOT_DECLARED') };
    }
    this.deps.audit.append(by, 'chaos_drill_started', { kind, probeCommands: this.deps.policy.probe_commands });

    const injected = this.deps.injector.inject(by, kind, now);
    if (!injected.ok) return { ok: false, code: injected.code };

    const startedAt = performance.now();
    const attempt = probe.attempt(this.deps.policy.probe_commands);
    const measurement = probe.measure(this.deps.policy.probe_commands);
    const stopMs = performance.now() - startedAt;

    const restore = this.deps.injector.restore(by, kind);
    const observation: CutObservation = {
      proceeded: attempt.proceeded,
      refusalCode: attempt.refusalCode,
      effects: measurement.effects,
      danglingLeases: measurement.danglingLeases,
      auditIntact: measurement.auditIntact,
      modeAfter: measurement.modeAfter,
      declaredStop: measurement.declaredStop,
      stopMs,
      restored: restore.ok,
    };
    this.deps.ledger.observe(by, kind, observation);
    this.deps.audit.append(by, 'chaos_cut_measured', {
      kind, proceeded: attempt.proceeded, refusalCode: attempt.refusalCode,
      halfExecuted: measurement.effects.halfExecuted,
      danglingLeases: measurement.danglingLeases, auditIntact: measurement.auditIntact,
      modeAfter: measurement.modeAfter, declaredStop: measurement.declaredStop,
      stopMs: Number(stopMs.toFixed(3)), restored: restore.ok,
    });
    return { ok: true, report: observation };
  }

  /**
   * T-94: قطعٌ مركّب — زوجٌ معلنٌ في `compound_faults` يُحقن معًا، ويُجرَّب تحته فعلُ كلِّ طرفٍ ويُقاس،
   * ثمّ يعود كلُّ قطعٍ بإثبات. الزمنُ واحدٌ للزوج (من الحقن إلى تمام آخر قياس) لأنّ التوقفَ واحد.
   */
  cutCompound(by: EntityId, kinds: readonly ChaosFault[], now = Date.now()): ChaosOutcome<CompoundObservation> {
    const label = kinds.join('+') as ChaosFault;
    const denial = this.admit(by, label);
    if (denial) return { ok: false, code: denial };
    const probes = kinds.map((k) => this.probes.get(k));
    if (probes.some((p) => !p)) return { ok: false, code: this.refuse(by, label, 'CHAOS_PROBE_MISSING') };
    const injected = this.deps.injector.injectCompound(by, kinds, now);
    if (!injected.ok) return { ok: false, code: this.refuse(by, label, injected.code) };
    const n = this.deps.policy.probe_commands;
    const startedAt = performance.now();
    const attempts = probes.map((p) => p!.attempt(n));
    const measured = probes.map((p) => p!.measure(n));
    const stopMs = performance.now() - startedAt;
    const restored = kinds.map((k) => this.deps.injector.restore(by, k).ok);
    const parts = kinds.map((kind, i) => {
      const observation: CutObservation = {
        proceeded: attempts[i]!.proceeded, refusalCode: attempts[i]!.refusalCode, ...measured[i]!,
        stopMs, restored: restored[i]!,
      };
      return { kind, observation, breaches: breachesOf(observation, this.deps.policy) };
    });
    const breaches = parts.flatMap((p) => p.breaches.map((code) => `${p.kind}:${code}`));
    const verdict: 'pass' | 'fail' = breaches.length === 0 ? 'pass' : 'fail';
    this.deps.audit.append(by, 'chaos_compound_measured', {
      kinds: [...kinds], attribution: 'joint', stopMs: Number(stopMs.toFixed(3)), verdict, breaches,
      refusalCodes: parts.map((p) => p.observation.refusalCode),
    });
    if (verdict === 'fail' && this.deps.policy.escalate_on_breach) {
      this.deps.audit.append(by, 'escalated_to_king', { reason: 'خرق في توقف آمن تحت قطعٍ مركّب', breaches });
    }
    return { ok: true, report: { kinds: [...kinds], attribution: 'joint', parts, stopMs, breaches, verdict } };
  }

  /**
   * التمرين الكامل: كل قطع معلن في التهيئة بالترتيب، ثم الحكم الجامع.
   * القطع الذي فشل حقنه لا يوقف بقية القطوع: يبقى غير مقيس فيُفشله الحكم باسمه،
   * لأن الخروج عند أول عطب يُخفي بقية العطب ويُعطي تقريرًا أقصر لا أصدق.
   */
  run(by: EntityId, now = Date.now()): ChaosOutcome<SafeStopReport> {
    const denial = this.admit(by, 'all');
    if (denial) return { ok: false, code: denial };
    for (const kind of this.deps.policy.faults) {
      this.cut(by, kind, now);
    }
    const report = this.deps.ledger.judgeAll(by);
    this.deps.audit.append(by, 'chaos_drill_report', {
      verdict: report.verdict, declared: report.declared,
      observed: report.observed, breaches: report.breaches,
    });
    return { ok: true, report };
  }
}
