/**
 * tests/external/containment_and_receipts.test.ts — احتواءُ الشبكة يعلّق المال · الإثباتُ بصمةٌ لا نصّ (T-58 · T-61 · W-2026-054)
 * المالك: وزارة الأمن السيبراني + وزارة الخارجية | يوثّق في: docs/test-reports/phase-40-W-2026-054.md
 * يثبت: (1) احتواءُ حارس الخروج بعد محاولاتٍ غير معلنة يعلّق كلَّ حسابٍ خارجيٍّ قائمٍ في اللحظة نفسِها
 *       بيد الجهة المحتوية، ويُقيَّد الانتشار؛ (2) إقرارُ الاستلام يرفض مرجعًا لا يشير إلى دفعته
 *       ويرفض بصمةً أثبتت دفعةً أخرى، ويُدوَّن الإقرارُ ومعه دليلُه (كان يُدوَّن بلا دليل).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE, COMPUTE, FOREIGN, externalState, openAccount } from './helpers';

test('T-58: احتواءُ الخروج الشبكي يعلّق القناةَ الماليّة معه — لا تنتظر إنسانًا', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  openAccount(h, ARCHIVE);
  for (let i = 0; i < 3; i++) h.s.egress.request('agent:1', { host: 'evil.example.com' });
  assert.equal(h.s.egress.report().contained, true);
  for (const id of [COMPUTE, ARCHIVE]) {
    const account = h.s.externalAccounts.get(id);
    assert.equal(account?.suspended, true, `${id} معلَّق`);
    assert.equal(account?.suspendedBy, 'ministry:cyber_security');
  }
  const propagated = h.s.audit.find('egress_containment_propagated');
  assert.equal(propagated.length, 1);
  assert.equal((propagated[0]?.detail as { financial: boolean }).financial, true);
  assert.throws(() => h.s.egress.bindContainmentHook(() => ({ allowed: true, reason: '', auditId: '' })),
    /EGRESS_CONTAINMENT_HOOK_REBOUND/);
});

test('T-61: الإثباتُ يشير إلى دفعته، وبصمتُه لا تُعاد لدفعةٍ ثانية، ويُدوَّن معه', () => {
  const h = externalState();
  openAccount(h, COMPUTE);
  const journaled: { evidence: string | null; confirmedAt: number | null }[] = [];
  h.s.payments.attachJournal({
    record: (kind: string, payload: unknown) => {
      if (kind === 'external_payment') journaled.push(JSON.parse(JSON.stringify((payload as { payment: never }).payment)));
      return null;
    },
  } as never);
  const pay = (amount: number, at: number) => {
    const r = h.s.payments.pay({ accountId: COMPUTE, amount, line: 'budget:foreign', purpose: 'سعة حوسبة', requestedBy: FOREIGN }, at);
    assert.equal(r.ok, true);
    return r.ok ? r.payment.paymentId : '';
  };
  const first = pay(100_000, h.now + 1000);
  const second = pay(100_000, h.now + 1100);

  assert.equal(h.s.payments.confirm(first, FOREIGN, 'مرجع: RCV-1 تمّ', h.now + 2000).ok, false, 'نصٌّ حرّ');
  assert.equal(h.s.payments.confirm(first, FOREIGN, `إيصال ${first} بمبلغ 999`, h.now + 2000).ok, false, 'مبلغٌ لا يطابق');
  assert.equal(h.s.payments.confirm(first, FOREIGN, `إيصال ${second} بمبلغ 100000`, h.now + 2000).ok, false, 'دفعةٌ أخرى');
  const shared = `إيصال جامع ${first} ${second} بمبلغ 100000`;
  assert.equal(h.s.payments.confirm(first, FOREIGN, shared, h.now + 2000).ok, true);
  const reused = h.s.payments.confirm(second, FOREIGN, shared, h.now + 2100);
  assert.equal(reused.ok, false);
  assert.match(reused.ok ? '' : reused.reason, /أثبتت دفعةً أخرى/);

  const last = journaled.at(-1);
  assert.notEqual(last?.confirmedAt, null);
  assert.match(last?.evidence ?? '', /^sha256:[0-9a-f]{64}$/, 'الإقرارُ يُدوَّن ومعه دليلُه');
});
