/**
 * تطفيراتُ الجولةِ الرابعةَ عشرةَ — W-2026-040 (المعالجةُ الخامسةَ عشرةَ · عيوبُ مجلسِ
 * المراجعةِ العاشرةِ الستَّ عشرةَ · محضرُ `docs/work/council/W-2026-040-10.json`).
 *
 * حكمَ المجلسُ بالإجماعِ أنّ جنسَ العيوبِ واحدٌ: قيمةُ تنفيذٍ تصلُ إلى نداءٍ ينفّذُ نصًّا
 * والحاجزُ يبقى أخضرَ — والجولةُ العاشرةُ سمّتِ الحرفَ الذي أُغلقَ لا الجنسَ. فكلُّ وجهٍ
 * هنا يقيسُ واحدةً من قنواتِ الجولةِ العاشرةِ بحروفِ مسبارِ الأعضاءِ الثلاثةِ:
 *
 *   - `RC14_BINDING_ALIAS_DESTRUCTURE_ESCAPE_GREENS` (خامّ gpt): التفكيكُ من معرّفٍ يحيلُ
 *     إلى كائنٍ حرفيٍّ — العضوُ يُسألُ من مصدرِهِ المُجسَّدِ لا من المُهيِّئِ كاملًا.
 *   - `RC14_CROSS_FILE_PARAM_FLOW_ORDER_ESCAPE_GREENS` (خامّ gpt): معاملٌ معلَنُ النوعِ عبرَ
 *     وحدةٍ TypeScript أُخرى — العرّافُ يُبنى لكلِّ الملفاتِ قبلَ أوّلِ حكمٍ.
 *   - `RC14_ARRAY_VARIABLE_INDEX_LOSES_ELEMENT` (خامّ grok): فهرسُ المصفوفةِ المحمولةِ في
 *     متغيّرٍ واشتقاقُ `at`/`map` — العنصرُ يُدرَكُ من منظوراتِ المصفوفةِ.
 *   - `RC14_DESTRUCTURE_AND_FOROF_FROM_BINDING_LOSE_MEMBER` (خامّ grok): عنصرُ for-of من
 *     متغيّرٍ يحملُ مصفوفةً — أصلُهُ عناصرُ منظوراتِها.
 *   - `RC14_COMPUTED_AND_NESTED_LITERAL_EXTRACTION` (خامّ grok): المفتاحُ المحسوبُ يُطوى
 *     والوصولُ المتداخلُ ينزلُ عضوًا عضوًا.
 *   - `RC14_METHOD_AND_CLASS_RETURN_UNSEEN` (خامّ grok): المنهجُ في الكائنِ والصنفِ —
 *     قيمتُهُ إرجاعُهُ المرئيُّ.
 *   - `RC14_NAMESPACE_ALIAS_AND_DESTRUCTURE_ESCAPE` (خامّ grok): كنيةُ وحدةِ النطاقِ
 *     (`const box = ns`) وتفكيكُها — العضوُ يُحَلُّ إلى تصديرِ وحدتِهِ.
 *   - `RC14_IMPORT_FUNCTION_AND_DEFAULT_UNSEEN` (خامّ grok): الدالّةُ المصدَّرةُ (إرجاعُها
 *     المرئيُّ) والتصديرُ الافتراضيُّ (تعبيرُهُ) عبرَ الاستيرادِ.
 *   - `DECLARED_INTERPROC_APPLY_BIND_SPREAD_STILL_A_DOOR` (خامّ grok): الترامبولينُ على
 *     دالّةِ البرنامجِ (`go.apply`/`go.bind`) والنشرُ من مصفوفةٍ حرفيّةٍ.
 *   - `RC14_ASSIGNMENT_EXPRESSION_AND_YIELD_LOSE_ORIGIN` (خامّ grok): قيمةُ تعبيرِ الإسنادِ
 *     طرفُهُ الأيمنُ وقناةُ `yield` في قيمةِ الدالّةِ المولِّدةِ.
 *   - `RC14_NESTED_OBJECT_DESTRUCTURING_BLINDS_GATE` · `RC14_NESTED_ARRAY_DESTRUCTURING_BLINDS_GATE` ·
 *     `RC14_DESTRUCTURING_DEFAULT_VALUE_BLINDS_GATE` · `RC14_DESTRUCTURE_FROM_OBJECT_ASSIGN_BLINDS_GATE` ·
 *     `RC14_CLASS_PROPERTY_INITIALIZER_ESCAPE` · `RC14_NESTED_FUNCTION_CONSTRUCTOR_ESCAPE`
 *     (خامّ gemini): التفكيكُ المتداخلُ (كائنًا ومصفوفةً) والقيمةُ الافتراضيةُ والدمجُ
 *     وخصيصةُ الصنفِ و`Function` المتداخلةُ — كلُّها من جذرِ الإعلانِ بمسارِ المفاتيحِ.
 *
 * **حدٌّ معلَنٌ باقٍ (لا يُقاسُ هنا):** المعاملُ الذي لا يُرى موضعُ نداءٍ لدالتِهِ (وعنصرُ
 * تفكيكٍ من معاملِ دالّةٍ) يبقى على حدِّهِ المعلَنِ (دَينُ RC-07) — لا يُخضَرُ كذبًا.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-15.md) وقياساتِهِ الخامّة.
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
  // ── RC14_BINDING_ALIAS_DESTRUCTURE_ESCAPE_GREENS — خامّ gpt ──
  { code: 'RC-14', why: "`const box = { run: eval }; const { run }: { run: any } = box` — التفكيكُ من معرّفٍ يحيلُ إلى حرفيٍّ يصلُ إلى العضوِ من مصدرِهِ (مسبارُ gpt)",
    mutate: sink('probeR15DestructureAlias', [`  const box = { run: eval };`, `  const { run }: { run: any } = box;`, `  run('${WRITE}');`, `  void j;`]) },
  // ── RC14_CROSS_FILE_PARAM_FLOW_ORDER_ESCAPE_GREENS — خامّ gpt ──
  { code: 'RC-14', why: "معاملٌ معلَنُ النوعِ عبرَ وحدةٍ أخرى (`council10Invoke(eval, '…')`) — العرّافُ يُبنى لكلِّ الملفاتِ قبلَ أوّلِ حكمٍ (مسبارُ gpt)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/council10_cross_r15.ts'), 'export function council10Invoke(run: (code: string) => unknown, code: string): void {\n  run(code);\n}\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import { council10Invoke } from '../council10_cross_r15';",
        'export function probeR15CrossFileParam(j: DurableSink): void {',
        `  council10Invoke(eval, '${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── RC14_ARRAY_VARIABLE_INDEX_LOSES_ELEMENT — خامّ grok (1 · 2 · 3) ──
  { code: 'RC-14', why: "`const arr = [eval]; const evil: any = arr[0]` — فهرسُ المصفوفةِ المحمولةِ في متغيّرٍ يصلُ إلى العنصرِ (مسبارُ grok)",
    mutate: sink('probeR15ArrayVariableIndex', [`  const arr = [eval];`, `  const evil: any = arr[0];`, `  evil('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`[eval].at(0)` — اشتقاقُ at من منظوراتِ المصفوفةِ (مسبارُ grok)",
    mutate: sink('probeR15At', [`  const evil: any = [eval].at(0);`, `  evil('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`[eval].map((x: any) => x)[0]` — قيمةُ map اتحادُ عناصرِ المصدرِ وإرجاعِ المحوِّلِ (مسبارُ grok)",
    mutate: sink('probeR15Map', [`  const evil: any = [eval].map((x: any) => x)[0];`, `  evil('${WRITE}');`, `  void j;`]) },
  // ── RC14_DESTRUCTURE_AND_FOROF_FROM_BINDING_LOSE_MEMBER — خامّ grok ──
  { code: 'RC-14', why: "`const arr = [eval] as any[]; for (const run of arr) run('…')` — عنصرُ for-of على متغيّرٍ يحملُ مصفوفةً (مسبارُ grok)",
    mutate: sink('probeR15ForOfVariable', [`  const arr = [eval] as any[];`, `  for (const run of arr) { run('${WRITE}'); }`, `  void j;`]) },
  // ── RC14_COMPUTED_AND_NESTED_LITERAL_EXTRACTION — خامّ grok (1 · 2) ──
  { code: 'RC-14', why: "`({ [\"run\"]: eval }).run` — المفتاحُ المحسوبُ الحرفيُّ يُطوى (مسبارُ grok)",
    mutate: sink('probeR15ComputedKey', [`  const evil: any = ({ [\"run\"]: eval }).run;`, `  evil('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`({ box: { run: eval } }).box.run` — الوصولُ المتداخلُ ينزلُ عضوًا عضوًا (مسبارُ grok)",
    mutate: sink('probeR15NestedLiteral', [`  const evil: any = ({ box: { run: eval } }).box.run;`, `  evil('${WRITE}');`, `  void j;`]) },
  // ── RC14_METHOD_AND_CLASS_RETURN_UNSEEN — خامّ grok (1 · 2) ──
  { code: 'RC-14', why: "`const o = { run(): any { return eval; } }; o.run()` — قيمةُ المنهجِ إرجاعُهُ المرئيُّ (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export function probeR15MethodReturn(j: DurableSink): void {',
        '  const o = { run(): any { return eval; } };',
        `  const evil: any = o.run(); evil('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`class BoxR15 { run(): any { return eval; } }; new BoxR15().run()` — منهجُ الصنفِ المُنشأِ (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'class BoxR15 { run(): any { return eval; } }',
        'export function probeR15ClassMethod(j: DurableSink): void {',
        `  const evil: any = new BoxR15().run(); evil('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── RC14_NAMESPACE_ALIAS_AND_DESTRUCTURE_ESCAPE — خامّ grok (1 · 2) ──
  { code: 'RC-14', why: "`const box = ns; box.escaped('…')` — كنيةُ وحدةِ النطاقِ تُحَلُّ إلى تصديرِ وحدتِهِ (مسبارُ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/probe_ns_r15.ts'), 'export const escaped: any = eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import * as nsR15 from '../probe_ns_r15';",
        'export function probeR15NamespaceAlias(j: DurableSink): void {',
        '  const box = nsR15;',
        `  box.escaped('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`const { escaped } = ns; escaped('…')` — تفكيكُ وحدةِ النطاقِ يصلُ إلى التصديرِ (مسبارُ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/probe_ns_r15.ts'), 'export const escaped: any = eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import * as nsR15b from '../probe_ns_r15';",
        'export function probeR15NamespaceDestructure(j: DurableSink): void {',
        '  const { escaped } = nsR15b;',
        `  escaped('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── RC14_IMPORT_FUNCTION_AND_DEFAULT_UNSEEN — خامّ grok (1 · 2) ──
  { code: 'RC-14', why: "`export function get(): any { return eval; }` ثمّ `import { get }` ونداءُهُ — الدالّةُ المصدَّرةُ إرجاعُها المرئيُّ (مسبارُ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/probe_fn_r15.ts'), 'export function get(): any { return eval; }\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import { get as getR15 } from '../probe_fn_r15';",
        'export function probeR15ImportedFunction(j: DurableSink): void {',
        `  getR15()('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`export default eval` ثمّ `import evil from …` — التصديرُ الافتراضيُّ يُتْبَعُ إلى تعبيرِهِ (مسبارُ grok)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/probe_default_r15.ts'), 'export default eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import evilDefaultR15 from '../probe_default_r15';",
        'export function probeR15ImportedDefault(j: DurableSink): void {',
        `  evilDefaultR15('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── DECLARED_INTERPROC_APPLY_BIND_SPREAD_STILL_A_DOOR — خامّ grok (1 · 2 · 3) ──
  { code: 'RC-14', why: "`goR15.apply(null, [eval, '…'])` — الترامبولينُ على دالّةِ البرنامجِ يربطُ معاملاتِها (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goR15 = (f: (code: string) => unknown, code: string): void => { f(code); };',
        'export function probeR15TrampolineApply(j: DurableSink): void {',
        `  goR15.apply(null, [eval, '${WRITE}']);`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`const b = goR15.bind(null, eval); b('…')` — bind على دالّةِ البرنامجِ (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goR15 = (f: (code: string) => unknown, code: string): void => { f(code); };',
        'export function probeR15TrampolineBind(j: DurableSink): void {',
        '  const b = goR15.bind(null, eval);',
        `  b('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`goR15(...[eval, '…'])` — النشرُ من مصفوفةٍ حرفيّةٍ يُفكُّ موضعيًّا (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goR15 = (f: (code: string) => unknown, code: string): void => { f(code); };',
        'export function probeR15SpreadLiteral(j: DurableSink): void {',
        `  goR15(...[eval, '${WRITE}']);`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── RC14_ASSIGNMENT_EXPRESSION_AND_YIELD_LOSE_ORIGIN — خامّ grok (1 · 2) ──
  { code: 'RC-14', why: "`let slot: any = null; const evil: any = (slot = eval)` — قيمةُ تعبيرِ الإسنادِ طرفُهُ الأيمنُ (مسبارُ grok)",
    mutate: sink('probeR15AssignmentExpression', [`  let slot: any = null;`, `  const evil: any = (slot = eval);`, `  evil('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`function* gen(): Generator<any> { yield eval; } gen().next().value('…')` — قناةُ yield في قيمةِ الدالّةِ المولِّدةِ (مسبارُ grok)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'function* genR15(): Generator<any> { yield eval; }',
        'export function probeR15Yield(j: DurableSink): void {',
        `  genR15().next().value('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  // ── عيوبُ gemini الستةُ (الجولةُ العاشرةُ) ──
  { code: 'RC-14', why: "`const { a: { run } }: any = { a: { run: eval } }` — التفكيكُ الكائنيُّ المتداخلُ من جذرِ إعلانِهِ (مسبارُ gemini)",
    mutate: sink('probeR15NestedObjectDestructure', [`  const { a: { run } }: any = { a: { run: eval } };`, `  run('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`const [[run]]: any = [[eval]]` — التفكيكُ المصفوفيُّ المتداخلُ (مسبارُ gemini)",
    mutate: sink('probeR15NestedArrayDestructure', [`  const [[run]]: any = [[eval]];`, `  run('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`const { run = eval }: any = {}` — القيمةُ الافتراضيةُ للتفكيكِ (مسبارُ gemini)",
    mutate: sink('probeR15DefaultDestructure', [`  const { run = eval }: any = {};`, `  run('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`const { run }: any = Object.assign({}, { run: eval })` — التفكيكُ من دمجِ assign (مسبارُ gemini)",
    mutate: sink('probeR15DestructureAssign', [`  const { run }: any = Object.assign({}, { run: eval });`, `  run('${WRITE}');`, `  void j;`]) },
  { code: 'RC-14', why: "`class Runner { run: any = eval; }` ثمّ `new Runner().run('…')` — خصيصةُ الصنفِ مُهيِّئُها يُسألُ (مسبارُ gemini)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'class RunnerR15 { run: any = eval; }',
        'export function probeR15ClassProperty(j: DurableSink): void {',
        '  const r = new RunnerR15();',
        `  r.run('${WRITE}');`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`const { a: { F } }: any = { a: { F: Function } }; F('…')()` — Function المتداخلةُ عبرَ التفكيكِ (مسبارُ gemini)",
    mutate: sink('probeR15NestedFunction', [`  const { a: { F } }: any = { a: { F: Function } };`, `  F('${WRITE}')();`, `  void j;`]) },
];

const LIVE: readonly Face[] = [
  { code: '', why: "`const box = { run: () => void 0 }; const { run } = box; run()` — تفكيكٌ من معرّفٍ يحيلُ إلى حرفيٍّ بريءٍ (جنسُ عيبِ gpt حيًّا)",
    mutate: sink('liveR15DestructureAlias', [`  const box = { run: (): void => void 0 };`, `  const { run } = box;`, `  run();`, `  void j;`]) },
  { code: '', why: "`invokeR15Live((x) => void x, 'y')` — معاملٌ معلَنُ النوعِ عبرَ وحدةٍ أخرى وسيطُهُ بريءٌ (جنسُ عيبِ gpt الثاني حيًّا)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/live_cross_r15.ts'), 'export function invokeR15Live(run: (code: string) => void, code: string): void {\n  run(code);\n}\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import { invokeR15Live } from '../live_cross_r15';",
        'export function liveR15CrossFileParam(j: DurableSink): void {',
        "  invokeR15Live((x) => void x, 'y');",
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`const arr = [() => void 0]; const f: any = arr[0]; f()` — فهرسُ مصفوفةٍ بريئةٍ في متغيّرٍ (جنسُ عيبِ الفهرسِ حيًّا)",
    mutate: sink('liveR15ArrayVariableIndex', [`  const arr = [(): void => void 0];`, `  const f: any = arr[0];`, `  f();`, `  void j;`]) },
  { code: '', why: "`const n = [1, 2].at(0)` — اشتقاقُ at البريءُ (جنسُ عيبِ at حيًّا)",
    mutate: sink('liveR15At', [`  const n = [1, 2].at(0);`, `  void j; void n;`]) },
  { code: '', why: "`['a', 'b'].map((x) => x)[0].trim()` — اشتقاقُ map البريءُ (جنسُ عيبِ map حيًّا)",
    mutate: sink('liveR15Map', [`  const s = ['a', 'b'].map((x) => x)[0];`, `  s.trim();`, `  void j;`]) },
  { code: '', why: "`const arr = ['a', 'b']; for (const s of arr) { s.trim(); }` — عنصرُ for-of على متغيّرٍ بريءٍ (جنسُ عيبِ for-of حيًّا)",
    mutate: sink('liveR15ForOfVariable', [`  const arr = ['a', 'b'];`, `  for (const s of arr) { s.trim(); }`, `  void j;`]) },
  { code: '', why: "`({ [\"run\"]: () => void 0 }).run()` — مفتاحٌ محسوبٌ حرفيٌّ بريءٌ (جنسُ عيبِ المفتاحِ حيًّا)",
    mutate: sink('liveR15ComputedKey', [`  const evil: any = ({ [\"run\"]: (): void => void 0 }).run;`, `  evil();`, `  void j;`]) },
  { code: '', why: "`({ box: { run: () => void 0 } }).box.run()` — وصولٌ متداخلٌ بريءٌ (جنسُ عيبِ التداخلِ حيًّا)",
    mutate: sink('liveR15NestedLiteral', [`  const e2: any = ({ box: { run: (): void => void 0 } }).box.run;`, `  e2();`, `  void j;`]) },
  { code: '', why: "`const o = { run(): string { return 'a'; } }; o.run().trim()` — منهجٌ بريءٌ في كائنٍ (جنسُ عيبِ المنهجِ حيًّا)",
    mutate: sink('liveR15MethodReturn', [`  const o = { run(): string { return 'a'; } };`, `  o.run().trim();`, `  void j;`]) },
  { code: '', why: "`class BoxLive { run(): string { return 'a'; } } new BoxLive().run().trim()` — منهجُ صنفٍ مُنشأٍ بريءٌ (جنسُ عيبِ الصنفِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'class BoxLiveR15 { run(): string { return \'a\'; } }',
        'export function liveR15ClassMethod(j: DurableSink): void {',
        `  new BoxLiveR15().run().trim();`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`class RunnerLive { run = () => void 0; } new RunnerLive().run()` — خصيصةُ صنفٍ بريئةٌ (جنسُ عيبِ gemini الخامسِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'class RunnerLiveR15 { run = (): void => void 0; }',
        'export function liveR15ClassProperty(j: DurableSink): void {',
        `  new RunnerLiveR15().run();`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`import * as nsLive from 'node:path'; const box = nsLive; box.join('a', 'b')` — كنيةُ نطاقٍ من مكتبةٍ بريئةٍ (جنسُ عيبِ الكنيةِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        "import * as nsLiveR15 from 'node:path';",
        'export function liveR15NamespaceAlias(j: DurableSink): void {',
        '  const box = nsLiveR15;',
        "  const joined: string = box.join('a', 'b');",
        '  void j; void joined;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`const { join } = nsLive; join('a', 'b')` — تفكيكُ وحدةِ نطاقٍ بريئةٍ (جنسُ عيبِ التفكيكِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        "import * as nsLiveR15b from 'node:path';",
        'export function liveR15NamespaceDestructure(j: DurableSink): void {',
        '  const { join } = nsLiveR15b;',
        "  const joined: string = join('a', 'b');",
        '  void j; void joined;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`import { liveGet }` ثمّ `liveGet().trim()` — دالّةٌ مصدَّرةٌ تُرجعُ بياناتٍ (جنسُ عيبِ gpt حيًّا)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/live_fn_r15.ts'), "export function liveGet(): string { return 'a'; }\n", 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import { liveGet } from '../live_fn_r15';",
        'export function liveR15ImportedFunction(j: DurableSink): void {',
        '  liveGet().trim();',
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`export default () => void 0` ثمّ `import f from …; f()` — تصديرٌ افتراضيٌّ بريءٌ (جنسُ عيبِ الافتراضيِّ حيًّا)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/live_default_r15.ts'), 'export default (): void => { void 0; };\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import benignDefaultR15 from '../live_default_r15';",
        'export function liveR15ImportedDefault(j: DurableSink): void {',
        '  benignDefaultR15();',
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`goLive15.apply(null, [(x) => void x, 'y'])` — ترامبولينُ apply على دالّةِ البرنامجِ بوسيطٍ بريءٍ (جنسُ عيبِ apply حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goLive15R15 = (f: (c: string) => void, c: string): void => { f(c); };',
        'export function liveR15TrampolineApply(j: DurableSink): void {',
        "  goLive15R15.apply(null, [(x) => void x, 'y']);",
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`goLive15.bind(null, (x) => void x)('z')` — ترامبولينُ bind بوسيطٍ بريءٍ (جنسُ عيبِ bind حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goLive15R15 = (f: (c: string) => void, c: string): void => { f(c); };',
        'export function liveR15TrampolineBind(j: DurableSink): void {',
        "  goLive15R15.bind(null, (x) => void x)('z');",
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`goLive15(...[(x) => void x, 'w'])` — نشرٌ من مصفوفةٍ حرفيّةٍ بريئةٍ (جنسُ عيبِ النشرِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goLive15R15 = (f: (c: string) => void, c: string): void => { f(c); };',
        'export function liveR15SpreadLiteral(j: DurableSink): void {',
        "  goLive15R15(...[(x) => void x, 'w']);",
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`let slot: any = null; const v: any = (slot = 'a')` — قيمةُ تعبيرِ إسنادٍ بريئةٍ (جنسُ عيبِ الإسنادِ حيًّا)",
    mutate: sink('liveR15AssignmentExpression', [`  let slot: any = null;`, `  const v: any = (slot = 'a');`, `  void j; void v;`]) },
  { code: '', why: "`function* genLive(): Generator<string> { yield 'a'; } genLive().next().value.trim()` — مولِّدٌ يُسلِّمُ بياناتٍ (جنسُ عيبِ yield حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'function* genLiveR15(): Generator<string> { yield \'a\'; }',
        'export function liveR15Yield(j: DurableSink): void {',
        `  genLiveR15().next().value.trim();`,
        '  void j;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`const { a: { run } }: any = { a: { run: () => void 0 } }; run()` — تفكيكٌ كائنيٌّ متداخلٌ بريءٌ (جنسُ عيبِ gemini الأولِ حيًّا)",
    mutate: sink('liveR15NestedObjectDestructure', [`  const { a: { run } }: any = { a: { run: (): void => void 0 } };`, `  run();`, `  void j;`]) },
  { code: '', why: "`const [[s]]: any = [['a']]; s.trim()` — تفكيكٌ مصفوفيٌّ متداخلٌ بريءٌ (جنسُ عيبِ gemini الثاني حيًّا)",
    mutate: sink('liveR15NestedArrayDestructure', [`  const [[s]]: any = [['a']];`, `  s.trim();`, `  void j;`]) },
  { code: '', why: "`const { run = () => void 0 }: any = {}; run()` — قيمةٌ افتراضيةٌ بريئةٌ (جنسُ عيبِ gemini الثالثِ حيًّا)",
    mutate: sink('liveR15DefaultDestructure', [`  const { run = (): void => void 0 }: any = {};`, `  run();`, `  void j;`]) },
  { code: '', why: "`const { run: r2 }: any = Object.assign({}, { run: () => void 0 }); r2()` — تفكيكٌ من دمجٍ بريءٍ (جنسُ عيبِ gemini الرابعِ حيًّا)",
    mutate: sink('liveR15DestructureAssign', [`  const { run: r2 }: any = Object.assign({}, { run: (): void => void 0 });`, `  r2();`, `  void j;`]) },
  { code: '', why: "`const { a: { F } }: any = { a: { F: Date } }; new F()` — صنفٌ بريءٌ عبرَ تفكيكٍ متداخلٍ (جنسُ عيبِ gemini السادسِ حيًّا)",
    mutate: sink('liveR15NestedFunction', [`  const { a: { F } }: any = { a: { F: Date } };`, `  const d = new F();`, `  void j; void d;`]) },
  { code: '', why: "`const d = new Date(); const x = d.constructor; void x` — منشئُ قيمةٍ معروفةِ النوعِ بريءٌ (وجهٌ حيٌّ من جولاتِ سابقةٍ)",
    mutate: sink('liveR15DateConstructor', [`  const d = new Date();`, `  const x = d.constructor;`, `  void j; void d; void x;`]) },
];

test('الحاجزُ الساكن: عيوبُ الجولةِ العاشرةِ الستَّ عشرةَ تُسقِطُه برمزِها — الاستدلالُ لأصلِ القيمةِ عبرَ منظوراتِ المادةِ', () => {
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

test('الحاجزُ الساكن: وجوهُ الجولةِ العاشرةِ الحيّةُ لا تُرفَض — القنواتُ نفسُها بريئةَ الأصلِ تُخضَرّ', () => {
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
