/**
 * src/staging/watch_probes.ts — ماسحات الحرّاس موصولة بوحدات قائمة (المرحلة 36)
 * المالك: ديوان التدقيق — الماسح يقرأ ولا يُصلح (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: وحدات الدولة القائمة (حرس الأقاليم، السجل، النطاق، سجل الإنهاء، النبض)
 * المخرجات: خرائط `WatchKind ⇒ WatchProbe` تُمرَّر للمراقب فلا يعرف تفصيل الوحدات
 * التبعيات: RegionMonitor, AppendOnlyLog, OperationScope, TerminationRoll,
 *           PermissionRegistry, RoyalHeartbeat
 * الصلاحيات: القراءة والمسح؛ **ولا يُصلح ماسحٌ ما يجده** ولا يُنهي ولا يمنح
 * السجلات: لا يكتب الماسح في السجل — المراقب هو من يُقيّد الحادث (فصل الأدوار)
 * ثوابت هذه الوحدة:
 *   1) **الماسح على وحدة حقيقية لا على عدّاد وهمي**: كل ماسح ينادي دالة قائمة في الدولة
 *      — وهذا ما يجعل مؤقّت المراقب يكشف ما كان يُكشف بيدٍ بشرية وحدها
 *   2) **الماسح لا يُصنّف شدّة**: يُرجع نوع الحادث ووصفه، والشدّة من التهيئة (RULE-005)
 *   3) **خرق النطاق يُقرأ مرة واحدة**: يُحفظ مؤشّر على ما قُرئ، فلا يُضاعف حادثٌ واحد
 *      عدّ الحوادث في كل مسحة ويُسقط نافذة بحادثٍ لا يتجدّد
 *   4) **ماسح الإنهاء يقيس فعلًا لا نيّة**: كائنٌ في سجل الإنهاء وله صلاحية سارية حادثٌ،
 *      لأن الإنهاء الذي لا يُسقط الصلاحية إعلانٌ لا إنهاء (درس المرحلة 33)
 *   5) **غياب الملك حادثٌ يُرفع لا حالةٌ تُحتمل**: وضع الحماية سلطةٌ بلا مسؤول حاضر
 * حالات الفشل: انهيار أي ماسح يُقيّده المراقب `staging_watch_failed` ويُحصى خرقًا
 * اختبار القبول: tests/staging/incident_monitor.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0020-limited-operation.md
 */
import { EntityId, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { TerminationRoll } from '../kernel/termination_roll';
import { PermissionRegistry } from '../agents/permissions';
import { RegionMonitor } from '../federation/region_monitor';
import { WatchKind, IncidentKind } from '../kernel/config';
import { WatchProbe, WatchFinding } from './incident_monitor';
import { OperationScope } from './operation_scope';

/** ترجمة رايات حرس الأقاليم إلى حوادث معلنة — الاسم يُحكم به فلا يُترك للاجتهاد */
const REGION_FLAG_TO_INCIDENT: Readonly<Record<string, IncidentKind>> = {
  reserved_domain_drift: 'crown_domain_drift',
  delegated_without_governor: 'authority_without_holder',
  governor_without_region: 'authority_without_holder',
  dispute_unresolved: 'unresolved_dispute',
};

export interface WatchProbeDeps {
  readonly audit: AppendOnlyLog;
  readonly regionMonitor: RegionMonitor;
  readonly scope: OperationScope;
  readonly terminationRoll: TerminationRoll;
  readonly permissions: PermissionRegistry;
  readonly modeAt: (at: number) => StateMode;
}

/** ماسح الأقاليم: ينادي المسح الحقيقي — هذا هو ما كان ينتظر يدًا (ثابت 1) */
export function regionsProbe(deps: WatchProbeDeps): WatchProbe {
  let seen = 0;
  return (now: number): readonly WatchFinding[] => {
    deps.regionMonitor.sweep(now);
    const history = deps.regionMonitor.history();
    const fresh = history.slice(seen);
    seen = history.length;
    const findings: WatchFinding[] = [];
    for (const flag of fresh) {
      const kind = REGION_FLAG_TO_INCIDENT[flag.kind];
      if (!kind) continue;
      findings.push({ kind, detail: `${flag.kind}/${flag.regionId}: ${flag.detail}` });
    }
    return findings;
  };
}

/** ماسح السلسلة: سلامة السجل تُقاس لا تُفترض (RULE-006) */
export function auditChainProbe(deps: WatchProbeDeps): WatchProbe {
  return (): readonly WatchFinding[] => (
    deps.audit.verifyIntegrity().valid
      ? []
      : [{ kind: 'audit_chain_broken' as IncidentKind, detail: 'سلسلة التدقيق لا تتحقّق' }]
  );
}

/** ماسح النطاق: يقرأ الخرق مرة واحدة (ثابت 3) */
export function scopeProbe(deps: WatchProbeDeps): WatchProbe {
  let seen = 0;
  return (): readonly WatchFinding[] => {
    const all = deps.scope.violations();
    const fresh = all.slice(seen);
    seen = all.length;
    return fresh.map((v) => ({
      kind: 'scope_violation' as IncidentKind,
      detail: `${v.actor} حاول ${v.action}: ${v.reason}`,
    }));
  };
}

/** ماسح الإنهاء: منتهٍ وله صلاحية سارية = حادث (ثابت 4) */
export function terminationProbe(deps: WatchProbeDeps): WatchProbe {
  const reported = new Set<EntityId>();
  return (now: number): readonly WatchFinding[] => {
    const findings: WatchFinding[] = [];
    for (const record of deps.terminationRoll.list()) {
      const entity = record.entity;
      if (reported.has(entity)) continue;
      const live = deps.permissions.granted(entity, now);
      if (live.length === 0) continue;
      reported.add(entity);
      findings.push({
        kind: 'terminated_entity_acting' as IncidentKind,
        detail: `كائن منتهٍ يحمل صلاحية سارية: ${entity} [${live.join(', ')}]`,
      });
    }
    return findings;
  };
}

/** ماسح الملك: وضع الحماية سلطةٌ بلا مسؤول حاضر (ثابت 5) */
export function kingProbe(deps: WatchProbeDeps): WatchProbe {
  let raised = false;
  return (now: number): readonly WatchFinding[] => {
    const mode = deps.modeAt(now);
    if (mode !== 'protective') { raised = false; return []; }
    if (raised) return [];
    raised = true;
    return [{
      kind: 'authority_without_holder' as IncidentKind,
      detail: 'الدولة في وضع حماية — قرارٌ سيادي بلا ملك حاضر',
    }];
  };
}

/** بناء كل الماسحات المعروفة. حرسٌ معلن بلا ماسح يُرفض عند بناء المراقب. */
export function buildWatchProbes(deps: WatchProbeDeps): ReadonlyMap<WatchKind, WatchProbe> {
  return new Map<WatchKind, WatchProbe>([
    ['regions', regionsProbe(deps)],
    ['audit_chain', auditChainProbe(deps)],
    ['scope', scopeProbe(deps)],
    ['termination', terminationProbe(deps)],
    ['king', kingProbe(deps)],
  ]);
}
