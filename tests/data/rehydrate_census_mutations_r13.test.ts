/**
 * تطفيراتُ الجولةِ الثالثةَ عشرةَ — W-2026-040 (المعالجةُ الرابعةَ عشرةَ · عيوبُ مجلسِ
 * المراجعةِ التاسعةِ الستةِ · محضرُ `docs/work/council/W-2026-040-9.json`).
 *
 * حكمَ المجلسُ أنّ جنسَ العيوبِ واحدٌ: قيمةُ تنفيذٍ تصلُ إلى نداءٍ ينفّذُ نصًّا والحاجزُ
 * يبقى أخضرَ — فالحرفُ المغلقُ في الجولةِ الثامنةِ («المُهيِّئُ eval نفسُهُ») انفرجَ في التاسعةِ
 * إلى ستّ قنواتٍ لا يمسكُها جريانُ الأصلِ. وكلُّ وجهٍ هنا يقيسُ واحدًا منها بحروفِ مسبارِهِ:
 *
 *   - `RC14_NAMESPACE_IMPORT_MEMBER_ESCAPE_GREENS` (خامّ gpt · RC14-NS-1): عضوُ استيرادِ النطاقِ
 *     `import * as ns` ثمّ `ns.escaped('…')` — العضوُ يُحَلُّ إلى تصديرِ وحدتِهِ فيُتْبَعُ أصلُهُ.
 *   - `RC14_INLINE_LITERAL_EXTRACTION_GREENS` (خامّ grok §5.1): استخراجُ العضوِ من حرفيٍّ في
 *     التعبيرِ نفسِهِ — `({ run: eval }).run` · `[eval][0]` · `({ F: Function }).F` — والمفتاحُ
 *     الرقميُّ يُطوى كالنصِّ.
 *   - `RC14_NEW_OF_FUNCTION_ALIAS_GREENS` (خامّ grok §5.2): `const C: any = Function; new C(…)` —
 *     المُنشئُ يسألُ العرّافَ عن أصلِ المستدعى والبابُ (و) يفحصُ `new` كما يفحصُ النداءَ.
 *   - `RC14_BINDING_CHANNELS_LOSE_MEMBER_ORIGIN` (خامّ grok §5.3): قنواتُ الربطِ تصلُ إلى العضوِ
 *     لا إلى المُهيِّئِ كاملًا — التفكيكُ (كائنٌ ومصفوفةٌ) · عنصرُ for-of · الجالبُ · النشرُ ·
 *     Object.assign · catch · إرجاعُ الدالّةِ.
 *   - `RC14_IMPORT_ALIAS_VALUEDECLARATION_MISSED` (خامّ grok §5.4): `import { evil as x }` بلا
 *     valueDeclaration — يُتْبَعُ من declarations إلى الرمزِ المكنّى ومُهيّئِهِ في وحدتِهِ.
 *   - `DECLARED_INTERPROC_PARAM_APPLY_BIND_STILL_A_DOOR` (خامّ grok §5.5): المعاملُ المعلَنُ
 *     النوعِ يُسألُ عن أصلِهِ — مواضعُ نداءِ دالتِهِ تربطُهُ بوسيطِهِ الفعليّ (نداءٌ مباشرٌ ·
 *     apply · bind).
 *
 * **حدٌّ معلَنٌ باقٍ (لا يُقاسُ هنا):** المعاملُ الذي لا يُرى موضعُ نداءٍ لدالتِهِ في البرنامجِ
 * يبقى على حدِّهِ المعلَنِ (دَينُ RC-07) — لا يُخضَرُ كذبًا: `any`/`unknown` معتمٌ كما كان.
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-14.md) وقياساتِهِ الخامّة.
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
  // ── RC14_NAMESPACE_IMPORT_MEMBER_ESCAPE_GREENS — خامّ gpt (مسبار probe-namespace) ──
  { code: 'RC-14', why: "`import * as ns` ثمّ `ns.escaped('…')` — عضوُ النطاقِ يُحَلُّ إلى تصديرِ وحدتِهِ فيُتْبَعُ أصلُهُ إلى eval (مسبارُ gpt)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/data/council9_ns_probe_r14.ts'), 'export const escaped: any = eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import * as council9NamespaceR14 from './council9_ns_probe_r14';",
        'export function probeR14NamespaceMember(j: DurableSink): void {',
        `  council9NamespaceR14.escaped('${WRITE}');`,
        '}', '',
      ].join('\n'));
    } },
  // ── RC14_INLINE_LITERAL_EXTRACTION_GREENS — خامّ grok §5.1 (1 · 2 · 3) ──
  { code: 'RC-14', why: "`({ run: eval }).run` — استخراجُ العضوِ من كائنٍ حرفيٍّ في التعبيرِ نفسِهِ (مسبارُ grok 1)",
    mutate: sink('probeR14InlineLiteralMember', [`  const evil: any = ({ run: eval }).run; evil('${WRITE}');`]) },
  { code: 'RC-14', why: "`[eval][0]` — فهرسةُ مصفوفةٍ حرفيّةٍ بمفتاحٍ رقميٍّ مطويٍّ (مسبارُ grok 2)",
    mutate: sink('probeR14ArrayIndex', [`  const evil: any = [eval][0]; evil('${WRITE}');`]) },
  { code: 'RC-14', why: "`({ F: Function }).F` — عضوُ الدالّةِ العالميّةِ في كائنٍ حرفيٍّ بالتعبيرِ (مسبارُ grok 3)",
    mutate: sink('probeR14LiteralFunctionMember', [`  const F: any = ({ F: Function }).F; F('${WRITE}')();`]) },
  // ── RC14_NEW_OF_FUNCTION_ALIAS_GREENS — خامّ grok §5.2 ──
  { code: 'RC-14', why: "`const C: any = Function; new C('…')` — المُنشئُ يسألُ العرّافَ عن أصلِ المستدعى (مسبارُ grok 4)",
    mutate: sink('probeR14NewOfFunctionAlias', [`  const C: any = Function;`, `  const fn = new C('${WRITE}'); fn();`]) },
  // ── RC14_BINDING_CHANNELS_LOSE_MEMBER_ORIGIN — خامّ grok §5.3 (1 · 2 · 4 · 5 · 6 · 7) ──
  { code: 'RC-14', why: "`const { run }: { run: any } = { run: eval }` — التفكيكُ يصلُ إلى العضوِ لا إلى المُهيِّئِ كاملًا (مسبارُ grok 1)",
    mutate: sink('probeR14Destructure', [`  const { run }: { run: any } = { run: eval }; run('${WRITE}');`]) },
  { code: 'RC-14', why: "`const [run]: [any] = [eval]` — تفكيكُ المصفوفةِ إلى عنصرِها (مسبارُ grok 2)",
    mutate: sink('probeR14ArrayDestructure', [`  const [run]: [any] = [eval]; run('${WRITE}');`]) },
  { code: 'RC-14', why: "`for (const run of ([eval] as any[]))` — عنصرُ for-of على مصفوفةٍ حرفيّةٍ (مسبارُ grok 4)",
    mutate: sink('probeR14ForOf', [`  for (const run of ([eval] as any[])) { run('${WRITE}'); }`]) },
  { code: 'RC-14', why: "`const o = { get run(): any { return eval; } }; o.run('…')` — الجالبُ قيمتُهُ إرجاعُهُ (مسبارُ grok 5)",
    mutate: sink('probeR14Getter', [`  const o = { get run(): any { return eval; } }; o.run('${WRITE}');`]) },
  { code: 'RC-14', why: "`const o: any = { ...{ run: eval } }; o.run('…')` — النشرُ يصلُ إلى العضوِ المنشورِ (مسبارُ grok 6)",
    mutate: sink('probeR14Spread', [`  const o: any = { ...{ run: eval } }; o.run('${WRITE}');`]) },
  { code: 'RC-14', why: "`const o: any = Object.assign({}, { run: eval }); o.run('…')` — دمجُ assign يُقرأُ من وسيطاتِهِ الحرفيّةِ (مسبارُ grok 7)",
    mutate: sink('probeR14ObjectAssign', [`  const o: any = Object.assign({}, { run: eval }); o.run('${WRITE}');`]) },
  { code: 'RC-14', why: "`try { throw eval; } catch (e) { const run: any = e; run('…') }` — قناةُ catch تُربَطُ بتعبيراتِ throw (مسبارُ grok 8)",
    mutate: sink('probeR14Catch', [`  try { throw eval; } catch (e) { const run: any = e; run('${WRITE}'); }`]) },
  { code: 'RC-14', why: "`function box(): any { return eval; } box()('…')` — إرجاعُ الدالّةِ المرئيةِ قيمةُ ندائِها (مسبارُ grok 9)",
    mutate: sink('probeR14FunctionReturn', [`  function box(): any { return eval; } box()('${WRITE}');`]) },
  // ── RC14_IMPORT_ALIAS_VALUEDECLARATION_MISSED — خامّ grok §5.4 ──
  { code: 'RC-14', why: "`import { evil as probeEvil }` — الاستيرادُ المستعيرُ بلا valueDeclaration يُتْبَعُ إلى مُهيّئِهِ (مسبارُ grok 10)",
    mutate: (root) => {
      writeFileSync(join(root, 'src/probe_helper_r14.ts'), 'export const evil: any = eval;\n', 'utf8');
      appendFileSync(join(root, PERSISTENCE), [
        "import { evil as probeEvilR14 } from '../probe_helper_r14';",
        'export function probeR14ImportAlias(j: DurableSink): void {',
        `  probeEvilR14('${WRITE}');`,
        '}', '',
      ].join('\n'));
    } },
  // ── DECLARED_INTERPROC_PARAM_APPLY_BIND_STILL_A_DOOR — خامّ grok §5.5 (1 · 2 · 3) ──
  { code: 'RC-14', why: "`go = (f: (code: string) => unknown, code: string) => { f(code); }; go(eval, '…')` — المعاملُ المعلَنُ النوعِ يُسألُ عن أصلِهِ من موضعِ النداءِ (مسبارُ grok 11)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goR14 = (f: (code: string) => unknown, code: string): void => { f(code); };',
        'export function probeR14InterprocParam(j: DurableSink): void {',
        `  goR14(eval, '${WRITE}');`,
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`viaApply = (f: any, args) => { f.apply(null, args); }; viaApply(eval, ['…'])` — apply على معاملٍ يُتْبَعُ إلى وسيطِهِ الفعليّ (مسبارُ grok 12)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const viaApplyR14 = (f: any, args: unknown[]): void => { f.apply(null, args); };',
        'export function probeR14InterprocApply(j: DurableSink): void {',
        `  viaApplyR14(eval, ['${WRITE}']);`,
        '}', '',
      ].join('\n'));
    } },
  { code: 'RC-14', why: "`viaBind = (f: (c: string) => void) => { const b = f.bind(null); b('…'); }; viaBind(eval)` — bind على معاملٍ معلَنِ النوعِ (مسبارُ grok 13)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const viaBindR14 = (f: (c: string) => void): void => { const b = f.bind(null); b(\'globalThis.j.record("archive_snapshot", {})\'); };',
        'export function probeR14InterprocBind(j: DurableSink): void {',
        `  viaBindR14(eval);`,
        '}', '',
      ].join('\n'));
    } },
];

const LIVE: readonly Face[] = [
  { code: '', why: "`import * as nodePathR14 from 'node:path'; nodePathR14.join('a', 'b')` — عضوُ نطاقٍ من مكتبةٍ: تصديرُها دالّةٌ معرّفةٌ في تعريفاتِها فأصلُها بياناتٌ (جنسُ مسبارِ gpt حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        "import * as nodePathR14 from 'node:path';",
        'export function liveR14NamespaceMember(j: DurableSink): void {',
        "  const joined: string = nodePathR14.join('a', 'b');",
        '  void j; void joined;',
        '}', '',
      ].join('\n'));
    } },
  { code: '', why: "`const { name } = { name: 'x' }` — تفكيكٌ من حرفيٍّ بريءٍ يصلُ إلى العضوِ فيُخضَرّ (جنسُ عيبِ التفكيكِ حيًّا)",
    mutate: sink('liveR14Destructure', [`  const { name } = { name: 'x' }; const t: string = name; void j; void t;`]) },
  { code: '', why: "`for (const s of ['a', 'b']) { s.trim(); }` — عنصرُ for-of على مصفوفةٍ حرفيّةٍ بريئةٍ (جنسُ عيبِ for-of حيًّا)",
    mutate: sink('liveR14ForOf', [`  for (const s of ['a', 'b']) { s.trim(); } void j;`]) },
  { code: '', why: "`const o = { get run(): string { return 'a'; } }; o.run.trim()` — جالبٌ يُرجعُ بياناتٍ (جنسُ عيبِ الجالبِ حيًّا)",
    mutate: sink('liveR14Getter', [`  const o = { get run(): string { return 'a'; } }; o.run.trim(); void j;`]) },
  { code: '', why: "`const o = { ...{ run: () => void 0 } }; o.run()` — نشرٌ بريءٌ يصلُ إلى العضوِ (جنسُ عيبِ النشرِ حيًّا)",
    mutate: sink('liveR14Spread', [`  const o = { ...{ run: (): void => void 0 } }; o.run(); void j;`]) },
  { code: '', why: "`const o = Object.assign({}, { run: () => void 0 }); o.run()` — دمجُ assign بريءٌ (جنسُ عيبِ assign حيًّا)",
    mutate: sink('liveR14ObjectAssign', [`  const o = Object.assign({}, { run: (): void => void 0 }); o.run(); void j;`]) },
  { code: '', why: "`try { throw new Error('x'); } catch (e) { const m: string = (e as Error).message; }` — قناةُ catch على رمزٍ بريءٍ (جنسُ عيبِ catch حيًّا)",
    mutate: sink('liveR14Catch', [`  try { throw new Error('x'); } catch (e) { const m: string = (e as Error).message; void j; void m; }`]) },
  { code: '', why: "`function box(): () => void { return () => void 0; } box()()` — دالّةٌ تُرجعُ دالّةً بريئةً (جنسُ عيبِ الإرجاعِ حيًّا)",
    mutate: sink('liveR14FunctionReturn', [`  function box(): () => void { return (): void => void 0; } box()(); void j;`]) },
  { code: '', why: "`const evil: any = ({ run: () => void 0 }).run; evil()` — استخراجُ عضوٍ بريءٍ من حرفيٍّ بالتعبيرِ (جنسُ عيبِ الاستخراجِ حيًّا)",
    mutate: sink('liveR14InlineLiteral', [`  const evil: any = ({ run: (): void => void 0 }).run; evil(); void j;`]) },
  { code: '', why: "`const C = Date; const d = new C()` — مُنشئٌ من صنفٍ بريءٍ معروفِ النوعِ (جنسُ عيبِ new حيًّا)",
    mutate: sink('liveR14NewBenign', [`  const C = Date; const d = new C(); void j; void d;`]) },
  { code: '', why: "`goR14Live = (f: (code: string) => void, code: string) => { f(code); }; goR14Live((x) => void x, 'y')` — معاملٌ معلَنُ النوعِ وسيطُهُ الفعليُّ دالّةٌ بريئةٌ (جنسُ عيبِ المعاملِ حيًّا)",
    mutate: (root) => {
      appendFileSync(join(root, PERSISTENCE), [
        'export const goR14Live = (f: (code: string) => void, code: string): void => { f(code); };',
        'export function liveR14InterprocParam(j: DurableSink): void {',
        "  goR14Live((x) => void x, 'y'); void j;",
        '}', '',
      ].join('\n'));
    } },
];

test('الحاجزُ الساكن: عيوبُ الجولةِ التاسعةِ تُسقِطُه برمزِها — القنواتُ الستُّ تصلُ إلى العضوِ والمُستدعى', () => {
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

test('الحاجزُ الساكن: وجوهُ الجولةِ التاسعةِ الحيّةُ لا تُرفَض — القنواتُ نفسُها بريئةَ الأصلِ تُخضَرّ', () => {
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
