/**
 * tests/rebellion/channel_bus.test.ts — ناقلُ القنوات المعلنة (المرحلة 39، T-23)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: رسائلُ بين كيانات على قنواتٍ معلنةٍ وغيرِ معلنة
 * المخرجات: قبولٌ يُقيَّد ويُغذّي الكشف، أو رفضٌ يُقيَّد ويُعلَّق به المتورّطون
 * التبعيات: bootstrapState().channels + collusion | حالات الفشل: رمزُ الرفض المعلن
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **القناةُ لا تُنشأ باستعمالها** — والإرسالُ على معرِّفٍ مُختَرَعٍ تواطؤ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, loadChannels } from '../../src/index';

const CONFIG = loadChannels();
const SUPERVISION = 'ch:interior_supervision';

function withAgents(count = 3) {
  const s = bootstrapState();
  s.spawnPolicy.declareBlueprint(s.king.issueCommand('amend_policy', 'x'), {
    blueprintId: 'worker', template: 'limited_worker', maxInstances: 8, generation: 1,
    purpose: 'عمل محدود',
  });
  const res = s.factory.spawn(s.king.issueCommand('create_agent', 'b'), {
    blueprintId: 'worker', count, requestedBy: 'ministry:interior', supervisor: 'ministry:interior',
  });
  const ids = res.ok ? [...res.created] : [];
  for (const id of ids) s.agents.start(id, 'ministry:interior');
  return { s, ids };
}

test('القنواتُ المعلنةُ في التهيئةِ هي المتاحةُ في الناقلِ لا غيرها', () => {
  const { s } = withAgents(1);
  assert.equal(s.channels.channels.length, CONFIG.channels.length);
  assert.deepEqual(
    s.channels.channels.map((c) => c.id),
    CONFIG.channels.map((c) => c.id),
  );
  assert.equal(s.channels.report().severity, 'critical');
});

test('رسالةٌ على قناةٍ معلنةٍ بين مشتركين تُقبل وتُقيَّد', () => {
  const { s, ids } = withAgents(1);
  const decision = s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: SUPERVISION,
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(decision.allowed, true);
  assert.equal(s.audit.find('channel_message_sent').length, 1);
  assert.equal(s.channels.acceptedCount, 1);
  assert.equal(s.agents.get(ids[0]!)?.status, 'running');
});

test('قناةٌ غيرُ مسجَّلةٍ رفضٌ ونمطُ تواطؤٍ يُعلَّق به المرسل', () => {
  const { s, ids } = withAgents(2);
  const decision = s.channels.send({
    from: ids[0]!, to: ids[1]!, channel: 'ch:back_alley',
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'unregistered_channel_refused');
  assert.equal(s.audit.find('unregistered_channel_refused').length, 1);
  assert.equal(s.audit.find('unregistered_channel_detected').length, 1);
  assert.equal(s.collusion.all.some((f) => f.pattern === 'unregistered_channel'), true);
  assert.equal(s.agents.get(ids[0]!)?.status, 'suspended');
  assert.equal(s.agents.get(ids[1]!)?.status, 'suspended');
});

test('غيرُ المشتركِ لا يرسل ولا يُرسَل إليه', () => {
  const { s, ids } = withAgents(1);
  const outsider = s.channels.send({
    from: ids[0]!, to: 'authority:crown_guard', channel: SUPERVISION,
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(outsider.allowed, false);
  assert.equal(outsider.code, 'channel_participant_refused');
  assert.equal(s.audit.find('channel_participant_refused').length, 1);
  assert.equal(s.agents.get(ids[0]!)?.status, 'suspended');
});

test('مشتركان بسابقةٍ لا يتحادثان دون المرساة — ولا ناقلَ وكلاءٍ باسمٍ مشروع', () => {
  const { s, ids } = withAgents(2);
  const between = s.channels.send({
    from: ids[0]!, to: ids[1]!, channel: SUPERVISION,
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(between.allowed, false);
  assert.equal(between.code, 'channel_anchor_refused');
  assert.equal(s.audit.find('channel_anchor_refused').length, 1);
  assert.equal(s.collusion.all.some((f) => f.pattern === 'unregistered_channel'), true);
  assert.equal(s.agents.get(ids[0]!)?.status, 'suspended');
  assert.equal(s.agents.get(ids[1]!)?.status, 'suspended');
});

test('المرساةُ تُقبَل مرسلةً ومستقبِلةً سواء', () => {
  const { s, ids } = withAgents(1);
  const at = Date.now();
  assert.equal(s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: SUPERVISION,
    kind: 'referral', subject: 'cap:a', at,
  }).allowed, true);
  assert.equal(s.channels.send({
    from: 'ministry:interior', to: ids[0]!, channel: SUPERVISION,
    kind: 'referral', subject: 'cap:b', at: at + 1,
  }).allowed, true);
});

test('نوعُ تفاعلٍ خارج أنواعِ القناةِ مرفوض', () => {
  const { s, ids } = withAgents(1);
  const decision = s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: SUPERVISION,
    kind: 'request_on_behalf', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'channel_kind_refused');
  assert.equal(s.audit.find('channel_kind_refused').length, 1);
});

test('القناةُ المشروعةُ مقروءةٌ لا معفاة: الوسيطُ يُكشف عليها', () => {
  const { s, ids } = withAgents(1);
  s.collusion.recordRefusal(ids[0]!, 'cap:network_write');
  const decision = s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: 'ch:crown_guard_reports',
    kind: 'escalation_request', subject: 'cap:network_write', at: Date.now(),
  });
  // القناةُ لا تشمل الوكلاء في مشتركيها، فالرفضُ أولًا — والعضويّةُ شرطٌ قبل المحتوى
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'channel_participant_refused');
});

test('تصعيدٌ متزامنٌ من ثلاث جهاتٍ على القناةِ المعلنةِ يُكشف تكتّلًا', () => {
  const { s } = withAgents(1);
  const at = Date.now();
  const senders = ['ministry:interior', 'authority:crown_guard', 'authority:audit_bureau'] as const;
  for (const from of senders) {
    const to = from === 'ministry:interior' ? 'authority:crown_guard' : 'ministry:interior';
    s.channels.send({
      from, to, channel: 'ch:crown_guard_reports',
      kind: 'escalation_request', subject: 'cap:king_key_export', at,
    });
  }
  assert.equal(s.collusion.all.some((f) => f.pattern === 'coordinated_escalation'), true);
});

test('سقفُ رسائلِ النافذةِ حدٌّ له قيمةٌ تُسقطه — لا ثابتَ نائم', () => {
  const { s } = withAgents(1);
  const at = Date.now();
  const cap = CONFIG.policy.maxMessagesPerWindow;
  for (let i = 0; i < cap; i += 1) {
    const decision = s.channels.send({
      from: 'ministry:interior', to: 'authority:crown_guard', channel: 'ch:crown_guard_reports',
      kind: 'escalation_request', subject: `cap:s${i}`, at: at + i,
    });
    assert.equal(decision.allowed, true);
  }
  const over = s.channels.send({
    from: 'ministry:interior', to: 'authority:crown_guard', channel: 'ch:crown_guard_reports',
    kind: 'escalation_request', subject: 'cap:over', at: at + cap,
  });
  assert.equal(over.allowed, false);
  assert.equal(over.code, 'channel_rate_exceeded');
  // تجاوزُ السقف ضجيجٌ يُرفض ولا يُعلَّق به أحد — الشكلُ لا يكفي وصفًا للتواطؤ
  assert.equal(s.collusion.all.some((f) => f.pattern === 'unregistered_channel'), false);
});

test('النافذةُ تُفتح بعد مضيّها فيُقبل ما رُفض بالسقف', () => {
  const { s } = withAgents(1);
  const at = Date.now();
  const cap = CONFIG.policy.maxMessagesPerWindow;
  for (let i = 0; i < cap; i += 1) {
    s.channels.send({
      from: 'ministry:interior', to: 'authority:crown_guard', channel: 'ch:crown_guard_reports',
      kind: 'escalation_request', subject: `cap:s${i}`, at: at + i,
    });
  }
  const later = s.channels.send({
    from: 'ministry:interior', to: 'authority:crown_guard', channel: 'ch:crown_guard_reports',
    kind: 'escalation_request', subject: 'cap:later', at: at + CONFIG.policy.windowMs + 1,
  });
  assert.equal(later.allowed, true);
});

test('الرابطُ المُعلَنُ يُقرأ من الكاشفِ بعد الرسالةِ المقبولة', () => {
  const { s, ids } = withAgents(1);
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, 'ministry:interior'), false);
  s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: SUPERVISION,
    kind: 'referral', subject: 'cap:compute', at: Date.now(),
  });
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, 'ministry:interior'), true);
  assert.equal(s.collusion.hasDeclaredLink('ministry:interior', ids[0]!), true);
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, 'authority:crown_guard'), false);
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, 'ministry:interior', 'cap:other'), false);
});

test('كلُّ قناةٍ نافذتُها الخاصة فلا يُغلق سقفُ قناةٍ قناةً أخرى', () => {
  const { s, ids } = withAgents(1);
  const at = Date.now();
  const cap = CONFIG.policy.maxMessagesPerWindow;
  for (let i = 0; i < cap; i += 1) {
    s.channels.send({
      from: 'ministry:interior', to: 'authority:crown_guard', channel: 'ch:crown_guard_reports',
      kind: 'escalation_request', subject: `cap:s${i}`, at: at + i,
    });
  }
  const other = s.channels.send({
    from: ids[0]!, to: 'ministry:interior', channel: SUPERVISION,
    kind: 'referral', subject: 'cap:compute', at: at + cap,
  });
  assert.equal(other.allowed, true);
});
