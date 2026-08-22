/**
 * src/production/production_runbook_steps.ts — ربوط خطوات كتب التشغيل الاتحادي (المرحلة 37)
 * المالك: الديوان الملكي ينفّذ، وديوان التدقيق يقيس الأثر (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: خطوات معلنة في `deploy/production/runbooks/*.yaml` ووحدات الدولة القائمة
 * المخرجات: كتبٌ قابلة للتنفيذ: لكل خطوة معلنة فعلٌ حقيقي وتحقّقٌ يقرأ الأثر من مصدره
 * التبعيات: RunbookRunner (مُعاد استعمالًا لا نسخًا), RegionalPassage, GovernorRegistry,
 *           RegionRegistry, KingIdentity, RoyalHeartbeat, ContinuousSupervisor
 * الصلاحيات: تنفيذ خطوات معلنة بجهة مشغّلة معلنة؛ ولا تُصدر الوحدة حكمًا
 * السجلات: production_precheck + سجلات الوحدات المنادَاة
 * ثوابت هذه الوحدة:
 *   1) **لكل خطوة معلنة ربطٌ بالرقم**: خطوةٌ بلا ربط تُرفض عند البناء، وربطٌ بلا إعلان
 *      يُرفض كذلك — فلا تنفيذ لا يعلمه الإعلان ولا إعلان لا ينفُذ
 *   2) **التحقّق يقرأ من مصدره لا من متغيّر كتبه الفعل** (درس المرحلة 36)
 *   3) **إثبات الإنفاذ محاولة تجاوز حقيقية**: الخطوة تُحاول فعلًا إقليميًّا بلا إذن
 *      وتتحقّق أنه **رُفض وقُيِّد** — لا تقرأ كودًا ولا تفترض
 *   4) **القياس لا يغيّر الحال**: خطوة غياب الملك تقيس الوضع المشتق في زمن مستقبلي
 *      بدالة قراءة لا تُسجّل ولا تُبدّل — فلا يُدخَل الوضع الوقائي لإثبات كشفه
 *   5) **كل إقليم مشترط يعمل فعلًا**: الخطوة تمنح إذنًا لكل إقليم وتُنفّذ فعله وتتحقّق
 *      من مروره — «كل الأقاليم تعمل» تُقاس على الأربعة لا على واحد
 * حالات الفشل (كلها مغلقة): خطوة بلا ربط ⇒ رفض؛ ربط بلا إعلان ⇒ رفض؛ تجاوزٌ نفَذ ⇒
 *   فشل الخطوة؛ إقليم لم يمرّ ⇒ فشل الخطوة؛ مراقبة متوقفة ⇒ فشل الخطوة
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/runbooks/federated-operation.md و docs/runbooks/king-absence.md
 */
import { EntityId, SovereignViolation, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { RegionRegistry } from '../federation/region_registry';
import { GovernorRegistry } from '../federation/governor';
import { RoyalHeartbeat } from '../crown/royal_heartbeat';
import { KingIdentity } from '../identity/king_identity';
import { Runbook, RunbookStep } from '../staging/runbook_runner';
import { DeclaredRunbook, loadDeclaredRunbook } from '../staging/manifest';
import { RegionalPassage } from './regional_passage';
import { ContinuousSupervisor } from './continuous_supervisor';
import { resolveProductionDeployDir } from './production_manifest';

/** الفعل الذي تُجرّب به الأقاليم عملها — معلنٌ هنا كي يُقاس باسمه في التقرير */
export const FEDERATED_ACTION = 'تشغيل اتحادي: إجراء إداري مُعتمد';
/** الفعل الذي تُجرَّب به محاولة التجاوز — يختلف عن المُعتمد كي لا يستهلك إذنه */
export const BYPASS_ACTION = 'تشغيل اتحادي: محاولة إجراء بلا إذن';

export interface ProductionStepDeps {
  readonly audit: AppendOnlyLog;
  readonly regions: RegionRegistry;
  readonly governors: GovernorRegistry;
  readonly passage: RegionalPassage;
  readonly supervisor: ContinuousSupervisor;
  readonly heartbeat: RoyalHeartbeat;
  readonly king: KingIdentity;
  readonly operator: EntityId;
  readonly requiredRegions: readonly EntityId[];
  readonly modeAt: (at: number) => StateMode;
  /** زمنٌ بعيد يُقاس به غياب الملك قراءةً لا تغييرًا (ثابت 4) */
  readonly absenceProbeMs?: number;
}

type StepBinding = Pick<RunbookStep, 'act' | 'verify'>;

/** نطاق الإقليم المفوَّض الأول — الفعل يجب أن يكون داخل نطاق مفوَّض */
function domainOf(deps: ProductionStepDeps, regionId: EntityId): string {
  const region = deps.regions.get(regionId);
  const domain = region?.domains[0];
  if (!domain) {
    throw new SovereignViolation(
      `إقليم بلا نطاق مفوَّض: ${regionId} — لا فعل خارج تفويض معلن`,
      'PRODUCTION_STEP_REGION_UNDELEGATED',
    );
  }
  return domain;
}

/** ربوط الخطوات بالرقم لكل كتاب. المفتاح `<اسم الكتاب>#<رقم الخطوة>` (ثابت 1). */
function bindings(deps: ProductionStepDeps): ReadonlyMap<string, StepBinding> {
  const map = new Map<string, StepBinding>();

  // ── federated-operation ──────────────────────────────────────────────────
  map.set('federated-operation#1', {
    act: () => {
      deps.audit.append(deps.operator, 'production_precheck', { check: 'audit_chain' });
    },
    verify: () => deps.audit.verifyIntegrity().valid,
  });

  map.set('federated-operation#2', {
    act: () => {
      deps.audit.append(deps.operator, 'production_precheck', {
        check: 'regions', required: [...deps.requiredRegions],
      });
    },
    // ثابت 2: يقرأ السجلّين القائمين لا متغيّرًا
    verify: () => deps.requiredRegions.every((regionId) => (
      deps.regions.isActive(regionId)
      && deps.governors.governorOf(regionId) !== undefined
      && (deps.regions.get(regionId)?.domains.length ?? 0) > 0
    )),
  });

  // ثابت 3: محاولة تجاوز حقيقية تُرفض وتُقيَّد — دليل الإنفاذ لا دعواه
  map.set('federated-operation#3', {
    act: () => {
      const regionId = deps.requiredRegions[0];
      if (!regionId) {
        throw new SovereignViolation('لا أقاليم مشترطة', 'PRODUCTION_STEP_NO_REGIONS');
      }
      const seat = deps.governors.governorOf(regionId);
      if (!seat) throw new SovereignViolation('لا حاكم للإقليم الأول', 'PRODUCTION_STEP_NO_GOVERNOR');
      const result = deps.governors.act(seat.governor, {
        regionId, domain: domainOf(deps, regionId), action: BYPASS_ACTION,
      });
      if (result.ok) {
        throw new SovereignViolation(
          'فعل إقليمي نفُذ بلا إذن مرور — الإنفاذ غير قائم',
          'PRODUCTION_BYPASS_EXECUTED',
        );
      }
    },
    verify: () => deps.passage.blockedAttempts().some((b) => b.action === BYPASS_ACTION)
      && deps.audit.find('region_action_bypass_blocked').length > 0,
  });

  // ثابت 5: كل إقليم مشترط يُستأذن له ويعمل
  map.set('federated-operation#4', {
    act: () => {
      for (const regionId of deps.requiredRegions) {
        const seat = deps.governors.governorOf(regionId);
        if (!seat) throw new SovereignViolation(`لا حاكم للإقليم: ${regionId}`, 'PRODUCTION_STEP_NO_GOVERNOR');
        const domain = domainOf(deps, regionId);
        const command = deps.king.issueCommand('approve_phase', regionId, {
          domain, action: FEDERATED_ACTION, kind: 'federated_passage',
        });
        const granted = deps.passage.grant(command, { regionId, domain, action: FEDERATED_ACTION });
        if (!granted.ok) {
          throw new SovereignViolation(
            `إذن المرور لم يُمنح لـ${regionId}: ${granted.reason}`,
            'PRODUCTION_PASSAGE_NOT_GRANTED',
          );
        }
        const acted = deps.governors.act(seat.governor, { regionId, domain, action: FEDERATED_ACTION });
        if (!acted.ok) {
          throw new SovereignViolation(
            `الفعل الإقليمي لم ينفُذ في ${regionId}: ${acted.reason}`,
            'PRODUCTION_REGION_ACTION_REFUSED',
          );
        }
      }
    },
    // ثابت 2: يقرأ السجل — لكل إقليم مشترط فعلٌ نفُذ وإذنٌ استُوفي
    verify: () => {
      const passed = deps.audit.find('region_action_passed');
      const executed = deps.audit.find('region_action_executed');
      return deps.requiredRegions.every((regionId) => (
        passed.some((e) => (e.detail as { regionId?: string }).regionId === regionId)
        && executed.some((e) => (e.detail as { regionId?: string }).regionId === regionId)
      ));
    },
  });

  map.set('federated-operation#5', {
    act: () => {
      deps.audit.append(deps.operator, 'production_precheck', {
        check: 'supervision', running: deps.supervisor.running,
      });
    },
    verify: () => deps.supervisor.running && deps.supervisor.report().sweeps >= 1,
  });

  // ── king-absence ─────────────────────────────────────────────────────────
  map.set('king-absence#1', {
    act: () => {
      deps.heartbeat.beat(deps.king.kingId);
      deps.audit.append(deps.operator, 'production_precheck', { check: 'heartbeat_present' });
    },
    verify: () => deps.heartbeat.isPresent() && deps.modeAt(Date.now()) === 'normal',
  });

  // ثابت 4: يُقاس الكشف بقراءة زمنٍ مستقبلي، ولا يُدخل الوضع الوقائي لإثبات كشفه
  map.set('king-absence#2', {
    act: () => {
      deps.audit.append(deps.operator, 'production_precheck', {
        check: 'king_absence_detectable',
        probeMs: deps.absenceProbeMs ?? 24 * 60 * 60 * 1000,
      });
    },
    verify: () => deps.heartbeat.mode(
      Date.now() + (deps.absenceProbeMs ?? 24 * 60 * 60 * 1000),
    ) === 'protective',
  });

  map.set('king-absence#3', {
    act: () => { deps.heartbeat.beat(deps.king.kingId); },
    verify: () => deps.modeAt(Date.now()) === 'normal' && deps.heartbeat.isPresent(),
  });

  return map;
}

/** يبني كتابًا من إعلانه — خطوةٌ بلا ربط أو ربطٌ بلا إعلان يُرفضان (ثابت 1) */
export function buildProductionRunbook(declared: DeclaredRunbook, deps: ProductionStepDeps): Runbook {
  const bound = bindings(deps);
  const steps: RunbookStep[] = declared.steps.map((step) => {
    const key = `${declared.name}#${step.n}`;
    const binding = bound.get(key);
    if (!binding) {
      throw new SovereignViolation(
        `خطوة معلنة بلا ربط تنفيذي: ${key} — «افعل» بلا فعل`,
        'PRODUCTION_RUNBOOK_STEP_UNBOUND',
      );
    }
    return { n: step.n, title: step.title, act: binding.act, verify: binding.verify };
  });
  for (const key of bound.keys()) {
    if (!key.startsWith(`${declared.name}#`)) continue;
    const n = Number(key.split('#')[1]);
    if (!declared.steps.some((s) => s.n === n)) {
      throw new SovereignViolation(
        `ربط تنفيذي بلا إعلان: ${key} — تنفيذٌ لا يعلمه الإعلان`,
        'PRODUCTION_RUNBOOK_STEP_UNDECLARED',
      );
    }
  }
  return { name: declared.name, purpose: declared.purpose, steps };
}

/** يبني كل كتب سياسة التشغيل الاتحادي من إعلاناتها */
export function buildDeclaredProductionRunbooks(
  names: readonly string[],
  deps: ProductionStepDeps,
  deployDir = resolveProductionDeployDir(),
): readonly Runbook[] {
  return names.map((name) => buildProductionRunbook(loadDeclaredRunbook(name, deployDir), deps));
}
