/**
 * تطفيراتُ الجولةِ الثانيةَ عشرةَ — W-2026-040 (المعالجةُ الثالثةَ عشرةَ · عيوبُ مجلسِ
 * المراجعةِ الثامنةِ الخمسةِ الباقيةِ · محضرُ `docs/work/council/W-2026-040-8.json`).
 *
 * عولجَ من الجذرِ بالآليةِ لا بتوسيعِ قائمةِ الأشكالِ: القياسُ صار **تدفّقًا لأصلِ القيمةِ**
 * (`scripts/rehydrate_value_origin.ts`) — البوابةُ تسألُ عن مصدرِ قيمةِ المستدعى لا عن نوعِه
 * المعلَنِ عندَ النداءِ. وكلُّ وجهٍ هنا يقيسُ واحدًا من العيوبِ الخمسةِ بحروفِ مسبارِهِ:
 *
 *   - `RC14_CALL_APPLY_TRAMPOLINE_ESCAPE_GREENS` (§4.2 · 1 و2 و3): عبورُ رموزِ التنفيذِ عبرَ
 *     توابعِ المرجعِ — `Reflect.apply(eval, …)` · `eval.call` · `eval.apply` — التوقيعُ المحلولُ
 *     هو الترامبولينُ لا الرمزَ المُعبَرَ.
 *   - `RC14_TYPE_LAUNDERING_GREENS` (§4.2 · 4 و5 و6 و7 و8): ربطٌ نوعيٌّ يمحو مصدرَ القيمةِ —
 *     `const run: (code) => unknown = eval` · التغسيلُ بالتحويلِ إلى `Record` · `Reflect.get as T`
 *     · `Reflect.apply(Function, …) as T` · `require` بتحويلٍ نوعيٍّ إلى مُحمِّلٍ معلَنٍ.
 *   - `RC14_ANY_CALL_NO_JOURNAL_ARG_GREENS` (§4.2 · 9 و10): `any` يمرِّرُ رمزَ تنفيذٍ بلا
 *     وسيطِ يوميّةٍ — `const evil: any = eval; evil(…)` · `const evil: any = { run: eval }`.
 *   - `RC14_FALSE_REJECTS_CONSTRUCTOR_AND_SAFE_INDEX` (§4.4): الرفضُ الكاذبُ عولجَ في الجريانِ
 *     نفسِهِ — الوجهانِ الحيّانِ أدناهُ (`date.constructor` · `globalThis['queueMicrotask']`).
 *   - `DECLARED_ANY_LIMIT_MISDIAGNOSED_ARRAY_ISARRAY` (§5): المواقعُ الحيّةُ الستُّ بياناتُ
 *     الجذرِ لا استثناءً صامتًا — الوجهُ الحيُّ الرابعُ يقيسُ النمطَ نفسَهُ (وصولُ خاصّيّةٍ على
 *     معاملِ `any` جذرُهُ بياناتٌ) فيُخضَرّ، والتصويبُ مُلحقٌ مؤرَّخًا في ترويسةِ البوابةِ.
 *
 * وجهانِ إضافيّانِ منَ المراجعةِ التصميميّةِ للجلسةِ (لا من خامِّ الأعضاءِ): إعادةُ إسنادِ
 * الخاصّيّةِ بعدَ المُهيِّئِ (`box.run = eval`) والمعاملُ الصريحُ `any` المستدعى مباشرةً —
 * كلاهما من جنسِ عيوبِ الجولةِ الثامنةِ (تدفّقُ القيمةِ لا شكلُ النداءِ).
 *
 * وجهٌ حيٌّ سادسٌ أُضيفَ بعدَ جولةِ الاختبارِ الكاملةِ الأولى: النداءُ إلى رمزٍ غيرِ محلولٍ
 * (`rehydrateProbeBypass()`) — اكتشفهُ وجهُ الجولةِ الخامسةِ الحيُّ إذ رفضتهُ مُعرِّفُ الأصلِ
 * الجديدُ كمعتمٍ؛ والتصويبُ: الرمزُ غيرُ المحلولِ لا يدخلُ برنامجًا مترجَمًا (فشلُ tsc
 * «Cannot find name») فلا يكونُ وجهَ إنتاجٍ قابلاً للحياةِ — يبقى أخضرَ كما في البوابةِ القديمةِ.
 *
 * **حدٌّ معلَنٌ باقٍ (لا يُقاسُ هنا):** الدالّةُ الداخليةُ المعرّفةُ باسمٍ والمستدعاةُ لاحقًا
 * (RC-07 · تحليلٌ بينيٌّ) — عهدُها مفتوحٌ في صفِّ البندِ لا في هذه المعالجةِ.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-13.md) وقياساتِهِ الخامّة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateRoot } from './rehydrate_census_harness';

const PERSISTENCE = 'src/data/persistence.ts';
const WRITE = 'globalThis.j.record("archive_snapshot", {})';

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };

const NEGATIVE: readonly Face[] = [
  // ── RC14_CALL_APPLY_TRAMPOLINE_ESCAPE_GREENS — خامّ grok §4.2 (1 · 2 · 3) ──
  { code: 'RC-14', why: "`Reflect.apply(eval, globalThis, ['…'])` — العبورُ عبرَ apply الانعكاسيّ: الفاعلُ هو الوسيطُ الأولُ لا اسمُ المستدعى (مسبرُ grok 1)",
    mutate: sink('probeR12ReflectApplyEval', [`  Reflect.apply(eval, globalThis, ['${WRITE}']);`]) },
  { code: 'RC-14', why: "`eval.call(globalThis, '…')` — الترامبولينُ بالإزاحةِ: المستقبِلُ هو الأساسُ والوسيطُ الأولُ مُزاحٌ (مسبرُ grok 2)",
    mutate: sink('probeR12EvalCall', [`  eval.call(globalThis, '${WRITE}');`]) },
  { code: 'RC-14', why: "`eval.apply(globalThis, ['…'])` — الترامبولينُ بمصفوفةِ الوسيطاتِ المفكوكةِ (مسبرُ grok 3)",
    mutate: sink('probeR12EvalApply', [`  eval.apply(globalThis, ['${WRITE}']);`]) },
  // ── RC14_TYPE_LAUNDERING_GREENS — خامّ grok §4.2 (4 · 5 · 6 · 7 · 8) ──
  { code: 'RC-14', why: "`const run: (code: string) => unknown = eval; run('…')` — الربطُ النوعيُّ يمحو النوعَ لا القيمةَ: أصلُ run هو eval (مسبرُ grok 4)",
    mutate: sink('probeR12TypedEvalBinding', [`  const run: (code: string) => unknown = eval; run('${WRITE}');`]) },
  { code: 'RC-14', why: "`globalThis as unknown as Record<…>` ثمّ `box[k]` بمفتاحٍ غيرِ مطويٍّ — التغسيلُ بالتحويلِ لا يُخفي أصلَ الكائنِ العالميّ (مسبرُ grok 5)",
    mutate: sink('probeR12LaunderedGlobalIndex', [`  const box = globalThis as unknown as Record<string, (a: string, b: string) => (arg: DurableSink) => void>;`, `  const k: string = 'Function'; box[k]('j', '${WRITE}')(j);`]) },
  { code: 'RC-14', why: "`Reflect.get as T` ثمّ النداءُ — الاستعارةُ بالتحويلِ النوعيِّ لا تُبرّئ أصلَ الجلبِ الانعكاسيّ (مسبرُ grok 6)",
    mutate: sink('probeR12CastReflectGet', [`  const get = Reflect.get as (t: object, key: string) => (a: string, b: string) => (arg: DurableSink) => void; get(globalThis, 'Function')('j', '${WRITE}')(j);`]) },
  { code: 'RC-14', why: "`Reflect.apply(Function, undefined, ['j', '…']) as T` ثمّ النداءُ — منشئُ الدالّةِ عبرَ الترامبولينِ والتحويلِ (مسبرُ grok 7)",
    mutate: sink('probeR12ReflectApplyFunction', [`  const f = Reflect.apply(Function, undefined, ['j', '${WRITE}']) as (arg: DurableSink) => void; f(j);`]) },
  { code: 'RC-14', why: "`const load: (id: string) => {…} = require; load('node:vm').runInThisContext('…')` — محمّلُ الوحداتِ بتحويلٍ نوعيٍّ معلَنٍ لا يُبرّئ أصلَه (مسبرُ grok 8)",
    mutate: sink('probeR12TypedRequire', [`  const load: (id: string) => { runInThisContext: (code: string) => unknown } = require; load('node:vm').runInThisContext('${WRITE}');`]) },
  // ── RC14_ANY_CALL_NO_JOURNAL_ARG_GREENS — خامّ grok §4.2 (9 · 10) ──
  { code: 'RC-14', why: "`const evil: any = eval; evil('…')` — تغسيلُ any بلا وسيطِ يوميّةٍ: أصلُ القيمةِ يُتْبَعُ إلى المُهيِّئِ (مسبرُ grok 9)",
    mutate: sink('probeR12AnyEval', [`  const evil: any = eval; evil('${WRITE}');`]) },
  { code: 'RC-14', why: "`const evil: any = { run: eval }; evil.run('…')` — الخاصّيّةُ في الكائنِ الحرفيِّ أصلُها المُهيِّئُ (مسبرُ grok 10)",
    mutate: sink('probeR12AnyRun', [`  const evil: any = { run: eval }; evil.run('${WRITE}');`]) },
  // ── منَ المراجعةِ التصميميّةِ للجلسةِ — جنسُ عيوبِ التدفّقِ نفسِهِ ──
  { code: 'RC-14', why: "`const box: any = { run: () => void 0 }; box.run = eval; box.run('…')` — إعادةُ إسنادِ الخاصّيّةِ بعدَ المُهيِّئِ تُدمَجُ في تدفّقِ أصلِها",
    mutate: sink('probeR12PropertyReassign', [`  const box: any = { run: (): void => void 0 }; box.run = eval; box.run('${WRITE}');`]) },
  { code: 'RC-14', why: "`export function viaParam(f: any, code: string) { f(code); }` — المعاملُ الصريحُ `any` المستدعى مباشرةً لا يُبرهَنُ أصلُه",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), `export function probeR12AnyParam(f: any, code: string): void { f(code); }\n`);
    } },
];

const LIVE: readonly Face[] = [
  { code: '', why: "`const date = new Date(); if (date.constructor === Date)` — منشئُ قيمةٍ معروفةِ النوعِ غيرِ دالّيّةٍ هو صنفُها البريء لا Function (عيوبُ الجولةِ الثامنةِ: الرفضُ الكاذبُ عولجَ)",
    mutate: sink('liveR12DateConstructor', [`  const date = new Date();`, `  if (date.constructor === Date) { void j; }`]) },
  { code: '', why: "`globalThis['queueMicrotask']` — فهرسةٌ مطويةٌ على الكائنِ العالميِّ بمفتاحٍ معروفِ النوعِ بريء (عيوبُ الجولةِ الثامنةِ: الرفضُ الكاذبُ عولجَ)",
    mutate: sink('liveR12SafeGlobalIndex', [`  const q = globalThis['queueMicrotask']; q((): void => { void j; });`]) },
  { code: '', why: "`const f: () => void = () => {}; f();` — دالّةٌ محليةٌ مرئيّةُ الجسمِ أصلُها بياناتٌ (وجوهُ الجولاتِ السابقةِ باقيةً)",
    mutate: sink('liveR12TypedFn', [`  const f: () => void = () => {}; f(); void j;`]) },
  { code: '', why: "`snapshot.identities.some((x: any) => x.agentId.startsWith('agent:'))` — وصولُ خاصّيّةٍ على معاملِ any جذرُهُ بياناتٌ (نمطُ المواقعِ الستِّ الحيّةِ — DECLARED_ANY_LIMIT): يُخضَرُّ لأنّ الأصلَ بياناتٌ لا تنفيذًا",
    mutate: sink('liveR12AnyDataRoot', [`  const snapshot: { identities: any[] } = { identities: [{ agentId: 'agent:1' }] };`, `  if (snapshot.identities.some((x: any) => x.agentId.startsWith('agent:'))) { void j; }`]) },
  { code: '', why: "`require.main === module` — فحصُ الوحدةِ الرئيسةِ بياناتٌ لا تنفيذًا (استثناءٌ معلَنٌ في وحدةِ الأصلِ)",
    mutate: sink('liveR12RequireMain', [`  if (require.main === module) { void j; }`]) },
  { code: '', why: "نداءٌ لرمزٍ غيرِ محلولٍ (`rehydrateProbeBypass()`) تحتَ شرطِ الحاجزِ نفسِهِ — لا يدخلُ برنامجًا مترجَمًا (فشلُ tsc «Cannot find name») فلا يُرفَعُ إلى وجهِ عيبٍ؛ يحفظُ الوجهَ الحيَّ الخامسَ (ج5)",
    mutate: (root) => {
      appendFileSync(join(root, 'src/index.ts'), `\nif (journal) rehydrateProbeBypass();\n`);
    } },
];

test('الحاجزُ الساكن: عيوبُ الجولةِ الثامنةِ تُسقِطُه برمزِها — القياسُ تدفّقُ أصلِ القيمةِ لا شكلُ النداءِ', () => {
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

test('الحاجزُ الساكن: وجوهُ الجولةِ الثانيةَ عشرةَ الحيّةُ لا تُرفَض — الرفضُ الكاذبُ عولجَ في الجريانِ نفسِهِ', () => {
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
