/**
 * tests/data/rehydrate_census_mutations.test.ts — تطفيرُ حاجزِ حصرِ الإرجاع (المرحلة 39 · W-2026-040)
 * شرطُ القبول: كلُّ صيغةِ تجاوزٍ رفعتها المراجعةُ المستقلّةُ تُسقط الحاجزَ **برمزها**،
 * وكلُّ صيغةِ توزيعٍ صحيحةٍ تُخضِرّه — فحاجزٌ يرفض الصحيحَ عيبٌ كحاجزٍ يقبل الباطل.
 * المالك: وزارة البيانات | المدخلات: مهادُ التطفير | المخرجات: رمزُ خروجٍ ورمزُ رفضٍ [RC-NN]
 * التبعيات: tests/data/rehydrate_census_harness.ts والحزمةُ المبنيّةُ في `dist/`
 * الصلاحيات: tmpdir وحدَها — لا يُلمس ملفٌّ في المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كلُّ مهادٍ ينظّف مجلدَه في tmpdir
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت تطفيراتِ الجولةِ الثالثة:
 *     docs/test-reports/phase-39-W-2026-040-review-round-2.md
 *
 * ثوابت هذا الاختبار:
 *   1) **التأكيدُ على الرموز** `[RC-NN]` لا على النصوصِ العربيّةِ المشكولة.
 *   2) **الحاجزُ يُرى ساقطًا**: كلُّ عيبٍ رفعه مراجعٌ مستقلٌّ صار حالةَ تطفيرٍ هنا،
 *      فالعيبُ لا يُغلَق بإصلاحٍ يُروى بل بقياسٍ يُعاد (RULE-001).
 *   3) **الحالةُ الحميدةُ حالةٌ**: صيغةُ خريطةِ المُوزِّعاتِ الصحيحةُ تُختبر قبولًا لا رفضًا.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateRoot, patch, patchClause } from './rehydrate_census_harness';

test('الحاجزُ الساكن: يخرج بـ0 على الجذر السليم — وإلّا فكلُّ تطفيرٍ بعده بلا معنى', () => {
  const g = gateRoot();
  try {
    const r = g.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /23/);
    // البرهانُ النحويُّ يشهد لواحدٍ وعشرين مستهلكًا — لا لثلاثةٍ وعشرين ولا لخمسة
    assert.match(r.out, /21/, r.out);
  } finally {
    g.clean();
  }
});

/**
 * التطفيراتُ التي **نجت** من الصيغةِ المعجميّةِ الأولى ورفعها المراجعانِ عيبًا. وكلُّ صفٍّ
 * هنا حالةٌ قال عنها مراجعٌ مستقلٌّ إنّها تُخضِّر حاجزًا ومنطقُ الإرجاعِ محذوف — فوجودُها
 * هنا هو ما يفصل «برهانًا» عن «تطابقِ سلسلة».
 */
test('الحاجزُ الساكن: يسقط برموزه على اثنينِ وعشرينَ تطفيرًا — والفرعُ الخامدُ لا يُنجي', () => {
  const mutations: ReadonlyArray<{ code: string; why: string; mutate: (root: string) => void }> = [
    {
      code: 'RC-01',
      why: 'صنفٌ في النطاق بلا صفٍّ في الجدول — العلّةُ الأمّ',
      mutate: (root) => {
        const file = join(root, 'src/data/rehydrate_census.ts');
        const body = readFileSync(file, 'utf8');
        writeFileSync(file, body.split('\n').filter((l) => !l.includes("{ kind: 'tax_levy'")).join('\n'), 'utf8');
      },
    },
    {
      code: 'RC-03',
      why: 'دعوى استهلاكٍ تُشير إلى ملفٍّ لا موضعَ توزيعٍ فيه للصنف',
      mutate: (root) => patch(
        root, 'src/data/rehydrate_census.ts',
        "{ kind: 'tax_levy', consumer: 'src/data/rehydrate_fiscal.ts'",
        "{ kind: 'tax_levy', consumer: 'src/data/rehydrate_governance.ts'",
      ),
    },
    {
      code: 'RC-03',
      why: '**العيبُ الذي رفضه المراجعان**: منطقُ التوزيعِ يُحذف ويبقى الاسمُ في تعليق. '
        + 'الصيغةُ المعجميّةُ كانت تُخضِرّ هنا لأنّ `grep` يرى التعليق — والشجرةُ لا ترى التعليقاتِ عُقَدًا',
      mutate: (root) => patch(
        root, 'src/data/rehydrate_fiscal.ts',
        "    case 'tax_levy': {",
        "    // مُطفَّر: كان هنا case 'tax_levy' فحُذف وبقي الاسمُ في هذا التعليق\n    {",
      ),
    },
    {
      code: 'RC-03',
      why: 'الاسمُ في سطرِ سجلٍّ لا في موضعِ توزيع — نصٌّ يُطبع لا منطقٌ يعمل',
      mutate: (root) => patch(
        root, 'src/data/rehydrate_fiscal.ts',
        "    case 'tax_levy': {",
        "    { const kindNote = ['tax_levy'].join(''); void kindNote; }\n    {",
      ),
    },
    {
      code: 'RC-04',
      why: 'إعفاءُ «لا مُنتِجَ له» بعد ظهور مُنتِجٍ **بنداءٍ حقيقيّ**',
      mutate: (root) => {
        const file = join(root, 'src/data/persistence.ts');
        writeFileSync(file, `${readFileSync(file, 'utf8')}
export function mutantProducer(j: { record: (k: string, p: unknown) => unknown }): void {
  j.record('archive_snapshot', {});
}
`, 'utf8');
      },
    },
    {
      code: 'RC-05',
      why: 'علامةُ الضغطِ لم تبقَ مبنيّةً في الضاغط — بقي الاسمُ استعمالًا ولا إنتاج',
      mutate: (root) => patch(
        root, 'src/data/journal_compaction.ts',
        "kind: 'journal_compacted' as const,", 'kind: MUTANT_KIND,',
      ),
    },
    {
      code: 'RC-07',
      why: '**عيبٌ آخرُ رفعه المراجعان**: نداءُ الحاجزِ يُنزع ويبقى اسمُه في تعليقٍ فيُخضِرّ `grep`',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        '// مُطفَّر: كان هنا نداءُ assertRehydrateCensus( فحُذف وبقي اسمُه في التعليق',
      ),
    },
    {
      code: 'RC-10',
      why: '**العيبُ الذي أثبته المراجعُ (أ) بتنفيذِ المُحلِّلَين**: تعليقٌ لاحقٌ على سطرِ '
        + 'عنصرٍ في النطاق. العدّانِ المعجميّانِ كانا يقولان معًا 22=22 ويطبعان PASS — '
        + 'والمقابلةُ بالمجموعاتِ ترى عضوًا لا وجودَ له في التعدادِ المغلق',
      mutate: (root) => patch(
        root, 'config/persistence.yaml',
        '    - tax_levy', '    - tax_levy # تعليقٌ لاحقٌ على السطر',
      ),
    },
    {
      code: 'RC-11',
      why: 'صفٌّ بمستهلكٍ وإعفاءٍ معًا — الحصرُ المتبادلُ كان وصفًا في تعليقٍ لا حرسًا',
      mutate: (root) => patch(
        root, 'src/data/rehydrate_census.ts',
        "{ kind: 'tax_levy', consumer: 'src/data/rehydrate_fiscal.ts', exemption: null,",
        "{ kind: 'tax_levy', consumer: 'src/data/rehydrate_fiscal.ts', exemption: 'compaction_marker',",
      ),
    },
    {
      code: 'RC-12',
      why: 'قارئُ عدّادِ الإسقاطِ في الإنتاج يُنزع — فيعود الرقمُ يُحصى ولا يصل أحدًا',
      mutate: (root) => patch(
        root, 'src/production/production_scanners.ts',
        'deps.durable.droppedByKind()', 'new Map<string, number>()',
      ),
    },
    {
      code: 'RC-03',
      why: '**العيبُ الأوّلُ الذي رفضته الجولةُ الثانية** (`SYNTACTIC_DISPATCH_ACCEPTS_NOOP` · '
        + '`DISPATCH_SITE_ACCEPTS_VACUOUS_BRANCH`): منطقُ الإرجاعِ يُحذف بأكملِه ويبقى '
        + '`case` بعبارةِ `break` وحدَها. الصيغةُ النحويّةُ الأولى كانت تُخضِرّ هنا لأنّ '
        + '«جسمًا غيرَ فارغٍ» كان يكفي — و`break` عبارةٌ. فالمطلوبُ عبارةٌ ذاتُ **أثر**',
      mutate: (root) => patchClause(root, "    case 'tax_levy': break;\n"),
    },
    {
      code: 'RC-03',
      why: 'الفرعُ قائمٌ بجسمٍ فارغٍ — كتلةٌ لا عبارةَ فيها',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { }\n"),
    },
    {
      code: 'RC-03',
      why: 'الفرعُ قائمٌ بـ`return` عاطلٍ — خروجٌ لا أثرَ له في الحالة',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { return; }\n"),
    },
    {
      code: 'RC-03',
      why: 'الفرعُ قائمٌ بعبارةِ `void 0` — تعبيرٌ خامدٌ لا يكتب شيئًا',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { void 0; break; }\n"),
    },
    {
      code: 'RC-03',
      why: '**عيبٌ ثانٍ رفعته الجولةُ الثانية** (`DISPATCH_SITE_ACCEPTS_LOG_LINE_COMPARISON`): '
        + 'الفرعُ قائمٌ بسطرِ سجلٍّ وحدَه — طبعٌ ليس إرجاعًا',
      mutate: (root) => patchClause(root, "    case 'tax_levy': { console.log('tax_levy'); break; }\n"),
    },
    {
      code: 'RC-03',
      why: 'المقارنةُ على حقلِ الصنفِ في **سطرِ سجلٍّ** لا في شرطِ حكم',
      mutate: (root) => patchClause(root, "    { console.log(record.kind === 'tax_levy'); }\n"),
    },
    {
      code: 'RC-03',
      why: 'المقارنةُ مُسندةٌ إلى ثابتٍ لا يُقرأ — تعبيرٌ ميّتٌ لا فرعَ له',
      mutate: (root) => patchClause(root, "    { const isLevy = record.kind === 'tax_levy'; void isLevy; }\n"),
    },
    {
      code: 'RC-03',
      why: '**مقارنةُ حرفَينِ لا صلةَ لهما بالقيد** — لا طرفَ فيها يحمل حقلَ الصنف',
      mutate: (root) => patchClause(root, "    { if ('ignored' === 'tax_levy') { state.levySequence += 1; } }\n"),
    },
    {
      code: 'RC-03',
      why: 'شرطٌ على حقلِ الصنفِ بجسمٍ خامدٍ — حكمٌ لا يتبعه عمل',
      mutate: (root) => patchClause(root, "    { if (record.kind === 'tax_levy') { void 0; } }\n"),
    },
    {
      code: 'RC-07',
      why: '**عيبٌ ثالثٌ رفعته الجولةُ الثانية** (`BOOT_GUARD_ORDER_WITHOUT_DOMINANCE`): '
        + 'نداءُ الحاجزِ يُحاط بشرطٍ لا يصدُق أبدًا. قياسُ **الترتيبِ** وحدَه كان يُخضِرّ هنا '
        + 'لأنّ إزاحةَ المصدرِ لم تتغيّر — والمطلوبُ **سيادةٌ**: كلُّ شرطٍ يحرس الحاجزَ يحرس الإرجاع',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        'if (false) assertRehydrateCensus(persistenceConfig.policy.scope);',
      ),
    },
    {
      code: 'RC-12',
      why: '**عيبٌ رابعٌ رفعته الجولةُ الثانية** (`RC12_IS_PROPERTY_ACCESS_NOT_LIVE_READER` · '
        + '`DROP_READER_GATE_ACCEPTS_DEAD_ACCESS`): النداءُ يُبدَل بوصولٍ بالاسمِ لا يُنادَى. '
        + 'الفحصُ الأوّلُ كان يخضَرُّ بمجرّدِ وجودِ الخاصّيّةِ — ووصولٌ ميّتٌ ليس قارئًا',
      mutate: (root) => patch(
        root, 'src/production/production_scanners.ts',
        'deps.durable.droppedByKind()',
        '((): Map<string, number> => { void deps.durable.droppedByKind; return new Map(); })()',
      ),
    },
    {
      code: 'RC-13',
      why: '**عيبٌ خامسٌ رفعته الجولةُ الثانية** (`JOURNAL_DROP_PROBE_NEVER_TICKS_ON_BOOTSTRAP`): '
        + 'ماسحُ الإسقاطِ يُرفَع من قائمةِ المُشترَطِ فيعود الرقمُ إلى الصمتِ بلا إسقاط',
      mutate: (root) => patch(
        root, 'src/kernel/config/production_policy.ts',
        "  'journal_drop',\n]);", ']);',
      ),
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

/**
 * الوجهُ الآخرُ للبرهان، وهو ما كان مقلوبًا: اختبارُ `[RC-04]` القديمُ كان يُطفّر بـ**تعليق**
 * ويعدُّ سقوطَ الحاجزِ نجاحًا — فكان يُثبت العيبَ لا الخاصّيّة، ورفعه المراجعان. فصار الحكمُ
 * هنا معكوسًا بحقّه: **تعليقٌ ليس مُنتِجًا ولا مستهلكًا ولا نداءً، فلا يُغيّر الحكمَ**.
 */
test('الحاجزُ الساكن: التعليقُ ليس دليلًا في الجهتين — ثلاثُ إضافاتٍ لا تُسقط ولا تُخضِرّ زورًا', () => {
  const benign: ReadonlyArray<{ why: string; mutate: (root: string) => void }> = [
    {
      why: 'تعليقٌ يذكر نداءَ إنتاجٍ لصنفٍ مُعفًى — لا مُنتِجَ في الشجرة فلا يبطل الإعفاء',
      mutate: (root) => {
        const file = join(root, 'src/data/persistence.ts');
        writeFileSync(file, `${readFileSync(file, 'utf8')}\n// مُطفَّر: journal.record('archive_snapshot', {});\n`, 'utf8');
      },
    },
    {
      why: 'تعليقٌ يذكر نداءَ الحاجزِ في مسار الإقلاع — والنداءُ الحقيقيُّ باقٍ',
      mutate: (root) => patch(
        root, 'src/index.ts',
        'if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
        '// تعليقٌ: assertRehydrateCensus(scope)\n  if (journal) assertRehydrateCensus(persistenceConfig.policy.scope);',
      ),
    },
    {
      why: 'تعليقٌ مُزاحٌ على سطرٍ مستقلٍّ داخل كتلة النطاق — يتخطّاه المُحلِّلُ الحقيقيُّ',
      mutate: (root) => patch(
        root, 'config/persistence.yaml',
        '    - memory_record', '    # تعليقٌ مُزاح\n    - memory_record',
      ),
    },
  ];
  for (const b of benign) {
    const g = gateRoot();
    try {
      b.mutate(g.root);
      const r = g.run();
      assert.equal(r.code, 0, `حكمٌ على تعليق: ${b.why}\n${r.out}`);
      assert.match(r.out, /23/, r.out);
    } finally {
      g.clean();
    }
  }
});
