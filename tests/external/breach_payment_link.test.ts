/**
 * tests/external/breach_payment_link.test.ts — الإخلالُ ينزل من العقد إلى الدفعة (T-67 بقيّتُه · W-2026-056)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-40-W-2026-056.md
 * يثبت: إخلالٌ يسمّي دفعةً قائمةً على قناة نظير العقد يُقبل ويُقرأ بالدفعة؛ ودفعةٌ مجهولة أو على قناة
 *       نظيرٍ آخر أو لم تقع بعد تُرفض باسمها؛ والإخلالُ بلا دفعةٍ يبقى كما كان؛ والقارئُ لا يُربط مرّتين.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE, AUDITOR, COMPUTE, FOREIGN, KIND_COMPUTE, assessRisk, contractState, openAccount, signContract } from './helpers';

function setup() {
  const h = contractState();
  openAccount(h, ARCHIVE);
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 3_000_000 });
  assert.equal(signed.ok, true);
  const pay = (accountId: string) => {
    const r = h.s.payments.pay({ accountId, amount: 100_000, line: 'budget:foreign', purpose: 'دفعةٌ معلنة', requestedBy: FOREIGN }, h.now + 1000);
    assert.equal(r.ok, true);
    return r.ok ? r.payment.paymentId : '';
  };
  return { h, contractId: signed.ok ? signed.contract.contractId : '', onCompute: pay(COMPUTE), onArchive: pay(ARCHIVE) };
}

test('T-67: إخلالٌ يسمّي دفعتَه يُقبل ويُقرأ بها — والقيدُ يحملها', () => {
  const { h, contractId, onCompute } = setup();
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'تسليمٌ ناقص عن الدفعة', h.now + 2000, onCompute), true);
  assert.equal(h.s.partnerRisk.breachesForPayment(onCompute).length, 1);
  assert.equal(h.s.partnerRisk.breachesFor(contractId)[0]?.paymentId, onCompute);
  assert.equal(h.s.audit.find('partner_breach_noted').at(-1)?.detail['paymentId'], onCompute);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'إخلالٌ عامّ بلا دفعة', h.now + 2000), true, 'بلا دفعةٍ كما كان');
  assert.equal(h.s.partnerRisk.breachCount(COMPUTE), 2);
});

test('T-67: دفعةٌ مجهولة أو على قناة نظيرٍ آخر أو لم تقع بعد تُرفض باسمها', () => {
  const { h, contractId, onCompute, onArchive } = setup();
  const reasons = () => h.s.audit.find('partner_risk_refused').map((e) => e.detail['reason']);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'دفعةٌ مجهولة', h.now + 2000, 'extpay:999'), false);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'دفعةُ نظيرٍ آخر', h.now + 2000, onArchive), false);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'قبل الدفعة', h.now + 500, onCompute), false);
  assert.deepEqual(reasons(), [
    'لا إخلال على دفعة لا وجود لها', 'الدفعةُ على قناة نظيرٍ غير نظير العقد', 'لا إخلال على دفعةٍ لم تقع بعد',
  ]);
  assert.equal(h.s.partnerRisk.breachCount(COMPUTE), 0, 'لا ثقلَ من رفض');
  assert.throws(() => h.s.partnerRisk.bindPayments({ get: () => null }), /PARTNER_RISK_PAYMENT_READER_ALREADY_BOUND/);
});
