/**
 * tests/data/knowledge_graph.test.ts — اختبار قبول المرحلة 21 (المعرفة والأسانيد)
 * المالك: وزارة البيانات | يوثّق في: docs/test-reports/phase-21.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';

const A = 'agent:kg-a';

/** يكتب سجل ذاكرة ويعيد معرّفه — كل حقيقة تحتاج سندًا قائمًا */
function source(s: ReturnType<typeof bootstrapState>, untrusted = false, content = 'قياس ميداني'): string {
  const w = s.memory.write(A, {
    content,
    provenance: untrusted ? { kind: 'import', ref: 'sha256:ext' } : { kind: 'tool_call', ref: 'audit:1' },
    retentionClass: 'operational',
  });
  assert.equal(w.ok, true);
  return w.ok ? w.record.recordId : '';
}

const claim = (object = 'رياض', sourceRecordId = '') => ({
  subject: 'مدينة:001', predicate: 'الاسم', object, sourceRecordId,
});

test('حقيقة بسند موثوق تصير رسمية', () => {
  const s = bootstrapState();
  const r = s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fact.status, 'official');
  assert.equal(s.knowledge.official('مدينة:001', 'الاسم').length, 1);
});

test('لا حقيقة بلا سند: سجل غير موجود يُرفض', () => {
  const s = bootstrapState();
  const r = s.knowledge.assert('ministry:data', claim('رياض', 'mem:لا-يوجد'));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /سند/);
});

test('سند مشطوب لا تُبنى عليه حقيقة', () => {
  const s = bootstrapState();
  const id = source(s);
  s.memory.tombstone(id, 'ministry:data', 'انتهاء المدة');
  assert.equal(s.knowledge.assert('ministry:data', claim('رياض', id)).ok, false);
});

test('دعوى ناقصة الأركان مرفوضة', () => {
  const s = bootstrapState();
  const id = source(s);
  assert.equal(s.knowledge.assert('ministry:data', { subject: '', predicate: 'الاسم', object: 'x', sourceRecordId: id }).ok, false);
  assert.equal(s.knowledge.assert('ministry:data', { subject: 's', predicate: '  ', object: 'x', sourceRecordId: id }).ok, false);
});

test('سند غير موثوق يبقى معلَّقًا حتى تصديق سلطة مخوَّلة', () => {
  const s = bootstrapState();
  const r = s.knowledge.assert('agent:kg-a', claim('رياض', source(s, true)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.fact.status, 'pending');
  assert.equal(s.knowledge.official('مدينة:001', 'الاسم').length, 0, 'المعلَّق ليس رسميًا');
  assert.equal(s.knowledge.attest(r.fact.factId, 'authority:king'), true);
  assert.equal(s.knowledge.get(r.fact.factId)?.status, 'official');
});

test('التصديق من غير مخوَّل مرفوض', () => {
  const s = bootstrapState();
  const r = s.knowledge.assert('agent:kg-a', claim('رياض', source(s, true)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(s.knowledge.attest(r.fact.factId, 'agent:kg-a'), false);
  assert.equal(s.knowledge.get(r.fact.factId)?.status, 'pending');
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'fact_attest_refused'));
});

test('لا تصديق لحقيقة رسمية أصلًا', () => {
  const s = bootstrapState();
  const r = s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(s.knowledge.attest(r.fact.factId, 'authority:king'), false);
});

test('التناقض يُعلن ولا يُستبدل صامتًا', () => {
  const s = bootstrapState();
  const first = s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  const second = s.knowledge.assert('ministry:data', claim('جدة', source(s, false, 'قياس آخر')));
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.contradicts.length, 1);
  assert.equal(s.knowledge.get(first.fact.factId)?.status, 'contradicted');
  assert.equal(second.fact.status, 'contradicted');
  assert.equal(s.knowledge.official('مدينة:001', 'الاسم').length, 0, 'لا رسمية في التناقض');
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'fact_contradiction'));
});

test('الفصل بسلطة مخوَّلة يرجّح واحدة ويسحب منافساتها بسبب مسجَّل', () => {
  const s = bootstrapState();
  const first = s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  const second = s.knowledge.assert('ministry:data', claim('جدة', source(s, false, 'قياس آخر')));
  if (!first.ok || !second.ok) return;
  assert.equal(s.knowledge.resolve(second.fact.factId, 'ministry:justice', 'مطابقة السجل المدني'), true);
  assert.equal(s.knowledge.get(second.fact.factId)?.status, 'official');
  assert.equal(s.knowledge.get(first.fact.factId)?.status, 'withdrawn');
});

test('الفصل من غير مخوَّل أو بلا سبب مرفوض', () => {
  const s = bootstrapState();
  const f = s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  if (!f.ok) return;
  assert.equal(s.knowledge.resolve(f.fact.factId, 'agent:kg-a', 'أنا أعلم'), false);
  assert.equal(s.knowledge.resolve(f.fact.factId, 'ministry:data', '  '), false);
});

test('سحب السند يسحب ما بُني عليه تعاقبيًا', () => {
  const s = bootstrapState();
  const id = source(s);
  const base = s.knowledge.assert('ministry:data', claim('رياض', id));
  if (!base.ok) return;
  const derived = s.knowledge.assert('ministry:data', {
    subject: 'مدينة:001', predicate: 'العاصمة', object: 'نعم',
    sourceRecordId: source(s, false, 'استنتاج'), derivedFrom: [base.fact.factId],
  });
  if (!derived.ok) return;
  const withdrawn = s.knowledge.withdrawSource(id, 'authority:crown_guard', 'مصدر مطعون فيه');
  assert.ok(withdrawn.includes(base.fact.factId));
  assert.ok(withdrawn.includes(derived.fact.factId), 'السحب تعاقبي لا سطحي');
  assert.equal(s.knowledge.report().withdrawn, 2);
});

test('سحب السند من غير مخوَّل لا يسحب شيئًا', () => {
  const s = bootstrapState();
  const id = source(s);
  s.knowledge.assert('ministry:data', claim('رياض', id));
  assert.equal(s.knowledge.withdrawSource(id, 'agent:kg-a', 'أرغب').length, 0);
  assert.equal(s.knowledge.report().official, 1);
});

test('حقيقة أصل مسحوبة لا تُبنى عليها حقيقة جديدة', () => {
  const s = bootstrapState();
  const id = source(s);
  const base = s.knowledge.assert('ministry:data', claim('رياض', id));
  if (!base.ok) return;
  s.knowledge.withdrawSource(id, 'ministry:data', 'طعن');
  const r = s.knowledge.assert('ministry:data', {
    subject: 'x', predicate: 'y', object: 'z',
    sourceRecordId: source(s, false, 'آخر'), derivedFrom: [base.fact.factId],
  });
  assert.equal(r.ok, false);
});

test('سلسلة الأصل تصل إلى المصدر الخارجي', () => {
  const s = bootstrapState();
  const id = source(s, true);
  const rev = s.memory.revise(id, 'قياس مصحّح', A);
  assert.equal(rev.ok, true);
  if (!rev.ok) return;
  const f = s.knowledge.assert('ministry:data', claim('رياض', rev.record.recordId));
  if (!f.ok) return;
  const lineage = s.knowledge.lineage(f.fact.factId);
  assert.equal(lineage.facts.length, 1);
  assert.equal(lineage.memory.length, 2, 'الإصدار والأصل');
  assert.deepEqual(lineage.origins, ['import:sha256:ext']);
});

test('تقرير المعرفة يفصل الحالات', () => {
  const s = bootstrapState();
  s.knowledge.assert('ministry:data', claim('رياض', source(s)));
  s.knowledge.assert('ministry:data', { subject: 'b', predicate: 'p', object: 'o', sourceRecordId: source(s, true, 'مستورد') });
  const rep = s.knowledge.report();
  assert.equal(rep.total, 2);
  assert.equal(rep.official, 1);
  assert.equal(rep.pending, 1);
});
