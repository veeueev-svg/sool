/**
 * tests/services/helpers.ts — أرضية الشركات والمصانع لاختبارات المرحلة 28
 * المالك: وزارة الاقتصاد تحت التاج | يوثّق في: docs/test-reports/phase-28.md
 * لا يحتوي اختبارًا: يبني الأرضية المشتركة (وزارة اقتصاد قائمة، بند موازنة، عقد خارجي
 * قائم لكل نظير مادة، منشأة مُقامة) حتى لا تُخفي كل حالة تهيئتها فتصير النتائج غير قابلة
 * للمقارنة — وحتى يُفصَل رفضُ «المدخل» عن رفضِ «القناة» عن رفضِ «الأمر».
 */
import { ROYAL_COURT, UNIT_TARGET, bootstrapState } from '../../src/index';

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
