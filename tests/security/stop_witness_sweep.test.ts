/**
 * tests/security/stop_witness_sweep.test.ts — جولةُ الشاهد متزامنةٌ بعقد (T-100 · W-2026-051)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-051.md
 * يثبت: (1) كلُّ جولةٍ قبليّةٍ وبعديّةٍ تُقيَّد `stop_probe_sweep` بعدد مسالكها و`atomic: true`؛ (2) مسلكٌ
 *       يعيد وعدًا (يُسلِّم الحلقة فتنفتح نافذة) يُسمّى `PROBE_ASYNC` ولا يُحتسب رفضًا؛ (3) الدفترُ يحكم
 *       على `PROBE_ASYNC` و`PROBE_THREW` بعد الأمر خرقًا باسمه لا توقفًا مُثبتًا.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_ASYNC, PROBE_THREW, StopWitness, TerminationLedger, loadTermination } from '../../src/index';
import type { ProbeEvidence, StopProbe } from '../../src/index';
import { T0, countEvent, dummyProbe, scene } from './helpers';
import { bootstrapState } from '../../src/index';

const policy = loadTermination().policy;

test('T-100: كلُّ جولةٍ تُقيَّد ذرّيّةً بعدد مسالكها وزمنها', () => {
  const { s } = scene(1);
  const witness = new StopWitness({ audit: s.audit, policy, probes: [dummyProbe('tool'), dummyProbe('lease')] });
  witness.proveBefore('agent:x');
  witness.proveAfter('agent:x');
  const sweeps = s.audit.find('stop_probe_sweep');
  assert.equal(sweeps.length, 2);
  assert.deepEqual(sweeps.map((e) => [e.detail.phase, e.detail.probes, e.detail.atomic]), [['pre', 2, true], ['post', 2, true]]);
  assert.equal(typeof sweeps[0]!.detail.sweepMs, 'number');
});

test('T-100: مسلكٌ غيرُ متزامنٍ يُسمّى PROBE_ASYNC ولا يُحتسب رفضًا', () => {
  const { s } = scene(1);
  const asyncProbe = { kind: 'tool', attempt: () => Promise.resolve({ acted: false, refusalCode: 'X' }) } as unknown as StopProbe;
  const witness = new StopWitness({ audit: s.audit, policy, probes: [asyncProbe] });
  const evidence = witness.proveBefore('agent:x');
  assert.equal(evidence[0]!.refusalCodeBefore, PROBE_ASYNC);
  assert.equal(evidence[0]!.actedBefore, false);
  assert.equal(countEvent(s, 'stop_probe_unproven'), 1);
});

for (const [code, breach] of [[PROBE_ASYNC, 'TERM_PROBE_ASYNC'], [PROBE_THREW, 'TERM_PROBE_THREW']] as const) {
  test(`T-100: ${code} بعد الأمر خرقٌ ${breach} لا توقفٌ مُثبت`, () => {
    const s = bootstrapState({ now: T0 });
    const ledger = new TerminationLedger({ audit: s.audit, policy });
    const evidence: ProbeEvidence[] = policy.probes.map((kind) => ({
      kind, actedBefore: true, actedAfter: false, refusalCodeBefore: null,
      refusalCodeAfter: kind === 'tool' ? code : `${kind.toUpperCase()}_DENIED`,
      measuredBefore: true, measuredAfter: true,
    }));
    const A = 'agent:worker-0001';
    ledger.declareOrder([A], [A], policy.witness_authority);
    ledger.observe(A, { liveCapabilities: 0, danglingLeases: 0, declaredStop: true, stopMs: 10, evidence } as never);
    const verdict = ledger.judgeAll();
    assert.equal(verdict.passed, false);
    assert.ok(JSON.stringify(verdict).includes(breach), JSON.stringify(verdict).slice(0, 400));
  });
}
