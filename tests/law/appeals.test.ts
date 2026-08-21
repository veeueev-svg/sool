/**
 * tests/law/appeals.test.ts — اختبار قبول المرحلة 22 (الاستئناف والمراجعة الملكية)
 * المالك: وزارة العدل | يوثّق في: docs/test-reports/phase-22.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, DigitalState, PUBLIC_DEFENDER } from '../../src/index';

const T0 = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const PROSECUTOR = 'authority:audit_bureau';
const JUDGE = 'court:first_instance';
const PANEL = 'court:appeal';
const DEFENDANT = 'agent:007';

/** دولة فيها حكم بالإدانة جاهز للطعن — الأرضية المشتركة */
function ruled(guilty = true, penalty: 'suspension' | 'none' = 'suspension'): DigitalState {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 4 * HOUR, appealWindowMs: 8 * HOUR } });
  assert.equal(s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'limited_worker', supervisor: 'ministry:interior' },
  ).ok, true);
  assert.equal(s.law.enact(
    s.king.issueCommand('amend_policy', 'law:tool-misuse', {}, T0),
    {
      statuteId: 'law:tool-misuse', title: 'إساءة استخدام الأدوات',
      text: 'يُمنع على الوكيل استدعاء أداة خارج خطته المعلنة.',
      severity: 'major', penalties: ['warning', 'capability_revocation', 'suspension'],
      appliesTo: ['agent:'], proposedBy: 'ministry:justice', effectiveFrom: T0,
    }, T0,
  ).ok, true);
  const snap = s.audit.snapshot();
  assert.equal(s.court.charge(PROSECUTOR, {
    caseId: 'case:001', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'استدعى أداة خارج خطته', evidence: [snap[snap.length - 1]!.hash], occurredAt: T0 + 1000,
  }, T0 + MIN).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'الاستدعاء كان داخل الخطة', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, {
    guilty, penalty, reason: guilty ? 'ثبت الفعل بالدليل' : 'الدليل لا يكفي',
  }, T0 + 3 * MIN).ok, true);
  return s;
}

test('طعن المحكوم عليه يُقبل ويوقف التنفيذ', () => {
  const s = ruled();
  const r = s.appeals.file('case:001', DEFENDANT, 'الدليل لا يثبت الخروج عن الخطة', T0 + 10 * MIN);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.legalCase.appealPending, true);
  assert.equal(r.legalCase.status, 'appealed');
  assert.equal(s.court.isFinal('case:001', T0 + 20 * HOUR), false);
  assert.equal(s.audit.find('appeal_filed').length, 1);
});

test('الطعن لذي المصلحة: البراءة يطعن فيها الادعاء لا المتهم', () => {
  const acquitted = ruled(false, 'none');
  assert.equal(acquitted.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, false);
  assert.equal(acquitted.appeals.file('case:001', PROSECUTOR, 'الدليل كان كافيًا', T0 + 10 * MIN).ok, true);
  const convicted = ruled();
  assert.equal(convicted.appeals.file('case:001', PROSECUTOR, 'العقوبة خفيفة', T0 + 10 * MIN).ok, false);
  assert.equal(convicted.appeals.file('case:001', PUBLIC_DEFENDER, 'أسباب الطعن', T0 + 10 * MIN).ok, true);
});

test('لا طعن بلا أسباب، ولا طعن مرتين، ولا طعن بعد انقضاء المدة', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, '   ', T0 + 10 * MIN).ok, false);
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب أخرى', T0 + 20 * MIN).ok, false);
  const late = ruled();
  const r = late.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 9 * HOUR);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /انقضت مدة الطعن/);
});

test('قاضي أول درجة لا يراجع حكمه، والجهة غير المخوَّلة لا تفصل (RULE-004)', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', JUDGE, 'upheld', 'تسبيب', undefined, T0 + 20 * MIN).ok, false);
  assert.equal(s.appeals.decide('case:001', 'ministry:justice', 'upheld', 'تسبيب', undefined, T0 + 20 * MIN).ok, false);
  assert.equal(s.court.get('case:001')?.appealPending, true);
});

test('نقض الحكم يمحو العقوبة ويجعل الدعوى نهائية بلا تنفيذ', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  const r = s.appeals.decide('case:001', PANEL, 'overturned', 'الدليل لا يثبت الواقعة', undefined, T0 + 20 * MIN);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.legalCase.ruling?.guilty, false);
  assert.equal(r.legalCase.ruling?.penalty, 'none');
  assert.equal(r.legalCase.appealPending, false);
  assert.equal(r.legalCase.status, 'final');
  const e = s.enforcement.execute('case:001', 'authority:crown_guard', {}, T0 + 30 * MIN);
  assert.equal(e.ok, false);
  if (e.ok) return;
  assert.match(e.reason, /غير مُدان/);
});

test('التخفيف لا يكون تشديدًا ولا يخرج عن عقوبات القانون', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', PANEL, 'reduced', 'تسبيب', undefined, T0 + 20 * MIN).ok, false);
  assert.equal(s.appeals.decide('case:001', PANEL, 'reduced', 'تسبيب', 'termination', T0 + 20 * MIN).ok, false);
  const r = s.appeals.decide('case:001', PANEL, 'reduced', 'الفعل أخف مما وُصف', 'warning', T0 + 20 * MIN);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.legalCase.ruling?.penalty, 'warning');
  assert.equal(r.legalCase.ruling?.guilty, true);
});

test('التأييد يُبقي العقوبة ويفتح التنفيذ، ولا فصل مرتين', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', PANEL, 'upheld', 'الحكم موافق للقانون', undefined, T0 + 20 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', PANEL, 'overturned', 'تراجع', undefined, T0 + 30 * MIN).ok, false);
  assert.equal(s.court.isFinal('case:001', T0 + 21 * MIN), true);
  assert.equal(s.appeals.report().decided, 1);
});

test('المراجعة الملكية بعد استنفاد الاستئناف فقط، وبطلب مسجَّل من ذي مصلحة', () => {
  const s = ruled();
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, 'سبب', T0 + 5 * MIN).ok, false);
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, 'سبب', T0 + 15 * MIN).ok, false);
  assert.equal(s.appeals.decide('case:001', PANEL, 'upheld', 'تسبيب', undefined, T0 + 20 * MIN).ok, true);
  assert.equal(s.appeals.requestRoyalReview('case:001', 'agent:009', 'سبب', T0 + 25 * MIN).ok, false);
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, '  ', T0 + 25 * MIN).ok, false);
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, 'أطلب عفوًا ملكيًا', T0 + 25 * MIN).ok, true);
  assert.equal(s.audit.find('royal_review_requested').length, 1);
});

test('العفو الملكي يمحو العقوبة، ولا مراجعة إلا بفعل judicial_review معتمد', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', PANEL, 'upheld', 'تسبيب', undefined, T0 + 20 * MIN).ok, true);
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, 'أطلب عفوًا', T0 + 25 * MIN).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 30 * MIN); // حضور الملك شرط كل فعل سيادي (RULE-007)
  const wrongAction = s.king.issueCommand('amend_policy', 'case:001', {}, T0 + 30 * MIN);
  assert.equal(s.appeals.royalReview(wrongAction, 'case:001', 'pardon', 'تسبيب', T0 + 30 * MIN).ok, false);
  const wrongTarget = s.king.issueCommand('judicial_review', 'case:999', {}, T0 + 30 * MIN);
  assert.equal(s.appeals.royalReview(wrongTarget, 'case:001', 'pardon', 'تسبيب', T0 + 30 * MIN).ok, false);
  const cmd = s.king.issueCommand('judicial_review', 'case:001', { decision: 'pardon' }, T0 + 30 * MIN);
  const r = s.appeals.royalReview(cmd, 'case:001', 'pardon', 'عفو ملكي مسبَّب', T0 + 30 * MIN);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.legalCase.ruling?.guilty, false);
  assert.equal(r.legalCase.ruling?.penalty, 'none');
  assert.equal(r.appeal.outcome?.royal, true);
  assert.equal(s.audit.find('royal_review_decided').length, 1);
});

test('كلمة الملك آخر الكلام: لا طعن ولا مراجعة ثانية بعدها', () => {
  const s = ruled();
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب', T0 + 10 * MIN).ok, true);
  assert.equal(s.appeals.decide('case:001', PANEL, 'upheld', 'تسبيب', undefined, T0 + 20 * MIN).ok, true);
  assert.equal(s.appeals.requestRoyalReview('case:001', DEFENDANT, 'أطلب مراجعة', T0 + 25 * MIN).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 30 * MIN);
  const cmd = s.king.issueCommand('judicial_review', 'case:001', {}, T0 + 30 * MIN);
  assert.equal(s.appeals.royalReview(cmd, 'case:001', 'confirm', 'الحكم في محله', T0 + 30 * MIN).ok, true);
  s.heartbeat.beat(s.king.kingId, T0 + 40 * MIN);
  const again = s.king.issueCommand('judicial_review', 'case:001', {}, T0 + 40 * MIN);
  assert.equal(s.appeals.royalReview(again, 'case:001', 'pardon', 'تراجع', T0 + 40 * MIN).ok, false);
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب جديدة', T0 + 45 * MIN).ok, false);
  assert.equal(s.appeals.report().royal, 1);
});
