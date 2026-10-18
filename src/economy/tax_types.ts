/**
 * src/economy/tax_types.ts — أنواعُ الرسوم: التقديرُ ونتيجتُه ونتيجةُ تعديلِ النسبة (المرحلة 25 · T-53)
 * فُكِّكت من src/economy/tax.ts لسقفِ الوحدةِ 400 سطرًا (الجلسة 136 · W-2026-065 — سابقةُ T-125 وrate_policy):
 * الأنواعُ نفسُها بحروفِها بلا تغييرٍ في الشكلِ أو المعنى، ويُعيدُ tax.ts تصديرَها فلا يتغيّرُ مستوردٌ.
 * الجلسة 139 (علاجُ عيبَي الجولة 41 · W-2026-065): أُضيفَ هنا معقّمُ القيدِ auditPrimitive
 * لسقفِ tax.ts نفسِه (399/400): قيدُ الرفضِ لا يحملُ مرجعًا حيًّا (ثابت 12) — وكلُّ مُسندٍ باقٍ بحروفِه.
 * الجلسة 141 (علاجُ عيبِ الجولة 43 · W-2026-065): نُقلَ حرفيًا إلى هنا واجهةُ RevenueDeps
 * لسقفِ tax.ts نفسِه (الواجهةُ بحروفِها بلا تغييرٍ — سابقةُ الجلستين 133 و136) مع حارسِ issuedAt.
 * المالك: وزارة المالية تحت التاج | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md
 */
import { EntityId } from '../kernel/types';
import type { AppendOnlyLog } from '../audit/append_only_log';
import type { CrownGateway } from '../crown/crown_gateway';
import type { Treasury } from './treasury';
import type { RateDeclaration } from './rate_policy';

export type LevyStatus = 'assessed' | 'collected' | 'waived';

/** واجهةُ تبعياتِ خدمةِ الرسوم (فُكِّكت من tax.ts بحروفِها — الجلسة 141 · لسقفِ الوحدة) */
export interface RevenueDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly treasury: Treasury;
  readonly revenueAccount: string;
  /** النِسَب المعلنة في config/economy.yaml (ثابت 1) */
  readonly rates: readonly RateDeclaration[];
  /** هل يُسمح بالأثر الرجعي؟ معلن في التهيئة، وقيمته الملزمة: لا (ثابت 2) */
  readonly retroactiveAllowed: boolean;
  readonly actorId?: EntityId;
}

export interface Levy {
  readonly levyId: string;
  readonly base: string;
  readonly payer: EntityId;
  readonly amountBase: number;
  readonly ratePerMille: number;
  readonly levied: number;
  readonly status: LevyStatus;
  readonly occurredAt: number;
  readonly assessedAt: number;
  readonly collectedAt: number | null;
  readonly receiptEntryId: string | null;
  readonly waiveReason: string | null;
}

export type LevyResult =
  | { readonly ok: true; readonly levy: Levy; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** نتيجةُ تعديلِ النسبةِ الملكيّ (T-53): الإعلانُ الجديدُ والسابقُ معًا أو رفضٌ بسببٍ موثّق */
export type RateAmendmentResult =
  | { readonly ok: true; readonly declaration: RateDeclaration; readonly previous: RateDeclaration; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** ثابت 12 (الجولة 41 · علاجُ الجلسة 139): المدخلُ غيرُ البدائيِّ لا يُخزَّنُ مرجعُه الحيُّ في قيدِ
 *  الرفض — يُقنَّعُ برمزٍ مغلقٍ قبلَ التدوينِ فلا يعبثُ المستدعي بالسلسلةِ بعدَ الرفضِ ولا يُقتلُ الإقلاع */
export function auditPrimitive(value: unknown): unknown {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
    ? value
    : 'مدخلٌ غيرُ بدائيٍّ — لا يُخزَّنُ مرجعُهُ الحيُّ (ثابت 12)';
}
