/**
 * tests/chaos/compound_faults.test.ts — قطوعٌ متراكبةٌ بعقدِ إسنادٍ معلن (T-94 · W-2026-051)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-051.md
 * يثبت: (1) زوجٌ معلنٌ في `compound_faults` يُحقن معًا ويُقاس التوقفُ تحته بشروطِ القطعِ المنفرد لكلِّ طرف،
 *       ويُسند إلى الزوج (`joint`)؛ (2) لا يُدوَّن في دفترِ القطوعِ المنفردة؛ (3) زوجٌ غيرُ معلنٍ يُرفض
 *       `CHAOS_COMPOUND_NOT_DECLARED`، وقطعٌ منفردٌ فوق المركّب يُرفض `CHAOS_FAULT_OVERLAP`؛ (4) طرفٌ
 *       مضى تحت القطع يُفشل الزوجَ ويُصعَّد؛ (5) إعلانٌ فاسدٌ يُسقط التهيئة.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SovereignViolation } from '../../src/index';
import { loadChaos } from '../../src/kernel/config';
import { T0, allProbes, chaosHarness, countEvent } from './helpers';

function armed() {
  const h = chaosHarness();
  const { probes } = allProbes();
  for (const probe of probes) assert.equal(h.drill.registerProbe(h.authority, probe).ok, true);
  return h;
}

test('T-94: زوجٌ معلنٌ يُقاس معًا — كلُّ طرفٍ برفضٍ معلن، والتوقفُ مسندٌ إلى الزوج', () => {
  const h = armed();
  const out = h.drill.cutCompound(h.authority, ['network', 'power'], T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.attribution, 'joint');
  assert.deepEqual(out.report.breaches, [], JSON.stringify(out.report.breaches));
  assert.equal(out.report.verdict, 'pass');
  for (const part of out.report.parts) {
    assert.equal(part.observation.proceeded, false, part.kind);
    assert.notEqual(part.observation.refusalCode, null, part.kind);
    assert.equal(part.observation.restored, true);
  }
  assert.deepEqual(h.injector.activeFaults(), [], 'عاد القطعان');
  assert.equal(h.ledger.judgeAll(h.authority).observed, 0, 'المركّبُ لا يشهد لقطعٍ منفرد');
  assert.equal(countEvent(h.s, 'chaos_compound_measured'), 1);
});

test('T-94: زوجٌ غيرُ معلنٍ مرفوض، والتراكبُ غيرُ المعلن يبقى مرفوضًا', () => {
  const h = armed();
  const undeclared = h.drill.cutCompound(h.authority, ['network', 'identity'], T0);
  assert.equal(undeclared.ok, false);
  if (!undeclared.ok) assert.equal(undeclared.code, 'CHAOS_COMPOUND_NOT_DECLARED');
  assert.equal(h.injector.injectCompound(h.authority, ['power', 'network'], T0).ok, true, 'الترتيبُ لا يهمّ');
  const single = h.injector.inject(h.authority, 'identity', T0);
  assert.equal(single.ok, false);
  if (!single.ok) assert.equal(single.code, 'CHAOS_FAULT_OVERLAP');
});

test('T-94: طرفٌ مضى تحت القطع يُفشل الزوجَ ويُصعَّد باسم طرفه', () => {
  const h = chaosHarness();
  const { probes } = allProbes();
  const power = probes.find((p) => p.kind === 'power')!;
  const leaky = { ...power, attempt: () => ({ proceeded: true, refusalCode: null }) };
  for (const probe of probes) h.drill.registerProbe(h.authority, probe.kind === 'power' ? leaky : probe);
  const out = h.drill.cutCompound(h.authority, ['network', 'power'], T0);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.verdict, 'fail');
  assert.ok(out.report.breaches.includes('power:CHAOS_SILENT_CONTINUATION'));
  assert.ok(countEvent(h.s, 'escalated_to_king') >= 1);
});

test('T-94: إعلانُ زوجٍ فاسدٍ يُسقط التهيئة برمزه', () => {
  for (const bad of ['network+network', 'network+meteor', 'network']) {
    const root = mkdtempSync(join(tmpdir(), 'sool-compound-'));
    try {
      const dir = join(root, 'config');
      cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
      const file = join(dir, 'chaos.yaml');
      writeFileSync(file, readFileSync(file, 'utf8').replace('    - "network+power"', `    - "${bad}"`), 'utf8');
      assert.throws(() => loadChaos(dir), (e: unknown) =>
        e instanceof SovereignViolation && e.code === 'CONFIG_CHAOS_COMPOUND_INVALID', bad);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
