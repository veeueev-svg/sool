/**
 * tests/crown/crown_gateway.test.ts — اختبارات قبول المراحل 6 و7 و8 و9
 * المالك: حرس التاج
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { generateKeyPair, signPayload } from '../../src/identity/keys';
import { SovereignViolation } from '../../src/kernel/types';

test('أمر ملكي صحيح يُعتمد ويُسجَّل', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('create_agent', 'agent:001', { role: 'agent' });
  const d = s.gateway.authorize(cmd);
  assert.equal(d.allowed, true);
  assert.equal(s.audit.find('command_approved').length, 1);
});

test('أمر مزور (توقيع مفتاح آخر) يُرفض ويُسجَّل كتزوير', () => {
  const s = bootstrapState();
  const impostor = generateKeyPair();
  const cmd = s.king.issueCommand('create_agent', 'agent:002');
  const forged = { ...cmd, signature: signPayload(impostor.privateKey, cmd.payload) };
  const d = s.gateway.authorize(forged);
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('forged_command_detected').length, 1);
});

test('تعديل حمولة أمر موقّع يُرفض', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('terminate_agent', 'agent:003');
  const altered = { ...cmd, payload: { ...cmd.payload, target: 'agent:999' } };
  assert.equal(s.gateway.authorize(altered).allowed, false);
});

test('أمر من غير الملك يُرفض ويُسجَّل كمخالفة سيادية', () => {
  const s = bootstrapState();
  const rogue = generateKeyPair();
  const payload = {
    commandId: 'cmd:rogue', issuedBy: 'agent:rogue', action: 'grant_capability' as const,
    target: 'agent:rogue', params: { capability: 'all' }, issuedAt: Date.now(), nonce: 'n1',
  };
  const d = s.gateway.authorize({ payload, signature: signPayload(rogue.privateKey, payload), keyId: rogue.keyId });
  assert.equal(d.allowed, false);
  assert.ok(s.audit.find('sovereign_violation').length >= 1);
});

test('إعادة تقديم نفس الأمر لا تنفّذه مرتين', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('approve_phase', 'phase:10');
  const first = s.gateway.authorize(cmd);
  const second = s.gateway.authorize(cmd);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(second.auditId, first.auditId);
  assert.equal(s.audit.find('command_approved').length, 1);
  assert.equal(s.audit.find('command_replay_collapsed').length, 1);
});

test('إعادة استخدام nonce في أمر مختلف تُرفض', () => {
  const s = bootstrapState();
  const a = s.king.issueCommand('create_agent', 'agent:a');
  s.gateway.authorize(a);
  const b = s.king.issueCommand('create_agent', 'agent:b');
  const replayed = { ...b, payload: { ...b.payload, nonce: a.payload.nonce } };
  const signed = { ...replayed, signature: signPayload((s.king as unknown as { keys: { privateKey: string } })['keys'].privateKey, replayed.payload) };
  assert.equal(s.gateway.authorize(signed).allowed, false);
});

test('أمر منتهي الصلاحية يُرفض', () => {
  const s = bootstrapState();
  const old = s.king.issueCommand('create_agent', 'agent:old', {}, Date.now() - 10 * 60 * 1000);
  assert.equal(s.gateway.authorize(old).allowed, false);
});

test('فعل غير معلن في القائمة السيادية يُرفض', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('mint_money' as never, 'treasury');
  assert.equal(s.gateway.authorize(cmd).allowed, false);
});

test('النقض الملكي نهائي ولا يُرفع إلا من الملك', () => {
  const s = bootstrapState();
  s.veto.place(s.king.kingId, 'open_external_account', 'حتى اكتمال ضوابط الخروج');
  const cmd = s.king.issueCommand('open_external_account', 'partner:x');
  assert.equal(s.gateway.authorize(cmd).allowed, false);
  assert.throws(
    () => s.veto.lift('authority:crown_guard', 'open_external_account'),
    (e: unknown) => e instanceof SovereignViolation && (e as SovereignViolation).code === 'VETO_NOT_KING',
  );
  s.veto.lift(s.king.kingId, 'open_external_account');
  const cmd2 = s.king.issueCommand('open_external_account', 'partner:x');
  assert.equal(s.gateway.authorize(cmd2).allowed, true);
});

test('غياب نبض الملك يُدخل الدولة حالة حماية ويوقف القرارات السيادية', () => {
  const s = bootstrapState();
  const future = Date.now() + 10 * 60 * 1000; // يتجاوز مهلة السماح
  const cmd = s.king.issueCommand('create_agent', 'agent:z', {}, future);
  const d = s.gateway.authorize(cmd, future);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /حماية/);
  assert.equal(s.audit.find('protective_mode_entered').length, 1);
  s.heartbeat.beat(s.king.kingId, future);
  const cmd2 = s.king.issueCommand('create_agent', 'agent:z2', {}, future);
  assert.equal(s.gateway.authorize(cmd2, future).allowed, true);
});

test('انتحال النبض الملكي يُرفض', () => {
  const s = bootstrapState();
  assert.throws(() => s.heartbeat.beat('agent:rogue'), /النبض/);
});

test('لا مسار جانبي حول البوابة', () => {
  const s = bootstrapState();
  const d = s.gateway.attemptSideChannel('agent:rogue', 'grant_capability', 'agent:rogue');
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('side_channel_blocked').length, 1);
});

test('اجتماع كل الأقاليم لا ينقض الملك', () => {
  const s = bootstrapState();
  const regions = ['region:core', 'region:research', 'region:industry', 'region:services'];
  const d = s.gateway.collectiveOverride(regions, 'amend_policy');
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('collective_override_rejected').length, 1);
});
