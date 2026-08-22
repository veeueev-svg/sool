/**
 * src/audit/independence.ts — شهادةُ استقلال التدقيق (المرحلة 39، البند T-115)
 * المالك: ديوان المظالم — جهةُ مراجعةٍ لا تكتب أحكام التدقيق ولا الشيفرة المقيسة
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: هويةُ كاتب الحكم، وهويةُ المراجع، وبصمةُ نصّ الحكم، والقرار (اعتماد أو ردّ) وسببه
 * المخرجات: `AttestationResult` — شهادةٌ مقبولة مُقيَّدة في السلسلة، أو رفضٌ بنصٍّ معلن ومُقيَّد
 * التبعيات: `../audit/append_only_log` · `../identity/keys` (sha256) · `../kernel/types`
 * الصلاحيات (RULE-004): المراجعةُ ليست كتابةَ حكم ولا تنفيذًا. من كتب الحكم لا يعتمده،
 *   ومن راجع لا يُعدّل الحكم — يعتمده أو يردّه بسببٍ مكتوب
 * السجلات: `audit_independence_attested` / `audit_independence_rejected` /
 *   `audit_independence_refused` (نداءٌ غير مشروع)
 * حالات الفشل (كلها مغلقة): المراجعُ هو الكاتب ⇒ رفض · جهةٌ غير معلنة للمراجعة ⇒ رفض ·
 *   بصمةُ حكمٍ لا تطابق النصّ المراجَع ⇒ رفض · ردٌّ بلا سبب ⇒ رفض · شهادةٌ مكرّرة لنفس البصمة ⇒ رفض
 * اختبار القبول: tests/audit/independence.test.ts
 * الوثيقة المرتبطة: docs/audit/independence/README.md · docs/test-reports/phase-39.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الاستقلالُ يُنفَّذ في هويّة الفاعل لا يُعلن في ملف.** كان فصلُ الأدوار في المرحلة 38
 *    مكتوبًا في ترويسات الملفات وفي اسم المُلتزِم، وذلك إعلانٌ لا حاجز (RULE-001). هنا
 *    يُرفض الاعتماد إذا كان `reviewer === verdictAuthor`، ويُرفض من جهةٍ ليست في
 *    `REVIEW_AUTHORITIES` — ويُقيَّد الرفض.
 *
 * 2) **الشهادةُ مربوطةٌ ببصمة النصّ المراجَع** لا باسم ملفه: مَن راجع `verdict.md` ثم غُيِّر
 *    النصُّ بعده صارت شهادتُه لا تُطابق البصمة، فلا تُعَدّ اعتمادًا للنصّ الجديد.
 *
 * 3) **الردُّ فعلٌ مشروع كالاعتماد**، ويُقيَّد بسببه. جهةُ مراجعةٍ لا تستطيع إلا القبول
 *    ليست جهةَ مراجعة.
 *
 * 4) **هذه الوحدة لا تُرقّي معيارًا.** غايتُها أن تُمكِّن جهةً ثانية من الاعتماد وأن تمنع
 *    الأولى منه؛ وترقيةُ **C-18** تبقى موقوفةً على شهادةٍ من جهةٍ ثانية حقيقية (RULE-004)،
 *    ولا يُغني عنها وجودُ هذا الملف.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from './append_only_log';
import { sha256 } from '../identity/keys';

/** الجهاتُ المعلنة للمراجعة — قائمةٌ مغلقة، وليس فيها ديوانُ التدقيق كاتبُ الأحكام */
export const REVIEW_AUTHORITIES: readonly EntityId[] = ['authority:grievances_bureau', 'king'];

/** كاتبُ أحكام المرحلة 38 — معلنٌ كي يُمنع من اعتماد ما كتبه */
export const VERDICT_AUTHOR: EntityId = 'authority:audit_bureau';

export type AttestationDecision = 'approved' | 'rejected';

export interface AttestationInput {
  /** الجهةُ التي كتبت الحكم المراجَع */
  readonly verdictAuthor: EntityId;
  /** نصُّ الحكم المراجَع كما قُرئ (تُحسب بصمتُه هنا ولا تُستلَم جاهزة) */
  readonly verdictText: string;
  readonly decision: AttestationDecision;
  /** سببٌ مكتوب — مطلوبٌ في الردّ، ومستحسنٌ في الاعتماد */
  readonly reason?: string;
}

export interface Attestation {
  readonly reviewer: EntityId;
  readonly verdictAuthor: EntityId;
  readonly verdictHash: string;
  readonly decision: AttestationDecision;
  readonly reason: string;
  readonly at: number;
  readonly auditId: string;
}

export type AttestationResult =
  | { readonly ok: true; readonly attestation: Attestation }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface IndependenceDeps {
  readonly audit: AppendOnlyLog;
  /** جهاتُ المراجعة المعلنة — تُمرَّر للاختبار والتهيئة، وافتراضُها القائمة المعلنة */
  readonly reviewAuthorities?: readonly EntityId[];
}

/**
 * سجلُّ شهادات الاستقلال: يقبل شهادةً واحدة لكل (بصمة حكم × مراجع)، ويرفض ما سوى ذلك بنصٍّ معلن.
 */
export class IndependenceRegistry {
  private readonly attestations = new Map<string, Attestation>();
  private readonly reviewAuthorities: readonly EntityId[];

  constructor(private readonly deps: IndependenceDeps) {
    this.reviewAuthorities = deps.reviewAuthorities ?? REVIEW_AUTHORITIES;
  }

  /** بصمةُ نصّ الحكم — تُحسب من النصّ نفسه فلا تُدَّعى */
  static fingerprint(verdictText: string): string {
    return sha256(verdictText);
  }

  private refuse(by: EntityId, reason: string, detail: Record<string, unknown>): AttestationResult {
    const entry = this.deps.audit.append(by, 'audit_independence_refused', { ...detail, reason });
    return { ok: false, reason, auditId: entry.hash };
  }

  /** يعتمد المراجعُ حكمًا أو يردّه — والمنعُ هنا لا في نيّة المُنادي */
  attest(reviewer: EntityId, input: AttestationInput, now = Date.now()): AttestationResult {
    const verdictHash = IndependenceRegistry.fingerprint(input.verdictText);
    const base = { reviewer, verdictAuthor: input.verdictAuthor, verdictHash };

    // ترتيبُ الفحوص مقصود: منعُ الشهادة على النفس يُعلن بنصّه أولًا، فهو علّةُ البند T-115،
    // ولو قُدِّم فحصُ القائمة لظهر منعُ كاتب الحكم كأنه «جهة غير معلنة» فاختفت العلّة.
    if (reviewer === input.verdictAuthor) {
      return this.refuse(reviewer, 'من كتب الحكم لا يعتمده — لا شهادة لجهة على نفسها', base);
    }
    if (!this.reviewAuthorities.includes(reviewer)) {
      return this.refuse(reviewer, 'جهة غير معلنة للمراجعة', base);
    }
    if (input.verdictText.trim().length === 0) {
      return this.refuse(reviewer, 'لا مراجعة على نصّ خالٍ', base);
    }
    if (input.decision === 'rejected' && (input.reason ?? '').trim().length === 0) {
      return this.refuse(reviewer, 'لا ردّ بلا سبب مكتوب', base);
    }
    const key = `${verdictHash}:${reviewer}`;
    if (this.attestations.has(key)) {
      return this.refuse(reviewer, 'شهادة قائمة لهذا الحكم من هذه الجهة', base);
    }

    const kind = input.decision === 'approved'
      ? 'audit_independence_attested' : 'audit_independence_rejected';
    const entry = this.deps.audit.append(reviewer, kind, {
      ...base, decision: input.decision, reason: input.reason ?? '', at: now,
    });
    const attestation: Attestation = {
      ...base,
      decision: input.decision,
      reason: input.reason ?? '',
      at: now,
      auditId: entry.hash,
    };
    this.attestations.set(key, attestation);
    return { ok: true, attestation };
  }

  /** هل لهذا النصّ اعتمادٌ قائم من جهةٍ غير كاتبه؟ — سؤالُ معيار C-18 بعينه */
  isIndependentlyApproved(verdictText: string): boolean {
    const hash = IndependenceRegistry.fingerprint(verdictText);
    for (const a of this.attestations.values()) {
      if (a.verdictHash === hash && a.decision === 'approved' && a.reviewer !== a.verdictAuthor) {
        return true;
      }
    }
    return false;
  }

  /** الشهاداتُ القائمة على نصٍّ ما — للقراءة لا للتعديل */
  attestationsFor(verdictText: string): readonly Attestation[] {
    const hash = IndependenceRegistry.fingerprint(verdictText);
    return [...this.attestations.values()].filter((a) => a.verdictHash === hash);
  }
}
