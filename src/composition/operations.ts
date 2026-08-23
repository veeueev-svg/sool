/**
 * src/composition/operations.ts — التشغيل — النطاق المحدود والتشغيل الاتحادي ومرور التاج والمراقبة المستمرة
 * المالك: القيّم على المستودع | المراحل: 36–37
 * المدخلات: مخرجات ما قبلها و`configDir` و`now`
 * المخرجات: بيان النشر والنطاق ومراقب الحوادث ومُنفِّذ الكتب ودفاتر الحكم ومرور التاج والمراقبة المستمرة
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import type { PopulationParts } from './population';
import type { EconomyParts } from './economy';
import type { EnterpriseParts } from './enterprises';
import type { InstitutionParts } from './institutions';
import type { ResilienceParts } from './resilience';
import {
  loadStaging, loadProduction, PRODUCTION_KNOWN_RUNBOOKS, PRODUCTION_OPERATORS,
} from '../kernel/config';
import { OperationScope } from '../staging/operation_scope';
import { IncidentMonitor } from '../staging/incident_monitor';
import { RunbookRunner } from '../staging/runbook_runner';
import { StagingLedger } from '../staging/staging_ledger';
import { buildWatchProbes } from '../staging/watch_probes';
import { loadStagingManifest, resolveDeployDir } from '../staging/manifest';
import { CheckpointStore, resolveCheckpointPath } from '../production/supervision_checkpoint';
import { RegionalPassage } from '../production/regional_passage';
import { buildProductionScanners } from '../production/production_scanners';
import { ContinuousSupervisor } from '../production/continuous_supervisor';
import { ProductionLedger } from '../production/production_ledger';
import {
  loadProductionManifest, resolveProductionDeployDir,
} from '../production/production_manifest';
import { FederatedOperation } from '../production/federated_operation';

export function composeOperations(
  parts: SovereigntyParts & PopulationParts & EconomyParts & EnterpriseParts
    & InstitutionParts & ResilienceParts,
  configDir: string, now: number,
) {
  const {
    audit, gateway, killSwitch, heartbeat, terminationRoll, permissions,
    unit, factories, hospitals, retention, regions, governors, regionMonitor, loadLedger,
    journal,
  } = parts;

  // 1) التشغيل المحدود (المرحلة 36) — نطاق مُنفَّذ عند البوابة، ومراقب بمؤقّت حقيقي،
  //     ودفتر يحكم على النافذة. البيان يُقرأ ويُقابَل بالتهيئة فيسقط الإقلاع على تعارضهما.
  //     النطاق يُربط بالبوابة وهو **مغلق**: دولةٌ لم تُفتح لها نافذة تعمل كما كانت.
  //     المراقب لا يبدأ هنا: من يبدأ المؤقّت هو من يفتح النافذة، لا من يُقلع الدولة.
  const stagingConfig = loadStaging(configDir);
  const stagingManifest = loadStagingManifest(stagingConfig, resolveDeployDir());
  const operationScope = new OperationScope({ audit, policy: stagingConfig.policy });
  gateway.bindScope(operationScope);
  const incidentMonitor = new IncidentMonitor({
    audit, killSwitch, policy: stagingConfig.policy,
    observer: stagingConfig.policy.observer_authority,
    probes: buildWatchProbes({
      audit, regionMonitor, scope: operationScope, terminationRoll, permissions,
      modeAt: (at) => (killSwitch.status.engaged ? 'halted' : heartbeat.evaluate(at)),
    }),
  });
  const runbookRunner = new RunbookRunner({ audit, policy: stagingConfig.policy });
  const stagingLedger = new StagingLedger({
    audit, policy: stagingConfig.policy,
    chainValid: () => audit.verifyIntegrity().valid,
    stateHalted: () => killSwitch.status.engaged,
  });
  // 2) التشغيل الاتحادي (المرحلة 37) — مرور التاج يُربط بسجل الحكّام وهو **مغلق**،
  //     فدولةٌ لم يُفتح لها تشغيل اتحادي تعمل كما كانت (كما فُعل بالنطاق في 36).
  //     المراقبة المستمرة تُبنى ولا تبدأ هنا: من يبدأ المؤقّت هو من يفتح التشغيل.
  //     تأخّر أول مسحة عن مهلة الإقلاع يُقاس في الشهادة خرقًا معلنًا لا يُغتفر صامتًا.
  const productionConfig = loadProduction(configDir);
  const productionManifest = loadProductionManifest(productionConfig, resolveProductionDeployDir());
  const passage = new RegionalPassage({ audit, gateway, policy: productionConfig.policy });
  governors.bindPassage(passage);
  const productionScanners = buildProductionScanners(
    {
      audit, loads: loadLedger, unit, factories, hospitals, retention, passage,
      policy: productionConfig.policy, retentionAuthority: 'authority:audit_bureau',
      // T-120: الثباتُ يُمرَّر شاهدًا لا يُفترض. غيابه (`null`) يُقاس خرقًا في كل
      // مسحة بدلًا من أن يمرّ بلا رقم: ما لا يُقاس لا يُسدّ (RULE-009).
      durable: journal,
    },
    buildWatchProbes({
      audit, regionMonitor, scope: operationScope, terminationRoll, permissions,
      modeAt: (at) => (killSwitch.status.engaged ? 'halted' : heartbeat.evaluate(at)),
    }),
  );
  const continuousSupervisor = new ContinuousSupervisor({
    audit, killSwitch, policy: productionConfig.policy,
    observer: productionConfig.policy.observer_authority,
    probes: productionScanners,
    bootAt: now,
    checkpoint: new CheckpointStore(
      resolveCheckpointPath(productionConfig.policy.supervision.checkpoint_directory),
    ),
  });
  const productionLedger = new ProductionLedger({
    audit, policy: productionConfig.policy,
    chainValid: () => audit.verifyIntegrity().valid,
    stateHalted: () => killSwitch.status.engaged,
  });
  const federatedOperation = new FederatedOperation({
    audit, policy: productionConfig.policy, passage, supervisor: continuousSupervisor,
    runner: new RunbookRunner({
      audit, policy: productionConfig.policy,
      known: PRODUCTION_KNOWN_RUNBOOKS, operators: PRODUCTION_OPERATORS,
    }),
    ledger: productionLedger, regions, governors, regionMonitor, bootAt: now,
  });

  return {
    stagingConfig, stagingManifest, operationScope, incidentMonitor, runbookRunner,
    stagingLedger,
    productionConfig, productionManifest, passage, continuousSupervisor, productionLedger,
    federatedOperation,
  };
}

/** ما تُخرجه طبقة التشغيل */
export type OperationParts = ReturnType<typeof composeOperations>;
