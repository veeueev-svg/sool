/**
 * src/economy/tax.ts — الرسوم: لا رسم إلا بنصّ معلن سابق للواقعة (المرحلة 25)
 * المالك: وزارة المالية — والإعفاء للتاج وحده
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: وعاء معلن في config/economy.yaml، ومبلغ أساس صحيح موجب، ولحظة الواقعة
 * المخرجات: تقدير ثم تحصيل مقيَّد في الدفتر بإيصال، أو رفض بسبب موثّق
 * التبعيات: الخزانة (القيد)، الدفتر، بوابة التاج (الإعفاء)، تهيئة الاقتصاد (النِسَب)
 * الصلاحيات: التقدير والتحصيل لوزارة المالية؛ والإعفاء والتعديلُ بأمرٍ ملكيٍّ وحده
 * السجلات: levy_assessed / levy_collected / levy_refused / levy_waived /
 *          rate_amended / rate_amendment_refused
 * ثوابت هذه الوحدة:
 *   1) **لا رسم بلا نصّ معلن**: وعاء غير معلن في التهيئة ⇒ رفض (RULE-005)
 *   2) **لا أثر رجعي**: واقعة قبل تاريخ إعلان النسبة لا تُطالَب بها —
 *      نظير عدم رجعية القوانين في المرحلة 22
 *   3) **لا كسور عائمة**: الحساب بالأجزاء من الألف وبقسمة صحيحة، والباقي لمصلحة المكلَّف
 *   4) التقدير ليس تحصيلًا: مرحلتان منفصلتان، ولا تحصيل بلا تقدير سابق
 *   5) **لا تحصيل مرتين** لنفس التقدير
 *   6) **لا إعفاء إلا بأمر ملكي**: ولا يُعفي المكلَّفُ نفسه (RULE-005)
 *   7) كل تحصيل قيدٌ مزدوج في الدفتر بإيصال — لا مال يدخل بلا أثر
 *   8) **تعديل النسبة بأمر ملكي وبتاريخ سريان معلن** (T-53): يسجّل القيمتين
 *      معًا (القديمة والجديدة) كما يفعل appropriation_amended، والإعلانُ القديمُ
 *      يبقى في سجلِ النِّسَب لا يُمحى، والواقعةُ تُقدَّر بنسبةِ إعلانِها الذي
 *      ساد لحظة وقوعها لا بأحدثِ المعلن — فلا يُدقَّقُ الماضي بأحكامِ الحاضر
 *   9) **سجلُّ النِّسَبِ ومعرّفاتُ الأوامرِ تنجو إعادةَ التشغيل** (الجلسة 2 ·
 *      RATE_AMENDMENT_HISTORY_NOT_DURABLE): الإرجاعُ يعيدُ بناءَهما من قيودِ
 *      rate_amended في السجلِ الأبديِّ (شاهدُها لا يُسقَطُ بالضغط)، فلا يُمحى
 *      إعلانٌ بالإقلاعِ ولا يُنفَّذ أمرٌ نُفِّذ قبلَه. وما لا يُصدَّق يُرفضُ
 *      برمزٍ مغلقٍ لا يُخمَّن: وعاءٌ دخيلٌ · نسبةٌ غيرُ سليمةٍ · إعلانٌ يرجعُ
 *      بالزمنِ · تعديلٌ بلا تغييرٍ دخيل
 *  10) **لا أثرَ دائمًا على كائنٍ مقفل** (الجولة 38 · RATE_AMENDMENT_LOCKED_ASSESS_DURABLE_STALE_LEVY):
 *      بعد نتيجةٍ مجهولةٍ يُقفلُ السجلّ، فالتقديرُ والتحصيلُ والإعفاءُ تُرفضُ قبل قيد tax_levy لا بعده —
 *      وإلّا كُتب تقديرٌ بنسبةٍ بائدةٍ يُعيده الإقلاعُ بلا شاهد. الاستئنافُ إقلاعٌ جديد
 *  11) **بدائيّةُ المداخلِ وعزلُ الوسيطِ عن الحال** (الجولة 40 · عيباها المسمّاة): لا مرجعٌ حيٌّ
 *      يُخزَّنُ ولا وسيطٌ يمسكُ كائنَ الحالِ — الخريطةُ والوسيطُ لقطتانِ منفصلتان
 * 12) **قيدُ الرفضِ لا يحملُ مرجعًا حيًّا** (الجولة 41): غيرُ البدائيِّ يُقنَّعُ (auditPrimitive)
 * حالات الفشل (كلها مغلقة): وعاء غير معلن ⇒ رفض؛ واقعة سابقة للإعلان ⇒ رفض؛
 *   تحصيل بلا تقدير أو مكرَّر ⇒ رفض؛ فشل القيد ⇒ لا تحصيل؛ إعفاء ذاتي ⇒ رفض
 * اختبار القبول: tests/economy/economy_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0009-economy-and-treasury.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { FINANCE_MINISTRY, isValidAmount } from './ledger';
import { Treasury } from './treasury';
import { isValidRatePerMille } from '../kernel/config/economy';
import { RatePolicy } from './rate_policy';
import type { DurableSink } from '../data/persistence';
import type { RateAmendmentRecovery, RateDeclaration } from './rate_policy';
import { auditPrimitive, authorizeBound, royalCommandWitness, type Levy, type LevyResult, type RateAmendmentResult, type RevenueDeps } from './tax_types';

export type { RateAmendmentRecovery, RateDeclaration };

/** هدف الأمر الملكي لكل إعفاء */
export const REVENUE_TARGET: EntityId = 'economy:revenue';

export type { Levy, LevyResult, LevyStatus, RateAmendmentResult, RevenueDeps } from './tax_types';

export class RevenueService {
  private readonly levies = new Map<string, Levy>();
  private readonly actorId: EntityId;
  /**
   * سياسةُ النِّسَب (ثابت 8 · T-53 · والجلسة 2): سجلُّ إعلاناتٍ لا يُمحى منه إعلان،
   * وحرسُ الأوامرِ المنفَّذة، وإرجاعُهما من شاهدِ السجلِ الأبديِّ — في وحدةٍ مستقلّة
   * `rate_policy.ts` تحت سقفِ الوحدة، والاعتمادُ والتدوينُ هنا لا هناك (RULE-004).
   */
  private readonly rates: RatePolicy;
  private sequence = 0;
  private sink: DurableSink | null = null;

  constructor(private readonly deps: RevenueDeps) {
    this.actorId = deps.actorId ?? FINANCE_MINISTRY;
    this.rates = new RatePolicy(deps.rates);
  }

  /** 1) التقدير: بنصّ معلن، وبلا أثر رجعي، وبحساب صحيح (ثوابت 1–4) */
  /** T-125: يُربط بعد الإرجاع لا قبله — وإلا دُوِّن المُستعادُ ثانيةً كلَّ إقلاع */
  attachJournal(sink: DurableSink): void { this.sink = sink; }

  /**
   * كلُّ تغييرٍ على التزامٍ يمرّ من هنا: يُخزَّن ثم يُدوَّن (T-125). والسجلُّ المقفلُ بعد نتيجةٍ مجهولةٍ
   * يرفضُ هنا **قبل** أيِّ أثرٍ في الذاكرةِ أو اليوميّة (ثابت 10) — لا بعد أن يُكتبَ التقديرُ بنسبةٍ بائدة.
   */
  private commit(levy: Levy): void {
    this.deps.audit.assertAppendable();
    // ثابت 11 (الجولة 40): الخريطةُ والوسيطُ لقطتانِ منفصلتانِ — لا يشاركُ وسيطٌ كائنَ الحالِ الحيَّ
    this.levies.set(levy.levyId, { ...levy });
    this.sink?.record('tax_levy', { levy: { ...levy }, sequence: this.sequence });
  }

  /**
   * بابُ الإرجاع الذرّيّ (T-125): يُثبت التزاماتٍ مشهودةً ويرفع العدّاد فلا يتصادم
   * معرّفٌ جديدٌ بقديم. ويرفض ما لا يُصدَّق: محصَّلٌ بلا قيدِ إيصالٍ في الدفتر ⇒
   * RECOVERY_TAX_RECEIPT_MISSING — فالمُحصَّلُ دعوى، وقيدُ الدفتر شاهدُها.
   */
  restore(levies: readonly Levy[], sequence: number, by: EntityId): void {
    for (const levy of levies) {
      if (levy.status !== 'collected') continue;
      if (levy.receiptEntryId === null) throw new Error('RECOVERY_TAX_RECEIPT_MISSING');
    }
    this.levies.clear();
    for (const levy of levies) this.levies.set(levy.levyId, { ...levy });
    this.sequence = Math.max(sequence, this.sequence);
    this.deps.audit.append(by, 'revenue_restored', {
      levies: this.levies.size, collectedTotal: this.collectedTotal(), sequence: this.sequence,
    });
  }

  /**
   * بابُ إرجاعِ تعديلاتِ النِّسَب (ثابت 9 · الجلسة 2 · RATE_AMENDMENT_HISTORY_NOT_DURABLE):
   * يعيدُ بناءَ سجلِّ النِّسَبِ ومجموعةِ الأوامرِ المنفَّذةِ من شاهدِ السجلِ الأبديِّ
   * بترتيبِه. إعادةُ الإرجاعِ لا تُكرِّر (المعرّفُ شاهدُ التفرّد)، وما لا يُصدَّق يُرفضُ
   * برمزٍ مغلقٍ لا تخمينَ فيه — فسجلُّ النِّسَبِ دليلٌ يُدقَّقُ به لا يُدارَس به الحاضر.
   */
  restoreRateAmendments(amendments: readonly RateAmendmentRecovery[], by: EntityId): void {
    const applied = this.rates.restore(amendments);
    this.deps.audit.append(by, 'rate_amendments_restored', { applied, seen: amendments.length });
  }

  assess(
    base: string, payer: EntityId, amountBase: number, occurredAt: number, now = Date.now(),
  ): LevyResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        base: auditPrimitive(base), payer: auditPrimitive(payer), amountBase: auditPrimitive(amountBase), reason, mode: 'assess', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (typeof base !== 'string' || typeof payer !== 'string' || typeof occurredAt !== 'number' || !Number.isFinite(occurredAt) || typeof now !== 'number' || !Number.isFinite(now)) return refuse('المدخلُ بدائيٌّ محددٌ (نصٌّ للوعاءِ والمكلَّفِ ورقمٌ للحظتَي الواقعةِ والتقدير) — لا كائنٌ يُقرأُ عند كلِّ مقارنةٍ فيُخزَّنَ مرجعُه الحيّ (ثابت 11)');
    // ثابتا 2 و8: الواقعةُ تُقدَّر بإعلانِ النسبةِ الذي ساد لحظةَ وقوعها —
    // أحدثُ الإعلاناتِ لا يحكمُ الماضي (لا أثرٌ رجعيٌّ في الاتجاهين)
    const rate = this.rates.effectiveAt(base, occurredAt);
    if (!rate) {
      const first = this.rates.firstOf(base);
      if (!first) {
        return refuse('وعاء غير معلن في config/economy.yaml — لا رسم بلا نصّ (ثابت 1)', {
          declared: this.rates.declaredBases(),
        });
      }
      return refuse('واقعة سابقة لإعلان النسبة — لا أثر رجعي (ثابت 2)', {
        occurredAt, declaredAt: first.declaredAt,
      });
    }
    if (!isValidAmount(amountBase)) return refuse('أساس غير سليم: عدد صحيح موجب');
    if (payer.trim().length === 0) return refuse('لا رسم على مكلَّف مجهول (RULE-006)');
    if (payer === this.actorId) return refuse('لا رسم على وزارة المالية من نفسها');
    if (!this.deps.retroactiveAllowed && occurredAt < rate.declaredAt) {
      return refuse('واقعة سابقة لإعلان النسبة — لا أثر رجعي (ثابت 2)', {
        occurredAt, declaredAt: rate.declaredAt,
      });
    }
    if (occurredAt > now) return refuse('لا تقدير لواقعة لم تقع بعد');

    // ثابت 3: قسمة صحيحة، والباقي لمصلحة المكلَّف — لا تقريب لأعلى ولا فاصلة عائمة
    const levied = Math.floor((amountBase * rate.ratePerMille) / 1000);
    if (levied <= 0) {
      return refuse('الرسم المحتسب صفر — لا تقدير بلا مبلغ', {
        amountBase, ratePerMille: rate.ratePerMille,
      });
    }

    this.sequence += 1;
    const levy: Levy = {
      levyId: `levy:${this.sequence}`, base, payer, amountBase,
      ratePerMille: rate.ratePerMille, levied, status: 'assessed',
      occurredAt, assessedAt: now, collectedAt: null, receiptEntryId: null, waiveReason: null,
    };
    this.commit(levy);
    const entry = this.deps.audit.append(this.actorId, 'levy_assessed', {
      levyId: levy.levyId, base, payer, amountBase, ratePerMille: levy.ratePerMille,
      levied, occurredAt, declaredAt: rate.declaredAt,
    });
    // 39أ (الجولة 39): النتيجةُ نسخةٌ مجمّدةٌ لا الكائنَ الداخليَّ الحيَّ الذي دفعته commit
    return { ok: true, levy: { ...levy }, auditId: entry.hash };
  }

  /** 2) التحصيل: مرة واحدة، بقيد مزدوج وإيصال (ثوابت 4 و5 و7) */
  collect(levyId: string, now = Date.now()): LevyResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        levyId: auditPrimitive(levyId), reason, mode: 'collect', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (typeof now !== 'number' || !Number.isFinite(now)) return refuse('لحظةُ التحصيلِ رقمٌ محددٌ — لا كائنٌ يُقرأُ عند المقارنةِ فيُخزَّنَ مرجعُه الحيّ (ثابت 11)');
    const levy = this.levies.get(levyId);
    if (!levy) return refuse('لا تقدير بهذا المعرّف — لا تحصيل بلا تقدير (ثابت 4)');
    if (levy.status === 'collected') return refuse('محصَّل سابقًا — لا تحصيل مرتين (ثابت 5)');
    if (levy.status === 'waived') return refuse('معفيّ بأمر ملكي — لا تحصيل بعده');

    const received = this.deps.treasury.receive(
      levy.levied, levy.payer, this.deps.revenueAccount,
      `تحصيل رسم ${levy.base} من ${levy.payer} (${levy.levyId})`, now,
    );
    if (!received.ok) return refuse(`قيد التحصيل مرفوض: ${received.reason}`);

    const collected: Levy = {
      ...levy, status: 'collected', collectedAt: now,
      receiptEntryId: received.disbursement.entryId,
    };
    this.commit(collected);
    const entry = this.deps.audit.append(this.actorId, 'levy_collected', {
      levyId, base: levy.base, payer: levy.payer, levied: levy.levied,
      receiptEntryId: collected.receiptEntryId,
    });
    // 39أ (الجولة 39): النتيجةُ نسخةٌ مجمّدةٌ لا الكائنَ الداخليَّ الحيَّ
    return { ok: true, levy: { ...collected }, auditId: entry.hash };
  }

  /** 3) الإعفاء: بأمر ملكي وحده، ولا يُعفي المكلَّف نفسه (ثابت 6) */
  waive(
    command: SignedRoyalCommand, levyId: string, reason: string, now = Date.now(),
  ): LevyResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): LevyResult => {
      const entry = this.deps.audit.append(this.actorId, 'levy_refused', {
        levyId: auditPrimitive(levyId), reason: why, mode: 'waive', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    if (typeof reason !== 'string' || typeof now !== 'number' || !Number.isFinite(now)) return refuse('سببُ الإعفاءِ نصٌّ ولحظةُ الأمرِ رقمٌ محددٌ — لا كائنٌ يُقرأُ عند المقارنةِ فيُخزَّنَ مرجعُه الحيّ');
    // الجولة 44 (grok · TAX_WAIVE_COMMAND_ID_LIVE_REFERENCE): معرّفُ الأمرِ يُقرأُ قراءةً واحدةً ولقطةُ حمولتهِ تُعتمدُ — فالخامَّ غيرَ النصّيِّ كان يُخزَّنُ مرجعًا حيًّا يكسرُ السلسلةَ.
    const witness = royalCommandWitness(command, false);
    if (!witness.ok) return refuse(witness.reason);
    const levy = this.levies.get(levyId);
    if (!levy) return refuse('لا تقدير بهذا المعرّف');
    if (levy.status === 'collected') return refuse('لا إعفاء بعد التحصيل: التصحيح بقيد معاكس معلن');
    if (levy.status === 'waived') return refuse('معفيّ سابقًا');
    if (reason.trim().length < 3) return refuse('لا إعفاء بلا سبب معلن (RULE-006)');
    if (witness.command.payload.issuedBy === levy.payer) { // الجولة 45: الفحصُ منَ اللقطةِ لا الحيّة
      return refuse('لا يُعفي المكلَّف نفسه (ثابت 6 و RULE-005)', { payer: levy.payer });
    }
    if (witness.command.payload.action !== 'amend_policy') {
      return refuse('الإعفاء بفعل amend_policy وحده');
    }
    if (witness.command.payload.target !== REVENUE_TARGET) {
      return refuse(`هدف الأمر يجب أن يكون ${REVENUE_TARGET}`);
    }
    const authorized = authorizeBound(this.deps, witness.command, now, 'levy_waived'); // الجولة 46: الاعتمادُ يطابقُ اللقطةَ ولا إعفاءَ مكرّر
    if (!authorized.ok) return refuse(authorized.reason, authorized.extra);

    const waived: Levy = { ...levy, status: 'waived', waiveReason: reason.trim() };
    // الجولة 48 (gpt · WAIVE_EXECUTED_GUARD_NOT_ATOMIC_WITH_EFFECT): الشاهدُ الدائمُ **أولًا** كما في amendRate — فأثرُ الإعفاءِ كان يسبقُ شاهدَه فرفضُ الوسيطِ يتركُ إعفاءً بلا شاهدٍ ويسمحُ بإعادةِ الأمرِ نفسِه؛ الآنَ رميُ الإضافةِ قبلَ commit لا أثرَ بعده أصلًا.
    const entry = this.deps.audit.append(this.actorId, 'levy_waived', {
      levyId, payer: levy.payer, levied: levy.levied, reason: waived.waiveReason,
      commandId: witness.commandId,
    });
    this.commit(waived);
    // 39أ (الجولة 39): النتيجةُ نسخةٌ مجمّدةٌ لا الكائنَ الداخليَّ الحيَّ
    return { ok: true, levy: { ...waived }, auditId: entry.hash };
  }

  /**
   * 3) تعديلُ النسبةِ بأمرٍ ملكيٍّ معتمدٍ وبتاريخِ سريانٍ معلن (ثابت 8 · T-53) —
   * نظيرُ appropriation_amended: يسجّلُ القيمتينِ معًا، والإعلانُ السابقُ يبقى
   * في سجلِ النِّسَب لا يُمحى، ولا يسريُُ الجديدُ إلّا من لحظةِ اعتمادِه.
   */
  amendRate(
    command: SignedRoyalCommand,
    base: string,
    newRatePerMille: number,
    now = Date.now(),
  ): RateAmendmentResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): RateAmendmentResult => {
      const entry = this.deps.audit.append(this.actorId, 'rate_amendment_refused', {
        base: auditPrimitive(base), requestedRatePerMille: auditPrimitive(newRatePerMille), reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    // تاريخُ السريان رقمٌ بدائيٌّ محددٌ لا كائنٌ يُكرَه عند كلِّ مقارنةٍ فيُخزَّن مرجعُه
    // الحيُّ ويُحرِّك السريانَ رجعيًّا وإلى المستقبلِ بلا أمرٍ ملكيّ (الجلسة 9 ·
    // RATE_AMENDMENT_EFFECTIVE_AT_MUTABLE_OBJECT_ESCAPE) — والنسخُ لا يغلق مسارًا لا يمرّ به أصلًا.
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      return refuse('تاريخُ السريانِ رقمٌ محددٌ لا كائنٌ يُكرَه عند المقارنة — وذاك مرجعٌ حيٌّ يحرّك السريان بلا أمرٍ ملكي');
    }
    // الجولتان 43-44: شهودُ الأمرِ (لحطتهُ ومعرّفهُ) وحمولتهُ تُقرأُ قراءةً واحدةً في حارسٍ مشتركٍ
    // يُعيدُ لقطةَ الأمرِ — فالكائنُ ذا valueOf أو غيرُ النصّيِّ يمرُّ بوابةَ التاجِ فيُدوَّنُ مرجعًا
    // حيًّا يكسرُ العبثُ بعدَ النجاحِ السلسلةَ ويقتلُ الإقلاعَ؛ واللقطةُ تُلزمُ البوابةَ والشاهدَ
    // بالقراءةِ نفسها فلا تُفرّقُ قارئةٌ منقلبةٌ أثناءَ التنفيذِ بينَ المفحوصِ والمعتمدِ.
    const witness = royalCommandWitness(command, true);
    if (!witness.ok) return refuse(witness.reason);
    const { command: guarded, commandId, commandIssuedAt } = witness;
    if (!this.rates.declares(base)) {
      return refuse('وعاء غير معلن — لا تعديل لما لا نصّ له (ثابت 1)', {
        declared: this.rates.declaredBases(),
      });
    }
    // حدودُ النسبةِ من مصدرِها الواحدِ الذي يقرؤه المحمّلُ نفسه (T-53)
    if (!isValidRatePerMille(newRatePerMille)) {
      // الجولة 42 (إجماع الثلاثة): لا يُعادُ الحقلُ المعقّمُ خامًا في extra فيغلبه — قنَّع (ثابت 12)
      return refuse('نسبة غير سليمة: عددٌ صحيحٌ فوق الصفر ولا يتجاوز الألف (حدود المصدر نفسه)',
        { requestedRatePerMille: auditPrimitive(newRatePerMille) });
    }
    const current = this.rates.currentFor(base);
    if (!current) {
      return refuse('سجلُّ نِسَبٍ فارغٌ لوعاءٍ معلن — فشلٌ مغلقٌ لا يُملأ بالتخمين');
    }
    if (current.ratePerMille === newRatePerMille) {
      return refuse('لا تعديل بلا تغيير');
    }
    if (now < current.declaredAt) {
      return refuse('لا تعديل بتاريخٍ يسابق إعلانَه — النسب لا تُدار رجعيًا (ثابتا 2 و8)', {
        requestedEffectiveAt: now, latestDeclaredAt: current.declaredAt,
      });
    }
    // الجولة 45: فحوصُ السياسةِ والربطُ منَ اللقطةِ (guarded.payload) لا الحمولةِ الحيّة (الموقَّعُ 40 لا ينفّذُ 80).
    if (guarded.payload.action !== 'amend_policy') {
      return refuse('تعديل النسبة بفعل amend_policy وحده');
    }
    if (guarded.payload.target !== REVENUE_TARGET) {
      return refuse(`هدف الأمر يجب أن يكون ${REVENUE_TARGET}`);
    }
    // الأمرُ يُوقَّع على التعديلِ بعينِه لا على تفويضٍ مفتوح (مجلس المراجعة · الجلسة 1 ·
    // RATE_AMENDMENT_COMMAND_NOT_PARAMETER_BOUND): الوعاءُ والنسبةُ في params الموقَّعة
    const params = guarded.payload.params ?? {};
    if (params['base'] !== base || params['ratePerMille'] !== newRatePerMille) {
      return refuse('الأمر لا يسمّي هذا التعديل: params.base وparams.ratePerMille الموقَّعتان يجب أن تطابقا الوعاءَ والنسبة', {
        signedBase: auditPrimitive(params['base']) ?? null, signedRatePerMille: auditPrimitive(params['ratePerMille']) ?? null,
      });
    }
    // أمرٌ نُفّذ مرّةً لا يُنفَّذ ثانيةً: البوابةُ تُعيد قرارَها السابق للإعادة (idempotent)
    // فلا يكفي `allowed` شاهدًا على اعتمادٍ جديد (الجلسة 1 · إعادةُ الأمر تُعدّل ثانيةً)
    if (this.rates.hasExecuted(commandId)) {
      return refuse('الأمر نُفّذ سابقًا — إعادتُه لا تُعدّل ثانيةً', { commandId });
    }
    const authorized = authorizeBound(this.deps, guarded, now); // الجولة 46: القرارُ المعادُ لحمولةٍ أخرى ليس اعتمادًا
    if (!authorized.ok) return refuse(authorized.reason, authorized.extra);
    // الشاهدُ الدائمُ **أولًا**: كتابةُ قيد rate_amended في السجلِ الأبديّ تسبقُ كلَّ تغييرٍ
    // في الحال — فإذا رمى الوسيطُ الدائمُ رُدَّ قيدها ورُمي الاستثناءُ قبل أيِّ تعديلٍ حيٍّ،
    // وإذا نجحت فالتغييرُ بعدها لا يعرف الفشل. فلا يبقى تعديلٌ حيٌّ بلا سجلٍّ دائمٍ تفقدُه
    // إعادةُ التشغيل (الجلسة 9 · RATE_AMENDMENT_DURABILITY_COMMIT_NONATOMIC — والإضافةُ في
    // AppendOnlyLog ذرّيّةٌ منذ الجلسة 9 نفسِها).
    // رميُ الوسيطِ بعد الإضافةِ ليس فشلًا قاطعًا: السجلُ يرمي AUDIT_APPEND_OUTCOME_UNKNOWN
    // (وعلةُ رميِ الوسيطِ في cause) لأنّ القيدَ قد يكونُ دُوّنَ ثم رمى — فالإرجاعُ بعد التشغيلِ
    // هو الحَكَم، والاستدعاءُ يُخبَر أنّ النتيجةَ مجهولةٌ لا مرفوضةٌ (الجلسة 11 ·
    // RATE_AMENDMENT_DURABLE_POSTCOMMIT_THROW_INCONSISTENT_ACK).
    const entry = this.deps.audit.append(this.actorId, 'rate_amended', {
      base,
      from: current.ratePerMille,
      to: newRatePerMille,
      previousDeclaredAt: current.declaredAt,
      effectiveFrom: now,
      commandId,
      commandIssuedAt,
    });
    // الحمولةُ القانونيّةُ نفسُها تُسجَّل للأمرِ المنفَّذ وتُدوَّن شاهدًا — فإرجاعٌ لاحقٌ
    // بالمعرّفِ نفسِه يُقابَل بها لا بالمعرّفِ وحده (الجلسة 6 · RATE_AMENDMENT_LIVE_EXECUTED_CONFLICT_SILENT_SKIP)
    this.rates.markExecuted({
      base, from: current.ratePerMille, ratePerMille: newRatePerMille,
      previousDeclaredAt: current.declaredAt, declaredAt: now,
      commandId, commandIssuedAt,
    });

    const declaration = this.rates.append(base, newRatePerMille, now);
    return { ok: true, declaration, previous: current, auditId: entry.hash };
  }

  /** سجلُ إعلاناتِ النسبةِ لوعاءٍ بعينِه مرتّبةً — لا يُمحى منها إعلان (ثابت 8) */
  rateHistoryOf(base: string): readonly RateDeclaration[] {
    return this.rates.historyOf(base);
  }

  rateFor(base: string): RateDeclaration | null {
    return this.rates.currentFor(base);
  }

  get(levyId: string): Levy | null {
    // 39أ (الجولة 39 · TAX_LEVY_MUTABLE_REFERENCE_ESCAPE): لا يخرجُ كائنُ الحالِ
    // الداخليُّ حيًّا من بابِ الاستعلام — نسخةٌ مجمّدةٌ لا أصلٌ قابلٌ للتعديل
    const levy = this.levies.get(levyId);
    return levy ? { ...levy } : null;
  }
  outstanding(): readonly Levy[] {
    // 39أ: عناصرُ القائمةِ نسخٌ لا مراجعَ حيّة — فلا تقديرَ يُعدّلُه المستدعي بلا أمر
    return [...this.levies.values()].filter((l) => l.status === 'assessed').map((l) => ({ ...l }));
  }

  collectedTotal(): number {
    let total = 0;
    for (const levy of this.levies.values()) {
      if (levy.status === 'collected') total += levy.levied;
    }
    return total;
  }

  report(): {
    bases: number; assessed: number; collected: number; waived: number;
    collectedTotal: number; retroactiveAllowed: boolean;
  } {
    const all = [...this.levies.values()];
    return {
      bases: this.deps.rates.length,
      assessed: all.filter((l) => l.status === 'assessed').length,
      collected: all.filter((l) => l.status === 'collected').length,
      waived: all.filter((l) => l.status === 'waived').length,
      collectedTotal: this.collectedTotal(),
      retroactiveAllowed: this.deps.retroactiveAllowed,
    };
  }
}
