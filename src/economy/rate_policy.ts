/**
 * src/economy/rate_policy.ts — سياسةُ النِّسَبِ المعلنةِ وسجلُّها (المرحلة 40 · W-2026-065)
 * المالك: وزارة المالية — والإعلانُ والتعديلُ للعرشِ وحده
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: النِّسَب المعلنة في config/economy.yaml · تعديلاتٌ ملكيّةٌ مُوقَّعة
 * المخرجات: سجلُّ إعلاناتٍ لا يُمحى منه شيءٌ · حكمُ النسبةِ السائدةِ في لحظةٍ بعينها
 * التبعيات: حدودُ النسبةِ من مصدرِها الواحد (kernel/config/economy)
 * الصلاحيات (RULE-004): سجلٌّ يُقرأ ويُبنى؛ والاعتمادُ والتدوينُ بابُهما tax.ts
 * السجلات: لا شيء — المنادي هو الذي يُدوِّن لا الوحدة
 * ثوابت هذه الوحدة:
 *   1) **الإعلانُ لا يُمحى**: لكلِّ وعاءٍ سلسلةُ إعلاناتٍ مرتّبة، والتقديرُ
 *      بإعلانِ ما ساد لحظةَ الوقوعِ لا بأحدثِ المعلن (ثابتا 2 و8 في tax.ts)
 *   2) **الأمرُ المنفَّذُ لا يُنفَّذ ثانيةً**: معرّفُ الأمرِ شاهدُ التفرّد
 *      (W-2026-065 · الجلسة 1)
 *   3) **الإرجاعُ فشلٌ مغلق** (W-2026-065 · الجلسة 2 · RATE_AMENDMENT_HISTORY_NOT_DURABLE):
 *      وعاءٌ دخيلٌ أو نسبةٌ غيرُ سليمةٍ أو إعلانٌ يرجعُ بالزمنِ أو تعديلٌ بلا
 *      تغييرٍ دخيلٌ ⇒ رمزُ رفضٍ مسمًّى لا تخمين، والإرجاعُ المُعادُ لا يُكرِّر. والشاهدُ يصل
 *      كما شهد (الجلسة 3 · RATE_AMENDMENT_MALFORMED_AUDIT_BYPASS) فكلُّ حقلٍ يُفحص بنوعه —
 *      ومنه تاريخُ السريان: غيرُ العدديّ ⇒ RECOVERY_RATE_DECLARED_AT_INVALID
 *   4) **الشاهدُ كلُّه لا بعضُه** (الجلسة 6): لكلِّ أمرٍ منفَّذٍ — حيًّا بـamendRate أو مُستعادًا —
 *      حمولةٌ قانونيّةٌ واحدةٌ بحقولِ rate_amended كلِّها (from · to · previousDeclaredAt ·
 *      effectiveFrom · commandIssuedAt). فشاهدٌ بالمعرّفِ نفسِه يخالفها في أيِّ حقلٍ ⇒
 *      RECOVERY_RATE_COMMAND_CONFLICT، ولو نُفِّذ الأوّلُ حيًّا (RATE_AMENDMENT_LIVE_EXECUTED_CONFLICT_SILENT_SKIP)
 *      أو خالفه في from وحده (RATE_AMENDMENT_DUPLICATE_COMMAND_CONFLICT_FROM_FIELD_SILENT_SKIP)؛
 *      وشاهدٌ جديدٌ لا يصل سلسلتَه (from ≠ النسبةِ السائدة أو previousDeclaredAt ≠ تاريخِها)
 *      ⇒ RECOVERY_RATE_CHAIN_BROKEN — فالقيمةُ القديمةُ المشهودُ بها تُصدَّق لا تُهمَل.
 * اختبار القبول: tests/economy/tax_rate_amendment.test.ts
 */
import { isValidRatePerMille } from '../kernel/config/economy';

/** نسبة معلنة: بالأجزاء من الألف، ومن تاريخ معلن لا قبله */
export interface RateDeclaration {
  readonly base: string;
  readonly ratePerMille: number;
  readonly declaredAt: number;
}

/** تعديلٌ مُستعاد: ما شهد به قيدُ rate_amended في السجل الأبدي — بحقوله كلِّها (ثابتا 3 و4) */
export interface RateAmendmentRecovery {
  readonly base: string;
  /** النسبةُ السابقة المشهودُ بها (from) — تُقابَل بالسائدةِ لحظةَ الإرجاع */
  readonly from: number;
  /** النسبةُ الجديدة (to) */
  readonly ratePerMille: number;
  /** تاريخُ الإعلانِ السابق المشهودُ به */
  readonly previousDeclaredAt: number;
  /** تاريخُ سريانِ الجديدة (effectiveFrom) */
  readonly declaredAt: number;
  readonly commandId: string;
  /** وقتُ إصدارِ الأمرِ الموقَّع — إن شُهد به قُوبل */
  readonly commandIssuedAt?: number;
}

/** الحمولةُ القانونيّةُ لشاهدٍ — يُقارَن بها كلُّ تكرارٍ للمعرّف (ثابت 4) */
function witnessKey(a: RateAmendmentRecovery): string {
  return JSON.stringify([a.base, a.from, a.ratePerMille, a.previousDeclaredAt, a.declaredAt, a.commandId, a.commandIssuedAt ?? null]);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** سجلُّ النِّسَبِ وحرسُ الأوامرِ المنفَّذة — بلا تدوينٍ ولا اعتماد (RULE-004) */
export class RatePolicy {
  private readonly history = new Map<string, RateDeclaration[]>();
  /** معرّفُ الأمرِ المنفَّذ ⇒ حمولتُه القانونيّة — حيًّا أو مُستعادًا، فلا معرّفَ بلا حمولة (ثابت 4) */
  private readonly executed = new Map<string, string>();

  constructor(rates: readonly RateDeclaration[]) {
    for (const rate of rates) this.history.set(rate.base, [{ ...rate }]);
  }

  declaredBases(): readonly string[] { return [...this.history.keys()]; }
  declares(base: string): boolean { return this.history.has(base); }

  /** سجلُّ إعلاناتِ النسبةِ لوعاءٍ بعينِه مرتّبةً — لا يُمحى منها إعلان (ثابت 1)
   *  النسخُ عميقةٌ لا سطحية: المرجعُ القابلُ للتعديل يُسرِّبُ الإعلانَ التاريخيَّ بلا أمرٍ ملكيٍّ (الجلسة 7 · RATE_AMENDMENT_HISTORY_MUTABLE_REFERENCE_ESCAPE) */
  historyOf(base: string): readonly RateDeclaration[] {
    const h = this.history.get(base);
    return h ? h.map((d) => ({ ...d })) : [];
  }

  firstOf(base: string): RateDeclaration | null { const d = this.history.get(base)?.[0]; return d ? { ...d } : null; }

  currentFor(base: string): RateDeclaration | null {
    const h = this.history.get(base);
    const d = h?.[h.length - 1];
    return d ? { ...d } : null;
  }

  /** أحدثُ إعلانٍ سارٍ لوعاءٍ في لحظةٍ بعينِها — أو لا شيء (لا أثر رجعي في الاتجاهين) */
  effectiveAt(base: string, at: number): RateDeclaration | null {
    let effective: RateDeclaration | null = null;
    for (const decl of this.history.get(base) ?? []) {
      if (decl.declaredAt <= at) effective = decl;
    }
    return effective ? { ...effective } : null;
  }

  hasExecuted(commandId: string): boolean { return this.executed.has(commandId); }
  /** يُسجِّلُ الأمرَ المنفَّذَ حيًّا **بحمولتِه** — فإرجاعٌ لاحقٌ بالمعرّفِ نفسِه يُقابَل بها (ثابت 4) */
  markExecuted(witness: RateAmendmentRecovery): void { this.executed.set(witness.commandId, witnessKey(witness)); }

  /** يُلحقُ إعلانًا جديدًا بسلْسلةِ الوعاءِ — المنادي فحصَ القبولَ قبله */
  append(base: string, ratePerMille: number, declaredAt: number): RateDeclaration {
    const declaration: RateDeclaration = { base, ratePerMille, declaredAt };
    const h = this.history.get(base);
    if (!h) throw new Error(`RATE_BASE_UNDECLARED:${base}`);
    h.push(declaration);
    return { ...declaration };
  }

  /**
   * إرجاعُ التعديلاتِ من شاهدِ السجلِ الأبديِّ بترتيبِ قيودِه (ثابت 3) — يُعيدُ
   * عددَ ما طُبِّق. الفشلُ مغلقٌ برموزٍ مسمّاة، والإعادةُ لا تُكرِّر (المعرّفُ شاهدُ التفرّد).
   * والإعادةُ طبقَ الأصلِ (الحمولةُ نفسُها) تُتخطّى بأمانٍ؛ والتعارضُ (معرّفٌ واحدٌ وحمولةٌ مختلفة)
   * يُرفض برمزٍ مسمّى — فالشاهدُ المخالِفُ لا يُمحى بصمت (الجلسة 5 ·
   * RATE_AMENDMENT_DUPLICATE_COMMAND_CONFLICT_SILENT_SKIP). والمقارنةُ بالحمولةِ القانونيّةِ كلِّها،
   * والمعرّفُ المنفَّذُ حيًّا له حمولتُه أيضًا (الجلسة 6 · ثابت 4).
   */
  restore(amendments: readonly RateAmendmentRecovery[]): number {
    let applied = 0;
    for (const a of amendments) {
      const h = this.history.get(a.base);
      if (!h) throw new Error(`RECOVERY_RATE_BASE_UNDECLARED:${a.base}`);
      if (!isValidRatePerMille(a.ratePerMille)) throw new Error('RECOVERY_RATE_INVALID');
      if (typeof a.commandId !== 'string' || a.commandId.trim() === '') throw new Error('RECOVERY_RATE_COMMAND_ID_MISSING');
      if (typeof a.declaredAt !== 'number' || !Number.isFinite(a.declaredAt)) throw new Error('RECOVERY_RATE_DECLARED_AT_INVALID');
      if (!isValidRatePerMille(a.from)) throw new Error('RECOVERY_RATE_FROM_INVALID');
      if (!finite(a.previousDeclaredAt)) throw new Error('RECOVERY_RATE_PREVIOUS_DECLARED_AT_INVALID');
      if (a.commandIssuedAt !== undefined && !finite(a.commandIssuedAt)) throw new Error('RECOVERY_RATE_COMMAND_ISSUED_AT_INVALID');
      const seen = this.executed.get(a.commandId);
      if (seen !== undefined) {
        if (seen !== witnessKey(a)) throw new Error(`RECOVERY_RATE_COMMAND_CONFLICT:${a.commandId}`);
        continue;
      }
      const last = h[h.length - 1]!;
      if (a.from !== last.ratePerMille || a.previousDeclaredAt !== last.declaredAt) throw new Error('RECOVERY_RATE_CHAIN_BROKEN');
      if (a.declaredAt < last.declaredAt) throw new Error('RECOVERY_RATE_ORDER_VIOLATION');
      if (a.ratePerMille === last.ratePerMille) throw new Error('RECOVERY_RATE_NO_CHANGE');
      h.push({ base: a.base, ratePerMille: a.ratePerMille, declaredAt: a.declaredAt });
      this.executed.set(a.commandId, witnessKey(a));
      applied += 1;
    }
    return applied;
  }
}
