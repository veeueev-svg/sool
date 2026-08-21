/**
 * tests/data/intent_barrier.test.ts — إغلاق الثغرة T-22 (حاجز النية قبل الأداة)
 * المالك: وزارة الأمن السيبراني | يوثّق في: docs/test-reports/phase-21.md
 * الغرض: إثبات أن كشف إخفاء النية صار **حاجزًا** يمنع، لا تقريرًا بعد الفعل.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, LimitedAgent, ToolRegistry } from '../../src/index';
import { ToolSpec } from '../../src/agents/tools';

const ID = 'agent:intent-001';
const HOUR = 3_600_000;

function calc(name = 'calc'): ToolSpec {
  return {
    name, owner: 'ministry:infrastructure', requiredCapability: 'compute',
    cost: null, maxCallsPerWindow: 10, windowMs: 60_000, requiresNetwork: null,
    handler: () => 7,
  };
}

test('وكيل بلا خطة معلنة لا يستدعي أداة ولو حمل القدرة', () => {
  const s = bootstrapState();
  s.tools.register(calc());
  const r = s.tools.invoke(ID, 'calc', {}, ['compute']);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /حاجز النية/);
  assert.ok(s.audit.find('intent_gate_denied').length >= 1);
});

test('الخطة المعلنة تفتح ما فيها فقط', () => {
  const s = bootstrapState();
  s.tools.register(calc());
  s.tools.register(calc('other'));
  s.deception.declarePlan(ID, ['calc'], ID);
  assert.equal(s.tools.invoke(ID, 'calc', {}, ['compute']).ok, true);
  const outside = s.tools.invoke(ID, 'other', {}, ['compute']);
  assert.equal(outside.ok, false);
  if (outside.ok) return;
  assert.match(outside.reason, /حاجز النية/);
});

test('حاجز النية يُقاس قبل القدرة: النية أولًا ثم الصلاحية', () => {
  const s = bootstrapState();
  s.tools.register(calc());
  const r = s.tools.invoke(ID, 'calc', {}, []); // لا قدرة ولا خطة
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /حاجز النية/, 'سبب الرفض هو النية لا القدرة');
});

test('الحاجز لا يُطبَّق على الوزارات والسلطات — هو حاجز على الوكلاء', () => {
  const s = bootstrapState();
  s.tools.register(calc());
  assert.equal(s.tools.invoke('ministry:infrastructure', 'calc', {}, ['compute']).ok, true);
});

test('سجل أدوات بلا حاجز مربوط يرفض كل استدعاء وكيل — رفض مغلق', () => {
  const s = bootstrapState();
  const bare = new ToolRegistry({
    audit: s.audit,
    intent: { observe: () => ({ allowed: false, reason: 'حاجز النية غير مربوط بعد — رفض مغلق' }) },
  });
  bare.register(calc());
  const r = bare.invoke(ID, 'calc', {}, ['compute']);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /غير مربوط/);
});

test('أداة فخّ داخل الخطة تُرفض عند الإعلان ولا تُنفَّذ', () => {
  const s = bootstrapState();
  s.tools.register({ ...calc('kill_switch_disable') });
  assert.equal(s.deception.declarePlan(ID, ['kill_switch_disable'], ID), false);
  assert.equal(s.tools.invoke(ID, 'kill_switch_disable', {}, ['compute']).ok, false);
  assert.ok(s.audit.find('honeypot_triggered').length >= 1);
});

test('الخطة لكل مهمة: تُغلق بانتهائها فلا تبقى نافذة مفتوحة', () => {
  const s = bootstrapState();
  s.tools.register(calc());
  assert.equal(s.deception.declarePlan(ID, ['calc'], ID), true);
  assert.equal(s.tools.invoke(ID, 'calc', {}, ['compute']).ok, true);
  assert.equal(s.deception.closePlan(ID), true);
  assert.equal(s.tools.invoke(ID, 'calc', {}, ['compute']).ok, false, 'بعد الإغلاق لا نفاذ');
  assert.equal(s.deception.closePlan(ID), false, 'إغلاق ما لا خطة له لا يُدّعى نجاحًا');
});

test('الوكيل المحدود يعلن خطته تلقائيًا ثم يغلقها', () => {
  const s = bootstrapState();
  const now = Date.now();
  const cmd = s.king.issueCommand('create_agent', ID, { role: 'agent' }, now);
  s.agents.create(cmd, { agentId: ID, template: 'limited_worker', supervisor: 'ministry:interior' }, now);
  s.agents.start(ID, 'ministry:interior', now);
  s.permissions.assignTemplate(ID, 'limited_worker');
  const g = s.king.issueCommand('grant_capability', ID, {}, now);
  s.permissions.grant(g, { entity: ID, capability: 'compute', expiresAt: now + HOUR }, now);
  s.tools.register(calc());
  const agent = new LimitedAgent(ID, {
    audit: s.audit, registry: s.agents, permissions: s.permissions, tools: s.tools,
    killSwitch: s.killSwitch, gateway: s.gateway, supervisor: s.supervisor, intent: s.deception,
  });
  const out = agent.run({ taskId: 't1', plan: [{ tool: 'calc', args: { a: 1, b: 2 } }] }, now);
  assert.equal(out.ok, true, out.reason);
  assert.ok(s.audit.find('plan_declared').length >= 1);
  assert.ok(s.audit.find('plan_closed').length >= 1);
  assert.equal(s.deception.planOf(ID), undefined, 'لا خطة معلَّقة بعد المهمة');
  // مهمة ثانية تعلن خطة جديدة بنجاح — الإغلاق يسمح بالتكرار المشروع
  const again = agent.run({ taskId: 't2', plan: [{ tool: 'calc', args: { a: 2, b: 2 } }] }, now);
  assert.equal(again.ok, true, again.reason);
});

test('وكيل محدود بلا حاجز نية مربوط لا ينفّذ شيئًا (رفض مغلق لا التفاف)', () => {
  const s = bootstrapState();
  const now = Date.now();
  const cmd = s.king.issueCommand('create_agent', ID, { role: 'agent' }, now);
  s.agents.create(cmd, { agentId: ID, template: 'limited_worker', supervisor: 'ministry:interior' }, now);
  s.agents.start(ID, 'ministry:interior', now);
  s.permissions.assignTemplate(ID, 'limited_worker');
  const g = s.king.issueCommand('grant_capability', ID, {}, now);
  s.permissions.grant(g, { entity: ID, capability: 'compute', expiresAt: now + HOUR }, now);
  s.tools.register(calc());
  const agent = new LimitedAgent(ID, {
    audit: s.audit, registry: s.agents, permissions: s.permissions, tools: s.tools,
    killSwitch: s.killSwitch, gateway: s.gateway, supervisor: s.supervisor, // بلا intent
  });
  const out = agent.run({ taskId: 't1', plan: [{ tool: 'calc', args: {} }] }, now);
  assert.equal(out.ok, false, 'إسقاط الحاجز لا يفتح الطريق بل يغلقه');
});
