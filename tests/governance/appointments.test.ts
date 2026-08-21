/**
 * tests/governance/appointments.test.ts — اختبار قبول المرحلة 23 (التعيين والعزل)
 * المالك: الديوان الملكي | يوثّق في: docs/test-reports/phase-23.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_EXECUTOR, bootstrapState, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();

/** دولة بوزارتين ومناصب معلنة — الأرضية المشتركة لكل اختبار */
function gov() {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);

  s.ministries.establish(structural('ministry:justice'), {
    ministryId: 'ministry:justice', name: 'وزارة العدل',
    mandate: ['justice', 'courts'], proposedBy: ROYAL_COURT,
  }, T0);
  s.ministries.establish(structural('ministry:data'), {
    ministryId: 'ministry:data', name: 'وزارة البيانات',
    mandate: ['data'], proposedBy: ROYAL_COURT,
  }, T0);

  s.appointments.declareOffice(structural('office:minister_of_justice'), {
    officeId: 'office:minister_of_justice', title: 'وزير العدل',
    ministryId: 'ministry:justice', conflictsWith: ['office:chief_judge'],
  }, T0);
  s.appointments.declareOffice(structural('office:chief_judge'), {
    officeId: 'office:chief_judge', title: 'رئيس القضاء',
    ministryId: 'ministry:justice', conflictsWith: ['office:minister_of_justice'],
  }, T0);
  s.appointments.declareOffice(structural('office:minister_of_data'), {
    officeId: 'office:minister_of_data', title: 'وزير البيانات',
    ministryId: 'ministry:data', conflictsWith: [],
  }, T0);
  return { s, structural };
}

/** أمر ملكي بالتعيين موجَّه إلى المعنيّ نفسه */
function appointCommand(s: ReturnType<typeof gov>['s'], subject: string, at = T0) {
  return s.king.issueCommand('appoint_official', subject, {}, at);
}

/** مسار كامل: اقتراح ← اعتماد ← تنفيذ */
function fullPath(
  s: ReturnType<typeof gov>['s'],
  proposalId: string, officeId: string, subject: string, at = T0,
) {
  s.appointments.propose(ROYAL_COURT, {
    proposalId, kind: 'appointment', officeId, subject, reason: 'كفاءة موثّقة',
  }, at);
  s.appointments.approve(appointCommand(s, subject, at), proposalId, at);
  return s.appointments.execute(APPOINTMENT_EXECUTOR, proposalId, at);
}

test('المسار الكامل ينجح: اقتراح ثم اعتماد ملكي ثم تنفيذ من حرس التاج', () => {
  const { s } = gov();
  const r = fullPath(s, 'prop:1', 'office:minister_of_justice', 'official:noor');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.proposal.status, 'executed');
  const holder = s.appointments.holderOf('office:minister_of_justice');
  assert.equal(holder?.holder, 'official:noor');
  // سلسلة المشروعية الثلاثية محفوظة ببصماتها
  assert.equal(holder!.chain.proposed.length > 0, true);
  assert.equal(holder!.chain.approved.length > 0, true);
  assert.equal(holder!.chain.executed.length > 0, true);
  assert.equal(s.audit.find('appointment_executed').length, 1);
});

test('لا تنفيذ لاقتراح لم يُعتمد بأمر ملكي — والمنصب يبقى خاليًا', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:2', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  const r = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:2', T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /لم يُعتمد/);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);
});

test('المنفّذ لا يكون المقترح ولا المعتمد ولا غير حرس التاج (RULE-004)', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:3', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  s.appointments.approve(appointCommand(s, 'official:sara'), 'prop:3', T0);

  assert.equal(s.appointments.execute(ROYAL_COURT, 'prop:3', T0).ok, false);
  assert.equal(s.appointments.execute(s.king.kingId, 'prop:3', T0).ok, false);
  assert.equal(s.appointments.execute('ministry:data', 'prop:3', T0).ok, false);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:3', T0).ok, true);
});

test('الاقتراح من الديوان الملكي وحده — ولا يقترح أحد نفسه', () => {
  const { s } = gov();
  const outsider = s.appointments.propose('ministry:data', {
    proposalId: 'prop:4', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح داخلي',
  }, T0);
  assert.equal(outsider.ok, false);
  const selfNom = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:5', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: ROYAL_COURT, reason: 'ترشيح النفس',
  }, T0);
  assert.equal(selfNom.ok, false);
  if (selfNom.ok) return;
  assert.match(selfNom.reason, /نفسه/);
});

test('المعتمد لا يكون المقترح: أمر صادر من الديوان لا يعتمد اقتراحه', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:6', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  // أمر ملكي صحيح شكلًا لكن مُصدِره هو المقترح نفسه
  const forged = {
    ...appointCommand(s, 'official:sara'),
    payload: { ...appointCommand(s, 'official:sara').payload, issuedBy: ROYAL_COURT },
  };
  const r = s.appointments.approve(forged, 'prop:6', T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /المقترح/);
  assert.equal(s.appointments.proposal('prop:6')?.status, 'proposed');
});

test('الاعتماد بفعل appoint_official وحده وبهدف هو المعنيّ نفسه', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:7', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  const wrongAction = s.king.issueCommand('amend_policy', 'official:sara', {}, T0);
  assert.equal(s.appointments.approve(wrongAction, 'prop:7', T0).ok, false);
  const wrongTarget = appointCommand(s, 'official:other');
  const r = s.appointments.approve(wrongTarget, 'prop:7', T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /هدف الأمر/);
});

test('منصب واحد لصاحب واحد: التعيين في منصب مشغول مرفوض', () => {
  const { s } = gov();
  fullPath(s, 'prop:8', 'office:minister_of_data', 'official:sara');
  const r = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:9', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:khalid', reason: 'مرشَّح آخر',
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /مشغول/);
  assert.equal(s.appointments.holderOf('office:minister_of_data')?.holder, 'official:sara');
});

test('لا جمع بين منصبين متعارضين في شخص واحد (وزير عدل ورئيس قضاء)', () => {
  const { s } = gov();
  fullPath(s, 'prop:10', 'office:minister_of_justice', 'official:noor');
  const r = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:11', kind: 'appointment', officeId: 'office:chief_judge',
    subject: 'official:noor', reason: 'الجمع بين المنصبين',
  }, T0);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /تعارض مناصب/);
  assert.equal(s.appointments.holderOf('office:chief_judge'), undefined);
});

test('اقتراحان على المنصب نفسه لا يجتمعان: يُحسم الأول قبل غيره', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:12', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'مرشَّح أول',
  }, T0);
  const second = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:13', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:khalid', reason: 'مرشَّح ثانٍ',
  }, T0);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.reason, /اقتراح قائم/);
});

test('الاعتماد يشيخ: تنفيذ بعد انقضاء مدته يسقط ويُسجَّل ولا يُنشئ منصبًا', () => {
  const { s } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:14', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  s.appointments.approve(appointCommand(s, 'official:sara'), 'prop:14', T0);

  const late = T0 + 8 * 24 * 60 * 60 * 1000; // بعد سبعة أيام معلنة
  const r = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:14', late);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /سقط الاعتماد/);
  assert.equal(s.appointments.proposal('prop:14')?.status, 'expired');
  assert.equal(s.audit.find('approval_expired').length, 1);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);
  assert.equal(s.appointments.report().expired, 1);
});

test('لا تنفيذ في فراغ: حلّ وزارة المنصب بعد الاعتماد يمنع التنفيذ', () => {
  const { s, structural } = gov();
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:15', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'ترشيح الديوان',
  }, T0);
  s.appointments.approve(appointCommand(s, 'official:sara'), 'prop:15', T0);
  assert.equal(
    s.ministries.dissolve(structural('ministry:data'), 'ministry:data', 'دمج', T0 + 100).ok, true,
  );
  const r = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:15', T0 + 200);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /فراغ/);
});

test('العزل بنفس المسار المفصول: اقتراح ثم أمر ملكي ثم تنفيذ', () => {
  const { s } = gov();
  fullPath(s, 'prop:16', 'office:minister_of_data', 'official:sara');
  const proposed = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:17', kind: 'dismissal', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'إخلال موثّق بالاختصاص',
  }, T0 + 10);
  assert.equal(proposed.ok, true);
  // لا عزل بمجرد الاقتراح
  assert.equal(s.appointments.holderOf('office:minister_of_data')?.holder, 'official:sara');
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:17', T0 + 11).ok, false);

  s.appointments.approve(appointCommand(s, 'official:sara', T0 + 12), 'prop:17', T0 + 12);
  const done = s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:17', T0 + 13);
  assert.equal(done.ok, true);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);
  assert.equal(s.audit.find('dismissal_executed').length, 1);
});

test('لا عزل لمنصب خالٍ ولا عزل لغير صاحب المنصب', () => {
  const { s } = gov();
  assert.equal(s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:18', kind: 'dismissal', officeId: 'office:chief_judge',
    subject: 'official:noor', reason: 'عزل من لا يشغل',
  }, T0).ok, false);

  fullPath(s, 'prop:19', 'office:chief_judge', 'official:noor');
  const wrongPerson = s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:20', kind: 'dismissal', officeId: 'office:chief_judge',
    subject: 'official:khalid', reason: 'المقصود غير صاحب المنصب',
  }, T0);
  assert.equal(wrongPerson.ok, false);
  if (wrongPerson.ok) return;
  assert.match(wrongPerson.reason, /ليس صاحب المنصب/);
});

test('لا منصب في وزارة غير قائمة ولا منصب يُعلن مرتين', () => {
  const { s, structural } = gov();
  const ghost = s.appointments.declareOffice(structural('office:minister_of_x'), {
    officeId: 'office:minister_of_x', title: 'وزير مجهول',
    ministryId: 'ministry:ghost', conflictsWith: [],
  }, T0);
  assert.equal(ghost.ok, false);
  const twice = s.appointments.declareOffice(structural('office:minister_of_data'), {
    officeId: 'office:minister_of_data', title: 'وزير البيانات', ministryId: 'ministry:data',
    conflictsWith: [],
  }, T0);
  assert.equal(twice.ok, false);
  assert.equal(s.appointments.report().offices, 3);
});

test('تدقيق مستقل: كل منصب مشغول سلسلته كاملة ولا سلسلة مبتورة', () => {
  const { s } = gov();
  fullPath(s, 'prop:21', 'office:minister_of_justice', 'official:noor');
  fullPath(s, 'prop:22', 'office:minister_of_data', 'official:sara');
  const audited = s.appointments.auditChains();
  assert.equal(audited.holders, 2);
  assert.deepEqual([...audited.broken], []);
  assert.equal(s.audit.find('appointment_chains_audited').length, 1);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
