/**
 * tests/staging/helpers.ts — مهاد اختبارات التشغيل المحدود (المرحلة 36)
 * المالك: ديوان التدقيق
 * المدخلات: دولة مهيأة + `config/staging.yaml` + `deploy/staging/`
 * المخرجات: مهاد نافذة (نطاق + مراقب + منفّذ كتب + دفتر + تشغيلة) بمسار الدولة المعلن
 * التبعيات: bootstrapState + StagingRun + buildDeclaredRunbooks
 * الصلاحيات: القياس فقط. المهاد لا يخترع رفضًا ولا يُصلح خرقًا أثناء قياسه
 * السجلات: تصدرها الوحدات المختبَرة | حالات الفشل: تصغير الحدود في نسخة السياسة لا في التهيئة
 * اختبار القبول: tests/staging/staging_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0020-limited-operation.md
 * ثوابت هذا المهاد:
 *   1) **المهاد يمرّ بالمسار المعلن**: النافذة تُفتح بـ`StagingRun` كما تُفتح في التشغيل،
 *      ولا تُنادى وحداتها ترتيبًا يدويًّا في الاختبار إلّا حين يكون المقيس هو الوحدة وحدها.
 *   2) **الزمن حقيقي في القبول**: اختبار القبول ينتظر النافذة فعلًا، ولا يُمرّر زمنًا موهومًا.
 *   3) **الرفض يُقرأ برمزه**: لا تأكيد على نص عربي مشكول — الرمز هو العقد.
 *   4) **المراقب من التهيئة لا من الاختبار**: ولا يُمرّر الاختبار مراقبًا يخالفها.
 *   5) **النطاق هو المربوط بالبوابة**: يستعمل المهاد `state.operationScope` نفسه، فما
 *      يمنعه المهاد يمنعه التاج، ولا يُقاس منعٌ في نسخة لا تعمل في الدولة.
 */
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapState, DigitalState, IncidentMonitor, OperationScope, Runbook, RunbookRunner,
  StagingConfig, StagingLedger, StagingRun, WatchProbe, WatchKind,
  buildDeclaredRunbooks, buildWatchProbes, loadStaging, resolveDeployDir,
} from '../../src/index';

export const T0 = Date.now();
/** المشغّل المعلن في `deploy/staging/manifest.yaml` */
export const OPERATOR = 'authority:royal_court';
/** المراقب المعلن في `config/staging.yaml` */
export const OBSERVER = 'authority:audit_bureau';

export interface StagingHarness {
  readonly state: DigitalState;
  readonly policy: StagingConfig['policy'];
  readonly scope: OperationScope;
  readonly monitor: IncidentMonitor;
  readonly runner: RunbookRunner;
  readonly ledger: StagingLedger;
  readonly run: StagingRun;
  readonly books: readonly Runbook[];
}

/**
 * مهاد نافذة كامل على دولة مهيأة. الوحدات المبنية في التأسيس هي المستعملة،
 * فلا يقيس الاختبار نسخة موازية لا تعمل في الدولة.
 */
export function stagingHarness(options: {
  readonly now?: number;
  readonly policy?: Partial<StagingConfig['policy']>;
} = {}): StagingHarness {
  const now = options.now ?? Date.now();
  const state = bootstrapState({ now });
  const policy = { ...state.stagingConfig.policy, ...(options.policy ?? {}) };
  // ثابت 5: النطاق هو نطاق الدولة المربوط ببوابة التاج في التأسيس — لا نسخة موازية،
  // وإلّا قِيس منعٌ لا يقع عند البوابة الحقيقية.
  const scope = state.operationScope;
  const monitor = new IncidentMonitor({
    audit: state.audit, killSwitch: state.killSwitch, policy,
    observer: policy.observer_authority,
    probes: buildWatchProbes({
      audit: state.audit, regionMonitor: state.regionMonitor, scope,
      terminationRoll: state.terminationRoll, permissions: state.permissions,
      modeAt: (at) => (state.killSwitch.status.engaged ? 'halted' : state.heartbeat.evaluate(at)),
    }),
  });
  const runner = new RunbookRunner({ audit: state.audit, policy });
  const ledger = new StagingLedger({
    audit: state.audit, policy,
    chainValid: () => state.audit.verifyIntegrity().valid,
    stateHalted: () => state.killSwitch.status.engaged,
  });
  const books = buildDeclaredRunbooks(policy.runbooks, {
    audit: state.audit, killSwitch: state.killSwitch, terminationRoll: state.terminationRoll,
    permissions: state.permissions, regionMonitor: state.regionMonitor,
    heartbeat: state.heartbeat, scope, kingId: state.king.kingId, operator: OPERATOR,
    modeAt: (at) => (state.killSwitch.status.engaged ? 'halted' : state.heartbeat.evaluate(at)),
  }, resolveDeployDir());
  const run = new StagingRun({
    audit: state.audit, policy, scope, monitor, runner, ledger,
    mode: () => state.mode(),
    halted: () => state.killSwitch.status.engaged,
    livingAgents: () => state.agents.population,
  });
  return { state, policy, scope, monitor, runner, ledger, run, books };
}

/** مراقب بماسحات مُمرَّرة — لقياس سلوك المراقب وحده بمعزل عن وحدات الدولة */
export function monitorWith(
  state: DigitalState,
  probes: ReadonlyMap<WatchKind, WatchProbe>,
  policy: Partial<StagingConfig['policy']> = {},
): IncidentMonitor {
  const merged = { ...state.stagingConfig.policy, ...policy };
  return new IncidentMonitor({
    audit: state.audit, killSwitch: state.killSwitch, policy: merged,
    observer: merged.observer_authority, probes,
  });
}

/** ماسح صوري معلن الأثر — يُستعمل حين المقيس هو المراقب لا الوحدة الممسوحة */
export function fakeProbe(findings: readonly { kind: string; detail: string }[]): WatchProbe {
  return () => findings.map((f) => ({ kind: f.kind as never, detail: f.detail }));
}

export function throwingProbe(message = 'انهار الماسح'): WatchProbe {
  return () => { throw new Error(message); };
}

export function countEvent(state: DigitalState, kind: string): number {
  return state.audit.find(kind).length;
}

export function lastDetail(state: DigitalState, kind: string): Record<string, unknown> {
  const entries = state.audit.find(kind);
  return (entries.at(-1)?.detail ?? {}) as Record<string, unknown>;
}

/** نسخة من مجلد التهيئة تُعدَّل فيها `staging.yaml` وحدها */
export function withConfigCopy(run: (configDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-staging-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** يقرأ سياسة المستودع الفعلية — المصدر الذي يُقاس عليه */
export function repoPolicy(): StagingConfig['policy'] {
  return loadStaging().policy;
}
