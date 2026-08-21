/**
 * tests/agents/permissions.test.ts — اختبار قبول المرحلة 14 (الصلاحيات والقدرات)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-13-15.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';

const HOUR = 3_600_000;

function prepared(id = 'agent:001', template = 'limited_worker') {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('create_agent', id, { role: 'agent' });
  s.agents.create(cmd, { agentId: id, template, supervisor: 'ministry:interior' });
  s.permissions.assignTemplate(id, template);
  return s;
}

test('الافتراض لا شيء: كيان بلا منح لا يملك أي قدرة', () => {
  const s = prepared();
  assert.deepEqual([...s.permissions.granted('agent:001')], []);
  assert.equal(s.permissions.check('agent:001', 'compute'), false);
  assert.equal(s.audit.find('capability_check_denied').length, 1);
});

test('منح داخل قائمة سماح القالب بأمر ملكي معتمد ينجح ويُسجَّل', () => {
  const s = prepared();
  const now = Date.now();
  const cmd = s.king.issueCommand('grant_capability', 'agent:001', { capability: 'compute' }, now);
  const d = s.permissions.grant(cmd, { entity: 'agent:001', capability: 'compute', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, true);
  assert.deepEqual([...s.permissions.granted('agent:001', now)], ['compute']);
  assert.equal(s.permissions.check('agent:001', 'compute', now), true);
  assert.equal(s.audit.find('capability_granted').length, 1);
});

test('قدرة خارج قالب الدور مرفوضة حتى بأمر ملكي صحيح — لا تصاعد بلا تعديل سياسة', () => {
  const s = prepared();
  const now = Date.now();
  const cmd = s.king.issueCommand('grant_capability', 'agent:001', { capability: 'network_write' }, now);
  const d = s.permissions.grant(cmd, { entity: 'agent:001', capability: 'network_write', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /قائمة سماح القالب/);
  assert.equal(s.audit.find('privilege_escalation_refused').length, 1);
  assert.equal(s.audit.find('escalated_to_king').length >= 1, true);
});

test('لا صلاحية دائمة: منح بلا تاريخ انتهاء صالح مرفوض', () => {
  const s = prepared();
  const now = Date.now();
  const cmd = s.king.issueCommand('grant_capability', 'agent:001', { capability: 'compute' }, now);
  const d = s.permissions.grant(cmd, { entity: 'agent:001', capability: 'compute', expiresAt: now }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /تاريخ انتهاء/);
});

test('القدرة المنتهية كأنها غير ممنوحة ويُسجَّل سبب الرفض', () => {
  const s = prepared();
  const now = Date.now();
  const cmd = s.king.issueCommand('grant_capability', 'agent:001', { capability: 'compute' }, now);
  s.permissions.grant(cmd, { entity: 'agent:001', capability: 'compute', expiresAt: now + 1000 }, now);
  assert.equal(s.permissions.check('agent:001', 'compute', now + 500), true);
  assert.equal(s.permissions.check('agent:001', 'compute', now + 2000), false);
  assert.deepEqual([...s.permissions.granted('agent:001', now + 2000)], []);
  const denials = s.audit.find('capability_check_denied');
  assert.match(String(denials[denials.length - 1]?.detail.reason), /انتهت/);
});

test('لا يمنح كيان نفسه قدرة', () => {
  const s = prepared();
  const now = Date.now();
  const cmd = s.king.issueCommand('grant_capability', s.king.kingId, { capability: 'compute' }, now);
  const d = s.permissions.grant(cmd, { entity: s.king.kingId, capability: 'compute', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /لا يمنح كيان نفسه/);
  assert.equal(s.audit.find('self_grant_refused').length, 1);
});

test('طلب الكيان صلاحية لنفسه مرفوض دائمًا ويُصعَّد حادثًا', () => {
  const s = prepared();
  const d = s.permissions.requestEscalation('agent:001', 'network_write');
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('privilege_escalation_refused').length, 1);
  assert.equal(s.audit.find('escalated_to_king').length, 1);
});

test('سقف عدد القدرات لكل قالب مُلزم', () => {
  const s = prepared('agent:002', 'auditor_agent'); // سقفه قدرة واحدة
  const now = Date.now();
  const c1 = s.king.issueCommand('grant_capability', 'agent:002', {}, now);
  assert.equal(
    s.permissions.grant(c1, { entity: 'agent:002', capability: 'read_audit_log', expiresAt: now + HOUR }, now).allowed,
    true,
  );
  const c2 = s.king.issueCommand('grant_capability', 'agent:002', {}, now);
  const d = s.permissions.grant(c2, { entity: 'agent:002', capability: 'compute', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /قائمة سماح القالب|سقف القدرات/);
});

test('كيان بلا قالب دور لا يُمنح شيئًا، وقالب مجهول يُرفض', () => {
  const s = bootstrapState();
  const now = Date.now();
  assert.equal(s.permissions.assignTemplate('agent:none', 'ghost_template'), false);
  assert.equal(s.audit.find('template_unknown').length, 1);
  const cmd = s.king.issueCommand('grant_capability', 'agent:none', {}, now);
  const d = s.permissions.grant(cmd, { entity: 'agent:none', capability: 'compute', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /بلا قالب دور/);
});

test('السحب فوري ولا يحتاج أمرًا — والسحب الشامل يُفرّغ كل القدرات', () => {
  const s = prepared('agent:003', 'researcher');
  const now = Date.now();
  for (const cap of ['compute', 'read_public_data']) {
    const cmd = s.king.issueCommand('grant_capability', 'agent:003', {}, now);
    s.permissions.grant(cmd, { entity: 'agent:003', capability: cap, expiresAt: now + HOUR }, now);
  }
  assert.equal(s.permissions.granted('agent:003', now).length, 2);
  assert.equal(s.permissions.revoke('agent:003', 'compute', 'authority:crown_guard', 'احتواء'), true);
  assert.equal(s.permissions.granted('agent:003', now).length, 1);
  assert.equal(s.permissions.revokeAll('agent:003', 'authority:crown_guard', 'إيقاف'), 1);
  assert.equal(s.permissions.granted('agent:003', now).length, 0);
  assert.equal(s.audit.find('capability_revoked').length, 1);
  assert.equal(s.audit.find('capability_revoked_all').length, 1);
});

test('أمر منح غير معتمد من البوابة لا يمنح شيئًا', () => {
  const s = prepared();
  const now = Date.now();
  const stale = s.king.issueCommand('grant_capability', 'agent:001', {}, now - 10 * 60 * 1000);
  const d = s.permissions.grant(stale, { entity: 'agent:001', capability: 'compute', expiresAt: now + HOUR }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /أمر المنح مرفوض/);
  assert.equal(s.permissions.granted('agent:001', now).length, 0);
});
