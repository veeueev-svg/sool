/**
 * src/composition/enterprises.ts — المنشآت والخدمات — الشركات والمصانع والمستشفيات والمختبرات وأبحاث النظير البشري
 * المالك: القيّم على المستودع | المراحل: 28–30
 * المدخلات: مخرجات السيادة والسكان والاقتصاد
 * المخرجات: تشغيل المنشآت وسلسلة التوريد والمصانع والخدمات الحرجة وضبط الجودة وأقسام المرآة والبحث
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import type { SovereigntyParts } from './sovereignty';
import type { PopulationParts } from './population';
import type { EconomyParts } from './economy';
import { CompanyRuntime } from '../services/company_runtime';
import { SupplyChain } from '../services/supply_chain';
import { FactoryRuntime } from '../services/factory_runtime';
import { HospitalRuntime } from '../services/hospital_runtime';
import { LabRuntime } from '../services/lab_runtime';
import { QualityControl } from '../services/quality_control';
import { MirrorDepartmentRegistry } from '../services/mirror_department';
import { HumanResearchRegistry } from '../services/human_research';

export function composeEnterprises(
  parts: SovereigntyParts & PopulationParts & EconomyParts,
) {
  const {
    audit, gateway, resources, quotas, enterprisesConfig, servicesConfig, researchConfig,
    budget, contracts,
  } = parts;

  // 1) الشركات والمصانع (المرحلة 28) — بعد العقود لأن المادة الخارجية تدخل على
  //     عقد قائم لا على اسم مذكور، وقبل state_online لأن الدولة لا تُعلن جهوزيتها
  //     وفيها منشأةٌ بلا سلسلة توريد تسندها.
  const companies = new CompanyRuntime({
    audit, gateway, resources,
    kinds: enterprisesConfig.kinds.map((kind) => ({
      id: kind.id, name: kind.name, sector: kind.sector,
      inputs: kind.inputs.map((i) => ({ material: i.material, quantity: i.quantity })),
      output: { material: kind.output.material, quantity: kind.output.quantity },
      resourceCost: {
        resource: kind.resource_cost.resource, amount: kind.resource_cost.amount,
      },
      requiredChecks: kind.required_checks,
    })),
    maxTermMs: enterprisesConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxPerMinistry: enterprisesConfig.policy.max_facilities_per_ministry,
    suspendAuthorities: enterprisesConfig.policy.suspend_authorities,
    operatorId: enterprisesConfig.policy.operator,
    requireBudgetLine: enterprisesConfig.policy.require_budget_line,
  });
  // T-160 (W-2026-044 · ADR-0051): مدةُ الدفعةِ المعلنةُ لا تتجاوز سقفَ حصةِ موردٍ يستأجره
  //   نوعٌ معلن — وإلّا عاشت الدفعةُ بعد حصتِها فرُفض إقفالُها بدعوى الحصة. تناقضُ إعلانَين
  //   بناءٌ فاسدٌ يُرفض عند التركيب، لا دَينٌ يُكتشف في الإقفال (فشلٌ مغلق).
  const runSeconds = enterprisesConfig.policy.max_run_duration_hours * 3600;
  for (const kind of enterprisesConfig.kinds) {
    const spec = quotas.resources[kind.resource_cost.resource];
    if (spec !== undefined && runSeconds > spec.lease_seconds) {
      throw new Error(`ENTERPRISE_RUN_EXCEEDS_LEASE: ${kind.id} — مدةُ الدفعة ${runSeconds}ث `
        + `فوق سقفِ حصةِ ${kind.resource_cost.resource} ${spec.lease_seconds}ث`);
    }
  }
  const supply = new SupplyChain({
    audit, materials: enterprisesConfig.materials,
    operatorId: enterprisesConfig.policy.operator,
  });
  // الأطراف تُربط بمصادر تحقق لا تُبنى داخلها (RULE-005): المنشأة والعقد والموازنة
  companies.bindBudgetProbe((line) => budget.get(line) !== null);
  supply.bindFacilityProbe((facilityId, at) => companies.isActive(facilityId, at));
  supply.bindContractProbe((contractId, at) => {
    const contract = contracts.get(contractId);
    if (contract === null || !contracts.isActive(contractId, at)) return null;
    return contract.counterparty;
  });
  const factories = new FactoryRuntime({
    audit, companies, supply, resources,
    qualityChecks: enterprisesConfig.quality_checks,
    minQualityScore: enterprisesConfig.policy.min_quality_score,
    wasteTolerancePerMille: enterprisesConfig.policy.waste_tolerance_per_mille,
    wasteBreachesToSuspend: enterprisesConfig.policy.waste_breaches_to_suspend,
    maxConcurrentRuns: enterprisesConfig.policy.max_concurrent_runs,
    maxRunDurationHours: enterprisesConfig.policy.max_run_duration_hours,
    inspectorId: enterprisesConfig.policy.inspector,
    operatorId: enterprisesConfig.policy.operator,
  });

  // 2) المستشفيات والمختبرات البرمجية (المرحلة 29) — بعد المنشآت وقبل state_online:
  //      لا تُقام هنا خدمة؛ الإقامة فعل ملكي لاحق. يُبنى التشغيل من إعلان المصادر والأوضاع
  //      وحده، ويظل مجسّ المصدر غير مربوط حتى يورّد الواقع الخارجي حقائقه (فشل مغلق).
  const serviceDeclarations = servicesConfig.services.map((service) => ({
    id: service.id,
    name: service.name,
    kind: service.kind as 'hospital' | 'lab',
    ministry: service.ministry,
    modes: {
      full: service.modes.full.required_sources ?? [],
      limited: service.modes.limited.required_sources ?? [],
      halted: service.modes.halted.required_sources ?? [],
    },
    operations: service.operations.map((operation) => ({
      id: operation.id,
      minimumMode: operation.minimum_mode as 'full' | 'limited',
      requiredSources: operation.required_sources,
    })),
  }));
  const criticalServiceDeps = {
    audit,
    gateway,
    declarations: serviceDeclarations,
    maxTermMs: servicesConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxActivePerMinistry: servicesConfig.policy.max_services_per_ministry,
    operatorId: servicesConfig.policy.service_operator,
    beneficiaryPrefix: servicesConfig.policy.beneficiary_prefix,
    recoveryVerifier: servicesConfig.policy.recovery_verifier,
  };
  const hospitals = new HospitalRuntime(criticalServiceDeps);
  const labs = new LabRuntime({
    ...criticalServiceDeps,
    qualityChecks: servicesConfig.quality_checks,
  });
  const qualityControl = new QualityControl({
    audit,
    qualityChecks: servicesConfig.quality_checks,
    minQualityScore: servicesConfig.policy.min_quality_score,
    inspectorId: servicesConfig.policy.quality_inspector,
  });
  // سقف الوزارة شامل للمستشفيات والمختبرات، لا سقف مستقل لكل مصفوفة داخلية.
  const activeServiceCount = (ministryId: string, at: number) =>
    hospitals.activeServices(at).filter((service) => service.operator === ministryId).length
    + labs.activeServices(at).filter((service) => service.operator === ministryId).length;
  hospitals.bindServiceCountProbe(activeServiceCount);
  labs.bindServiceCountProbe(activeServiceCount);

  // 3) أبحاث البشر وقسم المرآة (المرحلة 30) — قبل state_online:
  //      البحث نظري في النظير البشري عبر مصادر معلنة ولا يمس إنسانًا ولا بياناته. الأقسام
  //      تُربط بسجل الوزارات بعد بنائه؛ وقبل الربط يرفض كل استعمال فشلًا مغلقًا.
  const mirrorDepartments = new MirrorDepartmentRegistry({
    audit,
    gateway,
    maxDepartments: researchConfig.policy.max_departments,
    maxTermMs: researchConfig.policy.max_research_term_days * 24 * 60 * 60 * 1000,
    operatorId: researchConfig.policy.research_operator,
  });
  const humanResearch = new HumanResearchRegistry({
    audit,
    gateway,
    sources: researchConfig.sources,
    maxConcurrentResearches: researchConfig.policy.max_concurrent_researches,
    maxSourcesPerResearch: researchConfig.policy.max_sources_per_research,
    maxTermMs: researchConfig.policy.max_research_term_days * 24 * 60 * 60 * 1000,
    reviewIntervalMs: researchConfig.policy.review_interval_days * 24 * 60 * 60 * 1000,
    minLessonQualityScore: researchConfig.policy.min_lesson_quality_score,
    // بوابة منع ثانية: البحث لا يبدأ إلا وحصة الخروج الرسمية صفر.
    maxEgressCalls: quotas.resources.egress_calls?.per_agent_max ?? -1,
    researchOperator: researchConfig.policy.research_operator,
    lessonApprover: researchConfig.policy.lesson_approver,
    beneficiaryPrefix: researchConfig.policy.beneficiary_prefix,
    departmentActive: (departmentId, at) => mirrorDepartments.isActive(departmentId, at),
    departmentFunction: (departmentId) => mirrorDepartments.functionOf(departmentId),
  });

  return {
    companies, supply, factories, hospitals, labs, qualityControl,
    mirrorDepartments, humanResearch,
  };
}

/** ما تُخرجه طبقة المنشآت والخدمات */
export type EnterpriseParts = ReturnType<typeof composeEnterprises>;
