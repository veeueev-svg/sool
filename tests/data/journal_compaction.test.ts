/**
 * tests/data/journal_compaction.test.ts — ضغطُ اليوميّة (المرحلة 39، البند T-121)
 * المالك: وزارة البيانات | المدخلات: يوميّاتٌ في مجلدات مؤقتة | المخرجات: قبول أو رفض حتمي
 * التبعيات: src/data/journal_compaction وsrc/data/persistence
 * الصلاحيات: لا تلمس تهيئة الإنتاج ولا تكتب في المستودع
 * حالات الفشل المقيسة: سلسلة محرَّفة، يوميّة فارغة، علامة خارج النطاق، أرشيف مشغول
 * اختبار القبول: tests/data/durable_rehydrate.test.ts (الإقلاع بعد الضغط)
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §31
 * ثوابت هذا الاختبار: 1) التأكيد على الرمز المعلن لا على نصٍّ عربي مشكول؛
 *   2) كل قرص مؤقت؛ 3) الأصل يُفتَّش بعد الضغط: دعوى «لا حذف» تُقاس لا تُصدَّق.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SovereignViolation } from '../../src/kernel/types';
import { StateJournal, JournalPolicy, DurableRecord } from '../../src/data/persistence';
import { compactJournal } from '../../src/data/journal_compaction';

const T0 = 1_700_000_000_000;

function root(): string {
  return mkdtempSync(join(tmpdir(), 'sool-compact-'));
}

function policy(dir: string, over: Partial<JournalPolicy> = {}): JournalPolicy {
  return {
    directory: dir,
    file: 'state.jsonl',
    fsync: true,
    verifyOnBoot: true,
    maxRecords: 1000,
    scope: [
      'audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot',
      'journal_compacted',
    ],
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

/** يوميّة فيها نسخٌ متكررة: سجلٌّ لا يُمسّ، وذاكرةٌ ومعرفةٌ ومشاركةٌ ولقطةٌ تُنسخ */
function seeded(dir: string): StateJournal {
  const journal = new StateJournal(policy(dir));
  journal.record('audit_entry', { entryId: 'a1', at: T0 }, T0);
  journal.record('memory_record', { recordId: 'mem:1', body: 'أوّل' }, T0 + 1);
  journal.record('memory_record', { recordId: 'mem:1', body: 'ثانٍ' }, T0 + 2);
  journal.record('memory_record', { recordId: 'mem:1', body: 'أخير' }, T0 + 3);
  journal.record('memory_record', { recordId: 'mem:2', body: 'وحيد' }, T0 + 4);
  journal.record('memory_share', { recordId: 'mem:1', reader: 'agent:x' }, T0 + 5);
  journal.record('memory_share', { recordId: 'mem:1', reader: 'agent:x' }, T0 + 6);
  journal.record('knowledge_fact', { factId: 'fact:1', claim: 'قديم' }, T0 + 7);
  journal.record('knowledge_fact', { factId: 'fact:1', claim: 'جديد' }, T0 + 8);
  journal.record('archive_snapshot', { version: 1 }, T0 + 9);
  journal.record('archive_snapshot', { version: 2 }, T0 + 10);
  journal.record('audit_entry', { entryId: 'a2', at: T0 + 11 }, T0 + 11);
  return journal;
}

test('الضغط يُسقط المنسوخ ويُبقي الأحدث وكل قيود التدقيق', () => {
  const dir = root();
  const journal = seeded(dir);
  const report = compactJournal(journal, T0 + 100);
  assert.equal(report.before, 12);
  // الباقون: علامة + قيدا تدقيق + mem:1 الأخير + mem:2 + مشاركة واحدة + fact:1 الأخير + لقطة واحدة
  assert.equal(report.after, 8);
  assert.equal(report.droppedSupersededRecords, 5);
  const entries = journal.read();
  assert.equal(entries[0]!.kind, 'journal_compacted');
  const memories = entries.filter((e) => e.kind === 'memory_record');
  assert.deepEqual(memories.map((e) => (e.payload as { body: string }).body), ['أخير', 'وحيد']);
  const facts = entries.filter((e) => e.kind === 'knowledge_fact');
  assert.deepEqual(facts.map((e) => (e.payload as { claim: string }).claim), ['جديد']);
  const snapshots = entries.filter((e) => e.kind === 'archive_snapshot');
  assert.deepEqual(snapshots.map((e) => (e.payload as { version: number }).version), [2]);
  assert.equal(entries.filter((e) => e.kind === 'audit_entry').length, 2);
  assert.equal(entries.filter((e) => e.kind === 'memory_share').length, 1);
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test('اليوميّة المضغوطة سلسلتها صحيحة ويُكتب فوقها قيدٌ جديد بلا انقطاع', () => {
  const dir = root();
  const journal = seeded(dir);
  const report = compactJournal(journal, T0 + 100);
  assert.equal(journal.verify().valid, true);
  assert.equal(journal.length, report.after);
  const appended = journal.record('memory_record', { recordId: 'mem:3', body: 'بعد الضغط' }, T0 + 200);
  assert.equal(appended?.seq, report.after + 1);
  assert.equal(appended?.prevHash, report.head);
  const reopened = new StateJournal(policy(dir));
  assert.equal(reopened.verify().valid, true);
  assert.equal(reopened.read().length, report.after + 1);
  reopened.close();
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test('العلامة تشهد بالطول السابق وبصمة رأسه وموضع الأرشيف، والأصل لم يُحذف', () => {
  const dir = root();
  const journal = seeded(dir);
  const before = journal.read();
  const report = compactJournal(journal, T0 + 100);
  assert.equal(report.previousHead, before[before.length - 1]!.hash);
  assert.equal(existsSync(report.archive), true);
  const archived = readFileSync(report.archive, 'utf8').trim().split('\n');
  assert.equal(archived.length, before.length);
  const marker = journal.read()[0]!;
  assert.deepEqual(marker.payload, {
    previousLength: before.length, previousHead: report.previousHead, archive: report.archive,
  });
  assert.equal(marker.at, T0 + 100);
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test('الحمولات والأزمان تبقى كما كُتبت: الضغط يُسقط ولا يُحرّر', () => {
  const dir = root();
  const journal = seeded(dir);
  const before = journal.read();
  const kept = before.filter((e) => e.kind === 'audit_entry');
  compactJournal(journal, T0 + 100);
  const after = journal.read().filter((e) => e.kind === 'audit_entry');
  assert.deepEqual(after.map((e) => e.payload), kept.map((e) => e.payload));
  assert.deepEqual(after.map((e) => e.at), kept.map((e) => e.at));
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test('يوميّة محرَّفة تُرفض ولا تُضغط، والملف يبقى كما هو', () => {
  const dir = root();
  const journal = seeded(dir);
  journal.close();
  const path = join(dir, 'state.jsonl');
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const tampered = JSON.parse(lines[1]!) as DurableRecord;
  lines[1] = JSON.stringify({ ...tampered, payload: { recordId: 'mem:1', body: 'مدسوس' } });
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  const reopened = new StateJournal(policy(dir, { verifyOnBoot: false }));
  assert.equal(code(() => compactJournal(reopened, T0 + 100)), 'JOURNAL_COMPACTION_TAMPERED');
  assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, lines.length);
  assert.equal(existsSync(`${path}.compacting`), false);
  reopened.close();
  rmSync(dir, { recursive: true, force: true });
});

test('يوميّة فارغة لا تُضغط، وعلامةٌ خارج النطاق تُرفض قبل أي لمس', () => {
  const dir = root();
  const empty = new StateJournal(policy(dir));
  assert.equal(code(() => compactJournal(empty, T0)), 'JOURNAL_COMPACTION_EMPTY');
  empty.close();
  const narrow = new StateJournal(policy(dir, { scope: ['audit_entry'] }));
  narrow.record('audit_entry', { entryId: 'a1' }, T0);
  assert.equal(code(() => compactJournal(narrow, T0)), 'JOURNAL_COMPACTION_KIND_NOT_IN_SCOPE');
  narrow.close();
  rmSync(dir, { recursive: true, force: true });
});

test('موضع أرشيفٍ مشغول يُرفض: أصلٌ لا يُطمس بأصلٍ آخر', () => {
  const dir = root();
  const journal = seeded(dir);
  const entries = journal.read().length;
  writeFileSync(join(dir, `state.jsonl.${entries}.archive`), 'سابق', 'utf8');
  assert.equal(code(() => compactJournal(journal, T0)), 'JOURNAL_COMPACTION_ARCHIVE_EXISTS');
  assert.equal(journal.read().length, entries);
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

test('ضغطٌ ثانٍ يُبقي علامة الأوّل: تاريخ الضغط لا يُمحى بضغطٍ بعده', () => {
  const dir = root();
  const journal = seeded(dir);
  const first = compactJournal(journal, T0 + 100);
  journal.record('memory_record', { recordId: 'mem:2', body: 'مُحدَّث' }, T0 + 150);
  const second = compactJournal(journal, T0 + 200);
  const markers = journal.read().filter((e) => e.kind === 'journal_compacted');
  assert.equal(markers.length, 2);
  // العلامة الجديدة أولًا (ثابت 6)، وعلامة الأول باقيةٌ بعدها لا ممحوّة.
  assert.equal((markers[0]!.payload as { archive: string }).archive, second.archive);
  assert.equal((markers[1]!.payload as { archive: string }).archive, first.archive);
  assert.equal(existsSync(first.archive), true);
  assert.equal(existsSync(second.archive), true);
  assert.equal(journal.verify().valid, true);
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});
