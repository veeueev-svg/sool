/**
 * tests/economy/treasury.test.ts — اختبار الخزانة والصرف (المرحلة 25)
 * المالك: وزارة المالية | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FINANCE_MINISTRY, UNIT_TARGET, bootstrapState, ROYAL_COURT } from '../../src/index';

const T0 = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** خزانة ممولة ببند موازنة قائم وحساب متلقٍّ مفتوح */
function treasuryState(funded = 100_000_000) {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'economy' }, at);
  s.unit.issue(structural(UNIT_TARGET), funded, 'تمويل الخزانة للاختبار', T0);
  s.ministries.establish(structural('ministry:infrastructure'), {
    ministryId: 'ministry:infrastructure', name: 'وزارة البنية', mandate: ['infrastructure'],
    proposedBy: ROYAL_COURT,
  }, T0);
  s.budget.declare(structural('budget:infrastructure'), {
    line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0);
  s.ledger.openAccount('expense:contractor', 'expense', 'مستحقات منفّذ', T0);
  const disburse = (amount: number, at = T0 + 1, command?: ReturnType<typeof structural>) =>
    s.treasury.disburse({
      line: 'budget:infrastructure', amount, to: 'expense:contractor',
      purpose: 'دفعة تنفيذ معتمدة', by: FINANCE_MINISTRY,
    }, at, command);
  return { s, structural, disburse };
}

test('الصرف من بند قائم يقيَّد ويظهر في السجل وفي الدفتر', () => {
  const { s, disburse } = treasuryState();
  const r = disburse(250_000);
  assert.equal(r.ok, true);
  assert.equal(s.ledger.balance('expense:contractor'), 250_000);
  assert.equal(s.budget.available('budget:infrastructure'), 750_000);
  assert.equal(s.audit.find('disbursement_executed').length, 1);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('**رصيد الخزانة يُقرأ من الدفتر لا من عدّاد موازٍ**', () => {
  const { s, disburse } = treasuryState(10_000_000);
  assert.equal(s.treasury.balance(), 10_000_000);
  disburse(400_000);
  assert.equal(s.treasury.balance(), 9_600_000);
  assert.equal(s.treasury.balance(), s.ledger.balance('treasury:general'));
});

test('**الصرف فوق سقف البند مرفوض ولو كانت الخزانة ممولة** — معيار القبول الثاني', () => {
  const { s, disburse } = treasuryState(100_000_000);
  assert.equal(s.treasury.balance(), 100_000_000, 'الخزانة ممولة بما يكفي وزيادة');
  const r = disburse(1_500_000);
  assert.equal(r.ok, false, 'وفرة المال لا تُبيح تجاوز التخصيص');
  assert.match(r.ok ? '' : r.reason, /السقف|المتاح|يتجاوز/);
  assert.equal(s.ledger.balance('expense:contractor'), 0);
  assert.equal(s.budget.available('budget:infrastructure'), 1_000_000, 'المتاح لا ينقص برفض');
  assert.equal(s.audit.find('appropriation_exceeded').length, 1);
  assert.equal(s.audit.find('disbursement_refused').length, 1);
});

test('**السقف يتغيّر بأمر معلن وحده ثم يجوز الصرف بالحدّ الجديد**', () => {
  const { s, structural, disburse } = treasuryState();
  assert.equal(disburse(1_500_000).ok, false);
  const amended = s.budget.amend(
    structural('budget:infrastructure', T0 + 2), 'budget:infrastructure', 2_000_000,
    'توسيع معتمد لمشروع البنية', T0 + 2,
  );
  assert.equal(amended.ok, true);
  const record = s.audit.find('appropriation_amended').at(-1);
  assert.equal((record?.detail as { from: number }).from, 1_000_000);
  assert.equal((record?.detail as { to: number }).to, 2_000_000);
  const after = disburse(1_500_000, T0 + 3);
  assert.equal(after.ok, true, 'الحدّ الجديد نافذ بعد إعلانه لا قبله');
});

test('الصرف لوزارة المالية وحدها', () => {
  const { s } = treasuryState();
  const r = s.treasury.disburse({
    line: 'budget:infrastructure', amount: 1_000, to: 'expense:contractor',
    purpose: 'صرف من غير مختص', by: 'ministry:infrastructure',
  }, T0 + 1);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /وزارة المالية/);
});

test('لا صرف إلى حساب غير مفتوح ولا إلى الخزانة نفسها ولا إلى الصارف', () => {
  const { s } = treasuryState();
  const base = {
    line: 'budget:infrastructure', amount: 1_000, purpose: 'دفعة', by: FINANCE_MINISTRY,
  };
  assert.equal(s.treasury.disburse({ ...base, to: 'expense:ghost' }, T0 + 1).ok, false);
  assert.equal(s.treasury.disburse({ ...base, to: 'treasury:general' }, T0 + 1).ok, false);
  assert.equal(s.treasury.disburse({ ...base, to: FINANCE_MINISTRY }, T0 + 1).ok, false);
});

test('لا صرف بمبلغ غير سليم ولا بلا غرض معلن', () => {
  const { s, disburse } = treasuryState();
  assert.equal(disburse(0).ok, false);
  assert.equal(disburse(-500).ok, false);
  assert.equal(disburse(12.5).ok, false);
  const noPurpose = s.treasury.disburse({
    line: 'budget:infrastructure', amount: 100, to: 'expense:contractor',
    purpose: '', by: FINANCE_MINISTRY,
  }, T0 + 1);
  assert.equal(noPurpose.ok, false);
});

test('لا صرف من بند غير قائم', () => {
  const { s } = treasuryState();
  const r = s.treasury.disburse({
    line: 'budget:ghost', amount: 1_000, to: 'expense:contractor',
    purpose: 'بند وهمي', by: FINANCE_MINISTRY,
  }, T0 + 1);
  assert.equal(r.ok, false);
  assert.equal(s.audit.find('disbursement_refused').length, 1);
});

test('**الصرف الكبير يحتاج أمرًا ملكيًا فوق الحدّ المعلن**', () => {
  const { s, structural } = treasuryState(200_000_000);
  const max = s.economyConfig.treasury.single_disbursement_max;
  s.budget.amend(
    structural('budget:infrastructure', T0 + 1), 'budget:infrastructure', 300_000_000,
    'مشروع كبير معتمد', T0 + 1,
  );
  const big = {
    line: 'budget:infrastructure', amount: max + 1, to: 'expense:contractor',
    purpose: 'دفعة كبرى', by: FINANCE_MINISTRY,
  };
  const without = s.treasury.disburse(big, T0 + 2);
  assert.equal(without.ok, false);
  assert.match(without.ok ? '' : without.reason, /أمر ملكي|الحدّ/);
  const withRoyal = s.treasury.disburse(
    big, T0 + 3, structural(s.economyConfig.treasury.account, T0 + 3),
  );
  assert.equal(withRoyal.ok, true);
  assert.equal(s.ledger.balance('expense:contractor'), max + 1);
});

test('**لا سحب على المكشوف**: الصرف فوق الرصيد مرفوض', () => {
  const { s, structural, disburse } = treasuryState(500_000);
  assert.equal(s.economyConfig.treasury.overdraft, 'forbidden');
  assert.equal(structural('budget:infrastructure').payload.action, 'amend_policy');
  const r = disburse(600_000);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /الرصيد|المكشوف/);
  assert.equal(s.treasury.balance(), 500_000);
  assert.equal(s.budget.available('budget:infrastructure'), 1_000_000, 'الحجز لا يُترك معلّقًا برفض');
});

test('**الخزانة المجمَّدة لا تصرف** ويُفكّ التجميد بأمر معلن', () => {
  const { s, disburse } = treasuryState();
  const emergency = (at: number) =>
    s.king.issueCommand('declare_emergency', s.economyConfig.treasury.account, { kind: 'economy' }, at);
  const frozen = s.treasury.freeze(emergency(T0 + 1), 'شبهة تلاعب في الصرف', T0 + 1);
  assert.equal(frozen.ok, true);
  assert.equal(s.treasury.isFrozen(), true);
  const blocked = disburse(1_000, T0 + 2);
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? '' : blocked.reason, /مجمَّدة/);
  const unfrozen = s.treasury.unfreeze(emergency(T0 + 3), 'انتهاء التحقيق', T0 + 3);
  assert.equal(unfrozen.ok, true);
  assert.equal(disburse(1_000, T0 + 4).ok, true);
  assert.equal(s.audit.find('treasury_frozen').length, 1);
  assert.equal(s.audit.find('treasury_unfrozen').length, 1);
});

test('التجميد لا يُعاد ولا يُفكّ ما ليس مجمَّدًا ولا يُجمَّد بلا سبب', () => {
  const { s } = treasuryState();
  const emergency = (at: number) =>
    s.king.issueCommand('declare_emergency', s.economyConfig.treasury.account, {}, at);
  assert.equal(s.treasury.unfreeze(emergency(T0 + 1), 'فكّ بلا تجميد', T0 + 1).ok, false);
  assert.equal(s.treasury.freeze(emergency(T0 + 1), '', T0 + 1).ok, false);
  assert.equal(s.treasury.freeze(emergency(T0 + 1), 'سبب معلن', T0 + 1).ok, true);
  assert.equal(s.treasury.freeze(emergency(T0 + 2), 'تجميد ثانٍ', T0 + 2).ok, false);
});

test('الإيراد الوارد يزيد الخزانة بقيدٍ متوازن', () => {
  const { s } = treasuryState(1_000);
  const r = s.treasury.receive(5_000, 'payer:agent-7', 'revenue:levies', 'رسم استخدام حساب', T0 + 1);
  assert.equal(r.ok, true);
  assert.equal(s.treasury.balance(), 6_000);
  assert.equal(s.ledger.balance('revenue:levies'), 5_000);
  assert.equal(s.ledger.trialBalance().balanced, true);
  assert.equal(s.audit.find('revenue_received').length, 1);
});

test('كل صرف يُحفظ في تاريخ يُراجَع لا يُنسى', () => {
  const { s, disburse } = treasuryState();
  disburse(1_000, T0 + 1);
  disburse(2_000, T0 + 2);
  const history = s.treasury.history();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.amount, 1_000);
  assert.equal(s.treasury.report().totalDisbursed, 3_000);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('الخزانة لا تصرف في الوضع الحمائي (RULE-007)', () => {
  const { s, disburse } = treasuryState();
  const late = T0 + s.config.absence_grace_seconds * 1000 + 60_000;
  assert.equal(s.heartbeat.mode(late), 'protective');
  const r = disburse(1_000, late);
  assert.equal(r.ok, false, 'المال لا يتحرّك بغياب التاج');
});
