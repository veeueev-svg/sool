/**
 * src/economy/ledger_types.ts — أشكالُ الدفترِ المزدوج (أُخرجت من ledger.ts في W-2026-042)
 * المالك: وزارة المالية | المرحلة: 25 (والإخراج: 40 — T-165)
 * المدخلات: لا شيء — أنواعٌ وثابتٌ واحد | المخرجات: أشكالُ الحسابِ والقيدِ والنتيجةِ والميزان
 * التبعيات: EntityId وحده | الصلاحيات: لا شيء | السجلات: لا شيء | حالات الفشل: لا شيء
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts · tests/economy/ledger_entry_guard.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 *
 * النقلُ حرفيٌّ بلا تغييرِ شكلٍ واحد، وledger.ts يُعيد تصديرَ كلِّ ما هنا فلا يتغيّر مُنادٍ.
 * والدافعُ عملٌ لا تجميل: ledger.ts كان 396 سطرًا من سقفِ 400 فلا فسحةَ لحرسِ T-165.
 */
import { EntityId } from '../kernel/types';

/** أنواع الحسابات — الأصول والمصروف مدينة بطبعها، والبقية دائنة */
export type AccountKind = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export const DEBIT_NATURED: readonly AccountKind[] = ['asset', 'expense'];

export interface Account {
  readonly accountId: string;
  readonly kind: AccountKind;
  readonly name: string;
  readonly openedAt: number;
}

/** طرف واحد من القيد: مدين أو دائن، لا الاثنين ولا لا شيء */
export interface EntryLine {
  readonly account: string;
  readonly debit?: number;
  readonly credit?: number;
}

export interface EntryInput {
  readonly entryId: string;
  readonly memo: string;
  readonly lines: readonly EntryLine[];
  readonly by: EntityId;
}

export interface LedgerEntry {
  readonly entryId: string;
  readonly memo: string;
  readonly lines: readonly EntryLine[];
  readonly by: EntityId;
  readonly at: number;
  readonly total: number;
  /** معرّف القيد الذي يعكسه هذا القيد — إن كان تصحيحًا */
  readonly reverses: string | null;
  readonly auditId: string;
}

export type LedgerResult =
  | { readonly ok: true; readonly entry: LedgerEntry; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface TrialBalance {
  readonly debits: number;
  readonly credits: number;
  readonly balanced: boolean;
  readonly accounts: number;
  readonly entries: number;
}

/**
 * حرسُ القيدِ المحجوز (T-165): يُربط بالدفترِ مرّةً من التركيب فيُرجع سببَ الرفضِ أو `null`.
 * يرى القيدَ كاملًا لا حسابًا واحدًا — فقيدٌ يمسّ نطاقًا محجوزًا من أيِّ طرفٍ يُسأل عنه مالكُه.
 */
export type EntryGuard = (input: EntryInput, now: number) => string | null;
