/**
 * src/staging/runbook_steps.ts — ربط الخطوات المعلنة بأفعالها وتحقّقها (المرحلة 36)
 * المالك: الديوان الملكي ينفّذ — والربط يُرفض إن خالف الإعلان (RULE-005)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: كتاب معلن من `deploy/staging/runbooks/*.yaml` + وحدات الدولة الحقيقية
 * المخرجات: كتاب قابل للتنفيذ: لكل خطوة معلنة فعلٌ حقيقي وتحقّقٌ يقرأ حال الدولة
 * التبعيات: السجل، سجل الإنهاء، سجل الصلاحيات، حرس الأقاليم، النبض، مفتاح الإيقاف
 * الصلاحيات: التنفيذ بحدود الخطوة المعلنة؛ ولا يمنح صلاحية ولا يعتمد أمرًا سياديًّا
 * السجلات: staging_precheck — والمنفّذ هو من يُقيّد نجاح الخطوة وفشلها
 * ثوابت هذه الوحدة:
 *   1) **الإعلان يقود التنفيذ لا العكس**: تُقرأ الخطوات من الملف ثم يُبحث لكل رقم عن
 *      ربطٍ في الكود — لا تُبنى قائمة في الكود ثم يُقال إنها الموصوفة
 *   2) **خطوة معلنة بلا ربط رفض**: `RUNBOOK_STEP_UNBOUND` — كي لا يمرّ كتابٌ ناقص
 *   3) **ربطٌ بلا إعلان رفض**: `RUNBOOK_STEP_UNDECLARED` — كي لا يُنفَّذ ما لم يُعلن
 *   4) **التحقّق يقرأ الدولة لا الدعوى**: لا يُتحقَّق بمتغيّر داخلي كتبه الفعل نفسه، بل
 *      بقراءة الوحدة القائمة — وإلّا كان التحقّق شهادةَ الفعل لنفسه
 *   5) **الأفعال هنا تُصلح ما يُصلَح قبل النافذة لا أثناءها**: كي تُقاس النافذة على حال
 *      معلوم، ويكون كل حادث يظهر فيها حادثًا جديدًا لا موروثًا
 * حالات الفشل (كلها مغلقة): خطوة معلنة بلا ربط ⇒ رفض؛ ربط بلا إعلان ⇒ رفض؛ فعل يرمي
 *   أو تحقّق يرجع سلبًا ⇒ فشل الخطوة وقطع الكتاب في المنفّذ
 * اختبار القبول: tests/staging/runbook_runner.test.ts
 * الوثيقة المرتبطة: docs/runbooks/limited-operation.md
 */
import { EntityId, SovereignViolation, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { TerminationRoll } from '../kernel/termination_roll';
import { PermissionRegistry } from '../agents/permissions';
import { RegionMonitor } from '../federation/region_monitor';
import { GOVERNOR_EXECUTOR } from '../federation/governor';
import { RoyalHeartbeat } from '../crown/royal_heartbeat';
import { Runbook, RunbookStep } from './runbook_runner';
import { OperationScope } from './operation_scope';
import { DeclaredRunbook, loadDeclaredRunbook, resolveDeployDir } from './manifest';

export interface RunbookStepDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly terminationRoll: TerminationRoll;
  readonly permissions: PermissionRegistry;
  readonly regionMonitor: RegionMonitor;
  readonly heartbeat: RoyalHeartbeat;
  readonly scope: OperationScope;
  readonly kingId: EntityId;
  readonly operator: EntityId;
  readonly modeAt: (at: number) => StateMode;
}

type StepBinding = Pick<RunbookStep, 'act' | 'verify'>;

/** ربوط الخطوات بالرقم لكل كتاب. المفتاح `<اسم الكتاب>#<رقم الخطوة>` (ثابت 1). */
function bindings(deps: RunbookStepDeps): ReadonlyMap<string, StepBinding> {
  const map = new Map<string, StepBinding>();

  // limited-operation
  map.set('limited-operation#1', {
    act: () => { deps.audit.append(deps.operator, 'staging_precheck', { check: 'audit_chain' }); },
    verify: () => deps.audit.verifyIntegrity().valid,
  });
  map.set('limited-operation#2', {
    // ثابت 5: يُصلح قبل النافذة — الإنهاء الذي لا يُسقط الصلاحية إعلانٌ لا إنهاء
    act: () => {
      for (const record of deps.terminationRoll.list()) {
        if (deps.permissions.granted(record.entity).length > 0) {
          deps.permissions.revokeAll(record.entity, deps.operator, 'تشغيل محدود: كائن منتهٍ لا يحمل صلاحية');
        }
      }
    },
    // ثابت 4: يقرأ سجل الصلاحيات لا متغيّرًا كتبه الفعل
    verify: () => deps.terminationRoll.list()
      .every((r) => deps.permissions.granted(r.entity).length === 0),
  });
  map.set('limited-operation#3', {
    act: () => {
      deps.audit.append(deps.operator, 'staging_precheck', { check: 'mode', mode: deps.modeAt(Date.now()) });
    },
    verify: () => deps.modeAt(Date.now()) === 'normal'
      && deps.audit.find('staging_precheck').some((e) => (e.detail as { check?: string }).check === 'mode'),
  });

  // incident-response
  map.set('incident-response#1', {
    act: () => {
      deps.regionMonitor.sweep(Date.now());
      for (const flag of deps.regionMonitor.outstanding()) {
        deps.regionMonitor.contain(
          GOVERNOR_EXECUTOR, flag.regionId, flag.kind,
          'تشغيل محدود: احتواء راية قائمة قبل النافذة', Date.now(),
        );
      }
    },
    verify: () => deps.regionMonitor.outstanding().length === 0,
  });
  map.set('incident-response#2', {
    act: () => { deps.audit.append(deps.operator, 'staging_precheck', { check: 'scope_clean' }); },
    verify: () => deps.scope.violations().length === 0,
  });

  // halt-and-recover
  map.set('halt-and-recover#1', {
    act: () => {
      deps.audit.append(deps.operator, 'staging_precheck', {
        check: 'kill_switch', engaged: deps.killSwitch.status.engaged,
      });
    },
    verify: () => deps.killSwitch.status.engaged === false,
  });
  map.set('halt-and-recover#2', {
    act: () => { deps.heartbeat.beat(deps.kingId, Date.now()); },
    verify: () => deps.modeAt(Date.now()) === 'normal',
  });

  return map;
}

/** يبني كتابًا قابلًا للتنفيذ من إعلانه. ثوابت 1 و2 و3. */
export function buildRunbook(
  declared: DeclaredRunbook, deps: RunbookStepDeps,
): Runbook {
  const bound = bindings(deps);
  const steps: RunbookStep[] = declared.steps.map((step) => {
    const key = `${declared.name}#${step.n}`;
    const binding = bound.get(key);
    if (!binding) {
      throw new SovereignViolation(
        `خطوة معلنة بلا ربط تنفيذي: ${key} — «افعل» بلا فعل`, 'RUNBOOK_STEP_UNBOUND',
      );
    }
    return { n: step.n, title: step.title, act: binding.act, verify: binding.verify };
  });
  for (const key of bound.keys()) {
    if (!key.startsWith(`${declared.name}#`)) continue;
    const n = Number(key.split('#')[1]);
    if (!declared.steps.some((s) => s.n === n)) {
      throw new SovereignViolation(
        `ربط تنفيذي بلا إعلان: ${key} — تنفيذٌ لا يعلمه الإعلان`, 'RUNBOOK_STEP_UNDECLARED',
      );
    }
  }
  return { name: declared.name, purpose: declared.purpose, steps };
}

/** يبني كل كتب التهيئة من إعلاناتها — الترتيب ترتيب الإعلان في السياسة */
export function buildDeclaredRunbooks(
  names: readonly string[], deps: RunbookStepDeps, deployDir = resolveDeployDir(),
): readonly Runbook[] {
  return names.map((name) => buildRunbook(loadDeclaredRunbook(name, deployDir), deps));
}
