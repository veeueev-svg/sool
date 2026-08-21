/**
 * tests/law/courts.test.ts — اختبار قبول المرحلة 22 (المحكمة: اتهام ودفاع وحكم)
 * المالك: وزارة العدل | يوثّق في: docs/test-reports/phase-22.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, PUBLIC_DEFENDER } from '../../src/index';

const T0 = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const PROSECUTOR = 'authority:audit_bureau';
const JUDGE = 'court:first_instance';
const DEFENDANT = 'agent:007';

/** دولة فيها قانون نافذ ووكيل قائم — الأرضية المشتركة لكل اختبارات المحكمة */
function prepared(defenseWindowMs = 4 * HOUR, appealWindowMs = 8 * HOUR) {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs, appealWindowMs } });
  const created = s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'limited_worker', supervisor: 'ministry:interior' },
  );
  assert.equal(created.ok, true);
  const enacted = s.law.enact(
    s.king.issueCommand('amend_policy', 'law:tool-misuse', {}, T0),
    {
      statuteId: 'law:tool-misuse',
      title: 'إساءة استخدام الأدوات',
      text: 'يُمنع على الوكيل استدعاء أداة خارج خطته المعلنة.',
      severity: 'major',
      penalties: ['warning', 'capability_revocation', 'suspension'],
      appliesTo: ['agent:'],
      proposedBy: 'ministry:justice',
      effectiveFrom: T0,
    },
    T0,
  );
  assert.equal(enacted.ok, true);
  return s;
}

/** بصمة سجل قائم تُستخدم دليلًا — الدليل عندنا مرجع في السلسلة لا وصف نصي */
function evidence(s: ReturnType<typeof prepared>): string {
  const snap = s.audit.snapshot();
  return snap[snap.length - 1]!.hash;
}

function charge(s: ReturnType<typeof prepared>, at = T0 + MIN, occurredAt = T0 + 1000) {
  return s.court.charge(PROSECUTOR, {
    caseId: 'case:001', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'استدعى أداة خارج خطته', evidence: [evidence(s)], occurredAt,
  }, at);
}

test('اتهام سليم يُقبل ويُقيّد إصدار القانون النافذ وقت الفعل', () => {
  const s = prepared();
  const r = charge(s);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.legalCase.status, 'charged');
  assert.equal(r.legalCase.statuteVersion, 1);
  assert.equal(s.audit.find('charge_filed').length, 1);
});

test('لا اتهام من جهة غير مخوَّلة، ولا اتهام للنفس', () => {
  const s = prepared();
  const byAgent = s.court.charge('agent:009', {
    caseId: 'case:x', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'تهمة', evidence: [evidence(s)], occurredAt: T0 + 1000,
  }, T0 + MIN);
  assert.equal(byAgent.ok, false);
  const self = s.court.charge(PROSECUTOR, {
    caseId: 'case:y', statuteId: 'law:tool-misuse', defendant: PROSECUTOR,
    chargeText: 'تهمة', evidence: [evidence(s)], occurredAt: T0 + 1000,
  }, T0 + MIN);
  assert.equal(self.ok, false);
  assert.equal(s.audit.find('charge_refused').length, 2);
});

test('لا اتهام بلا قانون نافذ وقت الوقوع — ولو كان القانون نافذًا اليوم', () => {
  const s = prepared();
  const r = s.court.charge(PROSECUTOR, {
    caseId: 'case:002', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'فعل قبل سريان القانون', evidence: [evidence(s)], occurredAt: T0 - 10 * MIN,
  }, T0 + MIN);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /أثر رجعي/);
});

test('لا اتهام بلا دليل مسجَّل في سلسلة التدقيق', () => {
  const s = prepared();
  const none = s.court.charge(PROSECUTOR, {
    caseId: 'case:003', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'تهمة', evidence: [], occurredAt: T0 + 1000,
  }, T0 + MIN);
  assert.equal(none.ok, false);
  const fake = s.court.charge(PROSECUTOR, {
    caseId: 'case:004', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'تهمة', evidence: ['0'.repeat(64)], occurredAt: T0 + 1000,
  }, T0 + MIN);
  assert.equal(fake.ok, false);
  if (fake.ok) return;
  assert.match(fake.reason, /دليل غير موجود/);
});

test('المتهم خارج نطاق خضوع القانون لا يُحاكم به', () => {
  const s = prepared();
  const r = s.court.charge(PROSECUTOR, {
    caseId: 'case:005', statuteId: 'law:tool-misuse', defendant: 'region:north',
    chargeText: 'تهمة', evidence: [evidence(s)], occurredAt: T0 + 1000,
  }, T0 + MIN);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /نطاق خضوع/);
});

test('لا محاكمة مرتين على الفعل ذاته', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  const again = s.court.charge(PROSECUTOR, {
    caseId: 'case:001-bis', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'التهمة نفسها', evidence: [evidence(s)], occurredAt: T0 + 1000,
  }, T0 + 2 * MIN);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.match(again.reason, /مرتين/);
});

test('لا حكم بلا دفاع: الحكم قبل الدفاع مرفوض', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  const r = s.court.rule('case:001', JUDGE, {
    guilty: true, penalty: 'warning', reason: 'ثبت الفعل',
  }, T0 + 2 * MIN);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /دفاع/);
  assert.equal(s.audit.find('ruling_refused').length, 1);
});

test('دفاع المتهم يُقبل، ودفاع من المدّعي مرفوض', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', PROSECUTOR, 'دفاع', [], T0 + 2 * MIN).ok, false);
  const d = s.court.submitDefense('case:001', DEFENDANT, 'كان الاستدعاء داخل الخطة', [], T0 + 2 * MIN);
  assert.equal(d.ok, true);
  if (!d.ok) return;
  assert.equal(d.legalCase.status, 'defended');
  assert.equal(d.legalCase.defense?.byDefault, false);
});

test('سكوت المتهم لا يُعَدّ تنازلًا: لا مدافع حكمي قبل الأجل، ويُسجَّل السكوت بعده', () => {
  const s = prepared(4 * HOUR);
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.appointPublicDefender('case:001', PUBLIC_DEFENDER, T0 + HOUR).ok, false);
  const late = s.court.appointPublicDefender('case:001', PUBLIC_DEFENDER, T0 + 5 * HOUR);
  assert.equal(late.ok, true);
  if (!late.ok) return;
  assert.equal(late.legalCase.defense?.byDefault, true);
  assert.equal(s.audit.find('defense_defaulted').length, 1);
});

test('القاضي ليس المدّعي ولا المتهم، والجهة غير المخوَّلة لا تحكم (RULE-004)', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', PROSECUTOR, { guilty: true, penalty: 'warning', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.rule('case:001', DEFENDANT, { guilty: false, penalty: 'none', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.rule('case:001', 'ministry:interior', { guilty: true, penalty: 'warning', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.get('case:001')?.ruling, null);
});

test('العقوبة من عقوبات القانون فقط، ولا عقوبة على غير مُدان، ولا إدانة بلا عقوبة', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'termination', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: false, penalty: 'suspension', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'none', reason: 'ر' }, T0 + 3 * MIN).ok, false);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'suspension', reason: '  ' }, T0 + 3 * MIN).ok, false);
  const ok = s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'suspension', reason: 'ثبت الفعل بالدليل' }, T0 + 3 * MIN);
  assert.equal(ok.ok, true);
});

test('الحكم لا يُعدَّل: حكم ثانٍ في الدعوى مرفوض', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'warning', reason: 'ثبت' }, T0 + 3 * MIN).ok, true);
  const second = s.court.rule('case:001', JUDGE, { guilty: false, penalty: 'none', reason: 'تراجع' }, T0 + 4 * MIN);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.match(second.reason, /لا يُعدَّل/);
  assert.equal(s.court.get('case:001')?.ruling?.guilty, true);
});

test('باب الدفاع يُغلق بعد الحكم', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع أول', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع ثانٍ', [], T0 + 3 * MIN).ok, false);
});

test('لا نهائية قبل انقضاء مدة الطعن، والنهائية تُثبَّت بسجل', () => {
  const s = prepared(4 * HOUR, 8 * HOUR);
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: true, penalty: 'warning', reason: 'ثبت' }, T0 + 3 * MIN).ok, true);
  assert.equal(s.court.isFinal('case:001', T0 + 4 * HOUR), false);
  assert.equal(s.court.finalize('case:001', 'authority:crown_guard', T0 + 4 * HOUR).ok, false);
  assert.equal(s.court.isFinal('case:001', T0 + 9 * HOUR), true);
  const f = s.court.finalize('case:001', 'authority:crown_guard', T0 + 9 * HOUR);
  assert.equal(f.ok, true);
  if (!f.ok) return;
  assert.equal(f.legalCase.status, 'final');
  assert.equal(s.audit.find('case_final').length, 1);
});

test('تقرير المحكمة يعدّ الأحكام والبراءات والحالات', () => {
  const s = prepared();
  assert.equal(charge(s).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, { guilty: false, penalty: 'none', reason: 'الدليل لا يكفي' }, T0 + 3 * MIN).ok, true);
  const rep = s.court.report();
  assert.equal(rep.total, 1);
  assert.equal(rep.acquittals, 1);
  assert.equal(rep.convictions, 0);
  assert.equal(rep.byStatus.ruled, 1);
});
