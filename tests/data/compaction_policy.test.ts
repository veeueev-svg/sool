/**
 * tests/data/compaction_policy.test.ts — عتبةُ الضغط واحتفاظُ الأرشيفات (المرحلة 39، البند T-123)
 * المالك: وزارة البيانات | المدخلات: مجلدات مؤقتة ويوميّاتٌ مصنوعة | المخرجات: قبول أو رفض حتمي
 * التبعيات: src/data/compaction_policy وsrc/data/journal_compaction | الصلاحيات: لا تلمس تهيئة الإنتاج
 * السجلات: لا يكتب هذا الملف في سجل التدقيق إلا عبر الوحدات المختبرة
 * حالات الفشل: كل مهاد ينظف مجلده في tmpdir ولا يكتب في المستودع
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/data/journal_compaction.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md
 * ثوابت هذا الاختبار: 1) التأكيد على الرمز المعلن لا على النص العربي؛ 2) كل قرص مؤقت.
 */
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SovereignViolation } from '../../src/kernel/types';
import { StateJournal, JournalPolicy } from '../../src/data/persistence';
import { compactJournal, durableIdentity } from '../../src/data/journal_compaction';
import {
  lastCompactionAt, pruneArchives, shouldCompact,
} from '../../src/data/compaction_policy';
import type {
  ArchiveRetentionConfig, CompactionPolicyConfig,
} from '../../src/kernel/config/persistence';

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

function root(): string {
  return mkdtempSync(join(tmpdir(), 'sool-retention-'));
}

function policy(dir: string, over: Partial<JournalPolicy> = {}): JournalPolicy {
  return {
    directory: dir,
    file: 'state.jsonl',
    fsync: false,
    verifyOnBoot: true,
    maxRecords: 1000,
    scope: [
      'audit_entry', 'memory_record', 'ledger_entry', 'population_batch', 'journal_compacted',
    ],
    ...over,
  };
}

const COMPACTION: CompactionPolicyConfig = { compact_at_records: 10, min_interval_ms: HOUR };
const RETENTION: ArchiveRetentionConfig = {
  keep_min: 1, max_age_ms: HOUR, require_witness_coverage: true,
};

/** أقدمُ أرشيفٍ بتسلسله — يُكتشف من المجلد فلا يُثبَّت اسمٌ في الاختبار */
function oldestArchive(dir: string): string {
  const names = readdirSync(dir).filter((name) => name.endsWith('.archive'))
    .sort((left, right) => Number(left.split('.')[2]) - Number(right.split('.')[2]));
  assert.ok(names.length > 0, 'لا أرشيف — والضغط يُنشئه بحكم ثابت 3');
  return join(dir, names[0]!);
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof SovereignViolation ? error.code : `غير-سيادي:${String(error)}`;
  }
  return 'لا-رفض';
}

// ═══ 1) العتبة: رقمٌ من التهيئة لا من الشفرة ═══

test('دون العتبة المعلنة لا ضغط، والسبب مقروءٌ لا صامت', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 5; i++) journal.record('memory_record', { recordId: `m${i}` }, T0 + i);
    const verdict = shouldCompact(journal, COMPACTION, T0 + HOUR * 10);
    assert.equal(verdict.compact, false);
    assert.equal(verdict.records, 5);
    assert.equal(verdict.threshold, 10);
    assert.equal(verdict.lastCompactedAt, null);
    assert.ok(verdict.reason.length > 0);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('بلوغ العتبة في يوميّةٍ لم تُضغط قطّ: ضغطٌ بسببٍ معلن', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 12; i++) journal.record('memory_record', { recordId: `m${i}` }, T0 + i);
    const verdict = shouldCompact(journal, COMPACTION, T0 + HOUR);
    assert.equal(verdict.compact, true);
    assert.equal(verdict.sinceMs, null);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('العتبة مبلوغة والفاصل دون الأدنى: لا ضغط — الحماية لا تُحوَّل استنزافًا', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 12; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 100);
    for (let i = 0; i < 12; i++) journal.record('memory_record', { recordId: `n${i}` }, T0 + 200 + i);
    // الفاصل دقيقةٌ واحدة والأدنى ساعة ⇒ رأيٌ بالمنع معلَّلٌ لا صمت
    const verdict = shouldCompact(journal, COMPACTION, T0 + 60_000);
    assert.equal(verdict.compact, false);
    assert.equal(verdict.lastCompactedAt, T0 + 100);
    assert.ok(verdict.sinceMs !== null && verdict.sinceMs < HOUR);
    // وبعد انقضاء الفاصل يعود الرأيُ بالضغط
    assert.equal(shouldCompact(journal, COMPACTION, T0 + HOUR * 2).compact, true);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('زمنُ آخر ضغطٍ يُقرأ من الملف نفسه: إقلاعٌ جديد لا يُصفّر السياسة', () => {
  const dir = root();
  try {
    const first = new StateJournal(policy(dir));
    for (let i = 0; i < 12; i++) first.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(first, T0 + 500);
    first.close();
    // عمليةٌ ثانية لا تعرف شيئًا عن الأولى — ومع ذلك تعرف زمنَ الضغط
    const second = new StateJournal(policy(dir));
    assert.equal(lastCompactionAt(second.read()), T0 + 500);
    second.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══ 2) الاحتفاظ: لا محو بلا برهانِ بقاءِ الشاهد ═══

test('أحدثُ keep_min أرشيفاتٍ لا تُمسّ ولو قدُمت', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    const report = pruneArchives(journal, RETENTION, T0 + HOUR * 1000);
    assert.equal(report.examined, 1);
    assert.equal(report.pruned.length, 0);
    assert.equal(report.kept.length, 1);
    assert.ok(report.decisions[0]!.reason.includes('أحدث'));
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('أرشيفٌ فيه قيدُ تدقيقٍ لا شاهدَ له في اليوميّة يبقى — والعجزُ عن البرهان ليس إذنًا', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    // قيدُ تدقيقٍ لا هويّةَ له: الضغطُ يُبقيه (ثابت 2 هناك) فيبقى شاهدُه — نُزيّف الحالة
    // بأرشيفٍ مصنوعٍ فيه قيدٌ ليس في اليوميّة، فيلزم الإبقاء.
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    compactJournal(journal, T0 + 20);
    const older = oldestArchive(dir);
    writeFileSync(older, `${JSON.stringify({
      seq: 1, at: T0, kind: 'audit_entry', payload: { actor: 'ghost' }, prevHash: 'x', hash: 'y',
    })}\n`, 'utf8');
    // العمرُ يُقاس بزمن التعديل الحقيقي للملف لا بزمن الاختبار الرمزي T0.
    const report = pruneArchives(journal, RETENTION, Date.now() + HOUR * 10);
    assert.equal(report.pruned.length, 0);
    assert.ok(report.decisions.some((decision) => decision.reason.includes('بلا شاهد')));
    assert.ok(existsSync(older), 'الأرشيف الذي لم يُبرهن على تغطيته يبقى');
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('أرشيفٌ كلُّ قيوده مُغطّاة وعمرُه فوق الحدّ: يُمحى ويُعلن سببُ محوه', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    // هويّةٌ واحدة تتكرّر: الأحدثُ باقٍ في اليوميّة، فكلُّ منسوخٍ في الأرشيف مُغطّى.
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + 20 + i);
    compactJournal(journal, T0 + 40);
    const older = oldestArchive(dir);
    const report = pruneArchives(journal, RETENTION, Date.now() + HOUR * 10);
    assert.equal(report.pruned.length, 1);
    assert.equal(existsSync(older), false);
    assert.ok(report.reclaimedBytes > 0);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('أرشيفٌ حديثٌ لا يُمحى ولو غُطّي: الحدُّ الزمني شرطٌ لا زينة', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + 20 + i);
    compactJournal(journal, T0 + 40);
    const report = pruneArchives(journal, RETENTION, Date.now());
    assert.equal(report.pruned.length, 0);
    assert.ok(report.decisions.some((decision) => decision.reason.includes('عمره')));
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('سياسةٌ تُعطّل حرسَ الشاهد مرفوضة رفضًا مغلقًا', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    journal.record('memory_record', { recordId: 'm' }, T0);
    const bad = { ...RETENTION, require_witness_coverage: false } as ArchiveRetentionConfig;
    assert.equal(code(() => pruneArchives(journal, bad, T0)), 'ARCHIVE_RETENTION_GUARD_DISABLED');
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('أرشيفٌ لا يُقرأ سطرُه يبقى: التلفُ ليس إذنًا بالمحو', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + 20 + i);
    compactJournal(journal, T0 + 40);
    const older = oldestArchive(dir);
    writeFileSync(older, 'ليس سطرًا مفسَّرًا\n', 'utf8');
    const report = pruneArchives(journal, RETENTION, Date.now() + HOUR * 10);
    assert.equal(report.pruned.length, 0);
    assert.ok(existsSync(older));
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ═══ 3) هويّةٌ مُصدَّرة: تعريفٌ واحد في الموضعين ═══

test('durableIdentity مُصدَّرة ومطابقةٌ لما يعتمده الضغط', () => {
  assert.equal(durableIdentity({
    seq: 1, at: T0, kind: 'memory_record', payload: { recordId: 'm1' }, prevHash: 'a', hash: 'b',
  }), 'memory_record:m1');
  assert.equal(durableIdentity({
    seq: 2, at: T0, kind: 'audit_entry', payload: { actor: 'x' }, prevHash: 'a', hash: 'b',
  }), null, 'قيدُ التدقيق لا هويّة له فلا يُسقَط');
  assert.equal(durableIdentity({
    seq: 3, at: T0, kind: 'contract_record', payload: { contractId: 'c1' }, prevHash: 'a', hash: 'b',
  }), 'contract:c1', 'العقدُ حالةٌ تُحدَّث فأحدثُه يُغني عمّا قبله');
  assert.equal(durableIdentity({
    seq: 4, at: T0, kind: 'ledger_entry', payload: { op: 'entry' }, prevHash: 'a', hash: 'b',
  }), null, 'قيدُ الدفتر تاريخٌ لا حالة فلا يُسقَط');
  assert.equal(durableIdentity({
    seq: 5, at: T0, kind: 'population_batch', payload: { count: 2 }, prevHash: 'a', hash: 'b',
  }), null, 'الدفعةُ حدثٌ لا حالة فلا تُسقَط');
});

test('الضغطُ لا يُسقط قيدَ الدفتر ولا دفعةَ السكان: التاريخُ لا يُضغط', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    journal.record('ledger_entry', { op: 'entry', entry: { entryId: 'e1' } }, T0);
    journal.record('ledger_entry', { op: 'entry', entry: { entryId: 'e2' } }, T0 + 1);
    journal.record('population_batch', { at: T0, count: 1, identities: [] }, T0 + 2);
    journal.record('population_batch', { at: T0 + 3, count: 1, identities: [] }, T0 + 3);
    journal.record('memory_record', { recordId: 'same' }, T0 + 4);
    journal.record('memory_record', { recordId: 'same' }, T0 + 5);
    const report = compactJournal(journal, T0 + 10);
    assert.equal(report.droppedSupersededRecords, 1, 'المنسوخُ الوحيد هو قيدُ الذاكرة المكرَّر');
    const kinds = journal.read().map((entry) => entry.kind);
    assert.equal(kinds.filter((kind) => kind === 'ledger_entry').length, 2);
    assert.equal(kinds.filter((kind) => kind === 'population_batch').length, 2);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('محوُ الأرشيف لا يلمس ملفَ اليوميّة القائمة', () => {
  const dir = root();
  try {
    const journal = new StateJournal(policy(dir));
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + i);
    compactJournal(journal, T0 + 10);
    for (let i = 0; i < 4; i++) journal.record('memory_record', { recordId: 'same' }, T0 + 20 + i);
    compactJournal(journal, T0 + 40);
    const before = readFileSync(journal.file, 'utf8');
    pruneArchives(journal, RETENTION, Date.now() + HOUR * 10);
    assert.equal(readFileSync(journal.file, 'utf8'), before);
    assert.equal(journal.verify().valid, true);
    journal.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
