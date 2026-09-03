/**
 * tests/external/partner_risk.test.ts — تقدير مخاطر الشريك الخارجي (المرحلة 27)
 * يُثبت: الدرجة من إعلان لا من رأي، ومن يقترح لا يقدّر، والتقدير يبلى،
 *        والسقف من التهيئة، والإخلال يُثقل الدرجة ولا يُنسى، ولا افتراض سلامة.
 * يوثّق في: docs/test-reports/phase-27.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITOR, DAY, FOREIGN, KIND_ARCHIVE, KIND_COMPUTE, KIND_WEIGHTS,
  assessRisk, beat, contractState, signContract,
} from './helpers';

/**
 * T-67: لا إخلال إلا على عقدٍ يُسمّى — فيُوقَّع عقدٌ قائمٌ ثم يُنسب إليه.
 * ولا عقدَ بلا تقديرٍ قائم (لا افتراض سلامة)، فيُقدَّر أوّلًا إن لم يكن ثمّ تقدير.
 */
function breachingContract(h: ReturnType<typeof contractState>, kindId = KIND_COMPUTE): string {
  if (h.s.partnerRisk.latest(kindId, h.now) === null) {
    assert.equal(assessRisk(h, kindId, []).ok, true, 'التقدير شرطُ التوقيع');
  }
  const signed = signContract(h, kindId, { value: 3_000_000 });
  assert.equal(signed.ok, true, 'العقد المُخِلّ يجب أن يقوم أوّلًا');
  return signed.ok ? signed.contract.contractId : '';
}

test('الدرجة تُحسب من وزن النوع المعلن وحده حين لا عوامل', () => {
  const h = contractState();
  const done = assessRisk(h, KIND_COMPUTE, []);
  assert.equal(done.ok, true);
  if (!done.ok) return;
  // 25 هو وزن نوع عقد الحوسبة المعلن في config/contracts.yaml — لا رقم في الكود
  assert.equal(done.assessment.score, 25);
  assert.equal(h.s.partnerRisk.effectiveScore(KIND_COMPUTE, h.now), 25);
});

test('العوامل المعلنة تُجمع على وزن النوع — والحساب مقروء من التهيئة', () => {
  const h = contractState();
  const done = assessRisk(h, KIND_COMPUTE, ['single_source']);
  assert.equal(done.ok, true);
  if (!done.ok) return;
  const weight = h.s.contractsConfig.risk_factors['single_source'] as number;
  const base = h.s.contractsConfig.kinds.find((k) => k.id === KIND_COMPUTE)?.risk_weight as number;
  assert.equal(done.assessment.score, base + weight);
  assert.deepEqual([...done.assessment.factors], ['single_source']);
});

test('**عامل مخاطر غير معلن يُرفض التقديرُ كلّه لأجله** — لا وزن بالحدس (فشل مغلق)', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: ['single_source', 'خطر_لم_يُعلن'],
    assessedBy: AUDITOR, justification: 'تقدير بعامل مُختلق',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /غير معلن في التهيئة/);
  // ولا يبقى منه أثر مقبول: لا تقدير قائم، فلا عقد
  assert.equal(h.s.partnerRisk.latest(KIND_COMPUTE, h.now), null);
  assert.equal(h.s.partnerRisk.isAcceptable(KIND_COMPUTE, h.now), false);
  assert.equal(h.s.audit.find('partner_risk_refused').length, 1);
});

test('عامل مكرَّر يُرفض — التكرار يضخّم الدرجة بلا معنى', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: ['data_egress', 'data_egress'],
    assessedBy: AUDITOR, justification: 'تكرار العامل نفسه',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /مكرَّر/);
});

test('**من يقترح العقد لا يقدّر مخاطره** (RULE-004)', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: FOREIGN,
    justification: 'وزارة الخارجية تقدّر مخاطر عقدها',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /لا يقدّر مخاطرَ العقد مقترحُه/);
});

test('جهة ثالثة غير ديوان التدقيق لا تقدّر', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: 'ministry:cyber_security',
    justification: 'جهة غير مخوَّلة بالتقدير',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /ديوان التدقيق وحده/);
});

test('نوع عقد غير معلن يُرفض تقديره — التقدير لا يُنشئ نوعًا (RULE-005)', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: 'contract:مُختلق', factors: [], assessedBy: AUDITOR,
    justification: 'نوع لم يُعلن في التهيئة',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /غير معلن في التهيئة/);
});

test('لا تقدير بلا مبرّر معلن (RULE-006)', () => {
  const h = contractState();
  const refused = h.s.partnerRisk.assess({
    kindId: KIND_COMPUTE, factors: [], assessedBy: AUDITOR, justification: ' ',
  }, h.now);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.reason, /مبرّر معلن/);
});

test('**التقدير يبلى** بمضي مدة المراجعة المعلنة — والبالي ليس تقديرًا', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  const interval = h.s.contractsConfig.policy.review_interval_days;
  const later = h.now + (interval + 1) * DAY;
  beat(h, later);
  assert.equal(h.s.partnerRisk.latest(KIND_COMPUTE, later), null);
  assert.equal(h.s.partnerRisk.effectiveScore(KIND_COMPUTE, later), null);
  assert.match(
    h.s.partnerRisk.unacceptableReason(KIND_COMPUTE, later) ?? '', /بالٍ/,
  );
  assert.deepEqual([...h.s.partnerRisk.staleKinds(later)], [KIND_COMPUTE]);
  // ولا يُمحى من السجل: البالي يبقى مقروءًا للتدقيق (ثابت 6)
  assert.equal(h.s.partnerRisk.history(KIND_COMPUTE).length, 1);
});

test('درجة فوق السقف **تُسجَّل** ثم يُمنع العقدُ لأجلها — لا تُخفى بإسقاطها', () => {
  const h = contractState();
  // أوزان معلنة: نوع الأوزان 40 + إتاحة النموذج 25 = 65 > السقف 60
  const done = assessRisk(h, KIND_WEIGHTS, ['model_access']);
  assert.equal(done.ok, true, 'التقدير السيّئ يُسجَّل ولا يُرفض تسجيله');
  if (!done.ok) return;
  assert.equal(done.assessment.score, 65);
  assert.equal(h.s.partnerRisk.isAcceptable(KIND_WEIGHTS, h.now), false);
  assert.match(
    h.s.partnerRisk.unacceptableReason(KIND_WEIGHTS, h.now) ?? '', /تتجاوز السقف المعلن 60/,
  );
  const logged = h.s.audit.find('partner_risk_assessed');
  assert.equal((logged.at(-1)?.detail as { acceptable: boolean }).acceptable, false);
});

test('لا تقدير ⇒ لا قبول: «لا تقدير» ليست «مخاطرة صفرًا»', () => {
  const h = contractState();
  assert.equal(h.s.partnerRisk.isAcceptable(KIND_ARCHIVE, h.now), false);
  assert.match(
    h.s.partnerRisk.unacceptableReason(KIND_ARCHIVE, h.now) ?? '', /لا افتراض سلامة/,
  );
});

test('**الإخلال يُثقل الدرجة ولا يُنسى**: ثلاثة إخلالات ترفع المقبول إلى مرفوض', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  assert.equal(h.s.partnerRisk.isAcceptable(KIND_COMPUTE, h.now), true);
  const penalty = h.s.contractsConfig.policy.breach_penalty;
  const contractId = breachingContract(h);
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(
      h.s.partnerRisk.noteBreach(AUDITOR, contractId, `إخلال موثَّق ${i}`, h.now),
      true,
    );
  }
  assert.equal(h.s.partnerRisk.effectiveScore(KIND_COMPUTE, h.now), 25 + 3 * penalty);
  assert.equal(h.s.partnerRisk.isAcceptable(KIND_COMPUTE, h.now), false);
  assert.equal(h.s.audit.find('partner_breach_noted').length, 3);
  // T-67: والثلاثةُ منسوبةٌ إلى مُخِلٍّ يُسمّى لا إلى النظيرِ جملةً
  assert.equal(h.s.partnerRisk.breachesFor(contractId).length, 3);
});

test('تقدير جديد لا يمحو تاريخ الإخلال — لا عودة إلى الدرجة الأولى', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  h.s.partnerRisk.noteBreach(AUDITOR, breachingContract(h), 'تسليم غير مطابق', h.now);
  const fresh = assessRisk(h, KIND_COMPUTE, [], h.now + 1000);
  assert.equal(fresh.ok, true);
  if (!fresh.ok) return;
  assert.equal(fresh.assessment.score, 25, 'التقدير الجديد يقيس النوع لا التاريخ');
  const penalty = h.s.contractsConfig.policy.breach_penalty;
  assert.equal(
    h.s.partnerRisk.effectiveScore(KIND_COMPUTE, h.now + 1000), 25 + penalty,
    'الدرجة الفعلية تحمل الإخلال ولو تجاهله التقدير',
  );
  assert.equal(h.s.partnerRisk.history(KIND_COMPUTE).length, 2, 'القديم باقٍ والأحدث يُقرأ');
});

test('إخلال بلا بيان يُرفض تسجيله (RULE-006)', () => {
  const h = contractState();
  assert.equal(h.s.partnerRisk.noteBreach(AUDITOR, breachingContract(h), 'x', h.now), false);
  assert.equal(h.s.partnerRisk.breachCount('external:compute-provider'), 0);
});

test('تقرير المخاطر يطابق ما في التهيئة وما وقع فعلًا', () => {
  const h = contractState();
  assert.equal(assessRisk(h, KIND_COMPUTE, []).ok, true);
  assert.equal(assessRisk(h, KIND_WEIGHTS, ['model_access']).ok, true);
  const report = h.s.partnerRisk.report(h.now);
  assert.equal(report.kinds, h.s.contractsConfig.kinds.length);
  assert.equal(report.assessments, 2);
  assert.equal(report.acceptable, 1, 'المقبول واحد: الحوسبة — والأوزان فوق السقف');
  assert.equal(report.stale, 0);
  assert.equal(report.maxScore, h.s.contractsConfig.policy.max_risk_score);
  assert.equal(report.breachPenalty, h.s.contractsConfig.policy.breach_penalty);
});
