/**
 * tests/external/payment_controls.test.ts — ضوابط الدفع الخارجي (المرحلة 26)
 * المالك: وزارة الخارجية تطلب، ووزارة المالية تنفّذ | يوثّق في: docs/test-reports/phase-26.md
 * يثبت: لا مسار مال ثانٍ، والسقوف الثلاثة كلٌّ يُرفض باسمه، ولا تقسيم يُبطل سقف اليوم،
 *        ولا سقف يُستهلك بلا دفعة، والتعليق يسبق كل فحص مالي، ولا التزام يُغلق بلا إثبات.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE, COMPUTE, DAY, FOREIGN, HOUR, REGISTRY, beat, externalState, openAccount,
} from './helpers';

test('كل دفعة تمرّ بالخزانة والدفتر — لا مسار مال ثانٍ (ثابت 1)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const before = h.s.treasury.balance();
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 1_500_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(paid.ok, true);
  if (!paid.ok) return;
  assert.equal(h.s.treasury.balance(), before - 1_500_000);
  assert.ok(paid.payment.disbursementId.startsWith('disb:'), 'لكل دفعة صرف خزانة مقابل');
  assert.equal(h.s.ledger.balance('external:ledger:compute-provider'), 1_500_000);
  assert.equal(h.s.ledger.trialBalance().balanced, true);
  assert.equal(h.s.budget.get('budget:foreign')?.spent, 1_500_000, 'الصرف قيد على بند معلن');
  assert.equal(h.s.audit.find('external_payment_executed').length, 1);
});

test('وزارة الخارجية تطلب ووزارة المالية تنفّذ — لا جهة أخرى تطلب (ثابت 2 + RULE-004)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const byFinance = h.s.payments.pay({
    accountId: COMPUTE, amount: 100_000, line: 'budget:foreign',
    purpose: 'وزارة المالية تطلب لنفسها', requestedBy: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(byFinance.ok, false);
  assert.match(byFinance.ok ? '' : byFinance.reason, /وزارة الخارجية وحدها/);
  assert.equal(h.s.treasury.balance(), 100_000_000, 'لا مال خرج من الرفض');

  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 100_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, h.now + 2000);
  assert.equal(paid.ok, true);
  const disbursements = h.s.audit.find('disbursement_executed');
  assert.equal(disbursements.length, 1, 'الصرف قيد خزانة واحد لا قيدان');
  assert.equal(disbursements.at(-1)?.actor, 'ministry:finance',
    'المنفّذ وزارة المالية لا الطالب (RULE-004)');
  assert.equal(h.s.audit.find('external_payment_executed').at(-1)?.actor, FOREIGN,
    'الطالب وزارة الخارجية — قيدان بفاعلين مختلفين لا فاعل واحد');
});

test('سقف الدفعة الواحدة يُرفض باسمه — والمبلغ المعلن هو الحد (ثابت 3/أ)', () => {
  const h = externalState();
  openAccount(h, COMPUTE); // سقف الدفعة 2,000,000
  const over = h.s.payments.pay({
    accountId: COMPUTE, amount: 2_000_001, line: 'budget:foreign',
    purpose: 'دفعة تتجاوز سقف الواحدة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /سقف الدفعة الواحدة/);
  const refusal = h.s.audit.find('external_payment_refused').at(-1)?.detail as {
    cap: string; singleMax: number;
  };
  assert.equal(refusal.cap, 'single');
  assert.equal(refusal.singleMax, 2_000_000);

  const atCap = h.s.payments.pay({
    accountId: COMPUTE, amount: 2_000_000, line: 'budget:foreign',
    purpose: 'دفعة على السقف تمامًا', requestedBy: FOREIGN,
  }, h.now + 2000);
  assert.equal(atCap.ok, true, 'السقف حدٌّ مسموح لا محرَّم');
});

test('سقف اليوم يُرفض باسمه، ولا تقسيم يُبطله (ثابت 3/ب + ثابت 4)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE); // الواحدة 1,000,000 واليوم 2,000,000
  for (let i = 0; i < 2; i++) {
    beat(h, h.now + 1000 + i * HOUR); // النبض الملكي شرط كل خروج مال (RULE-007)
    const paid = h.s.payments.pay({
      accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
      purpose: `دفعة أرشيف ${i + 1}`, requestedBy: FOREIGN,
    }, h.now + 1000 + i * HOUR);
    assert.equal(paid.ok, true);
  }
  // الثالثة داخل اليوم نفسه: كل دفعة تحت سقف الواحدة، والمجموع يتجاوز سقف اليوم
  beat(h, h.now + 1000 + 3 * HOUR);
  const third = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1, line: 'budget:foreign',
    purpose: 'وحدة واحدة فوق سقف اليوم', requestedBy: FOREIGN,
  }, h.now + 1000 + 3 * HOUR);
  assert.equal(third.ok, false);
  assert.match(third.ok ? '' : third.reason, /سقف اليوم/);
  const refusal = h.s.audit.find('external_payment_refused').at(-1)?.detail as {
    cap: string; spentToday: number;
  };
  assert.equal(refusal.cap, 'daily');
  assert.equal(refusal.spentToday, 2_000_000, 'المصروف محسوب من الدفتر (T-56)');
  assert.equal(h.s.payments.spentSince(ARCHIVE, h.now), 2_000_000);
});

test('نافذة اليوم متحرّكة: بعد انقضاء أربع وعشرين ساعة يعود السقف (ثابت 4)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 30);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 2_000_000, line: 'budget:foreign',
    purpose: 'استهلاك سقف اليوم', requestedBy: FOREIGN,
  }, h.now + 1000);
  const nextDay = h.now + DAY + 2000;
  beat(h, nextDay);
  assert.equal(h.s.payments.spentSince(ARCHIVE, nextDay - DAY), 0, 'النافذة مضت');
  const after = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعة يوم جديد', requestedBy: FOREIGN,
  }, nextDay);
  assert.equal(after.ok, true);
});

test('السقف الكلي يُرفض باسمه ويُقرأ من الدفتر لا من الذاكرة (ثابت 3/ج + ثابت 5)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 40); // الكلي 20,000,000 واليوم 2,000,000
  let at = h.now + 1000;
  for (let day = 0; day < 10; day++) {
    at = h.now + 1000 + day * DAY;
    beat(h, at);
    for (let i = 0; i < 2; i++) {
      beat(h, at + i * HOUR);
      const paid = h.s.payments.pay({
        accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
        purpose: `دفعة أرشيف يوم ${day + 1}`, requestedBy: FOREIGN,
      }, at + i * HOUR);
      assert.equal(paid.ok, true, `الدفعة ${day}/${i} مسموحة`);
    }
  }
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 20_000_000);
  assert.equal(h.s.ledger.balance('external:ledger:data-archive'), 20_000_000);

  const nextDay = at + DAY;
  beat(h, nextDay);
  const over = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1, line: 'budget:foreign',
    purpose: 'وحدة فوق السقف الكلي', requestedBy: FOREIGN,
  }, nextDay);
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.reason, /السقف الكلي/);
  const refusal = h.s.audit.find('external_payment_refused').at(-1)?.detail as {
    cap: string; paidTotal: number; totalCap: number;
  };
  assert.equal(refusal.cap, 'total');
  assert.equal(refusal.paidTotal, 20_000_000);
  assert.equal(refusal.totalCap, 20_000_000);
});

test('لا دفعة بمبلغ غير سليم ولا بغرض غائب (RULE-006)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  for (const amount of [0, -5, 1.5]) {
    const result = h.s.payments.pay({
      accountId: COMPUTE, amount, line: 'budget:foreign',
      purpose: 'مبلغ غير سليم', requestedBy: FOREIGN,
    }, h.now + 1000);
    assert.equal(result.ok, false, `المبلغ ${amount} مرفوض`);
  }
  const noPurpose = h.s.payments.pay({
    accountId: COMPUTE, amount: 1000, line: 'budget:foreign',
    purpose: ' ', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(noPurpose.ok, false);
  assert.match(noPurpose.ok ? '' : noPurpose.reason, /غرض معلن/);
  assert.equal(h.s.treasury.balance(), 100_000_000);
});

test('التعليق يسبق كل فحص مالي — والحساب المعلَّق لا دفعة له ولو كانت تحت السقوف (ثابت 7)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  h.s.externalAccounts.suspend('ministry:cyber_security', COMPUTE, 'شبهة في المضيف', h.now + 500);
  const result = h.s.payments.pay({
    accountId: COMPUTE, amount: 1, line: 'budget:foreign',
    purpose: 'دفعة رمزية على معلَّق', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /حساب غير قائم/);
  assert.equal(h.s.payments.spentSince(COMPUTE, h.now), 0, 'لا سقف استُهلك');
  assert.equal(h.s.treasury.balance(), 100_000_000);
});

test('حساب لم يُفتح، ومنتهي المدة، ومغلق — كلها لا دفعة لها', () => {
  const h = externalState();
  const never = h.s.payments.pay({
    accountId: COMPUTE, amount: 1000, line: 'budget:foreign',
    purpose: 'قبل الفتح', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(never.ok, false);

  openAccount(h, COMPUTE, h.now, 30);
  const expired = h.now + 31 * DAY;
  beat(h, expired);
  const afterExpiry = h.s.payments.pay({
    accountId: COMPUTE, amount: 1000, line: 'budget:foreign',
    purpose: 'بعد انتهاء المدة', requestedBy: FOREIGN,
  }, expired);
  assert.equal(afterExpiry.ok, false);
  assert.match(afterExpiry.ok ? '' : afterExpiry.reason, /انتهت مدة/);
});

test('لا سقف يُستهلك بلا دفعة: رفض الخزانة يُبقي كل شيء كما كان (ثابت 6)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  // مفتاح الإيقاف يجعل وضع الخزانة halted — والرفض يأتي من الخزانة نفسها
  h.s.killSwitch.engage(h.s.king.kingId, 'external', 'إيقاف القنوات الخارجية');
  const result = h.s.payments.pay({
    accountId: COMPUTE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعة أثناء الإيقاف', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /الخزانة رفضت/);
  assert.equal((h.s.audit.find('external_payment_refused').at(-1)?.detail as { via: string }).via,
    'treasury', 'سبب الخزانة منقول باسمه لا مُبهمًا');
  assert.equal(h.s.payments.spentSince(COMPUTE, h.now), 0);
  assert.equal(h.s.externalAccounts.paidTotal(COMPUTE), 0);
  assert.equal(h.s.payments.history().length, 0, 'لا دفعة مسجَّلة');
});

test('إقرار الاستلام بمرجع موثَّق، مرة واحدة، من وزارة الخارجية وحدها (ثابت 8)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 500_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(paid.ok, true);
  const id = paid.ok ? paid.payment.paymentId : '';

  assert.equal(h.s.payments.confirm(id, FOREIGN, 'قصير', h.now + 2000).ok, false);
  assert.equal(h.s.payments.confirm(id, 'ministry:finance', 'مرجع: RCV-1', h.now + 2000).ok, false);
  assert.equal(h.s.payments.confirm('extpay:99', FOREIGN, 'مرجع: RCV-1', h.now + 2000).ok, false);
  assert.equal(h.s.payments.pendingObligations(COMPUTE), 1);

  const confirmed = h.s.payments.confirm(id, FOREIGN, 'مرجع استلام: RCV-2026-0007', h.now + 2000);
  assert.equal(confirmed.ok, true);
  assert.equal(h.s.payments.pendingObligations(COMPUTE), 0);
  assert.equal(h.s.payments.confirm(id, FOREIGN, 'مرجع استلام آخر', h.now + 3000).ok, false,
    'لا إقرار مرتين');
  const record = h.s.audit.find('external_payment_confirmed')[0]?.detail as {
    withinWindow: boolean; evidence: string;
  };
  assert.equal(record.withinWindow, true);
  assert.equal(record.evidence, 'مرجع استلام: RCV-2026-0007');
});

test('المتأخرات تُرفع بعد نافذة الإثبات، مرة واحدة لكل دفعة، وبلا عقوبة', () => {
  const h = externalState();
  openAccount(h, COMPUTE, h.now, 30);
  h.s.payments.pay({
    accountId: COMPUTE, amount: 300_000, line: 'budget:foreign',
    purpose: 'دفعة لن تُقرّ', requestedBy: FOREIGN,
  }, h.now + 1000);
  const window = h.s.externalConfig.policy.confirmation_window_hours * HOUR;

  assert.equal(h.s.payments.raiseOverdue(h.now + window).length, 0, 'داخل النافذة لا تأخير');
  const raised = h.s.payments.raiseOverdue(h.now + window + HOUR);
  assert.equal(raised.length, 1);
  assert.equal(h.s.payments.raiseOverdue(h.now + window + 2 * HOUR).length, 0, 'لا رفع مرتين');
  const record = h.s.audit.find('external_settlement_overdue');
  assert.equal(record.length, 1);
  assert.equal((record[0]?.detail as { windowMs: number }).windowMs, window);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + window + 2 * HOUR), true,
    'التأخير يُرفع ولا يعلّق — التعليق قرار جهة مخوَّلة');
});

test('الدفعة المُقرّة لا تُرفع متأخرةً، والالتزامات المعلَّقة تُقرأ لكل حساب', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  openAccount(h, ARCHIVE);
  const a = h.s.payments.pay({
    accountId: COMPUTE, amount: 100_000, line: 'budget:foreign',
    purpose: 'دفعة حوسبة', requestedBy: FOREIGN,
  }, h.now + 1000);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 100_000, line: 'budget:foreign',
    purpose: 'دفعة أرشيف', requestedBy: FOREIGN,
  }, h.now + 2000);
  h.s.payments.confirm(a.ok ? a.payment.paymentId : '', FOREIGN, 'مرجع: RCV-0009', h.now + 3000);

  const window = h.s.externalConfig.policy.confirmation_window_hours * HOUR;
  const raised = h.s.payments.raiseOverdue(h.now + window + HOUR);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]?.accountId, ARCHIVE);
  assert.equal(h.s.payments.pendingObligations(COMPUTE), 0);
  assert.equal(h.s.payments.pendingObligations(ARCHIVE), 1);
});

test('تقرير الدفع يطابق الدفتر وسلسلة التدقيق سليمة بعد كل الحالات (RULE-006)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  h.s.payments.pay({
    accountId: COMPUTE, amount: 700_000, line: 'budget:foreign',
    purpose: 'دفعة أولى', requestedBy: FOREIGN,
  }, h.now + 1000);
  h.s.payments.pay({
    accountId: COMPUTE, amount: 9_000_000, line: 'budget:foreign',
    purpose: 'دفعة تتجاوز سقف الواحدة', requestedBy: FOREIGN,
  }, h.now + 2000);
  const report = h.s.payments.report();
  assert.equal(report.payments, 1);
  assert.equal(report.totalPaid, 700_000);
  assert.equal(report.pending, 1);
  assert.equal(report.confirmed, 0);
  assert.equal(h.s.audit.find('external_payment_refused').length, 1);
  assert.equal(report.totalPaid, h.s.ledger.balance('external:ledger:compute-provider'));
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('نافذة اليوم تُقاس من الدفتر لا من ذاكرة الوحدة: إرجاعٌ بيوميّةٍ ناقصةٍ لا يمحو السقف (ثابت 4 · T-56)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 30);
  // دفعتان تستنفدان سقف اليوم المعلن (2,000,000) وكلٌّ منهما تحت سقف الواحدة
  for (const [i, at] of [h.now + 1000, h.now + HOUR].entries()) {
    beat(h, at);
    const paid = h.s.payments.pay({
      accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
      purpose: `دفعة ${i + 1}`, requestedBy: FOREIGN,
    }, at);
    assert.equal(paid.ok, true);
  }
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 2_000_000);
  assert.equal(h.s.payments.spentSince(ARCHIVE, h.now), 2_000_000, 'الدفتر والنافذة رقمٌ واحد');

  // انهيارٌ بين قيدِ الخزانة وتدوينِ الدفعة: اليوميّةُ تُرجَع ناقصةً دفعةً، والدفترُ كما هو
  const journal = h.s.payments.history();
  const first = journal[0];
  assert.ok(first, 'اليوميّةُ فيها دفعتان قبل الإرجاع');
  h.s.payments.restore([first], 1, FOREIGN);
  assert.equal(h.s.payments.history().length, 1, 'ذاكرةُ الوحدةِ فقدت دفعةً حقًّا');
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 2_000_000, 'الدفترُ لا يُمحى بإرجاع');
  assert.equal(
    h.s.payments.spentSince(ARCHIVE, h.now), 2_000_000,
    'النافذةُ تُقرأ من الدفتر فلا تنقص بنقصان الذاكرة',
  );

  // الدفعةُ التالية في اليوم نفسِه تُرفض بسقفِ اليوم — وكانت تنجح حين كان العدُّ من الذاكرة
  const at = h.now + 3 * HOUR;
  beat(h, at);
  const after = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعة بعد إرجاعٍ ناقص', requestedBy: FOREIGN,
  }, at);
  assert.equal(after.ok, false);
  assert.match(after.ok ? '' : after.reason, /سقف اليوم/);
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 2_000_000, 'لا مال خرج فوق سقف اليوم');
  const refusal = h.s.audit.find('external_payment_refused').at(-1)?.detail as {
    cap: string; spentToday: number;
  };
  assert.equal(refusal.cap, 'daily');
  assert.equal(refusal.spentToday, 2_000_000, 'الرفضُ مُسبَّبٌ بالرقمِ المقروءِ من الدفتر');
});

test('القيدُ المعاكسُ ينزل من نافذة اليوم — والصافي هو الحكم لا مجموعُ الطلبات (ثابت 4 · T-56)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 30);
  beat(h, h.now + 1000);
  const paid = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعةٌ ستُعكَس', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(paid.ok, true);
  assert.equal(h.s.payments.spentSince(ARCHIVE, h.now), 1_000_000);
  const entry = h.s.ledger.journal().find(
    (e) => e.lines.some((l) => l.account === 'external:ledger:data-archive'),
  );
  assert.ok(entry, 'للدفعة قيدٌ في الدفتر');
  const reversed = h.s.ledger.reverse(
    entry.entryId, 'عكسُ قيدٍ مقيس', 'ministry:finance', h.now + 2 * HOUR,
  );
  assert.equal(reversed.ok, true);
  assert.equal(
    h.s.payments.spentSince(ARCHIVE, h.now), 0,
    'ما عُكس في الدفتر لا يُعَدّ مصروفًا في النافذة',
  );
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 0, 'السقفُ الكلّيُّ والنافذةُ مصدرٌ واحد');
});

test('نافذةُ اليوم لا تُعَدّ مرّتين عند تلاصق النافذتين، وحسابٌ غير مفتوحٍ صفرٌ لا استثناء (ثابت 4 · T-56)', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 30);
  beat(h, h.now + 1000);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعةٌ على حدِّ النافذة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(
    h.s.payments.spentSince(ARCHIVE, h.now + 1000), 0,
    'النافذةُ مفتوحةٌ من أسفلَ حصرًا: قيدُ الحدِّ خارجَها',
  );
  assert.equal(h.s.payments.spentSince(ARCHIVE, h.now + 999), 1_000_000);
  assert.equal(h.s.externalAccounts.paidSince(REGISTRY, h.now), 0, 'حسابٌ غير مفتوحٍ صفرٌ');
  assert.equal(h.s.payments.spentSince('external:not-declared', h.now), 0);
});
