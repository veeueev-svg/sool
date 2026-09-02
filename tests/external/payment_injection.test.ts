/**
 * tests/external/payment_injection.test.ts — حقنُ انحرافٍ على قناة الصرف الخارجيّة (T-60)
 * المالك: وزارة الخارجية تطلب، ووزارة المالية تنفّذ | يوثّق في: docs/test-reports/phase-26-T60.md
 * يثبت: أنّ `pay()` **بابٌ وحيدٌ فعلًا** إلى نطاق `external:ledger:*` من جهة الخزانة، لا
 *        دعوى في رأس الوحدة: صرفٌ مباشرٌ فوق السقوف يُرفض باسمه، والمعلَّقُ لا يُصرف له من
 *        أيِّ بابٍ، والتذكرةُ لا تُستعمل مرّتين ولا تبقى بعد رفضٍ، والحرسُ لا يُربط مرّتين.
 * ولا يثبت: أنّ الدفترَ نفسَه محروسٌ — `ledger.post` بابٌ ثالثٌ مُعلنٌ دَينًا (T-165).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMPUTE, FOREIGN, externalState, openAccount } from './helpers';

const LEDGER = 'external:ledger:compute-provider';

test('صرفٌ مباشرٌ من الخزانة إلى حساب النظير مرفوضٌ باسمه — ولو دون كل السقوف (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const before = h.s.treasury.balance();
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 100_000, to: LEDGER,
    purpose: 'صرفٌ مباشرٌ يتخطّى ضوابط الدفع الخارجيّ', by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(direct.ok, false, 'النطاقُ محجوزٌ لبابه المعلن');
  assert.match(direct.ok ? '' : direct.reason, /محجوزٌ لبابِه المعلن/);
  assert.match(direct.ok ? '' : direct.reason, /لا تذكرةَ دفعٍ/);
  assert.equal(h.s.treasury.balance(), before, 'لا مالَ خرج من الرفض');
  assert.equal(h.s.ledger.balance(LEDGER), 0);
  assert.equal(h.s.budget.get('budget:foreign')?.spent, 0, 'ولا سقفَ استُهلك');
  assert.equal(h.s.audit.find('disbursement_executed').length, 0);
  assert.equal(h.s.ledger.trialBalance().balanced, true);
});

test('الصرفُ المباشرُ فوق سقفِ الدفعة المعلن مرفوضٌ قبل أن يمسّ الموازنة (T-60)', () => {
  const h = externalState();
  const account = openAccount(h, COMPUTE);
  const singleMax = h.s.externalAccounts.get(COMPUTE)?.singleMax ?? 0;
  assert.ok(singleMax > 0, 'السقفُ المعلنُ مقروءٌ من التهيئة لا من الاختبار');
  assert.ok(account, 'الحسابُ مفتوحٌ بأمرٍ ملكي');
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: singleMax * 4 + 1_000_000, to: LEDGER,
    purpose: 'أضعافُ سقفِ الدفعة من بابٍ ثانٍ', by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(direct.ok, false);
  assert.equal(h.s.ledger.balance(LEDGER), 0, 'ولا فلسَ عبر');
  assert.equal(h.s.externalAccounts.paidTotal(COMPUTE), 0);
  const refusals = h.s.audit.find('disbursement_refused');
  assert.equal(refusals.length, 1, 'الرفضُ مُسجَّلٌ لا صامت');
  assert.equal(refusals[0]?.detail.reservedTarget, LEDGER, 'والسجلُّ يسمّي الحسابَ المحجوز');
});

test('البابُ المعلنُ يبقى نافذًا: pay() ينجح بالسقفِ كاملًا بعد رفضِ الحقن (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  h.s.treasury.disburse({
    line: 'budget:foreign', amount: 9_000_000, to: LEDGER,
    purpose: 'حقنُ انحرافٍ يُرفض', by: 'ministry:finance',
  }, h.now + 1000);
  const singleMax = h.s.externalAccounts.get(COMPUTE)?.singleMax ?? 0;
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: singleMax, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, h.now + 2000);
  assert.equal(paid.ok, true, 'الحرسُ لا يُغلق البابَ المعلن');
  assert.equal(h.s.ledger.balance(LEDGER), singleMax);
  assert.equal(h.s.payments.pendingObligations(COMPUTE), 1, 'والالتزامُ يُسجَّل كما كان');
  assert.equal(h.s.audit.find('external_payment_executed').length, 1);
});

test('الحسابُ المعلَّقُ لا يخرج له مالٌ من أيِّ بابٍ — لا من pay ولا من disburse (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const suspended = h.s.externalAccounts.suspend(FOREIGN, COMPUTE, 'تعليقٌ معلنٌ', h.now + 500);
  assert.equal(suspended.ok, true);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 600), false);

  const viaPay = h.s.payments.pay({
    accountId: COMPUTE, amount: 100_000, line: 'budget:foreign',
    purpose: 'دفعةٌ على حسابٍ معلَّق', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(viaPay.ok, false);
  assert.match(viaPay.ok ? '' : viaPay.reason, /معلَّق/);

  const viaDirect = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 100_000, to: LEDGER,
    purpose: 'صرفٌ مباشرٌ على حسابٍ معلَّق', by: 'ministry:finance',
  }, h.now + 1500);
  assert.equal(viaDirect.ok, false, 'التعليقُ أسبقُ من كل شيء — من البابَين لا من أحدهما');
  assert.equal(h.s.ledger.balance(LEDGER), 0);
});

test('التذكرةُ لا تُستعمل مرّتين: صرفٌ ثانٍ بعد دفعةٍ ناجحةٍ مرفوض (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const at = h.now + 1000;
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 1_000_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, at);
  assert.equal(paid.ok, true);
  // اللحظةُ والمبلغُ والحسابُ كلُّها مطابقةٌ لتذكرةِ الدفعةِ الناجحة — ومع ذلك تُرفض
  const replay = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 1_000_000, to: LEDGER,
    purpose: 'إعادةُ استعمالِ تذكرةٍ استُهلكت', by: 'ministry:finance',
  }, at);
  assert.equal(replay.ok, false);
  assert.match(replay.ok ? '' : replay.reason, /لا تذكرةَ دفعٍ/);
  assert.equal(h.s.ledger.balance(LEDGER), 1_000_000, 'المبلغُ واحدٌ لا اثنان');
});

test('تذكرةٌ لا تبقى بعد رفضِ الخزانة: دفعةٌ فاشلةٌ لا تفتح بابًا لتاليها (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const at = h.now + 1000;
  // بندُ موازنةٍ غيرُ معلن ⇒ الخزانةُ ترفض **بعد** إصدارِ التذكرة، فتُلغى في `finally`
  const failed = h.s.payments.pay({
    accountId: COMPUTE, amount: 500_000, line: 'budget:ghost',
    purpose: 'دفعةٌ على بندٍ غيرِ قائم', requestedBy: FOREIGN,
  }, at);
  assert.equal(failed.ok, false);
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 500_000, to: LEDGER,
    purpose: 'التقاطُ تذكرةٍ مهجورة', by: 'ministry:finance',
  }, at);
  assert.equal(direct.ok, false, 'لا تذكرةَ معلّقةً تُلتقط');
  assert.match(direct.ok ? '' : direct.reason, /لا تذكرةَ دفعٍ/);
  assert.equal(h.s.ledger.balance(LEDGER), 0);
});

test('الإغلاقُ لا يُستعمل لطمسِ صرفٍ مُحقَن: لا مالَ يخرج فلا التزامَ يُخفى (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 3_000_000, to: LEDGER,
    purpose: 'صرفٌ مباشرٌ ثمّ إغلاقٌ سريع', by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(direct.ok, false);
  assert.equal(h.s.externalAccounts.paidTotal(COMPUTE), 0, 'لا مالَ خرج فلا أثرَ يُطمس');
  assert.equal(h.s.payments.pendingObligations(COMPUTE), 0);
});

test('حرسُ النطاق يُربط مرّةً واحدةً — والربطُ الثاني استثناءٌ مغلقٌ لا تجاوزٌ صامت (T-60)', () => {
  const h = externalState();
  assert.throws(
    () => h.s.treasury.bindReservedTargets(() => null),
    /TREASURY_RESERVED_GUARD_ALREADY_BOUND/,
    'حرسٌ يُستبدَل حرسٌ يُلتفَّ عليه',
  );
});

test('الحرسُ لا يمسّ ما ليس في نطاقه: صرفٌ على حسابِ نفقةٍ عاديٍّ يمرّ (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const opened = h.s.ledger.openAccount('expense:operations', 'expense', 'نفقاتُ تشغيل', h.now);
  assert.equal(opened.ok, true);
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 250_000, to: 'expense:operations',
    purpose: 'نفقةُ تشغيلٍ معلنةٌ خارجَ النطاق المحجوز', by: 'ministry:finance',
  }, h.now + 1000);
  assert.equal(direct.ok, true, 'الحجزُ على النطاق المعلن وحده لا على كل صرف');
  assert.equal(h.s.ledger.balance('expense:operations'), 250_000);
});

/**
 * ثابت 7 في الخزانة (التجميد) يُفحص **قبل** حرسِ النطاق، فالدفعةُ ترتدّ من هناك ولا
 * يستهلك الحرسُ تذكرتَها. فلولا `finally` بقيت التذكرةُ صالحةً بعد فكِّ التجميد — وهذا
 * الحكمُ هو الذي يقتل تلك الطفرة، ولا يقتلها استهلاكُ الحرسِ للتذكرة.
 */
test('تذكرةٌ لا تعبر تجميدَ الخزانة: ما ارتدّ قبل الحرس لا يبقى إذنًا بعده (T-60)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const at = h.now + 1000;
  const emergency = (at: number) => h.s.king.issueCommand(
    'declare_emergency', h.s.economyConfig.treasury.account, { kind: 'economy' }, at,
  );
  assert.equal(h.s.treasury.freeze(emergency(h.now + 500), 'تجميدٌ معلن', h.now + 500).ok, true);
  const failed = h.s.payments.pay({
    accountId: COMPUTE, amount: 400_000, line: 'budget:foreign',
    purpose: 'دفعةٌ على خزانةٍ مجمَّدة', requestedBy: FOREIGN,
  }, at);
  assert.equal(failed.ok, false);
  assert.match(failed.ok ? '' : failed.reason, /مجمَّدة/);
  assert.equal(h.s.treasury.unfreeze(emergency(h.now + 2000), 'فكٌّ معلن', h.now + 2000).ok, true);
  const direct = h.s.treasury.disburse({
    line: 'budget:foreign', amount: 400_000, to: LEDGER,
    purpose: 'التقاطُ تذكرةٍ ارتدّت قبل الحرس', by: 'ministry:finance',
  }, at);
  assert.equal(direct.ok, false, 'لا تذكرةَ نجت من الارتداد');
  assert.match(direct.ok ? '' : direct.reason, /لا تذكرةَ دفعٍ/);
  assert.equal(h.s.ledger.balance(LEDGER), 0);
});
