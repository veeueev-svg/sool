/**
 * tests/economy/ledger_entry_guard.test.ts — البابُ الثالثُ إلى مالِ النظراء: `ledger.post` (T-165)
 * المالك: وزارة المالية تقيّد، ووزارة الخارجية تطلب | يوثّق في: docs/test-reports/phase-40-W-2026-042.md
 * المدخلات: دولةٌ خارجيّةٌ كاملةٌ من `tests/external/helpers.ts` · المخرجات: أحكامُ رفضٍ وقبول
 * التبعيات: Ledger.bindEntryGuard · PaymentControls.reservedEntryRefusal · Treasury
 * الصلاحيات: لا تعديل على التهيئة | السجلات: يُقرأ `entry_refused` ولا يُكتب شيء
 * يثبت: قيدٌ مزدوجٌ متوازنٌ مباشرٌ في الدفترِ يمسّ `external:ledger:*` يُرفض باسمِه — وكان
 *        يُقبل فيظهر 500,000 في حسابِ النظيرِ بلا دفعةٍ مسجَّلةٍ والميزانُ متوازن (القياس:
 *        docs/audit/measurements/phase-26-T60.txt §٢) — والبابُ المعلنُ `pay()` نافذٌ كما كان.
 * ولا يثبت: أنّ العكسَ محروس — العكسُ يردّ قيدًا مرّ بالحرسِ ولا يُنشئ مالًا (ثابت 9 في الدفتر).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPUTE, FOREIGN, externalState, openAccount } from '../external/helpers';

const LEDGER = 'external:ledger:compute-provider';
const TREASURY = 'treasury:general';

test('T-165: قيدٌ مباشرٌ متوازنٌ إلى حسابِ النظير يُرفض في الدفترِ نفسِه — ولا مالَ يعبر', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const before = h.s.ledger.balance(TREASURY);
  const direct = h.s.ledger.post({
    entryId: 'probe:t165', memo: 'قيدٌ مباشرٌ يتخطّى الخزانةَ وضوابطَ الدفع',
    lines: [{ account: LEDGER, debit: 500_000 }, { account: TREASURY, credit: 500_000 }],
    by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(direct.ok, false, 'البابُ الثالثُ مغلق');
  assert.match(direct.ok ? '' : direct.reason, /نطاقٌ محجوزٌ لبابِه المعلن/);
  assert.equal(h.s.ledger.balance(LEDGER), 0);
  assert.equal(h.s.ledger.balance(TREASURY), before);
  assert.equal(h.s.externalAccounts.paidTotal(COMPUTE), 0);
  assert.equal(h.s.ledger.entry('probe:t165'), null);
  const refused = h.s.audit.find('entry_refused').filter((e) => e.detail.entryId === 'probe:t165');
  assert.equal(refused.length, 1, 'الرفضُ مُسجَّلٌ لا صامت');
});

test('T-165: الطرفُ الدائنُ على حسابِ النظيرِ محروسٌ أيضًا — الحرسُ يرى القيدَ لا حسابًا واحدًا', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const credit = h.s.ledger.post({
    entryId: 'probe:t165-credit', memo: 'دائنٌ على حسابِ النظيرِ من بابٍ جانبيّ',
    lines: [{ account: TREASURY, debit: 1 }, { account: LEDGER, credit: 1 }],
    by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(credit.ok, false);
});

test('T-165: البابُ المعلنُ نافذ — pay() يقيّد، وإذنُه يُستهلك فلا يُعاد قيدًا مباشرًا', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const at = h.now + 2000;
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, at);
  assert.equal(paid.ok, true);
  assert.equal(h.s.ledger.balance(LEDGER), 1_000_000);
  const replay = h.s.ledger.post({
    entryId: 'probe:t165-replay', memo: 'إعادةُ إذنٍ استُهلك',
    lines: [{ account: LEDGER, debit: 1_000_000 }, { account: TREASURY, credit: 1_000_000 }],
    by: 'ministry:finance',
  }, at);
  assert.equal(replay.ok, false);
  assert.equal(h.s.ledger.balance(LEDGER), 1_000_000, 'المبلغُ واحدٌ لا اثنان');
});

test('T-165: دفعةٌ رفضتها الخزانةُ لا تترك إذنًا لقيدٍ مباشرٍ بعدها', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const at = h.now + 3000;
  const refused = h.s.payments.pay({
    accountId: COMPUTE, amount: 1_000_000, line: 'budget:nonexistent',
    purpose: 'بندٌ غيرُ قائمٍ فتُرفض في الخزانة', requestedBy: FOREIGN,
  }, at);
  assert.equal(refused.ok, false);
  const after = h.s.ledger.post({
    entryId: 'probe:t165-after', memo: 'قيدٌ بعد دفعةٍ مرفوضة',
    lines: [{ account: LEDGER, debit: 1_000_000 }, { account: TREASURY, credit: 1_000_000 }],
    by: 'ministry:finance',
  }, at);
  assert.equal(after.ok, false);
  assert.equal(h.s.ledger.balance(LEDGER), 0);
});

test('T-165: قيدٌ لا يمسّ النطاقَ لا يُسأل عنه، والحرسُ لا يُربط مرّتين', () => {
  const h = externalState();
  const received = h.s.treasury.receive(1_000, 'probe', 'revenue:levies', 'إيرادٌ معلنٌ للاختبار', h.now + 10);
  assert.equal(received.ok, true, 'قيودُ الدولةِ الداخليّةُ كما كانت');
  assert.throws(() => h.s.ledger.bindEntryGuard(() => null), /LEDGER_ENTRY_GUARD_ALREADY_BOUND/);
});
