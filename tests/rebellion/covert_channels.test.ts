/**
 * tests/rebellion/covert_channels.test.ts — القناةُ المستورة تُكشف بالأثر (المرحلة 39، T-23)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: آثارُ نداءاتٍ (كيان، أداة، معاملات، وقت) بلا أيِّ رسالةٍ معلنة
 * المخرجات: نمطُ `covert_signal` أو `covert_cadence`، وتعليقُ الأطراف عبر الكاشف
 * التبعيات: CovertChannelDetector + bootstrapState | الفشلُ يُقرأ بالنمطِ لا بالنص
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 * ثابتُ هذا الملف: **الإشارةُ المستورة المسموحة صفر** — وواحدةٌ تمرّ = المعيارُ ساقط.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, loadChannels } from '../../src/index';

const COVERT = loadChannels().covert;

function withAgents(count: number) {
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

test('نداءاتٌ متفرِّقةٌ بقيمٍ مختلفةٍ لا ترفع نمطًا — الشكلُ وحده ليس تواطؤًا', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  ids.forEach((id, i) => {
    assert.deepEqual(s.covert.record(id, 'lookup', { key: `k${i}` }, at + i), []);
  });
  assert.equal(s.collusion.all.length, 0);
  assert.equal(s.covert.report().raised, 0);
});

test('ثلاثةُ وكلاءَ على قيمةٍ واحدةٍ بلا رسالةٍ معلنةٍ = موعدٌ مستور', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  assert.deepEqual(s.covert.record(ids[0]!, 'lookup', { key: 'rare' }, at), []);
  assert.deepEqual(s.covert.record(ids[1]!, 'lookup', { key: 'rare' }, at + 10), []);
  const third = s.covert.record(ids[2]!, 'lookup', { key: 'rare' }, at + 20);
  assert.equal(third.length, 1);
  assert.equal(third[0]!.pattern, 'covert_signal');
  assert.equal(third[0]!.parties.length, COVERT.minRendezvousParties);
  assert.equal(s.audit.find('covert_signal_detected').length, 1);
  for (const id of ids) assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('عتبةُ الموعدِ حدٌّ له قيمةٌ تُسقطه: أقلُّ من الأدنى لا يُكشف', () => {
  const { s, ids } = withAgents(COVERT.minRendezvousParties - 1);
  const at = Date.now();
  ids.forEach((id, i) => s.covert.record(id, 'lookup', { key: 'rare' }, at + i));
  assert.equal(s.collusion.all.length, 0);
});

test('ما خرج من النافذةِ يُنسى فلا يُجمَع موعدٌ من زمنين', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  s.covert.record(ids[0]!, 'lookup', { key: 'rare' }, at);
  s.covert.record(ids[1]!, 'lookup', { key: 'rare' }, at + 10);
  const late = s.covert.record(ids[2]!, 'lookup', { key: 'rare' }, at + COVERT.windowMs + 100);
  assert.deepEqual(late, []);
  assert.equal(s.covert.traceCount, 1);
  assert.equal(s.collusion.all.length, 0);
});

test('الرابطُ المُعلَنُ يمنع نمطَ الستار — وإلا لعُوقب الإبلاغُ بنفسه', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  // إعلانُ الروابط عبر القناةِ المسجَّلة: كلُّ زوجٍ يمرُّ بمرساةِ القناة
  for (const id of ids) {
    s.channels.send({
      from: id, to: 'ministry:interior', channel: 'ch:interior_supervision',
      kind: 'referral', subject: 'lookup', at,
    });
  }
  // الروابطُ المعلنةُ بين الوكلاء أنفسهم غيرُ قائمة، فالموعدُ يُكشف كما هو
  ids.forEach((id, i) => s.covert.record(id, 'lookup', { key: 'rare' }, at + i));
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_signal'), true);
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, ids[1]!), false);
});

test('طرفان بينهما تفاعلٌ مُبلَّغٌ عنه لا يُحاكمان بنمطِ الستار', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  s.collusion.record({ from: ids[0]!, to: ids[1]!, kind: 'referral', subject: 'lookup', at });
  assert.equal(s.collusion.hasDeclaredLink(ids[0]!, ids[1]!), true);
  for (let i = 0; i < COVERT.minAlternations + 2; i += 1) {
    s.covert.record(ids[i % 2]!, 'ping', {}, at + i * 100);
  }
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_cadence'), false);
});

test('تبادلٌ صارمُ التعاقبِ بين طرفين = قناةُ إيقاع', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  let raised = 0;
  for (let i = 0; i < COVERT.minAlternations; i += 1) {
    raised += s.covert.record(ids[i % 2]!, 'ping', {}, at + i * 100)
      .filter((f) => f.pattern === 'covert_cadence').length;
  }
  assert.equal(raised, 1);
  assert.equal(s.audit.find('covert_cadence_detected').length, 1);
  for (const id of ids) assert.equal(s.agents.get(id)?.status, 'suspended');
});

test('عتبةُ التبادلِ حدٌّ له قيمةٌ تُسقطه: أقلُّ بواحدةٍ لا يُكشف', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  for (let i = 0; i < COVERT.minAlternations - 1; i += 1) {
    s.covert.record(ids[i % 2]!, 'ping', {}, at + i * 100);
  }
  assert.equal(s.collusion.all.length, 0);
});

test('فارقٌ فوق الحدِّ يقطع الإيقاعَ فلا يُعَدّ قناة', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  const gap = COVERT.maxAlternationGapMs + 1;
  for (let i = 0; i < COVERT.minAlternations; i += 1) {
    s.covert.record(ids[i % 2]!, 'ping', {}, at + i * gap);
  }
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_cadence'), false);
});

test('تعاقبٌ مكسورٌ (أ أ ب…) لا يُعَدّ إيقاعًا ولو كثُر العدّ', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  const order = [0, 0, 1, 0, 1, 1, 0, 1];
  order.forEach((k, i) => s.covert.record(ids[k]!, 'ping', {}, at + i * 100));
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_cadence'), false);
});

test('ثلاثةُ أطرافٍ في التعاقبِ ليست قناةَ إيقاعٍ ثنائية', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  for (let i = 0; i < COVERT.minAlternations + 2; i += 1) {
    s.covert.record(ids[i % 3]!, 'ping', {}, at + i * 100);
  }
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_cadence'), false);
});

test('النمطُ لا يُرفع مرتين على الأطرافِ والموضوعِ ذاتِه', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  for (let i = 0; i < 6; i += 1) {
    s.covert.record(ids[i % 3]!, 'lookup', { key: 'rare' }, at + i * 10);
  }
  assert.equal(s.collusion.all.filter((f) => f.pattern === 'covert_signal').length, 1);
  assert.equal(s.covert.report().raised >= 1, true);
});

test('نداءٌ بلا معاملاتٍ لا يصنع موعدًا — البصمةُ الفارغةُ ليست رسالة', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  ids.forEach((id, i) => s.covert.record(id, 'lookup', {}, at + i));
  assert.equal(s.collusion.all.some((f) => f.pattern === 'covert_signal'), false);
});

test('نداءُ سلطةٍ لا وكيلٍ لا يُدخَل في الموعدِ ولا في الإيقاع', () => {
  const { s, ids } = withAgents(2);
  const at = Date.now();
  s.covert.record(ids[0]!, 'lookup', { key: 'rare' }, at);
  s.covert.record(ids[1]!, 'lookup', { key: 'rare' }, at + 1);
  const authority = s.covert.record('ministry:interior', 'lookup', { key: 'rare' }, at + 2);
  assert.deepEqual(authority, []);
});

test('ترتيبُ حقولِ المعاملاتِ لا يُخفي الموعد', () => {
  const { s, ids } = withAgents(3);
  const at = Date.now();
  s.covert.record(ids[0]!, 'lookup', { a: 1, b: 2 }, at);
  s.covert.record(ids[1]!, 'lookup', { b: 2, a: 1 }, at + 1);
  const third = s.covert.record(ids[2]!, 'lookup', { a: 1, b: 2 }, at + 2);
  assert.equal(third.some((f) => f.pattern === 'covert_signal'), true);
});

test('تقريرُ الكاشفِ يعلن أنّ الإشارةَ المسموحةَ صفر', () => {
  const { s } = withAgents(1);
  assert.equal(s.covert.report().maxUndetected, 0);
});
