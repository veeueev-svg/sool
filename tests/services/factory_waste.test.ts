/**
 * tests/services/factory_waste.test.ts — الهدرُ المتكرّرُ يعلّق المنشأة (T-72 · W-2026-050)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-050.md
 * يثبت: (1) كلُّ دفعةٍ مقفلةٍ فوق التسامح تُقيَّد `production_waste_breach` بعدٍّ تراكميّ؛ (2) بلوغُ
 *       `waste_breaches_to_suspend` يعلّق المنشأةَ آليًّا بيد المشغّل فلا تبدأ دفعةٌ بعدها؛ (3) الفقدُ
 *       عند الحدِّ لا يُعدّ؛ (4) مشغّلٌ ليس جهةَ تعليقٍ يُسقط التهيئة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SovereignViolation } from '../../src/index';
import { loadEnterprises } from '../../src/kernel/config';
import { CHECKS, ECONOMY, FACILITY, RAW, establish, industrialState, inspect, startRun, stockExternal } from './helpers';

const PARTIAL = ['input_provenance', 'output_integrity', 'resource_within_limit'];

function ready() {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, 400).ok, true);
  return h;
}

test('T-72: الهدرُ فوق التسامح يُراكم عبر الدفعات — وبلوغُ الحدِّ يعلّق المنشأةَ آليًّا', () => {
  const h = ready();
  const { waste_tolerance_per_mille: tol, waste_breaches_to_suspend: limit } = h.s.enterprisesConfig.policy;
  assert.equal(limit, 3);
  for (let i = 1; i <= limit; i++) {
    assert.equal(startRun(h, `run-${i}`, { [RAW]: 4 }, { wastePerMille: tol + 1 }).ok, true, `بدء ${i}`);
    assert.equal(inspect(h, `run-${i}`, PARTIAL).ok, true);
    const last = h.s.audit.find('production_waste_breach').at(-1)!.detail;
    assert.equal(last.count, i);
  }
  const suspended = h.s.audit.find('facility_suspended').at(-1)!;
  assert.equal(suspended.actor, ECONOMY);
  assert.match(String(suspended.detail.reason), /T-72/);
  assert.equal(h.s.companies.get(FACILITY)?.status, 'suspended');
  assert.equal(startRun(h, 'run-after', { [RAW]: 4 }).ok, false, 'لا دفعةَ لمنشأةٍ معلَّقة');
});

test('T-72: الفقدُ عند الحدِّ لا يُعدّ — والدفعاتُ النظيفةُ لا تعلّق', () => {
  const h = ready();
  const tol = h.s.enterprisesConfig.policy.waste_tolerance_per_mille;
  for (let i = 1; i <= 4; i++) {
    assert.equal(startRun(h, `ok-${i}`, { [RAW]: 4 }, { wastePerMille: tol }).ok, true);
    assert.equal(inspect(h, `ok-${i}`, CHECKS).ok, true);
  }
  assert.equal(h.s.audit.find('production_waste_breach').length, 0);
  assert.equal(h.s.companies.get(FACILITY)?.status, 'active');
});

test('T-72: مشغّلٌ ليس جهةَ تعليقٍ معلنة يُسقط التهيئةَ برمزه', () => {
  const root = mkdtempSync(join(tmpdir(), 'sool-ent-'));
  try {
    const dir = join(root, 'config');
    cpSync(join(process.cwd(), 'config'), dir, { recursive: true });
    const file = join(dir, 'enterprises.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('    - "ministry:economy"\n', ''), 'utf8');
    assert.throws(() => loadEnterprises(dir), (e: unknown) =>
      e instanceof SovereignViolation && e.code === 'CONFIG_ENTERPRISE_WASTE_SUSPENDER');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
