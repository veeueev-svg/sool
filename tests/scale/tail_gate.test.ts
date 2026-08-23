/**
 * tests/scale/tail_gate.test.ts — حكمُ الذيل عبر تشغيلاتٍ متعدّدة (البند T-85 · المعيار C-17)
 * المالك: وزارة البنية | المدخلات: خرجٌ خامٌّ مصنوعٌ في الاختبار وسياسةٌ صريحة
 * المخرجات: تأكيدُ أن التجاوز يُرفض ولا يُتوسَّط ولا يُغتفر
 * التبعيات: src/scale/tail_gate | الصلاحيات: لا قياسَ هنا — منطقُ الحكم وحده
 * السجلات: لا شيء | حالات الفشل: أيُّ تجاوزٍ يمرّ ⇒ الاختبار يسقط
 * اختبار القبول: `npm run bench:tail` على أرقامٍ حقيقية | الوثيقة: docs/test-reports/phase-39.md
 * ثوابت الاختبار:
 *   1) **الاختبار يعبث بالأرقام لا بالنصّ**: كلُّ حالةٍ تُبنى بخرجٍ مصنوعٍ بالصيغة نفسها.
 *   2) **أسوأُ تشغيلٍ هو الحكم**: تشغيلٌ متجاوزٌ بين تشغيلاتٍ سليمة يُسقط القياس.
 *   3) **العتبةُ تأتي من السياسة**: لا رقمَ منسوخًا من التهيئة في هذا الملف بغير تمريره.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BenchRunSample, evaluateTailRuns, parseBenchOutput, describeBreach } from '../../src/scale/tail_gate';

const POLICY = { populationMax: 1_000_000, gatewayP99Ms: 10, gatewayMaxMs: 25, minRuns: 3 };

function rawOutput(over: Partial<{ population: number; median: number; p95: number; p99: number; max: number; distribution: number; rss: number }> = {}): string {
  const v = { population: 1_000_000, median: 0.001, p95: 0.002, p99: 1.172, max: 12.433, distribution: 24_907.5, rss: 683.4, ...over };
  return [
    `تهيئة القياس: config/ (تهيئة المستودع) · السقف المعلن فيها: ${v.population}`,
    `عدد الهويات المسجلة: ${v.population}`,
    `زمن اعتماد البوابة (مللي ثانية): وسيط=${v.median.toFixed(3)} p95=${v.p95.toFixed(3)} p99=${v.p99.toFixed(3)} أقصى=${v.max.toFixed(3)}`,
    `زمن التوزيع (مللي ثانية): ${v.distribution.toFixed(3)}؛ حتمي داخل التسجيل؛ الشرائح=16 والسقف/شريحة=70000`,
    'عينات البوابة: 100 إحماء مستبعدة ثم 1000 عينة مقيسة',
    `ذاكرة العملية (MiB): RSS=${v.rss.toFixed(1)} heapUsed=520.2`,
  ].join('\n');
}

function samples(count: number, over: Parameters<typeof rawOutput>[0] = {}): BenchRunSample[] {
  return Array.from({ length: count }, (_, i) => parseBenchOutput(rawOutput(over), i + 1));
}

test('القارئ يستخرج أرقام التشغيل كما طبعها القياس بلا تقريب', () => {
  const sample = parseBenchOutput(rawOutput(), 4);
  assert.equal(sample.runIndex, 4);
  assert.equal(sample.population, 1_000_000);
  assert.equal(sample.p99Ms, 1.172);
  assert.equal(sample.maxMs, 12.433);
  assert.equal(sample.distributionMs, 24_907.5);
  assert.equal(sample.rssMiB, 683.4);
});

test('خرج بلا سطر بوابة يرفض ولا يحسب تشغيلا ناجحا', () => {
  const truncated = rawOutput().split('\n').filter((l) => !l.startsWith('زمن اعتماد')).join('\n');
  assert.throws(() => parseBenchOutput(truncated, 1), (e: Error & { code?: string }) => e.code === 'BENCH_OUTPUT_UNREADABLE');
});

test('خرج فارغ يرفض ولا يفسر لصالح النجاح', () => {
  assert.throws(() => parseBenchOutput('', 1), (e: Error & { code?: string }) => e.code === 'BENCH_OUTPUT_UNREADABLE');
});

test('ثلاث تشغيلات كلها داخل العتبة تقبل', () => {
  const verdict = evaluateTailRuns(samples(3), POLICY);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.breaches.length, 0);
  assert.equal(verdict.runs, 3);
});

test('تشغيل واحد يتجاوز p99 يسقط القياس كله ولو مر الباقي', () => {
  const mixed = [...samples(4), parseBenchOutput(rawOutput({ p99: 10.001 }), 5)];
  const verdict = evaluateTailRuns(mixed, POLICY);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.breaches, [{ runIndex: 5, kind: 'p99', measured: 10.001, allowed: 10 }]);
  assert.equal(verdict.worstP99Ms, 10.001);
});

test('تجاوز الزمن الأقصى يرفض وإن كان p99 ممتازا', () => {
  const mixed = [...samples(3), parseBenchOutput(rawOutput({ max: 38.645 }), 4)];
  const verdict = evaluateTailRuns(mixed, POLICY);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.breaches[0]!.kind, 'max');
  assert.equal(verdict.worstMaxMs, 38.645);
  assert.equal(verdict.worstRunIndex, 4);
});

test('تشغيلات أقل من الحد المعلن ترفض ولو كانت كلها سليمة', () => {
  const verdict = evaluateTailRuns(samples(2), POLICY);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.breaches[0]!.kind, 'runs');
  assert.equal(verdict.breaches[0]!.measured, 2);
});

test('لا تشغيل أصلا يرفض ولا يقرأ نجاحا فارغا', () => {
  const verdict = evaluateTailRuns([], POLICY);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.runs, 0);
  assert.equal(verdict.worstMaxMs, 0);
});

test('سكان أقل من السقف يرفض لأن الذيل يقاس عند السقف لا تحته', () => {
  const verdict = evaluateTailRuns(samples(3, { population: 50_000 }), POLICY);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.breaches.filter((b) => b.kind === 'population').length, 3);
});

test('سكان فوق السقف مقبول: قياس أشد لا أخف', () => {
  const verdict = evaluateTailRuns(samples(3, { population: 3_000_000 }), POLICY);
  assert.equal(verdict.ok, true);
});

test('العتبة تأتي من السياسة الممررة لا من رقم مكتوب في المنطق', () => {
  const strict = evaluateTailRuns(samples(3), { ...POLICY, gatewayMaxMs: 5 });
  assert.equal(strict.ok, false);
  assert.equal(strict.breaches.every((b) => b.kind === 'max' && b.allowed === 5), true);
});

test('وصف التجاوز يسمي التشغيل والمقياس والمقيس والمسموح', () => {
  const text = describeBreach({ runIndex: 7, kind: 'max', measured: 38.645, allowed: 25 });
  assert.match(text, /التشغيل 7/);
  assert.match(text, /38\.645/);
  assert.match(text, /25/);
  assert.match(text, /فوق العتبة/);
});

test('أعلى ذاكرة وأبطأ توزيع يرفعان للحكم كما هما', () => {
  const mixed = [parseBenchOutput(rawOutput({ rss: 700.5, distribution: 20_000 }), 1), parseBenchOutput(rawOutput({ rss: 1_512.25, distribution: 31_400 }), 2), ...samples(1)];
  const verdict = evaluateTailRuns(mixed, { ...POLICY, minRuns: 3 });
  // الخرجُ الخام يحمل خانةً عشريّةً واحدة للذاكرة، فالمقروءُ 1512.3 لا 1512.25 — يُقرأ كما طُبع.
  assert.equal(verdict.peakRssMiB, 1_512.3);
  assert.equal(verdict.slowestDistributionMs, 31_400);
});
