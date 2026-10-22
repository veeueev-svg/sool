/**
 * تطفيراتُ الجولةِ العاشرة — W-2026-040 (علاجُ عيوبِ مجلسِ المراجعةِ السادسة · محضر
 * `docs/work/council/W-2026-040-6.json` · اكتشافُ الصفِّ `COUNCIL6_W040_SPLIT_REJECTED`).
 *
 * العيوبُ الثمانيةُ المسماةُ — خامُّ gpt وgrok بحروفِهِ — وكلُّ وجهٍ هنا يقيسُ واحدًا منها:
 *   - `RC07_COUNTERFEIT_COMPUTED_CALLEE_GREENS` (gpt §3): نصُّ المفتاحِ ليسَ هويةً —
 *     مستدعًى مزوَّرٌ بمفتاحٍ محسوبٍ حرفيٍّ (أو وصولِ خاصّيّةٍ أو تظليلٍ أقربَ) يُنصَّبُ سيّدًا زورًا.
 *   - `RC14_DYNAMIC_IMPORT_CODE_MODULE_UNSEEN` (grok §5): `import('node:vm')`/`import('node:module')`
 *     الحرفيُّ يكتبُ المُعفى والبوابةُ خضراء.
 *   - `RC14_REFLECT_GET_FUNCTION_UNSEEN` (grok §5): `Reflect.get(globalThis,'Function')`.
 *   - `RC14_DESCRIPTOR_FUNCTION_UNSEEN` (grok §5): `getOwnPropertyDescriptor(globalThis,'Function').value`.
 *   - `RC14_ALIASED_GLOBAL_COMPUTED_FUNCTION_UNSEEN` (grok §5): فهرسٌ محسوبٌ على اسمٍ مستعارٍ للعالميّ.
 *   - `RC14_COMPUTED_CONSTRUCTOR_KEY_UNSEEN` (grok §5): `(() => 0)['constr'+'uctor']`.
 *   - `OPAQUE_ABSENCE_STILL_CLOSED_FORM_LIST` (grok §5 · الجذر): كلُّ وجهٍ منَ الوجوهِ الخمسةِ
 *     أعلاهُ بابٌ منَ أبوابِ الوصولِ إلى منشئِ الدالّةِ لم يكن يُرى — تُقاسُ الأبوابُ لا الأسماء.
 *   - `RC07_DO_WHILE_BODY_FALSE_REJECT` (grok §6 · وجهُ رفضٍ كاذبٍ): جسمُ `do … while` يُنفَّذُ
 *     قبلَ شرطِهِ — لا يُرفَضُ الوجهُ الحيُّ (قِيسَ في الوجوهِ الحيّةِ لا السالبة).
 *
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * (docs/test-reports/phase-39-W-2026-040-remedy-10.md) وقياساتِهِ الخامّة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
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
  // ── المستدعى المزوَّر (gpt §3) ──
  { code: 'RC-07', why: "كائنٌ محليٌّ بمفتاحٍ محسوبٍ حرفيٍّ `['assertRehydrateCensus']` يقدّمُ دالةً فارغةً فيُنصَّبُ سيّدًا زورًا",
    mutate: boot(`const counterfeitCensus = { ['assertRehydrateCensus']: (_s: unknown): void => void 0 };\n  if (journal) counterfeitCensus['assertRehydrateCensus'](persistenceConfig.policy.scope);`) },
  { code: 'RC-07', why: 'وصولُ خاصّيّةٍ بنفسِ الاسمِ على كائنٍ محليٍّ — النصُّ ليسَ هويةً',
    mutate: boot(`const counterfeitCensus = { assertRehydrateCensus: (_s: unknown): void => void 0 };\n  if (journal) counterfeitCensus.assertRehydrateCensus(persistenceConfig.policy.scope);`) },
  { code: 'RC-07', why: 'تظليلٌ أقربُ لاسمِ الحاجزِ — ربطٌ محليٌّ يحلُّ محلَّ الاستيرادِ فالسيادةُ مدَّعاةٌ زورًا',
    mutate: boot(`const assertRehydrateCensus = (_s: unknown): void => void 0;\n  if (journal) ${SCOPE};`) },
  // ── الشفرةُ المعتمة: أبوابُ الوصولِ إلى منشئِ الدالّةِ (grok §5) ──
  { code: 'RC-14', why: "`import('node:vm')` الحرفيُّ ثمّ `runInThisContext` يكتبُ المُعفى — الوصولُ إلى وحدةِ الشفرةِ بابٌ لا يُبرهَنُ غيابُه",
    mutate: sink('probeR10Vm', ["  void import('node:vm').then((vm) => vm.runInThisContext(`globalThis.j.record(\"archive_snapshot\", {})`));"]) },
  { code: 'RC-14', why: "`import('node:module')` الحرفيُّ ثمّ `_compile` يكتبُ المُعفى",
    mutate: sink('probeR10Mod', ["  void import('node:module').then((m) => m.Module._compile(`globalThis.j.record(\"archive_snapshot\", {})`, 'probe'));"]) },
  { code: 'RC-14', why: "`Reflect.get(globalThis, 'Function')('j', …)` — انعكاسُ وصولٍ يبلغُ منشئَ الدالّةِ بلا قراءةٍ ساكنة (كما في خامّ grok)",
    mutate: sink('probeR10Reflect', [`  Reflect.get(globalThis, 'Function')('j', 'globalThis.j.record("archive_snapshot", {})'); void j;`]) },
  { code: 'RC-14', why: "`Object.getOwnPropertyDescriptor(globalThis, 'Function').value('j', …)` — الواصفُ يبلغُ القيمةَ ديناميكيًّا (كما في خامّ grok)",
    mutate: sink('probeR10Desc', [`  const d = Object.getOwnPropertyDescriptor(globalThis, 'Function');`, `  if (d !== undefined) (d.value as FunctionConstructor)('j', 'globalThis.j.record("archive_snapshot", {})');`]) },
  { code: 'RC-14', why: "`const g = globalThis; g['Func'+'tion']('j', …)` — فهرسٌ محسوبٌ على اسمٍ مستعارٍ للكائنِ العالميّ (كما في خامّ grok)",
    mutate: sink('probeR10Alias', [`  const g = globalThis;`, `  (g['Func'+'tion'] as FunctionConstructor)('j', 'globalThis.j.record("archive_snapshot", {})');`]) },
  { code: 'RC-14', why: "`(() => 0)['constr'+'uctor']('j', …)` — مفتاحٌ محسوبٌ يطوي إلى constructor — منشئُ الدالّةِ من نصّ (كما في خامّ grok)",
    mutate: sink('probeR10Ctor', [`  ((() => 0)['constr'+'uctor'] as FunctionConstructor)('j', 'globalThis.j.record("archive_snapshot", {})');`]) },
];

const LIVE: readonly Face[] = [
  { code: '', why: 'جسمُ `do … while (false)` يُنفَّذُ قبلَ شرطِهِ — نداءُ الحاجزِ فيه حيٌّ لا يُرفَض (grok §6 — الوجهُ السالبُ الكاذبُ)',
    mutate: boot(`do { if (journal) ${SCOPE}; } while (false);`) },
  { code: '', why: "مفتاحٌ محسوبٌ يطوي إلى اسمٍ سالِمٍ (`cfg['al'+'pha']`) — الطيُّ يعرّفُ النصَّ ولا يخمّنُ خطرًا",
    mutate: sink('liveR10Fold', ["  const cfg: Record<string, number> = { alpha: 1 };", "  void cfg['al'+'pha']; void j;"]) },
  { code: '', why: "`import('node:path')` — استيرادٌ ديناميكيٌّ حرفيٌّ لوحدةٍ ليست وحدةَ شفرةٍ — لا يُرفَض",
    mutate: sink('liveR10Import', ["  void import('node:path').then((p) => void p.join('a', 'b')); void j;"]) },
  { code: '', why: 'فهرسٌ محسوبٌ على اسمٍ محليٍّ لا يُحَلُّ إلى كائنٍ عالميٍّ — الأبوابُ تُقاسُ لا كلُّ فهرسٍ يُجرَّم',
    mutate: sink('liveR10Local', ["  const local: Record<string, number> = { beta: 1 };", "  void local['be'+'ta']; void j;"]) },
];

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ السادسةِ تُسقِطُه برموزِها — الهويةُ ربطٌ لا نصٌّ وأبوابُ الشفرةِ تُقاس', () => {
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

test('الحاجزُ الساكن: الوجوهُ الحيّةُ للجولةِ العاشرةِ لا تُرفَض', () => {
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

test('الحاجزُ الساكن: نداءُ حاجزٍ في جسمِ `do … while` يُسمّى سيّدًا بذاتهِ لا برفضٍ كاذب (RC07_DO_WHILE_BODY_FALSE_REJECT)', () => {
  const g = gateRoot();
  try {
    boot(`do { if (journal) ${SCOPE}; } while (false);`)(g.root);
    const r = g.run();
    assert.equal(r.code, 0, `الوجهُ الحيُّ رُفض:\n${r.out}`);
    const m = /السيّدُ السطر (\d+) \{([^}]*)\}/.exec(r.out);
    assert.ok(m !== null, `السيّدُ غيرُ مسمًّى:\n${r.out}`);
    assert.doesNotMatch(m[2] ?? '', /false/, `شرطُ الدورانِ عُدَّ حارسًا للجسمِ:\n${r.out}`);
  } finally {
    g.clean();
  }
});
