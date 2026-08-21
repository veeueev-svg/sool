/**
 * tests/governance/cabinet.test.ts — اختبار قبول المرحلة 23 (مجلس الوزراء)
 * المالك: الديوان الملكي | يوثّق في: docs/test-reports/phase-23.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_EXECUTOR, bootstrapState, ROYAL_COURT, Vote } from '../../src/index';

const T0 = Date.now();

/** حكومة قائمة: ثلاث وزارات وثلاثة وزراء معيَّنين بالمسار الكامل */
function cabinetState() {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);

  const setup: readonly [string, string, readonly string[], string, string][] = [
    ['ministry:justice', 'وزارة العدل', ['justice'], 'office:minister_of_justice', 'official:noor'],
    ['ministry:data', 'وزارة البيانات', ['data'], 'office:minister_of_data', 'official:sara'],
    ['ministry:interior', 'وزارة الداخلية', ['interior'], 'office:minister_of_interior', 'official:khalid'],
  ];
  for (const [ministryId, name, mandate, officeId, holder] of setup) {
    s.ministries.establish(structural(ministryId), {
      ministryId, name, mandate: [...mandate], proposedBy: ROYAL_COURT,
    }, T0);
    s.appointments.declareOffice(structural(officeId), {
      officeId, title: name, ministryId, conflictsWith: [],
    }, T0);
    const proposalId = `prop:${officeId}`;
    s.appointments.propose(ROYAL_COURT, {
      proposalId, kind: 'appointment', officeId, subject: holder, reason: 'كفاءة موثّقة',
    }, T0);
    s.appointments.approve(s.king.issueCommand('appoint_official', holder, {}, T0), proposalId, T0);
    s.appointments.execute(APPOINTMENT_EXECUTOR, proposalId, T0);
  }
  const ministers = ['official:noor', 'official:sara', 'official:khalid'];
  return { s, structural, ministers };
}

function allFor(voters: readonly string[]): Record<string, Vote> {
  return Object.fromEntries(voters.map((v) => [v, 'for' as Vote]));
}

test('عقد جلسة بحضور الوزراء ينجح ويُسجَّل نصابها', () => {
  const { s, ministers } = cabinetState();
  const r = s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:1', attendees: ministers }, T0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.quorum, 2); // ثلاثة مقاعد ⇒ أكثر من النصف
  assert.equal(s.audit.find('cabinet_convened').length, 1);
  assert.equal(s.cabinet.report().seats, 3);
});

test('عقد الجلسة من الديوان الملكي وحده', () => {
  const { s, ministers } = cabinetState();
  const r = s.cabinet.convene('ministry:data', { sessionId: 'sess:2', attendees: ministers }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /الديوان الملكي/);
});

test('لا يحضر إلا صاحب منصب قائم — والغريب يُسمّى في الرفض', () => {
  const { s, ministers } = cabinetState();
  const r = s.cabinet.convene(ROYAL_COURT, {
    sessionId: 'sess:3', attendees: [...ministers, 'agent:intruder'],
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /agent:intruder/);
  assert.equal(s.cabinet.session('sess:3'), undefined);
});

test('المعزول لا يحضر: بعد تنفيذ عزله يُرفض حضوره', () => {
  const { s, ministers } = cabinetState();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:dismiss', kind: 'dismissal', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'إخلال موثّق',
  }, T0 + 10);
  s.appointments.approve(s.king.issueCommand('appoint_official', 'official:sara', {}, T0 + 11), 'prop:dismiss', T0 + 11);
  s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:dismiss', T0 + 12);

  const r = s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:4', attendees: ministers }, T0 + 13);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /official:sara/);
});

test('لا قرار بلا نصاب: حاضر واحد من ثلاثة مقاعد مرفوض ويُسجَّل نقص النصاب', () => {
  const { s } = cabinetState();
  const r = s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:5', attendees: ['official:noor'] }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /نصاب ناقص/);
  assert.equal(s.audit.find('cabinet_quorum_failed').length, 1);
});

test('قرار في نطاق اختصاص معلن يُجاز ويُنسب إلى وزارته', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:6', attendees: ministers }, T0);
  const r = s.cabinet.decide({
    sessionId: 'sess:6', decisionId: 'dec:1', domain: 'justice',
    subject: 'اعتماد دليل إجراءات المحاكمة', votes: allFor(ministers),
  }, T0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.passed, true);
  assert.equal(r.value.executingMinistry, 'ministry:justice');
  assert.equal(s.audit.find('cabinet_decided').length, 1);
});

test('لا قرار في نطاق بلا وزارة صاحبة اختصاص', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:7', attendees: ministers }, T0);
  const r = s.cabinet.decide({
    sessionId: 'sess:7', decisionId: 'dec:2', domain: 'economy',
    subject: 'إنفاق', votes: allFor(ministers),
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /اختصاص/);
});

test('الإجماع ليس سلطة: قرار جماعي في فعل سيادي مرفوض ويُسجَّل ولو أجمعوا', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:8', attendees: ministers }, T0);
  const r = s.cabinet.decide({
    sessionId: 'sess:8', decisionId: 'dec:3', domain: 'justice',
    subject: 'إنهاء وكيل بقرار المجلس', votes: allFor(ministers),
    sovereignAction: 'terminate_agent',
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /أمر ملكي/);
  assert.equal(s.audit.find('cabinet_override_refused').length, 1);
  assert.equal(s.audit.find('collective_override_rejected').length >= 1, true);
  assert.equal(s.cabinet.decision('dec:3'), undefined);
});

test('لا يصوّت إلا حاضر: صوت من لم يحضر يُبطل القرار كله', () => {
  const { s } = cabinetState();
  const present = ['official:noor', 'official:sara'];
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:9', attendees: present }, T0);
  const r = s.cabinet.decide({
    sessionId: 'sess:9', decisionId: 'dec:4', domain: 'justice', subject: 'قرار',
    votes: { ...allFor(present), 'official:khalid': 'for' },
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /official:khalid/);
});

test('قرار لم يبلغ الأغلبية يسقط ولا يُنفَّذ', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:10', attendees: ministers }, T0);
  const r = s.cabinet.decide({
    sessionId: 'sess:10', decisionId: 'dec:5', domain: 'data', subject: 'سياسة احتفاظ',
    votes: { 'official:noor': 'for', 'official:sara': 'against', 'official:khalid': 'abstain' },
  }, T0);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.passed, false);
  const exec = s.cabinet.execute('ministry:data', 'dec:5', T0);
  assert.equal(exec.ok, false);
  if (exec.ok) return;
  assert.match(exec.reason, /لم يُجَز/);
});

test('لا تنفيذ من غير ذي اختصاص — والتنفيذ من صاحب النطاق ينجح مرة واحدة', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:11', attendees: ministers }, T0);
  s.cabinet.decide({
    sessionId: 'sess:11', decisionId: 'dec:6', domain: 'data',
    subject: 'اعتماد أصناف الاحتفاظ', votes: allFor(ministers),
  }, T0);
  const wrong = s.cabinet.execute('ministry:justice', 'dec:6', T0);
  assert.equal(wrong.ok, false);
  if (!wrong.ok) assert.match(wrong.reason, /ministry:data/);

  assert.equal(s.cabinet.execute('ministry:data', 'dec:6', T0).ok, true);
  assert.equal(s.cabinet.execute('ministry:data', 'dec:6', T0 + 1).ok, false);
  assert.equal(s.audit.find('cabinet_decision_executed').length, 1);
  assert.equal(s.cabinet.report().executed, 1);
});

test('جلسة مرفوعة لا قرار بعدها — والسلسلة تبقى سليمة', () => {
  const { s, ministers } = cabinetState();
  s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:12', attendees: ministers }, T0);
  assert.equal(s.cabinet.close(ROYAL_COURT, 'sess:12', T0 + 5).ok, true);
  const r = s.cabinet.decide({
    sessionId: 'sess:12', decisionId: 'dec:7', domain: 'justice', subject: 'قرار متأخر',
    votes: allFor(ministers),
  }, T0 + 6);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /مرفوعة/);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
