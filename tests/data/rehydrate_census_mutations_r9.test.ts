/**
 * تطفيراتُ الجولةِ التاسعة — W-2026-040 (علاجُ عيوبِ مجلسِ المراجعةِ الخامسة · محضر
 * `docs/work/council/W-2026-040-5.json` · اكتشافُ الصفِّ `COUNCIL5_W040_SPLIT_REJECTED`).
 *
 * العيوبُ السبعةُ المسماةُ — خامُّ gpt وgrok بحروفِهِ — وكلُّ وجهٍ هنا يقيسُ واحدًا منها:
 *   - `RC07_SHADOWED_UNDEFINED_NULLISH_SKIPS_CENSUS` (gpt §3): `const undefined = false` ثمّ
 *     `undefined ?? census()` — العدميّةُ لم تسألْ عن التظليل.
 *   - `RC07_SHADOWED_NAN_SCOPE_FALSE_REJECT` (gpt §4): تظليلُ `NaN` في دالّةٍ أخرى يرفضُ
 *     `NaN || census()` الحيَّ — التظليلُ صار معجميَّ النطاقِ لا «أيَّ إعلانٍ في الملفّ».
 *   - `RC07_BIGINT_SWITCH_DEAD_DEFAULT_GREENS` (grok §5-أ): قيمةُ BigInt تدخلُ مقارنةَ `case`.
 *   - `RC07_UNLABELED_BREAK_DEAD_CENSUS_GREENS` (grok §5-ب): `for (;;) { break; census() }`.
 *   - `RC07_DYNAMIC_PRODUCERS_UNSEEN` (grok §5-ج): `new Function` · `eval` · `globalThis['Function']` · `import('data:…')`.
 *   - `JS_IN_SRC_UNSEEN_BY_CENSUS_SCAN` (grok §5-د): ملفُّ `.js` تحت `src/**`.
 *   - `RC07_CATCH_NONTHROWING_CALL_COUNTED_LIVE` (grok §5-هـ): `try { console.log() } catch { census() }`.
 * ومعها ثلاثةُ أوجهٍ قاسها المنفّذُ من العائلةِ نفسِها قبلَ العلاج (`…-remedy-9-measurements.txt`):
 * بندُ تبديلٍ مجهولُ المميّز · `break` مشروطٌ قبلَ الحاجزِ في حلقة · الحاجزُ في `try` يُبلَعُ رميُه.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateRoot, patch } from './rehydrate_census_harness';

const INDEX = 'src/index.ts';
const PERSISTENCE = 'src/data/persistence.ts';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';
const SCOPE = 'assertRehydrateCensus(persistenceConfig.policy.scope)';
const boot = (to: string) => (root: string): void => patch(root, INDEX, CENSUS_CALL, to);

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };
const WRITE = `'j.record("archive_snapshot", {})'`;

const NEGATIVE: readonly Face[] = [
  // ── العدميّةُ تسألُ عن التظليل (gpt §3) ──
  { code: 'RC-07', why: '`const undefined = false` ثمّ `undefined ?? census()` — ربطٌ محليٌّ غيرُ معدومٍ فالنداءُ لا يُنفَّذ',
    mutate: boot(`const undefined = false;\n  if (journal) undefined ?? ${SCOPE};`) },
  // ── قيمةُ BigInt في التبديل (grok §5-أ) ──
  { code: 'RC-07', why: '`switch (0n) { case 0n: break; default: census() }` — الافتراضيُّ لا يُدخَل',
    mutate: boot(`switch (0n) { case 0n: break; default: ${CENSUS_CALL} }`) },
  { code: 'RC-07', why: '`switch (0n) { case 1n: census() }` — بندٌ يخالفُ المميّز',
    mutate: boot(`switch (0n) { case 1n: ${CENSUS_CALL} }`) },
  { code: 'RC-07', why: 'بندُ تبديلٍ مميّزُه مجهول — دخولُه مشروطٌ فلا يؤيّدُ السيادة (وجهُ المنفّذ)',
    mutate: boot(`switch (process.argv.length) { case 9: ${CENSUS_CALL} }`) },
  // ── الخروجُ قبلَ الحاجز (grok §5-ب) ──
  { code: 'RC-07', why: '`for (;;) { break; census() }` — `break` عارٍ يُميتُ ما بعدَه',
    mutate: boot(`for (;;) { break; ${CENSUS_CALL} }`) },
  { code: 'RC-07', why: '`for (;;) { if (x) break; census(); break; }` — خروجٌ مشروطٌ قبلَ الحاجز (وجهُ المنفّذ)',
    mutate: boot(`for (;;) { if (process.argv.length > 9) break; ${CENSUS_CALL} break; }`) },
  // ── الالتقاطُ منطقةٌ مشروطة (grok §5-هـ) ──
  { code: 'RC-07', why: "`try { console.log('m') } catch { census() }` — الـcatch لا يُدخَلُ إلا برمي",
    mutate: boot(`try { console.log('m'); } catch { ${CENSUS_CALL} }`) },
  { code: 'RC-07', why: '`try { census() } catch {}` — رميُ الحاجزِ يُبلَعُ ثمّ يمضي الإرجاع (وجهُ المنفّذ)',
    mutate: boot(`try { ${CENSUS_CALL} } catch { /* بلع */ }`) },
  // ── الشفرةُ المعتمة (grok §5-ج) ──
  { code: 'RC-14', why: '`new Function(…)(j)` — نصٌّ يصيرُ شفرةً تكتبُ المُعفى',
    mutate: sink('probeR9Fn', [`  new Function('j', ${WRITE})(j);`]) },
  { code: 'RC-14', why: '`eval(…)` — يرى النطاقَ المحليَّ فيكتبُ بلا وسيط',
    mutate: sink('probeR9Eval', [`  eval(${WRITE}); void j;`]) },
  { code: 'RC-14', why: "`globalThis['Function']` — منشئُ الدالّةِ بفهرسٍ على الكائنِ العالميّ",
    mutate: sink('probeR9Gt', [`  new (globalThis['Function'] as FunctionConstructor)('j', ${WRITE})(j);`]) },
  { code: 'RC-14', why: "`import('data:…')` ثمّ `m.default(j)` — وحدةٌ تحملُ شفرتَها",
    mutate: sink('probeR9Imp', [`  const code = 'export default (j) => j.record("archive_snapshot", {})';`,
      "  void import('data:text/javascript,' + code).then((m) => m.default(j));"]) },
  { code: 'RC-14', why: '`(() => 0).constructor(…)` — منشئُ الدالّةِ من أيِّ دالّة',
    mutate: sink('probeR9Ctor', [`  (() => 0).constructor('j', ${WRITE})(j);`]) },
  // ── ملفُّ شفرةٍ غيرُ TS تحت src/** (grok §5-د) ──
  { code: 'RC-04', why: "`src/data/probe.js` يكتبُ `j.record('archive_snapshot')` — صار يُرى",
    mutate: (root) => writeFileSync(join(root, 'src/data/probe_r9.js'), "module.exports = (j) => j.record('archive_snapshot', {});\n") },
  { code: 'RC-14', why: '`src/data/probe.mjs` بصنفٍ غيرِ حرفيّ — ملفٌّ لا يدخلُ البرنامجَ النوعيَّ فلا يُبرهَنُ الغيابُ فيه',
    mutate: (root) => writeFileSync(join(root, 'src/data/probe_r9.mjs'), 'export default (j, k) => j.record(k, {});\n') },
];

const LIVE: readonly Face[] = [
  { code: '', why: 'تظليلُ `NaN` في دالّةٍ أخرى لا يمسُّ `NaN` العالميَّ في `bootstrapState` (gpt §4)',
    mutate: (root) => {
      boot(`if (journal) NaN || ${SCOPE};`)(root);
      appendFileSync(join(root, INDEX), '\nexport function probeR9ShadowNaN(): number { const NaN = 1; return NaN; }\n');
    } },
  { code: '', why: '`undefined ?? census()` العالميُّ — يُنفَّذُ الطرفُ الأيمن', mutate: boot(`if (journal) undefined ?? ${SCOPE};`) },
  { code: '', why: '`switch (0n) { case 0n: census() }` — البندُ المدخولُ حتمًا ممرٌّ لا ذرّةٌ معتمة',
    mutate: boot(`switch (0n) { case 0n: ${CENSUS_CALL} }`) },
  { code: '', why: '`for (;;) { census(); break; }` — الخروجُ بعدَ الحاجزِ لا قبلَه', mutate: boot(`for (;;) { ${CENSUS_CALL} break; }`) },
  { code: '', why: '`try {} finally { census() }` — `finally` يُنفَّذُ دائمًا', mutate: boot(`try { void 0; } finally { ${CENSUS_CALL} }`) },
  { code: '', why: "`j.record('ledger_entry')` — منتِجٌ صادقٌ لصنفٍ غيرِ مُعفًى", mutate: sink('liveR9Ledger', ["  j.record('ledger_entry', {});"]) },
];

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ الخامسةِ تُسقِطُه برموزِها — المنطقةُ تُثبَتُ لا يُفترَض والشفرةُ المعتمةُ لا تؤيّدُ الغياب', () => {
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

test('الحاجزُ الساكن: الوجوهُ الحيّةُ للجولةِ التاسعةِ لا تُرفَض', () => {
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

test('الحاجزُ الساكن: نداءُ حاجزٍ في `catch` لا يُعَدُّ سيّدًا — والسيّدُ المسمّى هو النداءُ الحقيقيُّ بعدَه (RC07_CATCH_NONTHROWING_CALL_COUNTED_LIVE)', () => {
  const g = gateRoot();
  try {
    boot(`try { console.log('m'); } catch { ${SCOPE}; }\n  ${CENSUS_CALL}`)(g.root);
    const r = g.run();
    assert.equal(r.code, 0, `النداءُ الحقيقيُّ يسودُ فلا رفض:\n${r.out}`);
    const m = /السيّدُ السطر (\d+) \{([^}]*)\}/.exec(r.out);
    assert.ok(m !== null, `السيّدُ غيرُ مسمًّى:\n${r.out}`);
    assert.doesNotMatch(m[2] ?? '', /region:catch/, `نداءُ الـcatch عُدَّ سيّدًا:\n${r.out}`);
    assert.match(r.out, /من 2 نداءِ حاجز/, `لم يُقَس النداءانِ كلاهما:\n${r.out}`);
  } finally {
    g.clean();
  }
});
