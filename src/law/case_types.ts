/**
 * src/law/case_types.ts — أشكالُ الدعوى: إعلانٌ لا سلوك (المرحلة 39، البند T-114)
 * المالك: وزارة العدل
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: لا شيء — أنواعٌ تُقرأ عند الترجمة لا عند التشغيل
 * المخرجات: `Defense` و`Ruling` و`AppealOutcome` و`LegalCase` و`ChargeInput` و`CaseResult`
 * التبعيات: `../kernel/types` و`./statutes` (نوعُ العقوبة) فقط
 * الصلاحيات (RULE-004): الأشكالُ لا تمنح سلطة؛ من يمنحها الحرَس في `case_guards.ts`
 * السجلات: لا شيء
 * حالات الفشل: لا شيء يُنفَّذ هنا
 * اختبار القبول: tests/law/courts.test.ts · tests/law/court_guards.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **حقولٌ للقراءة فقط** (`readonly`): الدعوى تُستبدل بنسخةٍ جديدة ولا تُعدَّل في مكانها،
 *    فلا يُغيَّر حكمٌ بكتابةٍ فوق حقل.
 *
 * 2) **أُخرجت من `courts.ts`** لأن الملف كان عند سقفه المعلن (404 سطرًا — استثناءُ T-113)
 *    وحرَسُ T-114 يحتاج أسطرًا؛ فأُخرج ما لا يحكم، وحُذف صفُّ الاستثناء بعدها لا رُفع سقفه.
 *
 * 3) **`courts.ts` يُعيد تصدير هذه الأشكال** فلا يتغيّر السطح العام لمن يستوردها من قبل.
 */
import { EntityId } from '../kernel/types';
import { PenaltyKind } from './statutes';

/** الحالات المعلنة للدعوى — التقرير يُحصي عليها ولا يشتقّ مفاتيحه (T-114) */
export const CASE_STATUSES = [
  'charged', 'defended', 'ruled', 'appealed', 'final', 'enforced',
] as const;

export type CaseStatus = 'charged' | 'defended' | 'ruled' | 'appealed' | 'final' | 'enforced';

export interface Defense {
  readonly by: EntityId;
  readonly text: string;
  readonly evidence: readonly string[];
  readonly at: number;
  /** true إذا كان دفاعًا حكميًا بعد سكوت المتهم */
  readonly byDefault: boolean;
}

export interface Ruling {
  readonly judge: EntityId;
  readonly guilty: boolean;
  readonly penalty: PenaltyKind | 'none';
  readonly reason: string;
  readonly at: number;
  readonly statuteVersion: number;
}

export interface AppealOutcome {
  readonly appealId: string;
  readonly panel: EntityId;
  readonly verdict: 'upheld' | 'overturned' | 'reduced';
  readonly penalty: PenaltyKind | 'none';
  readonly reason: string;
  readonly at: number;
  /** true إذا كان الفصل بمراجعة ملكية — لا طعن بعده */
  readonly royal: boolean;
}

export interface LegalCase {
  readonly caseId: string;
  readonly statuteId: string;
  readonly statuteVersion: number;
  readonly defendant: EntityId;
  readonly prosecutor: EntityId;
  readonly chargeText: string;
  readonly evidence: readonly string[];
  readonly occurredAt: number;
  readonly chargedAt: number;
  readonly defense: Defense | null;
  readonly ruling: Ruling | null;
  readonly appeal: AppealOutcome | null;
  readonly appealPending: boolean;
  readonly status: CaseStatus;
  readonly finalAt: number | null;
  readonly enforcedAt: number | null;
  readonly enforcedBy: EntityId | null;
}

export interface ChargeInput {
  readonly caseId: string;
  readonly statuteId: string;
  readonly defendant: EntityId;
  readonly chargeText: string;
  /** بصمات سجلات تدقيق قائمة — الدليل يجب أن يكون قابلًا للتحقق */
  readonly evidence: readonly string[];
  readonly occurredAt: number;
}

export type CaseResult =
  | { readonly ok: true; readonly legalCase: LegalCase; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };
