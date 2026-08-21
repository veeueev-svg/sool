/**
 * tests/governance/government_lifecycle.test.ts — معيار قبول المرحلة 23
 * «تعيين وعزل بمرور التاج + فصل الاقتراح عن الاعتماد عن التنفيذ»
 * المالك: الديوان الملكي | يوثّق في: docs/test-reports/phase-23.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPOINTMENT_EXECUTOR, bootstrapState, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();

test('دورة حكومة كاملة: وزارة ← منصب ← اقتراح ← اعتماد ← تنفيذ ← قرار مجلس ← عزل ← حلّ', () => {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);

  // 1) وزارتان باختصاص لا يتزاحم
  assert.equal(s.ministries.establish(structural('ministry:justice'), {
    ministryId: 'ministry:justice', name: 'وزارة العدل',
    mandate: ['justice'], proposedBy: ROYAL_COURT,
  }, T0).ok, true);
  assert.equal(s.ministries.establish(structural('ministry:data'), {
    ministryId: 'ministry:data', name: 'وزارة البيانات',
    mandate: ['data'], proposedBy: ROYAL_COURT,
  }, T0).ok, true);

  // 2) منصبان معلنان بأمر ملكي
  for (const [officeId, title, ministryId] of [
    ['office:minister_of_justice', 'وزير العدل', 'ministry:justice'],
    ['office:minister_of_data', 'وزير البيانات', 'ministry:data'],
  ] as const) {
    assert.equal(s.appointments.declareOffice(structural(officeId), {
      officeId, title, ministryId, conflictsWith: [],
    }, T0).ok, true);
  }

  // 3) الاقتراح من الديوان — ولا أثر له بمجرده
  assert.equal(s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:justice', kind: 'appointment', officeId: 'office:minister_of_justice',
    subject: 'official:noor', reason: 'سجل كفاءة موثّق',
  }, T0).ok, true);
  assert.equal(s.appointments.holderOf('office:minister_of_justice'), undefined);
  // ولا تنفيذ قبل الاعتماد — هذه هي الحلقة التي لا تُختصر
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:justice', T0).ok, false);

  // 4) الاعتماد بأمر ملكي، ثم التنفيذ من حرس التاج وحده
  assert.equal(s.appointments.approve(
    s.king.issueCommand('appoint_official', 'official:noor', {}, T0), 'prop:justice', T0,
  ).ok, true);
  assert.equal(s.appointments.execute(ROYAL_COURT, 'prop:justice', T0).ok, false);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:justice', T0).ok, true);
  assert.equal(s.appointments.holderOf('office:minister_of_justice')?.holder, 'official:noor');

  // وزير البيانات بنفس المسار — ليصير للمجلس مقعدان
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:data', kind: 'appointment', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'سجل كفاءة موثّق',
  }, T0);
  s.appointments.approve(s.king.issueCommand('appoint_official', 'official:sara', {}, T0), 'prop:data', T0);
  s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:data', T0);

  // 5) مجلس ينعقد بنصابه ويقرّر في اختصاصه — والفعل السيادي لا يبلغه إجماعه
  const ministers = ['official:noor', 'official:sara'];
  assert.equal(s.cabinet.convene(ROYAL_COURT, { sessionId: 'sess:1', attendees: ministers }, T0).ok, true);
  assert.equal(s.cabinet.decide({
    sessionId: 'sess:1', decisionId: 'dec:sovereign', domain: 'justice',
    subject: 'تعيين وزير بقرار المجلس', votes: { 'official:noor': 'for', 'official:sara': 'for' },
    sovereignAction: 'appoint_official',
  }, T0).ok, false);
  assert.equal(s.cabinet.decide({
    sessionId: 'sess:1', decisionId: 'dec:policy', domain: 'data',
    subject: 'اعتماد أصناف الاحتفاظ', votes: { 'official:noor': 'for', 'official:sara': 'for' },
  }, T0).ok, true);
  assert.equal(s.cabinet.execute('ministry:justice', 'dec:policy', T0).ok, false);
  assert.equal(s.cabinet.execute('ministry:data', 'dec:policy', T0).ok, true);

  // 6) العزل بمرور التاج نفسه: اقتراح ← اعتماد ← تنفيذ
  s.appointments.propose(ROYAL_COURT, {
    proposalId: 'prop:dismiss', kind: 'dismissal', officeId: 'office:minister_of_data',
    subject: 'official:sara', reason: 'إخلال موثّق بالاختصاص',
  }, T0 + 10);
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:dismiss', T0 + 11).ok, false);
  s.appointments.approve(
    s.king.issueCommand('appoint_official', 'official:sara', {}, T0 + 12), 'prop:dismiss', T0 + 12,
  );
  assert.equal(s.appointments.execute(APPOINTMENT_EXECUTOR, 'prop:dismiss', T0 + 13).ok, true);
  assert.equal(s.appointments.holderOf('office:minister_of_data'), undefined);

  // 7) حلّ الوزارة صار جائزًا بعد خلوّ منصبها — ولم يكن جائزًا قبله
  assert.equal(
    s.ministries.dissolve(structural('ministry:justice'), 'ministry:justice', 'إعادة هيكلة', T0 + 14).ok,
    false,
  );
  assert.equal(
    s.ministries.dissolve(structural('ministry:data'), 'ministry:data', 'دمج الاختصاص', T0 + 15).ok,
    true,
  );
  assert.equal(s.ministries.competentFor('data'), null);

  // 8) ترتيب السجلات لا وجودها فقط: المسار الثلاثي محفوظ بترتيبه
  const kinds = s.audit.snapshot().map((e: { kind: string }) => e.kind);
  const order = [
    'ministry_established', 'office_declared', 'appointment_proposed', 'appointment_approved',
    'appointment_executed', 'cabinet_convened', 'cabinet_override_refused', 'cabinet_decided',
    'cabinet_decision_executed', 'dismissal_proposed', 'dismissal_approved', 'dismissal_executed',
    'ministry_dissolved',
  ];
  let cursor = -1;
  for (const kind of order) {
    const at = kinds.indexOf(kind, cursor + 1);
    assert.equal(at > cursor, true, `السجل ${kind} ليس في موضعه من الترتيب`);
    cursor = at;
  }

  // 9) لا منصب مشغول بسلسلة مبتورة، والسلسلة كلها سليمة
  const audited = s.appointments.auditChains();
  assert.deepEqual([...audited.broken], []);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('حكومة بلا تاج لا تعمل: في الوضع الحمائي لا تعيين ولا إنشاء وزارة', () => {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at: number) =>
    s.king.issueCommand('amend_policy', target, { kind: 'government' }, at);

  // غياب النبض الملكي فوق مدة السماح ⇒ وضع حمائي (RULE-007)
  const late = T0 + 10 * 60 * 1000;
  const r = s.ministries.establish(structural('ministry:justice', late), {
    ministryId: 'ministry:justice', name: 'وزارة العدل',
    mandate: ['justice'], proposedBy: ROYAL_COURT,
  }, late);
  assert.equal(r.ok, false);
  assert.equal(s.ministries.report().active, 0);

  // وبعد نبض ملكي صريح يعود الأمر مقبولًا — الفارق هو حضور الملك لا شيء آخر
  s.heartbeat.beat(s.king.kingId, late);
  const after = s.ministries.establish(structural('ministry:justice', late), {
    ministryId: 'ministry:justice', name: 'وزارة العدل',
    mandate: ['justice'], proposedBy: ROYAL_COURT,
  }, late);
  assert.equal(after.ok, true);
});
