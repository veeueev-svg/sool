/**
 * src/composition/resilience.ts — الصلابة — التعافي والأرشيف وتمارين الضغط والانقطاع ودفتر الإنهاء
 * المالك: القيّم على المستودع | المراحل: 32–35
 * المدخلات: مخرجات ما قبلها و`configDir`
 * المخرجات: الاستمرارية واللقطات والأرشيف والنسخ والاستعادة ودفاتر الحمل والقطع والإنهاء
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import type { PopulationParts } from './population';
import type { EconomyParts } from './economy';
import type { ScaleParts } from './scale';
import type { InstitutionParts } from './institutions';
import { loadLoad, loadChaos, loadTermination } from '../kernel/config';
import { RoyalArchive } from '../data/royal_archive';
import { ContinuityController } from '../recovery/continuity';
import { RecoverySnapshotStore, RecoveryStateParticipant } from '../recovery/snapshot';
import { BackupScheduler } from '../recovery/backup_scheduler';
import { RestoreRunner } from '../recovery/restore_runner';
import { LoadLedger } from '../load/load_ledger';
import { LoadDrill } from '../load/load_drill';
import { FaultInjector } from '../chaos/fault_injector';
import { SafeStopLedger } from '../chaos/safe_stop_ledger';
import { ChaosDrill } from '../chaos/chaos_drill';
import { TerminationLedger } from '../termination/termination_ledger';

export function composeResilience(
  parts: SovereigntyParts & PopulationParts & EconomyParts & ScaleParts & InstitutionParts,
  configDir: string,
) {
  const {
    audit, gateway, killSwitch, resources, recoveryConfig, spawnPolicy,
    memory, knowledge, sharding, population, scheduler, ministries, contracts,
    agents, permissions, models, terminationRoll,
  } = parts;

  // 1) التعافي والاستمرارية (المرحلة 32): تبقى استعادة القرص داخل الأرشيف الملكي
  // نفسه، وتضم اللقطة حالة السكان والشرائح والمجدول وحجوز الهوية والوزارات والعقود
  // والسجل. لا يفك نجاحها التوالد، بل ينقل وضع الاستمرارية إلى limited فقط.
  const continuity = new ContinuityController(audit, recoveryConfig.policy.continuity_mode);
  //     ووسّع البند T-29 (المرحلة 39) نطاق اللقطة: سجل الوكلاء والصلاحيات والنماذج معها،
  //     وسجل المنتهين يُعاد بناؤه من السلسلة الأبدية بعد استبدالها لا يُنقل في الحمولة.
  const recoveryState = new RecoveryStateParticipant({
    audit, resources, sharding, population, scheduler, ministries, contracts,
    agents, permissions, models, terminationRoll, continuity,
  });
  const archive = new RoyalArchive({
    audit, gateway, memory, knowledge, freeze: spawnPolicy, recovery: recoveryState,
  });
  const recoverySnapshots = new RecoverySnapshotStore(
    recoveryConfig.policy.backup_directory, recoveryConfig.policy.retention_count, archive, audit,
  );
  const backupScheduler = new BackupScheduler(
    recoverySnapshots, audit, recoveryConfig.policy.backup_interval_seconds,
  );
  const restoreRunner = new RestoreRunner(recoverySnapshots, archive, continuity);

  // 2) اختبارات الضغط (المرحلة 33) — قياس تحت الحمل بيد جهة تدقيق لا جهة تنفيذ.
  //     الترتيب مُلزم: دفتر الحمل أولًا (المصير المعلن)، ثم التمرين الذي يقرأ منه ويطابقه
  //     بالقناة. ولا يمنح التمرين حصة ولا يعتمد أمرًا: كل ما يقيسه يمرّ من طريقه المعلن.
  const loadConfig = loadLoad(configDir);
  const loadLedger = new LoadLedger({
    audit, authority: loadConfig.policy.drill_authority, maxLoss: loadConfig.policy.max_command_loss,
  });
  const loadDrill = new LoadDrill({
    audit, killSwitch, resources, ledger: loadLedger, policy: loadConfig.policy,
    mode: () => gateway.mode,
  });
  // 3) اختبارات الانقطاع (المرحلة 34) — القطع المعلن وحُكم التوقف الآمن.
  //     الترتيب مُلزم: الحاقن ثم الدفتر ثم التمرين — من يُحدث العطب ليس من يحكم عليه
  //     (RULE-004). ولا مقعد قطع يُسجَّل هنا: المقاعد تُمرَّر من التمرين المُشغَّل
  //     كي لا تحمل الدولة القائمة قدرةَ قطعِ نفسها في مسارها الطبيعي.
  const chaosConfig = loadChaos(configDir);
  const faultInjector = new FaultInjector({ audit, policy: chaosConfig.policy });
  const safeStopLedger = new SafeStopLedger({ audit, policy: chaosConfig.policy });
  const chaosDrill = new ChaosDrill({
    audit, killSwitch, injector: faultInjector, ledger: safeStopLedger,
    policy: chaosConfig.policy, mode: () => gateway.mode,
  });
  // 4) اختبارات الإنهاء (المرحلة 35) — الشاهد المستقل ودفتر الحكم.
  //     سجل المنتهين بُني في طبقة السيادة (`sovereignty.ts`) لأن كل مسلك يسأله. ولا شاهد يُسجَّل هنا:
  //     الشاهد يُبنى في التمرين بمسالكه، فلا تحمل الدولة القائمة أداة تجريب نفسها.
  const terminationConfig = loadTermination(configDir);
  const terminationLedger = new TerminationLedger({
    audit, policy: terminationConfig.policy,
    ledgerId: terminationConfig.policy.witness_authority,
  });

  return {
    continuity, recoveryState, archive, recoverySnapshots, backupScheduler, restoreRunner,
    loadConfig, loadLedger, loadDrill,
    chaosConfig, faultInjector, safeStopLedger, chaosDrill,
    terminationConfig, terminationLedger,
  };
}

/** ما تُخرجه طبقة الصلابة */
export type ResilienceParts = ReturnType<typeof composeResilience>;
