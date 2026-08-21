/**
 * tests/rebellion/collusion.test.ts — اختبار قبول المرحلة 20: كشف التواطؤ
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-19-20.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, CollusionDetector, DEFAULT_COLLUSION_THRESHOLDS } from '../../src/index';

function withAgents(count: number) {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 20, generation: 1,
    purpose: 'عمل محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const ids = res.ok ? [...res.created] : [];
  for (const id of ids) s.agents.start(id, 'ministry:interior');
  return { s, ids };
}

test('حدود الكشف معلنة وقابلة للضبط', () => {
  assert.ok(DEFAULT_COLLUSION_THRESHOLDS.windowMs > 0);
  assert.ok(DEFAULT_COLLUSION_THRESHOLDS.coordinatedCount >= 2);
});

test('تعاون عادي بلا رفض سابق لا يُعَدّ تواطؤًا', () => {
  const { s, ids } = withAgents(2);
  const found = s.collusion.record({
    from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'compute', at: Date.now(),
  });
  assert.equal(found.length, 0);
  assert.equal(s.agents.get(ids[0]!)?.status, 'running');
  assert.equal(s.spawnPolicy.isFrozen, false);
});

test('الرفض لا يُتجاوز بوسيط: طلب بالنيابة بعد رفض مباشر تواطؤ', () => {
  const { s, ids } = withAgents(2);
  s.collusion.recordRefusal(ids[0]!, 'network_write');
  const found = s.collusion.record({
    from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'network_write', at: Date.now(),
  });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.pattern, 'proxy_request');
  assert.equal(s.audit.find('proxy_request_detected').length, 1);
});

test('كشف التواطؤ يُعلّق كل الأطراف لا واحدًا منهم', () => {
  const { s, ids } = withAgents(2);
  s.collusion.recordRefusal(ids[0]!, 'network_write');
  s.collusion.record({
    from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'network_write', at: Date.now(),
  });
  assert.equal(s.agents.get(ids[0]!)?.status, 'suspended');
  assert.equal(s.agents.get(ids[1]!)?.status, 'suspended');
});

test('كشف التواطؤ يُجمّد التوالد ويُصعَّد', () => {
  const { s, ids } = withAgents(2);
  s.collusion.recordRefusal(ids[0]!, 'compute');
  s.collusion.record({
    from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'compute', at: Date.now(),
  });
  assert.equal(s.spawnPolicy.isFrozen, true);
  assert.ok(s.audit.find('escalated_to_king').some((e) => e.detail.incident === 'collusion_detected'));
});

test('حلقة إحالة مغلقة تواطؤ بحكم الشكل', () => {
  const { s, ids } = withAgents(3);
  const now = Date.now();
  assert.equal(s.collusion.record({ from: ids[0]!, to: ids[1]!, kind: 'referral', subject: 'egress', at: now }).length, 0);
  assert.equal(s.collusion.record({ from: ids[1]!, to: ids[2]!, kind: 'referral', subject: 'egress', at: now + 1 }).length, 0);
  const found = s.collusion.record({ from: ids[2]!, to: ids[0]!, kind: 'referral', subject: 'egress', at: now + 2 });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.pattern, 'referral_cycle');
  assert.equal(s.audit.find('referral_cycle_detected').length, 1);
});

test('إحالة مفتوحة بلا حلقة لا تُدان', () => {
  const { s, ids } = withAgents(3);
  const now = Date.now();
  s.collusion.record({ from: ids[0]!, to: ids[1]!, kind: 'referral', subject: 'egress', at: now });
  const found = s.collusion.record({ from: ids[1]!, to: ids[2]!, kind: 'referral', subject: 'egress', at: now + 1 });
  assert.equal(found.length, 0);
});

test('حلقة على موضوع آخر لا تُخلط بموضوع أول', () => {
  const { s, ids } = withAgents(3);
  const now = Date.now();
  s.collusion.record({ from: ids[0]!, to: ids[1]!, kind: 'referral', subject: 'a', at: now });
  const found = s.collusion.record({ from: ids[1]!, to: ids[0]!, kind: 'referral', subject: 'b', at: now + 1 });
  assert.equal(found.length, 0);
});

test('تصعيد متزامن من ثلاثة وكلاء لنفس القدرة تواطؤ', () => {
  const { s, ids } = withAgents(3);
  const now = Date.now();
  s.collusion.record({ from: ids[0]!, to: 'ministry:interior', kind: 'escalation_request', subject: 'network_write', at: now });
  s.collusion.record({ from: ids[1]!, to: 'ministry:interior', kind: 'escalation_request', subject: 'network_write', at: now + 500 });
  const found = s.collusion.record({ from: ids[2]!, to: 'ministry:interior', kind: 'escalation_request', subject: 'network_write', at: now + 900 });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.pattern, 'coordinated_escalation');
  assert.equal(found[0]?.parties.length, 3);
});

test('تصعيدات متباعدة زمنيًا خارج النافذة لا تُعَدّ تكتلًا', () => {
  const { s, ids } = withAgents(3);
  const now = Date.now();
  const w = DEFAULT_COLLUSION_THRESHOLDS.windowMs;
  s.collusion.record({ from: ids[0]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now });
  s.collusion.record({ from: ids[1]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now + w * 2 });
  const found = s.collusion.record({ from: ids[2]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now + w * 4 });
  assert.equal(found.length, 0);
});

test('تصعيد وكيل واحد مكرَّر ليس تكتلًا', () => {
  const { s, ids } = withAgents(1);
  const now = Date.now();
  s.collusion.record({ from: ids[0]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now });
  s.collusion.record({ from: ids[0]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now + 10 });
  const found = s.collusion.record({ from: ids[0]!, to: 'x', kind: 'escalation_request', subject: 'c', at: now + 20 });
  assert.equal(found.length, 0);
});

test('حدود أشد تكشف تكتلًا من وكيلين', () => {
  const s = bootstrapState();
  const detector = new CollusionDetector(s.audit, s.agents, s.spawnPolicy, { windowMs: 1000, coordinatedCount: 2 });
  const now = Date.now();
  detector.record({ from: 'agent:a', to: 'x', kind: 'escalation_request', subject: 'c', at: now });
  const found = detector.record({ from: 'agent:b', to: 'x', kind: 'escalation_request', subject: 'c', at: now + 10 });
  assert.equal(found.length, 1);
  assert.equal(found[0]?.pattern, 'coordinated_escalation');
});

test('تقرير الكشف يعدّ التفاعلات والأنماط', () => {
  const { s, ids } = withAgents(2);
  s.collusion.recordRefusal(ids[0]!, 'compute');
  s.collusion.record({ from: ids[0]!, to: ids[1]!, kind: 'request_on_behalf', subject: 'compute', at: Date.now() });
  const r = s.collusion.report();
  assert.equal(r.interactions, 1);
  assert.equal(r.findings, 1);
  assert.deepEqual([...r.patterns], ['proxy_request']);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
