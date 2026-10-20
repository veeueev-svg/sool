/**
 * tests/data/rehydrate_census_mutations_r5.test.ts — تطفيراتُ الجولةِ الخامسة (المرحلة 39 · W-2026-040)
 * شرطُ القبول: كلُّ صيغةِ تجاوزٍ سمّاها مراجعُ مجلسِ الجولةِ الأولى (grok · REJECTED)
 *   تُسقطُ الحاجزَ **برمزها**، والوجوهُ الحيّةُ التي لا يجوزُ رفضُها تُخضِرّ — فالحدُّ
 *   يُقاسُ من وجهَيه أو لا يُقاس.
 * المالك: وزارة البيانات | المدخلات: مهادُ التطفير | المخرجات: رمزُ خروجٍ ورمزُ رفضٍ [RC-NN]
 * التبعيات: tests/data/rehydrate_census_harness.ts والحزمةُ المبنيةُ في `dist/`
 * الصلاحيات: tmpdir وحدَها — لا يُلمس ملفٌّ في المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كلُّ مهادٍ ينظّف مجلدَه في tmpdir
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذه التطفيرات: docs/work/council/W-2026-040-1-grok.md §6
 *   · ومعالجتُها: docs/test-reports/phase-39-W-2026-040-remedy-5.md
 *
 * **لماذا ملفٌ منفصل**: سقفُ الوحدةِ 400 سطرًا وقائمةُ الاستثناءاتِ فارغةٌ عن قصدٍ —
 * فالسقفُ لا يُرفع والملفُّ يُفكَّك. وحدُّ القسمةِ **جولةُ المراجعة**: هذا سجلُّ ما سمّاه
 * مجلسُ الجولةِ الأولى (الجلسةُ 150) بعد أربعِ جولاتٍ سابقةٍ من المراجعةِ المستقلّة.
 *
 * **العلّةُ الجامعةُ لهذه الصيغِ كلِّها**: الحاجزُ بعد الجولةِ الرابعةِ أثبتَ الوصولَ
 * على حرّاسٍ **حرفيّةِ الكذب** و**مسماةً بلا تحليلٍ لدلالةِ العاملِ** — فالفاصلةُ `(0, x)`
 * والعدميُّ `A ?? B` حرفانِ لا يُقرأانِ أصلًا، ونداءٌ خادعٌ بالاسمِ يُزيحُ القياسَ عن
 * الإرجاعِ الحقيقيّ، والمُنتِجُ يُرى حرفًا مباشرًا ومُعرّفًا بمستوىً واحدٍ فقط، والحارسُ
 * الأبُ لجسمِ `case` لا يُسأل. وكلُّ وجهٍ منها مقيسٌ في الخامّ أسفلَ هذا الملف.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';
import { gateRoot, patch, patchClause } from './rehydrate_census_harness';

const FISCAL = 'src/data/rehydrate_fiscal.ts';
const SWITCH = '  switch (entry.kind) {';
const INDEX = 'src/index.ts';
const CENSUS_CALL = 'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);';

/** يُنزع بندُ الصنفِ ثمّ يُحقن نصٌّ قبل `switch` — لصيغِ التوزيعِ التي ليست `case` في موضعه */
const injectBeforeSwitch = (root: string, injected: string): void => {
  patchClause(root, '');
  patch(root, FISCAL, SWITCH, `${injected}${SWITCH}`);
};

/** بندُ `case` كاملٌ بجسمٍ مُعطًى — على صورةِ بندِ الشفرةِ الحقيقيّة */
const CASE = (body: string): string =>
  `    case 'tax_levy': {\n${body}\n      break;\n    }\n`;

test('الحاجزُ الساكن: عيوبُ مجلسِ الجولةِ الأولى العشرةُ تُسقطه برموزها — والعاملُ دلالةٌ لا حرفًا', () => {
  const mutations: ReadonlyArray<{ code: string; why: string; mutate: (root: string) => void }> = [
    // ── عيوبُ 1 و2: `RC07_COMMA_CONJUNCT_DECOY_GREENS` · `RC07_NULLISH_CONJUNCT_DECOY_GREENS` ──
    {
      code: 'RC-07',
      why: 'الفاصلةُ في شرطِ الحاجز: `if (journal && (0, false)) { الحاجز + نداءٌ خادعٌ }` — القيمةُ الطرفُ الأيمنُ',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal && (0, false)) { assertRehydrateCensus(persistenceConfig.policy.scope);'
          + ' rehydrateProbeBypass(); }'),
    },
    {
      code: 'RC-07',
      why: 'العدميُّ في شرطِ الحاجز: `journal && (null ?? false)` — null معدومٌ فالقيمةُ اليمينُ الكاذبُ',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (journal && (null ?? false)) { assertRehydrateCensus(persistenceConfig.policy.scope);'
          + ' rehydrateProbeBypass(); }'),
    },
    // ── عزلُ إصلاحِ «كلِّ النداءات»: نداءٌ خادعٌ يوافقُ القاعدةَ بأولِ موضعٍ — والإرجاعُ الحقيقيُّ
    //    تحتَ `journal` — فلا فاصلةَ ولا عدميَّ هنا، والسقوطُ من سيادةِ القياسِ نفسِها ──
    {
      code: 'RC-07',
      why: 'نداءٌ خادعٌ بالاسمِ يوافقُ `/^rehydrate[A-Z]/` ويُقاسُ الحاجزُ عليه لا على الإرجاعِ الحقيقيّ',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        'if (probeFlag) { assertRehydrateCensus(persistenceConfig.policy.scope); rehydrateProbeBypass(); }'),
    },
    // ── عيوبُ 3–6: المُنتِجُ المستعارُ بصيغِهِ الأربعِ `RC04_*_UNSEEN` ──
    {
      code: 'RC-04',
      why: 'مُنتِجٌ عبرَ غلافِ `as const`: `const kind = \'archive_snapshot\' as const` — RC04_AS_CAST_ALIAS_UNSEEN',
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantProducerAsCast(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const kind = 'archive_snapshot' as const;",
        '  j.record(kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: 'مُنتِجٌ عبرَ سلسلةِ مُعرّفَينِ: `const a = الحرف; const kind = a;` — RC04_ALIAS_CHAIN_UNSEEN',
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantProducerChain(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const a = 'archive_snapshot';",
        '  const kind = a;',
        '  j.record(kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: 'مُنتِجٌ عبرَ وصولِ الخاصّيّةِ: `j.record(row.kind)` والحرفُ في الكائنِ — RC04_PROPERTY_ACCESS_PRODUCER_UNSEEN',
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantProducerProperty(j: { record: (k: string, p: unknown) => unknown }): void {',
        "  const row = { kind: 'archive_snapshot' };",
        '  j.record(row.kind, {});',
        '}',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-04',
      why: 'مُنتِجٌ عبرَ اختصارِ الكائنِ: `j.record({ kind })` — RC04_OBJECT_ARG_ALIAS_UNSEEN',
      mutate: (root) => appendFileSync(join(root, 'src/data/persistence.ts'), [
        'export function mutantProducerShorthand(j: { record: (k: string, o: unknown) => unknown }): void {',
        "  const kind = 'archive_snapshot';",
        '  j.record({ kind }, {});',
        '}',
        '',
      ].join('\n')),
    },
    // ── عيوبُ 7 و8: توزيعٌ تحتَ حارسٍ لا يُقرأُ دلالةَ عاملِهِ ──
    {
      code: 'RC-03',
      why: 'أثرُ التوزيعِ داخلَ `if ((0, false))` — الفاصلةُ لا تُرى فيُخضِرُّ الميت',
      mutate: (root) => patchClause(
        root, CASE('      if ((0, false)) { state.levySequence += 1; }'),
      ),
    },
    {
      code: 'RC-03',
      why: 'أثرُ التوزيعِ داخلَ `if (null ?? false)` — العدميُّ لا يُرى فيُخضِرُّ الميت',
      mutate: (root) => patchClause(
        root, CASE('      if (null ?? false) { state.levySequence += 1; }'),
      ),
    },
    // ── عيبُ 9: `DISPATCH_ANCESTOR_CONSTANT_FALSY_UNSEEN` — الحارسُ الأبُ لا يُسأل ──
    {
      code: 'RC-03',
      why: 'بندٌ ذو أثرٍ داخلَ `if (false) switch (entry.kind)` — الحارسُ الأبُ ثابتُ الكذبِ',
      mutate: (root) => injectBeforeSwitch(root, [
        '    if (false) {',
        '      switch (entry.kind) {',
        "        case 'tax_levy': { state.levySequence += 1; break; }",
        '      }',
        '    }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'بندٌ ذو أثرٍ داخلَ `while (false) switch (entry.kind)` — جسمُ الحلقةِ لا يدور',
      mutate: (root) => injectBeforeSwitch(root, [
        '    while (false) {',
        '      switch (entry.kind) {',
        "        case 'tax_levy': { state.levySequence += 1; break; }",
        '      }',
        '    }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'بندٌ ذو أثرٍ داخلَ `if ((0, false)) switch` — الوجهُ نفسُه بعاملِ الفاصلةِ (commaSwitch)',
      mutate: (root) => injectBeforeSwitch(root, [
        '    if ((0, false)) {',
        '      switch (entry.kind) {',
        "        case 'tax_levy': { state.levySequence += 1; break; }",
        '      }',
        '    }',
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
      name: 'if (0, true) { أثر } — فاصلةٌ قيمتُها الطرفُ الأيمنُ الصادقُ',
      mutate: (root) => patchClause(
        root, CASE('      if (0, true) { state.levySequence += 1; }'),
      ),
    },
    {
      name: 'if (null ?? true) { أثر } — معدومٌ فالقيمةُ اليمينُ الصادقُ',
      mutate: (root) => patchClause(
        root, CASE('      if (null ?? true) { state.levySequence += 1; }'),
      ),
    },
    {
      name: "if ('x' ?? false) { أثر } — غيرُ معدومٍ فالقيمةُ اليسارُ الصادقُ",
      mutate: (root) => patchClause(
        root, CASE("      if ('x' ?? false) { state.levySequence += 1; }"),
      ),
    },
    {
      name: 'نداءٌ خادعٌ تحتَ شرطِ الحاجزِ نفسِه — فلا يُزيحُ القياسَ ولا يُرفضُ',
      mutate: (root) => patch(root, INDEX, CENSUS_CALL,
        `${CENSUS_CALL}\n  if (journal) rehydrateProbeBypass();`),
    },
    {
      name: 'إرجاعٌ تحتَ `journal && extra` والحاجزُ تحتَ `journal` — الاحتواءُ ذرّاتٍ لا نصًّا',
      mutate: (root) => patch(root, INDEX,
        '  const rehydrated = journal\n    ? rehydrateFromJournal(journal,',
        '  const rehydrated = journal && censusProbeExtra\n    ? rehydrateFromJournal(journal,'),
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
