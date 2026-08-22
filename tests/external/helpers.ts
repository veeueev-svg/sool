/**
 * tests/external/helpers.ts — دولة خارجية كاملة لاختبارات المرحلة 26
 * المالك: وزارة الخارجية تحت التاج | يوثّق في: docs/test-reports/phase-26.md
 * لا يحتوي اختبارًا: يبني الأرضية المشتركة (وزارة، أذونات خروج، إصدار، بند موازنة)
 * حتى لا تُخفي كل حالة اختبار تهيئتها الخاصة فتصير النتائج غير قابلة للمقارنة.
 */
import { ROYAL_COURT, UNIT_TARGET, bootstrapState } from '../../src/index';

export const T0 = Date.now();
export const DAY = 24 * 60 * 60 * 1000;
export const HOUR = 60 * 60 * 1000;
export const FOREIGN = 'ministry:foreign_affairs';
export const COMPUTE = 'external:compute-provider';
export const ARCHIVE = 'external:data-archive';
export const REGISTRY = 'external:model-registry';

/**
 * دولة خارجية جاهزة: وزارة خارجية قائمة، وأذونات خروج معلنة للنظائر الثلاثة،
 * وخزانة ممولة بـ100 مليون، وبند موازنة `budget:foreign` سقفه 60 مليونًا.
 * `egressFor` يحدّد المضيفين الذين يُعلن لهم إذن خروج (للاختبار السلبي).
 */
export function externalState(options: {
  egressFor?: readonly string[]; egressExpiresAt?: number; now?: number;
} = {}) {
  const now = options.now ?? T0;
  const s = bootstrapState({ now });
  const royal = (target: string, at = now) =>
    s.king.issueCommand('amend_policy', target, { kind: 'external' }, at);
  const royalOpen = (target: string, at = now) =>
    s.king.issueCommand('open_external_account', target, { kind: 'external' }, at);

  s.ministries.establish(royal(FOREIGN), {
    ministryId: FOREIGN, name: 'وزارة الخارجية', mandate: ['foreign_affairs'],
    proposedBy: ROYAL_COURT,
  }, now);

  const hosts = options.egressFor
    ?? s.externalConfig.counterparties.map((cp) => cp.host);
  for (const cp of s.externalConfig.counterparties) {
    if (!hosts.includes(cp.host)) continue;
    s.egress.declare(royalOpen(cp.host), {
      host: cp.host, port: cp.port, purpose: cp.purpose,
      expiresAt: options.egressExpiresAt ?? now + 60 * DAY,
      maxCallsPerMinute: 60,
    }, now);
  }

  s.unit.issue(royal(UNIT_TARGET), 100_000_000, 'رأس مال تشغيلي للنوافذ الخارجية', now);
  s.budget.declare(royal('budget:foreign', now), {
    line: 'budget:foreign', owner: FOREIGN, ceiling: 60_000_000,
    periodStart: now, periodEnd: now + 90 * DAY,
  }, now);

  return { s, royal, royalOpen, now };
}

/** فتح حساب خارجي معلن — الطريق الوحيد: أمر ملكي بفعل open_external_account */
export function openAccount(
  h: ReturnType<typeof externalState>, counterparty = COMPUTE, at?: number, termDays = 30,
) {
  const when = at ?? h.now;
  return h.s.externalAccounts.open(h.royalOpen(counterparty, when), {
    counterparty, expiresAt: when + termDays * DAY, requestedBy: FOREIGN,
    justification: 'تشغيل معلن ضمن نطاق وزارة الخارجية',
  }, when);
}

/** نبض ملكي عند زمن مُعطى — كل تقدّم زمني يتجاوز مدة السماح يلزمه نبض (RULE-007) */
export function beat(h: ReturnType<typeof externalState>, at: number): void {
  h.s.heartbeat.beat(h.s.king.kingId, at);
}

/* ————— أرضية العقود الخارجية (المرحلة 27) ————— */

export const AUDITOR = 'authority:audit_bureau';
export const FINANCE = 'ministry:finance';
export const CROWN_GUARD = 'authority:crown_guard';
export const CYBER = 'ministry:cyber_security';
export const KIND_COMPUTE = 'contract:compute-capacity';
export const KIND_ARCHIVE = 'contract:archive-retention';
export const KIND_WEIGHTS = 'contract:model-weights';

/**
 * دولة عقود جاهزة: كل ما تبنيه `externalState` + حساب خارجي مفتوح تسعين يومًا
 * لنظير الحوسبة، حتى تكون مدة العقد (60 يومًا كحدّ) مُختبَرةً على قناة تحتملها —
 * فلا يُخلط رفضُ «مدة العقد» برفضِ «العقد يتجاوز قناته».
 */
export function contractState(options: {
  egressFor?: readonly string[]; egressExpiresAt?: number; now?: number;
  accountTermDays?: number; counterparty?: string;
} = {}) {
  const h = externalState(options);
  openAccount(h, options.counterparty ?? COMPUTE, h.now, options.accountTermDays ?? 90);
  return h;
}

/** تقدير مخاطر معلن — الطريق الوحيد: ديوان التدقيق بعوامل معلنة في التهيئة */
export function assessRisk(
  h: ReturnType<typeof externalState>, kindId = KIND_COMPUTE,
  factors: readonly string[] = [], at?: number,
) {
  return h.s.partnerRisk.assess({
    kindId, factors, assessedBy: AUDITOR,
    justification: 'تقدير معلن لنوع عقد قائم',
  }, at ?? h.now);
}

/** توقيع عقد خارجي — أمر ملكي بفعل open_external_account هدفه معرّف النوع */
export function signContract(
  h: ReturnType<typeof externalState>, kindId = KIND_COMPUTE,
  options: { value?: number; days?: number; endsAt?: number; at?: number } = {},
) {
  const at = options.at ?? h.now;
  const endsAt = options.endsAt ?? at + (options.days ?? 30) * DAY;
  return h.s.contracts.sign(h.royalOpen(kindId, at), {
    kindId, value: options.value ?? 5_000_000, endsAt,
    proposedBy: FOREIGN, purpose: 'تعهّد معلن ضمن نطاق وزارة الخارجية',
  }, at);
}

/** إنهاء عقد — فوري وبأمر ملكي هدفه معرّف العقد نفسه */
export function terminateContract(
  h: ReturnType<typeof externalState>, contractId: string,
  by: string = CROWN_GUARD, at?: number, reason = 'قطع معلن لسبب موثَّق',
) {
  const when = at ?? h.now;
  return h.s.contractTermination.terminate(
    h.royalOpen(contractId, when), contractId, by, reason, when,
  );
}
