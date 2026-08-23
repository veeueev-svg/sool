/**
 * src/production/production_scanners.ts — ماسحات التشغيل الاتحادي (المرحلة 37)
 * المالك: ديوان التدقيق — الماسح يقرأ ولا يُصلح (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: وحدات الدولة القائمة (دفتر الأحمال، الوحدة الرقمية، المصانع، المستشفيات،
 *           الاحتفاظ) وسجل التدقيق لقياس مرور التاج
 * المخرجات: خرائط `ScannerKind ⇒ WatchProbe` تُمرَّر للمراقب الدائم
 * التبعيات: WatchProbe/WatchFinding من مراقب المرحلة 36، وواجهات قراءة صغيرة لكل وحدة
 * الصلاحيات: القراءة والمسح؛ **ولا يُصلح ماسحٌ ما يجده** ولا يُنهي ولا يمنح
 * السجلات: لا يكتب الماسح — المراقب هو من يُقيّد الحادث (فصل الأدوار)
 * ثوابت هذه الوحدة:
 *   1) **الدَّين يُسدّ لا يُعاد إعلانه**: المرحلة 36 ربطت خمسة حرّاس وتركت خمس وحدات
 *      لها ماسحات تنتظر نداءً (T-105). هذه الوحدة تنادي تلك الوحدات بمؤقّت، فتصير
 *      المسحة سلوكًا لا قدرةً معلنة
 *   2) **الماسح على وحدة حقيقية**: كل ماسح ينادي دالة قائمة في وحدة قائمة، لا عدّادًا
 *   3) **الماسح لا يُصنّف شدّة**: الشدّة من `config/production.yaml` وحدها (RULE-005)
 *   4) **الحادث الواحد لا يُعدّ مرتين**: لكل ماسح مؤشّرٌ على ما قُرئ (`seen`)، فلا
 *      يُضخّم حادثٌ واحد عدّاد الحوادث في كل دورة ويُسقط تشغيلًا بحادثٍ لا يتجدّد
 *   5) **الماسح يقرأ بواجهة ضيّقة**: يُطلب من الوحدة أقلّ ما يكفي للقياس، فلا يقدر
 *      الماسح على التعديل حتى لو أراد كاتبه
 *   6) **مرور التاج يُقاس من السجل لا من الوحدة**: ماسح المرور يقرأ سجل التدقيق
 *      ويقابل «فعل نفُذ» بـ«إذن استُوفي» — فلا يشهد المرور لنفسه (RULE-004)
 * حالات الفشل (كلها مغلقة): انهيار أي ماسح يُقيّده المراقب خرقًا؛ وحدةٌ فارغة ⇒ لا حادث
 *   موهوم؛ فعلٌ وقع قبل فتح المرور ⇒ لا يُحاسب عليه (المرحلة 24 قائمة)
 * اختبار القبول: tests/production/production_scanners.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { IncidentKind, ProductionConfig, ScannerKind } from '../kernel/config';
import { WatchFinding, WatchProbe } from '../staging/incident_monitor';

/** ثابت 5: واجهات قراءة ضيّقة — الماسح لا يرى من الوحدة إلا ما يقيس به */
export interface LoadBook {
  overdue(maxAgeMs: number, now?: number): readonly string[];
}
export interface UnitBook {
  reconcile(): { readonly consistent: boolean; readonly counter: number; readonly ledger: number };
}
export interface FactoryFloor {
  sweep(now?: number): readonly string[];
}
export interface HospitalWard {
  report(now?: number): { readonly expired: number; readonly halted: number };
}
export interface RetentionOffice {
  sweep(by?: EntityId, now?: number): { readonly purged: readonly string[] };
}
export interface PassageBook {
  readonly active: boolean;
  wasOpenAt(at: number): boolean;
}
/**
 * شاهدُ الثبات (T-120): أقلُ ما يكفي للحكم بأن الحالة تنجو من موت العمليّة.
 * `null` معناه لا وسيط أصلًا — وهو أولُ حالتي الخرق لا حالةً محايدة.
 */
export interface DurableWitness {
  readonly file: string;
  verify(): { readonly valid: boolean; readonly length: number; readonly reason: string | null };
}

/**
 * شاهدُ الحصر (T-16) بواجهةٍ ضيّقة (ثابت 5): أقلُ ما يكفي للحكم بأن العمليّة
 * محصورةٌ في النواة. تُوصَف هنا بنيويًّا لا باستيراد `src/security/confinement.ts`:
 * الماسح لا يحتاج إلى قارئ `/proc` ولا يقدر على شيء منه — يسأل ويرفع.
 */
export interface ConfinementFailureLike {
  readonly requirement: string;
  readonly measured: string;
}
export interface ConfinementVerdictLike {
  readonly confined: boolean;
  readonly failures: readonly ConfinementFailureLike[];
}
export interface ConfinementWitnessLike {
  readonly witnessRoot: string;
  verify(): ConfinementVerdictLike;
}

export interface ProductionScannerDeps {
  readonly audit: AppendOnlyLog;
  readonly loads: LoadBook;
  readonly unit: UnitBook;
  readonly factories: FactoryFloor;
  readonly hospitals: HospitalWard;
  readonly retention: RetentionOffice;
  readonly passage: PassageBook;
  readonly policy: ProductionConfig['policy'];
  /** جهة المسح في وحدة الاحتفاظ — تُمرَّر ولا تُخترع داخل الماسح */
  readonly retentionAuthority: EntityId;
  /** اليوميّة الدائمة إن وُجدت (T-120) — غيابها خرقٌ يُقاس لا تفصيلٌ يُطوَى */
  readonly durable: DurableWitness | null;
  /** شاهدُ الحصر (T-16) — `null` معناه لا شاهد أصلًا، وهو أولى حالتي الخرق */
  readonly confinement: ConfinementWitnessLike | null;
}

/** ماسح الأحمال: أمرٌ أُدرج ولم يُثبت مصيره بعد المدة المعلنة فقدٌ يُرفع (ثابت 1) */
export function loadsProbe(deps: ProductionScannerDeps): WatchProbe {
  const reported = new Set<string>();
  return (now: number): readonly WatchFinding[] => {
    const late = deps.loads.overdue(deps.policy.loads.pending_max_ms, now);
    const findings: WatchFinding[] = [];
    for (const commandId of late) {
      if (reported.has(commandId)) continue; // ثابت 4
      reported.add(commandId);
      findings.push({
        kind: 'command_loss_over_limit' as IncidentKind,
        detail: `أمر بلا مصير بعد ${deps.policy.loads.pending_max_ms}ms: ${commandId}`,
      });
    }
    return findings;
  };
}

/** ماسح الوحدة الرقمية: العدّاد والسجل يجب أن يتطابقا — والفرق يُرفع حادثًا */
export function digitalUnitProbe(deps: ProductionScannerDeps): WatchProbe {
  let lastReported = '';
  return (): readonly WatchFinding[] => {
    const state = deps.unit.reconcile();
    if (state.consistent) return [];
    const signature = `${state.counter}|${state.ledger}`;
    if (signature === lastReported) return []; // ثابت 4
    lastReported = signature;
    return [{
      kind: 'unit_ledger_mismatch' as IncidentKind,
      detail: `العدّاد ${state.counter} والسجل ${state.ledger}`,
    }];
  };
}

/** ماسح المصانع: دفعة تجاوزت مدتها المعلنة تُجهض وتُرفع حادثًا */
export function factoriesProbe(deps: ProductionScannerDeps): WatchProbe {
  const reported = new Set<string>();
  return (now: number): readonly WatchFinding[] => {
    const findings: WatchFinding[] = [];
    for (const runId of deps.factories.sweep(now)) {
      if (reported.has(runId)) continue; // ثابت 4
      reported.add(runId);
      findings.push({ kind: 'overdue_batch' as IncidentKind, detail: `دفعة متجاوزة: ${runId}` });
    }
    return findings;
  };
}

/** ماسح الخدمات الحرجة: خدمة قائمة بإعلانٍ منتهٍ خدمةٌ غير متحقَّقة */
export function hospitalsProbe(deps: ProductionScannerDeps): WatchProbe {
  let lastReported = -1;
  return (now: number): readonly WatchFinding[] => {
    const report = deps.hospitals.report(now);
    if (report.expired === 0) { lastReported = -1; return []; }
    if (report.expired === lastReported) return []; // ثابت 4
    lastReported = report.expired;
    return [{
      kind: 'critical_service_unverified' as IncidentKind,
      detail: `خدمات قائمة بإعلان منتهٍ: ${report.expired}`,
    }];
  };
}

/** ماسح الاحتفاظ: سجلٌ تجاوز مدته يُمسح، ومسحُه حادثٌ يُرفع لا صمتٌ يُطوى */
export function retentionProbe(deps: ProductionScannerDeps): WatchProbe {
  return (now: number): readonly WatchFinding[] => {
    const swept = deps.retention.sweep(deps.retentionAuthority, now);
    if (swept.purged.length === 0) return [];
    return [{
      kind: 'expired_retention' as IncidentKind,
      detail: `سجلات تجاوزت مدة الاحتفاظ ومُسحت: ${swept.purged.length}`,
    }];
  };
}

/**
 * ماسح مرور التاج (ثابت 6): يقرأ السجل ويقابل كل «فعل إقليمي نفُذ» بـ«إذن استُوفي».
 * فعلٌ نفُذ داخل تشغيل اتحادي مفتوح بلا إذن مطابق حادثٌ حرج — وهو نقض شرط القبول
 * نفسه. ومحاولة تجاوزٍ **مُنعت** حادثٌ جسيم يُقيَّد دليلًا على الإنفاذ.
 */
export function passageProbe(deps: ProductionScannerDeps): WatchProbe {
  let seen = 0;
  return (now: number): readonly WatchFinding[] => {
    const entries = deps.audit.snapshot();
    const fresh = entries.slice(seen);
    seen = entries.length;
    const findings: WatchFinding[] = [];
    const passed: string[] = [];
    for (const entry of fresh) {
      if (entry.kind !== 'region_action_passed') continue;
      const detail = entry.detail as Record<string, unknown>;
      passed.push(`${String(detail.regionId)}|${String(detail.domain)}|${String(detail.action)}`);
    }
    for (const entry of fresh) {
      if (entry.kind === 'region_action_bypass_blocked') {
        const detail = entry.detail as Record<string, unknown>;
        findings.push({
          kind: 'crown_passage_bypass' as IncidentKind,
          detail: `محاولة تجاوز مُنعت: ${String(detail.regionId)}/${String(detail.action)}`,
        });
        continue;
      }
      if (entry.kind !== 'region_action_executed') continue;
      const detail = entry.detail as Record<string, unknown>;
      const at = typeof detail.at === 'number' ? detail.at : now;
      // ثابت: خارج نافذة مرور مفتوحة يبقى الفعل الإداري كما أعلنته المرحلة 24
      if (!deps.passage.wasOpenAt(at)) continue;
      const key = `${String(detail.regionId)}|${String(detail.domain)}|${String(detail.action)}`;
      const index = passed.indexOf(key);
      if (index >= 0) { passed.splice(index, 1); continue; }
      findings.push({
        kind: 'region_action_without_passage' as IncidentKind,
        detail: `فعل إقليمي نفُذ بلا إذن مرور: ${key}`,
      });
    }
    return findings;
  };
}

/**
 * ماسحُ الثبات (T-120): تشغيلٌ يُقال إنه مستمرٌ بحالةٍ تموت مع العمليّة وعدُ نجاةٍ
 * لا حاملَ له. يرفع الحادث في حالتين: لا وسيط أصلًا، أو وسيطٌ سلسلته لا تُتحقّق —
 * والثانية أسوأ لأنها تُوهم النجاة. الشدّة من التهيئة وحدها (ثابت 3).
 */
export function durableStateProbe(deps: ProductionScannerDeps): WatchProbe {
  let lastReported = '';
  return (): readonly WatchFinding[] => {
    if (deps.durable === null) {
      if (lastReported === 'absent') return []; // ثابت 4
      lastReported = 'absent';
      return [{
        kind: 'state_not_durable' as IncidentKind,
        detail: 'لا وسيط دائم للحالة — ما في الذاكرة يموت مع العمليّة',
      }];
    }
    const state = deps.durable.verify();
    if (state.valid) { lastReported = ''; return []; }
    const signature = `broken|${state.reason ?? ''}|${state.length}`;
    if (signature === lastReported) return []; // ثابت 4
    lastReported = signature;
    return [{
      kind: 'state_not_durable' as IncidentKind,
      detail: `يوميّة غير مُتحقّقة: ${deps.durable.file} (${state.reason ?? 'بلا سبب معلن'})`,
    }];
  };
}

/**
 * ماسحُ الحصر (T-16): يسأل الشاهدَ في كل مسحة لا مرةً عند الإقلاع، لأن الحصر
 * حالةٌ تسقط ولا تُعلن سقوطَها: من أعاد تركيبَ الجذر للكتابة أو أوصل الحاوية
 * بشبكةٍ لها بوابة لم يُعلَم حتى يُقرأ `/proc` مرةً ثانية.
 * ولا يُصنّف الماسح شدّةً: الشدّة من `config/production.yaml` وحدها (ثابت 3).
 */
export function confinementProbe(deps: ProductionScannerDeps): WatchProbe {
  let lastReported = '';
  return (): readonly WatchFinding[] => {
    if (deps.confinement === null) {
      if (lastReported === 'absent') return []; // ثابت 4
      lastReported = 'absent';
      return [{
        kind: 'process_not_confined' as IncidentKind,
        detail: 'لا شاهدَ حصرٍ أصلًا — ومن لا يُثبت حصره فهو غير محصور',
      }];
    }
    // عجزُ الشاهد عن القراءة ليس صمتًا بل خرقٌ يُرفع مثلَ الغياب: لا يصحّ
    // أن يُخفي عجزُ القياس أنّ الحصرَ غير مُثبَت (RULE-007).
    let verdict: ConfinementVerdictLike;
    try {
      verdict = deps.confinement.verify();
    } catch (error) {
      const signature = `unreadable|${(error as Error).message}`;
      if (signature === lastReported) return []; // ثابت 4
      lastReported = signature;
      return [{
        kind: 'process_not_confined' as IncidentKind,
        detail: `شاهدُ الحصر غير مقروء: ${(error as Error).message}`,
      }];
    }
    if (verdict.confined) { lastReported = ''; return []; }
    const missing = verdict.failures.map((f) => `${f.requirement}=${f.measured}`).join(' · ');
    if (missing === lastReported) return []; // ثابت 4
    lastReported = missing;
    return [{
      kind: 'process_not_confined' as IncidentKind,
      detail: `حصرٌ ناقص في ${deps.confinement.witnessRoot}: ${missing}`,
    }];
  };
}

/** يبني كل الماسحات المعلنة — ماسحٌ معلن بلا بانٍ يُرفض عند بناء المراقب */
export function buildProductionScanners(
  deps: ProductionScannerDeps,
  base: ReadonlyMap<string, WatchProbe>,
): ReadonlyMap<ScannerKind, WatchProbe> {
  const probes = new Map<ScannerKind, WatchProbe>();
  for (const [kind, probe] of base) probes.set(kind as ScannerKind, probe);
  probes.set('loads', loadsProbe(deps));
  probes.set('digital_unit', digitalUnitProbe(deps));
  probes.set('factories', factoriesProbe(deps));
  probes.set('hospitals', hospitalsProbe(deps));
  probes.set('retention', retentionProbe(deps));
  probes.set('passage', passageProbe(deps));
  probes.set('durable_state', durableStateProbe(deps));
  probes.set('confinement', confinementProbe(deps));
  return probes;
}
