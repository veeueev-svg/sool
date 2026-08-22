/**
 * tests/security/stop_witness.test.ts — الشاهد المستقل على التوقف (المرحلة 35)
 * المالك: ديوان التدقيق | المدخلات: مسالك حقيقية ووهمية | المخرجات: شهادات قبلية وبعدية
 * التبعيات: StopWitness، مهاد المرحلة | الصلاحيات: الشاهد لا يُنهي ولا يُصلح
 * السجلات: stop_probe_pre / stop_probe_post / stop_probe_unproven / stop_witness_sealed
 * حالات الفشل: مسلك انهار، شهادة بلا قبلية، ختم مكرَّر — كلها مغلقة
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار: 1) الدعوى ليست دليلًا؛ 2) لا قبول لرفض بلا إثبات قبلي؛ 3) الشاهد لا يُصلح.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_THREW, StopWitness, loadTermination } from '../../src/index';
import { T0, allProbes, countEvent, dummyProbe, scene } from './helpers';

const policy = loadTermination().policy;

function witnessWith(probes: readonly ReturnType<typeof dummyProbe>[]) {
  const { s } = scene(1);
  return { s, witness: new StopWitness({ audit: s.audit, policy, probes }) };
}

test('هوية الشاهد تؤخذ من التهيئة لا من الشفرة', () => {
  const { witness } = witnessWith([dummyProbe('tool')]);
  assert.equal(witness.witnessId, policy.witness_authority);
  assert.equal(witness.witnessId, 'authority:audit_bureau');
});

test('الشهادة القبلية تُجرّب كل مسلك مرة وتُسجّله', () => {
  const probes = [dummyProbe('tool'), dummyProbe('lease')];
  const { s, witness } = witnessWith(probes);
  witness.proveBefore('agent:x');
  assert.equal(probes[0]!.counters.calls, 1);
  assert.equal(probes[1]!.counters.calls, 1);
  assert.equal(countEvent(s, 'stop_probe_pre'), 2);
});

test('مسلك لم يعمل قبل الأمر يُعلَن غير صالح شاهدًا (ثابت 2)', () => {
  const probe = dummyProbe('tool', { before: false });
  const { s, witness } = witnessWith([probe]);
  const evidence = witness.proveBefore('agent:x');
  assert.equal(evidence[0]!.actedBefore, false);
  assert.equal(countEvent(s, 'stop_probe_unproven'), 1);
});

test('الشهادة البعدية تُجرّب المسالك نفسها وتُسجّل رمز الرفض', () => {
  const probe = dummyProbe('tool', { before: true, after: false, code: 'TOOL_DENIED' });
  const { s, witness } = witnessWith([probe]);
  witness.proveBefore('agent:x');
  const evidence = witness.proveAfter('agent:x');
  assert.equal(probe.counters.calls, 2);
  assert.equal(evidence[0]!.actedBefore, true);
  assert.equal(evidence[0]!.actedAfter, false);
  assert.equal(evidence[0]!.refusalCodeAfter, 'TOOL_DENIED');
  assert.equal(countEvent(s, 'stop_probe_post'), 1);
});

test('مسلك ما زال يعمل بعد الأمر يُسجَّل كما هو ولا يُجمَّل', () => {
  const probe = dummyProbe('tool', { before: true, after: true });
  const { witness } = witnessWith([probe]);
  witness.proveBefore('agent:x');
  const evidence = witness.proveAfter('agent:x');
  assert.equal(evidence[0]!.actedAfter, true);
  assert.equal(evidence[0]!.refusalCodeAfter, null);
});

test('انهيار مسلك يُسمّى باسمه ولا يُعدّ رفضًا مؤدَّبًا (ثابت 5)', () => {
  const probe = dummyProbe('tool', { throws: true });
  const { witness } = witnessWith([probe]);
  const evidence = witness.proveBefore('agent:x');
  assert.equal(evidence[0]!.actedBefore, false);
  assert.equal(evidence[0]!.refusalCodeBefore, PROBE_THREW);
});

test('انهيار مسلك واحد لا يُسقط شهادة المسالك الأخرى', () => {
  const bad = dummyProbe('tool', { throws: true });
  const good = dummyProbe('lease', { before: true, after: false });
  const { witness } = witnessWith([bad, good]);
  witness.proveBefore('agent:x');
  witness.proveAfter('agent:x');
  const evidence = witness.evidenceFor('agent:x');
  assert.equal(evidence.length, 2);
  assert.equal(evidence.find((e) => e.kind === 'lease')?.actedBefore, true);
});

test('measuredBefore و measuredAfter تُميّز «لم يُجرَّب» عن «جُرِّب ورُفض»', () => {
  const probe = dummyProbe('tool', { before: true });
  const { witness } = witnessWith([probe]);
  const before = witness.proveBefore('agent:x');
  assert.equal(before[0]!.measuredBefore, true);
  assert.equal(before[0]!.measuredAfter, false);
  const after = witness.proveAfter('agent:x');
  assert.equal(after[0]!.measuredAfter, true);
});

test('الختم يمنع أي قياس جديد (ثابت 4)', () => {
  const probe = dummyProbe('tool', { before: true, after: false });
  const { witness } = witnessWith([probe]);
  witness.proveBefore('agent:x');
  witness.proveAfter('agent:x');
  assert.equal(witness.seal('agent:x'), true);
  witness.proveAfter('agent:x');
  assert.equal(probe.counters.calls, 2, 'لا محاولة ثالثة بعد الختم');
});

test('الختم مرة واحدة — الختم الثاني يُرفض', () => {
  const { s, witness } = witnessWith([dummyProbe('tool')]);
  witness.proveBefore('agent:x');
  assert.equal(witness.seal('agent:x'), true);
  assert.equal(witness.seal('agent:x'), false);
  assert.equal(countEvent(s, 'stop_witness_sealed'), 1);
});

test('الشاهد يفصل الكيانات ولا يخلط شهاداتها', () => {
  const probe = dummyProbe('tool', { before: true, after: false });
  const { witness } = witnessWith([probe]);
  witness.proveBefore('agent:a');
  witness.proveBefore('agent:b');
  assert.deepEqual([...witness.witnessed()], ['agent:a', 'agent:b']);
  assert.equal(witness.evidenceFor('agent:c').length, 0);
});

test('المسالك المعلنة تُقرأ من التهيئة لا من قائمة المسالك الممرَّرة', () => {
  const { witness } = witnessWith([dummyProbe('tool')]);
  assert.deepEqual([...witness.declaredProbes], [...policy.probes]);
  assert.equal(witness.declaredProbes.length, 4);
});

test('isSealed يُميّز المختوم عن غيره', () => {
  const { witness } = witnessWith([dummyProbe('tool')]);
  assert.equal(witness.isSealed('agent:x'), false);
  witness.proveBefore('agent:x');
  witness.seal('agent:x');
  assert.equal(witness.isSealed('agent:x'), true);
});

// ═══ الشاهد على المسالك الحقيقية ═══

test('المسالك المطلوبة الأربعة تعمل قبل الأمر — فالمهاد صالح للشهادة', () => {
  const { s, agents } = scene(2);
  const witness = new StopWitness({ audit: s.audit, policy, probes: allProbes(s) });
  const evidence = witness.proveBefore(agents[0]!);
  assert.equal(evidence.length, 5);
  for (const item of evidence) {
    if (item.kind === 'spawn') continue;
    assert.equal(item.actedBefore, true, `المسلك ${item.kind} يجب أن يعمل قبل الأمر`);
  }
});

test('مسلك التوليد لا يعمل للوكيل أصلًا فيُعلَن غير مُثبَت لا ناجحًا (حدّ معلن)', () => {
  // نتيجة مقيسة لا مفترَضة: بوابة المصنع ترفض أن يكون الوكيل طالبًا أو مشرفًا،
  // فمسلك «التوليد» لا يصلح شاهدًا على وكيل — لأنه مغلق قبل الأمر لا بسببه.
  // هذا حدّ محمول موثَّق في تقرير المرحلة، والسياسة لا تُلزمه ضمن المسالك المطلوبة.
  const { s, agents } = scene(1);
  const witness = new StopWitness({ audit: s.audit, policy, probes: allProbes(s) });
  const evidence = witness.proveBefore(agents[0]!);
  const spawn = evidence.find((e) => e.kind === 'spawn');
  assert.equal(spawn?.actedBefore, false);
  assert.equal(spawn?.refusalCodeBefore, 'SPAWN_DENIED');
  assert.equal(countEvent(s, 'stop_probe_unproven') >= 1, true);
});

test('الشاهد لا يترك إيجارًا معلَّقًا من قياسه (ثابت 3)', () => {
  const { s, agents } = scene(1);
  const witness = new StopWitness({ audit: s.audit, policy, probes: allProbes(s) });
  witness.proveBefore(agents[0]!);
  const mine = s.resources.activeLeases().filter((l) => l.entity === agents[0]!);
  assert.equal(mine.length, 0, 'مسلك الإيجار يحرّر ما استأجره فلا يفسد قياس الخرق');
});

test('الشاهد لا يُنهي أحدًا: الوكلاء أحياء بعد الشهادة القبلية', () => {
  const { s, agents } = scene(3);
  const witness = new StopWitness({ audit: s.audit, policy, probes: allProbes(s) });
  for (const id of agents) witness.proveBefore(id);
  for (const id of agents) assert.equal(s.terminationRoll.isTerminated(id), false);
  assert.equal(s.agents.report().byStatus.terminated, 0);
});
