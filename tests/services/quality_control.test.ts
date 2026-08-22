/**
 * tests/services/quality_control.test.ts — اختبارات مراقبة جودة المختبر (المرحلة 29)
 * المالك: ديوان التدقيق؛ لا بشر او بيانات شخصية، بل نتائج وحدات برمجية لوكلاء مسجلين
 * المدخلات: نتيجة معلقة مقيدة بحقائقها وفحوص معلنة باوزان
 * المخرجات: قرار قبول او رفض مسجل، ولا اعتماد من يد الاجراء
 * ثوابت هذه الوحدة:
 *   1) الدرجة مجموع اوزان الفحوص المعلنة فقط.
 *   2) المؤدي لا يعتمد نتيجته وفق RULE-004.
 *   3) الدعوى المخالفة لحقيقة مقيدة تسقط النتيجة نهائيا.
 *   4) كل نتيجة تقفل مرة واحدة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDITOR, criticalState, establishLab, performLab } from './helpers';

function candidate(resultId = 'result:quality', observedChecks?: Record<string, boolean>) {
  const h = criticalState();
  assert.equal(establishLab(h).ok, true);
  const made = performLab(h, resultId, { observedChecks });
  assert.equal(made.ok, true);
  if (!made.ok) throw new Error('تعذر بناء نتيجة الاختبار');
  return { h, result: made.result };
}

test('كل الفحوص المعلنة الناجحة تمنح 100 وتعتمد النتيجة', () => {
  const { h, result } = candidate();
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity', 'reproducibility'], note: 'فحص مستقل معلن',
  }, h.now);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.decision.score, 100);
  assert.equal(decision.decision.status, 'accepted');
  assert.equal(h.s.audit.find('lab_quality_accepted').length, 1);
});

test('الدرجة عند حد config/services.yaml نفسه 70 تقبل', () => {
  const { h, result } = candidate('result:boundary');
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity'],
  }, h.now);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.decision.score, h.s.servicesConfig.policy.min_quality_score);
  assert.equal(decision.decision.status, 'accepted');
});

test('الدرجة دون الحد بواحد او اقل ترفض ولا تتحول الى قبول', () => {
  const { h, result } = candidate('result:below-boundary');
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'reproducibility'], // 65 < 70
  }, h.now);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.decision.score, 65);
  assert.equal(decision.decision.status, 'rejected');
  assert.equal(h.s.qualityControl.report().rejected, 1);
});

test('من اجرى النتيجة لا يعتمدها وفق RULE-004', () => {
  const { h, result } = candidate('result:self');
  const decision = h.s.qualityControl.assess(result, {
    inspector: 'ministry:services', passed: ['provenance'],
  }, h.now);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /RULE-004/);
});

test('مفتش غير المعلن يرفض حتى لو لم يكن هو المؤدي', () => {
  const { h, result } = candidate('result:wrong-inspector');
  const decision = h.s.qualityControl.assess(result, {
    inspector: 'authority:other', passed: ['provenance', 'instrument_integrity'],
  }, h.now);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /RULE-004/);
});

test('فحص غير معلن يبطل التقرير كله ولا يدخل في الوزن', () => {
  const { h, result } = candidate('result:unknown-check');
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'invented'],
  }, h.now);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /غير معلن/);
});

test('فحص مكرر يبطل التقرير ولا يضاعف الوزن', () => {
  const { h, result } = candidate('result:duplicate-check');
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'provenance'],
  }, h.now);
  assert.equal(decision.ok, false);
  if (!decision.ok) assert.match(decision.reason, /مكر/);
});

test('تقرير بلا قائمة فحوص يرفض مغلقا', () => {
  const { h, result } = candidate('result:no-list');
  const decision = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: 'provenance' as unknown as string[],
  }, h.now);
  assert.equal(decision.ok, false);
});

test('فحص معلن ناجح يكذبه الواقع يسقط النتيجة ويقفلها نهائيا', () => {
  const { h, result } = candidate('result:contradiction', {
    provenance: false, instrument_integrity: true, reproducibility: true,
  });
  const dropped = h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity'],
  }, h.now);
  assert.equal(dropped.ok, false);
  assert.equal(h.s.audit.find('lab_quality_claim_contradicted').length, 1);
  assert.equal(h.s.qualityControl.decision(result.resultId)?.status, 'rejected');
  assert.equal(h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['instrument_integrity', 'reproducibility'],
  }, h.now).ok, false, 'النتيجة الساقطة لا تحيا بتقرير ثان');
});

test('تقرير فارغ مسموح شكلا لكنه يرفض النتيجة بدرجة صفر معلنة', () => {
  const { h, result } = candidate('result:zero');
  const decision = h.s.qualityControl.assess(result, { inspector: AUDITOR, passed: [] }, h.now);
  assert.equal(decision.ok, true);
  if (!decision.ok) return;
  assert.equal(decision.decision.score, 0);
  assert.equal(decision.decision.status, 'rejected');
});

test('لا قرار جودة مرتين للنتيجة المقبولة', () => {
  const { h, result } = candidate('result:once');
  assert.equal(h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity'],
  }, h.now).ok, true);
  assert.equal(h.s.qualityControl.assess(result, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity'],
  }, h.now).ok, false);
});

test('التقرير يجمع القبول والرفض ولا يخفي الحد المعلن', () => {
  const { h, result: accepted } = candidate('result:report-accepted');
  const rejected = performLab(h, 'result:report-rejected');
  assert.equal(rejected.ok, true);
  if (!rejected.ok) return;
  assert.equal(h.s.qualityControl.assess(accepted, {
    inspector: AUDITOR, passed: ['provenance', 'instrument_integrity'],
  }, h.now).ok, true);
  assert.equal(h.s.qualityControl.assess(rejected.result, {
    inspector: AUDITOR, passed: [],
  }, h.now).ok, true);
  const report = h.s.qualityControl.report();
  assert.equal(report.total, 2);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 1);
  assert.equal(report.minQualityScore, h.s.servicesConfig.policy.min_quality_score);
});
