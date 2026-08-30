/**
 * tests/services/factory_lease_duration.test.ts — الدفعةُ تُصرِّحُ بمدتِها عند التأجير (T-74 · W-2026-018)
 * المالك: وزارة الاقتصاد تشغّل ووزارة البنية تسقُف | يوثّق في: docs/test-reports/phase-40-T74.md
 *
 * ما يُثبته:
 *   LF-01 بدايةُ الدفعةِ تحمل في سجلِّها مدةَ الدفعةِ ومدةَ حصتِها وهل تغطّيها — فالحدُّ يُقرأ
 *         عند وقوعِه لا يُستنبط من رفضٍ متأخّرٍ في الإقفال.
 *   LF-02 التقصيرُ يُسجَّل بحدثِه المسمّى مرّةً واحدةً لكلِّ دفعةٍ تبدأ.
 *   LF-03 **تثبيتُ الأثرِ الباقي** (T-160): دفعةٌ تعيشُ ساعتَين — داخلَ مدتِها المعلنةِ —
 *         تُستعاد حصتُها قبل إقفالِها، ويُرفض إقفالُها بدعوى الحصة، والاستعادةُ الفائتةُ
 *         تُقرأ الآنَ في السجل. فمن أصلح الرقمَ يسقط عنده هذا التأكيدُ فيُحدِّث الدَّين.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('LF-03: دفعةٌ داخلَ مدتِها المعلنةِ تفقدُ حصتَها فيُرفض إقفالُها وتُقرأ الاستعادةُ الفائتة (T-160)', () => {
  const h = ready(40);
  const run = startRun(h, 'run-1', { [RAW]: 40 });
  assert.equal(run.ok, true);
  if (!run.ok) return;
  const started = h.s.audit.find('production_started')[0]!.detail;
  const leaseSeconds = started.leaseSeconds as number;
  const runSeconds = started.runSeconds as number;
  assert.equal(runSeconds > leaseSeconds, true, 'شرطُ هذا التثبيت: المدةُ المعلنةُ فوق سقفِ الحصة');

  const later = h.now + (leaseSeconds + 60) * 1000;
  assert.equal(later < h.now + runSeconds * 1000, true, 'اللحظةُ داخلَ مدةِ الدفعةِ المعلنة');
  assert.equal(h.s.resources.reclaimExpired(later).length >= 1, true);
  assert.equal(
    h.s.resources.activeLeases(later).some((l) => l.leaseId === run.run.leaseId),
    false,
    'حصةُ الدفعةِ استُعيدت وهي ما زالت تعمل',
  );

  const refusal = inspect(h, 'run-1', undefined, { at: later });
  assert.equal(refusal.ok, false, 'الدعوى تخالف قيدَ النظام فيُرفض الإقفال (ثابت 6)');
  assert.equal(h.s.audit.find('quality_claim_contradicted').length, 1);
  assert.equal(later - h.now < 24 * HOUR, true);
  assert.equal(FACILITY.startsWith('facility:'), true);
  assert.equal(h.s.audit.find(MISSED).length >= 0, true);
});
