/**
 * tests/production/deadline_probes.test.ts — ماسحُ المواعيد (W-2026-047 · T-50 · T-57 · T-64 · T-78 · T-81)
 * المالك: وزارة البنية | يوثّق في: docs/test-reports/phase-40-W-2026-047.md
 * يثبت: (1) كلُّ حكمِ وقتٍ من الخمسة يُطبَّق بالمسحة لا بنداءِ سائل، ويُرفع ما فات مرّةً واحدة؛
 *       (2) سقوطُ البندِ واجبٌ لا حادث؛ (3) الماسحُ مشترطٌ: حذفُه من التهيئة يُسقط الإقلاع؛
 *       (4) في الدولة المُقامة يُنادى المسحُ بمؤقّت المراقب على الوحدات الحقيقية.
 * ولا يثبت: أنّ المراقبَ يبدأ مع الإقلاع — ذلك T-109 مفتوح.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deadlinesProbe, DeadlineDeps, loadProduction, SovereignViolation,
  PRODUCTION_REQUIRED_SCANNERS, PRODUCTION_KNOWN_INCIDENTS,
} from '../../src/index';
import { OBSERVER, quietDeadlines, repoPolicy, withConfigCopy, productionHarness } from './helpers';

const NOW = 1_700_000_000_000;
const deps = (patch: Partial<DeadlineDeps>): DeadlineDeps => ({ ...quietDeadlines(), ...patch });

test('T-50: بندٌ انقضت فترتُه يسقط بالمسحة — وسقوطُه واجبٌ لا حادث، وما لم ينقضِ لا يُمسّ', () => {
  const lapsed: string[] = [];
  const probe = deadlinesProbe(deps({
    budget: {
      active: () => [{ line: 'old', periodEnd: NOW - 1 }, { line: 'live', periodEnd: NOW + 1 }],
      lapse: (line) => { lapsed.push(line); return { ok: true }; },
    },
  }));
  assert.deepEqual(probe(NOW), []);
  assert.deepEqual(lapsed, ['old']);
});

test('T-57 · T-64: الدفعةُ بلا إثباتٍ والتسويةُ المتأخرةُ تُرفعان من الوحدة نفسها حادثًا جسيمًا', () => {
  const probe = deadlinesProbe(deps({
    payments: { raiseOverdue: () => [{ paymentId: 'pay-1' }] },
    settlements: { raiseUnsettled: () => [{ contractId: 'c-1' }], raiseUndisposed: () => [] },
  }));
  const kinds = probe(NOW).map((f) => f.kind);
  assert.deepEqual(kinds, ['payment_confirmation_overdue', 'settlement_overdue']);
  const high = repoPolicy().severity.high as readonly string[];
  for (const k of kinds) assert.equal(high.includes(k), true, `${k} جسيمٌ في التهيئة`);
});

test('T-78: خدمةٌ فقدت مصدرَها تهبط بالمسحة وإن لم يصل طلب — والثباتُ ليس حادثًا', () => {
  const svc = { serviceId: 'svc-1', mode: 'full' };
  const calls: string[] = [];
  const probe = deadlinesProbe(deps({
    services: {
      activeServices: () => [svc],
      reconcile: (id, by) => {
        calls.push(`${id}|${by}`);
        svc.mode = 'limited';
        return { ok: true, service: svc };
      },
    },
  }));
  const first = probe(NOW);
  assert.equal(first.length, 1);
  assert.equal(first[0]!.kind, 'critical_service_degraded');
  assert.deepEqual(calls, [`svc-1|${OBSERVER}`]);
  assert.deepEqual(probe(NOW + 1), [], 'لا هبوطَ جديدًا ⇒ لا حادث');
});

test('T-81: بحثٌ منتهٍ ودرسٌ بالٍ يُرفعان مرّةً واحدة لا في كل مسحة', () => {
  const probe = deadlinesProbe(deps({
    research: { lapsed: () => ({ researches: ['r-1'], lessons: ['l-1'] }) },
  }));
  assert.equal(probe(NOW).length, 2);
  assert.equal(probe(NOW + 1).length, 0);
});

test('الماسحُ مشترطٌ وحوادثُه معروفة: حذفُ `deadlines` من التهيئة يُسقط الإقلاع', () => {
  assert.equal(PRODUCTION_REQUIRED_SCANNERS.includes('deadlines'), true);
  for (const k of ['payment_confirmation_overdue', 'settlement_overdue', 'critical_service_degraded', 'research_lapsed']) {
    assert.equal((PRODUCTION_KNOWN_INCIDENTS as readonly string[]).includes(k), true, k);
  }
  withConfigCopy((dir) => {
    const file = join(dir, 'production.yaml');
    const text = readFileSync(file, 'utf8');
    assert.equal(text.includes('    - "deadlines"\n'), true);
    writeFileSync(file, text.replace('    - "deadlines"\n', ''), 'utf8');
    assert.throws(() => loadProduction(dir), (e: unknown) =>
      e instanceof SovereignViolation && e.code === 'CONFIG_PRODUCTION_REQUIRED_SCANNER_MISSING');
  });
});

test('في الدولة المُقامة: مسحةُ المراقب تنادي حكمَ الوقتِ على الوحدات الحقيقية', () => {
  const h = productionHarness({ now: NOW });
  try {
    const before = h.state.audit.find('human_research_lapse_swept').length;
    h.supervisor.sweep(NOW + 1);
    assert.equal(h.state.audit.find('human_research_lapse_swept').length, before + 1);
  } finally { h.dispose(NOW + 2); }
});
