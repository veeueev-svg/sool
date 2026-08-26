/**
 * src/load/load_calibration.ts — معايرةُ عتبات الزمن على عتاد المُشغِّل (البند W-2026-004)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * لماذا هذا الملف: كانت `channel_p99_ms: 8` و`channel_max_ms: 60` **زمنَ جدارٍ مطلقًا**، فبوابةُ
 *   CI على معالجٍ مشتركٍ أبطأَ من جهاز التطوير تسقط بخرقٍ زمنيٍّ لا بخللٍ في الدولة — وبوابةٌ
 *   حمراءُ دائمًا بوابةٌ مُهمَلة. فالقرارُ المُعلن (الخيار «أ» في عقد W-2026-004): تبقى العتبةُ
 *   في `config/load.yaml` كما هي، وتُقاس **وحدةُ معايرةٍ** على آلة التشغيل، فتُضرب العتبةُ في
 *   نسبةِ بطء الآلة عن الآلةِ المرجع المعلنة.
 * المدخلات: أرقامٌ مقيسةٌ (وحدةُ المعايرة) وأرقامٌ معلنةٌ (الأساسُ والسقفُ الأقصى للنسبة).
 * المخرجات: نسبةُ المعايرة والعتباتُ الفعّالة ورمزُ خرقٍ إن كانت الآلةُ أبطأَ من المسموح.
 * الصلاحيات: **لا صلاحية** — لا تعتمد أمرًا ولا ترفع سقفَ سياسةٍ؛ تقرأ وتحسب (RULE-004/005).
 * السجلات: لا شيء — القيدُ يُكتب في `load_drill.ts` مرّةً واحدةً بأرقامه.
 * حالات الفشل: لا شيء — دوالُّ نقيّةٌ لا ترفض؛ من رفَض فهو بوّابةُ التمرين.
 * اختبارات الوحدة: tests/load/load_calibration.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0041-load-threshold-calibration.md · docs/test-reports/W-2026-004-load-thresholds.md
 * ثوابت هذه الوحدة:
 *   1) **العتبةُ تُرخى ولا تُشدَّد**: النسبةُ لا تقلّ عن 1 قطُّ. فالآلةُ الأسرعُ من المرجع لا
 *      تُحاكم بعتبةٍ أضيقَ من المعلنة — وإلّا صارت البوابةُ تسقط بسرعةِ الآلة لا بحال الدولة.
 *   2) **الإرخاءُ محدودٌ ومُعلن**: فوق `maxScale` **لا تُرخى العتبةُ أكثر** ويُعلن رمزُ خرقٍ
 *      `CALIBRATION_OVER_MAX_SCALE` — أي أنّ الآلةَ أبطأُ من أن يُحكم عليها، وذلك **يُقال**
 *      ولا يُبتلع. فالسقفُ اللانهائيُّ ليس معايرةً بل تعطيلًا للحكم (ADR-0017 §«لا تُرفع عتبة»).
 *   3) **وحدةُ المعايرة حسابيّةٌ بحتة**: حلقةٌ ثابتةُ العدد لا قرصَ فيها ولا شبكةَ ولا ذاكرةَ
 *      متغيّرة — نفسُ وحدةِ `scripts/boot_work_meter.ts` حرفًا بحرف، فيُقارن قياسٌ بقياس.
 *   4) **الحسابُ نقيٌّ والقياسُ معزول**: `latencyScale` و`effectiveThresholds` لا تقيسان زمنًا،
 *      و`measureCalibrationMs` وحدَها تقرأ الساعة — فيُختبر الحكمُ بأرقامٍ مصنوعةٍ لا بآلة.
 */

/** عددُ دورات وحدة المعايرة — ثابتٌ مشتركٌ مع `scripts/boot_work_meter.ts` */
export const CALIBRATION_ITERATIONS = 4_000_000;

/** نتيجةُ معايرةٍ مقروءة: ما قِيس، وما أُعلن، والنسبةُ المُعمَل بها */
export interface CalibrationReading {
  /** وحدةُ المعايرة المقيسة على هذه الآلة بالميلي ثانية */
  readonly measuredMs: number;
  /** وحدةُ المعايرة المعلنة للآلة المرجع في `config/load.yaml` */
  readonly baselineMs: number;
  /** النسبةُ الخام: بطءُ هذه الآلة عن المرجع (قبل القصّ) */
  readonly rawScale: number;
  /** النسبةُ المُعمَل بها: مقصوصةٌ بين 1 و`maxScale` */
  readonly scale: number;
  /** الحدُّ الأعلى المعلن للنسبة */
  readonly maxScale: number;
  /** رمزُ الخرق إن كانت الآلةُ أبطأَ من الحدّ المعلن، وإلّا لا شيء */
  readonly breaches: readonly string[];
}

/**
 * يقيس وحدةَ المعايرة: حلقةٌ حسابيّةٌ ثابتةُ العدد. **الوحيدةُ هنا التي تقرأ الساعة.**
 * والحلقةُ تُستهلَك نتيجتُها كي لا يحذفها تحسينُ المُشغّل فيصير القياسُ صفرًا كاذبًا.
 */
export function measureCalibrationMs(): number {
  const started = process.hrtime.bigint();
  let acc = 0;
  for (let i = 1; i <= CALIBRATION_ITERATIONS; i += 1) acc += (i % 7) * (i % 13);
  if (acc < 0) throw new Error('غيرُ ممكن — يمنع تحسينًا يحذف الحلقة');
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** وسيطُ ثلاثِ قياسات: قياسٌ واحدٌ يُخطئ بجيرةِ عمليّةٍ أخرى، والوسيطُ لا يُخطئ بواحدة */
export function measureCalibrationMedianMs(samples = 3): number {
  const readings: number[] = [];
  for (let i = 0; i < Math.max(1, samples); i += 1) readings.push(measureCalibrationMs());
  readings.sort((a, b) => a - b);
  return readings[Math.floor(readings.length / 2)]!;
}

/**
 * النسبةُ المُعمَل بها من قياسٍ وأساسٍ معلن — دالّةٌ نقيّةٌ لا تقرأ ساعةً.
 * وكلُّ مدخلٍ غيرِ صالحٍ (صفرٌ أو سالبٌ أو NaN) يُرجع النسبةَ 1: أي **العتبةَ المعلنةَ كما هي**،
 * فالقياسُ المشكوكُ فيه لا يُرخي حكمًا (RULE-008).
 */
export function latencyScale(measuredMs: number, baselineMs: number, maxScale: number): CalibrationReading {
  const validMeasure = Number.isFinite(measuredMs) && measuredMs > 0;
  const validBaseline = Number.isFinite(baselineMs) && baselineMs > 0;
  const cap = Number.isFinite(maxScale) && maxScale >= 1 ? maxScale : 1;
  const rawScale = validMeasure && validBaseline ? measuredMs / baselineMs : 1;
  const scale = Math.min(cap, Math.max(1, rawScale));
  return {
    measuredMs, baselineMs, rawScale, scale, maxScale: cap,
    breaches: rawScale > cap ? ['CALIBRATION_OVER_MAX_SCALE'] : [],
  };
}

/** العتبتان الفعّالتان بعد المعايرة — والترتيبُ (p99 ثمّ الأقصى) عقدُ القراءة لا تفصيل */
export function effectiveThresholds(
  policy: { readonly channel_p99_ms: number; readonly channel_max_ms: number },
  scale: number,
): { readonly p99Ms: number; readonly maxMs: number } {
  const factor = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  return {
    p99Ms: policy.channel_p99_ms * factor,
    maxMs: policy.channel_max_ms * factor,
  };
}
