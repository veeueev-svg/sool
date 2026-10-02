/**
 * tests/services/factory_lease_duration.test.ts — الدفعةُ تُصرِّحُ بمدتِها عند التأجير (T-74 · W-2026-018)
 * المالك: وزارة الاقتصاد تشغّل ووزارة البنية تسقُف | يوثّق في: docs/test-reports/phase-40-T74.md
 *
 * ما يُثبته:
 *   LF-01 بدايةُ الدفعةِ تحمل في سجلِّها مدةَ الدفعةِ ومدةَ حصتِها وهل تغطّيها — فالحدُّ يُقرأ
 *         عند وقوعِه لا يُستنبط من رفضٍ متأخّرٍ في الإقفال.
 *   LF-02 التقصيرُ يُسجَّل بحدثِه المسمّى مرّةً واحدةً لكلِّ دفعةٍ تبدأ.
 *   LF-03 **الأثرُ أُزيل** (T-160 · W-2026-044): الحصةُ تغطّي الدفعةَ كاملةً، فدفعةٌ تُفتَّش قبيلَ
 *         نهايةِ مدتِها المعلنةِ حصتُها قائمةٌ وإقفالُها مقبول — وكان يُرفض بعد الساعةِ الأولى.
 *   LF-04 تركيبٌ بإعلانٍ متناقضٍ (24 ساعةً فوق سقفِ 3600ث) يُرفض بـ`ENTERPRISE_RUN_EXCEEDS_LEASE`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';
import { FACILITY, HOUR, RAW, establish, industrialState, inspect, startRun, stockExternal } from './helpers';

const CAPPED = 'resource_lease_duration_capped';
const MISSED = 'resource_release_missed';

function ready(rawQuantity = 40) {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, rawQuantity).ok, true);
  return h;
}

test('LF-01: بدايةُ الدفعةِ تُسجِّل مدةَ الدفعةِ ومدةَ الحصةِ وهل تغطّيها', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const started = h.s.audit.find('production_started');
  assert.equal(started.length, 1);
  const detail = started[0]!.detail;
  assert.equal(typeof detail.runSeconds, 'number');
  assert.equal(typeof detail.leaseSeconds, 'number');
  assert.equal(detail.runSeconds as number > 0, true);
  assert.equal(detail.leaseSeconds as number > 0, true);
  assert.equal(
    detail.leaseCoversRun,
    (detail.leaseSeconds as number) >= (detail.runSeconds as number),
    'الدعوى تُقابَل بحسابِها: التغطيةُ مقيسةٌ لا مُدَّعاة',
  );
});

test('LF-02: تقصيرُ مدةِ الحصةِ عن مدةِ الدفعةِ يُسجَّل مرّةً واحدةً عند البداية', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const capped = h.s.audit.find(CAPPED);
  const started = h.s.audit.find('production_started')[0]!.detail;
  if (started.leaseCoversRun === true) {
    assert.equal(capped.length, 0, 'حيث تغطّي الحصةُ الدفعةَ لا تقصيرَ يُسجَّل');
    return;
  }
  assert.equal(capped.length, 1);
  assert.equal(capped[0]?.detail.requestedSeconds, started.runSeconds);
  assert.equal(capped[0]?.detail.grantedSeconds, started.leaseSeconds);
  assert.equal(
    capped[0]?.detail.shortfallSeconds,
    (started.runSeconds as number) - (started.leaseSeconds as number),
  );
});

test('LF-03: الحصةُ تغطّي الدفعةَ كاملةً — والإقفالُ قبيلَ نهايةِ مدتِها مقبول (T-160)', () => {
  const h = ready(40);
  const run = startRun(h, 'run-1', { [RAW]: 40 });
  assert.equal(run.ok, true);
  if (!run.ok) return;
  const started = h.s.audit.find('production_started')[0]!.detail;
  assert.equal(started.leaseCoversRun, true, 'الحصةُ تغطّي مدةَ الدفعةِ المعلنة');
  assert.equal(h.s.audit.find(CAPPED).length, 0, 'ولا تقصيرَ يُسجَّل');
  const later = h.now + ((started.runSeconds as number) - 60) * 1000;
  h.s.resources.reclaimExpired(later);
  assert.equal(
    h.s.resources.activeLeases(later).some((l) => l.leaseId === run.run.leaseId), true,
    'الحصةُ قائمةٌ ما دامت الدفعةُ في مدتِها',
  );
  const closed = inspect(h, 'run-1', undefined, { at: later });
  assert.equal(closed.ok, true, 'الإقفالُ داخلَ المدةِ لا يُرفض بدعوى الحصة');
  assert.equal(h.s.audit.find('quality_claim_contradicted').length, 0);
  assert.equal(h.s.audit.find(MISSED).length, 0);
  assert.equal(FACILITY.startsWith('facility:'), true);
  assert.equal(later - h.now < HOUR, true);
});

test('LF-04: تركيبٌ بمدةِ دفعةٍ فوق سقفِ الحصةِ يُرفض عند الإقلاع (T-160)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sool-t160-'));
  try {
    cpSync(resolveConfigDir(), dir, { recursive: true });
    const file = join(dir, 'enterprises.yaml');
    writeFileSync(file, readFileSync(file, 'utf8')
      .replace(/^  max_run_duration_hours: \d+$/m, '  max_run_duration_hours: 24'));
    assert.throws(() => bootstrapState({ configDir: dir }), /ENTERPRISE_RUN_EXCEEDS_LEASE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
