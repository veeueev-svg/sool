/**
 * tests/data/agent_memory.test.ts — اختبار قبول المرحلة 21 (ذاكرة الوكلاء والنسب)
 * المالك: وزارة البيانات | يوثّق في: docs/test-reports/phase-21.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemory, bootstrapState } from '../../src/index';

const A = 'agent:mem-a';
const B = 'agent:mem-b';
const REF = { kind: 'tool_call' as const, ref: 'audit:abc123' };

function good(over: Record<string, unknown> = {}) {
  return { content: 'قيمة مقاسة: 42', provenance: REF, retentionClass: 'operational', ...over };
}

test('كتابة بنسب معلن تُقبل وتُبصم وتُسجَّل', () => {
  const s = bootstrapState();
  const r = s.memory.write(A, good());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.record.trust, 'trusted');
  assert.equal(r.record.version, 1);
  assert.equal(r.record.contentHash.length, 64, 'لكل سجل بصمة محتوى');
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'memory_written'));
});

test('لا ذاكرة بلا نسب: مرجع فارغ يُرفض', () => {
  const s = bootstrapState();
  const r = s.memory.write(A, good({ provenance: { kind: 'tool_call', ref: '  ' } }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /نسب/);
});

test('صنف احتفاظ مجهول يُرفض عند الكتابة لا لاحقًا', () => {
  const s = bootstrapState();
  const r = s.memory.write(A, good({ retentionClass: 'forever' }));
  assert.equal(r.ok, false);
});

test('محتوى فارغ يُرفض', () => {
  const s = bootstrapState();
  assert.equal(s.memory.write(A, good({ content: '   ' })).ok, false);
});

test('ما جاء من استيراد أو من وكيل آخر يُوسم غير موثوق تلقائيًا', () => {
  const s = bootstrapState();
  const imported = s.memory.write(A, good({ provenance: { kind: 'import', ref: 'sha256:zz' } }));
  const fromPeer = s.memory.write(A, good({ provenance: { kind: 'agent_message', ref: B } }));
  assert.equal(imported.ok && imported.record.trust, 'untrusted');
  assert.equal(fromPeer.ok && fromPeer.record.trust, 'untrusted');
});

test('التصحيح إصدار جديد يشير إلى سابقه ولا يُعدّله', () => {
  const s = bootstrapState();
  const first = s.memory.write(A, good());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = s.memory.revise(first.record.recordId, 'قيمة مصحّحة: 43', A);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.record.version, 2);
  assert.equal(second.record.supersedes, first.record.recordId);
  assert.equal(s.memory.read(A, first.record.recordId)?.content, 'قيمة مقاسة: 42', 'السابق لم يُمسّ');
  assert.equal(s.memory.lineage(second.record.recordId).length, 2);
});

test('التصحيح لا يرقّي الثقة', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good({ provenance: { kind: 'import', ref: 'sha256:x' } }));
  assert.equal(w.ok, true);
  if (!w.ok) return;
  const r = s.memory.revise(w.record.recordId, 'إعادة صياغة', A);
  assert.equal(r.ok && r.record.trust, 'untrusted');
});

test('لا تصحيح لذاكرة وكيل آخر', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  assert.equal(s.memory.revise(w.record.recordId, 'تدخّل', B).ok, false);
});

test('عزل الذاكرة: وكيل لا يقرأ ذاكرة غيره إلا بمشاركة معلنة', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  assert.equal(s.memory.read(B, w.record.recordId), null, 'القراءة العابرة مرفوضة');
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'memory_read_denied'));
  assert.equal(s.memory.share(w.record.recordId, A, B), true);
  assert.equal(s.memory.read(B, w.record.recordId)?.recordId, w.record.recordId);
});

test('لا مشاركة لسجل لا يملكه المُشارك', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  assert.equal(s.memory.share(w.record.recordId, B, B), false);
});

test('الشطب يزيل المحتوى ويبقي البصمة والسبب', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  const hash = w.record.contentHash;
  assert.equal(s.memory.tombstone(w.record.recordId, 'ministry:data', 'انتهاء الحاجة'), true);
  const after = s.memory.read('ministry:data', w.record.recordId)!;
  assert.equal(after.content, '');
  assert.equal(after.contentHash, hash, 'البصمة تبقى — الأثر لا يزول');
  assert.equal(after.tombstoneReason, 'انتهاء الحاجة');
  assert.equal(s.memory.tombstone(w.record.recordId, 'ministry:data', 'مرة أخرى'), false);
});

test('شطب بلا سبب مرفوض', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  assert.equal(s.memory.tombstone(w.record.recordId, 'ministry:data', '  '), false);
});

test('لا تصحيح بعد الشطب', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  s.memory.tombstone(w.record.recordId, 'ministry:data', 'شطب');
  assert.equal(s.memory.revise(w.record.recordId, 'إحياء', A).ok, false);
});

test('الإيقاف يمنع الكتابة ولا يمنع القراءة ولا الشطب', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  assert.equal(w.ok, true);
  if (!w.ok) return;
  s.killSwitch.engage('authority:king', 'agents', 'اختبار');
  assert.equal(s.memory.write(A, good()).ok, false);
  assert.ok(s.memory.read(A, w.record.recordId));
  assert.equal(s.memory.tombstone(w.record.recordId, 'ministry:data', 'أثناء الإيقاف'), true);
});

test('سقف سجلات الذاكرة لكل وكيل مُلزم', () => {
  const s = bootstrapState();
  const small = new AgentMemory({ audit: s.audit, maxRecordsPerAgent: 2 });
  assert.equal(small.write(A, good()).ok, true);
  assert.equal(small.write(A, good()).ok, true);
  const third = small.write(A, good());
  assert.equal(third.ok, false);
  if (third.ok) return;
  assert.match(third.reason, /سقف/);
});

test('تقرير الذاكرة يعدّ المشطوب وغير الموثوق', () => {
  const s = bootstrapState();
  const w = s.memory.write(A, good());
  s.memory.write(A, good({ provenance: { kind: 'import', ref: 'x' } }));
  s.memory.write(B, good());
  if (w.ok) s.memory.tombstone(w.record.recordId, 'ministry:data', 'شطب');
  const rep = s.memory.report();
  assert.equal(rep.total, 3);
  assert.equal(rep.tombstoned, 1);
  assert.equal(rep.untrusted, 1);
  assert.equal(rep.owners, 2);
});
