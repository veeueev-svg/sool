/**
 * tests/scale/scale_lifecycle.test.ts — قبول توسع السكان المقاس (المرحلة 31)
 * المالك: وزارة البنية | المدخلات: تهيئة scale وسكان وشرائح ومجدول وبوابة
 * المخرجات: قبول رقمي أو مخالفة صريحة | التبعيات: كل وحدات scale وbootstrap
 * الصلاحيات: أمر التسجيل والعزل في بوابة التاج فقط | السجلات: مسار المرحلة كله
 * حالات الفشل: قياس فوق العتبة أو إنهاء جزئي أو تجويع أو انحراف => فشل صريح
 * اختبارات الوحدة: population/sharding/scheduler | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/test-reports/phase-31.md
 * ثوابت الاختبار: 1) قياس أصغر ثابت؛ 2) هامش معلن؛ 3) لا نجاح جزئي؛ 4) تهيئة مؤثرة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadScale, resolveConfigDir } from '../../src/kernel/config';
import { bootstrapState } from '../../src/index';
import { identity, scaleState, smallPopulation, T0 } from './helpers';
import { PopulationRegistry } from '../../src/scale/population';
import { TerminationOrder } from '../../src/crown/termination_order';

function copiedScale(change: (text: string) => string): string {
  const root = mkdtempSync('/tmp/sool-phase-31-'); const dir = join(root, 'config');
  // مسار التهيئة يُحلّ صعودًا من موقع التنفيذ (resolveConfigDir) لا بمسار مطلق: البند T-118.
  cpSync(resolveConfigDir(), dir, { recursive: true });
  const file = join(dir, 'scale.yaml'); writeFileSync(file, change(readFileSync(file, 'utf8'))); return dir;
}
function percentile(values: number[], p: number): number { return values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!; }

test('قبول: خمسون ألف هوية مسجلة وقياس البوابة تحت عتبة التهيئة بهامش معلن', () => {
  const h = scaleState(); const total = h.s.scaleConfig.policy.acceptance_population; const batch = 5_000;
  for (let start = 0; start < total; start += batch) {
    const items = Array.from({ length: batch }, (_, i) => identity(start + i, `ministry:owner-${i % 8}`));
    const r = h.s.population.registerBatch(h.command(`scale:batch-${start}`), items, T0);
    assert.equal(r.ok, true);
  }
  // إحماء معلن خارج العينات: اختبار القبول يقيس الحالة المستقرة لا تهيئة JIT الأولى.
  for (let i = 0; i < 20; i += 1) h.s.gateway.authorize(h.command(`gateway:warmup-${i}`, T0), T0);
  const samples: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    const began = process.hrtime.bigint();
    h.s.gateway.authorize(h.command(`gateway:measure-${i}`, T0), T0);
    samples.push(Number(process.hrtime.bigint() - began) / 1_000_000);
  }
  samples.sort((a, b) => a - b);
  const limit = h.s.scaleConfig.policy.gateway_p99_ms * (100 - h.s.scaleConfig.policy.acceptance_headroom_percent) / 100;
  assert.equal(h.s.population.population, total);
  assert.ok(percentile(samples, 0.99) <= limit);
  assert.ok(samples.at(-1)! <= h.s.scaleConfig.policy.gateway_max_ms);
});
test('أمر الإنهاء الجماعي المعتمد ينهي كل السكان ويستعيد كل الحصص بلا نجاح جزئي', () => {
  const h = scaleState(); const released: string[] = [];
  const { sharding } = smallPopulation(h, { max: 4, rate: 4, perShard: 4 });
  const population = new PopulationRegistry(
    h.s.audit, h.s.gateway, h.s.killSwitch, sharding, 4, 4, h.s.resources, 'identity_slots',
    (item: { agentId: string }) => released.push(item.agentId),
  );
  assert.equal(population.registerBatch(h.command('scale:terminate'), [identity(1), identity(2), identity(3), identity(4)], T0).ok, true);
  const report = new TerminationOrder(h.s.audit, h.s.gateway, h.s.killSwitch, population.asEntityController(), h.s.resources)
    .execute(h.s.king.issueCommand('terminate_agent', 'all', {}, T0), T0);
  assert.equal(report.complete, true); assert.equal(report.failed.length, 0); assert.equal(report.stopped.length, 4);
  assert.equal(population.population, 0); assert.deepEqual([...population.records()], []);
  assert.equal(h.s.resources.allocated('identity_slots', T0), 0);
  assert.deepEqual(released.sort(), ['agent:scale-1', 'agent:scale-2', 'agent:scale-3', 'agent:scale-4']);
});
test('العزل الموضعي يمنع شريحة ولا يعطل تسجيلا في شريحة سليمة', () => {
  const h = scaleState(); const { population, sharding } = smallPopulation(h, { max: 8, rate: 8, perShard: 8 });
  let blocked = identity(1); let allowed = identity(2);
  while (sharding.shardFor(allowed.agentId) === sharding.shardFor(blocked.agentId)) allowed = identity(Number(allowed.agentId.split('-').at(-1)) + 10);
  const shard = sharding.shardFor(blocked.agentId); assert.equal(sharding.isolate(h.emergency(`shard:${shard}`), shard, T0), true);
  assert.equal(population.registerBatch(h.command('scale:blocked'), [blocked], T0).ok, false);
  assert.equal(population.registerBatch(h.command('scale:allowed'), [allowed], T0).ok, true);
});
test('جدولة مالكين تثبت الدور وعدم التجويع', () => {
  const h = scaleState(); const q = h.s.scheduler; q.enqueue('a1', 'a'); q.enqueue('a2', 'a'); q.enqueue('b1', 'b');
  const first = q.next()!; q.complete(first.taskId); const second = q.next()!;
  assert.equal(first.owner, 'a'); assert.equal(second.owner, 'b');
});
test('المهمة لا تنفذ مرتين حتى لو أعيدت محاولتها', () => {
  const h = scaleState(); const q = h.s.scheduler; assert.equal(q.enqueue('once', 'a').ok, true); const task = q.next()!;
  assert.equal(q.complete(task.taskId), true); assert.equal(q.enqueue('once', 'a').ok, false); assert.equal(q.next(), null);
});
test('حقن الانحراف يرفع مخالفة مسجلة', () => {
  const h = scaleState(); const s = h.s.sharding;
  const violations = s.auditRecords([{ agentId: 'agent:bad', owner: '', shardId: (s.shardFor('agent:bad') + 1) % s.shardCount, resourceQuota: 'identity_slots:1' }]);
  assert.ok(violations.length >= 2); assert.ok(h.s.audit.find('shard_drift_detected').length >= 2);
});
test('الإيقاف الشامل يجمد الجدولة ويقفل الجاري', () => {
  const h = scaleState(); h.s.scheduler.enqueue('run', 'a'); h.s.scheduler.next(); h.s.killSwitch.engage(h.s.king.kingId, 'all', 'قبول');
  h.s.scheduler.freezeIfHalted(); assert.equal(h.s.scheduler.statusOf('run'), 'frozen'); assert.equal(h.s.scheduler.next(), null);
});
test('تغيير سقف طابور scale.yaml يغير السلوك الفعلي', () => {
  const dir = copiedScale((text) => text
    .replace('scheduler_queue_max: 128', 'scheduler_queue_max: 1')
    .replace('scheduler_owner_queue_max: 32', 'scheduler_owner_queue_max: 1'));
  const s = bootstrapState({ now: T0, configDir: dir }); assert.equal(s.scheduler.enqueue('one', 'a').ok, true); assert.equal(s.scheduler.enqueue('two', 'b').ok, false);
});
test('تهيئة سقف شرائح لا يساوي السكان ترفض قبل الإقلاع', () => {
  const dir = copiedScale((text) => text.replace('per_shard_max: 70000', 'per_shard_max: 62499'));
  assert.throws(() => loadScale(dir), (error: unknown) => (error as { code?: string }).code === 'CONFIG_SCALE_SHARD_CAP_MISMATCH');
});
test('تهيئة إعادة توازن صامتة ترفض قبل الإقلاع', () => {
  const dir = copiedScale((text) => text.replace('rebalance: forbidden', 'rebalance: allowed'));
  assert.throws(() => loadScale(dir), (error: unknown) => (error as { code?: string }).code === 'CONFIG_SCALE_REBALANCE_ALLOWED');
});
