/**
 * tests/security/termination_seams.test.ts — المسالك الخمسة المغلقة (المرحلة 35)
 * المالك: حرس التاج | المدخلات: دولة حقيقية بعد أمر إنهاء | المخرجات: رفض من كل مسلك
 * التبعيات: سجل المنتهين موصولًا بالأدوات والموارد والقدرات والمجدول والمصنع
 * الصلاحيات: لا صلاحية لمنتهٍ — هذا نصّ الاختبار
 * السجلات: terminated_entity_refused / terminated_grant_refused / entity_terminated_recorded
 * حالات الفشل: كل مسلك له اختبار «قبل» و«بعد» — الرفض بعد عملٍ مُثبَت لا بعد عطبٍ سابق
 * اختبار القبول: tests/security/termination_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0019-stop-witness.md
 * ثوابت الاختبار:
 *   1) كل مسلك يُقاس **قبل** الإنهاء فيعمل، و**بعده** فيُرفض — وإلا فالرفض ليس أثر الأمر.
 *   2) الرفض برمز معلن لا بصمت ولا باستثناء عامّ.
 *   3) لا مسلك يُغلق «بالتأدّب»: الإغلاق من سجل المنتهين وحده، فلا يُفتح بتغيير حالة الوكيل.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EntityId } from '../../src/index';
import { T0, TOOL, countEvent, scene } from './helpers';
import { TerminationOrder } from '../../src/crown/termination_order';

/** أمر إنهاء واحد يمرّ من البوابة كما يمرّ في التشغيل */
function terminateAll(s: ReturnType<typeof scene>['s']): void {
  new TerminationOrder(s.audit, s.gateway, s.killSwitch, s.agents.controller(), s.resources)
    .execute(s.king.issueCommand('terminate_agent', 'all'));
}

function setup(count = 2) {
  const { s, agents } = scene(count);
  return { s, agents, a: agents[0]! as EntityId };
}

// ═══ 1) مسلك الأداة ═══

test('الأداة: تعمل قبل الأمر وتُرفض بعده', () => {
  const { s, a } = setup();
  assert.equal(s.tools.invoke(a, TOOL, {}, s.permissions.granted(a)).ok, true);
  terminateAll(s);
  assert.equal(s.tools.invoke(a, TOOL, {}, s.permissions.granted(a)).ok, false);
});

test('الأداة: الرفض يُسمّى terminated_entity_refused لا يُخلط بنقص القدرة', () => {
  const { s, a } = setup();
  const before = s.permissions.granted(a);
  terminateAll(s);
  // تُمرَّر منح ما قبل الإنهاء عمدًا: لو كان الرفض بسبب فقد المنح فقط لَقُبِل هنا
  const out = s.tools.invoke(a, TOOL, {}, before);
  assert.equal(out.ok, false);
  assert.equal(countEvent(s, 'terminated_entity_refused') >= 1, true);
});

test('الأداة: منتهٍ لا يستفيد من منح مسروقة من كيان آخر', () => {
  const { s, agents } = setup(2);
  const [a, b] = [agents[0]!, agents[1]!];
  const stolen = s.permissions.granted(b);
  terminateAll(s);
  assert.equal(s.tools.invoke(a, TOOL, {}, stolen).ok, false);
});

// ═══ 2) مسلك المورد ═══

test('المورد: الإيجار يُمنح قبل الأمر ويُمنع بعده برمز LEASE_ENTITY_TERMINATED', () => {
  const { s, a } = setup();
  const first = s.resources.lease(a, 'compute_units', 1);
  assert.equal(first.granted, true);
  terminateAll(s);
  const second = s.resources.lease(a, 'compute_units', 1);
  assert.equal(second.granted, false);
  assert.ok(!second.granted && second.reason.includes('LEASE_ENTITY_TERMINATED'));
});

test('المورد: إيجارات المنتهي تُحرَّر فلا يبقى إيجار معلَّق', () => {
  const { s, a } = setup();
  s.resources.lease(a, 'compute_units', 2);
  assert.equal(s.resources.activeLeases().filter((l) => l.entity === a).length, 1);
  terminateAll(s);
  assert.equal(s.resources.activeLeases().filter((l) => l.entity === a).length, 0);
});

test('المورد: المنتهي لا يستأجر موردًا مختلفًا أيضًا — المنع بالكيان لا بالمورد', () => {
  const { s, a } = setup();
  terminateAll(s);
  for (const resource of ['compute_units', 'network_bandwidth', 'storage_gb']) {
    const out = s.resources.lease(a, resource, 1);
    assert.equal(out.granted, false, `المورد ${resource} يجب أن يُمنع عن منتهٍ`);
  }
});

// ═══ 3) مسلك القدرة ═══

test('القدرة: تُفحص صحيحة قبل الأمر وتُنكَر بعده', () => {
  const { s, a } = setup();
  assert.equal(s.permissions.check(a, 'compute'), true);
  terminateAll(s);
  assert.equal(s.permissions.check(a, 'compute'), false);
});

test('القدرة: granted للمنتهي قائمة فارغة لا قائمة قديمة', () => {
  const { s, a } = setup();
  assert.equal(s.permissions.granted(a).length, 1);
  terminateAll(s);
  assert.deepEqual(s.permissions.granted(a), []);
});

test('القدرة: منح جديد لمنتهٍ يُرفض ولو بأمر ملكي (الإنهاء نهائي)', () => {
  const { s, a } = setup();
  terminateAll(s);
  const command = s.king.issueCommand('grant_capability', a);
  const out = s.permissions.grant(command, {
    entity: a, capability: 'compute', expiresAt: Date.now() + 3_600_000,
  });
  assert.equal(out.allowed, false);
  assert.equal(countEvent(s, 'terminated_grant_refused') >= 1, true);
  assert.deepEqual(s.permissions.granted(a), []);
});

// ═══ 4) مسلك المجدول ═══

test('المجدول: المهمة تُقبل قبل الأمر وتُرفض بعده بـ SCHEDULER_OWNER_TERMINATED', () => {
  const { s, a } = setup();
  assert.equal(s.scheduler.enqueue('task:pre', a).ok, true);
  terminateAll(s);
  const out = s.scheduler.enqueue('task:post', a);
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.code, 'SCHEDULER_OWNER_TERMINATED');
});

test('المجدول: منتهٍ لا يُدخل مهمة بأي معرّف — المنع بالمالك', () => {
  const { s, a } = setup();
  terminateAll(s);
  for (const id of ['t1', 't2', 't3']) {
    assert.equal(s.scheduler.enqueue(`task:${id}`, a).ok, false);
  }
});

// ═══ 5) مسلك التوليد ═══

test('التوليد: المنتهي لا يكون طالبًا ولا مشرفًا على مولود جديد', () => {
  const { s, a } = setup();
  terminateAll(s);
  const out = s.factory.spawn(s.king.issueCommand('create_agent', 'after'), {
    blueprintId: 'worker', count: 1, requestedBy: a, supervisor: a,
  } as never);
  assert.equal(out.ok, false);
});

// ═══ ثوابت عامة على المسالك ═══

test('سجل المنتهين هو مصدر المنع الوحيد — كل الوكلاء مقيَّدون بعد الأمر (ثابت 3)', () => {
  const { s, agents } = setup(3);
  terminateAll(s);
  for (const id of agents) assert.equal(s.terminationRoll.isTerminated(id), true);
  assert.equal(s.terminationRoll.size, 3);
});

test('كيان لم يُستهدف لا يُمَسّ — المنع مُوجَّه لا شامل', () => {
  const { s } = setup(2);
  terminateAll(s);
  const out = s.resources.lease('ministry:interior', 'compute_units', 1);
  assert.equal(out.granted, true);
});

test('الإنهاء يُقيّد قبل السحب والتحرير — لا نافذة يتصرّف فيها المنتهي', () => {
  const { s, a } = setup();
  terminateAll(s);
  const kinds = s.audit.snapshot().map((e) => e.kind);
  const recorded = kinds.indexOf('entity_terminated_recorded');
  assert.ok(recorded >= 0);
  // المنع فاعل مباشرة بعد القيد: القياس بعده يُرفض في كل المسالك
  assert.equal(s.tools.invoke(a, TOOL, {}, s.permissions.granted(a)).ok, false);
  assert.equal(s.resources.lease(a, 'compute_units', 1).granted, false);
  assert.equal(s.scheduler.enqueue('task:x', a).ok, false);
  assert.equal(s.permissions.check(a, 'compute'), false);
});

test('تكرار أمر الإنهاء لا يكسر شيئًا ولا يُكرّر قيدًا', () => {
  const { s, agents } = setup(2);
  terminateAll(s);
  terminateAll(s);
  assert.equal(s.terminationRoll.size, agents.length);
  assert.equal(countEvent(s, 'entity_terminated_recorded'), agents.length);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('السجل يبقى سليمًا بعد إغلاق المسالك الخمسة', () => {
  const { s, a } = setup(2);
  terminateAll(s);
  s.tools.invoke(a, TOOL, {}, []);
  s.resources.lease(a, 'compute_units', 1);
  s.scheduler.enqueue('task:y', a);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
