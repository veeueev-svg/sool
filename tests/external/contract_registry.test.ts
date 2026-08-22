/**
 * tests/external/contract_registry.test.ts — سجل العقود الخارجية (المرحلة 27)
 * يُثبت: لا عقد بلا تاريخ انتهاء، ولا عقد يتجاوز قناته أو سقف نوعه أو سقف قناته،
 *        ولا عقد بلا تقدير مخاطر مقبول، ولا عقد على قناة غير قائمة، وباب واحد للإنهاء.
 * يوثّق في: docs/test-reports/phase-27.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE, COMPUTE, DAY, FINANCE, FOREIGN, KIND_ARCHIVE, KIND_COMPUTE, KIND_WEIGHTS,
  REGISTRY, assessRisk, beat, contractState, signContract, terminateContract,
} from './helpers';

test('عقد معلن يُوقَّع بأمر ملكي ويُسجَّل بقيمته وانتهائه ودرجة مخاطره', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, ['single_source']).ok, true);
  const signed = signContract(h, KIND_COMPUTE, { value: 5_000_000, days: 30 });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  assert.equal(signed.contract.counterparty, COMPUTE);
  assert.equal(signed.contract.value, 5_000_000);
  assert.equal(signed.contract.endsAt, h.now + 30 * DAY);
  assert.equal(signed.contract.riskScore, 40, 'الدرجة الفعلية محفوظة في العقد');
  assert.equal(h.s.contracts.isActive(signed.contract.contractId, h.now), true);
  const logged = h.s.audit.find('external_contract_signed');
  assert.equal(logged.length, 1);
  assert.equal(
    (logged[0]?.detail as { assessmentId: string }).assessmentId,
    signed.contract.assessmentId,
    'العقد يشير إلى التقدير الذي قام عليه',
  );
});

test('**عقد بلا تاريخ انتهاء يُرفض** — شرط قبول المرحلة 27', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  for (const endsAt of [0, Number.NaN, h.now + 0.5]) {
    const refused = h.s.contracts.sign(h.royalOpen(KIND_COMPUTE), {
      kindId: KIND_COMPUTE, value: 1_000_000, endsAt,
      proposedBy: FOREIGN, purpose: 'عقد بلا نهاية معلنة',
    }, h.now);
    assert.equal(refused.ok, false, `قُبل عقد بتاريخ انتهاء: ${String(endsAt)}`);
    assert.match(refused.ok ? '' : refused.reason, /بلا تاريخ انتهاء صالح/);
  }
  assert.equal(h.s.contracts.list().length, 0, 'لا عقد قام من هذه المحاولات');
});

test('عقد بتاريخ انتهاء ماضٍ أو مساوٍ للحظة يُرفض — لا عقد وُلد منتهيًا', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  assert.equal(signContract(h, KIND_COMPUTE, { endsAt: h.now - DAY }).ok, false);
  assert.equal(signContract(h, KIND_COMPUTE, { endsAt: h.now }).ok, false);
});

test('مدة تتجاوز الحدّ المعلن للعقود تُرفض ولا تُقرَّب', () => {
  const h = contractState({ accountTermDays: 90 });
  assert.equal(assessRisk(h).ok, true);
  const max = h.s.contractsConfig.policy.max_term_days;
  const refused = signContract(h, KIND_COMPUTE, { days: max + 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /تتجاوز الحدّ المعلن/);
  assert.equal(signContract(h, KIND_COMPUTE, { days: max }).ok, true, 'الحدّ نفسه مقبول');
});

test('**عقد ينتهي بعد انتهاء حسابه يُرفض** — لا التزام بلا قناة تنفّذه', () => {
  const h = contractState({ accountTermDays: 30 });
  assert.equal(assessRisk(h).ok, true);
  const refused = signContract(h, KIND_COMPUTE, { days: 45 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /بعد انتهاء الحساب الخارجي/);
  assert.equal(signContract(h, KIND_COMPUTE, { days: 29 }).ok, true);
});

test('نوع عقد غير معلن يُرفض — التوقيع لا يُنشئ نوعًا (RULE-005)', () => {
  const h = contractState();
  const refused = h.s.contracts.sign(h.royalOpen('contract:مُختلق'), {
    kindId: 'contract:مُختلق', value: 1_000_000, endsAt: h.now + 10 * DAY,
    proposedBy: FOREIGN, purpose: 'نوع لم يُعلن',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /غير معلن في التهيئة/);
});

test('الاقتراح لوزارة الخارجية وحدها، والغرض معلن (RULE-004 و RULE-006)', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const byFinance = h.s.contracts.sign(h.royalOpen(KIND_COMPUTE), {
    kindId: KIND_COMPUTE, value: 1_000_000, endsAt: h.now + 10 * DAY,
    proposedBy: FINANCE, purpose: 'وزارة المالية تقترح عقدًا',
  }, h.now);
  assert.equal(byFinance.ok, false);
  assert.match(byFinance.ok ? '' : byFinance.reason, /وزارة الخارجية وحدها/);
  const noPurpose = h.s.contracts.sign(h.royalOpen(KIND_COMPUTE), {
    kindId: KIND_COMPUTE, value: 1_000_000, endsAt: h.now + 10 * DAY,
    proposedBy: FOREIGN, purpose: ' ',
  }, h.now);
  assert.equal(noPurpose.ok, false);
  assert.match(noPurpose.ok ? '' : noPurpose.reason, /غرض معلن/);
});

test('قيمة تتجاوز سقف النوع المعلن تُرفض', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const cap = h.s.contractsConfig.kinds.find((k) => k.id === KIND_COMPUTE)?.max_value as number;
  const refused = signContract(h, KIND_COMPUTE, { value: cap + 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /سقف نوعه المعلن/);
  assert.equal(signContract(h, KIND_COMPUTE, { value: cap }).ok, true, 'السقف نفسه مقبول');
});

test('قيمة غير صالحة (صفر أو سالبة أو كسرية) تُرفض', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  for (const value of [0, -1, 1_000_000.5]) {
    assert.equal(signContract(h, KIND_COMPUTE, { value }).ok, false, `قُبلت قيمة ${value}`);
  }
});

test('**لا عقد بلا تقدير مخاطر قائم** — ولا افتراض سلامة', () => {
  const h = contractState();
  const refused = signContract(h, KIND_COMPUTE);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /لا تقدير مخاطر قائم/);
});

test('تقدير بالٍ لا يُوقَّع عليه عقد', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const interval = h.s.contractsConfig.policy.review_interval_days;
  const later = h.now + (interval + 1) * DAY;
  beat(h, later);
  const refused = signContract(h, KIND_COMPUTE, { at: later, days: 10 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /بالٍ/);
});

test('درجة مخاطر فوق السقف تمنع العقد ولو صحّ كل ما عداه', () => {
  const h = contractState({ counterparty: REGISTRY });
  assert.equal(assessRisk(h, KIND_WEIGHTS, ['model_access']).ok, true);
  const refused = signContract(h, KIND_WEIGHTS, { value: 1_000_000 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /تتجاوز السقف المعلن/);
  // ويكفي أن يزول العامل حتى تُقبل الدرجة: 40 ≤ 60
  assert.equal(assessRisk(h, KIND_WEIGHTS, [], h.now + 1000).ok, true);
  assert.equal(signContract(h, KIND_WEIGHTS, { value: 1_000_000, at: h.now + 1000 }).ok, true);
});

test('لا عقد على قناة غير مفتوحة أصلًا', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  const refused = signContract(h, KIND_ARCHIVE, { value: 1_000_000 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /قناة غير قائمة/);
});

test('لا عقد على حساب معلَّق — التعليق أسبق من كل فحص تعاقدي', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  assert.equal(
    h.s.externalAccounts.suspend('authority:crown_guard', COMPUTE, 'احتواء معلن', h.now).ok,
    true,
  );
  const refused = signContract(h, KIND_COMPUTE);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /معلَّق/);
});

test('عدد العقود القائمة لنظير واحد لا يتجاوز الحدّ المعلن', () => {
  const h = contractState({ counterparty: ARCHIVE });
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  const max = h.s.contractsConfig.policy.max_open_per_counterparty;
  for (let i = 0; i < max; i += 1) {
    assert.equal(signContract(h, KIND_ARCHIVE, { value: 6_000_000 }).ok, true, `العقد ${i + 1}`);
  }
  const extra = signContract(h, KIND_ARCHIVE, { value: 1_000_000 });
  assert.equal(extra.ok, false);
  assert.match(extra.ok ? '' : extra.reason, /بلغ الحدّ المعلن/);
  assert.equal(h.s.contracts.activeFor(ARCHIVE, h.now).length, max);
});

test('**مجموع قيم العقود القائمة لا يتجاوز السقف الكلي للحساب**', () => {
  const h = contractState({ counterparty: ARCHIVE });
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  assert.equal(signContract(h, KIND_ARCHIVE, { value: 8_000_000 }).ok, true);
  assert.equal(signContract(h, KIND_ARCHIVE, { value: 8_000_000 }).ok, true);
  assert.equal(h.s.contracts.committedValue(ARCHIVE, h.now), 16_000_000);
  // سقف قناة الأرشيف المعلن 20,000,000 — والثالث يتجاوزه ولو لم يبلغ حدّ العدد
  const refused = signContract(h, KIND_ARCHIVE, { value: 8_000_000 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /السقف الكلي للحساب/);
  assert.equal(signContract(h, KIND_ARCHIVE, { value: 4_000_000 }).ok, true, 'ما يدخل السقف يُقبل');
});

test('العقد المُنهى لا يشغل سقفًا — والمنتهي كذلك', () => {
  const h = contractState({ counterparty: ARCHIVE });
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  const first = signContract(h, KIND_ARCHIVE, { value: 8_000_000 });
  assert.equal(signContract(h, KIND_ARCHIVE, { value: 8_000_000 }).ok, true);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(terminateContract(h, first.contract.contractId).ok, true);
  assert.equal(h.s.contracts.committedValue(ARCHIVE, h.now), 8_000_000);
  // ولا يُوقَّع عقد جديد على قناة عُلِّقت بالإنهاء إلا بعد استئنافها (ثابت 3 للمرحلة 26)
  const refused = signContract(h, KIND_ARCHIVE, { value: 8_000_000 });
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /معلَّق/);
});

test('الأمر بغير فعله أو بغير هدفه يُرفض', () => {
  const h = contractState();
  assert.equal(assessRisk(h).ok, true);
  const wrongAction = h.s.contracts.sign(h.royal(KIND_COMPUTE), {
    kindId: KIND_COMPUTE, value: 1_000_000, endsAt: h.now + 10 * DAY,
    proposedBy: FOREIGN, purpose: 'أمر بفعل غير الفعل',
  }, h.now);
  assert.equal(wrongAction.ok, false);
  assert.match(wrongAction.ok ? '' : wrongAction.reason, /open_external_account وحده/);
  const wrongTarget = h.s.contracts.sign(h.royalOpen(KIND_ARCHIVE), {
    kindId: KIND_COMPUTE, value: 1_000_000, endsAt: h.now + 10 * DAY,
    proposedBy: FOREIGN, purpose: 'أمر بهدف نوع آخر',
  }, h.now);
  assert.equal(wrongTarget.ok, false);
  assert.match(wrongTarget.ok ? '' : wrongTarget.reason, /لا يطابق معرّف نوع العقد/);
});

test('**لا باب ثانٍ للإنهاء**: صلاحية الإنهاء لا تُمنح مرتين', () => {
  const h = contractState();
  assert.throws(
    () => h.s.contracts.grantTerminationCapability('authority:crown_guard'),
    /لا باب ثانٍ للإنهاء/,
  );
});

test('تقرير العقود يطابق ما وقع فعلًا لا ما نُوي', () => {
  const h = contractState({ counterparty: ARCHIVE });
  assert.equal(assessRisk(h, KIND_ARCHIVE, []).ok, true);
  const a = signContract(h, KIND_ARCHIVE, { value: 3_000_000 });
  assert.equal(signContract(h, KIND_ARCHIVE, { value: 4_000_000 }).ok, true);
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(terminateContract(h, a.contract.contractId).ok, true);
  const report = h.s.contracts.report(h.now);
  assert.equal(report.signed, 2);
  assert.equal(report.active, 1);
  assert.equal(report.terminated, 1);
  assert.equal(report.committedValue, 4_000_000);
  assert.equal(
    report.maxTermMs, h.s.contractsConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    'المدة القصوى مقروءة من التهيئة لا من الكود',
  );
});
