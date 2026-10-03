/**
 * tests/governance/reassignment_and_resignation.test.ts — القرارُ بعد زوال الاختصاص، والاستقالة (T-38 · T-40 · W-2026-053)
 * المالك: الديوان الملكي | يوثّق في: docs/test-reports/phase-40-W-2026-053.md
 * يثبت: (1) قرارٌ مُجازٌ لوزارةٍ زال اختصاصُها لا يُنفَّذ صامتًا — يسقط ويُسجَّل `cabinet_decision_lapsed`،
 *       ويُعاد إسنادُه بأمرٍ ملكيٍّ إلى صاحب الاختصاص القائم فيُنفَّذ؛ (2) الاستقالةُ بطلب صاحب المنصب وحده،
 *       باعتمادٍ ملكيّ، وتُسجَّل `resignation_*` لا عزلًا.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_EXECUTOR, bootstrapState, ROYAL_COURT, Vote } from '../../src/index';

const T0 = Date.now();

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

const allFor = (voters: readonly string[]): Record<string, Vote> =>
  Object.fromEntries(voters.map((v) => [v, 'for' as Vote]));

test('T-38: زوالُ الاختصاص بعد الإجازة يُسقط القرارَ ويُسجَّل — وإعادةُ الإسناد الملكية تنفّذه', () => {
  const { s, structural, ministers } = cabinetState();
  assert.equal(s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:r', attendees: ministers }, T0).ok, true);
  assert.equal(s.cabinet.decide({
    sessionId: 'sess:r', decisionId: 'dec:r', domain: 'data', subject: 'فهرسةُ المحفوظات', votes: allFor(ministers),
  }, T0).ok, true);
  assert.equal(s.ministries.reassignMandate(structural('ministry:data'), 'ministry:data', ['data_archive'], T0 + 1).ok, true);
  assert.equal(s.ministries.reassignMandate(structural('ministry:justice'), 'ministry:justice', ['justice', 'data'], T0 + 2).ok, true);

  const stale = s.cabinet.execute('ministry:data', 'dec:r', T0 + 3);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.match(stale.reason, /سقط القرار/);
  assert.equal(s.audit.find('cabinet_decision_lapsed').length, 1);
  assert.equal(s.cabinet.decision('dec:r')?.lapsedAt, T0 + 3);
  assert.equal(s.cabinet.execute('ministry:justice', 'dec:r', T0 + 4).ok, false, 'لا ينفّذه غيرُ المسنَد إليه قبل الإسناد');

  const wrongTarget = s.cabinet.reassign(s.king.issueCommand('amend_policy', 'dec:other', {}, T0 + 5), 'dec:r', T0 + 5);
  assert.equal(wrongTarget.ok, false);
  const moved = s.cabinet.reassign(s.king.issueCommand('amend_policy', 'dec:r', {}, T0 + 6), 'dec:r', T0 + 6);
  assert.equal(moved.ok, true);
  if (moved.ok) assert.equal(moved.value.executingMinistry, 'ministry:justice');
  assert.equal(s.cabinet.execute('ministry:justice', 'dec:r', T0 + 7).ok, true);
  assert.equal(s.audit.find('cabinet_decision_reassigned').length, 1);
});

test('T-40: الاستقالةُ بطلب صاحبها، باعتمادٍ ملكيّ، وتُسجَّل استقالةً لا عزلًا', () => {
  const { s } = cabinetState();
  const byCourt = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'res:0', kind: 'resignation', officeId: 'office:minister_of_data', subject: 'official:sara', reason: 'طلبُ إعفاء',
  }, T0 + 1);
  assert.equal(byCourt.ok, false, 'لا يستقيل أحدٌ عن غيره ولو كان الديوان');
  const byOther = s.appointments.propose('official:noor', {
    proposalId: 'res:1', kind: 'resignation', officeId: 'office:minister_of_data', subject: 'official:sara', reason: 'طلبُ إعفاء',
  }, T0 + 1);
  assert.equal(byOther.ok, false);
  const notHolder = s.appointments.propose('official:noor', {
    proposalId: 'res:2', kind: 'resignation', officeId: 'office:minister_of_data', subject: 'official:noor', reason: 'طلبُ إعفاء',
  }, T0 + 1);
  assert.equal(notHolder.ok, false, 'لا يستقيل من منصبٍ لا يشغله');

  assert.equal(s.appointments.propose('official:sara', {
    proposalId: 'res:3', kind: 'resignation', officeId: 'office:minister_of_data', subject: 'official:sara', reason: 'ظرفٌ شخصيٌّ معلن',
  }, T0 + 2).ok, true);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'res:3', T0 + 3).ok, false, 'لا نفاذ قبل الاعتماد الملكي');
  assert.equal(s.appointments.approve(s.king.issueCommand('appoint_official', 'official:sara', {}, T0 + 4), 'res:3', T0 + 4).ok, true);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'res:3', T0 + 5).ok, true);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);
  assert.deepEqual(
    ['resignation_requested', 'resignation_approved', 'resignation_executed', 'dismissal_executed']
      .map((e) => s.audit.find(e).length),
    [1, 1, 1, 0],
  );
});
