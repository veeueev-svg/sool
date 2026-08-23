/**
 * src/scale/tail_gate.ts — حاكمُ ذيل بوابة التاج عبر تشغيلاتٍ متعدّدة (البند T-85 · المعيار C-17)
 * المالك: وزارة البنية (والحكمُ النهائي لديوان التدقيق)
 * المدخلات: خرجُ `scripts/bench_scale.ts` الخام لكلِّ تشغيلٍ مستقلّ، وسياسةُ `config/scale.yaml`
 * المخرجات: حكمٌ واحد: مقبولٌ أو مرفوضٌ بقائمة تجاوزاتٍ مسمّاة بتشغيلها ورقمها
 * التبعيات: لا شيء غير أنواع النواة — الوحدة لا تقيس ولا تشغّل، بل تحكم على قياسٍ جاهز
 * الصلاحيات (RULE-004): لا تعدّل عتبة ولا تهيئة ولا حالة معيار؛ تقرأ العتبة ولا تكتبها
 * السجلات: لا سجلّ تدقيق — القياسُ ليس فعلًا سياديًّا، وخرجُه الخام هو سنده
 * حالات الفشل: خرجٌ ناقصٌ أو غير مقروء ⇒ BENCH_OUTPUT_UNREADABLE (لا يُحسب نجاحًا) ·
 *   تشغيلاتٌ أقلّ من الحدّ المُعلن ⇒ رفض · تجاوزُ p99 أو الأقصى في أيِّ تشغيل ⇒ رفض
 * اختبارات الوحدة: tests/scale/tail_gate.test.ts
 * اختبار القبول: tests/scale/scale_lifecycle.test.ts (سلوك البوابة) + `npm run bench:tail`
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §20–§24 · docs/audit/criteria/C-17.md
 *
 * ثوابت هذه الوحدة:
 *   1) **أسوأُ تشغيلٍ هو الحكم**: لا متوسّطَ تشغيلاتٍ ولا أفضلَ محاولة. تشغيلٌ واحدٌ
 *      متجاوزٌ يُسقط القياس كلَّه، لأن العتبة وعدٌ للمستخدم في أسوأ الحالات لا معدّلٌ دعائيّ.
 *   2) **الخرجُ الناقص رفضٌ لا تجاوُز**: سطرٌ غائبٌ أو رقمٌ غير مقروء لا يُفسَّر لصالح النجاح.
 *   3) **العتبةُ من التهيئة**: لا رقمَ حرفيًّا هنا؛ من أراد تخفيف العتبة يغيّر `scale.yaml`
 *      ويواجه المدقّق، ولا يجد في هذه الوحدة بابًا خلفيًّا.
 *   4) **السكانُ المقيس يُطابَق**: تشغيلٌ سجّل أقلّ من السقف المطلوب لا يُقاس ذيلُه بالسقف.
 *   5) **الوحدة لا تُغلق بندًا**: تعطي حكمًا على أرقام؛ وإغلاقُ C-17 فعلُ مدقّقٍ لا فعلُ أداة.
 */
import { SovereignViolation } from '../kernel/types';

/** قياسُ تشغيلٍ واحد مستخرجٌ من خرجٍ خام؛ الأزمنة بالمللي ثانية والذاكرة بالميبي بايت. */
export interface BenchRunSample {
  runIndex: number;
  population: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  distributionMs: number;
  rssMiB: number;
}

/** العتبةُ المقروءة من `config/scale.yaml` مع أقلِّ عددِ تشغيلاتٍ يُعتدّ به. */
export interface TailPolicy {
  populationMax: number;
  gatewayP99Ms: number;
  gatewayMaxMs: number;
  minRuns: number;
}

/** تجاوزٌ واحد مسمّى: أيُّ تشغيل، وأيُّ مقياس، والمقيسُ مقابل المسموح. */
export interface TailBreach {
  runIndex: number;
  kind: 'p99' | 'max' | 'population' | 'runs';
  measured: number;
  allowed: number;
}

/** حكمُ القياس كلِّه: مقبولٌ فقط إن لم يتجاوز أيُّ تشغيلٍ أيَّ عتبة. */
export interface TailVerdict {
  ok: boolean;
  runs: number;
  breaches: TailBreach[];
  worstP99Ms: number;
  worstMaxMs: number;
  worstRunIndex: number;
  slowestDistributionMs: number;
  peakRssMiB: number;
}

const POPULATION_LINE = /عدد الهويات المسجلة:\s*(\d+)/;
const GATEWAY_LINE = /وسيط=([\d.]+)\s+p95=([\d.]+)\s+p99=([\d.]+)\s+أقصى=([\d.]+)/;
const DISTRIBUTION_LINE = /زمن التوزيع \(مللي ثانية\):\s*([\d.]+)/;
const RSS_LINE = /RSS=([\d.]+)/;

function requireMatch(text: string, pattern: RegExp, field: string): RegExpMatchArray {
  const found = text.match(pattern);
  if (!found) {
    throw new SovereignViolation(`خرجُ القياس بلا «${field}» — لا يُحسب تشغيلًا ناجحًا`, 'BENCH_OUTPUT_UNREADABLE');
  }
  return found;
}

function toNumber(raw: string | undefined, field: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new SovereignViolation(`قيمةٌ غير رقمية في «${field}» من خرج القياس`, 'BENCH_OUTPUT_UNREADABLE');
  }
  return value;
}

/**
 * يقرأ خرجَ تشغيلٍ خامًّا كما طبعه `bench_scale`؛ الناقصُ يرمي ولا يُكمَّل بصفرٍ ولا بتقدير.
 */
export function parseBenchOutput(text: string, runIndex: number): BenchRunSample {
  const population = requireMatch(text, POPULATION_LINE, 'عدد الهويات المسجلة');
  const gateway = requireMatch(text, GATEWAY_LINE, 'زمن اعتماد البوابة');
  const distribution = requireMatch(text, DISTRIBUTION_LINE, 'زمن التوزيع');
  const rss = requireMatch(text, RSS_LINE, 'ذاكرة العملية');
  return {
    runIndex,
    population: toNumber(population[1], 'عدد الهويات المسجلة'),
    medianMs: toNumber(gateway[1], 'الوسيط'),
    p95Ms: toNumber(gateway[2], 'p95'),
    p99Ms: toNumber(gateway[3], 'p99'),
    maxMs: toNumber(gateway[4], 'الأقصى'),
    distributionMs: toNumber(distribution[1], 'زمن التوزيع'),
    rssMiB: toNumber(rss[1], 'RSS'),
  };
}

/**
 * يحكم على تشغيلاتٍ مستقلّة مجتمعةً: أسوأُ تشغيلٍ هو الحكم، والعتبةُ من التهيئة لا من هنا.
 */
export function evaluateTailRuns(samples: readonly BenchRunSample[], policy: TailPolicy): TailVerdict {
  const breaches: TailBreach[] = [];
  if (samples.length < policy.minRuns) {
    breaches.push({ runIndex: 0, kind: 'runs', measured: samples.length, allowed: policy.minRuns });
  }
  for (const sample of samples) {
    if (sample.population < policy.populationMax) {
      breaches.push({ runIndex: sample.runIndex, kind: 'population', measured: sample.population, allowed: policy.populationMax });
    }
    if (sample.p99Ms > policy.gatewayP99Ms) {
      breaches.push({ runIndex: sample.runIndex, kind: 'p99', measured: sample.p99Ms, allowed: policy.gatewayP99Ms });
    }
    if (sample.maxMs > policy.gatewayMaxMs) {
      breaches.push({ runIndex: sample.runIndex, kind: 'max', measured: sample.maxMs, allowed: policy.gatewayMaxMs });
    }
  }
  const worst = samples.reduce<BenchRunSample | undefined>(
    (acc, s) => (acc === undefined || s.maxMs > acc.maxMs ? s : acc), undefined,
  );
  return {
    ok: breaches.length === 0,
    runs: samples.length,
    breaches,
    worstP99Ms: samples.reduce((acc, s) => Math.max(acc, s.p99Ms), 0),
    worstMaxMs: worst?.maxMs ?? 0,
    worstRunIndex: worst?.runIndex ?? 0,
    slowestDistributionMs: samples.reduce((acc, s) => Math.max(acc, s.distributionMs), 0),
    peakRssMiB: samples.reduce((acc, s) => Math.max(acc, s.rssMiB), 0),
  };
}

/** يصوغ التجاوز نصًّا عربيًّا واحدًا — ليُطبع في الخرج ويُحفظ في القياس الخام كما هو. */
export function describeBreach(breach: TailBreach): string {
  const names: Record<TailBreach['kind'], string> = {
    p99: 'p99 لبوابة التاج',
    max: 'الزمن الأقصى لبوابة التاج',
    population: 'عددُ الهويات المسجّلة',
    runs: 'عددُ التشغيلات المستقلّة',
  };
  const relation = breach.kind === 'population' || breach.kind === 'runs' ? 'دون المطلوب' : 'فوق العتبة';
  const where = breach.kind === 'runs' ? 'القياس كلّه' : `التشغيل ${breach.runIndex}`;
  return `${where}: ${names[breach.kind]} = ${breach.measured} ${relation} ${breach.allowed}`;
}
