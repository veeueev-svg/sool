/**
 * tests/economy/digital_unit.test.ts — اختبار الوحدة الرقمية وحدود إصدارها (المرحلة 25)
 * المالك: بوابة التاج + وزارة المالية | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNIT_TARGET, bootstrapState } from '../../src/index';

const T0 = Date.now();

function unitState() {
  const s = bootstrapState({ now: T0 });
  const royal = (at = T0) => s.king.issueCommand('amend_policy', UNIT_TARGET, { kind: 'economy' }, at);
  return { s, royal };
}

test('الوحدة معلنة في التهيئة: محاسبية داخلية لا عملة قانونية', () => {
  const { s } = unitState();
  assert.equal(s.economyConfig.unit.code, 'SLU');
  assert.equal(s.economyConfig.unit.legal_tender, false);
  assert.equal(s.economyConfig.unit.external_convertibility, 'forbidden');
  assert.equal(s.unit.circulating(), 0, 'الإعلان ليس إصدارًا (RULE-001)');
});

test('الإصدار بأمر ملكي يقيَّد في الدفتر لا في عدّاد منفصل', () => {
  const { s, royal } = unitState();
  const r = s.unit.issue(royal(), 1_000_000, 'رأس مال تشغيل أول', T0);
  assert.equal(r.ok, true);
  assert.equal(s.unit.circulating(), 1_000_000);
  assert.equal(s.ledger.balance('treasury:general'), 1_000_000);
  assert.equal(s.ledger.balance('equity:sovereign_issue'), 1_000_000);
  assert.equal(s.ledger.trialBalance().balanced, true);
  assert.equal(s.audit.find('unit_issued').length, 1);
});

test('**لا إصدار بلا أمر ملكي**: الوزارة لا تُصدر مالًا بنفسها', () => {
  const { s, royal } = unitState();
  const wrongAction = s.king.issueCommand('approve_phase', UNIT_TARGET, {}, T0);
  assert.equal(s.unit.issue(wrongAction, 1_000, 'سبب', T0).ok, false);
  const wrongTarget = s.king.issueCommand('amend_policy', 'economy:other', {}, T0);
  const r = s.unit.issue(wrongTarget, 1_000, 'سبب', T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /هدف الأمر/);
  assert.equal(s.unit.circulating(), 0);
  assert.equal(s.audit.find('issuance_refused').length >= 1, true);
  assert.equal(royal().payload.action, 'amend_policy');
});

test('**سقف العرض الأقصى مُلزم ولا يُتجاوز بتقسيم الطلب**', () => {
  const { s, royal } = unitState();
  const max = s.economyConfig.unit.supply_max;
  const atMax = s.unit.issue(royal(), max, 'إصدار حتى السقف', T0);
  assert.equal(atMax.ok, true);
  assert.equal(s.unit.headroom(), 0);
  const over = s.unit.issue(royal(T0 + 1), 1, 'وحدة إضافية واحدة', T0 + 1);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /سقف الإصدار/);
  assert.equal(s.unit.circulating(), max);
});

test('الإصدار بمبلغ غير سليم أو بلا سبب مرفوض', () => {
  const { s, royal } = unitState();
  assert.equal(s.unit.issue(royal(), 0, 'صفر', T0).ok, false);
  assert.equal(s.unit.issue(royal(), -100, 'سالب', T0).ok, false);
  assert.equal(s.unit.issue(royal(), 10.5, 'كسري', T0).ok, false);
  assert.equal(s.unit.issue(royal(), 100, '', T0).ok, false);
  assert.equal(s.unit.circulating(), 0);
});

test('الإحراق يُنقص المتداول بقيدٍ معاكس ولا يزيد على المتداول', () => {
  const { s, royal } = unitState();
  s.unit.issue(royal(), 5_000, 'إصدار', T0);
  const burn = s.unit.burn(royal(T0 + 1), 2_000, 'سحب فائض من التداول', T0 + 1);
  assert.equal(burn.ok, true);
  assert.equal(s.unit.circulating(), 3_000);
  assert.equal(s.unit.totalIssued(), 5_000);
  assert.equal(s.unit.totalBurned(), 2_000);
  const tooMuch = s.unit.burn(royal(T0 + 2), 4_000, 'إحراق زائد', T0 + 2);
  assert.equal(tooMuch.ok, false);
  assert.equal(s.audit.find('unit_burned').length, 1);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('لا إحراق لما لا تحمله الخزانة فعلًا', () => {
  const { s, royal } = unitState();
  s.unit.issue(royal(), 5_000, 'إصدار', T0);
  s.ledger.openAccount('expense:spent', 'expense', 'مصروف خارج', T0);
  s.ledger.post({
    entryId: 'spend', memo: 'صرف من الخزانة', by: 'ministry:finance',
    lines: [{ account: 'expense:spent', debit: 4_500 }, { account: 'treasury:general', credit: 4_500 }],
  }, T0 + 1);
  const burn = s.unit.burn(royal(T0 + 2), 3_000, 'إحراق ما لا يُملك', T0 + 2);
  assert.equal(burn.ok, false);
  assert.match(burn.ok ? '' : burn.reason, /الخزانة/);
});

test('**التحويل الخارجي مرفوض دائمًا ويُسجَّل باسمه** (حدّ النطاق)', () => {
  const { s, royal } = unitState();
  s.unit.issue(royal(), 5_000, 'إصدار', T0);
  const r = s.unit.convertExternal('agent:trader', 1_000, 'سوق خارجية');
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير قابلة للتحويل|ممنوع/);
  const record = s.audit.find('external_convertibility_refused').at(-1);
  assert.equal((record?.detail as { venue: string }).venue, 'سوق خارجية');
  assert.equal((record?.detail as { requester: string }).requester, 'agent:trader');
  assert.equal(s.unit.circulating(), 5_000, 'لا أثر على المتداول');
});

test('**المطابقة**: عدّاد المتداول يساوي رصيد حقّ الإصدار في الدفتر', () => {
  const { s, royal } = unitState();
  s.unit.issue(royal(), 8_000, 'إصدار أول', T0);
  s.unit.issue(royal(T0 + 1), 2_000, 'إصدار ثانٍ', T0 + 1);
  s.unit.burn(royal(T0 + 2), 1_500, 'إحراق', T0 + 2);
  const rec = s.unit.reconcile();
  assert.equal(rec.consistent, true);
  assert.equal(rec.counter, 8_500);
  assert.equal(rec.ledger, 8_500);
  assert.equal(s.unit.circulating(), s.ledger.balance('equity:sovereign_issue'));
});

test('لا إصدار مرتين بأمر واحد (لا تكرار معرّف القيد)', () => {
  const { s } = unitState();
  const cmd = s.king.issueCommand('amend_policy', UNIT_TARGET, { kind: 'economy' }, T0);
  assert.equal(s.unit.issue(cmd, 1_000, 'إصدار', T0).ok, true);
  const again = s.unit.issue(cmd, 1_000, 'الأمر نفسه مرة ثانية', T0);
  assert.equal(again.ok, false);
  assert.equal(s.unit.circulating(), 1_000);
});

test('**الاقتصاد جامد في الوضع الحمائي** (RULE-007)', () => {
  const { s } = unitState();
  const late = T0 + s.config.absence_grace_seconds * 1000 + 60_000;
  assert.equal(s.heartbeat.mode(late), 'protective');
  const cmd = s.king.issueCommand('amend_policy', UNIT_TARGET, { kind: 'economy' }, T0);
  const r = s.unit.issue(cmd, 1_000, 'إصدار بلا نبض ملكي', late);
  assert.equal(r.ok, false, 'لا إصدار مال بغياب التاج');
  assert.equal(s.unit.circulating(), 0);
});

test('تقرير الوحدة يعرض الإعلان والحدود لا أرقامًا مخفية', () => {
  const { s, royal } = unitState();
  s.unit.issue(royal(), 3_000, 'إصدار', T0);
  const report = s.unit.report();
  assert.equal(report.code, 'SLU');
  assert.equal(report.circulating, 3_000);
  assert.equal(report.supplyMax, s.economyConfig.unit.supply_max);
  assert.equal(report.convertible, false);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
