/**
 * tests/data/rehydrate_census_mutations_r4.test.ts — تطفيراتُ الجولةِ الرابعة (المرحلة 39 · W-2026-040)
 * شرطُ القبول: كلُّ صيغةِ تجاوزٍ سمّاها مراجعُ الجولةِ الرابعةِ تُسقط الحاجزَ **برمزها**،
 *   والوجهانِ السالبانِ كاذبًا (`void` الغلاف · الإسنادُ المتداخل) يُخضِرّانه — فالحدُّ
 *   يُقاس من وجهَيه أو لا يُقاس.
 * المالك: وزارة البيانات | المدخلات: مهادُ التطفير | المخرجات: رمزُ خروجٍ ورمزُ رفضٍ [RC-NN]
 * التبعيات: tests/data/rehydrate_census_harness.ts والحزمةُ المبنيّةُ في `dist/`
 * الصلاحيات: tmpdir وحدَها — لا يُلمس ملفٌّ في المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كلُّ مهادٍ ينظّف مجلدَه في tmpdir
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذه التطفيرات:
 *     docs/test-reports/phase-39-W-2026-040-review-round-4.md
 *
 * **لماذا ملفٌّ منفصل**: سقفُ الوحدةِ 400 سطرًا وقائمةُ الاستثناءاتِ فارغةٌ عن قصدٍ —
 * فالسقفُ لا يُرفَع والملفُّ يُفكَّك. وحدُّ القسمةِ **جولةُ المراجعة**: هذا سجلُّ ما نجا
 * من الجولةِ الثالثةِ فسمّته الرابعة.
 *
 * **العلّةُ الجامعةُ لهذه الصيغِ كلِّها**: حكمُ الأثرِ كان **تصنيفًا بلا وصولٍ** — يجمعُ
 * وجودَ عُقدٍ وصيغٍ مناسبة ولا يُثبت قابليةَ التنفيذِ ولا رابطةَ التعريف. فصار الوصولُ
 * جزءًا من عقدِ الحاجز (`scripts/rehydrate_reachability.ts`): ثابتُ الكذبِ مركّبًا، وقصرُ
 * الدارةِ، وبندُ `switch` الذي لا يوافقُ مُميّزَه، والجدولُ **تعريفًا** لا اسمًا.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateRoot, patch, patchClause } from './rehydrate_census_harness';
import { appendFileSync } from 'node:fs';

const FISCAL = 'src/data/rehydrate_fiscal.ts';
const SWITCH = '  switch (entry.kind) {';

/** يُنزع بندُ الصنفِ ثمّ يُحقن نصٌّ قبل `switch` — لصيغِ التوزيعِ التي ليست `case` */
const injectBeforeSwitch = (root: string, injected: string): void => {
  patchClause(root, '');
  patch(root, FISCAL, SWITCH, `${injected}${SWITCH}`);
};

/** بندُ `case` كاملٌ بجسمٍ مُعطًى — على صورةِ بندِ الشفرةِ الحقيقيّة */
const CASE = (body: string): string =>
  `    case 'tax_levy': {\n${body}\n      break;\n    }\n`;

test('الحاجزُ الساكن: ستَّ عشرةَ صيغةً من «التصنيفِ بلا وصولٍ» تُسقطه برموزها — والوجودُ لا يقوم مقام التنفيذ', () => {
  const mutations: ReadonlyArray<{ code: string; why: string; mutate: (root: string) => void }> = [
    {
      code: 'RC-03',
      why: 'ثابتُ كذبٍ مركّب: `if (false && true) { … }` — EFFECT_CROSSES_COMPOUND_CONSTANT_FALSY',
      mutate: (root) => patchClause(
        root, CASE('      if (false && true) { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'ثابتُ كذبٍ مركّب: `if (false || false) { … }`',
      mutate: (root) => patchClause(
        root, CASE('      if (false || false) { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'ثابتُ كذبٍ مركّب: `if (true && false) { … }` — الفرعُ الأيمنُ لا يُنفَّذ',
      mutate: (root) => patchClause(
        root, CASE('      if (true && false) { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'قصرُ الدارةِ في الأثر: `false && (x += 1);` — الطرفُ الأيمنُ لا يُنفَّذ',
      mutate: (root) => patchClause(
        root, CASE('      false && (state.levySequence += 1);'),
      ),
    },
    {
      code: 'RC-03',
      why: 'قصرُ الدارةِ في الأثر: `true || (x += 1);` — الطرفُ الأيمنُ لا يُنفَّذ',
      mutate: (root) => patchClause(
        root, CASE('      true || (state.levySequence += 1);'),
      ),
    },
    {
      code: 'RC-03',
      why: 'بندُ تبديلٍ لا يوافقُ مُميّزَه: `switch (0) { case 1: … }` — RC07_SWITCH_GUARD_NOT_MODELED',
      mutate: (root) => patchClause(
        root, CASE('      switch (0) { case 1: state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'مرورٌ على مصفوفةٍ فارغةٍ حرفيًّا: `for (const x of []) { … }`',
      mutate: (root) => patchClause(
        root, CASE('      for (const x of []) { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'التقاطٌ لكتلةٍ خاويةٍ: `try {} catch { … }` — لا رميَ فلا التقاط',
      mutate: (root) => patchClause(
        root, CASE('      try {} catch { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-07',
      why: 'نداءُ الحاجزِ في الطرفِ الميتِ لشرطِ الحارس — RC07_SHORT_CIRCUIT_CONDITION_ESCAPES_GUARDS',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        'if (journal && (false && (assertRehydrateCensus(persistenceConfig.policy.scope), true)))'
          + ' { /* unreachable */ }',
      ),
    },
    {
      code: 'RC-07',
      why: 'نداءُ الحاجزِ في بندِ تبديلٍ لا يوافقُ مُميّزَه — RC07_SWITCH_GUARD_NOT_MODELED',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        'if (journal) { switch (0) { case 1: assertRehydrateCensus(persistenceConfig.policy.scope);'
          + ' break; default: break; } }',
      ),
    },
    {
      code: 'RC-12',
      why: 'قارئُ العدّادِ تحت ثابتِ كذبٍ مركّب — RC12_COMPOUND_FALSY_READER_ACCEPTED',
      mutate: (root) => patch(
        root, 'src/production/production_scanners.ts',
        '    for (const [kind, count] of deps.durable.droppedByKind()) {',
        '    if (false && true) deps.durable.droppedByKind();\n'
          + '    for (const [kind, count] of new Map<string, number>()) {',
      ),
    },
    {
      code: 'RC-12',
      why: 'قارئُ العدّادِ في الطرفِ الميتِ لقصرِ الدارة — RC12_SHORT_CIRCUIT_READER_ACCEPTED',
      mutate: (root) => patch(
        root, 'src/production/production_scanners.ts',
        '    for (const [kind, count] of deps.durable.droppedByKind()) {',
        '    if (false && (deps.durable!.droppedByKind(), true)) { /* unreachable */ }\n'
          + '    for (const [kind, count] of new Map<string, number>()) {',
      ),
    },
    {
      code: 'RC-03',
      why: 'نداءٌ ميتٌ لقيمةٍ منتقاة: `if (false) { picked(); }` — HANDLER_MAP_DEAD_CALL_ACCEPTED',
      mutate: (root) => injectBeforeSwitch(root, [
        '  const levyHandlers = {',
        '    tax_levy: (pl: Record<string, unknown>, st: typeof state, sq: number): void => {',
        '      st.levySequence = Math.max(st.levySequence, sq);',
        '    },',
        '  } as Record<string, ((pl: Record<string, unknown>, st: typeof state, sq: number) => void)'
          + ' | undefined>;',
        '  const picked = levyHandlers[entry.kind];',
        '  if (false) { picked(); }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'جدولانِ باسمٍ واحد: الحقيقيُّ لم يُفتح والفارغُ هو الذي نودي — HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME',
      mutate: (root) => injectBeforeSwitch(root, [
        '  {',
        '    const levyHandlers = {',
        '      tax_levy: (pl: Record<string, unknown>, st: typeof state, sq: number): void => {',
        '        st.levySequence = Math.max(st.levySequence, sq);',
        '      },',
        '    } as Record<string, ((pl: Record<string, unknown>, st: typeof state, sq: number)'
        + ' => void) | undefined>;',
        '    void levyHandlers;',
        '  }',
        '  {',
        '    const levyHandlers = {} as Record<string, (() => void) | undefined>;',
        '    const picked = levyHandlers[entry.kind];',
        '    if (picked) { picked(); }',
        '  }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'نداءُ تسجيلٍ بالفهرس: `console[\'log\'](…)` يُعَدُّ أثرًا مُرجِعًا — LOGGING_CALL_ELEMENT_ACCESS_GREENS_RC03',
      mutate: (root) => patchClause(root, CASE("      console['log']('tax_levy');")),
    },
    {
      code: 'RC-04',
      why: 'منتجٌ بالاسمِ المستعار: `const kind = \'archive_snapshot\'; j.record(kind, …)` يُخفي بطلانَ الإعفاء — RC04_PRODUCER_ALIAS_UNSEEN',
      mutate: (root) => appendFileSync(
        `${root}/src/data/persistence.ts`,
        "\nexport function reviewerAliasProducer(j: { record: (k: string, p: unknown) => unknown }): void {\n"
          + "  const kind = 'archive_snapshot';\n"
          + '  j.record(kind, { reviewer: true });\n}\n',
        'utf8',
      ),
    },
  ];
  assert.equal(mutations.length, 16, 'عددُ الصيغِ التي سمّتها الجولةُ الرابعة');
  for (const m of mutations) {
    const g = gateRoot();
    try {
      m.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 1, `${m.code}: التطفيرُ نجا — ${m.why}\n${r.out}`);
      assert.match(r.out, new RegExp(`\\[${m.code}\\]`), `${m.code}: سقط بغير رمزه\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});

/**
 * **الوجهانِ السالبانِ كاذبًا** (`VOID_ENVELOPE_HIDES_EFFECT` · `POSITIVE_LIST_DROPS_NESTED_ASSIGNMENT`):
 * حاجزٌ يرفضُ الصحيحَ يدفعُ إلى التزوير كما حاجزٌ يقبلُ الفاسد. فأثرٌ داخلَ غلافِ `void`
 * وإسنادٌ متداخلٌ في عنصرِ مصفوفةٍ **أثرٌ يُنفَّذ** — والتطفيرُ هنا يثبتُ قبولَ الحاجزِ لهما.
 */
test('الحاجزُ الساكن: غلافُ void والإسنادُ المتداخلُ أثرانِ حيّانِ — فلا يرفضُ الصحيح', () => {
  const faces: ReadonlyArray<{ name: string; mutate: (root: string) => void }> = [
    {
      name: 'void (x += 1);',
      mutate: (root) => patchClause(root, CASE('      void (state.levySequence += 1);')),
    },
    {
      name: '[state.levySequence = Math.max(state.levySequence, seq)];',
      mutate: (root) => patchClause(
        root, CASE('      [state.levySequence = Math.max(state.levySequence, seq)];'),
      ),
    },
  ];
  for (const f of faces) {
    const g = gateRoot();
    try {
      f.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 0, `حاجزٌ رفض أثرًا حيًّا: ${f.name}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});
