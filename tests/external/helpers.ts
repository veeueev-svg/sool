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
