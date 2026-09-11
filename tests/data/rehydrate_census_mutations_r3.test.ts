/**
 * tests/data/rehydrate_census_mutations_r3.test.ts — تطفيراتُ الجولةِ الثالثة (المرحلة 39 · W-2026-040)
 * شرطُ القبول: كلُّ صيغةِ تجاوزٍ سمّاها مراجعُ الجولةِ الثالثةِ تُسقط الحاجزَ **برمزها**،
 *   والصيغةُ الحميدةُ الموازيةُ لها تُخضِرّه — فالحدُّ يُقاس من وجهَيه أو لا يُقاس.
 * المالك: وزارة البيانات | المدخلات: مهادُ التطفير | المخرجات: رمزُ خروجٍ ورمزُ رفضٍ [RC-NN]
 * التبعيات: tests/data/rehydrate_census_harness.ts والحزمةُ المبنيّةُ في `dist/`
 * الصلاحيات: tmpdir وحدَها — لا يُلمس ملفٌّ في المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كلُّ مهادٍ ينظّف مجلدَه في tmpdir
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذه التطفيرات:
 *     docs/test-reports/phase-39-W-2026-040-review-round-3.md
 *
 * **لماذا ملفٌّ منفصل**: بلغ `rehydrate_census_mutations.test.ts` حدَّه، وقائمةُ الاستثناءاتِ
 * في `scripts/limits/module_limits.yaml` **فارغةٌ عن قصدٍ** (أُغلق بها البند T-113) — فالسقفُ
 * لا يُرفَع والملفُّ يُفكَّك. وحدُّ القسمةِ **جولةُ المراجعة**: هذا سجلُّ ما نجا من الجولةِ
 * الثانيةِ فسمّته الثالثة.
 *
 * **العلّةُ الجامعةُ لهذه الصيغِ كلِّها**: كان حكمُ الأثرِ **قائمةَ نفيٍ** — «ليس فارغًا وليس
 * `break` وليس تسجيلًا» — وقائمةُ النفيِ يُنجي منها كلُّ ما لم يُذكَر فيها. فصار **قائمةَ
 * إثباتٍ** بأربعةٍ تُسمّى: إسنادٌ · نداءٌ لغيرِ أداةِ تسجيلٍ · رميٌ · إنشاءٌ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateRoot, patch, patchClause } from './rehydrate_census_harness';

const FISCAL = 'src/data/rehydrate_fiscal.ts';
const SWITCH = '  switch (entry.kind) {';

/** يُنزع بندُ الصنفِ ثمّ يُحقن نصٌّ قبل `switch` — لصيغِ التوزيعِ التي ليست `case` */
const injectBeforeSwitch = (root: string, injected: string): void => {
  patchClause(root, '');
  patch(root, FISCAL, SWITCH, `${injected}${SWITCH}`);
};

test('الحاجزُ الساكن: أحدَ عشرَ شكلًا من «الأثرِ الصوريِّ» تُسقطه برموزها — وقائمةُ النفيِ لا تكفي', () => {
  const mutations: ReadonlyArray<{ code: string; why: string; mutate: (root: string) => void }> = [
    {
      code: 'RC-03',
      why: 'حلقةٌ لا تدور: `while (false) {}` جسمٌ «غيرُ فارغٍ» ولا يُنفَّذ أبدًا',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { while (false) {} break; }\n"),
    },
    {
      code: 'RC-03',
      why: 'قراءةُ خاصّيّةٍ مُهمَلةٌ: `record.kind;` عبارةٌ لا أثرَ لها',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { record.kind; break; }\n"),
    },
    {
      code: 'RC-03',
      why: 'مصفوفةٌ مُهمَلةٌ: `[];` بناءُ قيمةٍ تُرمى في حينِها',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { []; break; }\n"),
    },
    {
      code: 'RC-03',
      why: '`try {} finally {}` كتلتانِ فارغتانِ في ثوبِ بنيةٍ مركّبة',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { try {} finally {} break; }\n"),
    },
    {
      code: 'RC-03',
      why: 'أثرٌ تحت شرطٍ لا يصدُق: `if (false) { … }` — الأثرُ مكتوبٌ لا مُنفَّذ',
      mutate: (root) => patchClause(
        root, "    case 'tax_levy': { if (false) { state.levySequence += 1; } break; }\n",
      ),
    },
    {
      code: 'RC-03',
      why: 'تعريفُ دالّةٍ لا نداءَ لها: التعريفُ إعلانٌ لا تنفيذٌ ولو كان جسمُه ذا أثر',
      mutate: (root) => patchClause(
        root, "    case 'tax_levy': { function g() { state.levySequence += 1; } break; }\n",
      ),
    },
    {
      code: 'RC-03',
      why: 'قفزةٌ مُعنونةٌ: `lbl: break lbl;` تحكّمٌ محضٌ لا أثرَ فيه',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { lbl: break lbl; }\n"),
    },
    {
      code: 'RC-03',
      why: 'خريطةُ مُعالِجين جسمُ معالِجِها فارغ — `HANDLER_MAP_ACCEPTS_EMPTY_BODY`',
      mutate: (root) => injectBeforeSwitch(root, [
        '  const levyHandlers = {',
        '    tax_levy: (): void => {},',
        '  } as Record<string, (() => void) | undefined>;',
        '  const picked = levyHandlers[entry.kind];',
        '  if (picked) { picked(); }',
        '',
      ].join('\n')),
    },
    {
      code: 'RC-03',
      why: 'مُرشِّحٌ بمُسنَدٍ لا أثرَ في جسمِه — `PREDICATE_CALLBACK_COUNTED_AS_CONSUMER`',
      mutate: (root) => injectBeforeSwitch(
        root, "  const probe = [entry].filter((r) => r.kind === 'tax_levy');\n  void probe;\n",
      ),
    },
    {
      code: 'RC-07',
      why: 'نداءُ الحاجزِ في حلقةٍ لا تدور — `RC07_LOOP_GUARD_NOT_MODELED`',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        'if (journal) { while (false) assertRehydrateCensus(persistenceConfig.policy.scope); }',
      ),
    },
    {
      code: 'RC-12',
      why: 'قارئُ العدّادِ تحت شرطٍ لا يصدُق — `RC12_CALL_IS_NOT_LIVE_READER`',
      mutate: (root) => patch(
        root, 'src/production/production_scanners.ts',
        '    for (const [kind, count] of deps.durable.droppedByKind()) {',
        '    if (false) deps.durable.droppedByKind();\n'
        + '    for (const [kind, count] of new Map<string, number>()) {',
      ),
    },
  ];
  assert.equal(mutations.length, 11, 'عددُ الصيغِ التي سمّتها الجولةُ الثالثة');
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
 * **الوجهُ الحميدُ، وهو ما وعدت به وثيقةُ الملفِّ الأوّلِ ولم تفعله** — رفعه المراجعُ عيبًا
 * باسم `OBJECT_MAP_BENIGN_TEST_ABSENT`: تشديدُ خريطةِ المُعالِجين (رابطةُ الجدولِ بفتحِه ·
 * وجوبُ النداء · قراءةُ جسمِ المُعالِج) **قد يرفض توزيعًا صحيحًا**، وحاجزٌ يرفض الصحيحَ
 * يدفع إلى التزوير. فالصيغةُ الصحيحةُ تُختبر قبولًا هنا، وهي الصورةُ المستعملةُ في الشفرةِ
 * الحقيقيّة: انتقاءٌ إلى مُتغيّرٍ ثمّ نداؤه بعد التحقّق.
 */
test('الحاجزُ الساكن: خريطةُ مُعالِجين صحيحةٌ تُخضِرّه — فتشديدُ الحكمِ لم يرفض الصحيح', () => {
  const g = gateRoot();
  try {
    injectBeforeSwitch(g.root, [
      '  const levyHandlers = {',
      '    tax_levy: (pl: Record<string, unknown>, st: typeof state, sq: number): void => {',
      '      st.revenueSeen = true;',
      '      const lv = pl.levy as Levy | undefined;',
      "      if (lv && typeof lv.levyId === 'string') st.levies.set(lv.levyId, { ...lv });",
      '      st.levySequence = Math.max(st.levySequence, sq);',
      '    },',
      '  } as Record<string, ((pl: Record<string, unknown>, st: typeof state, sq: number) => void)'
      + ' | undefined>;',
      '  const picked = levyHandlers[entry.kind];',
      '  if (picked) { picked(payload, state, seq); return; }',
      '',
    ].join('\n'));
    const r = g.run();
    assert.equal(r.code, 0, `حاجزٌ رفض توزيعًا صحيحًا بخريطةِ مُعالِجين\n${r.out}`);
    assert.match(r.out, /21/, r.out);
  } finally {
    g.clean();
  }
});
