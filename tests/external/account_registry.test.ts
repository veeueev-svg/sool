/**
 * tests/external/account_registry.test.ts — سجل الحسابات الخارجية (المرحلة 26)
 * المالك: وزارة الخارجية تحت التاج | يوثّق في: docs/test-reports/phase-26.md
 * يثبت: لا حساب لغير نظير معلن، ولا حساب دائم، والسقوف من الإعلان لا من الطلب،
 *        والتعليق فوري بلا أمر، والاستئناف ملكي وبغير من علّق، ولا إغلاق على التزام معلَّق.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExternalAccountRegistry, FOREIGN_MINISTRY } from '../../src/index';
import {
  ARCHIVE, COMPUTE, DAY, FOREIGN, REGISTRY, beat, externalState, openAccount,
} from './helpers';

test('لا حساب لغير نظير معلن في التهيئة — الفتح لا يُنشئ نظيرًا (ثابت 1)', () => {
  const h = externalState();
  const result = h.s.externalAccounts.open(h.royalOpen('external:ghost'), {
    counterparty: 'external:ghost', expiresAt: h.now + 10 * DAY,
    requestedBy: FOREIGN, justification: 'نظير لم يُعلن',
  }, h.now);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /نظير غير معلن/);
  assert.equal(h.s.externalAccounts.get('external:ghost'), null);
  assert.equal(h.s.audit.find('external_account_refused').length, 1);
});

test('الفتح بفعل open_external_account وحده — وهدف الأمر يطابق النظير', () => {
  const h = externalState();
  const wrongAction = h.s.externalAccounts.open(h.royal(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now + 10 * DAY,
    requestedBy: FOREIGN, justification: 'بفعل تعديل سياسة',
  }, h.now);
  assert.equal(wrongAction.ok, false);
  assert.match(wrongAction.ok ? '' : wrongAction.reason, /open_external_account/);

  const wrongTarget = h.s.externalAccounts.open(h.royalOpen(ARCHIVE), {
    counterparty: COMPUTE, expiresAt: h.now + 10 * DAY,
    requestedBy: FOREIGN, justification: 'هدف لا يطابق',
  }, h.now);
  assert.equal(wrongTarget.ok, false);
  assert.match(wrongTarget.ok ? '' : wrongTarget.reason, /هدف الأمر/);
  assert.equal(h.s.externalAccounts.get(COMPUTE), null);
});

test('الفتح باقتراح وزارة الخارجية وحدها، وبمبرّر معلن (RULE-004 و RULE-006)', () => {
  const h = externalState();
  const byOther = h.s.externalAccounts.open(h.royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now + 10 * DAY,
    requestedBy: 'ministry:finance', justification: 'وزارة المالية تفتح لنفسها',
  }, h.now);
  assert.equal(byOther.ok, false);
  assert.match(byOther.ok ? '' : byOther.reason, /وزارة الخارجية وحدها/);

  const noReason = h.s.externalAccounts.open(h.royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now + 10 * DAY,
    requestedBy: FOREIGN, justification: ' ',
  }, h.now);
  assert.equal(noReason.ok, false);
  assert.match(noReason.ok ? '' : noReason.reason, /مبرّر معلن/);
});

test('لا حساب دائم: بلا مدة، أو مدة ماضية، أو مدة تتجاوز الحدّ المعلن ⇒ رفض (ثابت 2)', () => {
  const h = externalState();
  const past = h.s.externalAccounts.open(h.royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now - 1,
    requestedBy: FOREIGN, justification: 'مدة منقضية',
  }, h.now);
  assert.equal(past.ok, false);
  assert.match(past.ok ? '' : past.reason, /مدة انتهاء صالحة/);

  // الحدّ المعلن 90 يومًا في config/external.yaml — و91 يومًا يُرفض ولا يُقرَّب
  const tooLong = h.s.externalAccounts.open(h.royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now + 91 * DAY,
    requestedBy: FOREIGN, justification: 'مدة تتجاوز الحدّ',
  }, h.now);
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.ok ? '' : tooLong.reason, /تتجاوز الحدّ المعلن/);
  assert.equal(h.s.externalAccounts.report(h.now).opened, 0);
});

test('لا قناة مال بلا قناة شبكة معلنة (ثابت 5) — والمضيف بلا إذن خروج يُرفض', () => {
  // إذن خروج معلن لمضيف الحوسبة وحده
  const h = externalState({ egressFor: ['api.compute.example'] });
  assert.equal(openAccount(h, COMPUTE).ok, true, 'مضيف له إذن خروج');
  const noEgress = openAccount(h, ARCHIVE);
  assert.equal(noEgress.ok, false);
  assert.match(noEgress.ok ? '' : noEgress.reason, /قناة شبكة معلنة/);
  const refusals = h.s.audit.find('external_account_refused');
  assert.equal((refusals.at(-1)?.detail as { host: string }).host, 'archive.data.example');
});

test('مصدر التحقق من قناة الشبكة غير مربوط ⇒ كل فتح مرفوض (لا افتراض سماح)', () => {
  const h = externalState();
  const bare = new ExternalAccountRegistry({
    audit: h.s.audit, gateway: h.s.gateway, ledger: h.s.ledger,
    counterparties: [{
      id: COMPUTE, name: 'مزوّد معلن', host: 'api.compute.example', port: 443,
      purpose: 'حوسبة', singleMax: 1000, dailyMax: 2000, totalCap: 3000,
    }],
    maxTermMs: 90 * DAY, suspendAuthorities: [FOREIGN], unitConvertible: false,
  });
  const result = bare.open(h.royalOpen(COMPUTE), {
    counterparty: COMPUTE, expiresAt: h.now + DAY,
    requestedBy: FOREIGN, justification: 'قبل ربط المصدر',
  }, h.now);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /غير مربوط/);
});

test('السقوف تُنسخ من الإعلان لا من الطلب (ثابت 3)، والحساب المقابل يُفتح في الدفتر', () => {
  const h = externalState();
  const opened = openAccount(h, COMPUTE);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  const declared = h.s.externalConfig.counterparties.find((cp) => cp.id === COMPUTE);
  assert.equal(opened.account.singleMax, declared?.single_max);
  assert.equal(opened.account.dailyMax, declared?.daily_max);
  assert.equal(opened.account.totalCap, declared?.total_cap);
  assert.equal(opened.account.ledgerAccount, 'external:ledger:compute-provider');
  assert.equal(h.s.ledger.hasAccount('external:ledger:compute-provider'), true);
  assert.equal(h.s.ledger.account('external:ledger:compute-provider')?.kind, 'expense');
  assert.equal(h.s.externalAccounts.paidTotal(COMPUTE), 0, 'حساب جديد لا مدفوعات له');
});

test('لا فتح مكرَّر لنظير له حساب مفتوح', () => {
  const h = externalState();
  assert.equal(openAccount(h, COMPUTE).ok, true);
  const again = openAccount(h, COMPUTE);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /مفتوح سابقًا/);
  assert.equal(h.s.externalAccounts.report(h.now).opened, 1);
});

test('التعليق فوري وبلا أمر ملكي — من جهة معلنة في التهيئة وحدها (ثابت 4)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const byStranger = h.s.externalAccounts.suspend(
    'agent:worker-1', COMPUTE, 'وكيل يعلّق حسابًا', h.now + 10,
  );
  assert.equal(byStranger.ok, false);
  assert.match(byStranger.ok ? '' : byStranger.reason, /جهة معلنة/);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 10), true);

  const byCyber = h.s.externalAccounts.suspend(
    'ministry:cyber_security', COMPUTE, 'شبهة في المضيف', h.now + 20,
  );
  assert.equal(byCyber.ok, true);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 20), false);
  assert.equal(h.s.audit.find('external_account_suspended').length, 1);
  assert.equal(
    (h.s.audit.find('external_account_suspended')[0]?.detail as { immediate: boolean }).immediate,
    true,
  );
  assert.equal(h.s.externalAccounts.suspend(
    'authority:audit_bureau', COMPUTE, 'تعليق ثانٍ', h.now + 30,
  ).ok, false, 'لا تعليق على معلَّق');
});

test('لا سبب معلن ⇒ لا تعليق ولا تعليق شامل (RULE-006)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  assert.equal(h.s.externalAccounts.suspend(FOREIGN, COMPUTE, ' ', h.now + 10).ok, false);
  assert.equal(
    h.s.externalAccounts.suspendAll('authority:crown_guard', ' ', h.now + 10).allowed, false,
  );
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 10), true);
});

test('لا يرفع التعليقَ من أنزله، والاستئناف بأمر ملكي وحده (ثابت 4 + RULE-004)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  h.s.externalAccounts.suspend('ministry:cyber_security', COMPUTE, 'شبهة', h.now + 10);

  const selfResume = h.s.externalAccounts.resume(
    h.royalOpen(COMPUTE, h.now + 20), COMPUTE, 'ministry:cyber_security', 'زالت الشبهة', h.now + 20,
  );
  assert.equal(selfResume.ok, false);
  assert.match(selfResume.ok ? '' : selfResume.reason, /من أنزله/);

  const noCommand = h.s.externalAccounts.resume(
    h.royal(COMPUTE, h.now + 21), COMPUTE, FOREIGN, 'بفعل تعديل سياسة', h.now + 21,
  );
  assert.equal(noCommand.ok, false);
  assert.match(noCommand.ok ? '' : noCommand.reason, /open_external_account/);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 21), false);

  const resumed = h.s.externalAccounts.resume(
    h.royalOpen(COMPUTE, h.now + 30), COMPUTE, FOREIGN, 'انتهى الفحص الأمني', h.now + 30,
  );
  assert.equal(resumed.ok, true);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 30), true);
  const record = h.s.audit.find('external_account_resumed')[0]?.detail as { previousBy: string };
  assert.equal(record.previousBy, 'ministry:cyber_security', 'من علّق مسجَّل في سجل الاستئناف');
});

test('حساب منتهي المدة ليس قائمًا ولا يُستأنف — لا تمديد ضمني (ثابت 2)', () => {
  const h = externalState();
  openAccount(h, COMPUTE, h.now, 30);
  const after = h.now + 31 * DAY;
  beat(h, after);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, after), false);
  assert.match(h.s.externalAccounts.inactiveReason(COMPUTE, after) ?? '', /انتهت مدة/);

  h.s.externalAccounts.suspend(FOREIGN, COMPUTE, 'تعليق قبل الانتهاء', h.now + 10);
  const resumed = h.s.externalAccounts.resume(
    h.royalOpen(COMPUTE, after), COMPUTE, 'authority:crown_guard', 'محاولة تمديد', after,
  );
  assert.equal(resumed.ok, false);
  assert.match(resumed.ok ? '' : resumed.reason, /منتهي المدة/);
});

test('تعليق كل النوافذ بنداء واحد — والعدد مسجَّل', () => {
  const h = externalState();
  assert.equal(openAccount(h, COMPUTE).ok, true);
  assert.equal(openAccount(h, ARCHIVE).ok, true);
  assert.equal(openAccount(h, REGISTRY).ok, true);
  assert.equal(h.s.externalAccounts.active(h.now).length, 3);

  const all = h.s.externalAccounts.suspendAll(
    'authority:crown_guard', 'حادثة أمنية عامة', h.now + 50,
  );
  assert.equal(all.allowed, true);
  assert.equal(h.s.externalAccounts.active(h.now + 50).length, 0);
  const detail = h.s.audit.find('external_accounts_suspended_all')[0]?.detail as {
    count: number; affected: string[];
  };
  assert.equal(detail.count, 3);
  assert.deepEqual([...detail.affected].sort(), [ARCHIVE, COMPUTE, REGISTRY].sort());
});

test('لا إغلاق على التزام لم يُثبَت استلامه، ويقع بعد الإقرار (ثابت 7)', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 500_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة معلنة', requestedBy: FOREIGN,
  }, h.now + 1000);
  assert.equal(paid.ok, true);

  const blocked = h.s.externalAccounts.close(
    h.royalOpen(COMPUTE, h.now + 2000), COMPUTE, FOREIGN, 'إغلاق مبكر', h.now + 2000,
  );
  assert.equal(blocked.ok, false);
  assert.match(blocked.ok ? '' : blocked.reason, /لم يُثبَت استلامه/);

  h.s.payments.confirm(
    paid.ok ? paid.payment.paymentId : '', FOREIGN, `إيصال عن ${paid.ok ? paid.payment.paymentId : ''} بمبلغ 500000`, h.now + 3000,
  );
  const closed = h.s.externalAccounts.close(
    h.royalOpen(COMPUTE, h.now + 4000), COMPUTE, FOREIGN, 'انتهى الغرض المعلن', h.now + 4000,
  );
  assert.equal(closed.ok, true);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, h.now + 4000), false);
  assert.equal(
    (h.s.audit.find('external_account_closed')[0]?.detail as { paidTotal: number }).paidTotal,
    500_000, 'المدفوع في سجل الإغلاق مقروء من الدفتر (ثابت 8)',
  );
});

test('الإغلاق بأمر ملكي هدفه الحساب، ولا يُغلق حساب مغلق ولا يُفتح بعده', () => {
  const h = externalState();
  openAccount(h, ARCHIVE);
  assert.equal(h.s.externalAccounts.close(
    h.royal(ARCHIVE, h.now + 10), ARCHIVE, FOREIGN, 'بفعل خاطئ', h.now + 10,
  ).ok, false);
  assert.equal(h.s.externalAccounts.close(
    h.royalOpen(COMPUTE, h.now + 10), ARCHIVE, FOREIGN, 'هدف لا يطابق', h.now + 10,
  ).ok, false);
  assert.equal(h.s.externalAccounts.close(
    h.royalOpen(ARCHIVE, h.now + 20), ARCHIVE, FOREIGN, 'انتهى الغرض', h.now + 20,
  ).ok, true);
  assert.equal(h.s.externalAccounts.close(
    h.royalOpen(ARCHIVE, h.now + 30), ARCHIVE, FOREIGN, 'إغلاق ثانٍ', h.now + 30,
  ).ok, false);
});

test('حساب مغلق يُعاد فتحه بأمر جديد — والفتح الثاني حساب جديد لا استئناف صامت', () => {
  const h = externalState();
  openAccount(h, REGISTRY);
  assert.equal(h.s.externalAccounts.close(
    h.royalOpen(REGISTRY, h.now + 10), REGISTRY, FOREIGN, 'انتهى الغرض', h.now + 10,
  ).ok, true);
  const reopened = openAccount(h, REGISTRY, h.now + 20, 15);
  assert.equal(reopened.ok, true);
  assert.equal(h.s.externalAccounts.isActive(REGISTRY, h.now + 20), true);
  assert.equal(h.s.audit.find('external_account_opened').length, 2, 'كل فتح مسجَّل باسمه');
});

test('السقوف والصلاحيات كلها من التهيئة — والوحدة تبقى غير قابلة للتحويل (ثابت 6)', () => {
  const h = externalState();
  const report = h.s.externalAccounts.report(h.now);
  assert.equal(report.declared, 3);
  assert.equal(report.unitConvertible, false);
  assert.equal(report.maxTermMs, 90 * DAY);
  assert.equal(h.s.externalConfig.policy.default, 'deny');
  // فتح الحسابات كلها لا يجعل الوحدة قابلة للتحويل
  openAccount(h, COMPUTE);
  const attempt = h.s.unit.convertExternal(FOREIGN_MINISTRY, 1000, 'سوق خارجي');
  assert.equal(attempt.ok, false);
  assert.equal(h.s.audit.find('external_convertibility_refused').length, 1);
});

test('كل رفض له سجل بسببه، وسلسلة التدقيق سليمة بعد كل المحاولات (RULE-006)', () => {
  const h = externalState();
  h.s.externalAccounts.open(h.royalOpen('external:ghost'), {
    counterparty: 'external:ghost', expiresAt: h.now + DAY,
    requestedBy: FOREIGN, justification: 'محاولة',
  }, h.now);
  h.s.externalAccounts.suspend('agent:x', COMPUTE, 'محاولة', h.now);
  h.s.externalAccounts.close(h.royalOpen(COMPUTE), COMPUTE, FOREIGN, 'محاولة', h.now);
  const refusals = h.s.audit.find('external_account_refused');
  assert.equal(refusals.length, 3);
  for (const record of refusals) {
    const detail = record.detail as { reason?: string };
    assert.equal(typeof detail.reason, 'string');
    assert.ok((detail.reason ?? '').length > 3, 'لا رفض بلا بيان');
  }
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});
