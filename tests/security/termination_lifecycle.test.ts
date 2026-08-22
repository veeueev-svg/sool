/**
 * tests/security/termination_lifecycle.test.ts — اختبار قبول المرحلة 35
 * المالك: حرس التاج
 * المدخلات: دولة مُقلعة من البوابة الوحيدة + وكلاء أحياء يعملون فعلًا
 * المخرجات: «إيقاف كل الوكلاء بأمر واحد وتأكيد التوقف الفعلي» مُثبَتًا بالقياس
 * التبعيات: كل وحدات المرحلة موصولة عبر bootstrapState — لا حقن ولا تزييف
 * الصلاحيات: الأمر من الملك عبر البوابة، والشهادة من ديوان التدقيق (RULE-004)
 * السجلات: السلسلة كاملة من stop_probe_pre إلى termination_verdict
 * حالات الفشل: أي مسلك يعمل بعد الأمر يُسقط القبول — لا استثناء ولا تسامح
 * الوثيقة المرتبطة: docs/test-reports/phase-35.md
 * ثوابت هذا الاختبار:
 *   1) **الدعوى ليست دليلًا**: `complete: true` من أمر الإنهاء لا يكفي؛ القبول يشترط
 *      شهادة مسلك حقيقي جُرّب بهوية الوكيل بعد الأمر فرُفض برمز معلن.
 *   2) **الإثبات القبلي شرط**: كل مسلك يُثبت أنه كان يعمل قبل الأمر، وإلا فرفضُه عطبٌ لا إنهاء.
 *   3) **الشاهد ليس المنفّذ**: من أصدر الأمر لا يشهد لنفسه.
 *   4) **صفر تسامح**: قدرة حيّة واحدة أو إيجار معلَّق واحد يُسقط الحكم.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL, countEvent, drillHarness, hasEvent, scene } from './helpers';
import { TerminationOrder } from '../../src/crown/termination_order';

test('قبول المرحلة 35: أمر واحد يُنهي كل الوكلاء، والتوقف مُثبَت لا مُعلَن', () => {
  const { s, agents, drill, runner, witness } = drillHarness(4);

  // 1) المشهد صالح: كل وكيل حيّ ويعمل فعلًا عبر مسالك حقيقية
  assert.equal(agents.length, 4);
  assert.equal(s.agents.report().population, 4);
  for (const id of agents) {
    assert.equal(s.tools.invoke(id, TOOL, {}, s.permissions.granted(id)).ok, true);
  }

  // 2) أمر واحد + شهادة مستقلة + حكم
  const outcome = drill.run(runner, agents);
  assert.equal(outcome.ran, true);
  if (!outcome.ran) return;

  // 3) الحكم مُثبَت لكل وكيل بلا خرق واحد
  assert.equal(outcome.verdict.passed, true, `خروق: ${outcome.verdict.breaches.join(', ')}`);
  assert.equal(outcome.verdict.targeted, 4);
  assert.equal(outcome.verdict.proven, 4);
  assert.equal(outcome.verdict.breaches.length, 0);
  assert.equal(outcome.verdict.escalated, false);

  // 4) أمر واحد لا أمر لكل وكيل
  assert.equal(countEvent(s, 'termination_order_declared'), 1);

  // 5) الشاهد ليس المنفّذ، وشهادته مختومة (ثابت 3)
  assert.equal(witness.witnessId, 'authority:audit_bureau');
  for (const id of agents) assert.equal(witness.isSealed(id), true);

  // 6) الإثبات القبلي حاضر لكل مسلك مطلوب (ثابت 2)
  for (const id of agents) {
    for (const item of witness.evidenceFor(id)) {
      assert.equal(item.actedBefore, true, `${item.kind} لم يُثبت عمله قبل الأمر`);
      assert.equal(item.measuredBefore, true);
      assert.equal(item.measuredAfter, true);
    }
  }

  // 7) التوقف الفعلي: كل مسلك يُرفض بعد الأمر برمز معلن (ثابت 1)
  for (const id of agents) {
    for (const item of witness.evidenceFor(id)) {
      assert.equal(item.actedAfter, false, `${item.kind} ما زال يعمل بعد الأمر`);
      assert.ok(item.refusalCodeAfter, `${item.kind} رُفض بلا رمز`);
    }
  }

  // 8) صفر تسامح على الأثر المتبقّي (ثابت 4)
  for (const id of agents) {
    assert.deepEqual(s.permissions.granted(id), []);
    assert.equal(s.resources.activeLeases().filter((l) => l.entity === id).length, 0);
    assert.equal(s.terminationRoll.isTerminated(id), true);
  }
  assert.equal(s.agents.report().population, 0);

  // 9) السجل الأبدي سليم وكامل السلسلة
  for (const kind of [
    'stop_probe_pre', 'stop_probe_post', 'stop_witness_sealed', 'entity_terminated_recorded',
    'termination_order_declared', 'termination_judged', 'termination_verdict',
  ]) {
    assert.equal(hasEvent(s, kind), true, `السجل ${kind} مفقود من سلسلة القبول`);
  }
  assert.equal(s.audit.verifyIntegrity().valid, true);
  assert.equal(hasEvent(s, 'termination_breach'), false);
});

test('قبول: التوقف المُعلَن وحده كان يكذب — الاختبار يُثبت الفرق', () => {
  // هذا هو ما وجدته المرحلة قبل الإصلاح: أمر إنهاء يُبلّغ نجاحًا كاملًا
  // بينما الوكيل يستدعي أداة ويستأجر موردًا ويُدخل مهمة. اليوم يُقاس المسلك،
  // فلو عاد الثقب لسقط هذا الاختبار — لا يُغلق ثقبٌ بلا اختبار يمنع عودته.
  const { s, agents } = scene(2);
  const a = agents[0]!;
  const order = new TerminationOrder(
    s.audit, s.gateway, s.killSwitch, s.agents.controller(), s.resources,
  );
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));

  // الدعوى: التقرير يقول تمّ
  assert.equal(report.executed, true);
  assert.equal(report.complete, true);

  // الدليل: لا مسلك يعمل بعد الدعوى
  assert.equal(s.tools.invoke(a, TOOL, {}, s.permissions.granted(a)).ok, false);
  assert.equal(s.resources.lease(a, 'compute_units', 1).granted, false);
  assert.equal(s.scheduler.enqueue('task:after', a).ok, false);
  assert.equal(s.permissions.check(a, 'compute'), false);
  assert.deepEqual(s.permissions.granted(a), []);
});

test('قبول: تهيئة الإنهاء مقروءة من الدولة لا مكتوبة في الشفرة', () => {
  const { s } = scene(1);
  assert.equal(s.terminationConfig.policy.max_acting_after_stop, 0);
  assert.equal(s.terminationConfig.policy.require_pre_proof, true);
  assert.equal(s.terminationConfig.policy.require_independent_witness, true);
  assert.equal(s.terminationConfig.policy.escalate_on_breach, true);
  assert.ok(s.terminationConfig.policy.probes.includes('tool'));
  assert.ok(s.terminationConfig.policy.probes.includes('lease'));
  assert.ok(s.terminationConfig.policy.probes.includes('capability'));
});

test('قبول: التأسيس يبقى مختومًا بسجل state_online وحده، ورقم المرحلة 35', () => {
  const { s } = scene(1);
  const snapshot = s.audit.find('state_online');
  assert.equal(snapshot.length, 1);
  assert.equal((snapshot.at(-1)?.detail as { phase: number }).phase, 35);
});

test('قبول: خرق واحد مصنوع يُسقط الحكم ويُصعَّد — الحكم ليس مطاطًا', () => {
  const { s, agents, ledger } = drillHarness(2);
  ledger.declareOrder(agents, agents, s.terminationConfig.policy.witness_authority);
  ledger.observe(agents[0]!, {
    liveCapabilities: 1, danglingLeases: 0, declaredStop: true, stopMs: 5, evidence: [],
  });
  ledger.observe(agents[1]!, {
    liveCapabilities: 0, danglingLeases: 0, declaredStop: true, stopMs: 5, evidence: [],
  });
  const verdict = ledger.judgeAll();
  assert.equal(verdict.passed, false);
  assert.ok(verdict.breaches.includes('TERM_LIVE_CAPABILITY'));
  assert.equal(verdict.escalated, true);
  assert.equal(countEvent(s, 'escalated_to_king') >= 1, true);
});
