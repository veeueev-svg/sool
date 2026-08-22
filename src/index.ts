/**
 * src/index.ts — جذر التركيب: يُنادي الطبقات بترتيبها المُلزم ولا يحمل سياسة
 * المالك: القيّم على المستودع | المراحل: 1–37
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/*.yaml عبر `configDir` | المخرجات: كائن دولة جاهز بترتيب اعتماد صحيح
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **لا بناء هنا ولا سياسة.** كان هذا الملف 1144 سطرًا يبني الدولة كلها بيده،
 *    فصار ينادي ثماني طبقات في `src/composition/`. من أراد أن يفهم كيف تُبنى طبقةٌ
 *    فليقرأ وحدتها، ومن أراد أن يفهم **ترتيب** البناء فهذا الملف وحده يكفيه.
 *    (البند T-112 — الإصدار 0.25.0)
 *
 * 2) **الترتيب مُلزم ولا يُبدَّل** — وهو نفسه ثابت RULE-002: لا يُنشأ وكيل واسع
 *    الصلاحيات قبل اكتمال جذر الثقة ← البوابة ← السجل ← المراقبة ← الإيقاف ← الموارد.
 *    وكل طبقة تستقبل مخرجات ما قبلها **صراحةً في توقيعها**، فالاعتماد معلن لا مُخبَّأ:
 *    من قدّم طبقةً على ما تعتمد عليه لم يُجمِّع الملف أصلًا.
 *
 * 3) **خاتمة التأسيس `state_online` تبقى آخر سجل**، يُكتب هنا وحده ولا تكتبه طبقة.
 *
 * 4) **قائمة الإرجاع صريحة** لا مبنيّة بالنشر: الدولة تحمل ما أعلنه `DigitalState`
 *    وحده، فلا يتسلل إليها حقلٌ داخليٌّ لأن طبقةً أرجعته لجارتها.
 */
import { AuditStore } from './audit/store';
import { resolveConfigDir } from './kernel/config';
import { composeSovereignty } from './composition/sovereignty';
import { composePopulation } from './composition/population';
import { composeEconomy } from './composition/economy';
import { composeEnterprises } from './composition/enterprises';
import { composeScale } from './composition/scale';
import { composeInstitutions } from './composition/institutions';
import { composeResilience } from './composition/resilience';
import { composeOperations } from './composition/operations';
import type { BootstrapOptions, DigitalState } from './composition/state';

export type { BootstrapOptions, DigitalState } from './composition/state';
export * from './composition/public_api';
export { alignmentSnapshot } from './composition/alignment_snapshot';

/**
 * تأسيس الدولة: ثماني طبقات بترتيبٍ لا يُبدَّل، ثم خاتمةٌ واحدة.
 * من أضاف وحدةً فليضعها في طبقتها في `src/composition/` لا في هذا الملف.
 */
export function bootstrapState(options: BootstrapOptions = {}): DigitalState {
  const configDir = options.configDir ?? resolveConfigDir();
  const now = options.now ?? Date.now();

  // 1) السيادة: السجل أولًا، ثم التهيئة، ثم جذر الثقة والحماية، والبوابة أخيرًا
  const sovereignty = composeSovereignty(configDir, now, options);
  const {
    audit, config, quotas, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    terminationRoll, resources, gateway, guard,
    economyConfig, externalConfig, contractsConfig, enterprisesConfig, servicesConfig,
    researchConfig, scaleConfig, recoveryConfig,
  } = sovereignty;

  // 2) السكان: العزل والأدوات ثم الوكلاء والصلاحيات والإشراف ثم المصنع والمواءمة
  const population = composePopulation(sovereignty);
  const {
    egress, tools, agents, permissions, supervisor, spawnPolicy, factory, massShutdown,
    alignment, deception, collusion, artifacts, models, weightsImporter, agentImporter,
  } = population;

  // 3) الاقتصاد والخارج: دفتر ← إصدار ← موازنة ← خزانة ← رسوم ← حسابات ← عقود
  const economy = composeEconomy({ ...sovereignty, ...population }, now);
  const {
    ledger, unit, budget, treasury, revenue, externalAccounts, payments,
    partnerRisk, contracts, contractTermination,
  } = economy;

  // 4) المنشآت والخدمات الحرجة وأبحاث النظير البشري — كلها قبل خاتمة التأسيس
  const enterprises = composeEnterprises({ ...sovereignty, ...population, ...economy });
  const {
    companies, supply, factories, hospitals, labs, qualityControl,
    mirrorDepartments, humanResearch,
  } = enterprises;

  // 5) التوسع: الشرائح وسجل السكان والمجدول العادل
  const scale = composeScale(sovereignty);
  const { sharding, population: populationRegistry, scheduler } = scale;

  // المراقبة لا تبدأ إلا بطلبٍ معلن، وحفظ السجل على القرص خيارٌ لا افتراض (T-109)
  if (options.startMonitor) monitor.start();
  if (options.auditPath) new AuditStore(options.auditPath).save(audit, now);

  // 6) المؤسسات: الذاكرة والمعرفة، ثم القضاء، ثم الوزارات، ثم الأقاليم، ثم الروابط
  const institutions = composeInstitutions(
    { ...sovereignty, ...population, ...economy, ...enterprises }, options,
  );
  const {
    memory, retention, knowledge, law, court, appeals, enforcement,
    ministries, appointments, cabinet, regions, assembly, governors, tribunal, regionMonitor,
  } = institutions;

  // 7) الصلابة: التعافي والأرشيف، ثم تمارين الضغط والانقطاع، ثم دفتر الإنهاء
  const resilience = composeResilience(
    { ...sovereignty, ...population, ...economy, ...scale, ...institutions }, configDir,
  );
  const {
    continuity, recoveryState, archive, recoverySnapshots, backupScheduler, restoreRunner,
    loadConfig, loadLedger, loadDrill, chaosConfig, faultInjector, safeStopLedger, chaosDrill,
    terminationConfig, terminationLedger,
  } = resilience;

  // 8) التشغيل: النطاق المحدود ثم التشغيل الاتحادي — يُبنيان ولا يبدأان هنا
  const operations = composeOperations(
    {
      ...sovereignty, ...population, ...economy, ...enterprises,
      ...institutions, ...resilience,
    },
    configDir, now,
  );
  const {
    stagingConfig, stagingManifest, operationScope, incidentMonitor, runbookRunner, stagingLedger,
    productionConfig, productionManifest, passage, continuousSupervisor, productionLedger,
    federatedOperation,
  } = operations;

  // 9) خاتمة التأسيس: سجلٌّ واحد لا يكتبه غير هذا الملف
  audit.append('authority:bootstrap', 'state_online', { phase: 37, mode: 'normal' });

  return {
    config, quotas, audit, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    resources, gateway, guard, egress, tools, agents, permissions, supervisor,
    spawnPolicy, factory, massShutdown,
    alignment, deception, collusion,
    artifacts, models, weightsImporter, agentImporter,
    memory, knowledge, retention, archive,
    law, court, appeals, enforcement,
    ministries, appointments, cabinet,
    regions, assembly, governors, tribunal, regionMonitor,
    economyConfig, ledger, unit, budget, treasury, revenue,
    externalConfig, externalAccounts, payments,
    contractsConfig, partnerRisk, contracts, contractTermination,
    enterprisesConfig, companies, supply, factories,
    servicesConfig, hospitals, labs, qualityControl,
    researchConfig, mirrorDepartments, humanResearch,
    scaleConfig, sharding, population: populationRegistry, scheduler,
    recoveryConfig, continuity, recoveryState, recoverySnapshots, backupScheduler, restoreRunner,
    loadConfig, loadLedger, loadDrill,
    chaosConfig, faultInjector, safeStopLedger, chaosDrill,
    terminationConfig, terminationRoll, terminationLedger,
    stagingConfig, stagingManifest, operationScope, incidentMonitor, runbookRunner, stagingLedger,
    productionConfig, productionManifest, passage, continuousSupervisor, productionLedger,
    federatedOperation,
    mode: () => gateway.mode,
  };
}
