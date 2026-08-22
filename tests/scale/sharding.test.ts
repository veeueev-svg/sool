/**
 * tests/scale/sharding.test.ts — حتمية الشرائح والعزل والانحراف (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: هويات وسجلات وأوامر تاج | المخرجات: توزيع أو مخالفة
 * التبعيات: helpers وSharding | الصلاحيات: العزل فقط بأمر التاج ولا قرار محلي
 * السجلات: shard_* | حالات الفشل: امتلاء وعزل وانحراف ترفع ولا تخفى
 * اختبار القبول: scale_lifecycle.test.ts | الوثيقة: ADR-0015-scale.md
 * ثوابت الاختبار: 1) الحتمية؛ 2) العزل موضعي؛ 3) الانحراف محقون صراحة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, scaleState, smallPopulation, T0 } from './helpers';

test('المعرف نفسه يحسب الشريحة نفسها دائما', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  assert.equal(sharding.shardFor('agent:fixed'), sharding.shardFor('agent:fixed'));
});
test('كل شريحة محسوبة داخل المجال المعلن', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h, { shards: 3 });
  for (let i = 0; i < 40; i += 1) assert.ok(sharding.shardFor(`agent:${i}`) >= 0 && sharding.shardFor(`agent:${i}`) < 3);
});
test('التوزيع لا يعتمد على ترتيب التسجيل', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  const before = sharding.shardFor('agent:order'); for (let i = 0; i < 12; i += 1) sharding.shardFor(`agent:x-${i}`);
  assert.equal(sharding.shardFor('agent:order'), before);
});
test('عزل شريحة يحتاج أمر طوارئ تاجي', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h); const shard = 1;
  assert.equal(sharding.isolate(h.command('shard:1'), shard, T0), false); assert.equal(sharding.isIsolated(shard), false);
});
test('عزل شريحة صحيح يسجل الحالة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  assert.equal(sharding.isolate(h.emergency('shard:1'), 1, T0), true); assert.equal(sharding.isIsolated(1), true);
});
test('عزل شريحة لا يعزل الشرائح السليمة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  assert.equal(sharding.isolate(h.emergency('shard:1'), 1, T0), true); assert.equal(sharding.isIsolated(0), false); assert.equal(sharding.isIsolated(2), false);
});
test('إعادة الشريحة تحتاج أمر تاجي كذلك', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  sharding.isolate(h.emergency('shard:1'), 1, T0); assert.equal(sharding.restore(h.command('shard:1'), 1, T0), false); assert.equal(sharding.isIsolated(1), true);
});
test('إعادة صحيحة تعيد الشريحة وحدها', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  sharding.isolate(h.emergency('shard:1'), 1, T0); assert.equal(sharding.restore(h.emergency('shard:1r'), 1, T0), true); assert.equal(sharding.isIsolated(1), false);
});
test('يرفض العزل خارج مجال الشرائح', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  assert.equal(sharding.isolate(h.emergency('shard:bad'), 99, T0), false);
});
test('حقن وكيل بلا مالك يرفع مخالفة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  const d = sharding.auditRecords([{ agentId: 'agent:no-owner', owner: '', shardId: sharding.shardFor('agent:no-owner'), resourceQuota: 'identity_slots:1' }]);
  assert.equal(d[0]?.code, 'SHARD_OWNER_MISSING');
});
test('حقن وكيل في غير شريحته يرفع مخالفة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  const expected = sharding.shardFor('agent:wrong'); const d = sharding.auditRecords([{ agentId: 'agent:wrong', owner: 'ministry:x', shardId: (expected + 1) % 4, resourceQuota: 'identity_slots:1' }]);
  assert.equal(d[0]?.code, 'SHARD_ASSIGNMENT_MISMATCH');
});
test('حقن عدد فوق سقف الشريحة يرفع مخالفة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h, { perShard: 1 });
  const id = 'agent:cap'; const r = { agentId: id, owner: 'ministry:x', shardId: sharding.shardFor(id), resourceQuota: 'identity_slots:1' };
  assert.equal(sharding.auditRecords([r, { ...r, agentId: id }]).some((d) => d.code === 'SHARD_CAP_EXCEEDED'), true);
});
test('فحص سجل سليم لا يرفع مخالفة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h, { perShard: 3 });
  const r = identity(1); assert.deepEqual(sharding.auditRecords([{ ...r, shardId: sharding.shardFor(r.agentId) }]), []);
});
test('السجل يسجل مخالفة الانحراف المحقونة', () => {
  const h = scaleState(); const { sharding } = smallPopulation(h);
  sharding.auditRecords([{ agentId: 'agent:drift', owner: '', shardId: 0, resourceQuota: 'identity_slots:1' }]);
  assert.ok(h.s.audit.find('shard_drift_detected').length >= 1);
});
