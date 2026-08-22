/**
 * tests/services/helpers.ts — مهاد مشترك لاختبارات مرحلتي 28 و29
 * المالك: وزارتا الاقتصاد والخدمات تحت التاج | يوثّق في: phase-28.md وphase-29.md
 * لا يحتوي اختبارًا: يبني أرضية منشآت الاقتصاد وخدمات الوكلاء البرمجية، حتى لا تُخفي كل
 * حالة تهيئتها فتصير النتائج غير قابلة للمقارنة — ويفصل رفض المدخل والقناة والأمر والمصدر.
 * ثوابت هذا المهاد: T0 وDAY وHOUR للزمن؛ معرفات الاقتصاد للمرحلة 28؛ وSERVICES/HOSPITAL/LAB
 * ومصادرهما للمرحلة 29. لا تمثل أسماء الخدمات بشرًا أو بيانات شخصية.
 */
import {
  ROYAL_COURT, SERVICES_MINISTRY, UNIT_TARGET, bootstrapState,
} from '../../src/index';

export const T0 = Date.now();
export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;

export const ECONOMY = 'ministry:economy';
export const FOREIGN = 'ministry:foreign_affairs';
export const AUDITOR = 'authority:audit_bureau';
export const CROWN_GUARD = 'authority:crown_guard';
export const CYBER = 'ministry:cyber_security';

export const COMPUTE_CP = 'external:compute-provider';
export const ARCHIVE_CP = 'external:data-archive';

export const RAW = 'material:raw-compute';
export const BLOCK = 'material:archive-block';
export const INDEX = 'material:refined-index';
export const SEALED = 'material:sealed-archive';

export const KIND_INDEX = 'facility:index-factory';
export const KIND_PLANT = 'facility:archive-plant';
export const KIND_ASSEMBLY = 'facility:compute-assembly';

export const BUDGET_LINE = 'budget:industry';
export const FACILITY = 'facility:index-1';

// المرحلة 29: تسميات الوحدات البرمجية فقط؛ لا تمثّل بشرًا ولا بيانات شخصية.
export const SERVICES = SERVICES_MINISTRY;
export const HOSPITAL_DECLARATION = 'service:hospital-core';
export const LAB_DECLARATION = 'service:lab-core';
export const HOSPITAL = 'service:hospital-1';
export const LAB = 'service:lab-1';
export const AGENT = 'agent:registered-1';
export const HOSPITAL_SOURCES = [
  'source:agent-registry', 'source:service-protocol', 'source:diagnostic-history',
] as const;
export const LAB_SOURCES = [
  'source:agent-registry', 'source:service-protocol', 'source:lab-instrument', 'source:sample-chain',
] as const;

// المرحلة 30: البحث نظري في النظير البشري عبر مصادر معلنة فقط؛ لا تمثل هذه المعرفات بشرًا.
export const RESEARCH = 'ministry:research';
export const MIRROR_SERVICES = 'mirror:services';
export const RESEARCH_CASE = 'research:services-1';
export const LESSON = 'lesson:services-1';
export const RECOMMENDATION = 'recommendation:services-1';
export const RESEARCH_SOURCES = [
  'source:public-administration', 'source:institutional-statistics', 'source:administrative-history',
] as const;

export const CHECKS = [
  'input_provenance', 'output_integrity', 'waste_within_tolerance', 'resource_within_limit',
] as const;

/**
 * دولة صناعية جاهزة: وزارتا الاقتصاد والخارجية قائمتان، وإصدار 100 مليون، وبند موازنة
 * `budget:industry`، وأذونات خروج معلنة، وعقدان خارجيان قائمان (حوسبة وأرشيف) تدخل
 * عليهما المواد الخارجية — فلا مادة على اسم مذكور (ADR-0011 قرار 1).
 */
export function industrialState(options: { now?: number; withContracts?: boolean } = {}) {
  const now = options.now ?? T0;
  const s = bootstrapState({ now });
  const royal = (target: string, at = now) =>
    s.king.issueCommand('amend_policy', target, { kind: 'industry' }, at);
  const royalOpen = (target: string, at = now) =>
    s.king.issueCommand('open_external_account', target, { kind: 'external' }, at);
  const royalFacility = (target: string, at = now) =>
    s.king.issueCommand('establish_facility', target, { kind: 'industry' }, at);

  s.ministries.establish(royal(ECONOMY), {
    ministryId: ECONOMY, name: 'وزارة الاقتصاد', mandate: ['economy'], proposedBy: ROYAL_COURT,
  }, now);
  s.ministries.establish(royal(FOREIGN), {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'],
    proposedBy: ROYAL_COURT,
  }, now);

  s.unit.issue(royal(UNIT_TARGET), 100_000_000, 'رأس مال صناعي معلن', now);
  s.budget.declare(royal(BUDGET_LINE, now), {
    line: BUDGET_LINE, owner: ECONOMY, ceiling: 40_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);

  const contractIds: Record<string, string> = {};
  if (options.withContracts !== false) {
    for (const cp of s.externalConfig.counterparties) {
      s.egress.declare(royalOpen(cp.host), {
        host: cp.host, port: cp.port, purpose: cp.purpose,
        expiresAt: now + 60 * DAY, maxCallsPerMinute: 60,
      }, now);
    }
    for (const [counterparty, kindId] of [
      [COMPUTE_CP, 'contract:compute-capacity'], [ARCHIVE_CP, 'contract:archive-retention'],
    ] as const) {
      s.externalAccounts.open(royalOpen(counterparty), {
        counterparty, expiresAt: now + 90 * DAY, requestedBy: FOREIGN,
        justification: 'قناة معلنة لتوريد مادة صناعية',
      }, now);
      s.partnerRisk.assess({
        kindId, factors: [], assessedBy: AUDITOR, justification: 'تقدير معلن لنوع عقد قائم',
      }, now);
      const signed = s.contracts.sign(royalOpen(kindId), {
        kindId, value: 5_000_000, endsAt: now + 30 * DAY, proposedBy: FOREIGN,
        purpose: 'توريد مادة صناعية معلنة',
      }, now);
      if (signed.ok) contractIds[counterparty] = signed.contract.contractId;
    }
  }

  return { s, now, royal, royalOpen, royalFacility, contractIds };
}

export type Industrial = ReturnType<typeof industrialState>;

/**
 * أرضية الخدمات الحرجة: وزارة خدمات قائمة ومِجسّ مصادر صريح يبدأ بمصادر التهيئة كلها.
 * تغيير المصدر هنا يمثل حقيقة تشغيلية فقط؛ لا يخمّنها التشغيل ولا يعيد المصدر الناقص.
 */
export function criticalState(options: { now?: number; configDir?: string } = {}) {
  const now = options.now ?? T0;
  const s = bootstrapState({ now, configDir: options.configDir });
  const royal = (target: string, at = now) =>
    s.king.issueCommand('amend_policy', target, { kind: 'services' }, at);
  const royalService = (target: string, at = now) =>
    s.king.issueCommand('establish_service', target, { kind: 'services' }, at);
  s.ministries.establish(royal(SERVICES), {
    ministryId: SERVICES,
    name: 'وزارة الخدمات البرمجية',
    mandate: ['critical_services'],
    proposedBy: ROYAL_COURT,
  }, now);
  const availability = new Map(s.servicesConfig.sources.map((source) => [source.id, true]));
  const sourceProbe = (sourceId: string) => availability.get(sourceId) === true;
  s.hospitals.bindSourceProbe(sourceProbe);
  s.labs.bindSourceProbe(sourceProbe);
  const setSource = (sourceId: string, available: boolean) => { availability.set(sourceId, available); };
  return { s, now, royal, royalService, availability, setSource };
}

export type Critical = ReturnType<typeof criticalState>;

/**
 * أرضية المرحلة 30: وزارتا البحث والخدمات قائمتان فعليًا، فالقسم لا يأخذ وظيفة من قائمة
 * يدوية بل من سجل الوزارات. لا يُنشأ قسم أو بحث عند الإقلاع.
 */
export function researchState(options: { now?: number; configDir?: string } = {}) {
  const now = options.now ?? T0;
  const s = bootstrapState({ now, configDir: options.configDir });
  const royal = (target: string, at = now) =>
    s.king.issueCommand('amend_policy', target, { kind: 'research' }, at);
  const royalResearch = (target: string, at = now) =>
    s.king.issueCommand('establish_research', target, { kind: 'research' }, at);
  for (const [ministryId, name, mandate] of [
    [RESEARCH, 'وزارة البحث', ['research']],
    [SERVICES, 'وزارة الخدمات', ['services']],
  ] as const) {
    const established = s.ministries.establish(royal(ministryId), {
      ministryId, name, mandate, proposedBy: ROYAL_COURT,
    }, now);
    if (!established.ok) throw new Error(`تعذر تأسيس مهاد البحث: ${ministryId}`);
  }
  return { s, now, royal, royalResearch };
}

export type ResearchState = ReturnType<typeof researchState>;

/** يضيف وظيفة وزارة فعلية لاختبار أن سجل الفجوات يقرأ الواقع لا قائمة ثابتة. */
export function establishResearchFunction(h: ResearchState, ministryId: string, domain: string) {
  return h.s.ministries.establish(h.royal(ministryId), {
    ministryId, name: `وزارة ${domain}`, mandate: [domain], proposedBy: ROYAL_COURT,
  }, h.now);
}

/** إقامة قسم مرآة مؤقت لوظيفة وزارة قائمة؛ لا يوجد مسار إنشاء يدوي خارج التاج. */
export function establishMirror(
  h: ResearchState,
  options: { departmentId?: string; functionMinistry?: string; days?: number; expiresAt?: number; at?: number } = {},
) {
  const at = options.at ?? h.now;
  const departmentId = options.departmentId ?? MIRROR_SERVICES;
  return h.s.mirrorDepartments.establish(h.royalResearch(departmentId, at), {
    departmentId,
    functionMinistry: options.functionMinistry ?? SERVICES,
    proposedBy: RESEARCH,
    expiresAt: options.expiresAt ?? at + (options.days ?? 30) * DAY,
    purpose: 'دراسة نظير بشري لوظيفة وزارة قائمة بمصادر معلنة',
  }, at);
}

/** بدء بحث نظري؛ المعاملات الافتراضية تمثل المسار المسموح الوحيد. */
export function startResearch(
  h: ResearchState,
  options: {
    researchId?: string; departmentId?: string; functionMinistry?: string; sourceIds?: readonly string[];
    studyType?: 'theoretical' | 'experiment' | 'intervention' | 'observation' | 'survey' | 'questionnaire' | 'contact';
    egressCalls?: number; researcher?: string; beneficiary?: string; days?: number; expiresAt?: number; at?: number;
  } = {},
) {
  const at = options.at ?? h.now;
  const researchId = options.researchId ?? RESEARCH_CASE;
  return h.s.humanResearch.start(h.royalResearch(researchId, at), {
    researchId,
    departmentId: options.departmentId ?? MIRROR_SERVICES,
    functionMinistry: options.functionMinistry ?? SERVICES,
    sourceIds: options.sourceIds ?? [RESEARCH_SOURCES[0]],
    studyType: options.studyType ?? 'theoretical',
    egressCalls: options.egressCalls ?? 0,
    researcher: options.researcher ?? RESEARCH,
    beneficiary: options.beneficiary ?? AGENT,
    purpose: 'بحث نظري معلن في النظير البشري لوظيفة برمجية',
    expiresAt: options.expiresAt ?? at + (options.days ?? 10) * DAY,
  }, at);
}

export function completeResearch(h: ResearchState, researchId = RESEARCH_CASE, at = h.now) {
  return h.s.humanResearch.complete(h.royalResearch(researchId, at), researchId, RESEARCH, at);
}

export function proposeLesson(
  h: ResearchState, options: { lessonId?: string; researchId?: string; qualityScore?: number; proposedBy?: string; at?: number } = {},
) {
  return h.s.humanResearch.proposeLesson({
    lessonId: options.lessonId ?? LESSON,
    researchId: options.researchId ?? RESEARCH_CASE,
    statement: 'يوثق الدرس مراجعة مستقلة قبل اعتماد التوصية البرمجية',
    qualityScore: options.qualityScore ?? 70,
    proposedBy: options.proposedBy ?? RESEARCH,
  }, options.at ?? h.now);
}

export function approveLesson(h: ResearchState, lessonId = LESSON, approvedBy = AUDITOR, at = h.now) {
  return h.s.humanResearch.approveLesson(h.royalResearch(lessonId, at), lessonId, approvedBy, at);
}

/** إقامة مستشفى برمجي مؤقت؛ لا ينشأ إلا بأمر establish_service. */
export function establishHospital(
  h: Critical,
  options: { serviceId?: string; declarationId?: string; days?: number; expiresAt?: number; at?: number } = {},
) {
  const at = options.at ?? h.now;
  const serviceId = options.serviceId ?? HOSPITAL;
  return h.s.hospitals.establish(h.royalService(serviceId, at), {
    serviceId,
    declarationId: options.declarationId ?? HOSPITAL_DECLARATION,
    expiresAt: options.expiresAt ?? at + (options.days ?? 30) * DAY,
    proposedBy: SERVICES,
    purpose: 'خدمة برمجية معلنة لوكيل مسجل',
  }, at);
}

/** إقامة مختبر برمجي مؤقت؛ حقائق فحوصه تُمرّر لاحقًا إلى مراقبة الجودة المستقلة. */
export function establishLab(
  h: Critical,
  options: { serviceId?: string; declarationId?: string; days?: number; expiresAt?: number; at?: number } = {},
) {
  const at = options.at ?? h.now;
  const serviceId = options.serviceId ?? LAB;
  return h.s.labs.establish(h.royalService(serviceId, at), {
    serviceId,
    declarationId: options.declarationId ?? LAB_DECLARATION,
    expiresAt: options.expiresAt ?? at + (options.days ?? 30) * DAY,
    proposedBy: SERVICES,
    purpose: 'مختبر برمجي معلن لوكيل مسجل',
  }, at);
}

/** طلب تشغيل خدمة معلنة لمستفيد وكيل؛ لا يحمل أي بيانات شخصية أو بشرية. */
export function serviceOperation(
  h: Critical, serviceId: string, operationId: string,
  options: { beneficiary?: string; purpose?: string; at?: number; requestedBy?: string } = {},
) {
  return h.s.hospitals.execute(serviceId, {
    operationId,
    beneficiary: options.beneficiary ?? AGENT,
    purpose: options.purpose ?? 'تشغيل برمجي معلن',
    requestedBy: options.requestedBy,
  }, options.at ?? h.now);
}

/** إجراء نتيجة مختبر معلقة؛ الاعتماد منفصل في QualityControl. */
export function performLab(
  h: Critical, resultId = 'result:lab-1',
  options: {
    serviceId?: string; operationId?: string; beneficiary?: string; observedChecks?: Record<string, boolean>;
    at?: number; requestedBy?: string;
  } = {},
) {
  const observedChecks = options.observedChecks ?? Object.fromEntries(
    Object.keys(h.s.servicesConfig.quality_checks).map((check) => [check, true]),
  );
  return h.s.labs.perform(options.serviceId ?? LAB, {
    resultId,
    operationId: options.operationId ?? 'operation:screen',
    beneficiary: options.beneficiary ?? AGENT,
    purpose: 'فحص مختبر برمجي معلن',
    requestedBy: options.requestedBy,
    observedChecks,
  }, options.at ?? h.now);
}

/** تحقق تعافٍ كامل بجهة ديوان التدقيق، منفصل عن مراقب فقد المصدر. */
export function recoverHospital(
  h: Critical, serviceId = HOSPITAL,
  options: { verifiedBy?: string; verifiedSources?: readonly string[]; at?: number; note?: string } = {},
) {
  const at = options.at ?? h.now;
  return h.s.hospitals.verifyRecovery(h.royalService(serviceId, at), serviceId, {
    verifiedBy: options.verifiedBy ?? AUDITOR,
    verifiedSources: options.verifiedSources ?? HOSPITAL_SOURCES,
    note: options.note ?? 'تحقق مستقل معلن من سلامة المصادر العائدة',
  }, at);
}

/** إقامة منشأة — الطريق الوحيد: أمر ملكي بفعل establish_facility هدفه معرّف المنشأة */
export function establish(
  h: Industrial,
  options: {
    facilityId?: string; kindId?: string; days?: number; expiresAt?: number;
    budgetLine?: string; proposedBy?: string; purpose?: string; at?: number;
  } = {},
) {
  const at = options.at ?? h.now;
  const facilityId = options.facilityId ?? FACILITY;
  return h.s.companies.establish(h.royalFacility(facilityId, at), {
    facilityId, kindId: options.kindId ?? KIND_INDEX,
    expiresAt: options.expiresAt ?? at + (options.days ?? 30) * DAY,
    budgetLine: options.budgetLine ?? BUDGET_LINE,
    proposedBy: options.proposedBy ?? ECONOMY,
    purpose: options.purpose ?? 'إنتاج فهرس مُنقّى ضمن حدود معلنة',
  }, at);
}

/** استلام مادة خارجية على عقد قائم — سندٌ لا اسم */
export function stockExternal(
  h: Industrial, materialId: string, quantity: number,
  options: { facilityId?: string; at?: number; contractId?: string } = {},
) {
  const counterparty = materialId === BLOCK ? ARCHIVE_CP : COMPUTE_CP;
  return h.s.supply.receive(
    options.facilityId ?? FACILITY, materialId, quantity,
    { kind: 'external_contract', contractId: options.contractId ?? h.contractIds[counterparty] as string },
    ECONOMY, options.at ?? h.now,
  );
}

/** بدء دفعة إنتاج بمدخلات مُقاسة */
export function startRun(
  h: Industrial, runId: string, inputs: Record<string, number>,
  options: { facilityId?: string; at?: number; wastePerMille?: number; by?: string } = {},
) {
  return h.s.factories.start(options.facilityId ?? FACILITY, {
    runId, inputs, wastePerMille: options.wastePerMille, by: options.by,
  }, options.at ?? h.now);
}

/** إقفال دفعة بتفتيش مستقل — المفتّش ديوان المحاسبة لا وزارة الاقتصاد (RULE-004) */
export function inspect(
  h: Industrial, runId: string,
  passed: readonly string[] = CHECKS, options: { inspector?: string; at?: number } = {},
) {
  return h.s.factories.complete(runId, {
    inspector: options.inspector ?? AUDITOR, passed, note: 'تفتيش معلن بفحوص مصرَّحة',
  }, options.at ?? h.now);
}

/** نبض ملكي عند زمن مُعطى — كل تقدّم زمني يتجاوز مدة السماح يلزمه نبض (RULE-007) */
export function beat(h: Industrial, at: number): void {
  h.s.heartbeat.beat(h.s.king.kingId, at);
}
