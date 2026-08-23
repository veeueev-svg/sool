/**
 * tests/production/helpers.ts — مهاد اختبارات التشغيل الاتحادي (المرحلة 37)
 * المالك: ديوان التدقيق
 * المدخلات: دولة مهيأة + `config/production.yaml` + `deploy/production/`
 * المخرجات: اتحادٌ كامل (أربعة أقاليم مفوَّضة بحكّام) + تشغيلة اتحادية بمسارها المعلن
 * التبعيات: bootstrapState + FederatedOperation + buildDeclaredProductionRunbooks
 * الصلاحيات: القياس فقط. المهاد لا يخترع رفضًا ولا يُصلح خرقًا أثناء قياسه
 * السجلات: تصدرها الوحدات المختبَرة | حالات الفشل: الحدود تُصغَّر في نسخة سياسة لا في التهيئة
 * اختبار القبول: tests/production/production_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 * ثوابت هذا المهاد:
 *   1) **المهاد يمرّ بالمسار المعلن**: التشغيل يُفتح بـ`FederatedOperation` كما يُفتح في
 *      الدولة، ولا تُنادى وحداته ترتيبًا يدويًّا إلّا حين المقيس هو الوحدة وحدها.
 *   2) **الزمن حقيقي في القبول**: اختبار القبول ينتظر مسحات فعلًا ولا يُمرّر زمنًا موهومًا.
 *   3) **الرفض يُقرأ برمزه**: لا تأكيد على نص عربي مشكول — الرمز هو العقد.
 *   4) **الأقاليم والحكّام يُقامون بمسارهم السيادي**: أمرٌ ملكي بنيوي للتأسيس والتفويض،
 *      وسلسلة اقتراح/اعتماد/تنفيذ للحاكم — فلا اتحاد يُخترع في المهاد.
 *   5) **المرور هو المربوط بسجل الحكّام**: يستعمل المهاد `state.passage` نفسه، فما يمنعه
 *      المهاد يمنعه التاج، ولا يُقاس منعٌ في نسخة لا تعمل في الدولة.
 *   6) **النقطة المكتوبة تُعزَل**: كل مهاد يكتب نقطة تفتيشه في مجلد مؤقّت خاص به، فلا
 *      تتسرّب فجوةٌ من تشغيلة إلى تشغيلة أخرى في المستودع نفسه.
 */
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  bootstrapState, DigitalState, ProductionConfig, ProductionLedger, RegionalPassage, Runbook,
  RunbookRunner, ContinuousSupervisor, FederatedOperation, WatchProbe, ScannerKind,
  CheckpointStore, resolveCheckpointPath, buildDeclaredProductionRunbooks,
  buildProductionScanners, buildWatchProbes, loadProduction, resolveProductionDeployDir,
  GOVERNOR_EXECUTOR, GOVERNOR_PROPOSER, ROYAL_COURT,
  PRODUCTION_KNOWN_RUNBOOKS, PRODUCTION_OPERATORS,
} from '../../src/index';

/** المشغّل المعلن في `deploy/production/manifest.yaml` */
export const OPERATOR = 'authority:royal_court';
/** المراقب المعلن في `config/production.yaml` */
export const OBSERVER = 'authority:audit_bureau';

/** الأقاليم المشترطة ونطاق كل واحد — تطابق `config/regions.yaml` و`production.yaml` */
export const FEDERATION: readonly [string, string, string][] = [
  ['region:core', 'إقليم النواة', 'infrastructure'],
  ['region:research', 'إقليم البحث', 'research'],
  ['region:industry', 'إقليم الصناعة', 'manufacturing'],
  ['region:services', 'إقليم الخدمات', 'services'],
];

export interface ProductionHarness {
  readonly state: DigitalState;
  readonly policy: ProductionConfig['policy'];
  readonly passage: RegionalPassage;
  readonly supervisor: ContinuousSupervisor;
  readonly ledger: ProductionLedger;
  readonly runner: RunbookRunner;
  readonly operation: FederatedOperation;
  readonly books: readonly Runbook[];
  readonly checkpointDir: string;
  /** إيقاف كل ما يُبقي العملية حيّة + حذف مجلد النقطة */
  readonly dispose: (now?: number) => void;
}

/** يُقيم الاتحاد على دولة قائمة: أربعة أقاليم مفوَّضة، ولكلٍّ حاكم جالس (ثابت 4) */
export function establishFederation(state: DigitalState, now: number): void {
  const structural = (target: string) =>
    state.king.issueCommand('amend_policy', target, { kind: 'federation' }, now);
  for (const [regionId, name, domain] of FEDERATION) {
    const established = state.regions.establish(
      structural(regionId), { regionId, name, proposedBy: ROYAL_COURT }, now,
    );
    assert.equal(established.ok, true, `تأسيس ${regionId}`);
    const delegated = state.regions.delegate(structural(regionId), regionId, [domain], now);
    assert.equal(delegated.ok, true, `تفويض ${regionId}`);
    const candidate = `official:${regionId.split(':')[1]}`;
    const nominationId = `nom:${regionId}`;
    state.governors.propose(GOVERNOR_PROPOSER, {
      nominationId, kind: 'appointment', regionId, candidate, reason: 'كفاءة موثّقة',
    }, now);
    state.governors.approve(
      state.king.issueCommand('appoint_official', candidate, {}, now), nominationId, now,
    );
    assert.equal(
      state.governors.execute(GOVERNOR_EXECUTOR, nominationId, now).ok, true, `تنصيب حاكم ${regionId}`,
    );
  }
}

/**
 * مهاد تشغيل اتحادي كامل. المرور هو مرور الدولة المربوط بسجل الحكّام (ثابت 5)،
 * والمراقبة تُبنى على ماسحات الدولة نفسها بنقطة تفتيش معزولة (ثابت 6).
 */
export function productionHarness(options: {
  readonly now?: number;
  readonly policy?: Partial<ProductionConfig['policy']>;
  readonly probes?: ReadonlyMap<ScannerKind, WatchProbe>;
  readonly federate?: boolean;
} = {}): ProductionHarness {
  const now = options.now ?? Date.now();
  // T-120: لا تشغيل اتحاديٌّ على حالةٍ تموت مع العمليّة. المهاد يُقيم يوميّةً دائمة في
  // مجلد مؤقّت معزول، لأن ماسح الثبات صار مشترطًا وحادثه حرجٌ يوقف الدولة بحق.
  const stateDir = mkdtempSync(join(tmpdir(), 'sool-production-state-'));
  const state = bootstrapState({ now, persistenceDir: stateDir });
  const checkpointDir = mkdtempSync(join(tmpdir(), 'sool-production-'));
  const policy = {
    ...state.productionConfig.policy,
    ...(options.policy ?? {}),
    supervision: {
      ...state.productionConfig.policy.supervision,
      ...(options.policy?.supervision ?? {}),
      checkpoint_directory: checkpointDir,
    },
  };
  if (options.federate !== false) establishFederation(state, now);

  const passage = state.passage;
  const probes = options.probes ?? buildProductionScanners(
    {
      audit: state.audit, loads: state.loadLedger, unit: state.unit, factories: state.factories,
      hospitals: state.hospitals, retention: state.retention, passage,
      policy, retentionAuthority: OBSERVER,
      // T-120: مساعدات التشغيل تُمرّر اليوميّة إن وُجدت في الدولة المُقامة؛ ودولةٌ
      // أُقيمت بلا مجلد ثبات يرفع ماسحُ الثبات حادثها بحق لا بخطأ اختبار.
      durable: state.journal,
    },
    buildWatchProbes({
      audit: state.audit, regionMonitor: state.regionMonitor, scope: state.operationScope,
      terminationRoll: state.terminationRoll, permissions: state.permissions,
      modeAt: (at) => (state.killSwitch.status.engaged ? 'halted' : state.heartbeat.evaluate(at)),
    }),
  );
  const supervisor = new ContinuousSupervisor({
    audit: state.audit, killSwitch: state.killSwitch, policy,
    observer: policy.observer_authority, probes, bootAt: now,
    checkpoint: new CheckpointStore(resolveCheckpointPath(checkpointDir)),
  });
  const ledger = new ProductionLedger({
    audit: state.audit, policy,
    chainValid: () => state.audit.verifyIntegrity().valid,
    stateHalted: () => state.killSwitch.status.engaged,
  });
  const runner = new RunbookRunner({
    audit: state.audit, policy, known: PRODUCTION_KNOWN_RUNBOOKS, operators: PRODUCTION_OPERATORS,
  });
  const operation = new FederatedOperation({
    audit: state.audit, policy, passage, supervisor, runner, ledger,
    regions: state.regions, governors: state.governors, regionMonitor: state.regionMonitor,
    bootAt: now,
  });
  const books = buildDeclaredProductionRunbooks(policy.runbooks, {
    audit: state.audit, regions: state.regions, governors: state.governors, passage, supervisor,
    heartbeat: state.heartbeat, king: state.king, operator: OPERATOR,
    requiredRegions: policy.regions.required,
    modeAt: (at) => (state.killSwitch.status.engaged ? 'halted' : state.heartbeat.evaluate(at)),
  }, resolveProductionDeployDir());

  const dispose = (at = Date.now()): void => {
    supervisor.stop(OPERATOR, 'انتهى القياس', at);
    rmSync(checkpointDir, { recursive: true, force: true });
    // اليوميّة تُغلق ثم يُحذف مجلدها: واصفٌ مفتوح يُبقي العملية والملف معًا (ثابت 6).
    state.journal?.close();
    rmSync(stateDir, { recursive: true, force: true });
  };
  return {
    state, policy, passage, supervisor, ledger, runner, operation, books, checkpointDir, dispose,
  };
}

/** ماسح صوري معلن الأثر — يُستعمل حين المقيس هو المراقبة لا الوحدة الممسوحة */
export function fakeProbe(findings: readonly { kind: string; detail: string }[]): WatchProbe {
  return () => findings.map((f) => ({ kind: f.kind as never, detail: f.detail }));
}

export function throwingProbe(message = 'انهار الماسح'): WatchProbe {
  return () => { throw new Error(message); };
}

/** ماسحات كاملة بماسحة واحدة مُبدَلة — كي لا يسقط المراقب على ماسح معلن بلا ماسحة */
export function probesWith(
  base: ReadonlyMap<ScannerKind, WatchProbe>,
  overrides: Readonly<Record<string, WatchProbe>>,
): ReadonlyMap<ScannerKind, WatchProbe> {
  const map = new Map<ScannerKind, WatchProbe>(base);
  for (const [kind, probe] of Object.entries(overrides)) map.set(kind as ScannerKind, probe);
  return map;
}

/** ماسحات صامتة لكل ماسح معلن — أساسٌ تُبنى عليه القياسات المعزولة */
export function silentProbes(policy: ProductionConfig['policy']): ReadonlyMap<ScannerKind, WatchProbe> {
  const map = new Map<ScannerKind, WatchProbe>();
  for (const scanner of policy.scanners) map.set(scanner, () => []);
  return map;
}

export function countEvent(state: DigitalState, kind: string): number {
  return state.audit.find(kind).length;
}

export function lastDetail(state: DigitalState, kind: string): Record<string, unknown> {
  const entries = state.audit.find(kind);
  return (entries.at(-1)?.detail ?? {}) as Record<string, unknown>;
}

/** نسخة من مجلد التهيئة تُعدَّل فيها `production.yaml` وحدها */
export function withConfigCopy(run: (configDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'sool-prod-config-'));
  const dir = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
  try { run(dir); } finally { rmSync(root, { recursive: true, force: true }); }
}

/** يقرأ سياسة المستودع الفعلية — المصدر الذي يُقاس عليه */
export function repoPolicy(): ProductionConfig['policy'] {
  return loadProduction().policy;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
