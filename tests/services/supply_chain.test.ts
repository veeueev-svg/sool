/**
 * tests/services/supply_chain.test.ts — اختبارات وحدة المخزون وسلاسل التوريد (المرحلة 28)
 * المالك: وزارة الاقتصاد تحت التاج | يوثّق في: docs/test-reports/phase-28.md
 * ما يُثبته: أن المادة لا تظهر بلا سند مصدر معلن، وأن المادة الخارجية تدخل على **عقد قائم**
 * لا على اسم مذكور، وأن المخزون لا يصير سالبًا، وأن النقل لا يُنشئ مادة ولا يُفنيها.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_CP, BLOCK, COMPUTE_CP, CROWN_GUARD, DAY, ECONOMY, FACILITY, INDEX, KIND_PLANT, RAW,
  SEALED, beat, establish, industrialState, stockExternal,
} from './helpers';

/* ————— 1) السند المعلن قبل الكمية (ثابتا 1 و2) ————— */

test('مادة خارجية تدخل على عقد قائم يطابق نظيرها المعلن', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const result = stockExternal(h, RAW, 40);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balance, 40);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 40);
  const entry = h.s.audit.find('stock_received')[0];
  assert.equal((entry?.detail as { provenance: string }).provenance, 'external_contract');
});

test('مادة غير معلنة في التهيئة تُرفض — الاستلام لا يُنشئ مادة (RULE-005)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const result = h.s.supply.receive(FACILITY, 'material:uranium', 5, {
    kind: 'external_contract', contractId: h.contractIds[COMPUTE_CP] as string,
  }, ECONOMY, h.now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير معلنة/);
});

test('كمية غير مُقاسة تُرفض: صفر أو سالب أو كسري أو NaN (T-69)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  for (const quantity of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(stockExternal(h, RAW, quantity).ok, false, `قُبلت كمية ${String(quantity)}`);
  }
  assert.equal(h.s.supply.balance(FACILITY, RAW), 0);
});

test('عقد غير قائم يُرفض به الاستلام — لا مادة على اسم مذكور (ADR-0011 قرار 1)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const result = stockExternal(h, RAW, 40, { contractId: 'contract:imaginary' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /لا عقد قائم/);
});

test('عقد قائم لنظير آخر يُرفض — النظير يطابق مصدر المادة المعلن (ثابت 3)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  // مادة الحوسبة على عقد الأرشيف: قناة قائمة لكنها ليست قناة هذه المادة
  const result = stockExternal(h, RAW, 40, { contractId: h.contractIds[ARCHIVE_CP] as string });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /لا يطابق مصدر المادة/);
});

test('عقد انتهى قبل الاستلام يُرفض به — الاستلام يسأل عن قيام العقد في اللحظة', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 90 }).ok, true);
  const after = h.now + 31 * DAY; // العقد مدته 30 يومًا في الأرضية
  beat(h, after);
  const result = stockExternal(h, RAW, 40, { at: after });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /لا عقد قائم/);
});

test('عقد أُنهي بأمر ملكي يُرفض به الاستلام في اللحظة نفسها — لا مادة على عقد مقطوع', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const contractId = h.contractIds[COMPUTE_CP] as string;
  const terminated = h.s.contractTermination.terminate(
    h.royalOpen(contractId), contractId, CROWN_GUARD, 'قطع معلن لسبب موثَّق', h.now,
  );
  assert.equal(terminated.ok, true);
  assert.equal(stockExternal(h, RAW, 40).ok, false, 'المادة دخلت على عقد مُنهًى');
});

test('مادة داخلية لا تُستلم من الخارج، ومادة خارجية لا تُدَّعى إنتاجًا (ثابت 3)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const asExternal = h.s.supply.receive(FACILITY, INDEX, 5, {
    kind: 'external_contract', contractId: h.contractIds[COMPUTE_CP] as string,
  }, ECONOMY, h.now);
  assert.equal(asExternal.ok, false);
  if (!asExternal.ok) assert.match(asExternal.reason, /داخلية/);

  const asProduction = h.s.supply.receive(FACILITY, RAW, 5, {
    kind: 'production', runId: 'run-x',
  }, ECONOMY, h.now);
  assert.equal(asProduction.ok, false);
  if (!asProduction.ok) assert.match(asProduction.reason, /خارجي/);
});

test('إنتاج بلا معرّف دفعة يُرفض، ونقل بلا منشأة مصدر يُرفض', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(h.s.supply.receive(FACILITY, INDEX, 5, { kind: 'production', runId: '  ' }, ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.receive(FACILITY, INDEX, 5, { kind: 'transfer', from: '' }, ECONOMY, h.now).ok, false);
});

/* ————— 2) لا حركة على منشأة غير قائمة (ثابت 7) ————— */

test('منشأة غير مُقامة أو معلَّقة أو منحلّة أو منتهية لا تستلم مادة', () => {
  const h = industrialState();
  assert.equal(stockExternal(h, RAW, 10).ok, false, 'استلمت منشأة غير مُقامة');

  assert.equal(establish(h, { days: 10 }).ok, true);
  assert.equal(stockExternal(h, RAW, 10).ok, true);

  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'تعليق معلن', h.now).ok, true);
  assert.equal(stockExternal(h, RAW, 10).ok, false, 'استلمت منشأة معلَّقة');

  const after = h.now + 11 * DAY;
  beat(h, after);
  assert.equal(stockExternal(h, RAW, 10, { at: after }).ok, false, 'استلمت منشأة منتهية');
  assert.equal(h.s.supply.balance(FACILITY, RAW), 10, 'الرصيد لم يتغيّر بالمحاولات المرفوضة');
});

test('الرصيد يُقرأ بعد الحلّ ولا يُحرَّك — التدقيق يحتاج الرقم (ثابت 8)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(stockExternal(h, RAW, 24).ok, true);
  assert.equal(h.s.companies.dissolve(h.royalFacility(FACILITY), FACILITY, ECONOMY, 'إغلاق معلن', h.now).ok, true);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 24, 'الرقم باقٍ للتدقيق');
  assert.equal(stockExternal(h, RAW, 1).ok, false, 'الرقم لا يُحرَّك');
});

/* ————— 3) لا مخزون سالب (ثابت 4) ————— */

test('استهلاك يتجاوز الرصيد يُرفض، والرصيد لا يصير سالبًا أبدًا', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(stockExternal(h, RAW, 10).ok, true);
  const result = h.s.supply.consume(FACILITY, RAW, 11, 'run-1', ECONOMY, h.now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /لا مخزون سالب/);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 10);

  assert.equal(h.s.supply.consume(FACILITY, RAW, 10, 'run-1', ECONOMY, h.now).ok, true);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 0);
});

test('لا استهلاك بلا دفعة تُعلّق عليها الحركة، ولا لمادة غير معلنة', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(stockExternal(h, RAW, 10).ok, true);
  assert.equal(h.s.supply.consume(FACILITY, RAW, 5, '  ', ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.consume(FACILITY, 'material:ghost', 5, 'run-1', ECONOMY, h.now).ok, false);
});

/* ————— 4) النقل: حركتان متساويتان (ثابت 6) ————— */

test('النقل بين منشأتين قائمتين لا يُنشئ مادة ولا يُفنيها', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:a' }).ok, true);
  assert.equal(establish(h, { facilityId: 'facility:b', kindId: KIND_PLANT }).ok, true);
  assert.equal(stockExternal(h, BLOCK, 12, { facilityId: 'facility:a' }).ok, true);

  const result = h.s.supply.transfer('facility:a', 'facility:b', BLOCK, 5, ECONOMY, h.now);
  assert.equal(result.ok, true);
  assert.equal(h.s.supply.balance('facility:a', BLOCK), 7);
  assert.equal(h.s.supply.balance('facility:b', BLOCK), 5);
  assert.equal(h.s.supply.verifyConservation().netTransfer, 0, 'مجموع النقل صفر دائمًا');
  assert.equal(h.s.supply.verifyConservation().valid, true);
});

test('لا نقل إلى النفس، ولا من منشأة غير قائمة، ولا إلى منشأة غير قائمة', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:a' }).ok, true);
  assert.equal(stockExternal(h, RAW, 12, { facilityId: 'facility:a' }).ok, true);

  assert.equal(h.s.supply.transfer('facility:a', 'facility:a', RAW, 5, ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.transfer('facility:a', 'facility:ghost', RAW, 5, ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.transfer('facility:ghost', 'facility:a', RAW, 5, ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.balance('facility:a', RAW), 12, 'المحاولات المرفوضة لا تحرّك رصيدًا');
});

test('نقل يتجاوز الرصيد يُرفض ولا يُنقص المصدر — لا نصف نقل', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:a' }).ok, true);
  assert.equal(establish(h, { facilityId: 'facility:b', kindId: KIND_PLANT }).ok, true);
  assert.equal(stockExternal(h, RAW, 4, { facilityId: 'facility:a' }).ok, true);
  assert.equal(h.s.supply.transfer('facility:a', 'facility:b', RAW, 5, ECONOMY, h.now).ok, false);
  assert.equal(h.s.supply.balance('facility:a', RAW), 4);
  assert.equal(h.s.supply.balance('facility:b', RAW), 0);
});

/* ————— 5) الحفظ والتقرير (ثابت 5) ————— */

test('كل رصيد يساوي مجموع حركاته، وكل حركة مسجَّلة في السجل الأبدي', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(stockExternal(h, RAW, 20).ok, true);
  assert.equal(stockExternal(h, RAW, 12).ok, true);
  assert.equal(h.s.supply.consume(FACILITY, RAW, 8, 'run-1', ECONOMY, h.now).ok, true);

  assert.equal(h.s.supply.balance(FACILITY, RAW), 24);
  const movements = h.s.supply.movementsOf(FACILITY);
  assert.equal(movements.length, 3);
  assert.equal(movements.reduce((sum, m) => sum + m.delta, 0), 24);
  assert.equal(h.s.supply.verifyConservation().valid, true);
  assert.equal(h.s.audit.find('stock_received').length, 2);
  assert.equal(h.s.audit.find('stock_consumed').length, 1);
});

test('التقرير يُظهر المواد المعلنة وأرصدة غير الصفر وحدها، ويسقط الصفر لا يُخفيه', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(stockExternal(h, RAW, 8).ok, true);
  assert.equal(h.s.supply.consume(FACILITY, RAW, 8, 'run-1', ECONOMY, h.now).ok, true);
  const report = h.s.supply.report();
  assert.equal(report.declaredMaterials, h.s.enterprisesConfig.materials.length);
  assert.equal(report.movements, 2, 'الحركتان مقيَّدتان ولو صار الرصيد صفرًا');
  assert.equal(report.stocked.length, 0);
});

test('كل رفض في المخزون يُسجَّل باسمه stock_refused ولا يمرّ صامتًا (RULE-006)', () => {
  const h = industrialState();
  assert.equal(stockExternal(h, RAW, 10).ok, false);
  assert.equal(stockExternal(h, SEALED, 10).ok, false);
  assert.equal(h.s.audit.find('stock_refused').length, 2);
});
