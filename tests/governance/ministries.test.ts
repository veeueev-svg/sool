/**
 * tests/governance/ministries.test.ts — اختبار قبول المرحلة 23 (سجل الوزارات)
 * المالك: الديوان الملكي | يوثّق في: docs/test-reports/phase-23.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, MinistryInput, ROYAL_COURT } from '../../src/index';

/** لحظة مرجعية حقيقية: شهادة الملك صالحة 90 يومًا (درس المرحلة 22) */
const T0 = Date.now();

function state() {
  return bootstrapState({ now: T0 });
}

function structural(s: ReturnType<typeof state>, target: string, at = T0) {
  return s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);
}

function draft(over: Partial<MinistryInput> = {}): MinistryInput {
  return {
    ministryId: 'ministry:justice',
    name: 'وزارة العدل',
    mandate: ['justice', 'courts'],
    proposedBy: ROYAL_COURT,
    ...over,
  };
}

test('إنشاء وزارة بأمر ملكي معتمد ينجح ويُسجَّل باختصاصها', () => {
  const s = state();
  const r = s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual([...r.ministry.mandate], ['justice', 'courts']);
  assert.equal(r.ministry.dissolvedAt, null);
  assert.equal(s.audit.find('ministry_established').length, 1);
  assert.equal(s.ministries.report().active, 1);
});

test('لا وزارة بلا أمر ملكي: فعل غير amend_policy مرفوض', () => {
  const s = state();
  const bad = s.king.issueCommand('create_agent', 'ministry:justice', {}, T0);
  const r = s.ministries.establish(bad, draft(), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /amend_policy/);
  assert.equal(s.ministries.report().total, 0);
});

test('هدف الأمر يجب أن يطابق الوزارة — لا اعتماد بالتقاط أمر آخر', () => {
  const s = state();
  const r = s.ministries.establish(structural(s, 'ministry:other'), draft(), T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /هدف الأمر/);
});

test('لا وزارة بلا اسم معلن ولا بلا نطاق اختصاص', () => {
  const s = state();
  assert.equal(s.ministries.establish(structural(s, 'ministry:justice'), draft({ name: 'و' }), T0).ok, false);
  assert.equal(s.ministries.establish(structural(s, 'ministry:justice'), draft({ mandate: [] }), T0).ok, false);
  assert.equal(s.ministries.report().total, 0);
  assert.equal(s.audit.find('ministry_refused').length >= 2, true);
});

test('لا تزاحم اختصاص: نطاق يملكه غيرها يُرفض مع تسمية المالك', () => {
  const s = state();
  assert.equal(s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0).ok, true);
  const r = s.ministries.establish(
    structural(s, 'ministry:interior'),
    draft({ ministryId: 'ministry:interior', name: 'وزارة الداخلية', mandate: ['courts'] }),
    T0,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /تزاحم اختصاص/);
  assert.match(r.reason, /ministry:justice/);
});

test('الوزارة لا تقترح إنشاء نفسها (RULE-005)', () => {
  const s = state();
  const r = s.ministries.establish(
    structural(s, 'ministry:justice'), draft({ proposedBy: 'ministry:justice' }), T0,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /نفسها/);
});

test('وزارة قائمة لا تُنشأ مرتين بالمعرّف نفسه', () => {
  const s = state();
  assert.equal(s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0).ok, true);
  const r = s.ministries.establish(structural(s, 'ministry:justice'), draft({ mandate: ['x'] }), T0);
  assert.equal(r.ok, false);
  assert.equal(s.ministries.report().active, 1);
});

test('توسيع النطاق يمرّ بالبوابة ويُسجَّل من أين إلى أين', () => {
  const s = state();
  s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  const r = s.ministries.reassignMandate(
    structural(s, 'ministry:justice'), 'ministry:justice', ['justice', 'courts', 'appeals'], T0,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ministry.mandate.length, 3);
  const logged = s.audit.find('mandate_reassigned');
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0]!.detail.to, ['justice', 'courts', 'appeals']);
  assert.equal(s.ministries.competentFor('appeals')?.ministryId, 'ministry:justice');
});

test('توسيع النطاق إلى نطاق مملوك لغيرها مرفوض', () => {
  const s = state();
  s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  s.ministries.establish(
    structural(s, 'ministry:data'),
    draft({ ministryId: 'ministry:data', name: 'وزارة البيانات', mandate: ['data'] }), T0,
  );
  const r = s.ministries.reassignMandate(
    structural(s, 'ministry:data'), 'ministry:data', ['data', 'justice'], T0,
  );
  assert.equal(r.ok, false);
  assert.equal(s.ministries.competentFor('justice')?.ministryId, 'ministry:justice');
});

test('الحلّ بأمر ملكي وبسبب معلن ينجح ويوقف الاختصاص ولا يمحو التاريخ', () => {
  const s = state();
  s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  const r = s.ministries.dissolve(
    structural(s, 'ministry:justice'), 'ministry:justice', 'دُمجت في وزارة أخرى', T0 + 1000,
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.ministry.dissolvedAt, T0 + 1000);
  assert.equal(s.ministries.competentFor('justice'), null);
  assert.equal(s.ministries.get('ministry:justice')?.name, 'وزارة العدل');
  assert.equal(s.ministries.report().dissolved, 1);
});

test('لا حلّ بلا سبب معلن (RULE-006) ولا لوزارة غير قائمة', () => {
  const s = state();
  s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  assert.equal(
    s.ministries.dissolve(structural(s, 'ministry:justice'), 'ministry:justice', '', T0).ok, false,
  );
  assert.equal(
    s.ministries.dissolve(structural(s, 'ministry:ghost'), 'ministry:ghost', 'لا وجود لها', T0).ok, false,
  );
  assert.equal(s.ministries.isActive('ministry:justice'), true);
});

test('لا حلّ لوزارة وفيها منصب مشغول — تُسمّى المناصب في السجل', () => {
  const s = state();
  s.ministries.establish(structural(s, 'ministry:justice'), draft(), T0);
  s.appointments.declareOffice(structural(s, 'office:minister_of_justice'), {
    officeId: 'office:minister_of_justice', title: 'وزير العدل',
    ministryId: 'ministry:justice', conflictsWith: [],
  }, T0);
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:1', kind: 'appointment', officeId: 'office:minister_of_justice',
    subject: 'official:noor', reason: 'كفاءة موثّقة',
  }, T0);
  s.appointments.approve(s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'prop:1', T0);
  s.appointments.execute('authority:crown_guard', 'prop:1', T0);

  const r = s.ministries.dissolve(
    structural(s, 'ministry:justice'), 'ministry:justice', 'إعادة هيكلة', T0 + 5000,
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /مناصب مشغولة/);
  const refusals = s.audit.find('ministry_refused');
  const last = refusals[refusals.length - 1]!;
  assert.deepEqual(last.detail.occupied, ['office:minister_of_justice']);
  assert.equal(s.ministries.isActive('ministry:justice'), true);
});
