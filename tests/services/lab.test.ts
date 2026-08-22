/**
 * tests/services/lab.test.ts — اختبارات المختبر البرمجي (المرحلة 29)
 * المالك: وزارة الخدمات؛ النطاق وكلاء agent:* فقط، لا بشر ولا عينات أو بيانات شخصية
 * المدخلات: خدمة مختبر مؤقتة، عملية معلنة، وحقائق فحوص من أداة مجردة
 * المخرجات: نتيجة معلقة قابلة للتدقيق أو رفض مغلق
 * ثوابت هذه الوحدة:
 *   1) النتيجة لا تنشأ إلا بعد عملية خدمة مقبولة.
 *   2) النتيجة معلقة ولا تعتمدها وحدة المختبر.
 *   3) حقائق الفحوص كاملة ومعلنة ولا تقبل فحصا زائدا.
 *   4) فقد مصدر او توقف عام يوقف النتيجة مع الخدمة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT, AUDITOR, LAB, DAY, criticalState, establishLab, performLab,
} from './helpers';

function ready() {
  const h = criticalState();
  assert.equal(establishLab(h).ok, true);
  return h;
}

test('المختبر ينشئ نتيجة معلقة بعد عملية screen معلنة', () => {
  const h = ready();
  const result = performLab(h);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.result.serviceId, LAB);
  assert.equal(result.result.beneficiary, AGENT);
  assert.equal(result.result.requiredChecks.length, 3);
  assert.equal(h.s.labs.result('result:lab-1')?.performedBy, 'ministry:services');
  assert.equal(h.s.audit.find('lab_result_created').length, 1);
});

test('نتيجة بلا خدمة مختبر قائمة ترفض ولا تنشئ نتيجة جانبية', () => {
  const h = criticalState();
  const result = performLab(h);
  assert.equal(result.ok, false);
  assert.equal(h.s.labs.resultsList().length, 0);
});

test('معرف نتيجة لا يبدأ result: او مكرر يرفض', () => {
  const h = ready();
  assert.equal(performLab(h, 'lab-1').ok, false);
  assert.equal(performLab(h, 'result:lab-1').ok, true);
  assert.equal(performLab(h, 'result:lab-1').ok, false);
});

test('كل فحص معلن يطلب حقيقة boolean، والناقص يرفض مغلقا', () => {
  const h = ready();
  const result = performLab(h, 'result:missing', {
    observedChecks: { provenance: true, instrument_integrity: true },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /غائبة/);
});

test('حقيقة فحص غير معلن او ليست boolean ترفض بدلا من تجاهلها', () => {
  const h = ready();
  assert.equal(performLab(h, 'result:unknown', {
    observedChecks: { provenance: true, instrument_integrity: true, reproducibility: true, invented: true },
  }).ok, false);
  assert.equal(performLab(h, 'result:not-boolean', {
    observedChecks: { provenance: true, instrument_integrity: true, reproducibility: 'yes' as unknown as boolean },
  }).ok, false);
});

test('نتيجة لمستفيد خارج agent: ترفض من تشغيل الخدمة', () => {
  const h = ready();
  assert.equal(performLab(h, 'result:scope', { beneficiary: 'human:forbidden' }).ok, false);
});

test('عملية confirm لا تعمل في المختبر إلا بوضع full ومصادرها كلها', () => {
  const h = ready();
  assert.equal(performLab(h, 'result:confirm', { operationId: 'operation:confirm' }).ok, true);
});

test('فقد sample-chain يهبط المختبر ويقبل screen فقط ويرفض confirm', () => {
  const h = ready();
  h.setSource('source:sample-chain', false);
  const screen = performLab(h, 'result:limited');
  assert.equal(screen.ok, true);
  assert.equal(h.s.labs.get(LAB)?.mode, 'limited');
  const confirm = performLab(h, 'result:confirm-limited', { operationId: 'operation:confirm' });
  assert.equal(confirm.ok, false);
  assert.equal(h.s.audit.find('service_degraded').length, 1);
});

test('فقد lab-instrument يوقف المختبر بامان ولا ينشئ نتيجة', () => {
  const h = ready();
  h.setSource('source:lab-instrument', false);
  assert.equal(performLab(h, 'result:halted').ok, false);
  assert.equal(h.s.labs.get(LAB)?.mode, 'halted');
});

test('طلب النتيجة بيد غير المشغل يرفض وفق RULE-004', () => {
  const h = ready();
  const result = performLab(h, 'result:wrong-performer', { requestedBy: AUDITOR });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /RULE-004/);
});

test('انتهاء مدة المختبر يمنع النتيجة بلا تجديد ضمني', () => {
  const h = criticalState();
  assert.equal(establishLab(h, { days: 1 }).ok, true);
  assert.equal(performLab(h, 'result:expired', { at: h.now + DAY + 1 }).ok, false);
});

test('الايقاف العام يوقف تشغيل المختبر حتى لو بقيت مصادره متاحة', () => {
  const h = ready();
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار ايقاف شامل');
  assert.equal(performLab(h, 'result:global-halt').ok, false);
});
