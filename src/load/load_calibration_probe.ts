/**
 * src/load/load_calibration_probe.ts — قياسُ معايرةِ الآلةِ مرّةً واحدةً وتدوينُها بأرقامِها
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * لماذا هذا الملف: أُخرج من `load_drill.ts` في الجلسة 70 (البند W-2026-023) **لأنّ بوابةَ
 *   الحجمِ رفضت الملفَّ عند 418 سطرًا فوق سقفِ 400 — ولم يُرفع السقفُ ولم يُعلن دَينًا**.
 *   وحدُّ القسمةِ سلطةٌ لا حجم: `load_calibration.ts` **حسابٌ نقيٌّ** لا يقرأ ساعةً ولا يكتب
 *   سجلًّا، وهذه الوحدةُ **فعلُ قياسٍ وتدوين**: تقرأ الساعةَ مرّةً وتكتب قيدَها، ثمّ تحتفظ
 *   بقراءتِها. والتمرينُ يبقى مُنظِّمًا للأطوارِ لا قائسًا لعتاد.
 * المدخلات: السياسةُ المعلنة، ويوميّةُ التدقيق، وقائسُ الوحدةِ (يُحقن في الاختبار برقمٍ مصنوع).
 * المخرجات: `CalibrationReading` واحدةٌ ثابتةٌ لعمرِ المِجَسّ.
 * الصلاحيات: **لا صلاحية** — لا تعتمد أمرًا ولا ترفع عتبةً ولا تُصعِّد (RULE-004 · RULE-005).
 * السجلات: `load_calibration_measured` **مرّةً واحدةً** لا مرّةً لكلِّ طور.
 * حالات الفشل: لا رفضَ هنا — الآلةُ الأبطأُ من السقفِ تُعلن رمزَ خرقٍ ولا تُوقف التمرين.
 * اختبارات الوحدة: tests/load/load_calibration.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0041-load-threshold-calibration.md · ADR-0047
 * ثوابت هذه الوحدة:
 *   1) **مرّةً واحدة**: القراءةُ تُحفظ، فلا تُقاس الآلةُ في كلِّ طورٍ فتختلف العتبةُ داخلَ
 *      التمرينِ الواحد. ومن أزال الحفظَ جعل الحكمَ يتغيّر في أثناءِ نفسِه.
 *   2) **تُدوَّن قبل أن يُحكم بها**: القيدُ يُكتب لحظةَ القياسِ لا بعد الحكم — فحكمٌ زمنيٌّ
 *      بلا مقياسِ آلتِه في السجلِّ دعوى لا إثبات.
 *   3) **لا تُسقط رمزًا ولا ترفع سقفًا**: `CALIBRATION_OVER_MAX_SCALE` يخرج كما هو ليصنّفَ
 *      في مكانِه (`load_verdicts.ts`) حكمًا زمنيًّا مُعلنًا.
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { LoadPolicy } from './load_drill_types';
import {
  CalibrationReading, effectiveThresholds, latencyScale, measureCalibrationMedianMs,
} from './load_calibration';

/** مِجَسٌّ يقيس مرّةً ويحتفظ: عمرُه عمرُ التمرينِ الذي يملكه */
export class CalibrationProbe {
  private reading: CalibrationReading | null = null;

  constructor(private readonly deps: {
    readonly audit: AppendOnlyLog;
    readonly policy: LoadPolicy;
    /** يُحقن في الاختبار برقمٍ مصنوعٍ ليُحكم على الحساب لا على الآلة */
    readonly calibrationMs?: () => number;
  }) {}

  /** القراءةُ المحفوظةُ إن وُجدت، وإلّا تُقاس الآن وتُدوَّن بأرقامها */
  read(by: EntityId): CalibrationReading {
    if (this.reading) return this.reading;
    const p = this.deps.policy;
    const measure = this.deps.calibrationMs ?? measureCalibrationMedianMs;
    const reading = latencyScale(measure(), p.channel_calibration_baseline_ms, p.channel_calibration_max_scale);
    this.reading = reading;
    const effective = effectiveThresholds(p, reading.scale);
    this.deps.audit.append(by, 'load_calibration_measured', {
      measuredMs: Number(reading.measuredMs.toFixed(3)), baselineMs: reading.baselineMs,
      rawScale: Number(reading.rawScale.toFixed(3)), scale: Number(reading.scale.toFixed(3)),
      maxScale: reading.maxScale, effectiveP99Ms: effective.p99Ms, effectiveMaxMs: effective.maxMs,
      breaches: reading.breaches,
    });
    return reading;
  }
}
