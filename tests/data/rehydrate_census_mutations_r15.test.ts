/**
 * تطفيراتُ الجولةِ الخامسةَ عشرةَ — W-2026-040 (المعالجةُ السادسةُ عشرةَ · عيوبُ مجلسِ
 * المراجعةِ الحاديَ عشرَ الأربعةَ عشرَ · محاضرُ `docs/work/council/W-2026-040-11-*.md`).
 *
 * جنسُ العيوبِ واحدٌ (كما حكمَ الأعضاءُ الثلاثةُ): قيمةُ تنفيذٍ تصلُ إلى نداءٍ ينفّذُ نصًّا
 * والحاجزُ يبقى أخضرَ — لأنّ قناةَ الوصولِ لم تُطوَ أو لأنّ الرفضَ الكاذبَ أغلقَ القنواتِ
 * البريئةَ. كلُّ وجهٍ هنا بحروفِ مسبارِ العضوِ الذي سمّاه (لا حرفٍ من عندِنا):
 *
 *   - gpt (الخامّ 1): التفكيكُ المتداخلُ أعمقَ من عمقِ المسحِ — `({a:{b:{c:{d:{e:{run:eval}}}}}}).a.b.c.d.e.run`.
 *   - gpt (الخامّ 2): دمجُ `Object.assign` على هدفٍ يُقرَأُ منهُ العضوُ المدموجُ.
 *   - grok (1): المفتاحُ غيرُ القابلِ للطيِّ — `box[key]` و`box[a+b]`.
 *   - grok (2): اشتقاقُ المصفوفةِ المعياريُّ — slice · concat · flat · flatMap · find · at · map · Array.from · spread.
 *   - grok (3): أبوابُ الاشتقاقِ القيميِّ — Object.values · entries · fromEntries · create.
 *   - grok (4): الأصنافُ — المنشئُ المجهولُ · المنهجُ الساكنُ · التوريثُ · `this.run` · الخاصّيّةُ الخاصّةُ `#run`.
 *   - grok (5): عمقُ المسحِ — الصندوقُ المتداخلُ على عمقٍ سادسٍ.
 *   - grok (6): الاستيرادُ الديناميكيُّ `await import('./c11_mod')` — التصديرُ مُسندٌ لتنفيذٍ.
 *   - grok (7): موضعُ النداءِ — معاملٌ مجهولُ النوعِ · معاملٌ كائنيٌّ · عنصرُ تفكيكٍ · وسيطُ الراحةِ.
 *   - grok (8): المعاملُ الذي لا يُرى موضعُ نداءٍ لدالتِهِ — جذرُ المعاملِ الآن يُسألُ (كانَ
 *     يُخضَّرُ كذبًا — بندُهُ سُمّيَ نقشًا لا حدًّا معلَنًا في العريضةِ).
 *   - gemini (1 · 2): الصنفُ ومنهجُهُ (`this.run`) والمنهجُ الساكنُ `Box.run()`.
 *   - gemini (3): دمجُ `Object.assign` على هدفٍ معرّفٍ (`const target: any`).
 *
 * **وجوهُ الرفضِ الكاذبِ (تقيسُ البراءةَ — LIVE):** جلسةُ grok أثبتَتْ أنّ `eval.name` ·
 * `Function.length` · `Function.prototype` كانتْ تُرفضُ خطأً — قراءةُ خاصّيّةٍ على رمزِ تنفيذٍ
 * تُسألُ من نوعِها: الخاملُ بياناتٌ والحاملُ للنداءِ تنفيذٌ.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-16.md) وقياساتِهِ الخامّة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gateRoot } from './rehydrate_census_harness';

const PERSISTENCE = 'src/data/persistence.ts';
const WRITE = 'globalThis.j.record("archive_snapshot", {})';

/** دالّةٌ تُلحَقُ بـ`persistence.ts` بمُستقبِلٍ من نوعِ اليوميّةِ الحقيقيِّ `DurableSink` */
const sink = (name: string, body: readonly string[]): ((root: string) => void) => (root) =>
  appendFileSync(join(root, PERSISTENCE), [`export function ${name}(j: DurableSink): void {`, ...body, '}', ''].join('\n'));

type Face = { readonly code: string; readonly why: string; readonly mutate: (root: string) => void };

const NEGATIVE: readonly Face[] = [
  // ── خامّ gpt 1: التفكيكُ المتداخلُ أعمقَ من عمقِ المسحِ ──
  { code: 'RC-14', why: "`const evil: any = box.a.b.c.d.run` حيثُ الصندوقُ متداخلٌ خمسًا — الكنيةُ المقرؤةُ ثمّ المناداةُ (مسبارُ gpt حرفيًّا)",
    mutate: sink('probeR16DeepNested', [
      `  const box = { a: { b: { c: { d: { run: eval } } } } };`,
      `  const evil: any = box.a.b.c.d.run;`,
      `  evil('j.record("archive_snapshot", {})');`,
      `  void j;`,
    ]) },
  // ── خامّ gpt 2: دمجُ Object.assign ──
  { code: 'RC-14', why: "`const target: any = {}; Object.assign(target, source)` و`source = { run: eval }` — الدمجُ يُرى اتحادَ حججِهِ (مسبارُ gpt)",
    mutate: sink('probeR16AssignMergeSource', [
      `  const source = { run: eval };`,
      `  const box = Object.assign({}, source);`,
      `  const evil: any = box.run;`,
      `  evil('j.record("archive_snapshot", {})');`,
      `  void j;`,
    ]) },
  // ── خامّ gemini 3: تعديلُ الهدفِ بدمجٍ متعدٍّ ──
  { code: 'RC-14', why: "`const target: any = {}; Object.assign(target, { a: 1 }, { run: eval }); target.run(...)` — الدمجُ المتعدي يُحدّثُ منظورَ الهدفِ لا اتحادَ حججِهِ وحدهُ (مسبارُ gemini حرفيًّا)",
    mutate: sink('probeR16AssignTargetMutation', [
      `  const target: any = {};`,
      `  Object.assign(target, { a: 1 }, { run: eval });`,
      `  target.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── وجهُ ضبطٍ: الدمجُ المتعدي على هدفٍ غيرِ معرّفٍ بـany ──
  { code: 'RC-14', why: "`const target = {}; Object.assign(target, { run: eval }); target.run(...)` — وجهُ ضبطٍ: الدمجُ المتعدي يُمسِكُ التنفيذَ استقلالًا عن كنيةِ any في تعريفِ الهدفِ",
    mutate: sink('probeR16AssignControl', [
      `  const target = {};`,
      `  Object.assign(target, { run: eval });`,
      `  target.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── كنيةٌ نوعيّةٌ: `type A = any` تتفادى تهجئةَ AnyKeyword ──
  { code: 'RC-14', why: "`type A = any; const box: { run: A } = { run: eval }` — الكنيةُ النوعيّةُ للمجهولِ تُسألُ محلولًا لا تهجئةً (فتحةُ المراجعِ)",
    mutate: sink('probeR16TypeAliasAny', [
      `  type A = any;`,
      `  const box: { run: A } = { run: eval };`,
      `  box.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── قياسُ الكنيّةِ في العمقِ: `const execute = eval` ورقةً ──
  { code: 'RC-14', why: "`const execute = eval` ورقةً في عمقٍ متداخلٍ — الكنيّةُ الموضعيّةُ تُتْبَعُ في مسحِ الاستنفادِ (قياسُ صلابةٍ طلبهُ المراجعُ)",
    mutate: sink('probeR16DepthAlias', [
      `  const execute = eval;`,
      `  const box = { a: { b: { c: { d: { e: { run: execute } } } } } };`,
      `  box.a.b.c.d.e.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 1: المفتاحُ غيرُ القابلِ للطيِّ ──
  { code: 'RC-14', why: "`const key = 'run'; const box = { run: eval }; box[key](code)` — المفتاحُ الديناميكيُّ يُسألُ من كلِّ أعضاءِ المنظورِ (مسبارُ grok)",
    mutate: sink('probeR16DynamicKey', [
      `  const key = 'run';`,
      `  const box = { run: eval };`,
      `  box[key]('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`const a = 'ru'; const b = 'n'; box[a + b](code)` — المفتاحُ المحسوبُ غيرُ القابلِ للطيِّ يُسألُ من كلِّ الأعضاءِ (مسبارُ grok)",
    mutate: sink('probeR16ComputedKey', [
      `  const a = 'ru';`,
      `  const b = 'n';`,
      `  const box = { run: eval };`,
      `  box[a + b]('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 2: اشتقاقُ المصفوفةِ المعياريُّ ──
  { code: 'RC-14', why: "`[...inner][0]` حيثُ `inner = [eval]` — النشرُ يفتحُ عناصرَ المصدرِ (مسبارُ grok)",
    mutate: sink('probeR16SpreadIndex', [
      `  const inner = [eval];`,
      `  const evil: any = [...inner][0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].slice(0)[0]` — الاشتقاقُ المعياريُّ على منظورٍ يحملُ تنفيذًا لا يُبرهَنُ بريئًا (مسبارُ grok)",
    mutate: sink('probeR16Slice', [
      `  const evil: any = [eval].slice(0)[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[].concat(eval)[0]` — concat يدمجُ حججَهُ (مسبارُ grok)",
    mutate: sink('probeR16Concat', [
      `  const evil: any = [].concat(eval)[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].flat()[0]` — flat يفتحُ التداخلَ (مسبارُ grok)",
    mutate: sink('probeR16Flat', [
      `  const evil: any = [eval].flat()[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].flatMap((x) => [x])[0]` — flatMap وعدّتُهُ (مسبارُ grok)",
    mutate: sink('probeR16FlatMap', [
      `  const evil: any = [eval].flatMap((x) => [x])[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].find((x) => true)` — find قد يعيدُ العنصرَ نفسَهُ (مسبارُ grok)",
    mutate: sink('probeR16Find', [
      `  const evil: any = [eval].find((x) => true);`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`Array.from([eval])[0]` — بابُ من المصفوفةِ (مسبارُ grok)",
    mutate: sink('probeR16ArrayFrom', [
      `  const evil: any = Array.from([eval])[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].at(i)` حيثُ `const i = 0` — at من منظوراتِ المصفوفةِ (مسبارُ grok)",
    mutate: sink('probeR16AtVar', [
      `  const i = 0;`,
      `  const evil: any = [eval].at(i);`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`[eval].map(id)` حيثُ `function id(x) { return x }` — عدوةُ الهويّةِ تعيدُ العنصرَ (مسبارُ grok)",
    mutate: sink('probeR16MapIdentity', [
      `  function id(x: unknown): unknown { return x; }`,
      `  const evil: any = [eval].map(id)[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 3: أبوابُ الاشتقاقِ القيميِّ ──
  { code: 'RC-14', why: "`Object.values(source)[0]` حيثُ `source = { run: eval }` — قيمُ الأعضاءِ تُسألُ (مسبارُ grok)",
    mutate: sink('probeR16ObjectValues', [
      `  const source = { run: eval };`,
      `  const evil: any = Object.values(source)[0];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`Object.entries(source)[0][1]` — أزواجُ entries تحملُ القيمَ (مسبارُ grok)",
    mutate: sink('probeR16ObjectEntries', [
      `  const source = { run: eval };`,
      `  const evil: any = Object.entries(source)[0][1];`,
      `  evil('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`Object.fromEntries([['run', eval]]).run` — fromEntries يعيدُ بناءَ الأعضاءِ (مسبارُ grok)",
    mutate: sink('probeR16FromEntries', [
      `  const evil: any = Object.fromEntries([['run', eval] as [string, unknown]]);`,
      `  evil.run('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`Object.create({ run: eval }).run` — النموذجُ الأوليُّ يُرثُ منهُ (مسبارُ grok)",
    mutate: sink('probeR16ObjectCreate', [
      `  const evil: any = Object.create({ run: eval });`,
      `  evil.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 3 (كنيّةُ): دمجُ assign بالكنيّةِ والمرجعِ ──
  { code: 'RC-14', why: "`const assign = Object.assign; assign({}, source)` — الكنيّةُ لا تُفتحُ البابَ (مسبارُ grok)",
    mutate: sink('probeR16AssignAlias', [
      `  const assign = Object.assign;`,
      `  const source = { run: eval };`,
      `  const target: any = {};`,
      `  assign(target, source);`,
      `  target.run('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`const O = Object; O.assign(target, source)` — المرجعُ المارُّ لا يُفتحُ البابَ (مسبارُ grok)",
    mutate: sink('probeR16AssignRef', [
      `  const O = Object;`,
      `  const source = { run: eval };`,
      `  const target: any = {};`,
      `  O.assign(target, source);`,
      `  target.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 4 / gemini 1 · 2: الأصنافُ ──
  { code: 'RC-14', why: "`new (class { run() { return eval } })().run(...)` — المنشئُ المجهولُ والمنهجُ (مسبارُ grok)",
    mutate: sink('probeR16AnonymousClass', [
      `  new (class { run(){ return eval; } })().run('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`class Box { static run(): any { return eval } } Box.run(...)` — المنهجُ الساكنُ (مسبارُ gemini)",
    mutate: sink('probeR16StaticMethod', [
      `  class Box { static run(): any { return eval; } }`,
      `  Box.run()('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`class Base { run() { return eval } } class Derived extends Base {}` — التوريثُ (مسبارُ gemini)",
    mutate: sink('probeR16Inheritance', [
      `  class Base { run(): any { return eval; } }`,
      `  class Derived extends Base {}`,
      `  new Derived().run()('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`class B { go() { return this.run() } run() { return eval } }` — `this.run` يُرى من الصنفِ الحاوي (مسبارُ grok · gemini)",
    mutate: sink('probeR16ThisRunClass', [
      `  class B { go(){ return this.run(); } run(){ return eval; } }`,
      `  new B().go()('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`const obj = { go() { return this.run() }, run: eval }` — `this` في الكائنِ الحرفيِّ يُرى من حاويهِ (مسبارُ grok)",
    mutate: sink('probeR16ThisRunLiteral', [
      `  const obj = { go(){ return this.run(); }, run: eval };`,
      `  obj.go()('${WRITE}');`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`class P { #run() { return eval } go() { return this.#run() } }` — الخاصّيّةُ الخاصّةُ (مسبارُ grok)",
    mutate: sink('probeR16PrivateMethod', [
      `  class P { #run(){ return eval; } go(){ return this.#run(); } }`,
      `  new P().go()('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 5: عمقُ المسحِ ──
  { code: 'RC-14', why: "`box.a.b.c.d.run(...)` على عمقٍ خامسٍ — حين يفنى المسحُ يُعلَنُ المجهولُ (مسبارُ grok)",
    mutate: sink('probeR16DepthFive', [
      `  const box = { a: { b: { c: { d: { run: eval } } } } };`,
      `  box.a.b.c.d.run('${WRITE}');`,
      `  void j;`,
    ]) },
  // ── خامّ grok 6: الاستيرادُ الديناميكيُّ ──
  { code: 'RC-14', why: "`const mod = await import('./c11_mod')` حيثُ الوحدةُ تصدّرُ `run = eval` — الاستيرادُ الديناميكيُّ يفتحُ تصديراتِ وحدتِهِ (مسبارُ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/data/c11_mod.ts'), 'export const run: any = eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        'export async function probeR16DynamicImport(j: DurableSink): Promise<void> {',
        "  const mod = await import('./c11_mod');",
        `  mod.run('${WRITE}');`,
        '  void j;',
        '}',
        '',
      ].join('\n'));
    } },
  // ── خامّ grok 7: موضعُ النداءِ ──
  { code: 'RC-14', why: "`function f(box: any) { box.run(code) } f({ run: eval })` — معاملٌ مجهولُ النوعِ يُرى من حجّةِ ندائهِ (مسبارُ grok)",
    mutate: sink('probeR16ParamAnyObject', [
      `  function f(box: any) { box.run('${WRITE}'); }`,
      `  f({ run: eval });`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`function f(box: { run: any })` — معاملٌ كائنيُّ الشكلِ يُرى من حجّتِهِ (مسبارُ grok)",
    mutate: sink('probeR16ParamTypedObject', [
      `  function f(box: { run: any }) { box.run('${WRITE}'); }`,
      `  f({ run: eval });`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`function f({ run }: { run: any }) { run(code) } f({ run: eval })` — عنصرُ تفكيكِ معاملٍ يُربَطُ بعضوِ الحجّةِ الحرفيّةِ (مسبارُ grok)",
    mutate: sink('probeR16ParamDestructure', [
      `  function f({ run }: { run: any }) { run('${WRITE}'); }`,
      `  f({ run: eval });`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`function f(...args: any[]) { args[0](code) } f(eval)` — وسيطُ الراحةِ يُربَطُ ببقيّةِ الحججِ (مسبارُ grok)",
    mutate: sink('probeR16ParamRest', [
      `  function f(...args: any[]) { args[0]('${WRITE}'); }`,
      `  f(eval);`,
      `  void j;`,
    ]) },
  // ── خامّ grok 8: المعاملُ الذي لا يُرى موضعُ نداءٍ ──
  { code: 'RC-14', why: "`function unseenBox(box: any) { box.run(code) }` بلا نداءٍ — جذرُ المعاملِ مجهولُ النوعِ يُعلَنُ معتمًا (مسبارُ grok — نقشٌ لا حدٌّ معلَنٌ في العريضةِ)",
    mutate: sink('probeR16UnseenBox', [
      `  function unseenBox(box: any) { box.run('${WRITE}'); }`,
      `  void unseenBox;`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`function unseen(box: { run: any })` بلا نداءٍ — معتمٌ حتى يُرى البرهانُ (مسبارُ grok)",
    mutate: sink('probeR16UnseenTyped', [
      `  function unseen(box: { run: any }) { box.run('${WRITE}'); }`,
      `  void unseen;`,
      `  void j;`,
    ]) },
  { code: 'RC-14', why: "`function unseen({ run }: { run: any }) { run(code) }` بلا نداءٍ — عنصرُ تفكيكِ معاملٍ بلا موضعِ نداءٍ ونوعُهُ مجهولٌ (مسبارُ grok)",
    mutate: sink('probeR16UnseenDestructure', [
      `  function unseen({ run }: { run: any }) { run('${WRITE}'); }`,
      `  void unseen;`,
      `  void j;`,
    ]) },
];

/** وجوهُ الرفضِ الكاذبِ — القراءةُ البريئةُ على رمزِ تنفيذٍ (جلسةُ grok) */
const LIVE: readonly Face[] = [
  { code: 'EXIT-0', why: "`const name = eval.name` — قراءةُ اسمِ الرمزِ بياناتٌ لا تنفيذٌ (مسبارُ grok)",
    mutate: sink('probeR16EvalName', [
      `  const name: unknown = eval.name;`,
      `  void name;`,
      `  void j;`,
    ]) },
  { code: 'EXIT-0', why: "`Function.length` — طولُ الدالّةِ بياناتٌ (مسبارُ grok)",
    mutate: sink('probeR16FunctionLength', [
      `  const len: unknown = Function.length;`,
      `  void len;`,
      `  void j;`,
    ]) },
  { code: 'EXIT-0', why: "`Function.prototype` — النموذجُ الأوليُّ خاملٌ بياناتٌ (مسبارُ grok)",
    mutate: sink('probeR16FunctionPrototype', [
      `  const proto: unknown = Function.prototype;`,
      `  void proto;`,
      `  void j;`,
    ]) },
  { code: 'EXIT-0', why: "LIVE1 من مسباراتِ gemini: تفكيكٌ آمنٌ وmap وat — براءةٌ لا تُرفَض (مسبارُ gemini حرفيًّا)",
    mutate: sink('probeR16Live1', [
      `  const box = { mode: 'fast', count: 42 };`,
      `  const { mode, count } = box;`,
      `  const arr = ['a', 'b', 'c'];`,
      `  const mapped = arr.map((x) => x.toUpperCase());`,
      `  const item = arr.at(0);`,
      `  if (mode === 'fast' && count > 0 && mapped.length > 0 && item) {`,
      `    j.record('command_enqueued', { id: 'test' });`,
      `  }`,
      `  void j;`,
    ]) },
  { code: 'EXIT-0', why: "LIVE2 من مسباراتِ gemini: صنفٌ آمنٌ ومنهجٌ — براءةٌ لا تُرفَض (مسبارُ gemini حرفيًّا)",
    mutate: sink('probeR16Live2', [
      `  class Counter { count = 10; getCount() { return this.count; } }`,
      `  const c = new Counter();`,
      `  if (c.getCount() === 10) {`,
      `    j.record('command_enqueued', { id: 'test2' });`,
      `  }`,
      `  void j;`,
    ]) },
];

/**
 * كلُّ وجهٍ اختبارٌ فرعيٌّ على حدةٍ — فلا يوقفُ فشلُ وجهٍ قياسَ سائرِ الوجوهِ (قياسٌ
 * قبلُ/بعدُ لكلِّ وجهٍ على حدَتِهِ في تقريرِ المعالجةِ السادسةَ عشرةَ).
 */
test('الحاجزُ الساكن: عيوبُ الجولةِ الحاديةَ عشرةَ تُسقِطُه برمزِها — جنسُ القنواتِ المُغلَقِ واحِدٌ: حين يفنى المسحُ يُعلَنُ المجهولُ ولا يُخضَّرُ', async (t) => {
  for (const m of NEGATIVE) {
    await t.test(`${m.code} — ${m.why}`, () => {
      const g = gateRoot();
      try {
        m.mutate(g.root);
        const r = g.run();
        assert.equal(r.code, 1, `التطفيرُ نجا — ${m.why}\n${r.out}`);
        assert.match(r.out, new RegExp(`\\[${m.code}\\]`), `سقط بغير رمزه — ${m.why}\n${r.out}`);
      } finally {
        g.clean();
      }
    });
  }
});

test('الحاجزُ الساكن: وجوهُ الرفضِ الكاذبِ لا تُرفَض — قراءةُ خاصّيّةٍ على رمزِ تنفيذٍ تُسألُ من نوعِها', async (t) => {
  for (const f of LIVE) {
    await t.test(`${f.code} — ${f.why}`, () => {
      const g = gateRoot();
      try {
        f.mutate(g.root);
        const r = g.run();
        assert.equal(r.code, 0, `حاجزٌ رفض وجهًا حيًّا: ${f.why}\n${r.out}`);
      } finally {
        g.clean();
      }
    });
  }
});
