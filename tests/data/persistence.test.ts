/**
 * tests/data/persistence.test.ts — اختبارات اليوميّة الدائمة وسياستها (المرحلة 39، البند T-27)
 * المالك: وزارة البيانات | المدخلات: مجلدات مؤقتة وسياسات معلنة | المخرجات: قبول أو رفض حتمي
 * التبعيات: src/data/persistence وsrc/kernel/config/persistence | الصلاحيات: لا تلمس تهيئة الإنتاج
 * السجلات: لا يكتب هذا الملف في سجل التدقيق إلا عبر الوحدات المختبرة
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/data/durable_rehydrate.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md
 * ثوابت هذا الاختبار: 1) لا تأكيد على نصٍّ عربي مشكول بل على الرمز المعلن؛ 2) كل قرص مؤقت.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SovereignViolation } from '../../src/kernel/types';
import { loadPersistence } from '../../src/kernel/config/persistence';
import { StateJournal, JournalPolicy } from '../../src/data/persistence';

const T0 = 1_700_000_000_000;

function root(): string {
  return mkdtempSync(join(tmpdir(), 'sool-journal-'));
}

function policy(dir: string, over: Partial<JournalPolicy> = {}): JournalPolicy {
  return {
    directory: dir,
    file: 'state.jsonl',
    fsync: true,
    verifyOnBoot: true,
    maxRecords: 1000,
    scope: ['audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot'],
    ...over,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof SovereignViolation ? error.code : `غير-سيادي:${String(error)}`;
  }
  return 'لا-رفض';
}

function yaml(dir: string, body: string): string {
  writeFileSync(join(dir, 'persistence.yaml'), body, 'utf8');
  return dir;
}

const SOUND = [
  'policy:',
  '  journal_directory: "/var/lib/sool/state"',
  '  journal_file: "state.jsonl"',
  '  fsync_every_record: true',
  '  verify_chain_on_boot: true',
  '  rebuild_termination_roll: true',
  '  max_journal_records: 500000',
  '  scope:',
  '    - audit_entry',
  '    - memory_record',
  '    - memory_share',
  '    - knowledge_fact',
  '    - archive_snapshot',
  // T-122: أصنافُ أنظمةِ السجل الأربعة تُقرأ كما تُقرأ سابقاتُها بلا استثناءٍ في الشفرة.
  '    - ledger_entry',
  '    - contract_record',
  '    - population_batch',
  '    - population_terminated',
  // T-123: عتبةُ الضغط واحتفاظُ الأرشيفات — كتلتان مُلزمتان لا اختياريّتان.
  'compaction:',
  '  compact_at_records: 100000',
  '  min_interval_ms: 3600000',
  'archives:',
  '  keep_min: 2',
  '  max_age_ms: 2592000000',
  '  require_witness_coverage: true',
  '',
].join('\n');

test('التهيئة المعلنة تُقرأ كما هي بلا افتراض في الشفرة', () => {
  const dir = root();
  try {
    const config = loadPersistence(yaml(dir, SOUND));
    assert.equal(config.policy.journal_file, 'state.jsonl');
    assert.equal(config.policy.max_journal_records, 500_000);
    assert.equal(config.policy.scope.length, 9);
    // T-123: الرقمُ مقروءٌ من الملف لا مُضمَّنٌ في الشفرة (RULE-005)
    assert.equal(config.compaction.compact_at_records, 100_000);
    assert.equal(config.archives.keep_min, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('غياب ملف السياسة رفضٌ مغلق لا صمتٌ بافتراض', () => {
  const dir = root();
  try {
    assert.equal(code(() => loadPersistence(dir)), 'CONFIG_NO_PERSISTENCE_POLICY');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('مسار يوميّة غير مطلق مرفوض', () => {
  const dir = root();
  try {
    const body = SOUND.replace('"/var/lib/sool/state"', '"state"');
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_PATH');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('إبطال المزامنة لكل قيد مرفوض: وعد النجاة لا يُوفى بذاكرة النظام', () => {
  const dir = root();
  try {
    const body = SOUND.replace('fsync_every_record: true', 'fsync_every_record: false');
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_FSYNC_REQUIRED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('إبطال التحقق عند الإقلاع مرفوض', () => {
  const dir = root();
  try {
    const body = SOUND.replace('verify_chain_on_boot: true', 'verify_chain_on_boot: false');
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_VERIFY_REQUIRED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('حدّ قيود غير موجب مرفوض', () => {
  const dir = root();
  try {
    const body = SOUND.replace('max_journal_records: 500000', 'max_journal_records: 0');
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_LIMIT');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('نطاق فارغ مرفوض: يوميّة لا تشمل شيئًا ادّعاءُ ثباتٍ كاذب', () => {
  const dir = root();
  try {
    const body = SOUND.split('  scope:')[0] + '  scope: []\n';
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_SCOPE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('صنف غير معلن في النطاق مرفوض', () => {
  const dir = root();
  try {
    const body = SOUND.replace('    - archive_snapshot', '    - كل_شيء');
    assert.equal(code(() => loadPersistence(yaml(dir, body))), 'CONFIG_PERSISTENCE_SCOPE');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('السياسة المعلنة تُبنى منها يوميّة بمجلد بديل للقياس', () => {
  const dir = root();
  try {
    const config = loadPersistence(yaml(dir, SOUND));
    const journal = StateJournal.fromConfig(config, join(dir, 'يوميّة'));
    try {
      assert.equal(journal.file, join(dir, 'يوميّة', 'state.jsonl'));
      assert.ok(journal.covers('audit_entry'));
    } finally { journal.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('التدوين يُنشئ الملف ويُسلسل البصمات', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    const first = journal.record('audit_entry', { seq: 1 }, T0);
    const second = journal.record('memory_record', { recordId: 'mem:1' }, T0 + 1);
    assert.ok(existsSync(journal.file));
    assert.equal(first?.prevHash, 'genesis');
    assert.equal(second?.prevHash, first?.hash);
    assert.equal(journal.length, 2);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('صنف خارج النطاق لا يُدوَّن أصلًا: التهيئة تحكم لا الشفرة', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir, { scope: ['audit_entry'] }));
  try {
    assert.equal(journal.record('memory_record', { recordId: 'mem:1' }, T0), null);
    assert.equal(journal.covers('memory_record'), false);
    assert.equal(journal.length, 0);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('تجاوز الحدّ المعلن رفضٌ مغلق لا التفافٌ صامت', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir, { maxRecords: 3 }));
  try {
    for (let i = 0; i < 3; i++) journal.record('audit_entry', { i }, T0 + i);
    assert.equal(code(() => journal.record('audit_entry', { i: 3 }, T0 + 3)), 'PERSISTENCE_JOURNAL_FULL');
    assert.equal(journal.length, 3);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('إعادة الفتح تُكمل التسلسل ولا تبدأه من جديد', () => {
  const dir = root();
  try {
    const first = new StateJournal(policy(dir));
    const last = first.record('audit_entry', { n: 1 }, T0);
    first.close();
    const second = new StateJournal(policy(dir));
    try {
      const next = second.record('audit_entry', { n: 2 }, T0 + 1);
      assert.equal(second.length, 2);
      assert.equal(next?.seq, 2);
      assert.equal(next?.prevHash, last?.hash);
      assert.equal(second.read().length, 2);
    } finally { second.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('تحريف حمولة قيد يُكتشف بالبصمة', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    journal.record('audit_entry', { n: 1 }, T0);
    journal.record('audit_entry', { n: 2 }, T0 + 1);
    journal.close();
    const raw = readFileSync(journal.file, 'utf8');
    writeFileSync(journal.file, raw.replace('"n":2', '"n":9'), 'utf8');
    assert.equal(code(() => journal.read()), 'PERSISTENCE_JOURNAL_TAMPERED');
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('التحقق يعلن موضع الانكسار لا مجرد الرفض', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    for (let i = 1; i <= 3; i++) journal.record('audit_entry', { n: i }, T0 + i);
    journal.close();
    const raw = readFileSync(journal.file, 'utf8');
    writeFileSync(journal.file, raw.replace('"n":2', '"n":8'), 'utf8');
    const verdict = journal.verify();
    assert.equal(verdict.valid, false);
    assert.equal(verdict.brokenAt, 2);
    assert.equal(verdict.reason, 'PERSISTENCE_JOURNAL_TAMPERED');
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('حذف سطر من الوسط يُكتشف لا يُبتلع', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    for (let i = 1; i <= 3; i++) journal.record('audit_entry', { n: i }, T0 + i);
    journal.close();
    const lines = readFileSync(journal.file, 'utf8').split('\n').filter((l) => l.trim() !== '');
    writeFileSync(journal.file, `${[lines[0], lines[2]].join('\n')}\n`, 'utf8');
    assert.equal(code(() => journal.read()), 'PERSISTENCE_JOURNAL_TAMPERED');
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('سطر غير قابل للتحليل رفضٌ بصنفه المعلن', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    journal.record('audit_entry', { n: 1 }, T0);
    journal.close();
    writeFileSync(journal.file, `${readFileSync(journal.file, 'utf8')}{ليس جيسون\n`, 'utf8');
    assert.equal(code(() => journal.read()), 'PERSISTENCE_JOURNAL_CORRUPT');
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('يوميّة سليمة تُقرأ بترتيب الكتابة نفسه', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    journal.record('memory_record', { recordId: 'mem:1' }, T0);
    journal.record('knowledge_fact', { factId: 'fact:1' }, T0 + 1);
    journal.record('memory_share', { recordId: 'mem:1', reader: 'agent:x' }, T0 + 2);
    const read = journal.read();
    assert.deepEqual(read.map((r) => r.kind), ['memory_record', 'knowledge_fact', 'memory_share']);
    assert.equal(journal.verify().valid, true);
    assert.equal(journal.verify().length, 3);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('اليوميّة الغائبة تُقرأ فارغة ولا تُخترع', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    assert.equal(journal.read().length, 0);
    assert.equal(journal.verify().valid, true);
    assert.equal(journal.length, 0);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('فتح يوميّة محرَّفة يرفض الإقلاع من أول لحظة', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    journal.record('audit_entry', { n: 1 }, T0);
    journal.record('audit_entry', { n: 2 }, T0 + 1);
    journal.close();
    const raw = readFileSync(journal.file, 'utf8');
    writeFileSync(journal.file, raw.replace('"n":1', '"n":7'), 'utf8');
    assert.equal(code(() => new StateJournal(policy(dir))), 'PERSISTENCE_JOURNAL_TAMPERED');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('الإغلاق المتكرر لا يرفع ولا يفقد قيدًا', () => {
  const dir = root();
  const journal = new StateJournal(policy(dir));
  try {
    journal.record('audit_entry', { n: 1 }, T0);
    journal.close();
    journal.close();
    journal.record('audit_entry', { n: 2 }, T0 + 1);
    assert.equal(journal.read().length, 2);
  } finally { journal.close(); rmSync(dir, { recursive: true, force: true }); }
});

/**
 * دفترُ الإسقاطِ الدائم — العيبُ الذي أوجبه رفعته المراجعةُ المستقلّةُ في جولتها الثانية
 * (`DROP_SIGNAL_VOLATILE_BEFORE_SUPERVISION` · `JOURNAL_DROP_PROBE_NEVER_TICKS_ON_BOOTSTRAP`):
 * كان العدُّ في الذاكرةِ وحدَها، فإن مات المسارُ قبل أن يقرأه ماسحٌ — والمراقبةُ المستمرّةُ
 * **مبنيّةٌ لا مُشغَّلة** — ضاعت الخسارةُ بلا أثر. والقياسُ هنا: عمليّةٌ ثانيةٌ تقرأ رقمَ الأولى.
 */
test('عدّادُ الإسقاطِ ينجو من موتِ العملية: يوميّةٌ ثانيةٌ تقرأ ما أسقطته الأولى', () => {
  const dir = root();
  try {
    const first = new StateJournal(policy(dir));
    assert.equal(first.record('ledger_entry', { a: 1 }, T0), null, 'خارجُ النطاقِ لا يُدوَّن');
    assert.equal(first.record('ledger_entry', { a: 2 }, T0 + 1), null);
    assert.equal(first.droppedOutOfScope, 2, 'العدُّ في العمليةِ الأولى');
    assert.ok(existsSync(first.dropLedgerFile), 'الدفترُ مُثبَتٌ على القُرصِ لا في الذاكرة');
    // وسيطٌ جديدٌ تمامًا: لا حالةَ مشتركةً بينه وبين الأول إلا الملفّ
    const second = new StateJournal(policy(dir));
    assert.equal(second.droppedOutOfScope, 2, 'الرقمُ نجا: عمليةٌ ثانيةٌ تقرأ خسارةَ الأولى');
    assert.equal(second.droppedByKind().get('ledger_entry'), 2, 'والتفصيلُ بحسبِ الصنفِ نجا معه');
    second.record('ledger_entry', { a: 3 }, T0 + 2);
    assert.equal(new StateJournal(policy(dir)).droppedOutOfScope, 3, 'العدُّ تراكميٌّ عبرَ الإقلاعات');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('دفترُ إسقاطٍ فاسدٌ يُرفَض برمزه: رقمٌ يُقرأ خطأً أسوأُ من رقمٍ لا يُقرأ', () => {
  const dir = root();
  try {
    const j = new StateJournal(policy(dir));
    const ledger = j.dropLedgerFile;
    j.record('ledger_entry', { a: 1 }, T0);
    writeFileSync(ledger, '{ليست جيسون', 'utf8');
    assert.equal(
      code(() => new StateJournal(policy(dir))),
      'PERSISTENCE_DROP_COUNTER_UNREADABLE',
      'ملفٌّ لا يُحلَّل يُرفَض لا يُبلَع',
    );
    writeFileSync(ledger, '["ledger_entry", 2]', 'utf8');
    assert.equal(
      code(() => new StateJournal(policy(dir))),
      'PERSISTENCE_DROP_COUNTER_MALFORMED',
      'صيغةٌ غير معلنةٍ — مصفوفةٌ لا سجلّ',
    );
    writeFileSync(ledger, '{"ledger_entry":"2"}', 'utf8');
    assert.equal(
      code(() => new StateJournal(policy(dir))),
      'PERSISTENCE_DROP_COUNTER_MALFORMED',
      'قيمةٌ غير عدديّة',
    );
    writeFileSync(ledger, '{"ledger_entry":-1}', 'utf8');
    assert.equal(
      code(() => new StateJournal(policy(dir))),
      'PERSISTENCE_DROP_COUNTER_MALFORMED',
      'عدٌّ سالبٌ: العدُّ يزيد ولا ينقص',
    );
    writeFileSync(ledger, '{"ledger_entry":2}', 'utf8');
    assert.equal(new StateJournal(policy(dir)).droppedOutOfScope, 2, 'والسليمُ يُقرأ');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
