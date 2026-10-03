/**
 * tests/external/external_lifecycle.test.ts — معيار قبول المرحلة 26
 * المعيار من ROADMAP.md: «كل حساب خارجي معلن ومحدود السقف وقابل للتعليق فورًا».
 * يوثّق في: docs/test-reports/phase-26.md §3
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import {
  ARCHIVE, COMPUTE, DAY, FOREIGN, HOUR, REGISTRY, beat, externalState, openAccount,
} from './helpers';

test('قبول (1): لا حساب خارجي إلا لنظير معلن في التهيئة — والباقي مرفوض بالاسم', () => {
  const h = externalState();
  const declared = h.s.externalAccounts.declaredCounterparties().map((cp) => cp.id);
  assert.deepEqual([...declared].sort(), [ARCHIVE, COMPUTE, REGISTRY].sort());
  for (const id of declared) {
    assert.equal(openAccount(h, id).ok, true, `النظير المعلن ${id} يُفتح له حساب`);
  }
  for (const ghost of ['external:unknown', 'external:compute-provider-2', 'ministry:finance']) {
    const result = h.s.externalAccounts.open(h.royalOpen(ghost), {
      counterparty: ghost, expiresAt: h.now + DAY,
      requestedBy: FOREIGN, justification: 'نظير غير معلن',
    }, h.now);
    assert.equal(result.ok, false, `${ghost} مرفوض`);
    assert.equal(h.s.externalAccounts.get(ghost), null);
  }
  assert.equal(h.s.externalAccounts.report(h.now).opened, 3, 'ثلاثة حسابات لا أكثر');
});

test('قبول (2): كل حساب محدود بثلاثة سقوف، وكلٌّ يُرفض باسمه لا بسبب مبهم', () => {
  const h = externalState();
  openAccount(h, ARCHIVE, h.now, 40); // 1,000,000 / 2,000,000 / 20,000,000
  const caps: string[] = [];

  const single = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_001, line: 'budget:foreign',
    purpose: 'فوق سقف الواحدة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(single.ok, false);
  caps.push((h.s.audit.find('external_payment_refused').at(-1)?.detail as { cap: string }).cap);

  beat(h, h.now + 2000);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعة أولى', requestedBy: FOREIGN,
  }, h.now + 2000);
  beat(h, h.now + HOUR);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'دفعة ثانية', requestedBy: FOREIGN,
  }, h.now + HOUR);
  beat(h, h.now + 2 * HOUR);
  const daily = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1, line: 'budget:foreign',
    purpose: 'فوق سقف اليوم', requestedBy: FOREIGN,
  }, h.now + 2 * HOUR);
  assert.equal(daily.ok, false);
  caps.push((h.s.audit.find('external_payment_refused').at(-1)?.detail as { cap: string }).cap);

  let at = h.now + 2 * HOUR;
  for (let day = 1; day < 10; day++) {
    at = h.now + day * DAY + 2 * HOUR;
    for (let i = 0; i < 2; i++) {
      beat(h, at + i * HOUR);
      const paid = h.s.payments.pay({
        accountId: ARCHIVE, amount: 1_000_000, line: 'budget:foreign',
        purpose: `دفعة يوم ${day}`, requestedBy: FOREIGN,
      }, at + i * HOUR);
      assert.equal(paid.ok, true);
    }
  }
  assert.equal(h.s.externalAccounts.paidTotal(ARCHIVE), 20_000_000, 'السقف الكلي استُنفد تمامًا');
  beat(h, at + DAY);
  const total = h.s.payments.pay({
    accountId: ARCHIVE, amount: 1, line: 'budget:foreign',
    purpose: 'فوق السقف الكلي', requestedBy: FOREIGN,
  }, at + DAY);
  assert.equal(total.ok, false);
  caps.push((h.s.audit.find('external_payment_refused').at(-1)?.detail as { cap: string }).cap);

  assert.deepEqual(caps, ['single', 'daily', 'total'], 'السقوف الثلاثة كلٌّ مرفوض باسمه');
  assert.equal(h.s.ledger.balance('external:ledger:data-archive'), 20_000_000);
  assert.equal(h.s.ledger.trialBalance().balanced, true);
});

test('قبول (3): التعليق فوري — يقع في اللحظة نفسها ويمنع الدفعة في اللحظة نفسها', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const moment = h.now + 60_000;
  beat(h, moment);
  const suspended = h.s.externalAccounts.suspend(
    'ministry:cyber_security', COMPUTE, 'رصد خروج غير معلن', moment,
  );
  assert.equal(suspended.ok, true);
  // لا مدة سماح ولا تأجيل: الحساب غير قائم في اللحظة ذاتها، والدفعة مرفوضة فيها
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, moment), false);
  const payment = h.s.payments.pay({
    accountId: COMPUTE, amount: 1, line: 'budget:foreign',
    purpose: 'دفعة في لحظة التعليق', requestedBy: FOREIGN,
  }, moment);
  assert.equal(payment.ok, false);
  const record = h.s.audit.find('external_account_suspended')[0]?.detail as {
    immediate: boolean; at: number;
  };
  assert.equal(record.immediate, true);
  assert.equal(record.at, moment, 'زمن التعليق هو زمن القرار لا زمنٌ لاحق');
});

test('قبول (4): تعليق شامل يقطع القنوات كلها بنداء واحد، والاستئناف ملكي بعد فحص', () => {
  const h = externalState();
  for (const id of [COMPUTE, ARCHIVE, REGISTRY]) assert.equal(openAccount(h, id).ok, true);
  const all = h.s.externalAccounts.suspendAll('authority:crown_guard', 'حادثة أمنية', h.now + 100);
  assert.equal(all.allowed, true);
  assert.equal(h.s.externalAccounts.active(h.now + 100).length, 0);
  for (const id of [COMPUTE, ARCHIVE, REGISTRY]) {
    const payment = h.s.payments.pay({
      accountId: id, amount: 1, line: 'budget:foreign',
      purpose: 'دفعة بعد التعليق الشامل', requestedBy: FOREIGN,
    }, h.now + 200);
    assert.equal(payment.ok, false, `${id} لا دفعة له`);
  }
  const resumed = h.s.externalAccounts.resume(
    h.royalOpen(COMPUTE, h.now + 300), COMPUTE, FOREIGN, 'انتهى فحص المضيف', h.now + 300,
  );
  assert.equal(resumed.ok, true);
  assert.equal(h.s.externalAccounts.active(h.now + 300).length, 1, 'الاستئناف واحدًا واحدًا');
});

test('قبول (5): دورة كاملة — فتح، دفع، إقرار، تعليق، استئناف، إغلاق: كلها في السجل', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 2_000_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة لثلاثين يومًا', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(paid.ok, true);
  h.s.payments.confirm(
    paid.ok ? paid.payment.paymentId : '', FOREIGN, `إيصال RCV-2026-0100 عن ${paid.ok ? paid.payment.paymentId : ''} بمبلغ 2000000`, h.now + 2000,
  );
  h.s.externalAccounts.suspend('authority:audit_bureau', COMPUTE, 'مراجعة دورية', h.now + 3000);
  h.s.externalAccounts.resume(
    h.royalOpen(COMPUTE, h.now + 4000), COMPUTE, FOREIGN, 'انتهت المراجعة', h.now + 4000,
  );
  const closed = h.s.externalAccounts.close(
    h.royalOpen(COMPUTE, h.now + 5000), COMPUTE, FOREIGN, 'انتهى الغرض المعلن', h.now + 5000,
  );
  assert.equal(closed.ok, true);

  const kinds = h.s.audit.snapshot().map((entry) => entry.kind);
  for (const kind of [
    'external_account_opened', 'external_payment_executed', 'external_payment_confirmed',
    'external_account_suspended', 'external_account_resumed', 'external_account_closed',
  ]) {
    assert.ok(kinds.includes(kind), `الحدث ${kind} مسجَّل`);
  }
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
  assert.equal(h.s.ledger.trialBalance().balanced, true);
});

test('قبول (6): التهيئة وحدها مصدر النظائر والسقوف — لا توسّع من داخل الوحدة (RULE-005)', () => {
  const h = externalState();
  const declared = h.s.externalConfig.counterparties;
  assert.equal(declared.length, 3);
  const sumTotal = declared.reduce((acc, cp) => acc + cp.total_cap, 0);
  assert.ok(sumTotal <= h.s.economyConfig.budget.ceiling_total,
    'مجموع سقوف النظائر لا يتجاوز السقف الكلي للموازنة');
  for (const cp of declared) {
    assert.ok(cp.single_max <= cp.daily_max && cp.daily_max <= cp.total_cap, `سقوف ${cp.id} مرتبة`);
    const account = openAccount(h, cp.id);
    assert.equal(account.ok, true);
    if (!account.ok) continue;
    assert.equal(account.account.singleMax, cp.single_max);
    assert.equal(account.account.dailyMax, cp.daily_max);
    assert.equal(account.account.totalCap, cp.total_cap);
    assert.equal(account.account.host, cp.host);
  }
});

test('قبول (7): الدولة تُقلع بلا حساب خارجي مفتوح — الفتح فعل ملكي لا حالة ابتدائية', () => {
  const T0 = Date.now();
  const s = bootstrapState({ now: T0 });
  assert.equal(s.externalAccounts.active(T0).length, 0);
  assert.equal(s.externalAccounts.report(T0).opened, 0);
  assert.equal(s.payments.history().length, 0);
  assert.equal(s.audit.find('external_account_opened').length, 0);
  assert.equal(s.externalAccounts.declaredCounterparties().length, 3, 'النظائر معلنة لا مفتوحة');
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('قبول (8): وضع الحماية والإيقاف الملكي يقطعان المال الخارجي دون إذن جديد', () => {
  const h = externalState();
  openAccount(h, COMPUTE, h.now, 60);
  const absent = h.now + h.s.config.absence_grace_seconds * 1000 + 60_000;
  assert.equal(h.s.heartbeat.mode(absent), 'protective');
  const inProtective = h.s.payments.pay({
    accountId: COMPUTE, amount: 1000, line: 'budget:foreign',
    purpose: 'دفعة في وضع الحماية', requestedBy: FOREIGN,
  }, absent);
  assert.equal(inProtective.ok, false);

  beat(h, absent + 1000);
  h.s.killSwitch.engage(h.s.king.kingId, 'external', 'إيقاف القنوات الخارجية');
  const halted = h.s.payments.pay({
    accountId: COMPUTE, amount: 1000, line: 'budget:foreign',
    purpose: 'دفعة بعد الإيقاف', requestedBy: FOREIGN,
  }, absent + 1000);
  assert.equal(halted.ok, false);
  assert.equal(h.s.payments.history().length, 0);
});

test('قبول (9): سجل التدقيق يحمل سبب كل رفض ولا يخفي محاولة (RULE-006)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  h.s.payments.pay({
    accountId: COMPUTE, amount: 9_999_999, line: 'budget:foreign',
    purpose: 'فوق السقوف', requestedBy: FOREIGN,
  }, h.now + 1000);
  h.s.payments.pay({
    accountId: 'external:ghost', amount: 1000, line: 'budget:foreign',
    purpose: 'حساب غير قائم', requestedBy: FOREIGN,
  }, h.now + 2000);
  h.s.externalAccounts.suspend('agent:worker-1', COMPUTE, 'محاولة تعليق بلا صلاحية', h.now + 3000);

  const refusals = [
    ...h.s.audit.find('external_payment_refused'),
    ...h.s.audit.find('external_account_refused'),
  ];
  assert.equal(refusals.length, 3);
  for (const record of refusals) {
    const detail = record.detail as { reason?: string };
    assert.ok((detail.reason ?? '').trim().length > 5, 'كل رفض ببيان مقروء');
  }
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('قبول (10): تقرير الحسابات الخارجية يطابق الدفتر والسجل في الوقت نفسه', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  openAccount(h, ARCHIVE);
  h.s.payments.pay({
    accountId: COMPUTE, amount: 1_200_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة', requestedBy: FOREIGN,
  }, h.now + 1000);
  h.s.payments.pay({
    accountId: ARCHIVE, amount: 400_000, line: 'budget:foreign',
    purpose: 'أرشفة', requestedBy: FOREIGN,
  }, h.now + 2000);
  h.s.externalAccounts.suspend(FOREIGN, ARCHIVE, 'تعليق احتياطي', h.now + 3000);

  const accounts = h.s.externalAccounts.report(h.now + 3000);
  const payments = h.s.payments.report();
  assert.equal(accounts.declared, 3);
  assert.equal(accounts.opened, 2);
  assert.equal(accounts.active, 1);
  assert.equal(accounts.suspended, 1);
  assert.equal(payments.payments, 2);
  assert.equal(payments.totalPaid, 1_600_000);
  assert.equal(payments.pending, 2);
  assert.equal(
    h.s.ledger.balance('external:ledger:compute-provider')
    + h.s.ledger.balance('external:ledger:data-archive'),
    payments.totalPaid, 'مجموع الدفتر = مجموع الدفعات',
  );
  assert.equal(h.s.budget.get('budget:foreign')?.spent, 1_600_000);
});
