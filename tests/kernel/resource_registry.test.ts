/**
 * tests/kernel/resource_registry.test.ts — اختبار قبول المرحلة 5
 * المالك: وزارة البنية | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { ResourceRegistry } from '../../src/kernel/resource_registry';
import { SovereignViolation } from '../../src/kernel/types';
import { loadQuotas, resolveConfigDir } from '../../src/kernel/config';

const SPECS = {
  compute_units: { total: 100, per_agent_max: 10, lease_seconds: 60 },
  egress_calls: { total: 0, per_agent_max: 0, lease_seconds: 0 },
};

function reg() {
  const audit = new AppendOnlyLog();
  return { audit, registry: new ResourceRegistry(audit, SPECS) };
}

test('مورد غير مسجَّل يُرفض بفشل مغلق', () => {
  const { registry } = reg();
  assert.throws(() => registry.lease('agent:1', 'gpu_hours', 1), SovereignViolation);
});

test('إيجار داخل السقف يُمنح ويُسجَّل', () => {
  const { audit, registry } = reg();
  const r = registry.lease('agent:1', 'compute_units', 5, 1000);
  assert.equal(r.granted, true);
  if (!r.granted) return;
  assert.equal(r.lease.expiresAt, 1000 + 60_000);
  assert.equal(registry.available('compute_units', 1000), 95);
  assert.equal(audit.find('resource_leased').length, 1);
});

test('تجاوز سقف الكيان يُرفض', () => {
  const { registry } = reg();
  const r = registry.lease('agent:1', 'compute_units', 11, 1000);
  assert.equal(r.granted, false);
  if (!r.granted) assert.match(r.reason, /سقف الكيان/);
});

test('السقف التراكمي للكيان يُحترم عبر إيجارات متعددة', () => {
  const { registry } = reg();
  assert.equal(registry.lease('agent:1', 'compute_units', 6, 1000).granted, true);
  const second = registry.lease('agent:1', 'compute_units', 5, 1000);
  assert.equal(second.granted, false);
  assert.equal(registry.usageOf('agent:1', 'compute_units', 1000), 6);
});

test('استنفاد السقف الكلي يمنع كيانات جديدة', () => {
  const { registry } = reg();
  for (let i = 0; i < 10; i++) {
    assert.equal(registry.lease(`agent:${i}`, 'compute_units', 10, 1000).granted, true);
  }
  assert.equal(registry.available('compute_units', 1000), 0);
  const overflow = registry.lease('agent:99', 'compute_units', 1, 1000);
  assert.equal(overflow.granted, false);
  if (!overflow.granted) assert.match(overflow.reason, /لا يوجد متاح/);
});

test('مورد بسقف صفري (الخروج الشبكي) مرفوض دائمًا', () => {
  const { registry } = reg();
  const r = registry.lease('agent:1', 'egress_calls', 1, 1000);
  assert.equal(r.granted, false);
  if (!r.granted) assert.match(r.reason, /سقف صفري/);
});

test('الإيجار ينتهي تلقائيًا ويُستعاد المورد بلا تمديد ضمني', () => {
  const { audit, registry } = reg();
  registry.lease('agent:1', 'compute_units', 10, 1000);
  assert.equal(registry.available('compute_units', 1000), 90);
  assert.equal(registry.available('compute_units', 62_000), 100);
  const expired = registry.reclaimExpired(62_000);
  assert.equal(expired.length, 1);
  assert.equal(audit.find('resource_lease_expired').length, 1);
  assert.equal(registry.activeLeases(62_000).length, 0);
});

test('إنهاء كيان يستعيد كل موارده', () => {
  const { registry } = reg();
  registry.lease('agent:1', 'compute_units', 4, 1000);
  registry.lease('agent:1', 'compute_units', 3, 1000);
  registry.lease('agent:2', 'compute_units', 5, 1000);
  assert.equal(registry.releaseAllFor('agent:1'), 2);
  assert.equal(registry.usageOf('agent:1', 'compute_units', 1000), 0);
  assert.equal(registry.usageOf('agent:2', 'compute_units', 1000), 5);
});

test('تهيئة الحصص الحقيقية تُحمَّل وتحترم الحدود المعلنة', () => {
  const quotas = loadQuotas(resolveConfigDir());
  assert.ok(quotas.resources['compute_units']);
  assert.equal(quotas.resources['egress_calls']!.total, 0, 'الخروج الشبكي مرفوض افتراضيًا');
  assert.ok(quotas.agents.population_max > 0);
  for (const spec of Object.values(quotas.resources)) {
    assert.ok(spec.per_agent_max <= spec.total);
  }
});
