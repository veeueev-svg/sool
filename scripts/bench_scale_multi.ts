/**
 * scripts/bench_scale_multi.ts — قياسُ ذيل بوابة التاج عبر تشغيلاتٍ مستقلّة (البند T-85 · C-17)
 * المالك: وزارة البنية | المدخلات: `config/scale.yaml` وعددُ التشغيلات | المخرجات: أرقامٌ مقيسة وحكم
 * التبعيات: `dist/scripts/bench_scale.js` عمليةً مستقلّة + `src/scale/tail_gate` للحكم
 * الصلاحيات (RULE-004): يقيس ويحكم بعتبةِ التهيئة؛ لا يعدّل عتبةً ولا يرقّي حالةَ معيار
 * السجلات: خرجُ كلِّ تشغيلٍ خامًّا في `docs/audit/measurements/` بأمرِه وتاريخِه
 * حالات الفشل: تشغيلٌ ساقطٌ أو خرجٌ غير مقروء أو تجاوزُ p99/الأقصى في أيِّ تشغيل ⇒ رمز 1
 * اختبارات الوحدة: tests/scale/tail_gate.test.ts (منطقُ الحكم بلا قياس)
 * اختبار القبول: `npm run bench:tail` ثم مطابقةُ الخرج الخام المحفوظ
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §20–§24
 *
 * ثوابت هذه الأداة:
 *   1) **التشغيلُ عمليةٌ منفصلة**: كلُّ قياسٍ في عملية Node جديدة بكومةٍ مُعلنة، فلا تُخفي
 *      عمليةٌ واحدةٌ تسخينَ ذاكرتها ولا حالةَ JIT في القياس التالي.
 *   2) **التسلسلُ لا التوازي**: التشغيلات واحدًا بعد واحد، لأن قياسَ ذيلٍ على معالجٍ مزدحمٍ
 *      بأقرانه يقيس الازدحام لا البوابة.
 *   3) **يُحفظ الساقطُ كما يُحفظ الناجح**: خرجُ كلِّ تشغيلٍ يُكتب قبل الحكم، فلا يُختار الدليل.
 *   4) **الحكمُ لا يُخفَّف**: الرمز 1 عند أوّل تجاوز، ولا خيارَ في هذه الأداة لتجاوُز العتبة.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveConfigDir } from '../src/kernel/config/paths';
import { loadScale } from '../src/kernel/config/scale';
import { BenchRunSample, describeBreach, evaluateTailRuns, parseBenchOutput } from '../src/scale/tail_gate';

// جذرُ المستودع يُشتقّ من مجلد التهيئة المُكتشف صعودًا (البند T-118): يعمل من `dist/` ومن `src/`
// معًا، ولا يفترض أن الأداة تُشغَّل من مكانٍ بعينه ولا يكتب مسارَ جهازٍ في الشفرة.
const repoRoot = dirname(resolveConfigDir());
const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1]! : fallback;
}

const runs = Number(option('runs', '5'));
const minRuns = Number(option('min-runs', '3'));
const heapMb = option('heap-mb', '6144');
const configDir = resolve(repoRoot, option('config', 'config'));
const outDir = resolve(repoRoot, option('out', join('docs', 'audit', 'measurements')));
const label = option('label', 'C-17-bench_multi');
if (!Number.isInteger(runs) || runs < 1) throw new Error('عددُ التشغيلات يجب أن يكون عددًا صحيحًا موجبًا');

const policy = loadScale(configDir).policy;
const benchEntry = join(repoRoot, 'dist', 'scripts', 'bench_scale.js');
const defaultConfigDir = join(repoRoot, 'config');
const startedAt = new Date().toISOString();
mkdirSync(outDir, { recursive: true });

console.log(`قياسُ ذيل بوابة التاج بتشغيلاتٍ مستقلّة (T-85) — المطلوب ${runs} تشغيلًا، والحدُّ الأدنى المعتدُّ به ${minRuns}`);
console.log(`السقفُ السكاني من التهيئة: ${policy.population_max} · العتبة: p99 ≤ ${policy.gateway_p99_ms}ms وأقصى ≤ ${policy.gateway_max_ms}ms`);

const samples: BenchRunSample[] = [];
const failures: string[] = [];
for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
  const command = `node --max-old-space-size=${heapMb} dist/scripts/bench_scale.js ${configDir === defaultConfigDir ? '' : configDir}`.trim();
  const began = Date.now();
  let output: string;
  let failed = false;
  try {
    output = execFileSync(process.execPath, [`--max-old-space-size=${heapMb}`, benchEntry, configDir], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    failed = true;
    const shell = error as { stdout?: string; stderr?: string; message?: string };
    output = `${shell.stdout ?? ''}\n${shell.stderr ?? shell.message ?? ''}`;
  }
  const elapsedMs = Date.now() - began;
  const file = join(outDir, `${label}-run-${runIndex}.txt`);
  writeFileSync(file, [
    `# الأمر: ${command}`,
    `# التاريخ: ${new Date().toISOString()} · التشغيل ${runIndex} من ${runs} · زمنُ العملية كاملةً: ${elapsedMs}ms`,
    `# التهيئة المقروءة: ${configDir === defaultConfigDir ? 'config/scale.yaml' : configDir} · السقف ${policy.population_max}`,
    '',
    output.trimEnd(),
    '',
  ].join('\n'), 'utf8');

  if (failed) {
    failures.push(`التشغيل ${runIndex}: سقطت العملية نفسها — الخرجُ محفوظٌ في ${file}`);
    console.log(`✗ التشغيل ${runIndex}: سقطت العملية (${elapsedMs}ms) — لا يُحسب نجاحًا`);
    continue;
  }
  try {
    const sample = parseBenchOutput(output, runIndex);
    samples.push(sample);
    console.log(`• التشغيل ${runIndex}: سكان=${sample.population} p99=${sample.p99Ms.toFixed(3)}ms أقصى=${sample.maxMs.toFixed(3)}ms توزيع=${sample.distributionMs.toFixed(0)}ms RSS=${sample.rssMiB.toFixed(1)}MiB (${elapsedMs}ms)`);
  } catch (error) {
    failures.push(`التشغيل ${runIndex}: ${(error as Error).message}`);
    console.log(`✗ التشغيل ${runIndex}: خرجٌ غير مقروء — ${(error as Error).message}`);
  }
}

const verdict = evaluateTailRuns(samples, {
  populationMax: policy.population_max,
  gatewayP99Ms: policy.gateway_p99_ms,
  gatewayMaxMs: policy.gateway_max_ms,
  minRuns,
});

const summaryLines = [
  `# الأمر: npm run bench:tail -- --runs ${runs}`,
  `# التاريخ: ${startedAt} ← ${new Date().toISOString()}`,
  `# التهيئة: ${configDir === defaultConfigDir ? 'config/scale.yaml' : configDir} · السقف ${policy.population_max} · العتبة p99 ${policy.gateway_p99_ms}ms وأقصى ${policy.gateway_max_ms}ms`,
  '',
  '| التشغيل | السكان | وسيط | p95 | p99 | أقصى | التوزيع | RSS |',
  '|---|---|---|---|---|---|---|---|',
  ...samples.map((s) => `| ${s.runIndex} | ${s.population} | ${s.medianMs.toFixed(3)} | ${s.p95Ms.toFixed(3)} | ${s.p99Ms.toFixed(3)} | ${s.maxMs.toFixed(3)} | ${s.distributionMs.toFixed(0)}ms | ${s.rssMiB.toFixed(1)}MiB |`),
  '',
  `تشغيلاتٌ مقروءة: ${verdict.runs} من ${runs} · أسوأُ p99 = ${verdict.worstP99Ms.toFixed(3)}ms · أسوأُ أقصى = ${verdict.worstMaxMs.toFixed(3)}ms (التشغيل ${verdict.worstRunIndex})`,
  `أبطأُ توزيع: ${verdict.slowestDistributionMs.toFixed(0)}ms · أعلى RSS: ${verdict.peakRssMiB.toFixed(1)}MiB`,
  ...failures.map((f) => `✗ ${f}`),
  ...verdict.breaches.map((b) => `✗ ${describeBreach(b)}`),
  verdict.ok && failures.length === 0
    ? '✓ كلُّ تشغيلٍ داخل العتبة المعلنة — ولا يُغلق البند إلا بحكم المدقّق (RULE-004)'
    : '✗ القياسُ مرفوض: تجاوزٌ أو تشغيلٌ غير مقروء — لا تُخفَّف العتبة، يُصلح السبب',
  '',
].join('\n');
writeFileSync(join(outDir, `${label}.txt`), summaryLines, 'utf8');
console.log(summaryLines.split('\n').slice(4).join('\n'));

if (!verdict.ok || failures.length > 0) process.exit(1);
