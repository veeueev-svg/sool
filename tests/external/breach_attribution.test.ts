/**
 * tests/external/breach_attribution.test.ts — نسبةُ الإخلالِ إلى مُخِلِّه (المرحلة 27 · T-67)
 * يُثبت: لا إخلالَ بلا عقدٍ يُسمّى، والنظيرُ يُستنبَط من السجلِّ لا يُعطى،
 *        وإخلالاتُ عقدٍ بعينه تُقرأ، وحالُ قيامِه يُدوَّن لحظةَ التسجيل،
 *        **والثابت 7 يبقى بحاله**: الوزنُ لا يخفّ ولا يُنسى بالإنهاء ولا بتقديرٍ جديد.
 * يوثّق في: docs/test-reports/phase-27-T67.md
 * الحدّ: هذه أحكامٌ على النسبةِ لا على وزنِ العقوبة — تخفيفُ الوزنِ حكمُ سياسةٍ للمراجع.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITOR, COMPUTE, DAY, KIND_COMPUTE,
  assessRisk, contractState, signContract, terminateContract,
} from './helpers';

/** عقدٌ قائمٌ يصلح أن يُنسب إليه إخلال — ولا عقدَ بلا تقديرٍ قائم */
function liveContract(h: ReturnType<typeof contractState>, value = 3_000_000): string {
  if (h.s.partnerRisk.latest(KIND_COMPUTE, h.now) === null) {
    assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true, 'التقدير شرطُ التوقيع');
  }
  const signed = signContract(h, KIND_COMPUTE, { value });
  assert.equal(signed.ok, true, 'العقد يجب أن يقوم');
  return signed.ok ? signed.contract.contractId : '';
}

test('**إخلالٌ على عقدٍ لا وجودَ له يُرفض برفضٍ مسمًّى** — ولا عقوبةَ بلا مُخِلّ (ثابت 9)', () => {
  const h = contractState();
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, 'extc:9999', 'إخلالٌ بلا عقد', h.now), false);
  const refusals = h.s.audit.find('partner_risk_refused');
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]?.detail.reason, 'لا إخلال على عقد لا وجود له في السجل');
  assert.equal(refusals[0]?.detail.contractId, 'extc:9999', 'الرفضُ يسمّي ما رُفض');
  // ولا يبقى منه أثرٌ مقبول: لا ثقلَ على النظيرِ ولا على أيِّ نوع
  assert.equal(h.s.partnerRisk.breachCount(COMPUTE), 0);
});

test('**معرّفُ نظيرٍ ليس معرّفَ عقد**: الإخلالُ على النظيرِ جملةً يُرفض (ثابت 8)', () => {
  const h = contractState();
  liveContract(h);
  // قبل T-67 كان هذا يمرّ ويُثقل النوعَ كلَّه — والآن يُرفض لأنّ النظيرَ ليس عقدًا
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, COMPUTE, 'إخلالٌ على النظيرِ جملةً', h.now), false);
  assert.equal(h.s.partnerRisk.breachCount(COMPUTE), 0);
  assert.equal(h.s.partnerRisk.effectiveScore(KIND_COMPUTE, h.now), 25, 'لا عقوبةَ مجهولةَ المصدر');
});

test('الإخلالُ يُنسب إلى عقدٍ بعينه، وعقدٌ جارٌ لم يُخِلّ لا يُنسب إليه شيء', () => {
  const h = contractState();
  const first = liveContract(h);
  const second = liveContract(h);
  assert.notEqual(first, second, 'عقدان مستقلّان قائمان معًا');
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, first, 'تسليمٌ غيرُ مطابقٍ في الأوّل', h.now), true);
  assert.equal(h.s.partnerRisk.breachesFor(first).length, 1);
  assert.equal(h.s.partnerRisk.breachesFor(second).length, 0, 'الجارُ البريءُ لا يُنسب إليه إخلال');
  const note = h.s.partnerRisk.breachesFor(first)[0];
  assert.equal(note?.contractId, first);
  assert.equal(note?.counterparty, COMPUTE, 'النظيرُ مستنبَطٌ من العقدِ لا مُعطًى');
  assert.equal(note?.notedBy, AUDITOR);
});

test('قيدُ التدقيقِ يحمل المُخِلَّ وحالَ قيامِه وعدَّ إخلالاتِه — لا النظيرَ وحدَه', () => {
  const h = contractState();
  const contractId = liveContract(h);
  h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'تأخّرُ تسليمٍ موثَّق', h.now);
  const entry = h.s.audit.find('partner_breach_noted').at(-1);
  assert.equal(entry?.detail.contractId, contractId);
  assert.equal(entry?.detail.counterparty, COMPUTE);
  assert.equal(entry?.detail.contractActive, true, 'حالُ قيامِ المُخِلِّ يُدوَّن لحظتَها');
  assert.equal(entry?.detail.contractBreaches, 1);
  assert.equal(entry?.detail.penalty, h.s.contractsConfig.policy.breach_penalty);
});

test('تفصيلُ ثقلِ النظير يقول أيُّ عقدٍ أخلّ وهل هو قائم — سؤالٌ كان بلا جواب', () => {
  const h = contractState();
  const first = liveContract(h);
  const second = liveContract(h);
  h.s.partnerRisk.noteBreach(AUDITOR, first, 'إخلالٌ أوّلُ في الأوّل', h.now);
  h.s.partnerRisk.noteBreach(AUDITOR, first, 'إخلالٌ ثانٍ في الأوّل', h.now);
  h.s.partnerRisk.noteBreach(AUDITOR, second, 'إخلالٌ واحدٌ في الثاني', h.now);
  const breakdown = [...h.s.partnerRisk.breachBreakdown(COMPUTE, h.now)]
    .sort((x, y) => x.contractId.localeCompare(y.contractId));
  assert.deepEqual(breakdown, [
    { contractId: first, breaches: 2, active: true },
    { contractId: second, breaches: 1, active: true },
  ]);
  assert.equal(h.s.partnerRisk.breachCount(COMPUTE), 3, 'والمجموعُ على النظيرِ باقٍ كما هو');
});

test('**الثابت 7 بحاله**: إنهاءُ العقدِ المُخِلِّ لا يُنقص الدرجةَ ولا يُنسي الإخلال', () => {
  const h = contractState();
  const contractId = liveContract(h);
  const penalty = h.s.contractsConfig.policy.breach_penalty;
  h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'إخلالٌ يُنهى العقدُ بعده', h.now);
  assert.equal(h.s.partnerRisk.effectiveScore(KIND_COMPUTE, h.now), 25 + penalty);
  const at = h.now + 1000;
  assert.equal(terminateContract(h, contractId, undefined, at).ok, true);
  assert.equal(h.s.contracts.isActive(contractId, at), false);
  // العلاجُ نسبةٌ لا نسيان: الوزنُ نفسُه، والفرقُ أنّ المُخِلَّ صار يُعرَف
  assert.equal(
    h.s.partnerRisk.effectiveScore(KIND_COMPUTE, at), 25 + penalty,
    'الدرجةُ لا تنقص بإنهاءِ العقدِ المُخِلّ',
  );
  assert.equal(h.s.partnerRisk.breachesFor(contractId).length, 1, 'والإخلالُ باقٍ منسوبًا');
  assert.deepEqual(
    h.s.partnerRisk.breachBreakdown(COMPUTE, at),
    [{ contractId, breaches: 1, active: false }],
    'ويُقرأ أنّه لم يعد قائمًا — لا أنّه لم يكن',
  );
});

test('إخلالٌ بلا بيانٍ يُرفض ولو كان العقدُ قائمًا — وترتيبُ الفحوصِ مُلزم (RULE-006)', () => {
  const h = contractState();
  const contractId = liveContract(h);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'x', h.now), false);
  assert.equal(h.s.partnerRisk.breachesFor(contractId).length, 0);
  assert.equal(
    h.s.audit.find('partner_risk_refused')[0]?.detail.reason, 'لا إخلال يُسجَّل بلا بيان',
    'البيانُ يُفحص قبل وجودِ العقد: فالرفضُ يسمّي أوّلَ ما اختلّ',
  );
});

test('**ربطُ قارئِ العقودِ مرّةً واحدة**: الربطُ الثاني يرمي فلا يُبدَّل مصدرُ الحقيقة', () => {
  const h = contractState();
  assert.throws(
    () => h.s.partnerRisk.bindContracts({ get: () => null, isActive: () => false }),
    /PARTNER_RISK_CONTRACT_READER_ALREADY_BOUND/,
  );
  // وبعد المحاولةِ الفاشلةِ يبقى القارئُ الأصلُ عاملًا: لا حالةَ نصفَ مربوطة
  const contractId = liveContract(h);
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'إخلالٌ بعد محاولةِ ربطٍ ثانية', h.now), true);
  assert.equal(h.s.partnerRisk.breachesFor(contractId).length, 1);
});

test('إخلالٌ يُكتشف بعد انتهاءِ مدّةِ العقد يُسجَّل ويُدوَّن أنّه غيرُ قائم', () => {
  const h = contractState();
  if (h.s.partnerRisk.latest(KIND_COMPUTE, h.now) === null) {
    assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  }
  const signed = signContract(h, KIND_COMPUTE, { value: 3_000_000, days: 10 });
  assert.equal(signed.ok, true);
  if (!signed.ok) return;
  const contractId = signed.contract.contractId;
  const after = h.now + 11 * DAY;
  assert.equal(h.s.contracts.isActive(contractId, after), false, 'انتهت المدّة — لا تجديد ضمني');
  // الإخلالُ يُسجَّل: عقدٌ منتهٍ ليس عقدًا لا وجودَ له، والتأخّرُ في الكشفِ لا يُبرّئ
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, contractId, 'إخلالٌ كُشف متأخّرًا', after), true);
  const entry = h.s.audit.find('partner_breach_noted').at(-1);
  assert.equal(entry?.detail.contractId, contractId);
  assert.equal(
    entry?.detail.contractActive, false,
    'حالُ القيامِ يُقاس لحظةَ التسجيل لا يُفترض قائمًا',
  );
  assert.equal(h.s.partnerRisk.breachesFor(contractId).length, 1);
});
