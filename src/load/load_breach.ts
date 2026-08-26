/**
 * src/load/load_breach.ts — حصرُ الخرق في المقيس (دوالُّ نقيّة لا تكتب سجلًّا)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * لماذا هذا الملف: أُخرج من `load_drill.ts` في المرحلة 39 (الجلسة 42) لإنقاص دَين T-113؛
 *   وحدُّ القسمة **سلطةٌ لا حجم**: القياسُ **فعلٌ** يستأجر حصةً ويُدرج مهمّةً و**يكتب قيدَ
 *   تدقيق**، والحكمُ على المقيس **قراءةٌ**: أرقامٌ تدخل ورموزُ خرقٍ تخرج، بلا سجلٍّ ولا حالة.
 * المدخلات: أرقامٌ مقيسةٌ وسياسةُ الحمل المعلنة — لا مجاسَّ ولا خرائطَ سجل.
 * المخرجات: قائمةُ رموزِ خرقٍ **بترتيبها المعلن** (والترتيبُ جزءٌ من العقد: اختبارُ القبول
 *           يقرأ أوّلَ رمزٍ ويقرأ القائمةَ كلَّها).
 * الصلاحيات: **لا صلاحية** — لا تعتمد أمرًا ولا تمنح حصةً ولا ترفع سقفًا (RULE-004 و RULE-005)،
 *            ولا تُصعِّد إلى الملك: التصعيدُ فعلُ التمرين لا حكمُ الدالّة.
 * السجلات: لا شيء — **ومن كتب قيدًا من هنا نقض بندَ التفكيك**: القيدُ يُكتب مرّةً في موضعه
 *           من التمرين، وكتابتُه هنا تُزيد اليوميّةَ الأبديّةَ قيدًا بلا إعلان.
 * حالات الفشل: لا شيء — الدالّةُ النقيّةُ لا ترفض؛ من رفَض فهو بوّابةُ التمرين.
 * اختبارات الوحدة: tests/load/load_drill.test.ts, tests/load/quota_pressure.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت هذه الوحدة:
 *   1) **ترتيبُ الرموز عقدٌ لا تفصيل**: من أعاد ترتيبَ الدفعات غيّر ما تقرؤه الاختبارات.
 *   2) **لا نجاح جزئي**: الدالّةُ تُرجع كلَّ ما وقع، ولا تختار أهمَّه (RULE-008).
 *   3) **العتبةُ تُقرأ ولا تُغيَّر**: السياسةُ مدخلٌ للقراءة — ومن خفّف عتبةً هنا جمّل حكمًا.
 *   4) **المعايرةُ تُمرَّر ولا تُحسب هنا** (W-2026-004): النسبةُ `scale` مدخلٌ رقميٌّ مقيسٌ
 *      خارجًا (`load_calibration.ts`)، وافتراضُها 1 — أي العتبةَ المعلنةَ كما هي. فلا تقرأ هذه
 *      الدوالُ ساعةً ولا تقيس آلةً، ويبقى الحكمُ مُختبرًا بأرقامٍ مصنوعة.
 */
import { LoadLedgerReport } from './load_ledger';
import { LoadPolicy } from './load_drill_types';

/** نسبة مئوية من مصفوفة مقيسة — لا تقريب لأعلى للتجميل */
export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index]!;
}

/** الطور الأول: عتبتا الزمن ثم اكتمالُ المصائر — فقدُ مصيرٍ خرقٌ لا نقصُ تقرير */
export function commandBreaches(
  measured: { readonly p99Ms: number; readonly maxMs: number; readonly settled: number; readonly count: number },
  policy: LoadPolicy,
  scale = 1,
): string[] {
  const breaches: string[] = [];
  const factor = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  if (measured.p99Ms > policy.channel_p99_ms * factor) breaches.push('COMMAND_P99_OVER_THRESHOLD');
  if (measured.maxMs > policy.channel_max_ms * factor) breaches.push('COMMAND_MAX_OVER_THRESHOLD');
  if (measured.settled !== measured.count) breaches.push('COMMAND_FATE_MISSING');
  return breaches;
}

/** الطور الثاني: اكتمالُ المصائر ثم معدّلُ الأمر داخل الدفعة — ولا يُقدَّم معدّلٌ مكان p99 */
export function burstBreaches(
  measured: { readonly settled: number; readonly count: number; readonly perCommandMs: number },
  policy: LoadPolicy,
  scale = 1,
): string[] {
  const breaches: string[] = [];
  const factor = Number.isFinite(scale) && scale >= 1 ? scale : 1;
  if (measured.settled !== measured.count) breaches.push('BURST_FATE_MISSING');
  if (measured.perCommandMs > policy.channel_max_ms * factor) breaches.push('BURST_PER_COMMAND_OVER_MAX');
  return breaches;
}

/**
 * الطور الثالث: التجاوزُ ثم الذروةُ ثم مطابقةُ السعة ثم بلوغُ الحدِّ ثم الاستعادة.
 * و`QUOTA_LIMIT_NEVER_REACHED` خرقٌ **بلوغُه شرطُ صحّةِ القياس**: حدٌّ لم يُبلَغ ليس حدًّا.
 */
export function quotaBreaches(measured: {
  readonly overrun: number;
  readonly peakAllocated: number;
  readonly total: number;
  readonly granted: number;
  readonly capacity: number;
  readonly refused: number;
  readonly restored: boolean;
}, policy: LoadPolicy): string[] {
  const breaches: string[] = [];
  if (measured.overrun > policy.max_quota_overrun) breaches.push('QUOTA_OVERRUN');
  if (measured.peakAllocated > measured.total) breaches.push('QUOTA_PEAK_OVER_TOTAL');
  if (measured.granted !== measured.capacity) breaches.push('QUOTA_CAPACITY_MISMATCH');
  if (measured.refused < 1) breaches.push('QUOTA_LIMIT_NEVER_REACHED');
  if (!measured.restored) breaches.push('QUOTA_NOT_RESTORED');
  return breaches;
}

/** الطور الرابع: لا مهمّةَ منسيّة، ولا قبولَ فوق السقف، ولا رفضَ بلا رمز، ولا مهمّةَ بلا حساب */
export function schedulerBreaches(measured: {
  readonly forgotten: number;
  readonly accepted: number;
  readonly queueMax: number;
  readonly refused: number;
  readonly refusalCodeCount: number;
  readonly drained: number;
  readonly probe: number;
}): string[] {
  const breaches: string[] = [];
  if (measured.forgotten > 0) breaches.push('SCHEDULER_TASK_FORGOTTEN');
  if (measured.accepted > measured.queueMax) breaches.push('SCHEDULER_OVER_QUEUE_MAX');
  if (measured.refused < 1) breaches.push('SCHEDULER_LIMIT_NEVER_REACHED');
  if (measured.refused > 0 && measured.refusalCodeCount === 0) breaches.push('SCHEDULER_REFUSAL_WITHOUT_CODE');
  if (measured.drained !== measured.accepted) breaches.push('SCHEDULER_NOT_DRAINED');
  if (measured.accepted + measured.refused !== measured.probe) breaches.push('SCHEDULER_TASK_UNACCOUNTED');
  return breaches;
}

/** مطابقةُ الدفترين: سلامةُ الدفتر ثم الفقدُ فوق المسموح — والمسموحُ معلنٌ في السياسة */
export function ledgerBreaches(ledger: LoadLedgerReport, policy: LoadPolicy): string[] {
  return [
    ...(ledger.sound ? [] : ['LEDGER_UNSOUND']),
    ...(ledger.lost > policy.max_command_loss ? ['COMMAND_LOSS'] : []),
  ];
}
