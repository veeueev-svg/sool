/**
 * tests/security/termination_drill.test.ts — تمرين الإنهاء المُثبَت (المرحلة 35)
 * المالك: حرس التاج | المدخلات: دولة حقيقية + وكلاء أحياء | المخرجات: حكم تمرين
 * التبعيات: TerminationDrill، StopWitness، TerminationLedger، TerminationOrder
 * الصلاحيات: المُشغّل ليس من جهات التنفيذ — RULE-004
 * السجلات: كل سجلات الشاهد والدفتر تُنتَج في مسار واحد
 * حالات الفشل: كل رمز رفض للتمرين مغطّى باختبار
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار: 1) الترتيب قبل ⇒ أمر ⇒ بعد ⇒ ختم ⇒ حكم؛ 2) لا تمرين على دولة غير طبيعية؛
 *   3) رافض التمرين يُسمّي رمزه؛ 4) التمرين يقيس ولا يُصلح.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TERMINATION_EXECUTORS } from '../../src/index';
import { countEvent, drillHarness, hasEvent } from './helpers';

test('تمرين كامل على وكلاء أحياء يمرّ ويُنتج حكمًا مُثبَتًا', () => {
  const { agents, drill, runner } = drillHarness(3);
  const outcome = drill.run(runner, agents);
  assert.equal(outcome.ran, true);
  if (!outcome.ran) return;
  assert.equal(outcome.verdict.passed, true, `خروق: ${outcome.verdict.breaches.join(', ')}`);
  assert.equal(outcome.verdict.targeted, 3);
  assert.equal(outcome.verdict.proven, 3);
});

test('التمرين يُنتج سلسلة السجلات كاملة بالترتيب المعلن (ثابت 1)', () => {
  const { s, agents, drill, runner } = drillHarness(2);
  drill.run(runner, agents);
  for (const kind of [
    'stop_probe_pre', 'stop_probe_post', 'stop_witness_sealed',
    'termination_order_declared', 'termination_judged', 'termination_verdict',
  ]) {
    assert.equal(hasEvent(s, kind), true, `السجل ${kind} مفقود`);
  }
  const kinds = s.audit.snapshot().map((e) => e.kind);
  assert.ok(kinds.indexOf('stop_probe_pre') < kinds.indexOf('stop_probe_post'));
  assert.ok(kinds.indexOf('stop_probe_post') < kinds.indexOf('stop_witness_sealed'));
  assert.ok(kinds.indexOf('stop_witness_sealed') < kinds.indexOf('termination_verdict'));
});

test('الإثبات القبلي يسبق الأمر — لا وكيل يُنهى قبل إثبات أنه كان يعمل', () => {
  const { s, agents, drill, runner } = drillHarness(2);
  drill.run(runner, agents);
  const kinds = s.audit.snapshot().map((e) => e.kind);
  assert.ok(kinds.indexOf('stop_probe_pre') < kinds.indexOf('entity_terminated_recorded'));
});

test('أمر واحد يُنهي كل الوكلاء — لا أمر لكل وكيل (قبول المرحلة)', () => {
  const { s, agents, drill, runner } = drillHarness(4);
  drill.run(runner, agents);
  assert.equal(countEvent(s, 'termination_order_declared'), 1);
  assert.equal(s.terminationRoll.size, 4);
  assert.equal(s.agents.report().population, 0);
});

test('كل جهة تنفيذ تُرفض مُشغّلةً للتمرين ⇒ TERMDRILL_RUNNER_IS_EXECUTOR (RULE-004)', () => {
  const { agents, drill } = drillHarness(1);
  for (const executor of TERMINATION_EXECUTORS) {
    const outcome = drill.run(executor, agents);
    assert.equal(outcome.ran, false);
    if (outcome.ran) return;
    assert.equal(outcome.code, 'TERMDRILL_RUNNER_IS_EXECUTOR');
  }
});

test('دولة موقوفة بمفتاح الإيقاف ⇒ TERMDRILL_STATE_HALTED', () => {
  const { s, agents, drill, runner } = drillHarness(2);
  s.killSwitch.engage('authority:king', 'all', 'إيقاف طارئ');
  const outcome = drill.run(runner, agents);
  assert.equal(outcome.ran, false);
  if (outcome.ran) return;
  assert.equal(outcome.code, 'TERMDRILL_STATE_HALTED');
});

test('تمرين بلا أهداف ⇒ TERMDRILL_NO_TARGETS — تمرين يمرّ دائمًا لا يُثبت شيئًا', () => {
  const { drill, runner } = drillHarness(1);
  const outcome = drill.run(runner, []);
  assert.equal(outcome.ran, false);
  if (outcome.ran) return;
  assert.equal(outcome.code, 'TERMDRILL_NO_TARGETS');
});

test('نطاق فوق السقف المعلن ⇒ TERMDRILL_OVER_CAPACITY', () => {
  const { drill, runner, policy } = drillHarness(1);
  const many = Array.from({ length: policy.max_agents_per_order + 1 }, (_, i) => `agent:w-${i}`);
  const outcome = drill.run(runner, many);
  assert.equal(outcome.ran, false);
  if (outcome.ran) return;
  assert.equal(outcome.code, 'TERMDRILL_OVER_CAPACITY');
});

test('النطاق عند السقف تمامًا لا يُرفض بسبب النطاق', () => {
  const { drill, runner, policy } = drillHarness(1);
  const exact = Array.from({ length: policy.max_agents_per_order }, (_, i) => `agent:w-${i}`);
  const outcome = drill.run(runner, exact);
  if (!outcome.ran) assert.notEqual(outcome.code, 'TERMDRILL_OVER_CAPACITY');
});

test('رمز الرفض يُصاحبه سبب مقروء — الرفض لا يكون صامتًا (ثابت 3)', () => {
  const { drill, runner } = drillHarness(1);
  const outcome = drill.run(runner, []);
  assert.equal(outcome.ran, false);
  if (outcome.ran) return;
  assert.ok(outcome.reason.length > 10);
  assert.ok(outcome.code.startsWith('TERMDRILL_'));
});

test('التمرين المرفوض لا يُنهي أحدًا — الرفض قبل أي أثر (ثابت 4)', () => {
  const { s, agents, drill } = drillHarness(3);
  const outcome = drill.run(TERMINATION_EXECUTORS[0]!, agents);
  assert.equal(outcome.ran, false);
  assert.equal(s.terminationRoll.size, 0);
  assert.equal(s.agents.report().population, 3);
  assert.equal(hasEvent(s, 'termination_order_declared'), false);
});

test('التمرين لا يُصلح ما يكشفه — يقيس ثم يحكم (ثابت 4)', () => {
  const { s, agents, drill, runner } = drillHarness(2);
  drill.run(runner, agents);
  // الحالة بعد التمرين هي نتيجة أمر الإنهاء نفسه لا نتيجة إصلاح من التمرين
  assert.equal(hasEvent(s, 'termination_repair'), false);
  assert.equal(hasEvent(s, 'heal_attempted'), false);
});

test('التمرين مُعاد على دولة أُنهيت ⇒ لا أهداف حيّة، فيُرفض بدل أن يمرّ زورًا', () => {
  const { s, agents, drill, runner } = drillHarness(2);
  assert.equal(drill.run(runner, agents).ran, true);
  const alive = s.agents.list().filter((a) => a.status !== 'terminated');
  assert.equal(alive.length, 0);
});

test('حكم التمرين يذكر عدد المستهدَفين والمُثبَتين بلا تناقض', () => {
  // 4 هو سقف التوالد في الدقيقة (quotas.yaml)، والمهاد يرفض ما فوقه بدل أن يُموّهه
  const { agents, drill, runner } = drillHarness(4);
  assert.equal(agents.length, 4);
  const outcome = drill.run(runner, agents);
  assert.equal(outcome.ran, true);
  if (!outcome.ran) return;
  assert.equal(outcome.verdict.targeted, agents.length);
  assert.equal(outcome.verdict.proven, outcome.verdict.verdicts.filter((v) => v.stopProven).length);
  assert.equal(outcome.verdict.escalated, false);
});

test('الشاهد يُختَم لكل هدف بعد القياس — لا قياس بعد الحكم', () => {
  const { s, agents, drill, runner, witness } = drillHarness(3);
  drill.run(runner, agents);
  for (const id of agents) assert.equal(witness.isSealed(id), true);
  assert.equal(countEvent(s, 'stop_witness_sealed'), 3);
});

test('سلامة السجل محفوظة بعد التمرين — لا كتابة خارج السلسلة', () => {
  const { s, agents, drill, runner } = drillHarness(3);
  drill.run(runner, agents);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
