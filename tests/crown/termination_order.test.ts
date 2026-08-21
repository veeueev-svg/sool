/**
 * tests/crown/termination_order.test.ts — اختبار قبول المرحلة 9 (الإنهاء الجماعي)
 * المالك: حرس التاج | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { TerminationOrder, EntityController } from '../../src/crown/termination_order';
import { EntityId } from '../../src/kernel/types';

/** متحكّم اختباري: يمكن جعل بعض الكيانات ترفض التوقف */
function controller(entities: EntityId[], stubborn: EntityId[] = []): EntityController {
  const running = new Set(entities);
  return {
    list: () => [...running],
    stop: (e) => {
      if (stubborn.includes(e)) return false;
      running.delete(e);
      return true;
    },
    isRunning: (e) => running.has(e),
  };
}

test('أمر إنهاء جماعي معتمد يوقف كل الكيانات ويؤكّد توقفها', () => {
  const s = bootstrapState();
  const ctrl = controller(['agent:1', 'agent:2', 'agent:3']);
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, ctrl, s.resources);
  const cmd = s.king.issueCommand('terminate_agent', 'all');

  const report = order.execute(cmd);
  assert.equal(report.executed, true);
  assert.equal(report.complete, true);
  assert.deepEqual([...report.stopped].sort(), ['agent:1', 'agent:2', 'agent:3']);
  assert.equal(report.failed.length, 0);
  assert.equal(ctrl.list().length, 0);
  assert.equal(s.audit.find('mass_termination_complete').length, 1);
});

test('الإنهاء يستعيد كل موارد الكيانات المنتهية', () => {
  const s = bootstrapState();
  s.resources.lease('agent:1', 'compute_units', 5);
  s.resources.lease('agent:2', 'compute_units', 3);
  const order = new TerminationOrder(
    s.audit, s.gateway, s.killSwitch, controller(['agent:1', 'agent:2']), s.resources,
  );
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));
  assert.equal(report.resourcesReclaimed, 2);
  assert.equal(s.resources.usageOf('agent:1', 'compute_units'), 0);
});

test('كيان يرفض التوقف يمنع إعلان النجاح ويُشغّل احتواءً وتصعيدًا', () => {
  const s = bootstrapState();
  const ctrl = controller(['agent:1', 'agent:2'], ['agent:2']);
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, ctrl, s.resources);

  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));
  assert.equal(report.complete, false);
  assert.deepEqual(report.failed, ['agent:2']);
  assert.equal(s.killSwitch.status.engaged, true, 'إيقاف شامل وقائي');
  assert.equal(s.audit.find('mass_termination_incomplete').length, 1);
  assert.ok(s.audit.find('escalated_to_king').length >= 1);
});

test('أمر إنهاء غير موقّع من الملك لا يُنفَّذ إطلاقًا', () => {
  const s = bootstrapState();
  const ctrl = controller(['agent:1']);
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, ctrl, s.resources);
  const cmd = s.king.issueCommand('terminate_agent', 'all');
  const forged = { ...cmd, payload: { ...cmd.payload, issuedBy: 'agent:rogue' } };

  const report = order.execute(forged);
  assert.equal(report.executed, false);
  assert.equal(ctrl.list().length, 1, 'لا كيان توقف');
  assert.equal(s.audit.find('mass_termination_refused').length, 1);
});

test('قائمة أهداف محددة في المعاملات تُحترم دون غيرها', () => {
  const s = bootstrapState();
  const ctrl = controller(['agent:1', 'agent:2', 'agent:3']);
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, ctrl, s.resources);
  const cmd = s.king.issueCommand('terminate_agent', 'all', { targets: 'agent:1,agent:3' });

  const report = order.execute(cmd);
  assert.deepEqual([...report.targeted].sort(), ['agent:1', 'agent:3']);
  assert.deepEqual(ctrl.list(), ['agent:2']);
  assert.equal(report.complete, true);
});

test('استثناء من متحكّم الكيانات يُعامل كعدم توقف لا كنجاح', () => {
  const s = bootstrapState();
  const ctrl: EntityController = {
    list: () => ['agent:x'],
    stop: () => { throw new Error('تعذّر الوصول إلى الكيان'); },
    isRunning: () => true,
  };
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, ctrl, s.resources);
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));
  assert.equal(report.complete, false);
  assert.deepEqual(report.failed, ['agent:x']);
  assert.equal(s.audit.find('termination_error').length, 1);
});
