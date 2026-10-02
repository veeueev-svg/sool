/**
 * tests/security/termination_stop_timing.test.ts — زمنُ التوقّفِ مقيسٌ لا صفر (T-101 · W-2026-048)
 * المالك: حرس التاج + ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-048.md
 * يثبت: (1) أمرُ الإنهاء يُرجع زمنًا مقيسًا لكلِّ كيانٍ توقّف، ويكبر بكلفةِ التوقّفِ الحقيقية؛
 *       (2) التمرينُ يحكم بزمنِ المنفّذ — فكيانٌ أبطأ من `stop_deadline_ms` يُسقط الحكمَ
 *       بـ`TERM_DEADLINE_EXCEEDED`، وكيانٌ بلا زمنٍ مقيسٍ يُسقطه كذلك (الغيابُ ليس صفرًا).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, StopWitness, TerminationDrill, TerminationLedger } from '../../src/index';
import { TerminationOrder, EntityController } from '../../src/crown/termination_order';
import { EntityId } from '../../src/kernel/types';
import { declaredProbesOf, realExecutor, realReader, scene } from './helpers';

function spin(ms: number): void { const end = performance.now() + ms; while (performance.now() < end) { /* كلفةٌ حقيقية */ } }

function slowController(entities: EntityId[], costMs: number): EntityController {
  const running = new Set(entities);
  return {
    list: () => [...running],
    stop: (e) => { spin(costMs); running.delete(e); return true; },
    isRunning: (e) => running.has(e),
  };
}

test('T-101: أمرُ الإنهاء يُرجع لكلِّ كيانٍ زمنًا مقيسًا يكبر بكلفةِ توقّفه', () => {
  const s = bootstrapState();
  const order = new TerminationOrder(s.audit, s.gateway, s.killSwitch, slowController(['agent:a', 'agent:b'], 15), s.resources);
  const report = order.execute(s.king.issueCommand('terminate_agent', 'all'));
  assert.equal(report.complete, true);
  assert.deepEqual(Object.keys(report.stopMs).sort(), ['agent:a', 'agent:b']);
  assert.equal(report.stopMs['agent:a']! >= 15, true, `a=${report.stopMs['agent:a']}`);
  assert.equal(report.stopMs['agent:b']! >= 30, true, `b=${report.stopMs['agent:b']}`, );
  assert.equal(Number(s.audit.find('mass_termination_complete').at(-1)!.detail.maxStopMs) >= 30, true);
});

function drillWith(stopMsOf: (measured: Readonly<Record<string, number>>) => Readonly<Record<string, number>>) {
  const { s, agents, policy } = scene(2);
  const witness = new StopWitness({ audit: s.audit, policy, probes: declaredProbesOf(s) });
  const ledger = new TerminationLedger({ audit: s.audit, policy });
  const real = realExecutor(s);
  const drill = new TerminationDrill({
    audit: s.audit, killSwitch: s.killSwitch, witness, ledger, policy, mode: () => s.mode(),
    reader: realReader(s),
    executor: { execute: (t) => { const r = real.execute(t); return { ...r, stopMs: stopMsOf(r.stopMs) }; } },
  });
  const out = drill.run('authority:audit_bureau', agents);
  assert.equal(out.ran, true);
  return { out: out.ran ? out.verdict : null, agents, policy };
}

test('T-101: الزمنُ الحقيقيُّ تحت المهلة يمرّ — والتمرينُ يقرأ زمنَ المنفّذ لا صفرَ القارئ', () => {
  const { out } = drillWith((m) => m);
  assert.equal(out!.passed, true, out!.breaches.join(', '));
});

test('T-101: كيانٌ أبطأ من المهلة يُسقط الحكمَ بـTERM_DEADLINE_EXCEEDED', () => {
  const { out } = drillWith((m) => {
    const [first] = Object.keys(m);
    return { ...m, [first!]: 10_000 };
  });
  assert.equal(out!.passed, false);
  assert.equal(out!.breaches.includes('TERM_DEADLINE_EXCEEDED'), true, out!.breaches.join(', '));
});

test('T-101: كيانٌ بلا زمنٍ مقيسٍ يُحكم عليه بتجاوز المهلة — الغيابُ ليس صفرًا', () => {
  const { out } = drillWith(() => ({}));
  assert.equal(out!.passed, false);
  assert.equal(out!.verdicts.every((v) => v.breaches.includes('TERM_DEADLINE_EXCEEDED')), true);
});
