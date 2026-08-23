/**
 * tests/data/durable_rehydrate.test.ts — اختبار قبول الثبات العام (المرحلة 39، البندان T-27 وT-99)
 * المالك: وزارة البيانات | المدخلات: دولتان تتعاقبان على مجلد يوميّة واحد | المخرجات: حالة تنجو أو رفض
 * التبعيات: bootstrapState ومجلدات tmpdir | الصلاحيات: الكتابة عبر الواجهات العامة وحدها
 * السجلات: state_rehydrated وstate_rehydrate_empty وtermination_roll_rebuilt
 * حالات الفشل: كل مهاد ينظف مجلده؛ ولا تُكتب تهيئة الإنتاج ولا مجلداتها
 * اختبارات الوحدة: tests/data/persistence.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md
 * ثوابت هذا الاختبار:
 *   1) لا كتابة بالحقول الخاصة: كل بذرةٍ تمر بواجهةٍ عامة كما يمر بها المشغّل.
 *   2) الإقلاع الثاني دولةٌ جديدة بالكامل — لا مشاركة كائنٍ واحد بين الإقلاعين.
 *   3) التأكيد على الرموز المعلنة لا على النصوص العربية المشكولة.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, compactJournal } from '../../src/index';
import { SovereignViolation } from '../../src/kernel/types';

const T0 = 1_700_000_000_000;
const OWNER = 'agent:durable-1';

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-durable-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return {
    root,
    boot: (now = T0) => bootstrapState({ configDir: config, now, persistenceDir: state }),
    bootBare: (now = T0) => bootstrapState({ configDir: config, now }),
    journalFile: join(state, 'state.jsonl'),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** بذرة تمر بالواجهات العامة: ذاكرة رسمية ثم حقيقة مستندة إليها ثم قيد إنهاء */
function seed(s: ReturnType<ReturnType<typeof scene>['boot']>, now = T0) {
  const written = s.memory.write(OWNER, {
    content: 'جوهر ينجو من إعادة التشغيل',
    provenance: { kind: 'tool_call', ref: 'durable:1' },
    retentionClass: 'official',
  }, now);
  if (!written.ok) throw new Error('SEED_MEMORY');
  const fact = s.knowledge.assert('ministry:data', {
    subject: 'durable:state', predicate: 'ينجو', object: 'نعم',
    sourceRecordId: written.record.recordId,
  }, now);
  if (!fact.ok) throw new Error('SEED_FACT');
  s.terminationRoll.record('agent:منتهٍ-1', 'authority:crown_guard', 'إنهاء معلن', now);
  return { recordId: written.record.recordId, factId: fact.fact.factId };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof SovereignViolation ? error.code : `غير-سيادي:${String(error)}`;
  }
  return 'لا-رفض';
}

test('بلا مجلد معلن لا يوميّة ولا إرجاع: سلوك المراحل السابقة حرفًا بحرف', () => {
  const sc = scene();
  try {
    const s = sc.bootBare();
    assert.equal(s.journal, null);
    assert.equal(s.rehydrated, null);
    assert.equal(s.audit.find('state_rehydrated').length, 0);
    assert.equal(s.audit.find('state_rehydrate_empty').length, 0);
    assert.equal(s.audit.verifyIntegrity().valid, true);
  } finally { sc.clean(); }
});

test('السياسة تُقرأ دائمًا حتى بلا مجلد: النطاق معلن لا مخترع', () => {
  const sc = scene();
  try {
    const s = sc.bootBare();
    assert.equal(s.persistenceConfig.policy.journal_file, 'state.jsonl');
    assert.ok(s.persistenceConfig.policy.scope.includes('audit_entry'));
  } finally { sc.clean(); }
});

test('الإقلاع الأول يزرع السلسلة كاملة ولا يدّعي استعادة', () => {
  const sc = scene();
  try {
    const s = sc.boot();
    assert.equal(s.rehydrated?.restored, false);
    assert.equal(s.audit.find('state_rehydrate_empty').length, 1);
    assert.ok((s.journal?.length ?? 0) > 0);
    assert.equal(s.journal?.verify().valid, true);
  } finally { sc.clean(); }
});

test('الإقلاع الثاني يستعيد الذاكرة بمحتواها لا بعددها فقط', () => {
  const sc = scene();
  try {
    const ids = seed(sc.boot());
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.rehydrated?.restored, true);
    const record = s2.memory.read(OWNER, ids.recordId);
    assert.equal(record?.content, 'جوهر ينجو من إعادة التشغيل');
    assert.equal(record?.retentionClass, 'official');
  } finally { sc.clean(); }
});

test('الإقلاع الثاني يستعيد المعرفة بهويّة الحقيقة نفسها', () => {
  const sc = scene();
  try {
    const ids = seed(sc.boot());
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.knowledge.all().length, 1);
    assert.equal(s2.knowledge.get(ids.factId)?.object, 'نعم');
  } finally { sc.clean(); }
});

test('الإقلاع الثاني يستعيد سلسلة السجل سليمةً لا مقطوعة', () => {
  const sc = scene();
  try {
    const before = sc.boot();
    const size = before.audit.snapshot().length;
    seed(before);
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.audit.verifyIntegrity().valid, true);
    assert.ok(s2.audit.snapshot().length > size);
    assert.equal(s2.audit.find('state_rehydrated').length, 1);
  } finally { sc.clean(); }
});

test('سجل المنتهين يُعاد بناؤه من السلسلة لا من حمولة منقولة (T-99)', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.terminationRoll.isTerminated('agent:منتهٍ-1'), true);
    assert.equal(s2.audit.find('termination_roll_rebuilt').length, 1);
    assert.equal(s2.rehydrated?.terminations, 1);
  } finally { sc.clean(); }
});

test('الإقلاع الثالث يبقى سليمًا: الاستعادة لا تُفسد التسلسل المدوَّن', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s2 = sc.boot(T0 + 1000);
    s2.memory.write(OWNER, {
      content: 'قيد بعد الاستعادة',
      provenance: { kind: 'tool_call', ref: 'durable:2' },
      retentionClass: 'official',
    }, T0 + 1100);
    const s3 = sc.boot(T0 + 2000);
    assert.equal(s3.audit.verifyIntegrity().valid, true);
    assert.equal(s3.journal?.verify().valid, true);
    assert.equal(s3.memory.all().length, 2);
  } finally { sc.clean(); }
});

test('المحو يبقى محوًا بعد إعادة التشغيل: القيد اللاحق يعلو سابقه', () => {
  const sc = scene();
  try {
    const s1 = sc.boot();
    const ids = seed(s1);
    assert.equal(s1.memory.tombstone(ids.recordId, 'ministry:data', 'طلب محو', T0 + 5), true);
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.memory.read(OWNER, ids.recordId)?.tombstoned, true);
    assert.equal(s2.memory.report().tombstoned, 1);
  } finally { sc.clean(); }
});

test('المشاركة تنجو: قارئ مُصرَّح له يبقى مُصرَّحًا بعد الإقلاع', () => {
  const sc = scene();
  try {
    const s1 = sc.boot();
    const ids = seed(s1);
    assert.equal(s1.memory.share(ids.recordId, OWNER, 'agent:قارئ-1'), true);
    const s2 = sc.boot(T0 + 1000);
    assert.ok(s2.memory.read('agent:قارئ-1', ids.recordId));
    assert.ok((s2.rehydrated?.memoryShares ?? 0) >= 1);
  } finally { sc.clean(); }
});

test('تقرير الإرجاع يطابق ما في اليوميّة عددًا لا تقديرًا', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.rehydrated?.memoryRecords, 1);
    assert.equal(s2.rehydrated?.facts, 1);
    assert.equal(s2.rehydrated?.records, s2.rehydrated?.auditEntries
      + (s2.rehydrated?.memoryRecords ?? 0) + (s2.rehydrated?.facts ?? 0));
  } finally { sc.clean(); }
});

test('يوميّة محرَّفة توقف الإقلاع ولا تُبني دولةً على كذب', () => {
  const sc = scene();
  try {
    seed(sc.boot());
    const raw = readFileSync(sc.journalFile, 'utf8');
    writeFileSync(sc.journalFile, raw.replace('جوهر ينجو من إعادة التشغيل', 'جوهر مبدَّل بيدٍ خفيّة'), 'utf8');
    assert.equal(code(() => sc.boot(T0 + 1000)), 'PERSISTENCE_JOURNAL_TAMPERED');
  } finally { sc.clean(); }
});

test('الدولة تُقلع من يوميّةٍ مضغوطة كما تُقلع من أصلها (T-121)', () => {
  const sc = scene();
  try {
    const s1 = sc.boot();
    const ids = seed(s1);
    // سجلٌّ يُكتب ثم يُشطب: قيدان بالهويّة نفسها في اليوميّة، والأخير يعلو سابقه —
    // وهذا بالضبط ما يُسقطه الضغط، فيُقاس المكسب على قيدٍ منسوخ حقيقي لا على ظنّ.
    const doomed = s1.memory.write(OWNER, {
      content: 'محتوى سيُشطب', provenance: { kind: 'tool_call', ref: 'durable:2' },
      retentionClass: 'official',
    }, T0 + 5);
    assert.equal(doomed.ok, true);
    if (!doomed.ok) throw new Error('SEED_DOOMED');
    assert.equal(
      s1.memory.tombstone(doomed.record.recordId, 'authority:audit_bureau', 'سبب معلن', T0 + 6),
      true,
    );
    // مشاركةٌ مكررة لقارئٍ واحد: قيدٌ ثانٍ لا يضيف حقًّا، فيُسقطه الضغط أيضًا.
    assert.equal(s1.memory.share(doomed.record.recordId, OWNER, 'agent:قارئ-1'), true);
    s1.memory.share(doomed.record.recordId, OWNER, 'agent:قارئ-1');
    const journal = s1.journal;
    assert.notEqual(journal, null);
    const before = journal!.read().length;
    const report = compactJournal(journal!, T0 + 20);
    assert.equal(report.before, before);
    assert.equal(report.after < before, true);
    assert.equal(existsSync(report.archive), true);
    journal!.close();

    const s2 = sc.boot(T0 + 1000);
    assert.equal(s2.rehydrated?.restored, true);
    // ما بعد الضغط هو نفسه ما قبله في الجوهر: السجل والذاكرة والمعرفة والمنتهون.
    assert.equal(s2.memory.read(OWNER, ids.recordId)?.content, 'جوهر ينجو من إعادة التشغيل');
    assert.equal(s2.knowledge.get(ids.factId)?.object, 'نعم');
    assert.equal(s2.audit.verifyIntegrity().valid, true);
    assert.equal(s2.terminationRoll.isTerminated('agent:منتهٍ-1'), true);
    assert.equal(s2.journal?.verify().valid, true);
  } finally { sc.clean(); }
});
