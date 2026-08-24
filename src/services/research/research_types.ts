/**
 * src/services/research/research_types.ts — أشكالُ البحث والدرس والتوصية: إعلانٌ لا سلوك (المرحلة 39، البند T-113)
 * المالك: وزارة البحث
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: لا شيء — أنواعٌ تُقرأ عند الترجمة لا عند التشغيل
 * المخرجات: `HumanResearch` و`ResearchInput` و`Lesson` و`LessonInput` و`Recommendation`
 *          ونتائجُها المعلنة و`HumanResearchDeps`
 * التبعيات: `../../audit/append_only_log` و`../../crown/crown_gateway` و`../../kernel/types` فقط
 * الصلاحيات (RULE-004): الأشكالُ لا تمنح سلطة؛ من يمنعُ هو الحرَس في `research_guards.ts`
 * السجلات: لا شيء
 * حالات الفشل: لا شيء يُنفَّذ هنا
 * اختبارات الوحدة: tests/services/human_research.test.ts
 * اختبار القبول: tests/services/research_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0014-human-research.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **نصٌّ منقولٌ حرفيًّا** من `src/services/human_research.ts` بلا إصلاحٍ ولا تحسين —
 *    قاعدةُ ورشة الهيكلة: من خلط التفكيك بالإصلاح لا يستطيع أن ينسب فشلًا إلى أحدهما.
 *
 * 2) **أُخرجت من `human_research.ts`** لأن الملف كان **531** سطرًا — أعلى دَينٍ معلنٍ في
 *    `config/module_limits.yaml` (البند T-113)؛ فأُخرج ما لا يحكم، ويُحذف صفُّ الاستثناء
 *    بعد نزوله تحت السقف العام لا يُرفع سقفُه (سقّاطةُ الدَّين).
 *
 * 3) **`human_research.ts` يُعيد تصدير هذه الأشكال** فلا يتغيّر السطح العام لمن استوردها
 *    من قبل — ولا يُعدَّل مستوردٌ ولا اختبار.
 */
import { AppendOnlyLog } from '../../audit/append_only_log';
import { CrownGateway } from '../../crown/crown_gateway';
import { EntityId } from '../../kernel/types';

export type ResearchStudyType =
  | 'theoretical' | 'experiment' | 'intervention' | 'observation' | 'survey' | 'questionnaire' | 'contact';
export type ResearchStatus = 'active' | 'completed' | 'dissolved';
export type LessonStatus = 'proposed' | 'approved' | 'rejected';

export interface DeclaredResearchSource {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

export interface HumanResearch {
  readonly researchId: string;
  readonly departmentId: string;
  readonly functionMinistry: EntityId;
  readonly sourceIds: readonly string[];
  readonly studyType: ResearchStudyType;
  readonly researcher: EntityId;
  readonly beneficiary: EntityId;
  readonly purpose: string;
  readonly establishedAt: number;
  readonly expiresAt: number;
  readonly commandId: string;
  status: ResearchStatus;
  completedAt: number | null;
  dissolvedAt: number | null;
}

export interface ResearchInput {
  readonly researchId: string;
  readonly departmentId: string;
  readonly functionMinistry: EntityId;
  readonly sourceIds: readonly string[];
  readonly studyType: ResearchStudyType;
  readonly egressCalls: number;
  readonly researcher: EntityId;
  readonly beneficiary: EntityId;
  readonly purpose: string;
  readonly expiresAt: number;
}

export interface Lesson {
  readonly lessonId: string;
  readonly researchId: string;
  readonly statement: string;
  readonly qualityScore: number;
  readonly proposedBy: EntityId;
  readonly proposedAt: number;
  status: LessonStatus;
  approvedBy: EntityId | null;
  approvedAt: number | null;
  reviewedAt: number | null;
  rejectionCode: string | null;
}

export interface LessonInput {
  readonly lessonId: string;
  readonly researchId: string;
  readonly statement: string;
  readonly qualityScore: number;
  readonly proposedBy: EntityId;
}

export interface Recommendation {
  readonly recommendationId: string;
  readonly lessonId: string;
  readonly departmentId: string;
  readonly recommendedFor: EntityId;
  readonly recommendedBy: EntityId;
  readonly text: string;
  readonly recordedAt: number;
  readonly commandId: string;
  readonly applied: false;
}

export type ResearchResult =
  | { readonly ok: true; readonly research: HumanResearch; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };
export type LessonResult =
  | { readonly ok: true; readonly lesson: Lesson; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };
export type RecommendationResult =
  | { readonly ok: true; readonly recommendation: Recommendation; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };

export type ResearchTrace = {
  readonly ok: true;
  readonly lesson: Lesson;
  readonly research: HumanResearch;
  readonly sources: readonly DeclaredResearchSource[];
  readonly auditId: string;
};
export type TraceResult = ResearchTrace | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };
export type SourceInvalidationResult =
  | { readonly ok: true; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };

export type DepartmentActiveProbe = (departmentId: string, now: number) => boolean;

export interface HumanResearchDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly sources: readonly DeclaredResearchSource[];
  readonly maxConcurrentResearches: number;
  readonly maxSourcesPerResearch: number;
  readonly maxTermMs: number;
  readonly reviewIntervalMs: number;
  readonly minLessonQualityScore: number;
  readonly maxEgressCalls: number;
  readonly researchOperator: EntityId;
  readonly lessonApprover: EntityId;
  readonly beneficiaryPrefix: string;
  readonly departmentActive: DepartmentActiveProbe;
  readonly departmentFunction: (departmentId: string) => EntityId | null;
}
