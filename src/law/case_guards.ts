/**
 * src/law/case_guards.ts — حرَس مداخل الدعوى: التعليمُ فعلٌ محروس لا حقلٌ يُكتب (المرحلة 39، البند T-114)
 * المالك: وزارة العدل (والحرَس مقروءٌ للمدقّق — لا يخفيه مسار استدعاء)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: حالُ الدعوى كما هو (`GuardedCase`) + الفاعل + قوائم الجهات المعلنة
 * المخرجات: `null` إن جاز الفعل، أو **نصُّ سبب الرفض** — والرفضُ يُقيَّده المُنادي في السلسلة
 * التبعيات: `./authorities` و`../kernel/types` فقط — لا تستورد المحكمة ولا التنفيذ (لا دور)
 * الصلاحيات (RULE-004): من حكم لا يُعلن التنفيذ، ومن اتهم لا يُعلنه، والتنفيذ لجهته المعلنة
 * السجلات: لا يكتب الحرَس سجلًّا — يرجع السبب، ويكتبه المُنادي بحدث رفضه المعلن
 * حالات الفشل (كلها مغلقة): جهة غير مخوَّلة ⇒ رفض؛ لا حكم ⇒ رفض؛ غير مُدان ⇒ رفض؛
 *   طعن قائم ⇒ رفض؛ ما لم تُثبَّت نهائيته ⇒ رفض؛ منفَّذ سابقًا ⇒ رفض؛ معرّف طعنٍ لا يخصّ الدعوى ⇒ رفض
 * اختبار القبول: tests/law/court_guards.test.ts
 * الوثيقة المرتبطة: docs/audit/criteria/C-14.md · docs/test-reports/phase-39.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **التعليقُ ليس حرَسًا (RULE-001).** كُتب هذا الملفّ لأن `court.markEnforced`
 *    و`court.markAppealPending` كانا مكشوفين على السطح العام وعليهما تعليقٌ يقول
 *    «يُستدعى من التنفيذ»؛ وقياسُ التدقيق (الفحص C-14ب) أعلن التنفيذَ بنداءٍ مباشر
 *    من كيانٍ ليس جهةَ تنفيذ ولدعوى لم يُحكم فيها. الحرَسُ الآن **في المدخل** لا في نيّة المُنادي.
 *
 * 2) **الشرطُ يُعاد لا يُحال.** شروط `Enforcement.execute` تبقى كما هي، ويُعيدها الحرَس
 *    عند حدّ المحكمة: من دخل من الطريق الصحيح يمرّ مرتين بالشرط نفسه، ومن دخل من غيره يُرفض.
 *
 * 3) **الحرَسُ دالّةٌ نقيّة**: لا يُعدّل دعوى ولا يكتب سجلًّا ولا يقرأ وقتًا من نفسه —
 *    فيمكن اختباره وحده، ولا يصير بوابةً بأثرٍ خفيّ.
 *
 * 4) **الرفضُ بنصٍّ معلن** مطابقٍ لنصوص `Enforcement.execute`، كي لا يظهر للفاعل سببان
 *    مختلفان لمنعٍ واحد.
 */
import { EntityId } from '../kernel/types';
import { ENFORCEMENT_AUTHORITIES } from './authorities';

/** أقلُّ ما يحتاجه الحرَس من الدعوى — شكلٌ لا صنف، فلا تبعية على المحكمة */
export interface GuardedCase {
  readonly caseId: string;
  readonly defendant: EntityId;
  readonly prosecutor: EntityId;
  readonly ruling: { readonly judge: EntityId; readonly guilty: boolean } | null;
  readonly appeal: unknown | null;
  readonly appealPending: boolean;
  readonly status: string;
}

/** جهاتُ من له مصلحة في الطعن — المحكوم عليه أو محاميه العام أو الادعاء */
export function appealPartiesOf(
  c: GuardedCase, publicDefender: EntityId,
): readonly EntityId[] {
  return [c.defendant, publicDefender, c.prosecutor];
}

/**
 * حرَس **إعلان التنفيذ** في الدعوى.
 * يُرجع `null` إن جاز الإعلان، أو نصَّ سبب الرفض.
 */
export function guardEnforcementMark(
  c: GuardedCase | undefined,
  by: EntityId,
  enforcementAuthorities: readonly EntityId[] = ENFORCEMENT_AUTHORITIES,
): string | null {
  if (!c) return 'دعوى غير موجودة';
  // 1) الجهة: التنفيذ لجهته المعلنة، ولا تُعلَن لحظةُ التنفيذ باسم غيرها
  if (!enforcementAuthorities.includes(by)) return 'جهة غير مخوَّلة بالتنفيذ';
  // 2) فصلُ الأدوار: من حكم لا ينفّذ، ومن اتهم لا ينفّذ (RULE-004)
  if (c.ruling && by === c.ruling.judge) return 'من حكم لا ينفّذ (RULE-004)';
  if (by === c.prosecutor) return 'من اتهم لا ينفّذ (RULE-004)';
  // 3) لا تنفيذ مرتين
  if (c.status === 'enforced') return 'الحكم نُفِّذ سابقًا';
  // 4) لا تنفيذ بلا حكم، ولا على غير مُدان
  if (!c.ruling) return 'لا تنفيذ بلا حكم';
  if (!c.ruling.guilty) return 'لا تنفيذ على غير مُدان — الحكم بالبراءة أو نُقض';
  // 5) طعنٌ قائم يوقف، والنهائية تُثبَّت بسجلٍّ قبل الأثر لا تُفترض
  if (c.appealPending) return 'طعن قائم — التنفيذ موقوف حتى الفصل';
  if (c.status !== 'final') return 'لا تنفيذ قبل نهائية الحكم';
  return null;
}

/**
 * حرَس **تعليق التنفيذ لطعن**.
 * يُرجع `null` إن جاز التعليق، أو نصَّ سبب الرفض.
 */
export function guardAppealMark(
  c: GuardedCase | undefined,
  by: EntityId,
  appealId: string,
  publicDefender: EntityId,
): string | null {
  if (!c) return 'دعوى غير موجودة';
  // 1) لا تعليق بلا حكمٍ يُطعَن فيه
  if (!c.ruling) return 'لا طعن على دعوى بلا حكم';
  // 2) المصلحة: المحكوم عليه أو محاميه العام أو الادعاء — لا كيانٌ ثالث
  if (!appealPartiesOf(c, publicDefender).includes(by)) return 'جهة لا مصلحة لها في الطعن';
  // 3) ما نُفِّذ لا يُعلَّق، وما فُصل فيه لا يُعلَّق مرتين
  if (c.status === 'enforced') return 'الحكم نُفِّذ — لا تعليق بعد التنفيذ';
  if (c.appeal) return 'فُصل في الطعن — لا يُعلَّق مرتين';
  if (c.appealPending) return 'طعن قائم أصلًا';
  // 4) المعرّف يجب أن يخصّ هذه الدعوى — لا تعليق بمعرّفٍ مُلفَّق
  if (!appealId.startsWith(`appeal:${c.caseId}:`)) return 'معرّف طعن لا يخصّ هذه الدعوى';
  return null;
}
