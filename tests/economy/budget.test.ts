/**
 * tests/economy/budget.test.ts — اختبار الموازنة وسقوفها المُلزمة (المرحلة 25)
 * المالك: وزارة المالية | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Budget, bootstrapState, ROYAL_COURT, TREASURY_ACTOR } from '../../src/index';

const T0 = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** دولة فيها وزارتان قائمتان تصلحان صاحبَي بند موازنة */
function budgetState() {
  const s = bootstrapState({ now: T0 });
  const structural = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'economy' }, at);
  s.ministries.establish(structural('ministry:infrastructure'), {
    ministryId: 'ministry:infrastructure', name: 'وزارة البنية', mandate: ['infrastructure'],
    proposedBy: ROYAL_COURT,
  }, T0);
  s.ministries.establish(structural('ministry:research'), {
    ministryId: 'ministry:research', name: 'وزارة البحث', mandate: ['research'],
    proposedBy: ROYAL_COURT,
  }, T0);
  const declare = (line: string, owner: string, ceiling: number, at = T0) =>
    s.budget.declare(structural(line, at), {
      line, owner, ceiling, periodStart: at, periodEnd: at + 30 * DAY,
    }, at);
  return { s, structural, declare };
}

test('إقرار بند موازنة بأمر ملكي لصاحب قائم', () => {
  const { s, declare } = budgetState();
  const r = declare('budget:infrastructure', 'ministry:infrastructure', 100_000);
  assert.equal(r.ok, true);
  assert.equal(s.budget.available('budget:infrastructure'), 100_000);
  assert.equal(s.audit.find('appropriation_declared').length, 1);
});

test('لا موازنة لجهة لا وجود لها', () => {
  const { s, declare } = budgetState();
  const r = declare('budget:ghost', 'ministry:ghost', 10_000);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير قائم/);
  assert.equal(s.budget.available('budget:ghost'), 0);
});

test('صاحب البند لا يقرّ موازنة نفسه (RULE-005)', () => {
  const { s, structural } = budgetState();
  const royal = s.king.issueCommand('amend_policy', 'budget:self', { kind: 'economy' }, T0);
  const selfIssued = { ...royal, payload: { ...royal.payload, issuedBy: 'ministry:research' } };
  const r = s.budget.declare(selfIssued, {
    line: 'budget:self', owner: 'ministry:research', ceiling: 5_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /لا يقرّ موازنته/);
  assert.equal(structural('budget:self').payload.action, 'amend_policy');
});

test('لا إقرار إلا بفعل amend_policy هدفه البند نفسه', () => {
  const { s } = budgetState();
  const wrongAction = s.king.issueCommand('approve_phase', 'budget:infrastructure', {}, T0);
  const r1 = s.budget.declare(wrongAction, {
    line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r1.ok, false);
  const wrongTarget = s.king.issueCommand('amend_policy', 'budget:other', {}, T0);
  const r2 = s.budget.declare(wrongTarget, {
    line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? '' : r2.reason, /لا يطابق/);
});

test('**مجموع البنود لا يتجاوز السقف الكلي المعلن في التهيئة**', () => {
  const { s, declare } = budgetState();
  const total = s.economyConfig.budget.ceiling_total;
  assert.equal(declare('budget:infrastructure', 'ministry:infrastructure', total).ok, true);
  const over = declare('budget:research', 'ministry:research', 1);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /السقف الكلي/);
  assert.equal(s.budget.report().headroom, 0);
});

test('**السقف مُلزم**: الحجز فوق المتاح مرفوض ويُسجَّل باسمه', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  const ok = s.budget.reserve('budget:research', 600, TREASURY_ACTOR, 'تشغيل مختبر', T0 + 1);
  assert.equal(ok.ok, true);
  const over = s.budget.reserve('budget:research', 500, TREASURY_ACTOR, 'تجاوز', T0 + 2);
  assert.equal(over.ok, false);
  const flagged = s.audit.find('appropriation_exceeded');
  assert.equal(flagged.length, 1, 'التجاوز واقعة تُرى في السجل باسمها');
  assert.equal((flagged[0]?.detail as { available: number }).available, 400);
  assert.equal(s.budget.available('budget:research'), 400, 'المتاح لا ينقص برفض');
});

test('الحجز للخزانة وحدها ولا حجز بلا غرض معلن', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  const byOther = s.budget.reserve('budget:research', 100, 'ministry:research', 'صرف ذاتي', T0 + 1);
  assert.equal(byOther.ok, false);
  assert.match(byOther.ok ? '' : byOther.reason, /للخزانة وحدها/);
  const noPurpose = s.budget.reserve('budget:research', 100, TREASURY_ACTOR, '', T0 + 1);
  assert.equal(noPurpose.ok, false);
});

test('**لا حجز بعد نهاية الفترة ولو بقي متاح**', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  const late = s.budget.reserve('budget:research', 100, TREASURY_ACTOR, 'متأخر', T0 + 31 * DAY);
  assert.equal(late.ok, false);
  assert.match(late.ok ? '' : late.reason, /منقضية/);
  const early = s.budget.reserve('budget:research', 100, TREASURY_ACTOR, 'مبكر', T0 - DAY);
  assert.equal(early.ok, false);
});

test('**تعديل السقف بأمر معلن يُسجَّل بالقيمتين معًا**', () => {
  const { s, structural, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  const amended = s.budget.amend(
    structural('budget:research', T0 + 10), 'budget:research', 4_000, 'توسيع برنامج بحثي معتمد', T0 + 10,
  );
  assert.equal(amended.ok, true);
  const record = s.audit.find('appropriation_amended').at(-1);
  assert.equal((record?.detail as { from: number }).from, 1_000);
  assert.equal((record?.detail as { to: number }).to, 4_000);
  assert.equal(s.budget.available('budget:research'), 4_000);
});

test('لا يُنقص السقف إلى ما دون المصروف فعلًا', () => {
  const { s, structural, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  s.budget.reserve('budget:research', 800, TREASURY_ACTOR, 'صرف واقع', T0 + 1);
  const down = s.budget.amend(
    structural('budget:research', T0 + 2), 'budget:research', 500, 'تقليص', T0 + 2,
  );
  assert.equal(down.ok, false);
  assert.match(down.ok ? '' : down.reason, /دون المصروف/);
  assert.equal(s.budget.get('budget:research')?.ceiling, 1_000);
});

test('لا تعديل بلا سبب ولا تعديل بلا تغيير', () => {
  const { s, structural, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  assert.equal(
    s.budget.amend(structural('budget:research', T0 + 1), 'budget:research', 2_000, '', T0 + 1).ok,
    false,
  );
  assert.equal(
    s.budget.amend(structural('budget:research', T0 + 1), 'budget:research', 1_000, 'بلا تغيير', T0 + 1).ok,
    false,
  );
});

test('**ما لم يُصرف يسقط ويُسجَّل سقوطه**', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  s.budget.reserve('budget:research', 300, TREASURY_ACTOR, 'مصروف فعلي', T0 + 1);
  const early = s.budget.lapse('budget:research', T0 + DAY);
  assert.equal(early.ok, false, 'لا سقوط قبل نهاية الفترة');
  const lapsed = s.budget.lapse('budget:research', T0 + 31 * DAY);
  assert.equal(lapsed.ok, true);
  const record = s.audit.find('appropriation_lapsed').at(-1);
  assert.equal((record?.detail as { lapsedAmount: number }).lapsedAmount, 700);
  assert.equal(s.budget.available('budget:research'), 0);
});

test('**الترحيل مرفوض بإعلان التهيئة ولو طُلب صريحًا**', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  s.budget.lapse('budget:research', T0 + 31 * DAY);
  const carry = s.budget.carryOver('budget:research', 'budget:infrastructure', 'ministry:research');
  assert.equal(carry.ok, false);
  assert.match(carry.ok ? '' : carry.reason, /الترحيل ممنوع/);
  const record = s.audit.find('budget_refused').at(-1);
  assert.equal((record?.detail as { mode: string }).mode, 'carry_over');
  assert.equal((record?.detail as { carryoverAllowed: boolean }).carryoverAllowed, false);
});

test('فكّ الحجز يردّ المبلغ إلى البند ولا يفكّ أكثر من المحجوز', () => {
  const { s, declare } = budgetState();
  declare('budget:research', 'ministry:research', 1_000);
  s.budget.reserve('budget:research', 400, TREASURY_ACTOR, 'حجز', T0 + 1);
  const tooMuch = s.budget.release('budget:research', 500, TREASURY_ACTOR, 'فكّ زائد', T0 + 2);
  assert.equal(tooMuch.ok, false);
  const released = s.budget.release('budget:research', 400, TREASURY_ACTOR, 'فشل القيد', T0 + 2);
  assert.equal(released.ok, true);
  assert.equal(s.budget.available('budget:research'), 1_000);
  assert.equal(s.audit.find('budget_released').length, 1);
});

test('لا بند مكرَّر ولا بند بفترة منقضية ولا سقف غير سليم', () => {
  const { s, declare } = budgetState();
  assert.equal(declare('budget:research', 'ministry:research', 1_000).ok, true);
  assert.equal(declare('budget:research', 'ministry:research', 500).ok, false);
  const badCeiling = s.budget.declare(
    s.king.issueCommand('amend_policy', 'budget:infrastructure', {}, T0),
    {
      line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 12.5,
      periodStart: T0, periodEnd: T0 + DAY,
    }, T0,
  );
  assert.equal(badCeiling.ok, false);
  const expired = s.budget.declare(
    s.king.issueCommand('amend_policy', 'budget:infrastructure', {}, T0),
    {
      line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 100,
      periodStart: T0 - 10 * DAY, periodEnd: T0 - DAY,
    }, T0,
  );
  assert.equal(expired.ok, false);
});

test('**الإقرار مرفوض قبل ربط مصدر التحقق من الصاحب** (فشل مغلق)', () => {
  const { s, structural } = budgetState();
  // موازنة جديدة غير مربوطة: لا تُخمِّن وجود الجهة، بل ترفض وتُسجِّل السبب
  const unbound = new Budget({
    audit: s.audit, gateway: s.gateway, ceilingTotal: 1_000_000, maxLines: 8,
    carryoverAllowed: false,
  });
  const r = unbound.declare(structural('budget:unbound'), {
    line: 'budget:unbound', owner: 'ministry:infrastructure', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r.ok, false);
  assert.equal(unbound.available('budget:unbound'), 0);
  assert.equal(s.audit.find('budget_refused').length >= 1, true);
});

test('البند لا يُقرّ لصاحبه إذا كان وزارة المالية نفسها (فصل الأدوار RULE-004)', () => {
  const { s, structural } = budgetState();
  s.ministries.establish(structural('ministry:finance'), {
    ministryId: 'ministry:finance', name: 'وزارة المالية', mandate: ['finance'],
    proposedBy: ROYAL_COURT,
  }, T0);
  const r = s.budget.declare(structural('budget:finance'), {
    line: 'budget:finance', owner: 'ministry:finance', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r.ok, false, 'من يصرف لا يُخصَّص له بندٌ يصرفه لنفسه');
});

test('معرّف البند يبدأ ببادئة معلنة لا باسمٍ حرّ', () => {
  const { s, structural } = budgetState();
  const r = s.budget.declare(structural('infrastructure'), {
    line: 'infrastructure', owner: 'ministry:infrastructure', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /budget:/);
});
