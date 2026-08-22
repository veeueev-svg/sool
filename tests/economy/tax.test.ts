/**
 * tests/economy/tax.test.ts — اختبار الرسوم: لا رسم بلا إعلان ولا رجعية (المرحلة 25)
 * المالك: وزارة المالية | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVENUE_TARGET, UNIT_TARGET, bootstrapState } from '../../src/index';

const T0 = Date.parse('2026-08-22T00:00:00Z');
const NOW = Date.now();

/** مجموع الرسوم المقدَّرة غير المحصَّلة */
function outstandingTotal(s: ReturnType<typeof bootstrapState>): number {
  return s.revenue.outstanding().reduce((sum, l) => sum + l.levied, 0);
}

function revenueState() {
  const s = bootstrapState({ now: NOW });
  const royal = (target: string, at = NOW) =>
    s.king.issueCommand('amend_policy', target, { kind: 'economy' }, at);
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'تمويل أولي', NOW);
  return { s, royal };
}

test('الأسعار معلنة في التهيئة بنسب في الألف لا بكسور عائمة', () => {
  const { s } = revenueState();
  assert.equal(s.revenue.rateFor('compute_usage')?.ratePerMille, 25);
  assert.equal(s.revenue.rateFor('artifact_import')?.ratePerMille, 50);
  assert.equal(s.revenue.rateFor('model_training')?.ratePerMille, 75);
  assert.equal(s.economyConfig.revenue.retroactive, 'forbidden');
});

test('التقدير على وعاء معلن يُحسب بالنسبة المعلنة ويُسجَّل', () => {
  const { s } = revenueState();
  const r = s.revenue.assess('compute_usage', 'agent:worker-1', 400_000, NOW, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.levy.levied, 10_000, '25 في الألف من 400000');
  assert.equal(outstandingTotal(s), 10_000);
  assert.equal(s.audit.find('levy_assessed').length, 1);
});

test('**لا رسم على وعاء غير معلن**', () => {
  const { s } = revenueState();
  const r = s.revenue.assess('secret_base', 'agent:worker-1', 100_000, NOW, NOW);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير معلن/);
  assert.equal(outstandingTotal(s), 0);
  assert.equal(s.audit.find('levy_refused').length, 1);
});

test('**لا رجعية**: واقعة قبل تاريخ إعلان السعر لا تُرسَّم', () => {
  const { s } = revenueState();
  const before = Date.parse('2026-08-01T00:00:00Z') - 1;
  const r = s.revenue.assess('model_training', 'agent:lab', 1_000_000, before, NOW);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /رجعي|قبل/);
  const record = s.audit.find('levy_refused').at(-1);
  assert.equal((record?.detail as { base: string }).base, 'model_training');
  const after = s.revenue.assess('model_training', 'agent:lab', 1_000_000, T0 + 1000, NOW);
  assert.equal(after.ok, true, 'ما بعد الإعلان يُرسَّم');
});

test('الكسر يُقرَّب نزولًا لصالح المكلَّف لا لصالح الخزانة', () => {
  const { s } = revenueState();
  const r = s.revenue.assess('compute_usage', 'agent:worker-1', 1_050, NOW, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.levy.levied, 26, 'floor(1050×25÷1000) = 26 لا 26.25');
});

test('الرسم الذي يقدَّر صفرًا مرفوض لا يُقيَّد بصفر', () => {
  const { s } = revenueState();
  const r = s.revenue.assess('compute_usage', 'agent:tiny', 10, NOW, NOW);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /صفر/);
  assert.equal(outstandingTotal(s), 0);
});

test('لا تقدير بوعاء بمبلغ غير سليم ولا بمكلَّف مجهول', () => {
  const { s } = revenueState();
  assert.equal(s.revenue.assess('compute_usage', 'agent:x', -100, NOW, NOW).ok, false);
  assert.equal(s.revenue.assess('compute_usage', 'agent:x', 10.5, NOW, NOW).ok, false);
  assert.equal(s.revenue.assess('compute_usage', '', 100_000, NOW, NOW).ok, false);
});

test('**التحصيل يزيد الخزانة بقيدٍ متوازن ولا يُحصَّل مرتين**', () => {
  const { s } = revenueState();
  const assessed = s.revenue.assess('artifact_import', 'agent:importer', 200_000, NOW, NOW);
  assert.equal(assessed.ok, true);
  const levyId = assessed.ok ? assessed.levy.levyId : '';
  const before = s.treasury.balance();
  const collected = s.revenue.collect(levyId, NOW + 1);
  assert.equal(collected.ok, true);
  assert.equal(s.treasury.balance(), before + 10_000);
  assert.equal(s.ledger.balance('revenue:levies'), 10_000);
  assert.equal(s.revenue.collectedTotal(), 10_000);
  assert.equal(outstandingTotal(s), 0);
  const again = s.revenue.collect(levyId, NOW + 2);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /محصَّل/);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('لا تحصيل لرسم لا وجود له', () => {
  const { s } = revenueState();
  const r = s.revenue.collect('levy:404', NOW);
  assert.equal(r.ok, false);
});

test('**الإعفاء بأمر ملكي معلن وحده**', () => {
  const { s, royal } = revenueState();
  const assessed = s.revenue.assess('compute_usage', 'agent:worker-1', 400_000, NOW, NOW);
  const levyId = assessed.ok ? assessed.levy.levyId : '';
  const waived = s.revenue.waive(royal(REVENUE_TARGET, NOW + 1), levyId, 'إعفاء لمشروع سيادي معتمد', NOW + 1);
  assert.equal(waived.ok, true);
  assert.equal(outstandingTotal(s), 0);
  assert.equal(s.revenue.collectedTotal(), 0, 'الإعفاء ليس تحصيلًا');
  assert.equal(s.audit.find('levy_waived').length, 1);
  const after = s.revenue.collect(levyId, NOW + 2);
  assert.equal(after.ok, false, 'المعفى لا يُحصَّل بعد الإعفاء');
});

test('لا إعفاء بلا أمر مطابق ولا بلا سبب ولا بعد التحصيل', () => {
  const { s, royal } = revenueState();
  const a1 = s.revenue.assess('compute_usage', 'agent:a', 400_000, NOW, NOW);
  const id1 = a1.ok ? a1.levy.levyId : '';
  const wrongTarget = s.king.issueCommand('amend_policy', 'economy:other', {}, NOW);
  assert.equal(s.revenue.waive(wrongTarget, id1, 'سبب معلن', NOW).ok, false);
  assert.equal(s.revenue.waive(royal(REVENUE_TARGET), id1, '', NOW).ok, false);
  s.revenue.collect(id1, NOW + 1);
  const late = s.revenue.waive(royal(REVENUE_TARGET, NOW + 2), id1, 'إعفاء متأخر', NOW + 2);
  assert.equal(late.ok, false);
  assert.match(late.ok ? '' : late.reason, /بعد التحصيل/);
});

test('**المكلَّف لا يعفي نفسه** (RULE-004)', () => {
  const { s } = revenueState();
  const a = s.revenue.assess('compute_usage', 'ministry:research', 400_000, NOW, NOW);
  const id = a.ok ? a.levy.levyId : '';
  const royal = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, NOW);
  const selfIssued = { ...royal, payload: { ...royal.payload, issuedBy: 'ministry:research' } };
  const r = s.revenue.waive(selfIssued, id, 'إعفاء ذاتي', NOW);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /نفسه|المكلَّف/);
});

test('تقرير الرسوم يبيّن المقدَّر والمحصَّل والمعفى منفصلين', () => {
  const { s, royal } = revenueState();
  const a1 = s.revenue.assess('compute_usage', 'agent:a', 400_000, NOW, NOW);
  const a2 = s.revenue.assess('artifact_import', 'agent:b', 200_000, NOW, NOW);
  s.revenue.collect(a1.ok ? a1.levy.levyId : '', NOW + 1);
  s.revenue.waive(royal(REVENUE_TARGET, NOW + 2), a2.ok ? a2.levy.levyId : '', 'إعفاء معتمد', NOW + 2);
  const report = s.revenue.report();
  assert.equal(report.assessed, 0, 'لا يبقى مقدَّر بعد التحصيل والإعفاء');
  assert.equal(report.collected, 1);
  assert.equal(report.waived, 1);
  assert.equal(report.collectedTotal, 10_000);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
