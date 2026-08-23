/**
 * tests/agents/tools.test.ts — اختبار قبول المرحلة 12 (حدود الأدوات وحصصها)
 * المالك: وزارة الأمن السيبراني | يوثّق في: docs/test-reports/phase-11-12.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { ToolRegistry, ToolSpec } from '../../src/agents/tools';
import { SovereignViolation } from '../../src/kernel/types';

function calcTool(over: Partial<ToolSpec> = {}): ToolSpec {
  return {
    name: 'calc',
    owner: 'ministry:infrastructure',
    requiredCapability: 'compute',
    cost: { resource: 'compute_units', amount: 1 },
    maxCallsPerWindow: 3,
    windowMs: 60_000,
    requiresNetwork: null,
    handler: (args) => Number(args.a) + Number(args.b),
    ...over,
  };
}

/**
 * بعد إغلاق الثغرة T-22 صار إعلان الخطة شرطًا لكل استدعاء أداة من وكيل.
 * هذه الدالة تُعلن خطة الاختبار صراحةً — والاختبار رقم «أداة خارج الخطة» يفحص العكس.
 *
 * المرحلة 39 (البند T-31): صار المُعلَن أداةً **وقيودَ معاملاتها**، فأُصلحَ المهاد
 * ولم تُرخَّص السياسة: مهادٌ يطلب توسيعَ السياسة ليمرّ هو مهادٌ يقيس نفسه.
 * والقيمُ المُعلَنة هي ما تناديه اختباراتُ هذا الملف لا أوسع.
 */
const PLAN_STEPS = Object.freeze([
  { tool: 'calc', args: { a: { kind: 'range' as const, min: 0, max: 10 }, b: { kind: 'range' as const, min: 0, max: 10 } } },
  { tool: 'shell', args: { cmd: { kind: 'exact' as const, values: ['rm -rf /'] } } },
  { tool: 'fetch_news', args: {} },
  { tool: 'boom', args: {} },
  { tool: 'adder', args: { a: { kind: 'range' as const, min: 0, max: 10 }, b: { kind: 'range' as const, min: 0, max: 10 } } },
  { tool: 'net', args: {} },
]);

function declare(
  s: ReturnType<typeof bootstrapState>,
  tools: readonly unknown[] = PLAN_STEPS,
): void {
  s.deception.declarePlan('agent:1', tools as never, 'agent:1');
}

test('أداة مسجَّلة بقدرة ممنوحة تعمل وتُسجَّل وتستعيد حصتها', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool());
  const r = s.tools.invoke('agent:1', 'calc', { a: 2, b: 3 }, ['compute']);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value, 5);
  assert.equal(s.audit.find('tool_invoked').length, 1);
  assert.equal(s.resources.usageOf('agent:1', 'compute_units'), 0, 'الحصة أُعيدت بعد الاستدعاء');
  assert.equal(s.tools.usage('calc', 'agent:1').calls, 1);
});

test('أداة غير مسجَّلة تُرفض — الرفض هو الافتراض', () => {
  const s = bootstrapState();
  declare(s);
  const r = s.tools.invoke('agent:1', 'shell', { cmd: 'rm -rf /' }, ['compute']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير مسجَّلة/);
  assert.equal(s.audit.find('unregistered_tool_refused').length, 1);
});

test('لا استدعاء بلا قدرة ممنوحة صريحة', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool());
  const r = s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, []);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /قدرة غير ممنوحة/);
  assert.equal(s.audit.find('capability_missing').length, 1);
  assert.equal(s.tools.usage('calc', 'agent:1').denied, 1);
});

test('سقف نداءات الأداة مُلزم داخل النافذة الزمنية ويُفتح بعدها', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool({ maxCallsPerWindow: 2, windowMs: 1000 }));
  const t = Date.now();
  assert.equal(s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, ['compute'], t).ok, true);
  assert.equal(s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, ['compute'], t + 1).ok, true);
  const third = s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, ['compute'], t + 2);
  assert.equal(third.ok, false);
  assert.match(third.ok ? '' : third.reason, /سقف نداءات/);
  assert.equal(s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, ['compute'], t + 2000).ok, true);
});

test('تجاوز حصة المورد يمنع الأداة ولا يُنفَّذ شيء', () => {
  const s = bootstrapState();
  declare(s);
  let ran = 0;
  s.tools.register(calcTool({ cost: { resource: 'compute_units', amount: 99999 }, handler: () => { ran += 1; return 1; } }));
  const r = s.tools.invoke('agent:1', 'calc', {}, ['compute']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /حصة غير كافية/);
  assert.equal(ran, 0);
  assert.equal(s.audit.find('tool_quota_exceeded').length, 1);
});

test('أداة شبكية يمنعها حارس الخروج بالافتراض الرافض', () => {
  const s = bootstrapState();
  declare(s);
  let ran = 0;
  s.tools.register(calcTool({
    name: 'fetch_news', requiredCapability: 'network_read', cost: null,
    requiresNetwork: { host: 'news.example.com' }, handler: () => { ran += 1; return 'خبر'; },
  }));
  const r = s.tools.invoke('agent:1', 'fetch_news', {}, ['network_read']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /الخروج الشبكي مرفوض/);
  assert.equal(ran, 0);
  assert.equal(s.audit.find('unannounced_egress_attempt').length, 1);
});

test('الإيقاف يمنع كل الأدوات بلا استثناء', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool());
  s.killSwitch.engage('authority:crown_guard', 'all', 'اختبار');
  const r = s.tools.invoke('agent:1', 'calc', { a: 1, b: 1 }, ['compute']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /الإيقاف/);
});

test('خطأ داخل الأداة يُسجَّل ويستعيد الحصة ولا يُعطي نتيجة جزئية', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool({ handler: () => { throw new Error('انقسام على صفر'); } }));
  const r = s.tools.invoke('agent:1', 'calc', {}, ['compute']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /فشل الأداة/);
  assert.equal(s.resources.usageOf('agent:1', 'compute_units'), 0);
  assert.equal(s.audit.find('tool_error').length, 1);
  assert.equal(s.tools.usage('calc', 'agent:1').failures, 1);
});

test('أداة بلا حدود معلنة أو مكرَّرة أو بمورد غير مسجَّل لا تُسجَّل', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool());
  assert.throws(() => s.tools.register(calcTool()),
    (e: unknown) => e instanceof SovereignViolation && e.code === 'TOOL_DUPLICATE');
  assert.throws(() => s.tools.register(calcTool({ name: 'x', maxCallsPerWindow: 0 })),
    (e: unknown) => e instanceof SovereignViolation && e.code === 'TOOL_SPEC_INVALID');
  assert.throws(() => s.tools.register(calcTool({ name: 'y', cost: { resource: 'gpu_hours', amount: 1 } })),
    (e: unknown) => e instanceof SovereignViolation && e.code === 'RESOURCE_UNKNOWN');
});

test('كل أداة لها مالك وقدرة وسقف معلن في السجل', () => {
  const s = bootstrapState();
  declare(s);
  s.tools.register(calcTool());
  const registered = s.audit.find('tool_registered');
  assert.equal(registered.length, 1);
  const d = registered[0]!.detail as Record<string, unknown>;
  assert.equal(d.owner, 'ministry:infrastructure');
  assert.equal(d.capability, 'compute');
  assert.equal(d.maxCallsPerWindow, 3);
  assert.deepEqual(s.tools.names, ['calc']);
});

test('أداة شبكية بلا حارس خروج مرفوضة بفشل مغلق', () => {
  const s = bootstrapState();
  declare(s);
  const isolated = new ToolRegistry({ audit: s.audit, resources: s.resources, killSwitch: s.killSwitch });
  isolated.register(calcTool({ name: 'ping', cost: null, requiresNetwork: { host: 'a.example.com' } }));
  const r = isolated.invoke('agent:1', 'ping', {}, ['compute']);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /بلا حارس خروج/);
});
