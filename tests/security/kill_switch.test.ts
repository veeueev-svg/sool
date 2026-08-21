/**
 * tests/security/kill_switch.test.ts — اختبارات قبول المرحلتين 9 و35
 * المالك: حرس التاج
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { SovereignViolation } from '../../src/kernel/types';

test('الإيقاف يمنع كل الأوامر إلا إعلان الطوارئ', () => {
  const s = bootstrapState();
  s.guard.emergencyHalt('اكتشاف سلوك تواطؤ');
  assert.equal(s.mode(), 'halted');
  assert.equal(s.gateway.authorize(s.king.issueCommand('create_agent', 'agent:x')).allowed, false);
  assert.equal(s.gateway.authorize(s.king.issueCommand('declare_emergency', 'state')).allowed, true);
});

test('رفع الإيقاف حق ملكي حصري', () => {
  const s = bootstrapState();
  s.guard.emergencyHalt('اختبار');
  assert.throws(
    () => s.killSwitch.release('authority:crown_guard', 'محاولة'),
    (e: unknown) => e instanceof SovereignViolation && (e as SovereignViolation).code === 'KILL_RELEASE_NOT_KING',
  );
  s.killSwitch.release(s.king.kingId, 'انتهى السبب');
  assert.equal(s.mode(), 'normal');
});

test('أمر إنهاء موقّع ينفَّذ ويُؤكَّد التوقف', () => {
  const s = bootstrapState();
  const res = s.guard.executeTermination(s.king.issueCommand('terminate_agent', 'agent:007'));
  assert.equal(res.executed, true);
  assert.equal(res.stoppedConfirmed, true);
  assert.equal(s.audit.find('termination_executed').length, 1);
});

test('أمر إنهاء غير موقّع من الملك يُرفض ولا يُنفَّذ', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('terminate_agent', 'agent:008');
  const forged = { ...cmd, payload: { ...cmd.payload, target: 'agent:009' } };
  const res = s.guard.executeTermination(forged);
  assert.equal(res.executed, false);
  assert.equal(s.audit.find('termination_executed').length, 0);
  assert.equal(s.audit.find('termination_refused').length, 1);
});

test('الإيقاف لا يُعلن ناجحًا قبل تأكيد توقف كل الكيانات', () => {
  const s = bootstrapState();
  s.guard.emergencyHalt('إيقاف شامل');
  s.killSwitch.confirmStopped('agent:1');
  const check = s.killSwitch.verifyStopped(['agent:1', 'agent:2']);
  assert.equal(check.complete, false);
  assert.deepEqual(check.missing, ['agent:2']);
});
