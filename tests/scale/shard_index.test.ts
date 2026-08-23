/**
 * tests/scale/shard_index.test.ts — مرآةُ شغل الشرائح (المرحلة 39، البند T-119)
 * المالك: وزارة البنية | المدخلات: دفعات هوية بأمر تاج | المخرجات: مرآةٌ تطابق السجل دائمًا
 * التبعيات: helpers وPopulationRegistry | الصلاحيات: لا تسجيل يمرّ خارج بوابة التاج
 * السجلات: population_* | حالات الفشل المقيسة: سقف الشريحة يبقى رافضًا، والمرآة لا تنحرف
 * اختبار القبول: tests/scale/scale_lifecycle.test.ts و tests/scale/tail_gate.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md §31
 * ثوابت هذا الاختبار:
 *   1) **المرآة تُقاس بالسجل لا بنفسها**: كل تأكيدٍ على `shardOccupancy` يُقابله تأكيدٌ
 *      على `verifyShardIndex()` — عدّادٌ يشهد لنفسه لا يُقبل.
 *   2) **الإصلاح لا يُرخي الرفض**: سقف الشريحة الذي كان يُحسب بمسحٍ كامل يبقى يرفض
 *      بالرمز نفسه بعد أن صار يُحسب بالمرآة (وإلّا كان الإسراع إرخاءً).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, scaleState, smallPopulation, T0 } from './helpers';

test('سقف الشريحة يبقى رافضًا بالرمز نفسه بعد أن صار الشغل يُقرأ من المرآة', () => {
  const h = scaleState();
  // شريحة واحدة تجمع كل الهويات، وسقفها اثنتان: الثالثة ترفض ولو بقي سقف السكان.
  const { population } = smallPopulation(h, { max: 12, rate: 12, shards: 1, perShard: 2 });
  assert.equal(population.registerBatch(h.command('shard:two'), [identity(1), identity(2)], T0).ok, true);
  const over = population.registerBatch(h.command('shard:three'), [identity(3)], T0);
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.code, 'POPULATION_SHARD_FULL');
  assert.equal(population.population, 2);
  assert.equal(population.shardOccupancy(0), 2);
  assert.equal(population.verifyShardIndex().ok, true);
});

test('الدفعة المرفوضة لا تُغيّر المرآة: لا شغلَ يُحسب لهويّةٍ لم تُسجَّل', () => {
  const h = scaleState();
  const { population } = smallPopulation(h, { max: 12, rate: 12, shards: 1, perShard: 2 });
  assert.equal(population.registerBatch(h.command('shard:one'), [identity(1)], T0).ok, true);
  // دفعةٌ تتجاوز السقف كلُّها تُرفض ذرّيًّا، فلا يُضاف نصفها إلى المرآة.
  const rejected = population.registerBatch(h.command('shard:burst'), [identity(2), identity(3)], T0);
  assert.equal(rejected.ok, false);
  assert.equal(population.shardOccupancy(0), 1);
  assert.equal(population.verifyShardIndex().ok, true);
});

test('المرآة تتراجع مع الإنهاء الجماعي ولا تُبقي شغلًا لشريحةٍ فرغت', () => {
  const h = scaleState();
  const { population } = smallPopulation(h, { max: 12, rate: 12, shards: 2, perShard: 6 });
  assert.equal(
    population.registerBatch(h.command('shard:many'), [identity(1), identity(2), identity(3)], T0).ok,
    true,
  );
  assert.equal(population.verifyShardIndex().ok, true);
  const occupied = [0, 1].map((shardId) => population.shardOccupancy(shardId));
  assert.equal(occupied[0]! + occupied[1]!, 3);
  assert.equal(population.terminateAll(), 3);
  assert.equal(population.shardOccupancy(0), 0);
  assert.equal(population.shardOccupancy(1), 0);
  assert.equal(population.verifyShardIndex().ok, true);
});

test('الاستعادة تُعيد بناء المرآة من اللقطة لا من الذاكرة السابقة', () => {
  const h = scaleState();
  const { population } = smallPopulation(h, { max: 12, rate: 12, shards: 2, perShard: 6 });
  assert.equal(
    population.registerBatch(h.command('shard:snap'), [identity(1), identity(2)], T0).ok, true,
  );
  const snapshot = population.exportAll();
  const other = smallPopulation(h, { max: 12, rate: 12, shards: 2, perShard: 6 }).population;
  assert.equal(other.population, 0);
  assert.equal(other.importAll(snapshot, 'authority:crown_guard'), true);
  assert.equal(other.population, 2);
  assert.equal(other.verifyShardIndex().ok, true);
  const restored = [0, 1].map((shardId) => other.shardOccupancy(shardId));
  assert.equal(restored[0]! + restored[1]!, 2);
});

test('فحصُ الانحراف يكشف مرآةً لا تطابق السجل — ولا يُصلحها', () => {
  const h = scaleState();
  const { population } = smallPopulation(h, { max: 12, rate: 12, shards: 1, perShard: 6 });
  assert.equal(population.registerBatch(h.command('shard:drift'), [identity(1)], T0).ok, true);
  // انحرافٌ مزروع في المرآة وحدها: الفحص يجب أن يراه ويسمّي الشريحة والرقمين.
  const mirror = (population as unknown as { shardCounts: Map<number, number> }).shardCounts;
  mirror.set(0, 5);
  const report = population.verifyShardIndex();
  assert.equal(report.ok, false);
  assert.deepEqual(report.drifts, [{ shardId: 0, counted: 1, mirrored: 5 }]);
  // الفحص قارئ لا مُصلح: الانحراف يبقى حتى يُصلحه من يملك القرار.
  assert.equal(population.shardOccupancy(0), 5);
});
