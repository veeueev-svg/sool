/**
 * tests/law/statutes.test.ts — اختبار قبول المرحلة 22 (سجل القوانين)
 * المالك: وزارة العدل | يوثّق في: docs/test-reports/phase-22.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, PenaltyKind, StatuteInput } from '../../src/index';

/** لحظة مرجعية حقيقية: شهادة الملك صالحة 90 يومًا، فالزمن الوهمي البعيد يُبطلها */
const T0 = Date.now();

function state() {
  return bootstrapState({ now: T0 });
}

function draft(over: Partial<StatuteInput> = {}): StatuteInput {
  return {
    statuteId: 'law:tool-misuse',
    title: 'إساءة استخدام الأدوات',
    text: 'يُمنع على الوكيل استدعاء أداة خارج خطته المعلنة، وعقوبته بحسب الجسامة.',
    severity: 'major',
    penalties: ['warning', 'capability_revocation', 'suspension'] as readonly PenaltyKind[],
    appliesTo: ['agent:'],
    proposedBy: 'ministry:justice',
    effectiveFrom: T0,
    ...over,
  };
}

/** أمر ملكي بفعل تعديل السياسة موجَّه إلى القانون نفسه */
function policyCommand(s: ReturnType<typeof state>, statuteId = 'law:tool-misuse', at = T0) {
  return s.king.issueCommand('amend_policy', statuteId, { kind: 'statute' }, at);
}

test('تشريع قانون بأمر ملكي معتمد ينجح ويُسجَّل بإصداره الأول', () => {
  const s = state();
  const r = s.law.enact(policyCommand(s), draft(), T0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.statute.version, 1);
  assert.equal(r.statute.repealedAt, null);
  assert.equal(s.audit.find('statute_enacted').length, 1);
  assert.equal(s.law.report().inForce, 1);
});

test('لا تشريع بلا أمر ملكي معتمد: فعل غير amend_policy مرفوض', () => {
  const s = state();
  const bad = s.king.issueCommand('create_agent', 'law:tool-misuse', {}, T0);
  const r = s.law.enact(bad, draft(), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /amend_policy/);
  assert.equal(s.law.report().total, 0);
});

test('هدف الأمر يجب أن يطابق القانون — لا اعتماد بالتقاط أمر آخر', () => {
  const s = state();
  const r = s.law.enact(policyCommand(s, 'law:other'), draft(), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /هدف الأمر/);
});

test('لا قانون بلا نص صريح ولا بلا عقوبة معلنة ولا بلا نطاق', () => {
  const s = state();
  assert.equal(s.law.enact(policyCommand(s), draft({ text: 'قصير' }), T0).ok, false);
  assert.equal(s.law.enact(policyCommand(s), draft({ penalties: [] }), T0).ok, false);
  assert.equal(s.law.enact(policyCommand(s), draft({ appliesTo: [] }), T0).ok, false);
  assert.equal(s.law.report().total, 0);
  assert.equal(s.audit.find('statute_refused').length >= 3, true);
});

test('لا أثر رجعي: سريان يبدأ قبل لحظة الإصدار مرفوض', () => {
  const s = state();
  const r = s.law.enact(policyCommand(s), draft({ effectiveFrom: T0 - 1 }), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /أثر رجعي/);
});

test('من يخضع للقانون لا يقترحه (RULE-005)', () => {
  const s = state();
  const r = s.law.enact(policyCommand(s), draft({ proposedBy: 'agent:007' }), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /RULE-005/);
});

test('عقوبة غير معلنة في سلّم العقوبات مرفوضة', () => {
  const s = state();
  const r = s.law.enact(
    policyCommand(s), draft({ penalties: ['exile' as unknown as PenaltyKind] }), T0,
  );
  assert.equal(r.ok, false);
});

test('التعديل إصدار جديد يبقي السابق نافذًا على زمنه', () => {
  const s = state();
  assert.equal(s.law.enact(policyCommand(s), draft(), T0).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 60_000);
  const r = s.law.amend(
    policyCommand(s, 'law:tool-misuse', T0 + 60_000),
    'law:tool-misuse',
    { severity: 'grave', penalties: ['suspension', 'termination'], effectiveFrom: T0 + 120_000 },
    T0 + 60_000,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.statute.version, 2);
  assert.equal(r.statute.supersedes, 1);
  assert.equal(s.law.history('law:tool-misuse').length, 2);
  // القانون النافذ يختلف بحسب لحظة الفعل — هذا أساس منع الأثر الرجعي
  assert.equal(s.law.applicableAt('law:tool-misuse', T0 + 1000)?.version, 1);
  assert.equal(s.law.applicableAt('law:tool-misuse', T0 + 200_000)?.version, 2);
  assert.equal(s.law.report().amendments, 1);
});

test('تعديل قانون غير موجود مرفوض، وتشريع بمعرّف قائم يُوجَّه إلى التعديل', () => {
  const s = state();
  assert.equal(s.law.amend(policyCommand(s, 'law:ghost'), 'law:ghost', {}, T0).ok, false);
  assert.equal(s.law.enact(policyCommand(s), draft(), T0).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 1000);
  const again = s.law.enact(
    policyCommand(s, 'law:tool-misuse', T0 + 1000), draft({ effectiveFrom: T0 + 1000 }), T0 + 1000,
  );
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.match(again.reason, /amend/);
});

test('الإلغاء يوقف السريان ولا يمحو النص ولا يمس ما وقع قبله', () => {
  const s = state();
  assert.equal(s.law.enact(policyCommand(s), draft(), T0).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 60_000);
  const r = s.law.repeal(
    policyCommand(s, 'law:tool-misuse', T0 + 60_000), 'law:tool-misuse', 'استُبدل بنظام أشمل', T0 + 60_000,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.statute.repealedAt, T0 + 60_000);
  assert.equal(r.statute.text.length > 0, true);
  assert.equal(s.law.applicableAt('law:tool-misuse', T0 + 1000)?.version, 1); // ما وقع قبل الإلغاء
  assert.equal(s.law.applicableAt('law:tool-misuse', T0 + 90_000), undefined); // وبعده لا سريان
  assert.equal(s.law.report().repealed, 1);
});

test('لا إلغاء بلا سبب، ولا إلغاء مرتين', () => {
  const s = state();
  assert.equal(s.law.enact(policyCommand(s), draft(), T0).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 60_000);
  assert.equal(s.law.repeal(policyCommand(s, 'law:tool-misuse', T0 + 60_000), 'law:tool-misuse', '   ', T0 + 60_000).ok, false);
  assert.equal(s.law.repeal(policyCommand(s, 'law:tool-misuse', T0 + 60_000), 'law:tool-misuse', 'سبب معلن', T0 + 60_000).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 120_000);
  assert.equal(s.law.repeal(policyCommand(s, 'law:tool-misuse', T0 + 120_000), 'law:tool-misuse', 'مرة ثانية', T0 + 120_000).ok, false);
});

test('القوانين النافذة على كيان تُحصر بنطاق خضوعه', () => {
  const s = state();
  assert.equal(s.law.enact(policyCommand(s), draft(), T0).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 1000);
  assert.equal(s.law.enact(
    policyCommand(s, 'law:governor-duty', T0 + 1000),
    draft({ statuteId: 'law:governor-duty', appliesTo: ['region:'], effectiveFrom: T0 + 1000 }),
    T0 + 1000,
  ).ok, true);
  assert.deepEqual(
    s.law.governing('agent:007', T0 + 2000).map((x) => x.statuteId),
    ['law:tool-misuse'],
  );
  assert.deepEqual(
    s.law.governing('region:north', T0 + 2000).map((x) => x.statuteId),
    ['law:governor-duty'],
  );
});
