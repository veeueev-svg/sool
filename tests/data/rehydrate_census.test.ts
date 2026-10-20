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
 * مهادُ إقلاعٍ حقيقيٍّ على نسخةٍ مبنيةٍ مطفَّرة (الجولةُ الخامسةُ · عيبُ المراجعِ
 * `BOOT_UNCLAIMED_NOT_DEMONSTRATED_ON_COPIED_CONFIG`): بندُ §4 السابعُ يطلبُ اختبارًا
 * بمهادِ تهيئةٍ منسوخةٍ فيها صنفٌ في النطاقِ بلا دعوى كان الإقلاعُ يمضي صامتًا وصار
 * يسقطُ بالرمز. الجدولُ الحقيقيُّ تامٌّ فلا تُبنى الفجوةُ من التهيئةِ وحدها، فالمهادُ
 * ينسخُ **الحزمةَ المبنيةَ** والتهيئةَ إلى tmpdir ويحذفُ صفَّ `tax_levy` من الجدولِ في
 * **النسخةِ** وحدَها، ثمّ يُقلعُ إقلاعًا حقيقيًّا (`bootstrapState` بعمليةٍ مستقلةٍ) لا
 * حقنًا في الوحدةِ — فالغائبُ المطلوبُ شاهدُ الإقلاعِ لا شاهدُ النداءِ.
 */
function bootScene(): { root: string; run: () => { out: string }; clean: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'sool-rehydrate-boot-'));
  const distSrc = join(root, 'dist-src');
  const config = join(root, 'config');
  cpSync(join(process.cwd(), 'dist/src'), distSrc, { recursive: true });
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  // مجلدُ النشرِ يُعلَنُ صعودًا من موقعِ الوحدةِ لا من التهيئةِ (مصعدُ المجلداتِ المُعلنة)،
  // فالنسخةُ المستقلةُ تحتاجُه بجانبِ الحزمةِ والتهيئة — وإلّا رُفض الإقلاعُ برمزِ المصعدِ
  // قبل بلوغِ الحاجزِ، فيُقاسُ رفضُ المصعدِ لا رفضُ الحاجزِ.
  cpSync(join(process.cwd(), 'deploy'), join(root, 'deploy'), { recursive: true });
  // وجذرُ الدولةِ (نقطةُ التفتيشِ) يُعلَنُ بدليلِ `package.json` صعودًا (ثابت 4 · T-157) —
  // فالنسخةُ المستقلةُ تحتاجُ ملفًّا يحملُ الاسمَ لا محتوى المستودعِ الحقيقيَّ.
  writeFileSync(join(root, 'package.json'), '{}', 'utf8');
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  const bootJs = join(root, 'boot.js');
  writeFileSync(bootJs, [
    `const { bootstrapState } = require(${JSON.stringify(`${distSrc}/index.js`)});`,
    'try {',
    `  bootstrapState({ configDir: ${JSON.stringify(config)}, now: ${T0}, `
      + `persistenceDir: ${JSON.stringify(join(root, 'state'))} });`,
    "  console.log('BOOTED');",
    '} catch (e) {',
    "  console.log('THREW:' + e.constructor.name + ':' + (e.code ?? 'NO_CODE'));",
    '}',
  ].join('\n'), 'utf8');
  return {
    root,
    run: () => {
      const r = spawnSync('node', [bootJs], { encoding: 'utf8' });
      return { out: `${r.stdout}${r.stderr}` };
    },
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('الإقلاعُ الحقيقيُّ يسقطُ بالرمز: صنفٌ في النطاقِ بلا دعوى — مهادٌ منسوخٌ بحذفِ صفٍّ من الجدول', () => {
  const b = bootScene();
  try {
    // الضابطُ أوّلًا: النسخةُ السليمةُ تُقلعُ — فهذا يثبتُ أنّ الحزمةَ المنسوخةَ
    // مستقلةٌ عن جذرِ المستودعِ بعمليةٍ مستقلةٍ، لا أنّ الفشلَ القادمَ من النسخِ نفسِه.
    const control = b.run();
    assert.ok(control.out.includes('BOOTED'), `الضابطُ لم يُقلع — فالنسخةُ غيرُ مستقلة:\n${control.out}`);
    // والفجوةُ معلَنةٌ من الطرفَين: الصنفُ في نطاقِ التهيئةِ المنسوخةِ، وصفُّهُ في الجدولِ
    const yaml = readFileSync(join(b.root, 'config', 'persistence.yaml'), 'utf8');
    assert.match(yaml, /- tax_levy/, 'الصنفُ ليس في نطاقِ التهيئةِ المنسوخةِ');
    const claimsJs = join(b.root, 'dist-src', 'data', 'rehydrate_census.js');
    const table = readFileSync(claimsJs, 'utf8');
    const row = table.split('\n').find((l) => l.includes("kind: 'tax_levy'"));
    assert.ok(row !== undefined, 'صفُّ الدعوى غيرُ موجودٍ في الجدولِ المُجمَّع');
    writeFileSync(claimsJs, table.replace(`${row}\n`, ''), 'utf8');
    // الإقلاعُ الحقيقيُّ: يسقطُ بالرمزِ المُسمّى لا بصمتٍ — والاستثناءُ سياديٌّ لا خطأٌ عامٌّ
    const fell = b.run();
    assert.ok(fell.out.includes('THREW:SovereignViolation:PERSISTENCE_REHYDRATE_KIND_UNCLAIMED'),
      `الإقلاعُ لم يسقط بالرمز:\n${fell.out}`);
    // وشاهدُ «قبلَ أوّلِ إرجاعٍ»: يُعلَّمُ مدخلُ الإرجاعِ الحقيقيُّ في النسخةِ، فلا يُبلغَ —
    // فالسقوطُ قبلَ الفعلِ لا بعده.
    const persistenceJs = join(b.root, 'dist-src', 'data', 'persistence.js');
    const persistence = readFileSync(persistenceJs, 'utf8');
    const entry = 'function rehydrateFromJournal(journal, targets, by = \'ministry:data\', options = {}) {';
    assert.ok(persistence.includes(entry), 'مدخلُ الإرجاعِ غيرُ موجودٍ في النسخةِ');
    writeFileSync(persistenceJs, persistence.replace(entry,
      `${entry}\n    console.log('REACHED_REHYDRATION');`), 'utf8');
    const before = b.run();
    assert.ok(before.out.includes('THREW:SovereignViolation:PERSISTENCE_REHYDRATE_KIND_UNCLAIMED'),
      `الإقلاعُ بعد التعليلِ لم يسقط بالرمز:\n${before.out}`);
    assert.ok(!before.out.includes('REACHED_REHYDRATION'),
      'الإرجاعُ بُلغ قبل سقوط الحاجز — الحكمُ بعد الفعلِ لا يمنعه');
  } finally {
    b.clean();
  }
});

test('الوجهُ السالبُ لاختبارِ الإقلاعِ: بلا حاجزٍ كان الإقلاعُ يمضي صامتًا — فيُكشفُ تجاوزُ العلاج', () => {
  const b = bootScene();
  try {
    const claimsJs = join(b.root, 'dist-src', 'data', 'rehydrate_census.js');
    const table = readFileSync(claimsJs, 'utf8');
    const row = table.split('\n').find((l) => l.includes("kind: 'tax_levy'"));
    assert.ok(row !== undefined, 'صفُّ الدعوى غيرُ موجودٍ في الجدولِ المُجمَّع');
    writeFileSync(claimsJs, table.replace(`${row}\n`, ''), 'utf8');
    const indexJs = join(b.root, 'dist-src', 'index.js');
    const boot = readFileSync(indexJs, 'utf8');
    const call = '(0, rehydrate_census_1.assertRehydrateCensus)(persistenceConfig.policy.scope);';
    assert.ok(boot.includes(call), 'نداءُ الحاجزِ غيرُ موجودٍ في النسخةِ المُجمَّعة');
    writeFileSync(indexJs, boot.replace(call, 'void 0;'), 'utf8');
    const silent = b.run();
    assert.ok(silent.out.includes('BOOTED'),
      `إزالةُ الحاجزِ لم تُعد الإقلاعَ صامتًا — فالاختبارُ لا يكشفُ تجاوزَ العلاج:\n${silent.out}`);
  } finally {
    b.clean();
  }
});
