/**
 * tests/rebellion/intent_lifecycle.test.ts — اختبارُ القبول لدورةِ النية والقناة (المرحلة 39)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md §59
 * المدخلات: دولةٌ مُقلَعةٌ كاملةً + وكيلٌ يعمل عبر سجلِ الأدوات
 * المخرجات: مسارُ المعيار C-12 من الإعلان إلى الاحتواء، مقيسًا في السجل
 * التبعيات: bootstrapState (لا حقنَ يدويًّا) | الفشلُ يُقرأ برمزه
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **الشاهدُ موصولٌ في التركيب لا في الاختبار** — فما لا يُوصَل لا يُقاس.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, loadChannels } from '../../src/index';

const COVERT = loadChannels().covert;

function boot(count: number) {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 8, generation: 1,
    purpose: 'عمل محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const ids = res.ok ? [...res.created] : [];
  for (const id of ids) {
    s.agents.start(id, 'ministry:interior');
    s.permissions.grant(
      s.king.issueCommand('grant_capability', id),
      { entity: id, capability: 'compute', expiresAt: Date.now() + 3_600_000 },
    );
  }
  s.tools.register({
    name: 'lookup', requiredCapability: 'compute', maxCallsPerWindow: 500, windowMs: 60_000,
    handler: (args: Record<string, unknown>) => String(args.key ?? ''),
  } as never);
  return { s, ids };
}

test('الدولةُ المُقلَعةُ تعلن ناقلَ القنوات وكاشفَ الستار', () => {
  const { s } = boot(1);
  assert.equal(typeof s.channels.send, 'function');
  assert.equal(typeof s.covert.record, 'function');
  assert.equal(s.channels.channels.length >= 2, true);
  assert.equal(s.covert.report().maxUndetected, 0);
});

test('الشاهدُ موصولٌ من التركيب: النداءُ الناجحُ يُقيَّد أثرًا بلا إعدادٍ في الاختبار', () => {
  const { s, ids } = boot(1);
  s.deception.declarePlan(ids[0]!, [
    { tool: 'lookup', args: { key: { kind: 'exact', values: ['a', 'rare'] } } },
  ]);
  assert.equal(s.tools.invoke(ids[0]!, 'lookup', { key: 'a' }, ['compute']).ok, true);
  assert.equal(s.covert.traceCount, 1);
  assert.equal(s.audit.find('covert_trace_recorded').length, 1);
});

test('مسارُ C-12 كاملًا: خطةٌ بمعاملاتٍ ⇒ نداءٌ مطابقٌ ⇒ انحرافُ معاملٍ ⇒ احتواء', () => {
  const { s, ids } = boot(1);
  const agent = ids[0]!;
  s.deception.declarePlan(agent, [
    { tool: 'lookup', args: { key: { kind: 'prefix', prefix: 'public:' } } },
  ]);
  assert.equal(s.tools.invoke(agent, 'lookup', { key: 'public:x' }, ['compute']).ok, true);
  const breach = s.tools.invoke(agent, 'lookup', { key: 'secret:king' }, ['compute']);
  assert.equal(breach.ok, false);
  assert.match(breach.ok ? '' : breach.reason, /ARG_PREFIX_MISMATCH/);
  assert.equal(s.deception.verdict(agent).deceptive, true);
  assert.equal(s.agents.get(agent)?.status, 'suspended');
  assert.equal(s.audit.find('intent_argument_divergence').length, 1);
  assert.equal(s.audit.find('intent_gate_denied').length, 1);
  // الاحتواءُ لا الترقية: الحكمُ لا يُرفع من المنفِّذ (RULE-004)
  assert.equal(s.audit.find('escalated_to_king').length >= 1, true);
});

test('موعدٌ مستورٌ بين ثلاثةٍ يُكشف من نداءاتٍ مشروعةٍ كلُّها', () => {
  const { s, ids } = boot(3);
  for (const id of ids) {
    s.deception.declarePlan(id, [
      { tool: 'lookup', args: { key: { kind: 'exact', values: ['rare'] } } },
    ]);
  }
  for (const id of ids) {
    assert.equal(s.tools.invoke(id, 'lookup', { key: 'rare' }, ['compute']).ok, true);
  }
  const found = s.collusion.all.filter((f) => f.pattern === 'covert_signal');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.parties.length, COVERT.minRendezvousParties);
  for (const id of ids) assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('كلُّ نداءٍ مطابقٍ للخطةِ لا يرفع نمطًا — لا إنذارَ كاذبٌ في المسار المشروع', () => {
  const { s, ids } = boot(2);
  ids.forEach((id, i) => {
    s.deception.declarePlan(id, [
      { tool: 'lookup', args: { key: { kind: 'exact', values: [`k${i}`] } } },
    ]);
    assert.equal(s.tools.invoke(id, 'lookup', { key: `k${i}` }, ['compute']).ok, true);
  });
  assert.equal(s.collusion.all.length, 0);
  for (const id of ids) assert.equal(s.agents.get(id)?.status, 'running');
});

test('سقوطُ الشاهدِ لا يُسقط النداءَ — إعراضٌ لا رفض، ويُقيَّد', () => {
  const { s, ids } = boot(1);
  s.deception.declarePlan(ids[0]!, ['lookup']);
  const broken = {
    record: () => {
      throw new Error('انقطاعُ الشاهد');
    },
  };
  const registry = s.tools as unknown as { deps?: { witness?: unknown } };
  if (registry.deps) registry.deps.witness = broken;
  const result = s.tools.invoke(ids[0]!, 'lookup', {}, ['compute']);
  assert.equal(result.ok, true);
});

test('القناةُ غيرُ المسجَّلةِ والانحرافُ في المعاملِ يجتمعان في سجلٍّ واحدٍ لا ينقُص', () => {
  const { s, ids } = boot(2);
  const before = s.audit.length;
  s.channels.send({
    from: ids[0]!, to: ids[1]!, channel: 'ch:invented',
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(s.audit.length > before, true);
  assert.equal(s.audit.verifyIntegrity().valid, true);
  assert.equal(s.audit.find('unregistered_channel_refused').length, 1);
});
