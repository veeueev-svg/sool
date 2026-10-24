/**
 * تطفيراتُ الجولةِ الحاديةَ عشرةَ — W-2026-040 (علاجُ عيوبِ مجلسِ المراجعةِ السابعةِ · محضر
 * `docs/work/council/W-2026-040-7.json` · اكتشافُ الصفِّ `COUNCIL7_W040_UNANIMOUS_REJECTED`).
 *
 * العيوبُ العشرةُ المسماةُ — خامُّ gpt وgrok وgemini بحروفِها — وكلُّ وجهٍ هنا يقيسُ واحدًا منها:
 *   - `RC14_REFLECT_GET_STILL_NAME_SHAPED` (الجذرُ · gpt adv-01 · grok 4.4 · gemini):
 *     `Reflect['get']` · `const R = Reflect; R.get` · `globalThis.Reflect.get` — الجلبُ الانعكاسيُّ
 *     بأشكالِهِ كلِّها بابُ وصولٍ إلى منشئِ الدالّةِ بلا قراءةٍ ساكنة.
 *   - `RC14_DESCRIPTOR_STILL_NAME_SHAPED` (grok 4.5 · gemini): `Object['getOwnPropertyDescriptor']` ·
 *     `const O = Object; O.getOwnPropertyDescriptor` — الواصفُ يبلغُ القيمةَ ديناميكيًّا.
 *   - `RC14_GLOBAL_PROPERTY_ACCESS_UNSEEN` (gemini): `globalThis.globalThis` بمفتاحٍ مشتقٍّ.
 *   - `RC14_REQUIRE_ALIAS_GREENS` (grok 4.6): `const req = require; req('node:vm')` — محمّلُ
 *     الوحداتِ المستعارُ يُرى بالنوعِ لا بالاسمِ.
 *   - `RC14_CTOR_KEY_VIA_CONST_BINDING_GREENS` (grok 4.7): مفتاحُ `constructor` بربطِ ثابتٍ مطويٍّ.
 *   - `RC14_CROSS_MODULE_GLOBAL_ALIAS_GREENS` (grok 4.8): `const g = globalThis` يعبرُ الوحداتِ.
 *   - `RC07_ALIASED_EXPORT_CHOKEPOINT_GREENS` (grok 4.1): كنيّةُ تصديرٍ لا ترمي `notBarrier as
 *     assertRehydrateCensus` — الاسمُ الذاتيُّ للتعريفِ هو الهويةُ لا نصِّ الاستيرادِ.
 *   - `RC07_SPECIFIER_SUFFIX_NOT_RESOLVED_MODULE` (grok 4.2): وحدةٌ مزيفةٌ بلاحقةِ محدِّدٍ مطابقةٍ —
 *     ملكيّةُ الملفِّ المعرِّفِ هي الحكمُ لا لاحقةُ النصِّ.
 *   - `RC07_RENAME_OF_REAL_EXPORT_FALSE_REJECT` (grok 4.3 · وجهُ رفضٍ كاذبٍ): `as checkCensus`
 *     والنطاقُ `census.assertRehydrateCensus` — المسمّى الصحيحُ يصلُ إلى التعريفِ نفسِهِ فيُخضِرّ
 *     (قِيسَ في الوجوهِ الحيّةِ لا السالبةِ).
 *   - `FACE_COUNT_INCONSISTENT_9_VS_11`: عيبُ توثيقٍ لا اختبارٍ — عولج بإلحاقٍ مؤرَّخٍ في عقدِ البندِ.
 *
 * **إلحاقٌ مؤرَّخٌ (2026-10-24 · المعالجةُ الثانيةَ عشرةَ · عيوبُ مجلسِ الجولةِ الثامنةِ
 * `RC07_CHOKEPOINT_DEAD_GUARD_ACCEPTED` — خامُّ grok 4.3 وخامُّ gemini):** الحارسُ الميّتُ لا يحرسُ —
 * نداءُ الحاجزِ تحتَ `if (false)` أو داخلَ دالّةٍ داخليةٍ لا تُنداءُ كانَ يُقبلُ حارسًا لنقطةِ الاختناقِ
 * فتخضرُّ البوابةُ. عولجَ في `scripts/rehydrate_barrier_binding.ts` (`callIsLiveInBody`) وأُضيفَ الوجهانِ
 * السالبانِ (الفرعُ الميّتُ · الدالّةُ الداخليةُ الميتةُ) والوجهُ الحيّ (حارسٌ تحتَ شرطٍ حيٍّ لا يُرفَض) —
 * القياسُ قبل/بعد بنمطِ مسباري gemini (PROBE-04/PROBE-05): قبلُ exit=0 · بعدُ exit=1 برمزِ RC-07.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-11.md) وقياساتِهِ الخامّة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateRoot, patch } from './rehydrate_census_harness';

const INDEX = 'src/index.ts';
const PERSISTENCE = 'src/data/persistence.ts';
const CENSUS = 'src/data/rehydrate_census.ts';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';
const SCOPE = 'assertRehydrateCensus(persistenceConfig.policy.scope)';
const IMPORT_LINE = "import { assertRehydrateCensus } from './data/rehydrate_census';";
const PERSIST_IMPORT = "import { assertExemptionsHold, assertRehydrateCensus } from './rehydrate_census';";
const boot = (to: string) => (root: string): void => patch(root, INDEX, CENSUS_CALL, to);
const bootImport = (to: string) => (root: string): void => patch(root, INDEX, IMPORT_LINE, to);

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };
const WRITE = `'j.record("archive_snapshot", {})'`;

const NEGATIVE: readonly Face[] = [
  // ── الجلبُ الانعكاسيّ: gpt adv-01 · grok 4.4 · gemini ──
  { code: 'RC-14', why: "`Reflect['get'](globalThis, 'Function')('j', …)` — الجلبُ الانعكاسيُّ بالفهرسِ يبلغُ منشئَ الدالّةِ (adv-01 عندَ gpt · 4.4 عندَ grok)",
    mutate: sink('probeR11ReflectBracket', ["  const f = Reflect['get'](globalThis, 'Function')('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); void j;"]) },
  { code: 'RC-14', why: "`const R = Reflect; R.get(globalThis, 'Function')('j', …)` — استعارةُ الجلبِ تُحَلُّ بالتوقيعِ لا بالاسمِ المنقّطِ (4.4 عندَ grok · مسبارُ gemini)",
    mutate: sink('probeR11ReflectAlias', ["  const R = Reflect; const f = (R.get(globalThis, 'Function') as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); void j;"]) },
  { code: 'RC-14', why: "`globalThis.Reflect.get(globalThis, 'Function')('j', …)` — الوصولُ المنقّطُ عبرَ الكائنِ العالميِّ بابٌ كالفهرسِ (4.4 عندَ grok)",
    mutate: sink('probeR11ReflectDotted', ["  const f = (globalThis.Reflect.get(globalThis, 'Function') as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); void j;"]) },
  // ── الواصفُ: grok 4.5 · gemini ──
  { code: 'RC-14', why: "`Object['getOwnPropertyDescriptor'](globalThis, 'Function')` — واصفُ الخاصّيّةِ بالفهرسِ يبلغُ القيمةَ ديناميكيًّا (مسبارُ gemini)",
    mutate: sink('probeR11DescBracket', ["  const d = Object['getOwnPropertyDescriptor'](globalThis, 'Function');", "  if (d !== undefined) { const f = (d.value as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); }", "  void j;"]) },
  { code: 'RC-14', why: "`const O = Object; O.getOwnPropertyDescriptor(globalThis, 'Function')` — استعارةُ الواصفِ تُحَلُّ بالتوقيعِ (4.5 عندَ grok)",
    mutate: sink('probeR11DescAlias', ["  const O = Object; const d = O.getOwnPropertyDescriptor(globalThis, 'Function');", "  if (d !== undefined) { const f = (d.value as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); }", "  void j;"]) },
  // ── الكائنُ العالميّ: gemini ──
  { code: 'RC-14', why: "`globalThis.globalThis[مفتاحٍ مشتقٍّ]` — سلسلةُ الكائنِ العالميِّ تُرى بنوعِ المستقبِلِ لا بأسماءِ المستعاراتِ (مسبارُ gemini)",
    mutate: sink('probeR11GlobalChain', ["  const k: string = String.fromCharCode(70, 117, 110, 99, 116, 105, 111, 110);", "  const f = (globalThis.globalThis[k] as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); void j;"]) },
  // ── محمّلُ الوحداتِ المستعار: grok 4.6 ──
  { code: 'RC-14', why: "`const req = require; req('node:vm').runInThisContext(…)` — الاستعارةُ تُرى بمطابقةِ النوعِ مع نوعِ require العالميّ (4.6 عندَ grok)",
    mutate: sink('probeR11RequireAlias', ["  const req = require; req('node:vm').runInThisContext('globalThis.j.record(\"archive_snapshot\", {})'); void j;"]) },
  // ── مفتاحُ constructor بربطِ ثابتٍ: grok 4.7 ──
  { code: 'RC-14', why: "`const k = 'constr'+'uctor'; box[k](…)` — المفتاحُ المحسوبُ بربطِ ثابتٍ يُطوى من نوعِ المستدعى `FunctionConstructor` (4.7 عندَ grok)",
    mutate: sink('probeR11ConstKey', ["  const k = 'constr' + 'uctor';", "  const box = (j as unknown) as Record<string, FunctionConstructor>;", "  box[k]('j', 'globalThis.j.record(\"archive_snapshot\", {})'); void j;"]) },
  // ── الاستعارةُ العابرةُ للوحداتِ: grok 4.8 (بمفتاحٍ مشتقٍّ لا حرفيٍّ — المفتاحُ الحرفيُّ كانَ يُدرَكُ قبلًا) ──
  { code: 'RC-14', why: "`export const g = globalThis` في وحدةٍ أخرى ثمّ `g[k]` بمفتاحٍ مشتقٍّ لا حرفيٍّ — العبورُ بينَ الوحداتِ لا يُبرّئ النوعَ (4.8 عندَ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/data/global_alias.ts'), 'export const g: typeof globalThis = globalThis;\n');
      sink('probeR11CrossModule', ["  const k: string = 'Function';", "  const f = (gg[k] as FunctionConstructor)('j', 'globalThis.j.record(\"archive_snapshot\", {})'); f(); void j;"])(root);
      patch(root, PERSISTENCE, 'import { assertExemptionsHold, assertRehydrateCensus } from \'./rehydrate_census\';', "import { assertExemptionsHold, assertRehydrateCensus } from './rehydrate_census';\nimport { g as gg } from './global_alias';");
    } },
  // ── الهويةُ: كنيّةُ تصديرٍ لا ترمي — grok 4.1 ──
  { code: 'RC-07', why: "`export { notBarrier as assertRehydrateCensus }` وكنيّةُ `notHold as assertExemptionsHold` — الاسمُ الذاتيُّ للتعريفِ هو الهويةُ: الكنيّةُ تُحَلُّ إلى تعريفٍ اسمُهُ لا يطابقُ (4.1 عندَ grok)",
    mutate: (root) => {
      appendFileSync(join(root, CENSUS), 'export function notBarrier(): void { void 0; }\nexport function notHold(): void { void 0; }\n');
      bootImport("import { notBarrier as assertRehydrateCensus } from './data/rehydrate_census';")(root);
      patch(root, PERSISTENCE, PERSIST_IMPORT, "import { notHold as assertExemptionsHold, notBarrier as assertRehydrateCensus } from './rehydrate_census';");
    } },
  // ── الهويةُ: لاحقةُ نصٍّ لا وحدةٌ محلولةٌ — grok 4.2 ──
  { code: 'RC-07', why: "`src/vendor/data/rehydrate_census.ts` بواجهةٍ مزيفةٍ ولاحقةِ محدِّدٍ مطابقةٍ — ملكيّةُ الملفِّ المعرِّفِ هي الحكمُ لا لاحقةُ النصِّ (4.2 عندَ grok)",
    mutate: (root) => {
      mkdirSync(join(root, 'src/vendor/data'), { recursive: true });
      writeFileSync(join(root, 'src/vendor/data/rehydrate_census.ts'), 'export function assertRehydrateCensus(scope: readonly string[]): void { void scope; }\nexport function assertExemptionsHold(): void { void 0; }\n');
      bootImport("import { assertRehydrateCensus } from './vendor/data/rehydrate_census';")(root);
    } },
  // ── الحارسُ الميّتُ لا يحرسُ: المعالجةُ الثانيةَ عشرةَ (عيوبُ الجولةِ الثامنةِ · خامُّ grok 4.3 وخامُّ gemini) ──
  { code: 'RC-07', why: "`if (false) { assertExemptionsHold(…) }` — نداءُ الحاجزِ في فرعٍ ثابتِ الكذبِ لا يُنفَّذُ أصلًا فلا يحرسُ نقطةَ الاختناقِ (مسبارُ gemini PROBE-04 · قِيسَ قبلُ ينجو: exit=0)",
    mutate: (root) => { patch(root, PERSISTENCE, 'assertExemptionsHold(entries.map((e) => e.kind));', 'if (false) { assertExemptionsHold(entries.map((e) => e.kind)); }'); } },
  { code: 'RC-07', why: "`const dummy = () => { assertExemptionsHold([]); }; void dummy;` — نداءُ الحاجزِ داخلَ دالّةٍ داخليةٍ لا تُنداءُ لا يُنفَّذُ بجريانِ الجسمِ الحاوي فلا يحرسُ الاختناقَ (مسبارُ gemini PROBE-05 · قِيسَ قبلُ ينجو: exit=0)",
    mutate: (root) => { patch(root, PERSISTENCE, 'assertExemptionsHold(entries.map((e) => e.kind));', 'const dummy = () => { assertExemptionsHold([]); }; void dummy;'); } },
];

const LIVE: readonly Face[] = [
  { code: '', why: "`import { assertRehydrateCensus as checkCensus }` — المسمّى الصحيحُ يصلُ إلى التعريفِ نفسِهِ فلا يُرفَضُ (4.3 عندَ grok — الرفضُ الكاذبُ)",
    mutate: (root) => {
      bootImport("import { assertRehydrateCensus as checkCensus } from './data/rehydrate_census';")(root);
      patch(root, INDEX, CENSUS_CALL, 'if (journal) checkCensus(persistenceConfig.policy.scope);');
    } },
  { code: '', why: "`import * as census` ثمّ `census.assertRehydrateCensus(…)` — وصولُ النطاقِ يصلُ إلى التعريفِ نفسِهِ فلا يُرفَض",
    mutate: (root) => {
      bootImport("import * as census from './data/rehydrate_census';")(root);
      patch(root, INDEX, CENSUS_CALL, 'if (journal) census.assertRehydrateCensus(persistenceConfig.policy.scope);');
    } },
  { code: '', why: "`if (entries.length > 0) { assertExemptionsHold(…) }` — حارسٌ تحتَ شرطٍ حيٍّ غيرِ ثابتِ الكذبِ يُنفَّذُ في جريانِ الجسمِ فلا يُرفَضُ (وجهُ الرفضِ الكاذبِ للمعالجةِ الثانيةَ عشرةَ)",
    mutate: (root) => { patch(root, PERSISTENCE, 'assertExemptionsHold(entries.map((e) => e.kind));', 'if (entries.length > 0) { assertExemptionsHold(entries.map((e) => e.kind)); }'); } },
  { code: '', why: 'مستدعًى محليٌّ نوعُهُ دالّةٌ مرئيّةُ الجسمِ (`() => void`) — النوعُ يفرّقُهُ عن `Function` المجهولِ الجسمِ',
    mutate: sink('liveR11TypedFn', ["  const f: () => void = () => {}; f(); void j;"]) },
  { code: '', why: 'فهرسٌ حرفيٌّ على كائنٍ محليٍّ محدودِ الأعضاءِ لا على الكائنِ العالميِّ — الأبوابُ تُقاسُ بالنوعِ لا بكلِّ فهرسٍ',
    mutate: sink('liveR11LocalIndex', ["  const box: Record<string, number> = { alpha: 1 };", "  void box['alpha']; void j;"]) },
];

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ السابعةِ تُسقِطُه برموزِها — الآليةُ أنواعٌ ورموزٌ محلولةٌ لا قائمةُ أشكال', () => {
  for (const m of NEGATIVE) {
    const g = gateRoot();
    try {
      m.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 1, `${m.code}: التطفيرُ نجا — ${m.why}\n${r.out}`);
      assert.match(r.out, new RegExp(`\\[${m.code}\\]`), `${m.code}: سقط بغير رمزه — ${m.why}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});

test('الحاجزُ الساكن: الوجوهُ الحيّةُ للجولةِ الحاديةَ عشرةَ لا تُرفَض', () => {
  for (const f of LIVE) {
    const g = gateRoot();
    try {
      f.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 0, `حاجزٌ رفض وجهًا حيًّا: ${f.why}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});
