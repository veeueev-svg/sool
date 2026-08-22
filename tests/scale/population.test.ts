/**
 * tests/scale/population.test.ts — سكان الشريحة والحصص والمعدل (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: دفعات هوية وأمر تاج | المخرجات: تسجيل ذري أو رمز رفض
 * التبعيات: helpers وPopulationRegistry | الصلاحيات: التسجيل لا يمر إلا بالتاج
 * السجلات: population_* | حالات الفشل: السقف والمعدل والمالك والحصة والشريحة ترفض مغلقا
 * اختبار القبول: scale_lifecycle.test.ts | الوثيقة: ADR-0015-scale.md
 * ثوابت الاختبار: 1) حد ثم فوقه؛ 2) لا هوية ناقصة؛ 3) لا دفعة جزئية؛ 4) نافذة حقيقية.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PopulationRegistry } from '../../src/scale/population';
import { identity, scaleState, smallPopulation, T0 } from './helpers';

test('يسجل دفعة هوية ملكية مع مالك وحصة وشريحة', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:one'), [identity(1)], T0);
  assert.equal(r.ok, true); assert.equal(population.population, 1); assert.equal(population.get('agent:scale-1')?.resourceQuota, 'identity_slots:1');
  assert.equal(h.s.resources.usageOf('agent:scale-1', 'identity_slots', T0), 1);
});
test('يرفض التسجيل بلا أمر تاج مناسب', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.emergency('scale:one'), [identity(1)], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_CROWN_REFUSED');
});
test('يرفض الدفعة الفارغة صراحة', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:empty'), [], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_EMPTY_BATCH');
});
test('يرفض الهوية بلا مالك', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:owner'), [{ ...identity(1), owner: '' }], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_IDENTITY_INCOMPLETE');
});
test('يرفض الحصة غير المسجلة', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:quota'), [{ ...identity(1), resourceQuota: 'compute_units:1' }], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_IDENTITY_INCOMPLETE');
});
test('يرفض المعرف غير الوكيلي', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:id'), [{ ...identity(1), agentId: 'person:x' }], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_IDENTITY_INCOMPLETE');
});
test('يرفض تكرار هوية داخل الدفعة قبل أي كتابة', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  const r = population.registerBatch(h.command('scale:dup'), [identity(1), identity(1)], T0);
  assert.equal(r.ok, false); assert.equal(population.population, 0);
});
test('يرفض هوية مسجلة مسبقا', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  assert.equal(population.registerBatch(h.command('scale:first'), [identity(1)], T0).ok, true);
  const r = population.registerBatch(h.command('scale:again'), [identity(1)], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_DUPLICATE_ID');
});
test('يمارس السقف السكاني عند الحد وفوقه بواحد', () => {
  const h = scaleState(); const { population } = smallPopulation(h, { max: 2, rate: 9, perShard: 9 });
  assert.equal(population.registerBatch(h.command('scale:cap'), [identity(1), identity(2)], T0).ok, true);
  const r = population.registerBatch(h.command('scale:over'), [identity(3)], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_CAP_REACHED');
});
test('نافذة معدل التوليد ترفض فوق الحد بواحد', () => {
  const h = scaleState(); const { population } = smallPopulation(h, { max: 9, rate: 2, perShard: 9 });
  assert.equal(population.registerBatch(h.command('scale:rate'), [identity(1), identity(2)], T0).ok, true);
  const r = population.registerBatch(h.command('scale:rate-over'), [identity(3)], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_RATE_EXCEEDED');
});
test('تفتح نافذة المعدل بعد دقيقة فعلية', () => {
  const h = scaleState(); const { population } = smallPopulation(h, { max: 9, rate: 1, perShard: 9 });
  assert.equal(population.registerBatch(h.command('scale:rate1'), [identity(1)], T0).ok, true);
  assert.equal(population.registerBatch(h.command('scale:rate2', T0 + 60_001), [identity(2)], T0 + 60_001).ok, true);
});
test('الدفعة التي تتجاوز السقف لا تسجل جزءا منها', () => {
  const h = scaleState(); const { population } = smallPopulation(h, { max: 2, rate: 9, perShard: 9 });
  const r = population.registerBatch(h.command('scale:atomic'), [identity(1), identity(2), identity(3)], T0);
  assert.equal(r.ok, false); assert.equal(population.population, 0);
});
test('الإيقاف الشامل يمنع تسجيل سكان جدد', () => {
  const h = scaleState(); const { population } = smallPopulation(h);
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار');
  const r = population.registerBatch(h.command('scale:halt'), [identity(1)], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_HALTED');
});
test('الإيقاف الموضعي للشريحة يمنع التسجيل فيها', () => {
  const h = scaleState(); const { population, sharding } = smallPopulation(h);
  const agent = identity(1); const shard = sharding.shardFor(agent.agentId);
  assert.equal(sharding.isolate(h.emergency(`shard:${shard}`), shard, T0), true);
  const r = population.registerBatch(h.command('scale:isolate'), [agent], T0);
  assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'POPULATION_SHARD_ISOLATED');
});
test('الإنهاء الجماعي يمحو السكان ويستدعي مسترد الحصة لكل هوية', () => {
  const h = scaleState(); const released: string[] = [];
  const { sharding } = smallPopulation(h);
  const population = new PopulationRegistry(
    h.s.audit, h.s.gateway, h.s.killSwitch, sharding, 4, 4, h.s.resources, 'identity_slots',
    (x: { agentId: string }) => released.push(x.agentId),
  );
  assert.equal(population.registerBatch(h.command('scale:term'), [identity(1), identity(2)], T0).ok, true);
  assert.equal(population.terminateAll(), 2); assert.equal(population.population, 0); assert.deepEqual(released.sort(), ['agent:scale-1', 'agent:scale-2']);
  assert.equal(h.s.resources.allocated('identity_slots', T0), 0);
});
