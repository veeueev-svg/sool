/**
 * tests/external/external_contracts_lifecycle.test.ts — معيار قبول المرحلة 27
 * شرط القبول المعلن في ROADMAP.md: «عقد بلا تاريخ انتهاء يُرفض + إنهاء فوري بأمر ملكي»
 * وتُثبَت معه لوازمه: الإنهاء يقطع قناة المال في اللحظة، ولا يُسقط التزامًا، ومن أنهى
 * لا يُسوّي، وما لم يُسوَّ يُرفع، والتهيئة مصدرٌ وحيد، والإقلاع بلا عقد موقَّع.
 * يوثّق في: docs/test-reports/phase-27.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import {
  ARCHIVE, COMPUTE, CROWN_GUARD, CYBER, DAY, FINANCE, FOREIGN, HOUR,
  KIND_ARCHIVE, KIND_COMPUTE, assessRisk, beat, contractState, signContract, terminateContract,
} from './helpers';

/** يوقّع عقدًا جاهزًا: تقدير مخاطر ثم توقيع ملكي — الطريق المعلن وحده */
function readyContract(h: ReturnType<typeof contractState>, days = 30) {
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 5_000_000, days });
  assert.equal(signed.ok, true);
  if (!signed.ok) throw new Error('تعذّر توقيع العقد المرجعي');
  return signed.contract;
}

test('قبول 1: **عقد بلا تاريخ انتهاء يُرفض** بسببه المعلن ولا يقوم منه شيء', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const refused = h.s.contracts.sign(h.royalOpen(KIND_COMPUTE), {
    kindId: KIND_COMPUTE, value: 5_000_000, endsAt: 0,
    proposedBy: FOREIGN, purpose: 'التزام مفتوح بلا نهاية',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /بلا تاريخ انتهاء صالح مرفوض/);
  assert.equal(h.s.contracts.report(h.now).signed, 0);
  const logged = h.s.audit.find('external_contract_refused');
  assert.equal(logged.length, 1, 'الرفض قيدٌ في السجل لا صمت');
  assert.match((logged[0]?.detail as { reason: string }).reason, /تاريخ انتهاء/);
});

test('قبول 2: **الإنهاء فوري بأمر ملكي** — العقد غير قائم في اللحظة نفسها', () => {
  const h = contractState();
  const contract = readyContract(h);
  const moment = h.now + 5 * HOUR;
  beat(h, moment);
  assert.equal(h.s.contracts.isActive(contract.contractId, moment), true, 'قائم قبل اللحظة');
  const done = terminateContract(h, contract.contractId, CROWN_GUARD, moment);
  assert.equal(done.ok, true);
  // فوريّة الأثر: لا مدة سماح ولا نفاذ مؤجَّل — الفحص عند `moment` نفسه
  assert.equal(h.s.contracts.isActive(contract.contractId, moment), false);
  assert.match(h.s.contracts.inactiveReason(contract.contractId, moment) ?? '', /مُنهًى/);
  const logged = h.s.audit.find('contract_termination_executed');
  assert.equal(logged.length, 1);
  const detail = logged[0]?.detail as { immediate: boolean; at: number };
  assert.equal(detail.immediate, true);
  assert.equal(detail.at, moment, 'الأثر مسجَّل بلحظته لا بلحظة لاحقة');
});

test('قبول 3: لا إنهاء بلا أمر ملكي صحيح الفعل والهدف والجهة', () => {
  const h = contractState();
  const contract = readyContract(h);
  // أمر بفعل آخر
  const wrongAction = h.s.contractTermination.terminate(
    h.royal(contract.contractId), contract.contractId, CROWN_GUARD, 'إنهاء بفعل غير الفعل', h.now,
  );
  assert.equal(wrongAction.ok, false);
  assert.match(wrongAction.ok ? '' : wrongAction.reason, /open_external_account وحده/);
  // أمر بهدف غير معرّف العقد
  const wrongTarget = h.s.contractTermination.terminate(
    h.royalOpen(KIND_COMPUTE), contract.contractId, CROWN_GUARD, 'إنهاء بهدف النوع', h.now,
  );
  assert.equal(wrongTarget.ok, false);
  assert.match(wrongTarget.ok ? '' : wrongTarget.reason, /لا يطابق معرّف العقد/);
  // جهة غير معلنة، وسبب غائب
  const wrongBy = terminateContract(h, contract.contractId, 'agent:worker-1');
  assert.equal(wrongBy.ok, false);
  assert.match(wrongBy.ok ? '' : wrongBy.reason, /جهة معلنة في التهيئة وحدها/);
  const noReason = terminateContract(h, contract.contractId, CROWN_GUARD, h.now, ' ');
  assert.equal(noReason.ok, false);
  assert.match(noReason.ok ? '' : noReason.reason, /سبب معلن/);
  assert.equal(h.s.contracts.isActive(contract.contractId, h.now), true, 'العقد باقٍ قائمًا');
});

test('قبول 4: **الإنهاء يقطع قناة المال في اللحظة نفسها**', () => {
  const h = contractState();
  const contract = readyContract(h);
  const moment = h.now + 2 * HOUR;
  beat(h, moment);
  const before = h.s.payments.pay({
    accountId: COMPUTE, amount: 500_000, line: 'budget:foreign',
    purpose: 'سعة حوسبة قبل الإنهاء', requestedBy: FOREIGN,
  }, moment);
  assert.equal(before.ok, true, 'الدفع قائم قبل الإنهاء');
  assert.equal(terminateContract(h, contract.contractId, CROWN_GUARD, moment).ok, true);
  assert.equal(h.s.externalAccounts.isActive(COMPUTE, moment), false, 'الحساب معلَّق باللحظة');
  const after = h.s.payments.pay({
    accountId: COMPUTE, amount: 500_000, line: 'budget:foreign',
    purpose: 'محاولة دفع بعد الإنهاء', requestedBy: FOREIGN,
  }, moment);
  assert.equal(after.ok, false);
  assert.match(after.ok ? '' : after.reason, /معلَّق/);
  const detail = h.s.audit.find('contract_termination_executed').at(-1)?.detail as {
    accountSuspended: boolean;
  };
  assert.equal(detail.accountSuspended, true);
});

test('قبول 5: لا إنهاء مرتين، ولا إنهاء لعقد انتهت مدته', () => {
  const h = contractState();
  const contract = readyContract(h, 30);
  assert.equal(terminateContract(h, contract.contractId).ok, true);
  const again = terminateContract(h, contract.contractId, CYBER);
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /مُنهًى سابقًا/);

  const other = contractState({ counterparty: ARCHIVE });
  assert.equal(assessRisk(other, KIND_ARCHIVE, []).ok, true);
  const short = signContract(other, KIND_ARCHIVE, { value: 1_000_000, days: 10 });
  assert.equal(short.ok, true);
  if (!short.ok) return;
  const after = other.now + 11 * DAY;
  beat(other, after);
  const expired = terminateContract(other, short.contract.contractId, CROWN_GUARD, after);
  assert.equal(expired.ok, false);
  assert.match(expired.ok ? '' : expired.reason, /انتهت مدته/);
});

test('قبول 6: **الإنهاء لا يُسقط التزامًا** — نافذة تسوية تُفتح ولا تُغلق على معلَّق', () => {
  const h = contractState();
  const contract = readyContract(h);
  const moment = h.now + 3 * HOUR;
  beat(h, moment);
  const paid = h.s.payments.pay({
    accountId: COMPUTE, amount: 400_000, line: 'budget:foreign',
    purpose: 'التزام قائم لم يُقرّ استلامه', requestedBy: FOREIGN,
  }, moment);
  assert.equal(paid.ok, true);
  if (!paid.ok) return;
  assert.equal(terminateContract(h, contract.contractId, CROWN_GUARD, moment).ok, true);

  const record = h.s.contractTermination.settlement(contract.contractId);
  assert.notEqual(record, null);
  assert.equal(record?.obligationsAtTermination, 1, 'الالتزام محفوظ في نافذة التسوية');
  assert.equal(
    record?.dueAt,
    moment + h.s.contractsConfig.policy.settlement_window_hours * HOUR,
    'مدة التسوية مقروءة من التهيئة',
  );
  const early = h.s.contractTermination.settle(
    contract.contractId, FINANCE, 'مرجع-تسوية-1', moment,
  );
  assert.equal(early.ok, false);
  assert.match(early.ok ? '' : early.reason, /لم يُثبَت استلامه/);
  // وبعد إقرار الاستلام تصحّ التسوية
  assert.equal(h.s.payments.confirm(paid.payment.paymentId, FOREIGN, 'RCV-2026-0001', moment).ok, true);
  const settled = h.s.contractTermination.settle(
    contract.contractId, FINANCE, 'مرجع-تسوية-نهائية', moment,
  );
  assert.equal(settled.ok, true);
  assert.equal(h.s.contractTermination.report(moment).settled, 1);
});

test('قبول 7: **من أنهى لا يُسوّي**، والتسوية بوزارة المالية وبمرجع إثبات', () => {
  const h = contractState();
  const contract = readyContract(h);
  assert.equal(terminateContract(h, contract.contractId, CROWN_GUARD).ok, true);
  const byTerminator = h.s.contractTermination.settle(
    contract.contractId, CROWN_GUARD, 'مرجع-من-أنهى', h.now,
  );
  assert.equal(byTerminator.ok, false);
  assert.match(byTerminator.ok ? '' : byTerminator.reason, /من أنهى العقد/);
  const byForeign = h.s.contractTermination.settle(
    contract.contractId, FOREIGN, 'مرجع-من-اقترح', h.now,
  );
  assert.equal(byForeign.ok, false);
  assert.match(byForeign.ok ? '' : byForeign.reason, /وزارة المالية وحدها/);
  const weakEvidence = h.s.contractTermination.settle(contract.contractId, FINANCE, 'قصير', h.now);
  assert.equal(weakEvidence.ok, false);
  assert.match(weakEvidence.ok ? '' : weakEvidence.reason, /مرجع إثبات معلن/);
  const done = h.s.contractTermination.settle(
    contract.contractId, FINANCE, 'مرجع-تسوية-موثَّق', h.now,
  );
  assert.equal(done.ok, true);
  const again = h.s.contractTermination.settle(
    contract.contractId, FINANCE, 'مرجع-تسوية-ثانٍ', h.now,
  );
  assert.equal(again.ok, false);
  assert.match(again.ok ? '' : again.reason, /لا تسوية مرتين/);
});

test('قبول 8: ما لم يُسوَّ داخل نافذته يُرفع متأخرًا — بلا عقوبة ومرة واحدة', () => {
  const h = contractState();
  const contract = readyContract(h);
  assert.equal(terminateContract(h, contract.contractId).ok, true);
  const window = h.s.contractsConfig.policy.settlement_window_hours;
  const inside = h.now + (window - 1) * HOUR;
  beat(h, inside);
  assert.equal(h.s.contractTermination.raiseUnsettled(inside).length, 0, 'لا رفع قبل الاستحقاق');
  const outside = h.now + (window + 1) * HOUR;
  beat(h, outside);
  const raised = h.s.contractTermination.raiseUnsettled(outside);
  assert.equal(raised.length, 1);
  assert.equal(raised[0]?.contractId, contract.contractId);
  assert.equal(h.s.contractTermination.raiseUnsettled(outside).length, 0, 'لا رفع مرتين');
  const logged = h.s.audit.find('contract_settlement_overdue');
  assert.equal(logged.length, 1);
  assert.match((logged[0]?.detail as { penalty: string }).penalty, /لا عقوبة/);
  assert.equal(h.s.contractTermination.report(outside).overdue, 1);
});

test('قبول 9: أمر ملكي واحد يُنهي كل العقود ويُغلق الخارج كلّه في اللحظة', () => {
  const h = contractState();
  const first = readyContract(h);
  // قناة ثانية: أرشيف بحساب مفتوح وتقدير مقبول
  assert.equal(
    h.s.externalAccounts.open(h.royalOpen(ARCHIVE), {
      counterparty: ARCHIVE, expiresAt: h.now + 90 * DAY, requestedBy: FOREIGN,
      justification: 'قناة أرشفة معلنة',
    }, h.now).ok,
    true,
  );
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  const second = signContract(h, KIND_ARCHIVE, { value: 2_000_000, days: 20 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(h.s.contracts.active(h.now).length, 2);

  const decision = h.s.contractTermination.terminateAll(
    h.royalOpen('contract:all'), CROWN_GUARD, 'انقطاع معلن عن الخارج', h.now,
  );
  assert.equal(decision.allowed, true);
  assert.equal(h.s.contracts.active(h.now).length, 0);
  assert.equal(h.s.contracts.isActive(first.contractId, h.now), false);
  assert.equal(h.s.externalAccounts.active(h.now).length, 0, 'لا قناة مفتوحة على عقد ساقط');
  const logged = h.s.audit.find('contracts_terminated_all');
  assert.equal((logged.at(-1)?.detail as { count: number }).count, 2);
  assert.equal(h.s.contractTermination.report(h.now).terminated, 2, 'لكل عقد نافذة تسوية');
});

test('قبول 10: التهيئة مصدرٌ وحيد، والإقلاع بلا عقد موقَّع، والدورة كلها في السجل', () => {
  const boot = bootstrapState({ now: Date.now() });
  assert.equal(boot.contracts.list().length, 0, 'الإقلاع لا يوقّع عقدًا — التوقيع فعل ملكي');
  assert.equal(boot.partnerRisk.history().length, 0);
  assert.equal(
    boot.partnerRisk.declaredKinds().length, boot.contractsConfig.kinds.length,
    'أنواع العقود من التهيئة لا من الكود',
  );
  assert.equal(boot.audit.snapshot().at(-1)?.kind, 'state_online', 'خاتمة التأسيس لم تتغيّر');
  assert.equal(boot.audit.find('contract_termination_channel_bound').length, 1, 'باب إنهاء واحد');
  assert.equal(boot.audit.verifyIntegrity().valid, true);

  const h = contractState();
  const contract = readyContract(h);
  assert.equal(terminateContract(h, contract.contractId).ok, true);
  assert.equal(
    h.s.contractTermination.settle(contract.contractId, FINANCE, 'مرجع-تسوية-الدورة', h.now).ok,
    true,
  );
  const kinds = h.s.audit.snapshot().map((e) => e.kind);
  // الترتيب المُثبَت: القيد يسبق قطع القناة، وقطع القناة يسبق قيد قرار الإنهاء —
  // فلا يُقرأ من السجل أن قرارًا نفذ قبل أن يُقطع ما يجب قطعه
  const order = [
    'partner_risk_assessed', 'external_contract_signed', 'external_contract_terminated',
    'external_account_suspended', 'contract_termination_executed',
    'contract_settlement_recorded',
  ];
  let cursor = -1;
  for (const kind of order) {
    const at = kinds.indexOf(kind, cursor + 1);
    assert.notEqual(at, -1, `السجل بلا قيد: ${kind}`);
    assert.ok(at > cursor, `القيد خارج ترتيبه: ${kind}`);
    cursor = at;
  }
  assert.equal(h.s.audit.verifyIntegrity().valid, true, 'سلسلة السجل سليمة بعد الدورة كلها');
});
