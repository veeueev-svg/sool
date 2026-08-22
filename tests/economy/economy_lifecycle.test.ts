/**
 * tests/economy/economy_lifecycle.test.ts — اختبار قبول المرحلة 25
 * معيار القبول (ROADMAP): «دفتر متوازن لا يقبل قيدًا غير متوازن + سقوف صرف مُلزمة»
 * المالك: وزارة المالية تحت التاج | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCE_MINISTRY, REVENUE_TARGET, ROYAL_COURT, TREASURY_ACTOR, UNIT_TARGET, bootstrapState,
} from '../../src/index';

const T0 = Date.now();
const DAY = 24 * 60 * 60 * 1000;

/** دولة اقتصادية كاملة: وزارتان، إصدار، بندان، حسابات مستفيدين */
function economyState() {
  const s = bootstrapState({ now: T0 });
  const royal = (target: string, at = T0) =>
    s.king.issueCommand('amend_policy', target, { kind: 'economy' }, at);
  for (const [id, name, domain] of [
    ['ministry:infrastructure', 'وزارة البنية', 'infrastructure'],
    ['ministry:research', 'وزارة البحث', 'research'],
  ] as const) {
    s.ministries.establish(royal(id), {
      ministryId: id, name, mandate: [domain], proposedBy: ROYAL_COURT,
    }, T0);
  }
  s.ledger.openAccount('expense:contractor', 'expense', 'مستحقات منفّذ', T0);
  s.ledger.openAccount('expense:lab', 'expense', 'مصروف مختبر', T0);
  return { s, royal };
}

test('**معيار القبول 1** — دورة اقتصاد كاملة والميزان متوازن في كل خطوة', () => {
  const { s, royal } = economyState();
  const balanced = (step: string) =>
    assert.equal(s.ledger.trialBalance().balanced, true, `الميزان اختلّ عند: ${step}`);

  balanced('التأسيس');

  // 1) إصدار سيادي
  assert.equal(s.unit.issue(royal(UNIT_TARGET), 20_000_000, 'رأس مال تشغيلي', T0).ok, true);
  balanced('الإصدار');
  assert.equal(s.treasury.balance(), 20_000_000);

  // 2) رسم مقدَّر ثم محصَّل
  const levy = s.revenue.assess('compute_usage', 'agent:worker-1', 4_000_000, T0, T0 + 1);
  assert.equal(levy.ok, true);
  balanced('تقدير الرسم');
  assert.equal(s.revenue.collect(levy.ok ? levy.levy.levyId : '', T0 + 2).ok, true);
  balanced('تحصيل الرسم');
  assert.equal(s.treasury.balance(), 20_100_000, '25 في الألف من 4 ملايين = 100 ألف');

  // 3) بند موازنة مُقرّ
  assert.equal(s.budget.declare(royal('budget:infrastructure', T0 + 3), {
    line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 5_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 3).ok, true);
  balanced('إقرار البند');

  // 4) صرف داخل السقف
  const paid = s.treasury.disburse({
    line: 'budget:infrastructure', amount: 3_000_000, to: 'expense:contractor',
    purpose: 'دفعة تنفيذ أولى', by: FINANCE_MINISTRY,
  }, T0 + 4);
  assert.equal(paid.ok, true);
  balanced('الصرف');
  assert.equal(s.treasury.balance(), 17_100_000);
  assert.equal(s.budget.available('budget:infrastructure'), 2_000_000);

  // 5) سقوط ما لم يُصرف بعد نهاية الفترة
  const lapsed = s.budget.lapse('budget:infrastructure', T0 + 31 * DAY);
  assert.equal(lapsed.ok, true);
  balanced('السقوط');
  assert.equal(s.budget.available('budget:infrastructure'), 0);

  // 6) إغلاق الفترة المحاسبية
  assert.equal(s.ledger.closePeriod(T0 + 31 * DAY, FINANCE_MINISTRY, T0 + 32 * DAY).ok, true);
  const final = s.ledger.trialBalance();
  assert.equal(final.balanced, true, 'الميزان الختامي متوازن');
  assert.equal(final.debits, final.credits);
  assert.equal(s.audit.verifyIntegrity().valid, true, 'سلسلة التدقيق سليمة عبر الدورة كلها');
});

test('**معيار القبول 1 (النقيض)** — القيد غير المتوازن مرفوض والميزان لا يختلّ', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 1_000_000, 'إصدار', T0);
  const before = s.ledger.trialBalance();

  const attempts = [
    { entryId: 'x1', lines: [{ account: 'expense:lab', debit: 500 }, { account: 'treasury:general', credit: 400 }] },
    { entryId: 'x2', lines: [{ account: 'expense:lab', debit: 500 }] },
    { entryId: 'x3', lines: [{ account: 'expense:lab', debit: 500 }, { account: 'treasury:general', debit: 500 }] },
    { entryId: 'x4', lines: [{ account: 'expense:lab', debit: 0 }, { account: 'treasury:general', credit: 0 }] },
  ];
  for (const attempt of attempts) {
    const r = s.ledger.post({ ...attempt, memo: 'محاولة قيد غير سليم', by: FINANCE_MINISTRY }, T0 + 1);
    assert.equal(r.ok, false, `القيد ${attempt.entryId} كان يجب أن يُرفض`);
  }
  const after = s.ledger.trialBalance();
  assert.equal(after.entries, before.entries, 'لا قيد مرفوض تسلّل إلى الدفتر');
  assert.equal(after.balanced, true);
  assert.equal(after.debits, before.debits);
  assert.equal(s.audit.find('entry_refused').length, 4, 'كل رفض واقعة تُرى في السجل');
});

test('**معيار القبول 2** — الصرف فوق السقف مرفوض والخزانة ممتلئة', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 50_000_000, 'إصدار وفير', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);

  const request = {
    line: 'budget:research', amount: 1_000_001, to: 'expense:lab',
    purpose: 'دفعة تتجاوز التخصيص بوحدة واحدة', by: FINANCE_MINISTRY,
  };
  assert.equal(s.treasury.balance(), 50_000_000, 'المال موجود بوفرة');
  const refused = s.treasury.disburse(request, T0 + 2);
  assert.equal(refused.ok, false, 'وفرة الخزانة لا تُبيح تجاوز السقف ولو بوحدة');
  assert.equal(s.ledger.balance('expense:lab'), 0);
  assert.equal(s.treasury.balance(), 50_000_000, 'لا فلس خرج');
  assert.equal(s.budget.available('budget:research'), 1_000_000, 'المتاح سليم بعد الرفض');
  assert.equal(s.audit.find('appropriation_exceeded').length, 1);
  assert.equal(s.audit.find('disbursement_refused').length, 1);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('**معيار القبول 2 (تتمة)** — السقف يعلو بأمر معلن مسجَّل بقيمتيه ثم يُصرف', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 50_000_000, 'إصدار', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);
  const request = {
    line: 'budget:research', amount: 1_500_000, to: 'expense:lab',
    purpose: 'دفعة موسَّعة', by: FINANCE_MINISTRY,
  };
  assert.equal(s.treasury.disburse(request, T0 + 2).ok, false);

  const amend = s.budget.amend(
    royal('budget:research', T0 + 3), 'budget:research', 2_000_000, 'توسيع برنامج بحثي معتمد', T0 + 3,
  );
  assert.equal(amend.ok, true);
  const record = s.audit.find('appropriation_amended').at(-1);
  assert.equal((record?.detail as { from: number }).from, 1_000_000);
  assert.equal((record?.detail as { to: number }).to, 2_000_000);
  assert.equal((record?.detail as { reason: string }).reason.length > 3, true);

  const paid = s.treasury.disburse(request, T0 + 4);
  assert.equal(paid.ok, true, 'الحدّ الجديد نافذ لأنه مُعلن لا لأنه مُشتهى');
  assert.equal(s.ledger.balance('expense:lab'), 1_500_000);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('**السقف لا يُتجاوز بتقسيم الصرف إلى دفعات صغيرة**', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 50_000_000, 'إصدار', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);
  let paid = 0;
  for (let i = 0; i < 12; i++) {
    const r = s.treasury.disburse({
      line: 'budget:research', amount: 100_000, to: 'expense:lab',
      purpose: `دفعة جزئية ${i}`, by: FINANCE_MINISTRY,
    }, T0 + 2 + i);
    if (r.ok) paid += 100_000;
  }
  assert.equal(paid, 1_000_000, 'المجموع يتوقف عند السقف لا عند نفاد الرغبة');
  assert.equal(s.ledger.balance('expense:lab'), 1_000_000);
  assert.equal(s.audit.find('appropriation_exceeded').length, 2, 'المحاولتان الزائدتان مُسجَّلتان');
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('**الاقتصاد جامد بغياب النبض الملكي** (RULE-007)', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 20_000_000, 'إصدار', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 5_000_000,
    periodStart: T0, periodEnd: T0 + 60 * DAY,
  }, T0 + 1);
  const late = T0 + s.config.absence_grace_seconds * 1000 + 60_000;
  assert.equal(s.heartbeat.mode(late), 'protective');

  const spend = s.treasury.disburse({
    line: 'budget:research', amount: 1_000, to: 'expense:lab',
    purpose: 'صرف بغياب التاج', by: FINANCE_MINISTRY,
  }, late);
  assert.equal(spend.ok, false, 'لا يخرج مال بغياب التاج');
  const issue = s.unit.issue(
    s.king.issueCommand('amend_policy', UNIT_TARGET, {}, T0), 1_000, 'إصدار بغياب التاج', late,
  );
  assert.equal(issue.ok, false, 'لا يُخلق مال بغياب التاج');
  const declare = s.budget.declare(royal('budget:infrastructure', T0), {
    line: 'budget:infrastructure', owner: 'ministry:infrastructure', ceiling: 1_000,
    periodStart: T0, periodEnd: T0 + DAY,
  }, late);
  assert.equal(declare.ok, false, 'لا تُقرّ موازنة بغياب التاج');
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('**الاقتصاد ميت عند شدّ قاطع الأمان**', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 20_000_000, 'إصدار', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 5_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);
  s.killSwitch.engage('authority:crown_guard', 'all', 'اختبار قطع الاقتصاد');
  const spend = s.treasury.disburse({
    line: 'budget:research', amount: 1_000, to: 'expense:lab',
    purpose: 'صرف بعد القطع', by: FINANCE_MINISTRY,
  }, T0 + 3);
  assert.equal(spend.ok, false);
  assert.equal(s.ledger.balance('expense:lab'), 0);
});

test('**حدود النطاق**: لا تحويل خارجي ولا ترحيل ولا رجعية — كلها مسجَّلة', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'إصدار', T0);

  const convert = s.unit.convertExternal('agent:trader', 1_000, 'منصّة خارجية');
  assert.equal(convert.ok, false);
  assert.equal(s.audit.find('external_convertibility_refused').length, 1);

  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);
  s.budget.lapse('budget:research', T0 + 31 * DAY);
  const carry = s.budget.carryOver('budget:research', 'budget:infrastructure', 'ministry:research');
  assert.equal(carry.ok, false);

  const retro = s.revenue.assess(
    'model_training', 'agent:lab', 1_000_000, Date.parse('2026-07-01T00:00:00Z'), T0,
  );
  assert.equal(retro.ok, false);
  assert.equal(s.audit.find('levy_refused').length >= 1, true);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('**فصل الأدوار في المال** (RULE-004): من يقرّ ليس من يصرف ولا من يعفي نفسه', () => {
  const { s, royal } = economyState();
  s.unit.issue(royal(UNIT_TARGET), 10_000_000, 'إصدار', T0);
  s.budget.declare(royal('budget:research', T0 + 1), {
    line: 'budget:research', owner: 'ministry:research', ceiling: 1_000_000,
    periodStart: T0, periodEnd: T0 + 30 * DAY,
  }, T0 + 1);

  // الصاحب لا يصرف لنفسه، والحجز للخزانة وحدها
  const selfSpend = s.treasury.disburse({
    line: 'budget:research', amount: 1_000, to: 'expense:lab',
    purpose: 'صرف ذاتي', by: 'ministry:research',
  }, T0 + 2);
  assert.equal(selfSpend.ok, false);
  assert.equal(s.budget.reserve('budget:research', 1_000, 'ministry:research', 'حجز ذاتي', T0 + 2).ok, false);
  assert.equal(s.budget.reserve('budget:research', 1_000, TREASURY_ACTOR, 'حجز نظامي', T0 + 2).ok, true);

  // المكلَّف لا يعفي نفسه
  const levy = s.revenue.assess('compute_usage', 'ministry:research', 400_000, T0, T0 + 3);
  const cmd = s.king.issueCommand('amend_policy', REVENUE_TARGET, { kind: 'economy' }, T0 + 3);
  const selfWaive = s.revenue.waive(
    { ...cmd, payload: { ...cmd.payload, issuedBy: 'ministry:research' } },
    levy.ok ? levy.levy.levyId : '', 'إعفاء ذاتي', T0 + 3,
  );
  assert.equal(selfWaive.ok, false);
});

test('التأسيس يبقى مختومًا بسجل state_online وحده بعد إضافة الاقتصاد', () => {
  const s = bootstrapState({ now: T0 });
  const snapshot = s.audit.snapshot();
  assert.equal(snapshot.at(-1)?.kind, 'state_online', 'خاتمة التأسيس لم تتغيّر');
  // رقم المرحلة يتقدّم مع كل مرحلة تُضاف إلى التأسيس — والمُثبَت هنا أن الخاتمة واحدة لا رقمها
  assert.equal((snapshot.at(-1)?.detail as { phase: number }).phase, 35);
  assert.equal(s.audit.find('account_opened').length, 3, 'حسابات الدولة الثلاثة مفتوحة ومسجَّلة');
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
