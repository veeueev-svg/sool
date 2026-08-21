/**
 * tests/data/royal_archive.test.ts — اختبار قبول المرحلة 21 (النسخ والاستعادة الكاملة)
 * المالك: وزارة البيانات | يوثّق في: docs/test-reports/phase-21.md
 * شرط القبول المعلن في خارطة الطريق: «استعادة كاملة من نسخة»
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';

const A = 'agent:arc-a';

function seed(s: ReturnType<typeof bootstrapState>): { recordId: string; factId: string } {
  const w = s.memory.write(A, {
    content: 'حقيقة أساسية', provenance: { kind: 'tool_call', ref: 'audit:1' },
    retentionClass: 'official',
  });
  assert.equal(w.ok, true);
  const recordId = w.ok ? w.record.recordId : '';
  const f = s.knowledge.assert('ministry:data', {
    subject: 'مدينة:001', predicate: 'الاسم', object: 'المدينة', sourceRecordId: recordId,
  });
  assert.equal(f.ok, true);
  return { recordId, factId: f.ok ? f.fact.factId : '' };
}

const restoreCmd = (s: ReturnType<typeof bootstrapState>, target = 'snap:0001') =>
  s.king.issueCommand('archive_restore', target, {});

test('النسخة تحمل بصمة محتواها ورأس سلسلة التدقيق وعدد ما فيها', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  assert.equal(snap.contentHash.length, 64);
  assert.notEqual(snap.auditHead, 'genesis');
  assert.equal(snap.counts.memory, 1);
  assert.equal(snap.counts.facts, 1);
  assert.equal(s.archive.verify(snap.snapshotId), true);
});

test('استعادة كاملة: كل ما أُضيف بعد النسخة يزول وكل ما فيها يعود', () => {
  const s = bootstrapState();
  const { recordId, factId } = seed(s);
  const snap = s.archive.snapshot();

  // تغييرات لاحقة: سجل جديد وحقيقة جديدة وشطب للسجل الأصلي
  const extra = s.memory.write(A, {
    content: 'بعد النسخة', provenance: { kind: 'tool_call', ref: 'audit:2' }, retentionClass: 'ephemeral',
  });
  assert.equal(extra.ok, true);
  s.memory.tombstone(recordId, 'ministry:data', 'شطب بعد النسخة');
  assert.equal(s.memory.report().total, 2);

  const decision = s.archive.restore(restoreCmd(s, snap.snapshotId), snap.snapshotId);
  assert.equal(decision.allowed, true, decision.reason);
  assert.equal(s.memory.report().total, 1, 'ما بعد النسخة زال');
  assert.equal(s.memory.read('ministry:data', recordId)?.content, 'حقيقة أساسية', 'الشطب انعكس');
  assert.equal(s.knowledge.get(factId)?.status, 'official');
  assert.equal(s.memory.read('ministry:data', extra.ok ? extra.record.recordId : '') , null);
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'archive_restored'));
});

test('الاستعادة تُجمّد التوالد قبل التبديل', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  assert.equal(s.spawnPolicy.isFrozen, false);
  s.archive.restore(restoreCmd(s, snap.snapshotId), snap.snapshotId);
  assert.equal(s.spawnPolicy.isFrozen, true, 'دولة تُستعاد لا تُنجب في أثناء ذلك');
});

test('لا استعادة بلا أمر ملكي بالفعل الصحيح', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  const wrong = s.king.issueCommand('approve_phase', snap.snapshotId, {});
  const d = s.archive.restore(wrong, snap.snapshotId);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /الفعل/);
});

test('أمر قديم مرفوض من البوابة لا يستعيد شيئًا', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  const stale = s.king.issueCommand('archive_restore', snap.snapshotId, {}, Date.now() - 10 * 60_000);
  const d = s.archive.restore(stale, snap.snapshotId);
  assert.equal(d.allowed, false);
});

test('نسخة مجهولة لا تُستعاد', () => {
  const s = bootstrapState();
  seed(s);
  const d = s.archive.restore(restoreCmd(s, 'snap:9999'), 'snap:9999');
  assert.equal(d.allowed, false);
  assert.match(d.reason, /مجهولة/);
});

test('نسخة محرّفة تُكشف بالبصمة ولا تُستعاد', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  // تحريف مباشر للحمولة المؤرشفة — كما لو تلاعب أحد بالمخزن
  (snap.payload.memory.records[0] as { content: string }).content = 'محتوى مزروع';
  assert.equal(s.archive.verify(snap.snapshotId), false);
  const d = s.archive.restore(restoreCmd(s, snap.snapshotId), snap.snapshotId);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /محرّفة/);
  assert.equal(s.memory.read('ministry:data', s.memory.all()[0]!.recordId)?.content, 'حقيقة أساسية');
});

test('عدة نسخ متعاقبة: الاستعادة إلى نقطة مختارة لا إلى الأحدث', () => {
  const s = bootstrapState();
  seed(s);
  const first = s.archive.snapshot();
  s.memory.write(A, {
    content: 'إضافة', provenance: { kind: 'tool_call', ref: 'audit:3' }, retentionClass: 'ephemeral',
  });
  const second = s.archive.snapshot();
  assert.equal(second.counts.memory, 2);
  const d = s.archive.restore(restoreCmd(s, first.snapshotId), first.snapshotId);
  assert.equal(d.allowed, true);
  assert.equal(s.memory.report().total, 1);
  assert.equal(s.archive.list().length, 2, 'الأرشيف يُضاف إليه ولا يُقلَّم');
});

test('الاستعادة تُسجَّل ولا تكسر سلسلة التدقيق', () => {
  const s = bootstrapState();
  seed(s);
  const snap = s.archive.snapshot();
  s.archive.restore(restoreCmd(s, snap.snapshotId), snap.snapshotId);
  assert.equal(s.audit.verifyIntegrity().valid, true);
  assert.ok(s.audit.find('memory_restored').length >= 1);
  assert.ok(s.audit.find('knowledge_restored').length >= 1);
});

test('المشاركات المعلنة تعود مع النسخة', () => {
  const s = bootstrapState();
  const { recordId } = seed(s);
  s.memory.share(recordId, A, 'agent:arc-b');
  const snap = s.archive.snapshot();
  assert.equal(s.memory.read('agent:arc-b', recordId)?.recordId, recordId);
  s.memory.importAll({ records: [], shares: [], seq: 0 }, 'ministry:data');
  assert.equal(s.memory.report().total, 0);
  s.archive.restore(restoreCmd(s, snap.snapshotId), snap.snapshotId);
  assert.equal(s.memory.read('agent:arc-b', recordId)?.recordId, recordId, 'المشاركة استُعيدت');
});
