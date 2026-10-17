/**
 * src/economy/tax_types.ts — أنواعُ الرسوم: التقديرُ ونتيجتُه ونتيجةُ تعديلِ النسبة (المرحلة 25 · T-53)
 * فُكِّكت من src/economy/tax.ts لسقفِ الوحدةِ 400 سطرًا (الجلسة 136 · W-2026-065 — سابقةُ T-125 وrate_policy):
 * الأنواعُ نفسُها بحروفِها بلا تغييرٍ في الشكلِ أو المعنى، ويُعيدُ tax.ts تصديرَها فلا يتغيّرُ مستوردٌ.
 * المالك: وزارة المالية تحت التاج | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md
 */
import { EntityId } from '../kernel/types';
import type { RateDeclaration } from './rate_policy';

export type LevyStatus = 'assessed' | 'collected' | 'waived';

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
