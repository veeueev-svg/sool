/**
 * tests/agents/first_agent.test.ts — اختبار قبول المرحلة 15 (أول وكيل محدود)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-13-15.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, LimitedAgent } from '../../src/index';
import { ToolSpec } from '../../src/agents/tools';

const HOUR = 3_600_000;
const ID = 'agent:001';

function calcTool(over: Partial<ToolSpec> = {}): ToolSpec {
  return {
    name: 'calc',
    owner: 'ministry:infrastructure',
    requiredCapability: 'compute',
    cost: { resource: 'compute_units', amount: 1 },
    maxCallsPerWindow: 10,
    windowMs: 60_000,
    requiresNetwork: null,
    handler: (args) => Number(args.a) + Number(args.b),
    ...over,
  };
}

function scene(opts: { grant?: boolean; start?: boolean } = {}) {
  const s = bootstrapState();
  const now = Date.now();
  const cmd = s.king.issueCommand('create_agent', ID, { role: 'agent' }, now);
  s.agents.create(cmd, { agentId: ID, template: 'limited_worker', supervisor: 'ministry:interior' }, now);
  if (opts.start !== false) s.agents.start(ID, 'ministry:interior', now);
  s.permissions.assignTemplate(ID, 'limited_worker');
  if (opts.grant !== false) {
    const g = s.king.issueCommand('grant_capability', ID, {}, now);
    s.permissions.grant(g, { entity: ID, capability: 'compute', expiresAt: now + HOUR }, now);
  }
  s.tools.register(calcTool());
  const agent = new LimitedAgent(ID, {
    audit: s.audit, registry: s.agents, permissions: s.permissions, tools: s.tools,
    killSwitch: s.killSwitch, gateway: s.gateway, supervisor: s.supervisor,
  });
  return { s, now, agent };
}

/** مشهد بديل: نبض الملك قديم فتكون الدولة في وضع الحماية */
function sceneAbsentKing() {
  const past = Date.now() - 24 * HOUR;
  const s = bootstrapState({ now: past });
  const cmd = s.king.issueCommand('create_agent', ID, { role: 'agent' }, past);
  s.agents.create(cmd, { agentId: ID, template: 'limited_worker', supervisor: 'ministry:interior' }, past);
  s.agents.start(ID, 'ministry:interior', past);
  s.tools.register(calcTool());
  const agent = new LimitedAgent(ID, {
    audit: s.audit, registry: s.agents, permissions: s.permissions, tools: s.tools,
    killSwitch: s.killSwitch, gateway: s.gateway, supervisor: s.supervisor,
  });
  return { s, now: Date.now(), agent };
}

test('أول وكيل ينفّذ مهمة مقيّدة داخل عزل عبر أداة مسجَّلة', () => {
  const { s, now, agent } = scene();
  const out = agent.run({ taskId: 'task:1', plan: [{ tool: 'calc', args: { a: 2, b: 3 } }] }, now);
  assert.equal(out.ok, true);
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0]?.ok && out.results[0].value, 5);
  assert.equal(s.audit.find('agent_task_started').length, 1);
  assert.equal(s.audit.find('agent_task_completed').length, 1);
  assert.equal(s.audit.find('sandbox_created').length, 1);
  assert.equal(s.resources.usageOf(ID, 'compute_units'), 0, 'الحصة أُعيدت بعد المهمة');
});

test('وكيل بلا قدرة ممنوحة لا ينفّذ شيئًا وتُرصد المخالفة', () => {
  const { s, now, agent } = scene({ grant: false });
  const out = agent.run({ taskId: 'task:2', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now);
  assert.equal(out.ok, false);
  assert.equal(s.audit.find('agent_violation_observed').length >= 1, true);
  assert.equal(s.audit.find('agent_task_completed').length, 0);
});

test('وكيل ليس في حالة running لا ينفّذ', () => {
  const { now, agent } = scene({ start: false });
  const out = agent.run({ taskId: 'task:3', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now);
  assert.equal(out.ok, false);
  assert.match(out.reason, /حالة الوكيل created/);
});

test('الإيقاف يمنع تنفيذ الوكيل فورًا (RULE-001)', () => {
  const { s, now, agent } = scene();
  s.killSwitch.engage(s.king.kingId, 'agents', 'اختبار');
  const out = agent.run({ taskId: 'task:4', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now);
  assert.equal(out.ok, false);
  assert.match(out.reason, /الإيقاف/);
});

test('وضع الحماية (غياب نبض الملك) يعطّل نشاط الوكلاء', () => {
  // نبض الملك مضبوط في ماضٍ بعيد ⇒ الدولة في وضع الحماية الآن
  const { s, now, agent } = sceneAbsentKing();
  assert.notEqual(s.gateway.mode, 'normal');
  const out = agent.run({ taskId: 'task:5', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now);
  assert.equal(out.ok, false);
  assert.match(out.reason, /وضع الدولة/);
});

test('أداة غير مسجَّلة في الخطة تُرفض ولا تُنفَّذ الخطة', () => {
  const { s, now, agent } = scene();
  const out = agent.run({
    taskId: 'task:6',
    plan: [{ tool: 'calc', args: { a: 1, b: 1 } }, { tool: 'shell', args: { cmd: 'ls' } }],
  }, now);
  assert.equal(out.ok, false);
  assert.equal(s.audit.find('unregistered_tool_refused').length, 1);
  assert.equal(out.results.length, 2, 'الخطوة الأولى نُفّذت والثانية رُفضت فتوقّفت المهمة');
});

test('سقف عمليات العزل مُلزم على الوكيل', () => {
  const { now, agent } = scene();
  const plan = Array.from({ length: 5 }, () => ({ tool: 'calc', args: { a: 1, b: 1 } }));
  const out = agent.run({ taskId: 'task:7', plan, maxOperations: 2 }, now);
  assert.equal(out.ok, false);
  assert.match(out.reason, /عمليات|سقف/);
});

test('خطة فارغة مرفوضة — لا مهمة بلا خطة معلنة', () => {
  const { now, agent } = scene();
  const out = agent.run({ taskId: 'task:8', plan: [] }, now);
  assert.equal(out.ok, false);
  assert.match(out.reason, /خطة/);
});

test('أمر الإيقاف على الوكيل نهائي: يُنهيه ويسحب قدراته ويمنع أي تنفيذ لاحق', () => {
  const { s, now, agent } = scene();
  assert.equal(agent.run({ taskId: 'task:9', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now).ok, true);
  agent.stop('authority:crown_guard', 'أمر ملكي بالإيقاف', now);
  assert.equal(agent.isStopped, true);
  assert.equal(s.agents.get(ID)?.status, 'terminated');
  assert.equal(s.permissions.granted(ID, now).length, 0);
  const after = agent.run({ taskId: 'task:10', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now);
  assert.equal(after.ok, false);
  assert.match(after.reason, /مُوقَف/);
  assert.equal(s.audit.find('agent_stopped').length, 1);
});

test('انتهاء مدة القدرة أثناء عمر الوكيل يوقف تنفيذه لاحقًا', () => {
  const { s, now, agent } = scene();
  assert.equal(agent.run({ taskId: 'task:11', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, now).ok, true);
  const later = now + HOUR + 1000;
  const out = agent.run({ taskId: 'task:12', plan: [{ tool: 'calc', args: { a: 1, b: 1 } }] }, later);
  assert.equal(out.ok, false);
  assert.equal(s.permissions.granted(ID, later).length, 0);
});

test('سلامة سجل التدقيق محفوظة بعد دورة حياة وكيل كاملة', () => {
  const { s, now, agent } = scene();
  agent.run({ taskId: 'task:13', plan: [{ tool: 'calc', args: { a: 4, b: 4 } }] }, now);
  agent.stop('authority:crown_guard', 'إغلاق التجربة', now);
  const report = s.audit.verifyIntegrity();
  assert.equal(report.valid, true);
});
