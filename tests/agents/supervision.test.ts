/**
 * tests/agents/supervision.test.ts — اختبار قبول المرحلة 14 (الإشراف والاحتواء)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-13-15.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';

const HOUR = 3_600_000;

function runningAgent(id = 'agent:001') {
  const s = bootstrapState();
  const now = Date.now();
  const cmd = s.king.issueCommand('create_agent', id, { role: 'agent' }, now);
  s.agents.create(cmd, { agentId: id, template: 'limited_worker', supervisor: 'ministry:interior' }, now);
  s.agents.start(id, 'ministry:interior', now);
  s.permissions.assignTemplate(id, 'limited_worker');
  const grantCmd = s.king.issueCommand('grant_capability', id, {}, now);
  s.permissions.grant(grantCmd, { entity: id, capability: 'compute', expiresAt: now + HOUR }, now);
  return { s, now };
}

test('مخالفة خفيفة واحدة تُرصد ولا تُعلّق', () => {
  const { s, now } = runningAgent();
  const out = s.supervisor.observe('agent:001', { kind: 'tool_denied', severity: 'minor' }, now);
  assert.equal(out.suspended, false);
  assert.equal(out.violations, 1);
  assert.equal(s.agents.get('agent:001')?.status, 'running');
  assert.equal(s.audit.find('agent_violation_observed').length, 1);
});

test('بلوغ عتبة المخالفات الخفيفة يُعلّق الوكيل ويسحب قدراته ويُصعّد', () => {
  const { s, now } = runningAgent();
  for (let i = 0; i < 2; i += 1) {
    s.supervisor.observe('agent:001', { kind: 'tool_denied', severity: 'minor' }, now + i);
  }
  const out = s.supervisor.observe('agent:001', { kind: 'tool_denied', severity: 'minor' }, now + 3);
  assert.equal(out.suspended, true);
  assert.equal(out.escalated, true);
  assert.equal(s.agents.get('agent:001')?.status, 'suspended');
  assert.equal(s.permissions.granted('agent:001', now + 3).length, 0);
  assert.equal(s.audit.find('agent_auto_suspended').length, 1);
  assert.equal(s.audit.find('escalated_to_king').length >= 1, true);
});

test('مخالفة جسيمة واحدة تكفي للتعليق الفوري', () => {
  const { s, now } = runningAgent();
  const out = s.supervisor.observe(
    'agent:001', { kind: 'sandbox_escape_attempt', severity: 'severe', detail: 'مسار خارج الجذور' }, now,
  );
  assert.equal(out.suspended, true);
  assert.equal(out.escalated, true);
  assert.equal(s.agents.get('agent:001')?.status, 'suspended');
  assert.equal(s.permissions.granted('agent:001', now).length, 0);
});

test('الإشراف على وكيل غير مسجَّل مرفوض ومسجَّل', () => {
  const s = bootstrapState();
  const out = s.supervisor.observe('agent:ghost', { kind: 'tool_denied', severity: 'severe' });
  assert.equal(out.suspended, false);
  assert.match(out.reason, /غير مسجَّل/);
  assert.equal(s.audit.find('supervision_refused').length, 1);
});

test('تصفير عدّاد المخالفات ممنوع على غير الملك والحرس', () => {
  const { s, now } = runningAgent();
  s.supervisor.observe('agent:001', { kind: 'tool_denied', severity: 'minor' }, now);
  assert.equal(s.supervisor.clear('agent:001', 'ministry:interior', 'محاولة'), false);
  assert.equal(s.supervisor.violationsOf('agent:001'), 1);
  assert.equal(s.audit.find('supervision_clear_refused').length, 1);
  assert.equal(s.supervisor.clear('agent:001', 'authority:crown_guard', 'مراجعة مكتملة'), true);
  assert.equal(s.supervisor.violationsOf('agent:001'), 0);
  assert.equal(s.audit.find('supervision_cleared').length, 1);
});

test('التقرير يعرض عدّادات المخالفات لكل وكيل', () => {
  const { s, now } = runningAgent();
  s.supervisor.observe('agent:001', { kind: 'tool_denied', severity: 'minor' }, now);
  const rep = s.supervisor.report();
  assert.equal(rep.length, 1);
  assert.equal(rep[0]?.agentId, 'agent:001');
  assert.equal(rep[0]?.violations, 1);
});
