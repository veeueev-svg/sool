/**
 * src/external/account_view.ts — قراءةُ حالِ الحساب الخارجيّ وتقريرُه (المرحلة 39 — T-125)
 * المالك: وزارة الخارجية | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: خريطةُ الحسابات وخريطةُ النظائر المعلنة ومُوَقِّتٌ ورصيدٌ من الدفتر
 * المخرجات: حكمُ «قائم/غير قائم» بسببه، وتقريرٌ معدود
 * التبعيات: أشكالُ `account_registry.ts` وحدها — لا سجلَّ ولا بوابةَ ولا دفترَ مباشرةً
 * الصلاحيات: قراءةٌ فقط. لا تُغيّر حسابًا ولا تُقيّد سجلًّا
 * السجلات: لا شيء — القارئُ لا يُقيّد، والمُقيِّدُ هو من يُغيّر (RULE-006)
 *
 * ثوابت هذه الوحدة:
 *   1) **القراءةُ تُفصل عن التغيير**: أُخرجت هذه الدوالُّ من `account_registry.ts` في
 *      الجلسة 38 لتُخفَض وحدةٌ فوق السقف (البند T-113) لا لتُجمَّل — والسقّاطةُ تُنقص
 *      الدَّينَ ولا تُبقيه: صفُّ الاستثناء في `scripts/limits/module_limits.yaml` نزل بالفعل.
 *   2) **الرفضُ لا يكون بلا بيان** (RULE-006): لكلِّ حالِ عدمِ قيامٍ سببٌ منطوقٌ واحد،
 *      ومن أراد الحكمَ وحده فله `isAccountActive` — والسببُ لا يُخترع في موضع الرفض.
 *   3) **ما دُفع يُقرأ من الدفتر**: التقريرُ يستدعي قارئَ رصيدٍ يُمرَّر إليه، فلا يحمل
 *      عدّادًا موازيًا يُصدَّق دون الدفتر (ثابت 8 في `account_registry.ts`).
 *
 * حالات الفشل (كلها مغلقة): حسابٌ غير موجود ⇒ «غير معلن ولا مفتوح» لا استثناء
 * اختبار القبول: tests/external/external_accounts.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0031-fiscal-durability.md
 */
import type { ExternalAccount } from './account_registry';

export interface AccountReport {
  readonly declared: number;
  readonly opened: number;
  readonly active: number;
  readonly suspended: number;
  readonly closed: number;
  readonly paidTotal: number;
  readonly unitConvertible: boolean;
  readonly maxTermMs: number;
}

/** ثابت 2: الحكمُ وحدَه — موجودٌ وغيرُ مغلقٍ وغيرُ معلَّقٍ وغيرُ منتهي المدّة */
export function isAccountActive(account: ExternalAccount | undefined, now: number): boolean {
  if (!account) return false;
  return account.closedAt === null && !account.suspended && account.expiresAt > now;
}

/** ثابت 2: السببُ منطوقًا — و`null` تعني «قائمٌ فلا سبب» */
export function accountInactiveReason(
  account: ExternalAccount | undefined, now: number,
): string | null {
  if (!account) return 'حساب خارجي غير معلن ولا مفتوح';
  if (account.closedAt !== null) return 'حساب مغلق';
  if (account.suspended) return `حساب معلَّق: ${account.suspendedReason ?? 'بلا بيان'}`;
  if (account.expiresAt <= now) return 'انتهت مدة الحساب — لا تمديد ضمني';
  return null;
}

/** ثابت 3: المدفوعُ يُجمع بقارئِ رصيدٍ من الدفتر لا بعدّادٍ محليّ */
export function buildAccountReport(input: {
  readonly accounts: readonly ExternalAccount[];
  readonly declaredCount: number;
  readonly now: number;
  readonly paidOf: (account: ExternalAccount) => number;
  readonly unitConvertible: boolean;
  readonly maxTermMs: number;
}): AccountReport {
  let suspended = 0;
  let closed = 0;
  let paid = 0;
  let active = 0;
  for (const account of input.accounts) {
    if (account.suspended) suspended += 1;
    if (account.closedAt !== null) closed += 1;
    if (isAccountActive(account, input.now)) active += 1;
    paid += input.paidOf(account);
  }
  return {
    declared: input.declaredCount, opened: input.accounts.length, active, suspended, closed,
    paidTotal: paid, unitConvertible: input.unitConvertible, maxTermMs: input.maxTermMs,
  };
}
