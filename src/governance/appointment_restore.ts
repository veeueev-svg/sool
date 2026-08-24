/**
 * src/governance/appointment_restore.ts — حرَسُ بابِ إرجاع التعيينات (المرحلة 39 — T-126)
 * المالك: الديوان الملكي | القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق مع تقرير اختبار
 * المدخلات: لقطةُ مناصبَ واقتراحاتٍ وأصحابِ مناصبَ مجموعةٌ من اليوميّة + سائلٌ عن الوزارة
 * المخرجات: لا شيء إن صحّت اللقطة، ورميةُ رمزٍ مغلقٍ إن خرقت ثابتًا
 * التبعيات: `appointment_types` وحدها | الصلاحيات: الفحصُ فقط — لا يُثبّت حالةً ولا يُقيّد سجلًا
 * السجلات: لا سجلَّ له؛ `AppointmentRegistry.restore` تُقيّد استعادتَها بنفسها (RULE-006)
 *
 * ثوابت هذه الوحدة:
 *   1) **الفحصُ كلُّه قبل التثبيت**: يُفحص كلُّ شيءٍ ثم يُثبَّت كلُّ شيء — فلقطةٌ نصفُها
 *      صحيحٌ لا تُقبل نصفًا. ولذلك فُصل الحرَسُ عن التثبيت: مَن يفحص هنا لا يملك
 *      خرائطَ السجل فلا يستطيع تثبيتًا جزئيًّا ولو أراد.
 *   2) **الحرَسُ يحرس ما تحرسه الأبوابُ العاديّة نفسَه**: تعارضُ المناصب (ثابت 3 هناك)،
 *      ومنصبٌ واحدٌ لصاحبٍ واحد (ثابت 5)، ولا منصبَ في وزارةٍ غير معلنة (ثابت 7)،
 *      وسلسلةُ مشروعيّةٍ كاملة لكلِّ صاحبِ منصب — فما يُرفض في الحياة يُرفض في الاستعادة.
 *   3) **الوزارةُ تُسأل ولا تُفترض**: يُمرَّر سائلٌ عن وجود الوزارة، فترتيبُ الأبواب
 *      (الوزاراتُ أوّلًا) شرطٌ يُفحَص لا عُرفٌ يُرجى — وترتيبٌ معكوسٌ يُرفض برمزه.
 *   4) **الوزارةُ المحلولةُ لا تُبطل منصبَها**: المنصبُ في وزارةٍ محلولةٍ يُقبل في السجل
 *      (تاريخٌ لا يُمحى)، وإنّما تمنع الأبوابُ الحيّةُ شغلَه — فالاستعادةُ لا تُصحّح تاريخًا.
 *
 * حالات الفشل (كلها مغلقة برموزها لا بنصوصها):
 *   منصبٌ بمعرّفٍ لا يبدأ بـ office: أو مكرَّر ⇒ RECOVERY_OFFICE_INVALID ·
 *   منصبٌ لوزارةٍ لا يعرفها سجلُّ الوزارات ⇒ RECOVERY_OFFICE_MINISTRY_MISSING ·
 *   اقتراحٌ لمنصبٍ غير معلن ⇒ RECOVERY_PROPOSAL_OFFICE_MISSING ·
 *   اقتراحٌ حيٌّ بلا بصمةِ اقتراحه، أو معتمدٌ بلا بصمةِ اعتماده ⇒ RECOVERY_PROPOSAL_TRAIL_MISSING ·
 *   صاحبُ منصبٍ غير معلن ⇒ RECOVERY_HOLDER_OFFICE_MISSING ·
 *   صاحبُ منصبٍ بسلسلةٍ ناقصة ⇒ RECOVERY_HOLDER_CHAIN_INCOMPLETE ·
 *   شخصٌ يجمع منصبَين متعارضَين ⇒ RECOVERY_HOLDER_CONFLICT
 * اختبار القبول: tests/data/rehydrate_governance.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0032-governance-durability.md
 */
import type { EntityId } from '../kernel/types';
import type { AppointmentSnapshot, OfficeDefinition } from './appointment_types';

/** سائلٌ عن الوزارة: أهي معروفةٌ لسجلِّ الوزارات؟ (قائمةً كانت أو محلولة — ثابت 4) */
export type MinistryKnownProbe = (ministryId: EntityId) => boolean;

/**
 * يفحص اللقطةَ فحصًا كاملًا قبل أن تُثبَّت. لا يُعيد شيئًا: صمتُه قبولٌ ورميتُه رفضٌ برمزه.
 * ولا يُنادى إلا من `AppointmentRegistry.restore` — فالفحصُ لا يُتجاوز ببابٍ ثانٍ.
 */
export function guardAppointmentSnapshot(
  snapshot: AppointmentSnapshot, ministryKnown: MinistryKnownProbe,
): void {
  const offices = new Map<string, OfficeDefinition>();
  for (const office of snapshot.offices) {
    if (typeof office.officeId !== 'string' || !office.officeId.startsWith('office:')
      || offices.has(office.officeId) || !Array.isArray(office.conflictsWith)) {
      throw new Error('RECOVERY_OFFICE_INVALID');
    }
    // ثابت 3: الوزاراتُ تُرجَع أوّلًا، فمنصبٌ لوزارةٍ مجهولةٍ يعني ترتيبًا معكوسًا أو يوميّةً ناقصة.
    if (!ministryKnown(office.ministryId)) throw new Error('RECOVERY_OFFICE_MINISTRY_MISSING');
    offices.set(office.officeId, office);
  }

  for (const { proposal, trail } of snapshot.proposals) {
    if (!offices.has(proposal.officeId)) throw new Error('RECOVERY_PROPOSAL_OFFICE_MISSING');
    const alive = proposal.status === 'proposed' || proposal.status === 'approved';
    if (alive && (typeof trail.proposed !== 'string' || trail.proposed.length === 0)) {
      throw new Error('RECOVERY_PROPOSAL_TRAIL_MISSING');
    }
    // اعتمادٌ بلا بصمةِ اعتمادٍ لا يُنفَّذ أبدًا، فقبولُه يُبقي اعتمادًا ميتًا حاضرًا في السجل.
    if (proposal.status === 'approved'
      && (typeof trail.approved !== 'string' || trail.approved.length === 0)) {
      throw new Error('RECOVERY_PROPOSAL_TRAIL_MISSING');
    }
  }

  /** ثابت 2: ما ترفضه أبوابُ الحياة ترفضه الاستعادة — ولا يدخل الإقلاعُ ما تمنعه البوابة */
  const heldBy = new Map<EntityId, string[]>();
  for (const holder of snapshot.holders) {
    const office = offices.get(holder.officeId);
    if (office === undefined) throw new Error('RECOVERY_HOLDER_OFFICE_MISSING');
    if (!holder.chain || !holder.chain.proposed || !holder.chain.approved
      || !holder.chain.executed) {
      throw new Error('RECOVERY_HOLDER_CHAIN_INCOMPLETE');
    }
    const held = heldBy.get(holder.holder) ?? [];
    for (const other of held) {
      if (office.conflictsWith.includes(other)
        || offices.get(other)?.conflictsWith.includes(office.officeId) === true) {
        throw new Error('RECOVERY_HOLDER_CONFLICT');
      }
    }
    held.push(office.officeId);
    heldBy.set(holder.holder, held);
  }
}
