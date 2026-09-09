/**
 * tests/data/rehydrate_census.test.ts — قبولُ حصرِ إرجاعِ أصنافِ اليوميّة (المرحلة 39، W-2026-040)
 * شرطُ القبول المعلن في عقد البند §4: لكلِّ صنفٍ في النطاق دعوى واحدةٌ مغلقة، والإقلاعُ يسقط
 * برمز PERSISTENCE_REHYDRATE_KIND_UNCLAIMED إن وُجد صنفٌ بلا دعوى، والإسقاطُ خارجَ النطاق يُعَدّ.
 * المالك: وزارة البيانات | المدخلات: تعدادُ الأصناف وتهيئةٌ منسوخة | المخرجات: أعدادٌ ورموزُ رفض
 * التبعيات: censusRehydrate وassertRehydrateCensus وbootstrapState
 * الصلاحيات: الكتابة عبر الواجهات العامة وحدها؛ كلُّ مسارٍ في tmpdir ولا يُلمس المستودع
 * السجلات: لا سجلَّ لهذا الحاجز — حكمُه استثناءٌ سياديّ
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/data/durable_rehydrate.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 * ثوابت هذا الاختبار:
 *   1) **التأكيدُ على الرموز والأعداد** لا على النصوص العربية المشكولة — فلا ينكسر على تنقيحِ صياغة.
 *   2) **الحاجزُ يُرى ساقطًا**: جدولُ الدعاوى الحقيقيُّ تامٌّ فلا يُسقطه شيءٌ اليوم، فيُحقَن
 *      جدولٌ ناقصٌ ليُبرهن أنّ الحاجزَ يُميّز — وحاجزٌ لم يُرَ ساقطًا ليس حاجزًا.
 *   3) **العدّادُ يُقاس على تهيئةٍ حقيقيّةٍ ووحداتٍ حقيقيّة** لا بمزيّفٍ يعُدّ نفسَه.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REHYDRATE_CLAIMS, REHYDRATE_EXEMPTION_REASONS, assertRehydrateCensus, censusRehydrate,
} from '../../src/data/rehydrate_census';
import type { RehydrateClaim } from '../../src/data/rehydrate_census';
import { DURABLE_KINDS } from '../../src/kernel/config/persistence';
import type { DurableKind } from '../../src/kernel/config/persistence';
import { SovereignViolation } from '../../src/kernel/types';
import { bootstrapState } from '../../src/index';

const T0 = 1_700_000_000_000;
const ALL = [...DURABLE_KINDS];

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SovereignViolation, 'الرفضُ يجب أن يكون استثناءً سياديًّا لا خطأً عامًّا');
    return error.code;
  }
  return 'NO_THROW';
}

test('حصرُ الإرجاع: كلُّ صنفٍ في النطاق المعلن له دعوى واحدةٌ مغلقة', () => {
  const report = censusRehydrate(ALL);
  assert.equal(report.declared, DURABLE_KINDS.length);
  assert.equal(report.inScope.length, DURABLE_KINDS.length);
  assert.deepEqual(report.unclaimed, [], 'صنفٌ في النطاق بلا دعوى — وهو عينُ العلّة التي فُتح لها البند');
  assert.equal(report.claimed.length + report.exempt.length, DURABLE_KINDS.length);
  assert.ok(report.claimed.length > 0 && report.exempt.length > 0);
});

test('حصرُ الإرجاع: العددُ المقيس هو 23 صنفًا · 21 بمستهلك · 2 بإعفاءٍ مُعلَن', () => {
  const report = censusRehydrate(ALL);
  assert.equal(report.declared, 23, 'تبدُّلُ العددِ ليس خطأً بذاته — لكنّه يوجب مراجعةَ الجدول والتقرير معًا');
  assert.equal(report.claimed.length, 21);
  assert.deepEqual([...report.exempt].sort(), ['archive_snapshot', 'journal_compacted']);
});

test('حصرُ الإرجاع: لكلِّ دعوى مستهلكٌ مسمًّى أو إعفاءٌ من المُعجم المغلق — ولا ثالثَ لهما', () => {
  for (const claim of REHYDRATE_CLAIMS) {
    const hasConsumer = claim.consumer !== null;
    const hasExemption = claim.exemption !== null;
    assert.notEqual(hasConsumer, hasExemption, `${claim.kind}: دعوى بلا حالٍ واحدةٍ حاسمة`);
    if (hasExemption) assert.ok(REHYDRATE_EXEMPTION_REASONS.includes(claim.exemption!));
    if (hasConsumer) assert.match(claim.consumer!, /^src\/data\/[a-z_]+\.ts$/);
    assert.ok(claim.why.trim().length > 20, `${claim.kind}: حجّةٌ فارغةٌ مهربٌ لا دعوى`);
  }
});

test('حصرُ الإرجاع: صنفٌ في النطاق بلا صفٍّ في الجدول يُسقط الحاجزَ برمزه', () => {
  const missing: DurableKind = 'ledger_entry';
  const partial: RehydrateClaim[] = REHYDRATE_CLAIMS.filter((c) => c.kind !== missing);
  const report = censusRehydrate(ALL, partial);
  assert.deepEqual(report.unclaimed, [missing], 'الحاجزُ لم يرَ الصنفَ غيرَ المُدَّعى — وهو ما فُتح له البند');
  assert.equal(
    codeOf(() => assertRehydrateCensus(ALL, partial)),
    'PERSISTENCE_REHYDRATE_KIND_UNCLAIMED',
  );
});

test('حصرُ الإرجاع: صنفٌ خارجَ النطاقِ بلا دعوى لا يُسقط شيئًا — النطاقُ تهيئةٌ تضيق وتتّسع', () => {
  const missing: DurableKind = 'ledger_entry';
  const partial = REHYDRATE_CLAIMS.filter((c) => c.kind !== missing);
  const narrow = ALL.filter((k) => k !== missing);
  const report = assertRehydrateCensus(narrow, partial);
  assert.deepEqual(report.unclaimed, []);
  assert.ok(report.outOfScope.includes(missing));
});

test('حصرُ الإرجاع: حرّاسُ الجدولِ نفسِه — صفٌّ بائدٌ ومكرّرٌ وإعفاءٌ مجهول', () => {
  const stale = [...REHYDRATE_CLAIMS, {
    kind: 'kind_that_never_was' as DurableKind, consumer: 'src/data/persistence.ts',
    exemption: null, why: 'صفٌّ لصنفٍ لا وجودَ له في التعداد المغلق',
  }];
  assert.equal(codeOf(() => censusRehydrate(ALL, stale)), 'PERSISTENCE_REHYDRATE_CLAIM_STALE');

  const duplicate = [...REHYDRATE_CLAIMS, REHYDRATE_CLAIMS[0]!];
  assert.equal(codeOf(() => censusRehydrate(ALL, duplicate)), 'PERSISTENCE_REHYDRATE_CLAIM_DUPLICATE');

  const unknown = REHYDRATE_CLAIMS.map((c) => (c.kind === 'journal_compacted'
    ? { ...c, exemption: 'because_we_said_so' as never }
    : c));
  assert.equal(codeOf(() => censusRehydrate(ALL, unknown)), 'PERSISTENCE_REHYDRATE_EXEMPTION_UNKNOWN');
});

/** مهادُ إقلاعٍ بتهيئةٍ منسوخة: النطاقُ يُبدَّل في الملف لا في الشفرة (RULE-005) */
function scene(scope: readonly string[] | null) {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-census-'));
  const config = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  if (scope) {
    const file = join(config, 'persistence.yaml');
    const body = readFileSync(file, 'utf8');
    const head = body.slice(0, body.indexOf('  scope:'));
    const tail = body.slice(body.indexOf('\n# T-123'));
    writeFileSync(file, `${head}  scope:\n${scope.map((k) => `    - ${k}`).join('\n')}\n${tail}`, 'utf8');
  }
  return {
    boot: () => bootstrapState({ configDir: config, now: T0, persistenceDir: join(root, 'state') }),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('الإقلاعُ الحقيقيُّ يمرّ بالحاجز: النطاقُ الكاملُ المعلن مُدَّعًى كلُّه', () => {
  const s = scene(null);
  try {
    const state = s.boot();
    assert.ok(state.journal, 'اليوميّةُ مفتوحةٌ فالحاجزُ نُودي');
    assert.equal(state.journal!.droppedOutOfScope, 0, 'لا إسقاطَ على النطاق الكامل');
  } finally {
    s.clean();
  }
});

test('الإسقاطُ خارجَ النطاقِ يُعَدّ ولا يُرمى: التهيئةُ تحكم والعدّادُ يشهد', () => {
  const narrow = ALL.filter((k) => k !== 'ledger_entry');
  const s = scene(narrow);
  try {
    const state = s.boot();
    const journal = state.journal!;
    assert.equal(journal.covers('ledger_entry'), false, 'الصنفُ خارجَ النطاق بالتهيئة');
    const before = journal.droppedOutOfScope;
    assert.equal(journal.record('ledger_entry', { probe: 1 }, T0), null, 'خارجَ النطاق يعود null ولا يرمي');
    assert.equal(journal.droppedOutOfScope, before + 1, 'الإسقاطُ لم يُعَدّ — وهو الصمتُ الذي فُتح له البند');
    assert.equal(journal.droppedByKind().get('ledger_entry'), 1);
    journal.record('ledger_entry', { probe: 2 }, T0);
    assert.equal(journal.droppedByKind().get('ledger_entry'), 2, 'العدّادُ تراكميٌّ لا لحظيّ');
    (journal.droppedByKind() as Map<DurableKind, number>).set('ledger_entry', 99);
    assert.equal(journal.droppedByKind().get('ledger_entry'), 2, 'القراءةُ نسخةٌ فلا يُصلح الخارجُ عدّادًا');
  } finally {
    s.clean();
  }
});

/**
 * تطفيرُ الحاجزِ الساكن: نسخةٌ من الجذر تُحرَّف فيُطلب من الحاجز أن يسقط.
 * (درسُ W-2026-004: يُحرَّف نسخةٌ لا أصل — ولا حالةَ اختبارٍ تلمس ملفًّا حقيقيًّا.)
 *
 * والحاجزُ يُشغَّل من الحزمةِ المبنيّةِ الحقيقيّةِ ويُوجَّه بـ`SOOL_CHECK_ROOT` إلى النسخة،
 * لأنّه **يقرأ مدخلاتِه من الجذرِ نصًّا ويُحلّلها شجرةَ نحو** لا يستوردها.
 */
function gateRoot(): { root: string; run: () => { code: number; out: string }; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sool-census-gate-'));
  for (const dir of ['config', 'src', 'scripts']) {
    cpSync(join(process.cwd(), dir), join(root, dir), { recursive: true });
  }
  return {
    root,
    run: () => {
      const r = spawnSync('node', [join(process.cwd(), 'dist/scripts/check_rehydrate_census.js')], {
        encoding: 'utf8', env: { ...process.env, SOOL_CHECK_ROOT: root },
      });
      return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

const patch = (root: string, rel: string, from: string, to: string): void => {
  const file = join(root, rel);
  const body = readFileSync(file, 'utf8');
  assert.ok(body.includes(from), `تطفيرٌ لا موضعَ له: ${rel} ⇐ ${from}`);
  writeFileSync(file, body.replace(from, to), 'utf8');
};

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
test('الحاجزُ الساكن: يسقط برموزه على عشرةِ تطفيرات — والاسمُ في تعليقٍ لا يُنجي', () => {
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
