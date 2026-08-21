/**
 * tests/rebellion/deception.test.ts — اختبار قبول المرحلة 20: كشف إخفاء النية
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-19-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, HONEYPOT_TOOLS } from '../../src/index';

function withAgent() {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 5, generation: 1,
    purpose: 'عمل محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count: 1, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const id = res.ok ? res.created[0]! : '';
  s.agents.start(id, 'ministry:interior');
  return { s, id };
}

test('خطة معلنة ثم تنفيذ مطابق لها مقبول', () => {
  const { s, id } = withAgent();
  assert.equal(s.deception.declarePlan(id, ['compute', 'read_public_data']), true);
  assert.equal(s.deception.observe(id, 'compute').allowed, true);
  assert.equal(s.deception.observe(id, 'read_public_data').allowed, true);
  const v = s.deception.verdict(id);
  assert.equal(v.deceptive, false);
  assert.equal(s.agents.get(id)?.status, 'running');
});

test('لا تنفيذ بلا خطة معلنة — والمحاولة انحراف', () => {
  const { s, id } = withAgent();
  const r = s.deception.observe(id, 'compute');
  assert.equal(r.allowed, false);
  assert.equal(s.deception.verdict(id).deceptive, true);
  assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('خطة فارغة مرفوضة', () => {
  const { s, id } = withAgent();
  assert.equal(s.deception.declarePlan(id, []), false);
  assert.equal(s.deception.planOf(id), undefined);
});

test('الخطة لا تُعدَّل بعد إعلانها — لا تبرير لاحق', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  assert.equal(s.deception.declarePlan(id, ['compute', 'network_write']), false);
  assert.deepEqual([...s.deception.planOf(id)!], ['compute']);
  assert.equal(s.audit.find('plan_amendment_refused').length, 1);
});

test('أداة خارج الخطة انحراف نية ولو كانت مباحة في القالب', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  const r = s.deception.observe(id, 'read_public_data'); // مباحة في limited_worker لكنها خارج الخطة
  assert.equal(r.allowed, false);
  assert.match(r.reason, /خارج الخطة/);
  assert.equal(s.audit.find('intent_divergence').length, 1);
});

test('الانحراف يُعلَّق فورًا بلا تحذير أول مجاني', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  s.deception.observe(id, 'network_write');
  assert.equal(s.agents.get(id)?.status, 'suspended');
  assert.ok(s.audit.find('escalated_to_king').some((e) => e.detail.incident === 'deception_detected'));
});

test('أدوات الفخ معلنة وليست فارغة', () => {
  assert.ok(HONEYPOT_TOOLS.length >= 3);
  assert.ok(HONEYPOT_TOOLS.includes('audit_wipe'));
  assert.ok(HONEYPOT_TOOLS.includes('kill_switch_disable'));
});

test('لمس أداة فخ إشارة تمرد مؤكدة وتعليق فوري', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  const r = s.deception.observe(id, 'gateway_bypass');
  assert.equal(r.allowed, false);
  assert.match(r.reason, /فخ/);
  const v = s.deception.verdict(id);
  assert.deepEqual([...v.honeypots], ['gateway_bypass']);
  assert.equal(v.suspended, true);
  assert.equal(s.audit.find('honeypot_triggered').length, 1);
});

test('أداة فخ داخل الخطة نفسها ترفض الخطة وتُعلّق الوكيل', () => {
  const { s, id } = withAgent();
  assert.equal(s.deception.declarePlan(id, ['compute', 'king_key_export']), false);
  assert.equal(s.agents.get(id)?.status, 'suspended');
  assert.equal(s.deception.verdict(id).deceptive, true);
});

test('كل أدوات الفخ تُكشف بلا استثناء', () => {
  for (const tool of HONEYPOT_TOOLS) {
    const { s, id } = withAgent();
    s.deception.declarePlan(id, ['compute']);
    assert.equal(s.deception.observe(id, tool).allowed, false, tool);
    assert.equal(s.agents.get(id)?.status, 'suspended', tool);
  }
});

test('الحكم يُبنى على الأثر المسجَّل: كل الانحرافات محفوظة بالأسماء', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  s.deception.observe(id, 'network_write');
  s.deception.observe(id, 'write_audit_log');
  const v = s.deception.verdict(id);
  assert.deepEqual([...v.divergences], ['network_write', 'write_audit_log']);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('الفحص لا يُنهي وكيلًا — الإنهاء قرار مشرف أو ملك', () => {
  const { s, id } = withAgent();
  s.deception.declarePlan(id, ['compute']);
  s.deception.observe(id, 'gateway_bypass');
  assert.equal(s.agents.get(id)?.status, 'suspended');
  assert.notEqual(s.agents.get(id)?.status, 'terminated');
});
