/**
 * tests/agents/spawn_reservations.test.ts — دفترُ الحجز (المرحلة 39، T-25)
 * المالك: وزارة الداخلية | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: دفترٌ بحدودٍ صريحة ولحظاتٌ ممرَّرة | المخرجات: نصيبٌ محاسَبٌ لا مُدَّعى
 * التبعيات: src/agents/spawn_reservations.ts وحده — لا تهيئةَ ولا ساعةَ نظام
 * الصلاحيات: القياسُ وحده | السجلات: لا شيء
 * حالات الفشل: تُقرأ بقيمة `ok` وبنصّ سببٍ غير مشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0027-measured-lineage.md
 * ثابتُ هذا الملف: **المجموعُ لا يتغيّر بالتثبيت** — المعلَّقُ يصير مُثبَّتًا فقط.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SpawnReservationLedger } from '../../src/index';

const TTL = 1000;

function ledger(maxOutstanding = 8): SpawnReservationLedger {
  return new SpawnReservationLedger({
    reservationTtlMs: TTL, maxOutstandingReservations: maxOutstanding,
  });
}

test('الحجزُ يُخصم لحظتَه: النصيبُ المشغولُ يرتفع قبل أي تثبيت', () => {
  const l = ledger();
  const r = l.reserve('bp', 3, 10, 0);
  assert.equal(r.ok, true);
  assert.equal(l.chargedOf('bp', 0), 3);
  assert.equal(l.committedOf('bp'), 0);
  assert.equal(l.pendingOf('bp', 0), 3);
});

test('التثبيتُ ينقل ولا يزيد: المجموعُ نفسُه قبله وبعده', () => {
  const l = ledger();
  const r = l.reserve('bp', 3, 10, 0);
  const before = l.chargedOf('bp', 0);
  assert.equal(r.ok && l.commit(r.reservation.reservationId, 1).ok, true);
  assert.equal(l.chargedOf('bp', 1), before);
  assert.equal(l.committedOf('bp'), 3);
  assert.equal(l.pendingOf('bp', 1), 0);
});

test('الإفراجُ يُعيد النصيبَ ولا يُثبِّت شيئًا', () => {
  const l = ledger();
  const r = l.reserve('bp', 4, 4, 0);
  assert.equal(r.ok && l.release(r.reservation.reservationId, 1).ok, true);
  assert.equal(l.chargedOf('bp', 1), 0);
  assert.equal(l.committedOf('bp'), 0);
  assert.equal(l.reserve('bp', 4, 4, 1).ok, true);
});

test('حجزان متعاقبان لا يتجاوزان السقفَ — الثاني يُرفض بعددٍ في سببه', () => {
  const l = ledger();
  assert.equal(l.reserve('bp', 4, 5, 0).ok, true);
  const second = l.reserve('bp', 2, 5, 0);
  assert.equal(second.ok, false);
  assert.match(!second.ok ? second.reason : '', /4 \+ 2 > 5/);
});

test('السقفُ يُقاس على المُثبَّت والمعلَّق معًا لا على المُثبَّت وحده', () => {
  const l = ledger();
  const first = l.reserve('bp', 3, 6, 0);
  assert.equal(first.ok && l.commit(first.reservation.reservationId, 0).ok, true);
  assert.equal(l.reserve('bp', 3, 6, 0).ok, true);
  assert.equal(l.reserve('bp', 1, 6, 0).ok, false);
});

test('سقفُ مخططٍ لا يمسّ سقفَ آخر — النصيبُ محاسَبٌ لكلِّ مخططٍ وحده', () => {
  const l = ledger();
  assert.equal(l.reserve('a', 4, 4, 0).ok, true);
  assert.equal(l.reserve('a', 1, 4, 0).ok, false);
  assert.equal(l.reserve('b', 4, 4, 0).ok, true);
});

test('حجزٌ لم يُسوَّ يسقط بمهلته ويعيد نصيبَه', () => {
  const l = ledger();
  assert.equal(l.reserve('bp', 2, 2, 0).ok, true);
  assert.equal(l.reserve('bp', 2, 2, TTL - 1).ok, false);
  assert.equal(l.reserve('bp', 2, 2, TTL).ok, true);
  assert.equal(l.expired(), 1);
});

test('تسويةُ حجزٍ ساقطٍ مرفوضةٌ — لا نصيبَ يُثبَّت بعد سقوطه', () => {
  const l = ledger();
  const r = l.reserve('bp', 2, 4, 0);
  const settled = r.ok ? l.commit(r.reservation.reservationId, TTL + 1) : { ok: true as const };
  assert.equal(settled.ok, false);
  assert.equal(l.committedOf('bp'), 0);
});

test('تثبيتٌ ثانٍ على المعرّف نفسه مرفوض — لا مضاعفةَ نصيب', () => {
  const l = ledger();
  const r = l.reserve('bp', 2, 8, 0);
  assert.equal(r.ok && l.commit(r.reservation.reservationId, 0).ok, true);
  const again = r.ok ? l.commit(r.reservation.reservationId, 0) : { ok: true as const };
  assert.equal(again.ok, false);
  assert.equal(l.committedOf('bp'), 2);
});

test('إفراجٌ ثانٍ على المعرّف نفسه مرفوض — لا زيادةَ نصيبٍ بالتكرار', () => {
  const l = ledger();
  const r = l.reserve('bp', 2, 2, 0);
  assert.equal(r.ok && l.release(r.reservation.reservationId, 0).ok, true);
  const again = r.ok ? l.release(r.reservation.reservationId, 0) : { ok: true as const };
  assert.equal(again.ok, false);
  assert.equal(l.chargedOf('bp', 0), 0);
});

test('معرّفُ حجزٍ مجهولٌ يُرفض بسببه لا بصمت', () => {
  const l = ledger();
  const settle = l.commit('reservation:ghost#1', 0);
  assert.equal(settle.ok, false);
  assert.match(!settle.ok ? settle.reason : '', /مجهول/);
});

test('عددُ حجزٍ غيرُ صالحٍ يُرفض: صفرٌ وسالبٌ وكسر', () => {
  const l = ledger();
  for (const count of [0, -1, 1.5, Number.NaN]) {
    assert.equal(l.reserve('bp', count, 10, 0).ok, false, String(count));
  }
});

test('حدُّ الحجوزِ المعلَّقة يُلجم الطوابيرَ المفتوحة', () => {
  const l = ledger(3);
  for (let i = 0; i < 3; i += 1) assert.equal(l.reserve(`bp${i}`, 1, 10, 0).ok, true);
  const overflow = l.reserve('bp9', 1, 10, 0);
  assert.equal(overflow.ok, false);
  assert.match(!overflow.ok ? overflow.reason : '', /معلَّقةٌ بلغت الحدَّ/);
});

test('حجوزٌ ساقطةٌ تُخلي مكانَها في حدِّ المعلَّق', () => {
  const l = ledger(2);
  assert.equal(l.reserve('a', 1, 10, 0).ok, true);
  assert.equal(l.reserve('b', 1, 10, 0).ok, true);
  assert.equal(l.reserve('c', 1, 10, 0).ok, false);
  assert.equal(l.reserve('c', 1, 10, TTL).ok, true);
  assert.equal(l.outstandingCount(TTL), 1);
});

test('اللقطةُ تُعيد المُثبَّتَ وحده — لا حجزَ معلَّقٌ يُسترجع', () => {
  const l = ledger();
  const r = l.reserve('a', 2, 5, 0);
  assert.equal(r.ok && l.commit(r.reservation.reservationId, 0).ok, true);
  assert.equal(l.reserve('a', 1, 5, 0).ok, true);
  assert.deepEqual(l.snapshot(), { a: 2 });
});

test('استعادةُ لقطةٍ تُبني المُثبَّتَ ولا تُبقي قديمًا', () => {
  const l = ledger();
  const r = l.reserve('a', 2, 5, 0);
  assert.equal(r.ok && l.commit(r.reservation.reservationId, 0).ok, true);
  l.restoreCommitted(new Map([['b', 3]]));
  assert.equal(l.committedOf('a'), 0);
  assert.equal(l.committedOf('b'), 3);
});

test('إسقاطُ مُثبَّتٍ لا ينزل تحت الصفر — لا نصيبَ سالبٌ يُشترى به توالد', () => {
  const l = ledger();
  const r = l.reserve('a', 2, 5, 0);
  assert.equal(r.ok && l.commit(r.reservation.reservationId, 0).ok, true);
  l.discardCommitted('a', 9);
  assert.equal(l.committedOf('a'), 0);
});

test('الدفترُ لا يقرأ الساعة: اللحظةُ الممرَّرةُ وحدها تُقرِّر السقوط', () => {
  const l = ledger();
  assert.equal(l.reserve('bp', 1, 1, 0).ok, true);
  // لحظةٌ في الماضي البعيد لا تُسقط حجزًا — ولا ساعةَ نظامٍ تتدخّل
  assert.equal(l.reserve('bp', 1, 1, -TTL).ok, false);
  assert.equal(l.expired(), 0);
});
