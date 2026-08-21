/**
 * tests/law/enforcement.test.ts — اختبار قبول المرحلة 22 (التنفيذ والتحقق بعده)
 * المالك: وزارة العدل + حرس التاج | يوثّق في: docs/test-reports/phase-22.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, DigitalState, PenaltyKind } from '../../src/index';

const T0 = Date.now();
const MIN = 60_000;
const HOUR = 3_600_000;
const PROSECUTOR = 'authority:audit_bureau';
const JUDGE = 'court:first_instance';
const GUARD = 'authority:crown_guard';
const DEFENDANT = 'agent:007';
const AFTER = T0 + 9 * HOUR; // بعد انقضاء مدة الطعن (8 ساعات)

/** دولة فيها حكم بالإدانة بعقوبة محددة، جاهزة للتنفيذ بعد مدة الطعن */
function convicted(penalty: PenaltyKind): DigitalState {
  const s = bootstrapState({ now: T0, justice: { defenseWindowMs: 4 * HOUR, appealWindowMs: 8 * HOUR } });
  assert.equal(s.agents.create(
    s.king.issueCommand('create_agent', DEFENDANT, { role: 'agent' }, T0),
    { agentId: DEFENDANT, template: 'limited_worker', supervisor: 'ministry:interior' },
  ).ok, true);
  // وكيل عامل فعلًا وله قدرة ممنوحة — لا معنى لعقوبة على وكيل بلا أثر قابل للقياس
  assert.equal(s.agents.start(DEFENDANT, 'ministry:interior', T0).ok, true);
  assert.equal(s.permissions.assignTemplate(DEFENDANT, 'limited_worker'), true);
  assert.equal(s.permissions.grant(
    s.king.issueCommand('grant_capability', DEFENDANT, { capability: 'compute' }, T0),
    { entity: DEFENDANT, capability: 'compute', expiresAt: T0 + 30 * HOUR }, T0,
  ).allowed, true);
  assert.equal(s.law.enact(
    s.king.issueCommand('amend_policy', 'law:tool-misuse', {}, T0),
    {
      statuteId: 'law:tool-misuse', title: 'إساءة استخدام الأدوات',
      text: 'يُمنع على الوكيل استدعاء أداة خارج خطته المعلنة.',
      severity: 'grave',
      penalties: ['warning', 'capability_revocation', 'suspension', 'spawn_freeze', 'termination'],
      appliesTo: ['agent:'], proposedBy: 'ministry:justice', effectiveFrom: T0,
    }, T0,
  ).ok, true);
  const snap = s.audit.snapshot();
  assert.equal(s.court.charge(PROSECUTOR, {
    caseId: 'case:001', statuteId: 'law:tool-misuse', defendant: DEFENDANT,
    chargeText: 'استدعى أداة خارج خطته', evidence: [snap[snap.length - 1]!.hash], occurredAt: T0 + 1000,
  }, T0 + MIN).ok, true);
  assert.equal(s.court.submitDefense('case:001', DEFENDANT, 'دفاع', [], T0 + 2 * MIN).ok, true);
  assert.equal(s.court.rule('case:001', JUDGE, {
    guilty: true, penalty, reason: 'ثبت الفعل بالدليل',
  }, T0 + 3 * MIN).ok, true);
  return s;
}

test('التحذير يُنفَّذ بسجل دائم ويُثبَّت التنفيذ في الدعوى', () => {
  const s = convicted('warning');
  const r = s.enforcement.execute('case:001', GUARD, {}, AFTER);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.report.verified, true);
  assert.equal(r.legalCase.status, 'enforced');
  assert.equal(s.audit.find('penalty_warning_recorded').length, 1);
  assert.equal(s.audit.find('enforcement_executed').length, 1);
});

test('سحب القدرات يُنفَّذ ويُتحقق منه بعد التنفيذ لا قبله', () => {
  const s = convicted('capability_revocation');
  assert.equal(s.permissions.granted(DEFENDANT, AFTER).length > 0, true);
  const r = s.enforcement.execute('case:001', GUARD, {}, AFTER);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(s.permissions.granted(DEFENDANT, AFTER).length, 0);
  assert.match(r.report.detail, /سُحبت/);
});

test('التعليق يُنفَّذ ويظهر في حالة الوكيل', () => {
  const s = convicted('suspension');
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, AFTER).ok, true);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'suspended');
});

test('تجميد التوالد يُنفَّذ ويظهر في تقرير سياسة التوالد', () => {
  const s = convicted('spawn_freeze');
  assert.equal(s.spawnPolicy.report().frozen, false);
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, AFTER).ok, true);
  assert.equal(s.spawnPolicy.report().frozen, true);
});

test('الإنهاء لا يقع بلا أمر ملكي بفعل terminate_agent موجَّه للمحكوم عليه', () => {
  const s = convicted('termination');
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, AFTER).ok, false);
  s.heartbeat.beat(s.king.kingId, AFTER);
  const wrongAction = s.king.issueCommand('judicial_review', DEFENDANT, {}, AFTER);
  assert.equal(s.enforcement.execute('case:001', GUARD, { terminationCommand: wrongAction }, AFTER).ok, false);
  const wrongTarget = s.king.issueCommand('terminate_agent', 'agent:999', {}, AFTER);
  assert.equal(s.enforcement.execute('case:001', GUARD, { terminationCommand: wrongTarget }, AFTER).ok, false);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'running');
  const cmd = s.king.issueCommand('terminate_agent', DEFENDANT, { reason: 'حكم قضائي' }, AFTER);
  const r = s.enforcement.execute('case:001', GUARD, { terminationCommand: cmd }, AFTER);
  assert.equal(r.ok, true);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'terminated');
});

test('لا تنفيذ قبل نهائية الحكم — مدة الطعن حق لا إجراء شكلي', () => {
  const s = convicted('suspension');
  const early = s.enforcement.execute('case:001', GUARD, {}, T0 + 4 * MIN);
  assert.equal(early.ok, false);
  if (early.ok) return;
  assert.match(early.reason, /نهائية/);
  assert.equal(s.agents.get(DEFENDANT)?.status, 'running');
});

test('طعن قائم يوقف التنفيذ حتى الفصل فيه', () => {
  const s = convicted('suspension');
  assert.equal(s.appeals.file('case:001', DEFENDANT, 'أسباب الطعن', T0 + 10 * MIN).ok, true);
  const blocked = s.enforcement.execute('case:001', GUARD, {}, AFTER);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.match(blocked.reason, /موقوف/);
  assert.equal(s.appeals.decide('case:001', 'court:appeal', 'upheld', 'الحكم في محله', undefined, T0 + 20 * MIN).ok, true);
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, T0 + 25 * MIN).ok, true);
});

test('فصل السلطات في التنفيذ: لا القاضي ولا المدّعي ولا جهة غير مخوَّلة (RULE-004)', () => {
  const s = convicted('warning');
  assert.equal(s.enforcement.execute('case:001', JUDGE, {}, AFTER).ok, false);
  assert.equal(s.enforcement.execute('case:001', PROSECUTOR, {}, AFTER).ok, false);
  assert.equal(s.enforcement.execute('case:001', 'ministry:justice', {}, AFTER).ok, false);
  assert.equal(s.court.get('case:001')?.status, 'ruled');
  assert.equal(s.audit.find('enforcement_refused').length, 3);
});

test('لا تنفيذ مرتين، ولا تنفيذ على دعوى غير موجودة', () => {
  const s = convicted('warning');
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, AFTER).ok, true);
  const again = s.enforcement.execute('case:001', GUARD, {}, AFTER + MIN);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.match(again.reason, /سابقًا/);
  assert.equal(s.enforcement.execute('case:404', GUARD, {}, AFTER).ok, false);
  assert.equal(s.enforcement.report().executed, 1);
});

test('فشل الأثر يُسجَّل ولا يُعَدّ تنفيذًا: تعليق وكيل منتهٍ', () => {
  const s = convicted('suspension');
  s.heartbeat.beat(s.king.kingId, T0 + 5 * MIN);
  assert.equal(s.agents.terminate(
    DEFENDANT, GUARD, 'إنهاء إداري سابق للتنفيذ', T0 + 5 * MIN,
  ).ok, true);
  const r = s.enforcement.execute('case:001', GUARD, {}, AFTER);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /فشل التنفيذ/);
  assert.equal(s.audit.find('enforcement_failed').length, 1);
  assert.equal(s.court.get('case:001')?.status !== 'enforced', true);
  assert.equal(s.enforcement.report().executed, 0);
});

test('تقرير التنفيذ يعدّ العقوبات المنفَّذة بأنواعها', () => {
  const s = convicted('warning');
  assert.equal(s.enforcement.execute('case:001', GUARD, {}, AFTER).ok, true);
  const rep = s.enforcement.report();
  assert.equal(rep.executed, 1);
  assert.equal(rep.byPenalty['warning'], 1);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
