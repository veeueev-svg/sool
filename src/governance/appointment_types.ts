/**
 * src/governance/appointment_types.ts — أشكالُ التعيين والعزل وثوابتُ جهاتِه (المرحلة 39 — T-126)
 * المالك: الديوان الملكي | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: لا شيء — ملفُّ أشكالٍ وثوابتَ لا سلوك فيه
 * المخرجات: الأشكالُ التي يتقاسمها سجلُّ التعيينات وبابُ إرجاعه ووحدةُ الإرجاع
 * التبعيات: `kernel/types` وحدها | الصلاحيات: لا شيء — لا يقرّر ولا يُقيّد سجلًا
 * السجلات: لا سجلَّ له؛ من يستعمله يُقيّد فعلَه
 * حالات الفشل: لا شيء — ولا يُضاف إليه سلوكٌ يُخفي فشلًا
 * ثوابت هذه الوحدة:
 *   1) **أُخرجت من `appointments.ts` لسببٍ لا لتنظيم**: البندُ T-126 يضيف بابَ تدوينٍ
 *      وبابَ إرجاعٍ إلى ملفٍ كان 344 سطرًا، والسقفُ المعلن 400 سطرًا حدٌّ لا زينة
 *      (البندُ T-113، وسابقتُها `account_types.ts` في T-125).
 *   2) **الأشكالُ وحدها لا السلوك**: من قرأ هذا الملفَ لا يجد فعلًا يُغيّر حالةً — فلا
 *      يُظنُّ أنّ ثمّة بابَ تعيينٍ ثانيًا خارج `AppointmentRegistry`.
 *   3) **تُصدَّر ثانيةً من `appointments.ts`**: مسارُ الاستيراد القديم يبقى صحيحًا،
 *      فلا يُكسر مستوردٌ باسم الهيكلة (RULE-008).
 * اختبار القبول: tests/governance/appointments.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0032-governance-durability.md
 */
import type { EntityId } from '../kernel/types';

/** الجهة المنفّذة للتعيين والعزل — لا تقترح ولا تعتمد (RULE-004) */
export const APPOINTMENT_EXECUTOR: EntityId = 'authority:crown_guard';
/** الجهة المدقّقة — تراجع السلاسل ولا تصنعها */
export const APPOINTMENT_AUDITOR: EntityId = 'authority:audit_bureau';
/** مدة صلاحية الاعتماد غير المنفَّذ: سبعة أيام معلنة لا مخفية */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfficeDefinition {
  readonly officeId: string;
  readonly title: string;
  readonly ministryId: EntityId;
  /** مناصب لا تُجمع مع هذا المنصب في شخص واحد */
  readonly conflictsWith: readonly string[];
}

export type ProposalKind = 'appointment' | 'dismissal';
export type ProposalStatus = 'proposed' | 'approved' | 'executed' | 'expired' | 'refused';

export interface Proposal {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly officeId: string;
  /** المرشَّح للتعيين، أو صاحب المنصب المطلوب عزله */
  readonly subject: EntityId;
  readonly reason: string;
  readonly proposedBy: EntityId;
  readonly proposedAt: number;
  readonly status: ProposalStatus;
  readonly approvedBy: EntityId | null;
  readonly approvedAt: number | null;
  readonly commandId: string | null;
  readonly executedBy: EntityId | null;
  readonly executedAt: number | null;
}

export interface OfficeHolder {
  readonly officeId: string;
  readonly holder: EntityId;
  readonly since: number;
  /** سلسلة المشروعية: بصمات سجلات الاقتراح والاعتماد والتنفيذ */
  readonly chain: { readonly proposed: string; readonly approved: string; readonly executed: string };
}

/**
 * أثرُ الاقتراح: بصماتُ سجلاتِه بأطوارها. يُدوَّن مع الاقتراح لا منفصلًا عنه (T-126):
 * اعتمادٌ ينجو الإطفاءَ بلا بصمةِ اعتمادِه لا يُنفَّذ («سلسلة المشروعية ناقصة»)،
 * فتدوينُ الحالةِ دون أثرِها يُبقي الاعتمادَ ميتًا وهو حاضرٌ في السجل.
 */
export interface ProposalTrail {
  proposed: string;
  approved?: string;
  executed?: string;
}

export type AppointmentResult =
  | { readonly ok: true; readonly proposal: Proposal; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** لقطةُ سجلِّ التعيينات كما تُجمع من اليوميّة — تُفحص قبل تثبيتها */
export interface AppointmentSnapshot {
  readonly offices: readonly OfficeDefinition[];
  readonly proposals: readonly { readonly proposal: Proposal; readonly trail: ProposalTrail }[];
  readonly holders: readonly OfficeHolder[];
}
