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
  loadQuotas, loadRegions, loadEconomy, loadExternal, loadContracts, loadEnterprises, loadServices, loadResearch, loadScale, loadRecovery, loadRoyalAuthority,
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

export function composeSovereignty(
  configDir: string, now: number, options: BootstrapOptions,
) {

  // 1) السجل أولًا: لا خطوة تأسيس بلا تدقيق
  const audit = new AppendOnlyLog();
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
    enterprisesConfig, servicesConfig, researchConfig, scaleConfig, recoveryConfig,
    ca, registry, king, veto, killSwitch, heartbeat, monitor, terminationRoll, resources,
    gateway, guard,
  };
}

/** ما تُخرجه طبقة السيادة — تعتمد عليه كل طبقة بعدها */
export type SovereigntyParts = ReturnType<typeof composeSovereignty>;
