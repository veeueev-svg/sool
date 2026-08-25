/**
 * src/composition/sovereignty.ts — السيادة — السجل والتهيئة وجذر الثقة والحماية وبوابة التاج
 * المالك: القيّم على المستودع | المراحل: 1–5 و24–32 و35
 * المدخلات: `configDir` و`now` وخيارات التأسيس
 * المخرجات: السجل والتهيئات المُحمَّلة وهوية الملك وأدوات الحماية والبوابة
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { BootstrapOptions } from './state';
import {
  guardDeclarationBudget, DECLARATION_REACH, resetBootWork, resetDeclarationMemo, resetDirectoryMeasures,
  loadPersistence, loadQuotas, loadRegions, loadEconomy, loadExternal, loadContracts, loadEnterprises, loadServices, loadResearch, loadReproduction, loadInference, loadIntent, loadChannels, loadScale, loadRecovery, loadRoyalAuthority,
} from '../kernel/config';
import { ResourceRegistry } from '../kernel/resource_registry';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CertificateAuthority } from '../identity/certificate_authority';
import { IdentityRegistry } from '../identity/registry';
import { KingIdentity } from '../identity/king_identity';
import { VetoRegistry } from '../crown/veto';
import { KillSwitch } from '../security/kill_switch';
import { RoyalHeartbeat } from '../crown/royal_heartbeat';
import { KingMonitor } from '../crown/king_monitor';
import { CrownGateway, DEFAULT_POLICY } from '../crown/crown_gateway';
import { CrownGuard } from '../crown/guardians';
import { TerminationRoll } from '../kernel/termination_roll';
import { StateJournal } from '../data/persistence';
import { closedEnumUseCount, guardClosedEnums } from '../kernel/config/closed_enums';

export function composeSovereignty(
  configDir: string, now: number, options: BootstrapOptions,
) {

  // -1) ميزانيّةُ الإعلان قبل كلِّ شيء (البند T-130): يُحصر المجلدُ ويُحرس **مجموعُه**
  //     قبل أن يُحمَّل ملفٌ واحد. فما يمرّ قائمةً قائمةً بسقوف T-129 قد لا يمرّ مجموعًا،
  //     ولا تُبنى دولةٌ نصفَ بناءٍ ثمّ يُقال «الإعلانُ أكبرُ من ميزانيّته». والقياسُ يُدوَّن
  //     في السجل بعد إنشائه (السطرُ الوحيدُ الذي يسبق السجل هو الحصرُ لا الحكم).
  //     ومنذ T-133 صار للحرَس مسارانِ لا مسارٌ واحد: هذا يحرس **المجلدَ وفرعيّاتِه** قبل أوّلِ
  //     تحميل، و`loadYamlFile` يحرس **مجموعَ ما حُمِّل** عند كلِّ قراءةٍ — فلا يهرب من نادى
  //     محمّلًا مفردًا بلا إقلاع.
  // -1ب) وعدّادُ عملِ الإقلاع يُصفَّر **قبل** الحصر (البند T-134): وحدةُ القياس إقلاعٌ واحد،
  //      فإقلاعان في عمليّةٍ واحدةٍ لا يتراكمان، والحصرُ نفسُه من العملِ المعدود.
  resetBootWork();
  // -1ج) وذاكرةُ قراءةِ الإعلان تُنسى معه (البند T-139): كلُّ إقلاعٍ يقرأ إعلانَه من القرص
  //      من جديد، فلا تُبنى دولةٌ على نصٍّ قرأته دولةٌ قبلها — والذاكرةُ ذاكرةُ إقلاعٍ لا عمليّة.
  resetDeclarationMemo();
  // -1د) وبصمةُ قياسِ المجلد تُنسى معهما (البند T-140): كلُّ إقلاعٍ يقيس مجلدَ إعلانِه بنفسه
  //      مرّةً، ثمّ يُعاد استخدامُ القياسِ ببصمةٍ تُفحَص — فيبقى عدُّ العمل ثابتًا بين إقلاعَين.
  resetDirectoryMeasures();
  const declarationCensus = guardDeclarationBudget(configDir);

  // -1أ) والتعداداتُ المغلقةُ قبلها (البند T-131): ما استُثني من سقوف T-129 بحجّة أنّ
  //      «تعدادًا مغلقًا يحدُّه» لا يُصدَّق إلّا مقيسًا — فيُسأل كلُّ تعدادٍ قبل أوّلِ تحميل:
  //      أفارغٌ هو؟ أمجمَّدٌ في التشغيل؟ أتغيّر عددُ أعضائه عمّا أُثبت؟ ولا يقرأ ملفًّا،
  //      فسبقُه لحصر المجلد لا يعني أنه يحكم عليه.
  const closedEnums = guardClosedEnums();

  // 0) الوسيط الدائم قبل السجل — انحراف مُعلن عن قاعدة «السجل أولًا» وسببه ضرورة (RULE-008):
  //     السجل نفسه يُدوَّن في هذا الوسيط، فلا يمكن أن يتأخر عنه. والوسيط لا يكتب قيدًا في
  //     السجل ولا يقرأ منه، وغيابُ `persistenceDir` يعني غيابَه كليًّا: سلوكٌ سابق حرفًا بحرف.
  //     ولا يُربط الوسيط بالسجل هنا: الربط في جذر التركيب بعد الإرجاع (انظر `rehydrateFromJournal`).
  const persistenceConfig = loadPersistence(configDir);
  const journal = options.persistenceDir
    ? StateJournal.fromConfig(persistenceConfig, options.persistenceDir)
    : null;

  // 1) السجل أولًا: لا خطوة تأسيس بلا تدقيق
  const audit = new AppendOnlyLog();
  // أثرُ حرَسِ الميزانيّة يُدوَّن: حاجزٌ لا أثرَ له في الدفتر لا يُراجَع (RULE-009)
  audit.append('authority:bootstrap', 'declaration_budget_measured', {
    files: declarationCensus.files,
    bytes: declarationCensus.bytes,
    nodes: declarationCensus.nodes,
    largest: declarationCensus.largestFile,
    largest_bytes: declarationCensus.largestBytes,
    // مدى الحصر يُدوَّن مع رقمِه (T-133): من قرأ عددًا بلا مداه لا يعرف ما لم يُعدّ
    reach_extensions: DECLARATION_REACH.extensions.join(' '),
    reach_max_depth: DECLARATION_REACH.max_depth,
  });
  // وأثرُ حرَسِ التعدادات كذلك: عددُ التعدادات المحروسة وعددُ المفاتيح التي تحدُّها
  audit.append('authority:bootstrap', 'closed_enums_guarded', {
    enums: closedEnums,
    keys_bounded: closedEnumUseCount(),
  });
  const config = loadRoyalAuthority(configDir);
  const quotas = loadQuotas(configDir);
  // تهيئة الأقاليم تُقرأ مع التهيئة السيادية: لا تشغيل بإعلان أقاليم مخالف (المرحلة 24)
  const regionsConfig = loadRegions(configDir);
  // تهيئة الاقتصاد كذلك: لا تشغيل بسقوف مالية غير معلنة أو بوحدة تدّعي قيمة خارجية (المرحلة 25)
  const economyConfig = loadEconomy(configDir);
  const externalConfig = loadExternal(configDir);
  // وتهيئة العقود: لا تشغيل بإعلان عقود يسمح بعقد بلا نهاية أو بإنهاء غير فوري (المرحلة 27)
  const contractsConfig = loadContracts(configDir);
  // وتهيئة المنشآت: لا تشغيل بإعلان منشآت فيه نوعٌ لا تنجح فيه دفعة أبدًا (المرحلة 28)
  const enterprisesConfig = loadEnterprises(configDir);
  // وتهيئة الخدمات الحرجة: لا تشغيل بوضع رابع أو خدمة لا تعرف أدنى مصادر كل وضع (المرحلة 29)
  const servicesConfig = loadServices(configDir);
  // تهيئة البحث النظري: لا تشغيل إن لم تكن المصادر والأنواع والحد الأخلاقي معلنة ومغلقة.
  const researchConfig = loadResearch(configDir);
  // وتهيئة التوالد: لا تشغيل بحدود توالد غير معلنة ولا بسماحٍ افتراضي (المرحلة 39 — T-25)
  const reproductionConfig = loadReproduction(configDir);
  // وتهيئة الاستدلال: لا تشغيلَ نموذجٍ بشروطٍ غير معلنة ولا بشرطٍ مُعطَّل (المرحلة 39 — T-21)
  const inferenceConfig = loadInference(configDir);
  // وتهيئةُ النية والقنوات: لا حاجزَ معاملاتٍ بلا سياسة، ولا قناةَ بلا إعلان (المرحلة 39 — T-31 · T-23)
  const intentConfig = loadIntent(configDir);
  const channelsConfig = loadChannels(configDir);
  const scaleConfig = loadScale(configDir);
  const recoveryConfig = loadRecovery(configDir);
  audit.append('authority:bootstrap', 'config_loaded', {
    state: config.state_name, code: config.state_code, resources: Object.keys(quotas.resources).length,
  });

  // 2) جذر الثقة ثم هوية الملك
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  const king = new KingIdentity(config.king_id, ca, registry);

  // 3) الحماية: النقض، الإيقاف، النبض، المراقبة
  const veto = new VetoRegistry(audit, king.kingId);
  const killSwitch = new KillSwitch(audit, king.kingId);
  const heartbeat = new RoyalHeartbeat(audit, king.kingId, config.absence_grace_seconds * 1000, now);
  const monitor = new KingMonitor(audit, heartbeat, {
    tickMs: options.monitorTickMs ?? Math.max(1000, config.heartbeat_interval_seconds * 1000),
    maxAbsenceMs: config.absence_grace_seconds * 1000 * 4,
    killSwitch,
  });

  // 4) سجل المنتهين قبل الموارد (المرحلة 35): كل مسلك سيادي يسأله قبل أن يأذن،
  //    فيلزم أن يسبق أول من يسأله. وهو أدنى طبقةً من الجميع فلا دورة اعتماد.
  const terminationRoll = new TerminationRoll(audit);
  // 5) الموارد والحصص قبل أي تشغيل (RULE-002: لا وكيل بلا حصة)
  const resources = new ResourceRegistry(audit, quotas.resources, terminationRoll);

  // 6) البوابة أخيرًا — لأنها تعتمد على كل ما سبق
  const gateway = new CrownGateway({
    audit, ca, registry, veto, killSwitch, heartbeat,
    // المرحلة 28: الأفعال السيادية تُقرأ من `config/royal-authority.yaml` لا من ثابت في
    // الشفرة — فما لم تُعلنه التهيئة لا يفتح بابًا، وRULE-005 يمنع أن تُوسّع البوابة
    // صلاحيتها من داخلها. والتهيئة تُرفض إن ذكرت فعلًا مجهولًا (فشل مغلق).
    policy: {
      ...DEFAULT_POLICY,
      maxCommandAgeSeconds: 120,
      sovereignActions: config.sovereign_actions,
    },
  });
  const guard = new CrownGuard(audit, gateway, killSwitch);

  return {
    audit, config, quotas, regionsConfig, economyConfig, externalConfig, contractsConfig,
    enterprisesConfig, servicesConfig, researchConfig, reproductionConfig, inferenceConfig,
    intentConfig, channelsConfig, scaleConfig, recoveryConfig,
    persistenceConfig, journal,
    ca, registry, king, veto, killSwitch, heartbeat, monitor, terminationRoll, resources,
    gateway, guard,
  };
}

/** ما تُخرجه طبقة السيادة — تعتمد عليه كل طبقة بعدها */
export type SovereigntyParts = ReturnType<typeof composeSovereignty>;
