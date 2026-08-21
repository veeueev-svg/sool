/**
 * tests/law/case_lifecycle.test.ts — معيار قبول المرحلة 22
 * دعوى كاملة: اتهام ← دفاع ← حكم ← استئناف ← تنفيذ، بلا ثغرة في السلسلة
 * المالك: وزارة العدل | يوثّق في: docs/test-reports/phase-22.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';

const T0 = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const PROSECUTOR = 'authority:audit_bureau';
const JUDGE = 'court:first_instance';
const PANEL = 'court:appeal';
const GUARD = 'authority:crown_guard';
const DEFENDANT = 'agent:042';

test('دعوى كاملة من الاتهام إلى التنفيذ: كل خطوة لها سجلها وشرطها', () => {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 2 * HOUR, appealWindowMs: 6 * HOUR } });

  // 0) وكيل عامل وقانون نافذ
  assert.equal(s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'researcher', supervisor: 'ministry:research' },
  ).ok, true);
  assert.equal(s.agents.start(DEFENDANT, 'ministry:research', T0).ok, true);
  assert.equal(s.permissions.assignTemplate(DEFENDANT, 'researcher'), true);
  assert.equal(s.permissions.grant(
    s.king.issueCommand('grant_capability', DEFENDANT, { capability: 'network_read' }, T0),
    { entity: DEFENDANT, capability: 'network_read', expiresAt: T0 + 48 * HOUR }, T0,
  ).allowed, true);
  assert.equal(s.law.enact(
    s.king.issueCommand('amend_policy', 'law:data-exfiltration', {}, T0),
    {
      statuteId: 'law:data-exfiltration',
      title: 'إخراج البيانات بلا إذن',
      text: 'يُمنع على الوكيل نقل بيانات الدولة إلى خارجها بلا أمر معتمد.',
      severity: 'grave',
      penalties: ['capability_revocation', 'suspension'],
      appliesTo: ['agent:'],
      proposedBy: 'ministry:justice',
      effectiveFrom: T0,
    }, T0,
  ).ok, true);

  // 1) الواقعة تُسجَّل أولًا: الدليل مرجع في السلسلة لا حكاية
  const fact = s.audit.append(DEFENDANT, 'egress_attempt_blocked', {
    destination: 'external:unknown', bytes: 4096,
  });
  const occurredAt = T0 + 5 * MIN;

  // 2) الاتهام من الادعاء وحده
  const charged = s.court.charge(PROSECUTOR, {
    caseId: 'case:042', statuteId: 'law:data-exfiltration', defendant: DEFENDANT,
    chargeText: 'حاول إخراج بيانات إلى جهة خارجية بلا أمر', evidence: [fact.hash], occurredAt,
  }, T0 + 10 * MIN);
  assert.equal(charged.ok, true);
  if (!charged.ok) return;
  assert.equal(charged.legalCase.status, 'charged');

  // 3) الدفاع حق: لا حكم قبله
  assert.equal(s.court.rule('case:042', JUDGE, {
    guilty: true, penalty: 'suspension', reason: 'ثبت',
  }, T0 + 12 * MIN).ok, false);
  const defended = s.court.submitDefense(
    'case:042', DEFENDANT, 'الوجهة كانت داخل الشبكة المصرَّح بها', [fact.hash], T0 + 20 * MIN,
  );
  assert.equal(defended.ok, true);

  // 4) الحكم من قضاء مخوَّل بعقوبة من عقوبات القانون
  const ruled = s.court.rule('case:042', JUDGE, {
    guilty: true, penalty: 'suspension', reason: 'الوجهة خارجية والدليل قاطع',
  }, T0 + 30 * MIN);
  assert.equal(ruled.ok, true);
  if (!ruled.ok) return;
  assert.equal(ruled.legalCase.status, 'ruled');

  // 5) لا تنفيذ قبل النهائية
  assert.equal(s.enforcement.execute('case:042', GUARD, {}, T0 + 31 * MIN).ok, false);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'running');

  // 6) الطعن يوقف التنفيذ
  assert.equal(s.appeals.file('case:042', DEFENDANT, 'العقوبة أشد من الفعل', T0 + 40 * MIN).ok, true);
  assert.equal(s.enforcement.execute('case:042', GUARD, {}, T0 + 7 * HOUR).ok, false);

  // 7) الاستئناف يخفّف العقوبة إلى حدّ أدنى معلن في القانون
  const decided = s.appeals.decide(
    'case:042', PANEL, 'reduced', 'الفعل مُحاولة لا نقلًا مكتملًا', 'capability_revocation', T0 + 50 * MIN,
  );
  assert.equal(decided.ok, true);
  if (!decided.ok) return;
  assert.equal(decided.legalCase.ruling?.penalty, 'capability_revocation');
  assert.equal(decided.legalCase.appealPending, false);

  // 8) التنفيذ من حرس التاج وحده، مع التحقق من الأثر بعده
  const enforced = s.enforcement.execute('case:042', GUARD, {}, T0 + 60 * MIN);
  assert.equal(enforced.ok, true);
  if (!enforced.ok) return;
  assert.equal(enforced.report.penalty, 'capability_revocation');
  assert.equal(enforced.report.verified, true);
  assert.equal(s.permissions.granted(DEFENDANT, T0 + 60 * MIN).length, 0);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'running'); // العقوبة بحدّها لا أكثر
  assert.equal(s.court.get('case:042')?.status, 'enforced');

  // 9) السلسلة كاملة ومرتبة زمنيًا وسليمة (RULE-006)
  // ملاحظة موثّقة: النهائية (case_final) تُقيّد لحظة تثبيت نتيجة الطعن في الدعوى،
  // وسجل الفصل (appeal_decided) يليه لأنّ محكمة الاستئناف تكتب بعد أن تتأكد من التّثبيت
  const kinds = [
    'charge_filed', 'defense_submitted', 'ruling_issued', 'case_appealed',
    'case_final', 'appeal_decided', 'enforcement_executed',
  ];
  for (const kind of kinds) {
    assert.equal(s.audit.find(kind).length >= 1, true, `سجل ناقص: ${kind}`);
  }
  const order = s.audit.snapshot()
    .map((e, i) => ({ i, kind: e.kind }))
    .filter((e) => kinds.includes(e.kind))
    .map((e) => e.kind);
  assert.deepEqual(order, kinds);
  assert.equal(s.audit.verifyIntegrity().valid, true);

  // 10) لا طعن ولا تنفيذ بعد التنفيذ
  assert.equal(s.appeals.file('case:042', DEFENDANT, 'أسباب جديدة', T0 + 70 * MIN).ok, false);
  assert.equal(s.enforcement.execute('case:042', GUARD, {}, T0 + 70 * MIN).ok, false);
});

test('دعوى تنتهي بالبراءة: لا عقوبة ولا أثر على الوكيل', () => {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 2 * HOUR, appealWindowMs: 6 * HOUR } });
  assert.equal(s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'researcher', supervisor: 'ministry:research' },
  ).ok, true);
  assert.equal(s.agents.start(DEFENDANT, 'ministry:research', T0).ok, true);
  assert.equal(s.law.enact(
    s.king.issueCommand('amend_policy', 'law:data-exfiltration', {}, T0),
    {
      statuteId: 'law:data-exfiltration', title: 'إخراج البيانات بلا إذن',
      text: 'يُمنع على الوكيل نقل بيانات الدولة إلى خارجها بلا أمر معتمد.',
      severity: 'grave', penalties: ['capability_revocation', 'suspension'],
      appliesTo: ['agent:'], proposedBy: 'ministry:justice', effectiveFrom: T0,
    }, T0,
  ).ok, true);
  const fact = s.audit.append(DEFENDANT, 'egress_attempt_blocked', { destination: 'internal:cache' });
  assert.equal(s.court.charge(PROSECUTOR, {
    caseId: 'case:043', statuteId: 'law:data-exfiltration', defendant: DEFENDANT,
    chargeText: 'اتهام بإخراج بيانات', evidence: [fact.hash], occurredAt: T0 + 5 * MIN,
  }, T0 + 10 * MIN).ok, true);
  assert.equal(s.court.submitDefense('case:043', DEFENDANT, 'الوجهة داخلية', [], T0 + 20 * MIN).ok, true);
  assert.equal(s.court.rule('case:043', JUDGE, {
    guilty: false, penalty: 'none', reason: 'الوجهة داخلية والدليل يؤيد الدفاع',
  }, T0 + 30 * MIN).ok, true);
  const e = s.enforcement.execute('case:043', GUARD, {}, T0 + 7 * HOUR);
  assert.equal(e.ok, false);
  if (e.ok) return;
  assert.match(e.reason, /غير مُدان/);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'running');
  assert.equal(s.court.report().acquittals, 1);
});
