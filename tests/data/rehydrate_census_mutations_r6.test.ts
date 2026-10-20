/**
 * tests/data/rehydrate_census_mutations_r6.test.ts — تطفيراتُ الجولةِ السادسة (المرحلة 39 · W-2026-040)
 * شرطُ القبول: كلُّ صيغةِ تجاوزٍ سمّاها مراجعُ مجلسِ الجولةِ الثانية (grok · gpt · REJECTED)
 *   تُسقطُ الحاجزَ **برمزها**، والوجوهُ الحيّةُ التي لا يجوزُ رفضُها تُخضِرّ — فالحدُّ
 *   يُقاسُ من وجهَيه أو لا يُقاس.
 * المالك: وزارة البيانات | المدخلات: مهادُ التطفير | المخرجات: رمزُ خروجٍ ورمزُ رفضٍ [RC-NN]
 * التبعيات: tests/data/rehydrate_census_harness.ts والحزمةُ المبنيةُ في `dist/`
 * الصلاحيات: tmpdir وحدَها — لا يُلمس ملفٌّ في المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كلُّ مهادٍ ينظّف مجلدَه في tmpdir
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذه التطفيرات: docs/work/council/W-2026-040-2-grok.md §7
 *   · وdocs/work/council/W-2026-040-2-gpt.md (عيبُ `BigInt(0)` الاستدعائيُّ)
 *   · ومعالجتُها: docs/test-reports/phase-39-W-2026-040-remedy-6.md
 *
 * **لماذا ملفٌ منفصل**: سقفُ الوحدةِ 400 سطرًا وقائمةُ الاستثناءاتِ فارغةٌ عن قصدٍ —
 * فالسقفُ لا يُرفع والملفُّ يُفكَّك. وحدُّ القسمةِ **جولةُ المراجعة**: هذا سجلُّ ما سمّاه
 * مجلسُ الجولةِ الثانية (الجلسة 151) بعد خمسِ جولاتٍ سابقةٍ من المراجعةِ المستقلةِ.
 *
 * **العلّةُ الجامعةُ**: العدميُّ `??` لم يكن رابطًا قاصرًا عندَ الحاجزِ ولا عندَ محلِّلِ
 * الأثرِ ولا في ذرّاتِ الحراسِ؛ والأصفارُ (بادئةً وBigInt) والغلافُ النوعيُّ `satisfies`
 * والمصفوفةُ الفارغةُ المغلّفةُ لم تُقرأ قيمًا؛ ووصولُ الفهرسِ والمفتاحُ المحسوبُ والنشرُ
 * والإسنادُ اللاحقُ والخاصّيّةُ المتداخلةُ لم تُرَ منتجاتٍ؛ و`void` لم يُصنَّف معدومًا
 * فَرُفِضَ الحيُّ. وكلُّ وجهٍ منها مقيسٌ في خامَّي المراجعينِ أسفلَ هذا الملف.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { gateRoot, patch, patchClause } from './rehydrate_census_harness';

const FISCAL = 'src/data/rehydrate_fiscal.ts';
const SWITCH = '  switch (entry.kind) {';
const INDEX = 'src/index.ts';
const SCANNERS = 'src/production/production_scanners.ts';
const READER_LINE = '    for (const [kind, count] of deps.durable.droppedByKind()) {';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';

/** يُنزع بندُ الصنفِ ثمّ يُحقن نصٌّ قبل `switch` — لصيغِ التوزيعِ التي ليست `case` في موضعه */
const injectBeforeSwitch = (root: string, injected: string): void => {
  patchClause(root, '');
  patch(root, FISCAL, SWITCH, `${injected}${SWITCH}`);
};

/** بندُ `case` كاملٌ بجسمٍ مُعطًى — على صورةِ بندِ الشفرةِ الحقيقيةِ */
const CASE = (body: string): string =>
  `    case 'tax_levy': {\n${body}\n      break;\n    }\n`;

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ الثانيةِ تُسقطه برموزها — والعاملُ دلالةٌ لا حرفًا', () => {
  const mutations: ReadonlyArray<{ code: string; why: string; mutate: (root: string) => void }> = [
    // ── عيوبُ 1–4: قصرُ الدارةِ حولَ نداءِ الحاجزِ — يسارٌ غيرُ معدومٍ فاليمينُ لا يُقيَّم ──
    {
      code: 'RC-07',
      why: 'عدميٌّ بيسارٍ غيرِ معدومٍ: `if (journal) (false ?? assertRehydrateCensus(…))` — RC07_QQ_NONNULLISH_SHORT_CIRCUIT_SKIPS_CENSUS',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal) (false ?? assertRehydrateCensus(persistenceConfig.policy.scope));'),
    },
    {
      code: 'RC-07',
      why: "الوجهُ نفسُه بسلسلةٍ: `'x' ?? census()` — اليمينُ لا يُقيَّم",
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        "if (journal) ('x' ?? assertRehydrateCensus(persistenceConfig.policy.scope));"),
    },
    {
      code: 'RC-07',
      why: 'صفرٌ ببادئةٍ: `if (journal) (-0 && assertRehydrateCensus(…))` — RC07_UNARY_ZERO_AND_SKIPS_CENSUS',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal) (-0 && assertRehydrateCensus(persistenceConfig.policy.scope));'),
    },
    {
      code: 'RC-07',
      why: 'صفرٌ BigInt: `0n && census()` — RC07_BIGINT_ZERO_AND_SKIPS_CENSUS',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal) (0n && assertRehydrateCensus(persistenceConfig.policy.scope));'),
    },
    {
      code: 'RC-07',
      why: 'غلافٌ نوعيٌّ يُمحى ترجمةً: `(false satisfies boolean) && census()` — RC07_SATISFIES_FALSY_AND_SKIPS_CENSUS',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal) ((false satisfies boolean) && assertRehydrateCensus(persistenceConfig.policy.scope));'),
    },
    // ── عيوبُ 5–9: أثرٌ ميّتٌ يُحسَبُ حيًّا في التوزيعِ ──
    {
      code: 'RC-03',
      why: 'أثرٌ في يمينِ عدميٍّ بيسارٍ غيرِ معدومٍ: `false ?? (state.levySequence += 1)` — RC03_QQ_DEAD_EFFECT_GREENS',
      mutate: (root) => patchClause(root,
        CASE('      false ?? (state.levySequence += 1);')),
    },
    {
      code: 'RC-03',
      why: 'حارسُ توزيعٍ صفريٌّ ببادئةٍ: `if (-0) { += 1 }` — RC03_UNARY_ZERO_GREENS_DISPATCH',
      mutate: (root) => patchClause(root,
        CASE('      if (-0) { state.levySequence += 1; }')),
    },
    {
      code: 'RC-03',
      why: 'حارسُ توزيعٍ BigInt: `if (0n) { += 1 }` — RC03_BIGINT_ZERO_GREENS_DISPATCH',
      mutate: (root) => patchClause(root,
        CASE('      if (0n) { state.levySequence += 1; }')),
    },
    {
      code: 'RC-03',
      why: 'غلافٌ نوعيٌّ كحارسِ توزيعٍ: `if (false satisfies boolean) { += 1 }` — RC03_SATISFIES_FALSY_GREENS_DISPATCH',
      mutate: (root) => patchClause(root,
        CASE('      if (false satisfies boolean) { state.levySequence += 1; }')),
    },
    {
      code: 'RC-03',
      why: 'استدعاءُ `BigInt(0)` العالميُّ حارسًا: `if (BigInt(0)) { += 1 }` — قيمتُه 0n كاذبة (عيبُ gpt المسماة)',
      mutate: (root) => patchClause(root,
        CASE('      if (BigInt(0)) { state.levySequence += 1; }')),
    },
    {
      code: 'RC-03',
      why: 'مصفوفةٌ فارغةٌ مغلفةً بقوسٍ: `for (const _x of ([])) switch` — RC03_FOR_OF_WRAPPED_EMPTY_UNSEEN',
      mutate: (root) => injectBeforeSwitch(root, [
        '    for (const _x of ([])) {',
        '      switch (entry.kind) {',
        "        case 'tax_levy': { state.levySequence += 1; break; }",
        '      }',
        '    }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'مصفوفةٌ فارغةٌ بغلافِ `as const`: `for (const _x of ([] as const)) switch`',
      mutate: (root) => injectBeforeSwitch(root, [
        '    for (const _x of [] as const) {',
        '      switch (entry.kind) {',
        "        case 'tax_levy': { state.levySequence += 1; break; }",
        '      }',
        '    }',
        '',
      ].join('\n')),
    },
    // ── عيوبُ 16–17: قارئُ العدّادِ ميّتٌ ويُعَدُّ حيًّا ──
    {
      code: 'RC-12',
      why: 'قارئُ العدّادِ في يمينِ عدميٍّ بيسارٍ غيرِ معدومٍ: `false ?? droppedByKind()` — RC12_QQ_DEAD_READER_GREENS',
      mutate: (root) => patch(root, SCANNERS, READER_LINE,
        '    for (const [kind, count] of (false ?? deps.durable.droppedByKind())) {'),
    },
    {
      code: 'RC-12',
      why: 'الوجهُ نفسُه ببادئةِ الصفرِ: `-0 && droppedByKind()` — RC12_UNARY_ZERO_DEAD_READER_GREENS',
      mutate: (root) => patch(root, SCANNERS, READER_LINE,
        '    for (const [kind, count] of (-0 && deps.durable.droppedByKind())) {'),
    },
    // ── عيوبُ 10–15: منتجاتُ إعفاءٍ لا يراها محلِّلُ المنتجِ ──
    {
      code: 'RC-04',
      why: "منتجٌ بفهرسِ الحرفِ على المُسمّى: `j['record']('archive_snapshot', {})` — RC04_BRACKET_CALLEE_UNSEEN",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6BracketCallee(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  j['record']('archive_snapshot', {});",
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "الوجهُ الاختياريُّ: `j?.['record']('archive_snapshot', {})`",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6OptionalBracket(j: { record?: (k: string, p: unknown) => unknown }): void {',
        "  j?.['record']?.('archive_snapshot', {});",
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "الصنفُ بفهرسِ الحرفِ وسيطًا: `j.record(row['kind'], {})` — RC04_ELEMENT_ACCESS_KIND_UNSEEN",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6BracketKind(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { kind: 'archive_snapshot' };",
        "  j.record(row['kind'], {});",
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "مفتاحٌ محسوبٌ بحرفٍ: `{ ['kind']: 'archive_snapshot' }` — RC04_COMPUTED_PROPERTY_KEY_UNSEEN",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6ComputedKey(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { ['kind']: 'archive_snapshot' };",
        '  j.record(row.kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "إسنادٌ لاحقٌ لبيانٍ بلا ابتداءٍ: `let kind; kind = 'archive_snapshot'; j.record(kind)` — RC04_LET_ASSIGNMENT_UNSEEN",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6LetAssign(j: { record: (k: string, p: unknown) => unknown }): void {',
        '  let kind: string;',
        "  kind = 'archive_snapshot';",
        '  j.record(kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "إسنادٌ لاحقٌ فوقَ ابتداءٍ: `let kind = 'other'; kind = 'archive_snapshot';` — آخِرُ كتابةٍ قبلَ الاستعمال",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6Reassign(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  let kind = 'other';",
        "  kind = 'archive_snapshot';",
        '  j.record(kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: 'نشرُ كائنٍ يخفي الخاصّيّةَ: `{ ...{ kind: \'archive_snapshot\' } }` — RC04_SPREAD_OBJECT_UNSEEN',
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6Spread(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { ...{ kind: 'archive_snapshot' } };",
        '  j.record(row.kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: "خاصّيّةٌ متداخلةٌ بمستوًى ثانٍ: `row.meta.kind` — RC04_NESTED_PROPERTY_UNSEEN",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6Nested(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { meta: { kind: 'archive_snapshot' } };",
        '  j.record(row.meta.kind, {});',
        '}',
        '',
      ].join('\n')),
    },
  ];
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

test('الحاجزُ الساكن: الوجوهُ الحيّةُ لا تُرفض — فحاجزٌ يرفضُ الصحيحَ يدفعُ إلى التزوير', () => {
  const faces: ReadonlyArray<{ name: string; mutate: (root: string) => void }> = [
    {
      name: 'if (void 0 ?? true) { أثر } — void معدومٌ فالقيمةُ اليمينُ الصادقُ (كان رفضًا كاذبًا)',
      mutate: (root) => patchClause(root,
        CASE('      if (void 0 ?? true) { state.levySequence += 1; }')),
    },
    {
      name: 'if (void 0 ?? journal) الحاجزُ — الذرّاتُ ذرّاتُ journal فالسيادةُ قائمة',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (void 0 ?? journal) assertRehydrateCensus(persistenceConfig.policy.scope);'),
    },
    {
      name: 'if ((0, journal)) الحاجزُ — الفاصلةُ قيمتُها اليمينُ فالذرّاتُ ذرّاتُه',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if ((0, journal)) assertRehydrateCensus(persistenceConfig.policy.scope);'),
    },
    {
      name: 'if (null ?? journal) الحاجزُ — معدومٌ فالقيمةُ (والذرّاتُ) journal',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (null ?? journal) assertRehydrateCensus(persistenceConfig.policy.scope);'),
    },
    {
      name: 'if (0, 1) { أثر } — فاصلةٌ قيمتُها الطرفُ الأيمنُ الصادقُ',
      mutate: (root) => patchClause(root,
        CASE('      if (0, 1) { state.levySequence += 1; }')),
    },
    {
      name: 'if (1n) { أثر } — BigInt غيرُ صفريٍّ صادقٌ',
      mutate: (root) => patchClause(root,
        CASE('      if (1n) { state.levySequence += 1; }')),
    },
    {
      name: 'if (-1) { أثر } — بادئةُ سالبٍ على غيرِ الصفريِّ لا تُغيّرُ الصدق',
      mutate: (root) => patchClause(root,
        CASE('      if (-1) { state.levySequence += 1; }')),
    },
    {
      name: 'BigInt مظلَّلٌ محليًّا فلا يُقطَعُ بكذبِه — مجهولٌ يُعاملُ قابلًا للصدق',
      mutate: (root) => patchClause(root, [
        '      const BigInt = (x: unknown): number => 1;',
        CASE('      if (BigInt(0)) { state.levySequence += 1; }').trimEnd(),
      ].join('\n')),
    },
    {
      name: "إسنادٌ لاحقٌ يُبطلُ القيمةَ: `kind = 'archive_snapshot'; kind = 'other';` — آخِرُ كتابةٍ هي القيمة",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6StaleWrite(j: { record: (k: string, p: unknown) => unknown }): void {',
        '  let kind: string;',
        "  kind = 'archive_snapshot';",
        "  kind = 'other';",
        '  j.record(kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      name: "ترتيبُ الاستبدالِ في النشرِ: `{ kind: 'archive_snapshot', ...{ kind: 'other' } }` — النشرُ آخِرًا فهو الغالبُ",
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantR6SpreadOrder(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { kind: 'archive_snapshot', ...{ kind: 'other' } };",
        '  j.record(row.kind, {});',
        '}',
        '',
      ].join('\n')),
    },
  ];
  for (const f of faces) {
    const g = gateRoot();
    try {
      f.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 0, `حاجزٌ رفض وجهًا حيًّا: ${f.name}\n${r.out}`);
    } finally {
      g.clean();
    }
  }
});
