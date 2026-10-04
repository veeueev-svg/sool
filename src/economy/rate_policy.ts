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
 *      تغييرٍ دخيلٌ ⇒ رمزُ رفضٍ مسمًّى لا تخمين، والإرجاعُ المُعادُ لا يُكرِّر
 * اختبار القبول: tests/economy/tax_rate_amendment.test.ts
 */
import { isValidRatePerMille } from '../kernel/config/economy';

/** نسبة معلنة: بالأجزاء من الألف، ومن تاريخ معلن لا قبله */
export interface RateDeclaration {
  readonly base: string;
  readonly ratePerMille: number;
  readonly declaredAt: number;
}

/** تعديلٌ مُستعاد: ما شهد به قيدُ rate_amended في السجل الأبدي (ثابت 3) */
export interface RateAmendmentRecovery {
  readonly base: string;
  readonly ratePerMille: number;
  readonly declaredAt: number;
  readonly commandId: string;
}

/** سجلُّ النِّسَبِ وحرسُ الأوامرِ المنفَّذة — بلا تدوينٍ ولا اعتماد (RULE-004) */
export class RatePolicy {
  private readonly history = new Map<string, RateDeclaration[]>();
  private readonly executed = new Set<string>();

  constructor(rates: readonly RateDeclaration[]) {
    for (const rate of rates) this.history.set(rate.base, [rate]);
  }

  declaredBases(): readonly string[] { return [...this.history.keys()]; }
  declares(base: string): boolean { return this.history.has(base); }

  /** سجلُّ إعلاناتِ النسبةِ لوعاءٍ بعينِه مرتّبةً — لا يُمحى منها إعلان (ثابت 1) */
  historyOf(base: string): readonly RateDeclaration[] {
    const h = this.history.get(base);
    return h ? [...h] : [];
  }

  firstOf(base: string): RateDeclaration | null { return this.history.get(base)?.[0] ?? null; }

  currentFor(base: string): RateDeclaration | null {
    const h = this.history.get(base);
    return h?.[h.length - 1] ?? null;
  }

  /** أحدثُ إعلانٍ سارٍ لوعاءٍ في لحظةٍ بعينِها — أو لا شيء (لا أثر رجعي في الاتجاهين) */
  effectiveAt(base: string, at: number): RateDeclaration | null {
    let effective: RateDeclaration | null = null;
    for (const decl of this.history.get(base) ?? []) {
      if (decl.declaredAt <= at) effective = decl;
    }
    return effective;
  }

  hasExecuted(commandId: string): boolean { return this.executed.has(commandId); }
  markExecuted(commandId: string): void { this.executed.add(commandId); }

  /** يُلحقُ إعلانًا جديدًا بسلْسلةِ الوعاءِ — المنادي فحصَ القبولَ قبله */
  append(base: string, ratePerMille: number, declaredAt: number): RateDeclaration {
    const declaration: RateDeclaration = { base, ratePerMille, declaredAt };
    const h = this.history.get(base);
    if (!h) throw new Error(`RATE_BASE_UNDECLARED:${base}`);
    h.push(declaration);
    return declaration;
  }

  /**
   * إرجاعُ التعديلاتِ من شاهدِ السجلِ الأبديِّ بترتيبِ قيودِه (ثابت 3) — يُعيدُ
   * عددَ ما طُبِّق. الفشلُ مغلقٌ برموزٍ مسمّاة، والإعادةُ لا تُكرِّر (المعرّفُ شاهدُ التفرّد).
   */
  restore(amendments: readonly RateAmendmentRecovery[]): number {
    let applied = 0;
    for (const a of amendments) {
      const h = this.history.get(a.base);
      if (!h) throw new Error(`RECOVERY_RATE_BASE_UNDECLARED:${a.base}`);
      if (!isValidRatePerMille(a.ratePerMille)) throw new Error('RECOVERY_RATE_INVALID');
      if (typeof a.commandId !== 'string' || a.commandId.trim() === '') throw new Error('RECOVERY_RATE_COMMAND_ID_MISSING');
      if (this.executed.has(a.commandId)) continue;
      const last = h[h.length - 1]!;
      if (a.declaredAt < last.declaredAt) throw new Error('RECOVERY_RATE_ORDER_VIOLATION');
      if (a.ratePerMille === last.ratePerMille) throw new Error('RECOVERY_RATE_NO_CHANGE');
      h.push({ base: a.base, ratePerMille: a.ratePerMille, declaredAt: a.declaredAt });
      this.executed.add(a.commandId);
      applied += 1;
    }
    return applied;
  }
}
