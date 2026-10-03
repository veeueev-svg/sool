/**
 * tests/security/termination_scale.test.ts — أمرُ الإنهاء الجماعي يكتمل عند سكانٍ كبير (T-169 · W-2026-060 · C-07)
 * المالك: حرس التاج + ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-060.md
 * يثبت: أمرُ إنهاءٍ واحدٌ معتمدٌ من البوابة على مئات الألوف يُرجع تقريرًا مكتملًا ويدوّن
 *       `mass_termination_complete` — لا يرمي **بعد** إيقاف الجميع فيترك الإيقافَ بلا تقريرٍ ولا قيد.
 *       العيبُ المقيس: `Math.max(0, ...Object.values(stopMs))` ينشر وسيطًا لكلِّ كيان، فيرمي
 *       `RangeError` فوق ~150 ألفًا (حدُّ الوسائط في V8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, TerminationOrder } from '../../src/index';
import { EntityController } from '../../src/crown/termination_order';
import { EntityId } from '../../src/kernel/types';

/** فوق حدِّ نشر الوسائط في V8 بهامشٍ واسع، وتحت السقف المعلن */
const N = 250_000;

test('T-169: أمرُ إنهاءٍ جماعيٍّ على 250 ألف كيان يكتمل بتقريرٍ وقيد — لا يرمي بعد إيقاف الجميع', () => {
  const s = bootstrapState();
  const running = new Set<EntityId>(Array.from({ length: N }, (_, i) => `agent:scale-${i}` as EntityId));
  const controller: EntityController = {
    list: () => [...running],
    stop: (e) => running.delete(e),
    isRunning: (e) => running.has(e),
  };
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, controller, s.resources);
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));
  assert.equal(report.executed, true);
  assert.equal(report.complete, true, report.reason);
  assert.equal(report.stopped.length, N);
  assert.equal(report.failed.length, 0);
  assert.equal(running.size, 0);
  const done = s.audit.find('mass_termination_complete').at(-1);
  assert.ok(done, 'لا قيدَ اكتمال — والإيقافُ بلا قيدٍ لا يُثبت');
  const maxStopMs = done.detail['maxStopMs'] as number;
  assert.ok(Number.isFinite(maxStopMs) && maxStopMs > 0, `maxStopMs=${maxStopMs}`);
  assert.equal(maxStopMs, report.stopMs[report.stopped.at(-1)!], 'الأقصى هو زمنُ آخرِ كيانٍ توقّف (زمنٌ تراكميٌّ رتيب)');
});

test('T-169: سجلُّ السكان الحقيقيُّ بـ250 ألف هويّة يُنهى بأمرٍ واحدٍ عبر البوابة وتُستردُّ حصصُه كلُّها', () => {
  const s = bootstrapState();
  const now = Date.now();
  const batch = 62_500;
  for (let start = 0; start < N; start += batch) {
    const inputs = Array.from({ length: batch }, (_, i) => ({
      agentId: `agent:t169-${start + i}`, owner: `ministry:t169-${i % 16}`, resourceQuota: 'identity_slots:1',
    }));
    const r = s.population.registerBatch(s.king.issueCommand('create_agent', `scale:t169-${start}`, { batch }, now), inputs, now);
    assert.equal(r.ok, true);
  }
  assert.equal(s.population.population, N);
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, s.population.asEntityController(), s.resources);
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all', {}, now), now);
  assert.equal(report.complete, true, report.reason);
  assert.equal(report.stopped.length, N);
  assert.equal(s.population.population, 0);
  assert.equal(s.resources.allocated('identity_slots', now), 0);
  assert.equal(s.population.verifyShardIndex().ok, true);
  assert.ok(s.audit.find('mass_termination_complete').length >= 1);
});
