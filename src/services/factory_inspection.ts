/**
 * src/services/factory_inspection.ts — حكمُ المفتّش على الدفعة (المرحلة 39 · الجلسة 43)
 * المالك: ديوان المحاسبة يفتّش — ولا يشغّل شيئًا (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * ما فيها: **دوالُّ حكمٍ نقيّة** على تقرير التفتيش: أرقامٌ وقوائمُ تدخل، وحكمٌ يخرج.
 *          لا سجلَّ تدقيقٍ ولا حالةَ دفعةٍ ولا سجلَّ مواردَ ولا وقتَ — والنقاءُ **مصونٌ
 *          بالبنية لا بتعليق**: هذا الملف لا يستورد `AppendOnlyLog` ولا `ResourceRegistry`
 *          أصلًا، فمن أراد أن يكتب قيدًا من هنا احتاج استيرادًا جديدًا يُرى في المراجعة.
 * لماذا انفصلت: أُخرجت من `factory_runtime.ts` في تفكيك البند T-113، **وحدُّ القسمة
 *          سلطةٌ لا حجم**: الملفُ كان يجمع في مسارٍ واحد **مَن يُنتج** (يستهلك مخزونًا
 *          ويستأجر حصةً ويكتب قيدًا) و**مَن يشهد على المُنتَج** (يقرأ ويحكم) — وهما
 *          الجهتان اللتان يقول ثابتُ الوحدة الرابع إنّهما لا تكونان يدًا واحدة. فما كان
 *          حكمًا صار هنا، وما كان فعلًا بقي هناك.
 * ما لم يُنقل وبيانُه: `refuse` و`complete` بقيتا في الصنف لأنّهما **تكتبان قيدًا**
 *          (`production_refused` · `quality_claim_contradicted` · `production_rejected`
 *          · `production_completed`) — والكتابةُ فعلٌ لا حكم، ونقلُها هنا ينقض اسمَ الملف.
 * الثابت المحفوظ: نصوصُ أسباب الرفض **وترتيبُ فحصها** عقدٌ تقرؤه الاختبارات، فنُقلت
 *          بنصِّها وترتيبِها حرفيًّا.
 * اختبار القبول: tests/services/enterprise_lifecycle.test.ts (خطُّ الأساس نفسه)
 * الوثيقة المرتبطة: docs/decisions/ADR-0012-enterprises.md
 */

/**
 * حكمٌ على قائمة الفحوص المُدَّعاة: إمّا مجموعةٌ نظيفةٌ بترتيب ورودها، وإمّا سببُ رفضٍ
 * ومعه ما يُقيَّد معه. ولا تُعاد «مجموعةٌ جزئية» بحالٍ — ثابت 5 يُبطل التفتيش كلَّه.
 */
export type ChecksVerdict =
  | { readonly ok: true; readonly seen: ReadonlySet<string> }
  | { readonly ok: false; readonly why: string; readonly extra: Record<string, unknown> };

/**
 * ثابت 5: **الفحص المعلن وحده يُحتسب** — وفحصٌ غير معلن أو مكرَّر يُبطل التفتيش كلّه،
 * فلا يُنتقى من تقرير فاسد ما يرفع الدرجة. والترتيبُ في المجموعة ترتيبُ ورودها في
 * التقرير، لأنّه هو ما يُقيَّد في `passedChecks`.
 */
export function declaredChecks(
  passed: readonly string[], requiredChecks: readonly string[],
): ChecksVerdict {
  const required = new Set(requiredChecks);
  const seen = new Set<string>();
  for (const check of passed) {
    if (typeof check !== 'string' || !required.has(check)) {
      return {
        ok: false,
        why: 'فحص غير معلن في نوع المنشأة — يُبطل التفتيش كلّه (ثابت 5)',
        extra: { check: String(check) },
      };
    }
    if (seen.has(check)) {
      return {
        ok: false,
        why: 'فحص مكرَّر في التقرير — يُبطل التفتيش كلّه (ثابت 5)',
        extra: { check },
      };
    }
    seen.add(check);
  }
  return { ok: true, seen };
}

/** ما يعرفه النظامُ بنفسه عن الدفعة، مُقاسًا قبل الحكم — لا مجاسَّ قراءةٍ داخل الدالّة */
export interface ClaimEvidence {
  readonly seen: ReadonlySet<string>;
  readonly declaredWastePerMille: number;
  readonly wasteTolerancePerMille: number;
  /** هل حصةُ الدفعة ما زالت قائمةً في سجل التأجير عند لحظة الإقفال */
  readonly leaseActive: boolean;
}

/**
 * ثابت 6: **الدعوى تُقابَل بالسجل** — ما يستطيع النظام التحقق منه بنفسه لا يُقبل فيه قولُ
 * المفتّش إذا خالف قيده. وحدّ المورد يُقابَل بسجل التأجير لا بالإعلان: دفعةٌ عاشت بعد
 * انتهاء حصتها عملت فترةً بلا حصة معلنة — فدعوى «داخل الحدّ» تخالف قيد النظام.
 * والترتيبُ محفوظ: الفقدُ أوّلًا ثمّ المورد، لأنّه ما يُقيَّد في `claims`.
 */
export function claimContradictions(evidence: ClaimEvidence): readonly string[] {
  const contradictions: string[] = [];
  if (evidence.seen.has('waste_within_tolerance')
    && evidence.declaredWastePerMille > evidence.wasteTolerancePerMille) {
    contradictions.push('waste_within_tolerance');
  }
  if (evidence.seen.has('resource_within_limit') && !evidence.leaseActive) {
    contradictions.push('resource_within_limit');
  }
  return contradictions;
}

/**
 * الدرجةُ مجموعُ أوزانِ الفحوص **المعلنة في التهيئة وحدها**: فحصٌ لا وزنَ له معلنٌ يُحتسب
 * صفرًا ولا يُخترع له وزن (`?? 0`) — فلا ترتفع درجةٌ بوزنٍ من خارج `config/enterprises.yaml`.
 */
export function qualityScore(
  seen: Iterable<string>, weights: Readonly<Record<string, number>>,
): number {
  let score = 0;
  for (const check of seen) score += weights[check] ?? 0;
  return score;
}
