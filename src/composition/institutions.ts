/**
 * src/composition/institutions.ts — المؤسسات — الذاكرة والمعرفة والقضاء والوزارات والأقاليم
 * المالك: القيّم على المستودع | المراحل: 21–24
 * المدخلات: مخرجات السيادة والسكان والاقتصاد والمنشآت، وخيارات المُدد المعلنة
 * المخرجات: الذاكرة والاحتفاظ والمعرفة والقانون والمحاكم والوزارات والمناصب والمجلس والأقاليم والحكّام
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { BootstrapOptions } from './state';
import type { SovereigntyParts } from './sovereignty';
import type { PopulationParts } from './population';
import type { EconomyParts } from './economy';
import type { EnterpriseParts } from './enterprises';
import { AgentMemory } from '../data/agent_memory';
import { KnowledgeGraph } from '../data/knowledge_graph';
import { RetentionPolicy } from '../data/retention';
import { LawRegistry } from '../law/statutes';
import { Court } from '../law/courts';
import { AppealsCourt } from '../law/appeals';
import { Enforcement } from '../law/enforcement';
import { MinistryRegistry } from '../governance/ministries';
import { AppointmentRegistry } from '../governance/appointments';
import { Cabinet } from '../governance/cabinet';
import { RegionRegistry, RegionalAssembly } from '../federation/region_registry';
import { GovernorRegistry } from '../federation/governor';
import { RegionalTribunal } from '../federation/dispute_resolution';
import { RegionMonitor } from '../federation/region_monitor';

export function composeInstitutions(
  parts: SovereigntyParts & PopulationParts & EconomyParts & EnterpriseParts,
  options: BootstrapOptions,
) {
  const {
    audit, gateway, killSwitch, regionsConfig, agents, permissions, spawnPolicy,
    budget, companies, hospitals, labs, mirrorDepartments, journal,
  } = parts;

  // 1) الذاكرة والمعرفة (المرحلة 21) — وزارة البيانات
  //     الترتيب مُلزم: أصناف الاحتفاظ تُعرَف عند الكتابة، ثم الذاكرة سندٌ للمعرفة،
  //     ثم الأرشيف يأخذ نسخًا من الاثنين ولا يستعيد إلا بأمر ملكي
  //     واليوميّة الدائمة (المرحلة 39، البند T-27) تُمرَّر هنا إن أُعلنت: تُدوَّن الكتابة لحظتها
  //     لا عند لقطةٍ دورية. وغيابها يعني سلوك المراحل السابقة حرفًا بحرف.
  const memory = new AgentMemory({ audit, killSwitch, ...(journal ? { journal } : {}) });
  const retention = new RetentionPolicy({ audit, memory });
  const knowledge = new KnowledgeGraph({ audit, memory, ...(journal ? { journal } : {}) });
  // 2) القانون والقضاء (المرحلة 22) — وزارة العدل
  //     الترتيب مُلزم وهو نفسه فصل السلطات: قانون معلن ← محكمة تحكم به ←
  //     استئناف يراجع الحكم ← تنفيذ لا يقع إلا على حكم نهائي (RULE-004)
  const law = new LawRegistry({ audit, gateway });
  const court = new Court({
    audit,
    law,
    ...(options.justice?.defenseWindowMs !== undefined
      ? { defenseWindowMs: options.justice.defenseWindowMs } : {}),
    ...(options.justice?.appealWindowMs !== undefined
      ? { appealWindowMs: options.justice.appealWindowMs } : {}),
  });
  const appeals = new AppealsCourt({ audit, court, law, gateway });
  const enforcement = new Enforcement({
    audit, court, gateway, agents, permissions, spawnPolicy,
  });

  // 3) الحكومة والوزارات (المرحلة 23) — الديوان الملكي
  //     الترتيب مُلزم: وزارات باختصاص معلن ← مناصب ومسار تعيين مفصول ← مجلس يقرّر في اختصاصه.
  //     وسجل التعيينات يربط نفسه مصدرًا للتحقق من مناصب الوزارة قبل حلّها (فشل مغلق).
  const ministries = new MinistryRegistry({ audit, gateway });
  // قسم المرآة يقرأ الوظائف الحقيقية لسجل الوزارات، لا قائمة تكتبها المرحلة بيدها.
  mirrorDepartments.bindMinistryRegistry(
    (ministryId) => ministries.isActive(ministryId),
    () => ministries.active().map((ministry) => ministry.ministryId),
  );
  const appointments = new AppointmentRegistry({
    audit, gateway, ministries,
    ...(options.government?.approvalTtlMs !== undefined
      ? { approvalTtlMs: options.government.approvalTtlMs } : {}),
  });
  const cabinet = new Cabinet({ audit, gateway, ministries, appointments });

  // 4) الأقاليم والحكام (المرحلة 24) — مجلس الأقاليم تحت التاج لا بجانبه
  //     الترتيب مُلزم: أقاليم معلنة في التهيئة ← حكّام بمسار ثلاثي ← محكمة نزاع ← مراقبة.
  //     وسجل الحكّام يربط نفسه مصدرًا للتحقق من الحاكم قبل حلّ الإقليم (فشل مغلق).
  const regions = new RegionRegistry({
    audit, gateway, declaredRegions: regionsConfig.regions.map((r) => r.id),
  });
  const assembly = new RegionalAssembly({ audit, gateway, regions });
  const governors = new GovernorRegistry({
    audit, gateway, regions,
    ...(options.federation?.approvalTtlMs !== undefined
      ? { approvalTtlMs: options.federation.approvalTtlMs } : {}),
  });
  const tribunal = new RegionalTribunal({
    audit, gateway, regions,
    ...(options.federation?.responseWindowMs !== undefined
      ? { responseWindowMs: options.federation.responseWindowMs } : {}),
  });
  const regionMonitor = new RegionMonitor({
    audit, regions, governors, tribunal, killSwitch, assembly,
    ...(options.federation?.vacancyGraceMs !== undefined
      ? { vacancyGraceMs: options.federation.vacancyGraceMs } : {}),
    ...(options.federation?.disputeGraceMs !== undefined
      ? { disputeGraceMs: options.federation.disputeGraceMs } : {}),
  });

  // ربط مصدر التحقق من صاحب بند الموازنة: لا موازنة لجهة لا وجود لها (ثابت 5 للموازنة).
  // يُربط هنا لأن الوزارات والأقاليم تُبنى بعد الاقتصاد، والربط لا يكتب سجلًّا.
  budget.bindOwnerProbe((owner) => ministries.isActive(owner) || regions.isActive(owner));
  // ومنشأة المرحلة 28 تلزمها وزارة قائمة: الربط هنا لأن الوزارات تُبنى بعد المنشآت،
  // وقبل الربط كل إقامة مرفوضة (فشل مغلق لا افتراض قيام)
  companies.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));
  // والخدمات الحرجة لا تفترض قيام الوزارة: قبل هذا الربط كل إقامة ترفض مغلقًا.
  hospitals.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));
  labs.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));

  return {
    memory, retention, knowledge, law, court, appeals, enforcement,
    ministries, appointments, cabinet, regions, assembly, governors, tribunal, regionMonitor,
  };
}

/** ما تُخرجه طبقة المؤسسات */
export type InstitutionParts = ReturnType<typeof composeInstitutions>;
