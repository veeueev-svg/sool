/**
 * src/load/load_verdicts.ts — قسمةُ الحكمَين: سلامةُ الدولة شيءٌ وسرعةُ الآلة شيءٌ آخر
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * لماذا هذا الملف: كان حكمُ تمرين الضغط سطرًا واحدًا يخلط رمزَين مختلفَي الطبيعة
 *   (`load_drill.ts` قبل هذا البند): `verdict = breaches.length === 0 ? 'pass' : 'fail'`.
 *   فرمزُ `COMMAND_LOSS` يقول «ضاع أمرُ ملكٍ من الدولة» ورمزُ `COMMAND_P99_OVER_THRESHOLD`
 *   يقول «كانت الآلةُ مزدحمةً في تلك اللحظة» — وجُمعا في حكمٍ واحد. فصار الحاجزُ يُقلَب
 *   بحظِّ جدولةِ النوى: قِيس ذلك خامًّا في `docs/audit/measurements/phase-33-verdict-split.txt`
 *   (28 تشغيلًا، 12 أحمر، **كلُّها زمنيّةٌ وصفرُ فقدٍ في 28/28**). وهذا الملفُّ ينفّذ
 *   الخيارَ «ج» من عقد `W-2026-004`: **حكمان معلنان لا حكمٌ ممزوج** (ADR-0047).
 * المدخلات: قائمةُ رموزِ خرقٍ مقيسةٌ خارجًا — لا أرقامَ زمنٍ ولا ساعةَ ولا سياسة.
 * المخرجات: القائمةُ مقسومةً بصنفَيها، وحكمٌ لكلِّ صنفٍ على حِدَة.
 * الصلاحيات: **لا صلاحية** — لا تكتب قيدًا ولا ترفع عتبةً ولا تُسقط رمزًا (RULE-004/005).
 * السجلات: لا شيء — القيدُ يُكتب في `load_drill.ts` بصنفَيه.
 * حالات الفشل: لا شيء — دوالُّ نقيّةٌ كلُّها.
 * اختبارات الوحدة: tests/load/load_verdict_split.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0047-verdict-separation.md · ADR-0041 · ADR-0017
 * ثوابت هذه الوحدة:
 *   1) **القسمةُ حصرٌ مغلقٌ لا استنتاج**: الرموزُ الزمنيّةُ **مُعدَّدةٌ بأسمائها** في
 *      `TIMING_BREACH_CODES`، وكلُّ ما سواها **حكمُ سلامةٍ افتراضًا**. فالرمزُ الجديدُ
 *      يقع في صفِّ السلامةِ حتّى يُعلَن زمنيًّا صراحةً — والخطأُ في جهةِ التشدُّد لا التساهل.
 *   2) **لا يُسقَط رمزٌ قطُّ**: مجموعُ الصنفَين يساوي المدخلَ عددًا وترتيبًا. ومن أراد
 *      إخفاءَ حمرةٍ فليس له في هذه الوحدة بابٌ — لا مرشِّحَ «تجاهُل» ولا سقفَ تسامح.
 *   3) **حكمُ السلامةِ لا يقرأ ساعةً ولا معايرةً**: وهو لذلك حتميٌّ — نفسُ المدخلِ نفسُ
 *      الحكمِ على أيِّ آلةٍ وتحت أيِّ توازٍ. **وهذا هو كلُّ الغرض.**
 *   4) **الحكمُ الزمنيُّ يُعلَن ولا يُبتلع**: له حقلُه في التقرير وقيدُه في اليوميّة —
 *      عزلُه عن بوابةِ السلامةِ **ليس إسكاتَه**، ومن حذف قيدَه نقض هذا البند.
 */

/**
 * الرموزُ التي يصنعها **زمنُ الجدار** لا حالُ الدولة — تُعدَّد بأسمائها ولا تُستنتَج.
 * ثلاثةٌ من عتبتَي القناة (`channel_p99_ms` و`channel_max_ms`)، ورابعٌ من المعايرة نفسِها
 * (`CALIBRATION_OVER_MAX_SCALE`): «الآلةُ أبطأُ من أن يُحكم عليها» قولٌ عن الآلةِ لا عن الدولة.
 */
export const TIMING_BREACH_CODES: readonly string[] = Object.freeze([
  'COMMAND_P99_OVER_THRESHOLD',
  'COMMAND_MAX_OVER_THRESHOLD',
  'BURST_PER_COMMAND_OVER_MAX',
  'CALIBRATION_OVER_MAX_SCALE',
]);

const TIMING_SET: ReadonlySet<string> = new Set(TIMING_BREACH_CODES);

/** أزمنيٌّ هذا الرمز؟ سؤالٌ عن قائمةٍ مغلقةٍ لا عن نصِّ الرمز */
export function isTimingBreach(code: string): boolean {
  return TIMING_SET.has(code);
}

/** خرقٌ مقسومٌ بصنفَيه: ما مسَّ سلامةَ الدولة، وما قاله زمنُ الآلة */
export interface SplitBreaches {
  /** خروقُ السلامةِ والفقدِ والحساب — حتميّةٌ لا تقرأ ساعة */
  readonly integrity: readonly string[];
  /** خروقُ الزمنِ والمعايرة — تقرأ ساعةَ آلةٍ مزدحمةٍ أو خالية */
  readonly timing: readonly string[];
}

/** يقسم القائمةَ ولا يُسقط منها رمزًا: `integrity.length + timing.length === codes.length` */
export function splitBreaches(codes: readonly string[]): SplitBreaches {
  const integrity: string[] = [];
  const timing: string[] = [];
  for (const code of codes) (isTimingBreach(code) ? timing : integrity).push(code);
  return { integrity, timing };
}

/**
 * حكمُ سلامةِ الدولة: `pass` بصفرِ خرقِ سلامةٍ لا غير.
 * **لا مدخلَ زمنيَّ له ولا معايرةَ ولا سياسة** — فلا سبيلَ لآلةٍ بطيئةٍ أن تقلبه.
 */
export function integrityVerdict(split: SplitBreaches): 'pass' | 'fail' {
  return split.integrity.length === 0 ? 'pass' : 'fail';
}

/**
 * الحكمُ الزمنيُّ **المعلن على حِدَة**: `pass` بصفرِ خرقٍ زمنيّ، و`fail` بغيرِه.
 * ويُقرأ مقرونًا بمقياسِه (`calibration`) في التقرير — فحكمٌ زمنيٌّ بلا مقياسِ آلتِه دعوى.
 */
export function timingVerdict(split: SplitBreaches): 'pass' | 'fail' {
  return split.timing.length === 0 ? 'pass' : 'fail';
}

/** ما قِيس فعلًا على هذه الآلة — يُمرَّر مقيسًا خارجًا، ولا تقرأ هذه الوحدةُ ساعةً */
export interface TimingMeasured {
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly perCommandMs: number;
  readonly calibrationScale: number;
  readonly calibrationMs: number;
}

/**
 * الحكمُ كاملًا في نداءٍ واحد: قسمةٌ ثمّ حكمانِ مستقلّان، مقرونٌ زمنيُّهما بمقياسِه.
 * وُضع هنا لا في `load_drill.ts` كي يبقى **بابُ الحكمِ الوحيدُ** موضعًا واحدًا نقيًّا
 * يُختبر بلا تمرينٍ ولا ساعة — ومن أراد حكمًا ثالثًا فليُعلنه في هذه الوحدة أو فلا يكون.
 */
export function judgeDrill(codes: readonly string[], measured: TimingMeasured): {
  readonly split: SplitBreaches;
  readonly verdict: 'pass' | 'fail';
  readonly timing: { readonly verdict: 'pass' | 'fail'; readonly breaches: readonly string[]; readonly measured: TimingMeasured };
} {
  const split = splitBreaches(codes);
  return {
    split,
    verdict: integrityVerdict(split),
    timing: { verdict: timingVerdict(split), breaches: split.timing, measured },
  };
}
