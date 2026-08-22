/**
 * tests/economy/ledger.test.ts — اختبار الدفتر المزدوج (المرحلة 25)
 * المالك: وزارة المالية | يوثّق في: docs/test-reports/phase-25.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, FINANCE_MINISTRY } from '../../src/index';

const T0 = Date.now();

function ledgerState() {
  const s = bootstrapState({ now: T0 });
  s.ledger.openAccount('expense:operations', 'expense', 'مصروف التشغيل', T0);
  s.ledger.openAccount('expense:research', 'expense', 'مصروف البحث', T0);
  return s;
}

test('حسابات الدولة تُفتح في التأسيس ولا تُترك لمن يتذكّر', () => {
  const s = bootstrapState({ now: T0 });
  assert.equal(s.ledger.hasAccount('treasury:general'), true);
  assert.equal(s.ledger.hasAccount('equity:sovereign_issue'), true);
  assert.equal(s.ledger.hasAccount('revenue:levies'), true);
  assert.equal(s.audit.find('account_opened').length >= 3, true);
});

test('لا حساب يُفتح مرتين', () => {
  const s = ledgerState();
  const again = s.ledger.openAccount('expense:operations', 'expense', 'مصروف مكرَّر', T0);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /لا يُفتح مرتين/);
});

test('القيد المتوازن يُثبَت ويظهر في الميزان', () => {
  const s = ledgerState();
  const r = s.ledger.post({
    entryId: 'e1', memo: 'قيد افتتاحي متوازن', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 1000 },
      { account: 'equity:sovereign_issue', credit: 1000 },
    ],
  }, T0);
  assert.equal(r.ok, true);
  assert.equal(s.ledger.trialBalance().balanced, true);
  assert.equal(s.ledger.balance('treasury:general'), 1000);
  assert.equal(s.audit.find('entry_posted').length, 1);
});

test('**القيد غير المتوازن مرفوض** — معيار القبول الأول', () => {
  const s = ledgerState();
  const r = s.ledger.post({
    entryId: 'e-bad', memo: 'مدين لا يساوي الدائن', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 1000 },
      { account: 'equity:sovereign_issue', credit: 900 },
    ],
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير متوازن/);
  const refusal = s.audit.find('entry_refused').at(-1);
  assert.equal((refusal?.detail as { debits: number }).debits, 1000);
  assert.equal((refusal?.detail as { credits: number }).credits, 900);
  assert.equal(s.ledger.journal().length, 0, 'لا يبقى أثر لقيد مرفوض');
});

test('لا قيد بطرف واحد: القيد المزدوج طرفان على الأقل', () => {
  const s = ledgerState();
  const r = s.ledger.post({
    entryId: 'e-one', memo: 'طرف واحد', by: FINANCE_MINISTRY,
    lines: [{ account: 'treasury:general', debit: 500 }],
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /بطرف واحد/);
});

test('الطرف مدين أو دائن لا الاثنين ولا لا شيء', () => {
  const s = ledgerState();
  const both = s.ledger.post({
    entryId: 'e-both', memo: 'مدين ودائن معًا', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 100, credit: 100 },
      { account: 'equity:sovereign_issue', credit: 100 },
    ],
  }, T0);
  assert.equal(both.ok, false);
  const neither = s.ledger.post({
    entryId: 'e-neither', memo: 'بلا مبلغ', by: FINANCE_MINISTRY,
    lines: [{ account: 'treasury:general' }, { account: 'equity:sovereign_issue', credit: 100 }],
  }, T0);
  assert.equal(neither.ok, false);
});

test('**لا كسور عائمة في المال**: المبلغ الكسري مرفوض', () => {
  const s = ledgerState();
  const r = s.ledger.post({
    entryId: 'e-float', memo: 'مبلغ كسري', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 10.5 },
      { account: 'equity:sovereign_issue', credit: 10.5 },
    ],
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /عدد صحيح موجب/);
});

test('المبلغ السالب والصفر مرفوضان', () => {
  const s = ledgerState();
  for (const amount of [-100, 0]) {
    const r = s.ledger.post({
      entryId: `e-${amount}`, memo: 'مبلغ غير سليم', by: FINANCE_MINISTRY,
      lines: [
        { account: 'treasury:general', debit: amount },
        { account: 'equity:sovereign_issue', credit: amount },
      ],
    }, T0);
    assert.equal(r.ok, false, `المبلغ ${amount} يجب أن يُرفض`);
  }
});

test('لا قيد على حساب غير مفتوح', () => {
  const s = ledgerState();
  const r = s.ledger.post({
    entryId: 'e-ghost', memo: 'حساب لا وجود له', by: FINANCE_MINISTRY,
    lines: [
      { account: 'expense:ghost', debit: 100 },
      { account: 'treasury:general', credit: 100 },
    ],
  }, T0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.reason, /غير مفتوح/);
});

test('لا قيد بلا بيان معلن ولا بمعرّف مكرَّر', () => {
  const s = ledgerState();
  const lines = [
    { account: 'treasury:general', debit: 100 },
    { account: 'equity:sovereign_issue', credit: 100 },
  ];
  assert.equal(s.ledger.post({ entryId: 'e2', memo: '', by: FINANCE_MINISTRY, lines }, T0).ok, false);
  assert.equal(s.ledger.post({ entryId: 'e2', memo: 'قيد أول', by: FINANCE_MINISTRY, lines }, T0).ok, true);
  const dup = s.ledger.post({ entryId: 'e2', memo: 'قيد مكرَّر', by: FINANCE_MINISTRY, lines }, T0);
  assert.equal(dup.ok, false);
  assert.match(dup.ok ? '' : dup.reason, /مكرَّر/);
});

test('**التصحيح بقيد معاكس لا بمحو**: الأصل يبقى ويظهر معه معاكسه', () => {
  const s = ledgerState();
  s.ledger.post({
    entryId: 'e3', memo: 'قيد فيه خطأ', by: FINANCE_MINISTRY,
    lines: [
      { account: 'expense:operations', debit: 700 },
      { account: 'treasury:general', credit: 700 },
    ],
  }, T0);
  const rev = s.ledger.reverse('e3', 'صُرف على البند الخطأ', FINANCE_MINISTRY, T0 + 1000);
  assert.equal(rev.ok, true);
  assert.equal(s.ledger.entry('e3') !== null, true, 'القيد الأصلي لا يُمحى');
  assert.equal(s.ledger.balance('expense:operations'), 0, 'الأثر يعود صفرًا بالعكس لا بالحذف');
  assert.equal(s.ledger.journal().length, 2);
  assert.equal(s.audit.find('entry_reversed').length, 1);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('لا عكس مرتين ولا عكس لقيدٍ هو عكسٌ لغيره ولا عكس بلا سبب', () => {
  const s = ledgerState();
  s.ledger.post({
    entryId: 'e4', memo: 'قيد', by: FINANCE_MINISTRY,
    lines: [
      { account: 'expense:operations', debit: 200 },
      { account: 'treasury:general', credit: 200 },
    ],
  }, T0);
  assert.equal(s.ledger.reverse('e4', '', FINANCE_MINISTRY, T0 + 1).ok, false);
  assert.equal(s.ledger.reverse('e4', 'سبب معلن', FINANCE_MINISTRY, T0 + 1).ok, true);
  const twice = s.ledger.reverse('e4', 'مرة ثانية', FINANCE_MINISTRY, T0 + 2);
  assert.equal(twice.ok, false);
  assert.match(twice.ok ? '' : twice.reason, /مُصحَّح سابقًا/);
  const ofReversal = s.ledger.reverse('rev:e4', 'عكس العكس', FINANCE_MINISTRY, T0 + 3);
  assert.equal(ofReversal.ok, false);
});

test('**الفترة المغلقة لا تقبل قيدًا ولا تُعاد فتحها**', () => {
  const s = ledgerState();
  const closed = s.ledger.closePeriod(T0 + 1000, FINANCE_MINISTRY, T0 + 2000);
  assert.equal(closed.ok, true);
  assert.equal(s.ledger.closedAt(), T0 + 1000);
  const inClosed = s.ledger.post({
    entryId: 'e-late', memo: 'قيد في فترة مغلقة', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 100 },
      { account: 'equity:sovereign_issue', credit: 100 },
    ],
  }, T0 + 500);
  assert.equal(inClosed.ok, false);
  assert.match(inClosed.ok ? '' : inClosed.reason, /مغلقة/);
  const reopen = s.ledger.closePeriod(T0 + 500, FINANCE_MINISTRY, T0 + 3000);
  assert.equal(reopen.ok, false);
  assert.match(reopen.ok ? '' : reopen.reason, /إعادة فتح/);
});

test('التصحيح يقع في الفترة المفتوحة بعد الإغلاق', () => {
  const s = ledgerState();
  const ok = s.ledger.post({
    entryId: 'e5', memo: 'قيد قبل الإغلاق', by: FINANCE_MINISTRY,
    lines: [
      { account: 'expense:research', debit: 300 },
      { account: 'treasury:general', credit: 300 },
    ],
  }, T0 + 100);
  assert.equal(ok.ok, true);
  s.ledger.closePeriod(T0 + 1000, FINANCE_MINISTRY, T0 + 2000);
  const fix = s.ledger.reverse('e5', 'تصحيح بعد الإغلاق في الفترة المفتوحة', FINANCE_MINISTRY, T0 + 3000);
  assert.equal(fix.ok, true);
  assert.equal(s.ledger.trialBalance().balanced, true);
});

test('إغلاق الدفتر لوزارة المالية وحدها ولا يُغلق دفتر غير متوازن', () => {
  const s = ledgerState();
  const byOther = s.ledger.closePeriod(T0 + 100, 'ministry:defense', T0 + 200);
  assert.equal(byOther.ok, false);
  assert.match(byOther.ok ? '' : byOther.reason, /وزارة المالية/);
  const future = s.ledger.closePeriod(T0 + 5000, FINANCE_MINISTRY, T0 + 100);
  assert.equal(future.ok, false, 'لا إغلاق لفترة لم تنتهِ');
});

test('الميزان الكلي يبقى متوازنًا بعد سلسلة قيود (الثابت 7)', () => {
  const s = ledgerState();
  for (let i = 0; i < 12; i++) {
    s.ledger.post({
      entryId: `bulk:${i}`, memo: `قيد رقم ${i}`, by: FINANCE_MINISTRY,
      lines: [
        { account: 'expense:operations', debit: 10 + i },
        { account: 'treasury:general', credit: 10 + i },
      ],
    }, T0 + i);
  }
  const balance = s.ledger.trialBalance();
  assert.equal(balance.entries, 12);
  assert.equal(balance.balanced, true);
  assert.equal(balance.debits, balance.credits);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('رصيد الحساب يُحسب بطبيعته: المدين بطبعه والدائن بطبعه', () => {
  const s = ledgerState();
  s.ledger.post({
    entryId: 'nature', memo: 'إيراد وارد', by: FINANCE_MINISTRY,
    lines: [
      { account: 'treasury:general', debit: 400 },
      { account: 'revenue:levies', credit: 400 },
    ],
  }, T0);
  assert.equal(s.ledger.balance('treasury:general'), 400, 'الأصل مدين بطبعه');
  assert.equal(s.ledger.balance('revenue:levies'), 400, 'الإيراد دائن بطبعه');
  assert.equal(s.ledger.balance('account:unknown'), 0);
});
