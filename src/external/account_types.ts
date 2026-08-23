/**
 * src/external/account_types.ts — أشكالُ النافذة الخارجيّة (المرحلة 39 — T-125)
 * المالك: وزارة الخارجية | القاعدة الحاكمة RULE-000: كل تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: لا شيء — إعلانُ أشكالٍ لا تنفيذ
 * المخرجات: `DeclaredCounterparty` · `ExternalAccount` · `OpenAccountInput` · `AccountResult`
 *            · `EgressProbe` · `ObligationProbe`
 * التبعيات: `kernel/types` وحدها
 * الصلاحيات: لا شيء
 * السجلات: لا شيء
 *
 * ثوابت هذه الوحدة:
 *   1) **الأشكالُ تُفصل عن الفعل**: أُخرجت من `account_registry.ts` في الجلسة 38 لتُخفَض
 *      وحدةٌ كانت على حدِّ سقفها المُستثنى (البند T-113) — والسقّاطةُ تُنقص الدَّين لا تُبقيه.
 *   2) **`ExternalAccount` كائنٌ يُعدَّل** في حقولِ التعليقِ والإغلاق وحدها؛ وما عداها
 *      `readonly` عن قصد: مضيفٌ أو سقفٌ يتغيّر بعد الفتح نافذةٌ أُخرى بلا أمرٍ ملكيّ.
 *
 * حالات الفشل: لا شيء — لا منطق هنا
 * اختبار القبول: tests/external/external_accounts.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0031-fiscal-durability.md
 */
import type { EntityId } from '../kernel/types';

/** نظير خارجي معلن في config/external.yaml — سقوفه إعلان لا طلب (ثابت 3) */
export interface DeclaredCounterparty {
  readonly id: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly purpose: string;
  readonly singleMax: number;
  readonly dailyMax: number;
  readonly totalCap: number;
}

export interface ExternalAccount {
  readonly accountId: string;
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly purpose: string;
  /** الحساب المقابل في الدفتر المزدوج — كل دفعة تُقيَّد فيه */
  readonly ledgerAccount: string;
  readonly singleMax: number;
  readonly dailyMax: number;
  readonly totalCap: number;
  readonly openedBy: EntityId;
  readonly openedAt: number;
  readonly expiresAt: number;
  readonly commandId: string;
  suspended: boolean;
  suspendedBy: EntityId | null;
  suspendedReason: string | null;
  suspendedAt: number | null;
  closedAt: number | null;
}

export interface OpenAccountInput {
  readonly counterparty: string;
  readonly expiresAt: number;
  readonly requestedBy: EntityId;
  readonly justification: string;
}

export type AccountResult =
  | { readonly ok: true; readonly account: ExternalAccount; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** هل للمضيف إذن خروج معلن غير منتهٍ؟ (ثابت 5) — يُربط من حارس الخروج */
export type EgressProbe = (host: string, port: number, now: number) => boolean;

/** هل للحساب دفعة لم يُقرّ استلامها؟ (ثابت 7) — يُربط من ضوابط الدفع */
export type ObligationProbe = (accountId: string) => number;

