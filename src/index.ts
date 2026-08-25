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
import { rehydrateFromJournal } from './data/persistence';
import { rehydrateStateFromJournal } from './data/rehydrate_state';
import { rehydrateFiscalFromJournal } from './data/rehydrate_fiscal';
import { rehydrateGovernanceFromJournal } from './data/rehydrate_governance';
import { bootWork, resolveConfigDir } from './kernel/config';
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
    terminationRoll, resources, gateway, guard, persistenceConfig, journal,
    economyConfig, externalConfig, contractsConfig, enterprisesConfig, servicesConfig,
    researchConfig, scaleConfig, recoveryConfig,
  } = sovereignty;

  // 2) السكان: العزل والأدوات ثم الوكلاء والصلاحيات والإشراف ثم المصنع والمواءمة
  const population = composePopulation(sovereignty);
  const {
    egress, tools, agents, permissions, supervisor, spawnPolicy, factory, massShutdown,
    alignment, deception, collusion, channels, covert, artifacts, models, weightsImporter,
    agentImporter, safetyAttestor, inference,
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

  // 8.5) الإرجاع من اليوميّة الدائمة (المرحلة 39، البند T-27): آخر خطوةٍ قبل الخاتمة، لأن
  //      الإرجاع يستبدل سلسلة السجل ويستورد الذاكرة والمعرفة، فلا يجوز أن تكتب طبقةٌ بعده
  //      كتابةً تظنّها في السلسلة القديمة. وسجل المنتهين يُعاد بناؤه من السلسلة (البند T-99).
  const rehydrated = journal
    ? rehydrateFromJournal(journal, { audit, memory, knowledge, terminationRoll }, 'ministry:data', {
      rebuildTerminationRoll: persistenceConfig.policy.rebuild_termination_roll,
    })
    : null;

  // 8.6) إرجاعُ الاقتصاد والعقود والسكان من اليوميّة (المرحلة 39، البند T-122)، ثم **ربطُ**
  //      الوسيط. والترتيبُ حرسٌ لا ترتيب: لو رُبط الوسيط قبل الإرجاع لأُعيد تدوينُ كلِّ
  //      ما استُعيد، فتتضاعف اليوميّة مع كلِّ إقلاعٍ حتّى تبلغ سقفَ القيود فيرفض النظامُ الكتابة.
  //      والحساباتُ السياديّة الثلاثة تُفتح في الخطوة 5 قبل الربط، فلذلك `restore` يدمج ولا يستبدل.
  const rehydratedState = journal
    ? rehydrateStateFromJournal(journal.read(), {
      ledger, contracts, population: populationRegistry,
    }, 'ministry:data')
    : null;
  // 8.7) إرجاعُ الماليّة والنافذة الخارجيّة (المرحلة 39، البند T-125). بعد 8.6 لا قبلها:
  //      بابُ الخزينة يتحقّق من قيدِ كلِّ مصروفٍ في الدفتر، والدفترُ إنّما أُرجع قبل قليل.
  //      والقياسُ الذي أوجب البند في docs/audit/measurements/phase-39-T125.txt: بندُ موازنةٍ
  //      مستهلَكٌ 1,800,000 يعود 0، وسقفٌ 60,000,000 يُعاد تعبئتُه بإقلاعٍ والدفترُ يشهد بالصرف.
  const rehydratedFiscal = journal
    ? rehydrateFiscalFromJournal(journal.read(), {
      treasury, budget, revenue, unit, accounts: externalAccounts, payments, risk: partnerRisk,
    }, 'ministry:data')
    : null;
  // 8.8) إرجاعُ الحكومة: الوزاراتُ والمناصبُ والاقتراحاتُ وأصحابُ المناصب (المرحلة 39، T-126).
  //      والقياسُ الذي أوجب البند في docs/audit/measurements/phase-39-T126.txt: **ثلاثةُ حرّاسٍ
  //      تُفَكُّ بإطفاءة** — جُمع القضاءُ والادّعاءُ في شخصٍ واحدٍ بعد الإقلاع، وحُلّت وزارةٌ
  //      ومنصبُها مشغولٌ في السجل الأبديّ، وسقط اعتمادٌ ملكيٌّ قائم. وتاريخُ الحلِّ يُمحى معها.
  //      والوزاراتُ تُرجَع قبل التعيينات: حرَسُ لقطةِ المناصب يسأل عن وزارةِ كلِّ منصب.
  const rehydratedGovernance = journal
    ? rehydrateGovernanceFromJournal(journal.read(), { ministries, appointments }, 'ministry:data')
    : null;
  if (journal) {
    ledger.attachJournal(journal);
    contracts.attachJournal(journal);
    populationRegistry.attachJournal(journal);
    treasury.attachJournal(journal);
    budget.attachJournal(journal);
    revenue.attachJournal(journal);
    unit.attachJournal(journal);
    externalAccounts.attachJournal(journal);
    payments.attachJournal(journal);
    partnerRisk.attachJournal(journal);
    ministries.attachJournal(journal);
    appointments.attachJournal(journal);
  }

  // 8.9) عملُ الإقلاع يُدوَّن قبل الخاتمة (البند T-134): الزمنُ لا يُحرس بالساعة بل بعدِّ
  //      العمل، وهذا القيدُ هو أثرُه في الدفتر — والحرَسُ نفسُه في بوابةِ التكامل لا هنا،
  //      لأنّ دولةً تُرفض في مُشغِّل مستخدمٍ بسبب قراءةٍ زائدةٍ أسوأُ من دفعةٍ تُردّ في البوابة.
  const work = bootWork();
  audit.append('authority:bootstrap', 'boot_work_measured', { ...work });

  // 9) خاتمة التأسيس: سجلٌّ واحد لا يكتبه غير هذا الملف
  audit.append('authority:bootstrap', 'state_online', { phase: 37, mode: 'normal' });

  return {
    config, quotas, audit, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    resources, gateway, guard, egress, tools, agents, permissions, supervisor,
    spawnPolicy, factory, massShutdown,
    alignment, deception, collusion, channels, covert,
    artifacts, models, weightsImporter, agentImporter, safetyAttestor, inference,
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
    persistenceConfig, journal, rehydrated, rehydratedState, rehydratedFiscal,
    rehydratedGovernance,
    mode: () => gateway.mode,
  };
}
