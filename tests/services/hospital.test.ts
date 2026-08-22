/**
 * tests/services/hospital.test.ts — اختبارات المستشفى البرمجي الحرج (المرحلة 29)
 * المالك: وزارة الخدمات؛ المجال وكلاء مسجلون فقط ولا بشر أو بيانات شخصية (DIRECTIVES §6)
 * المدخلات: إعلان الخدمات، أمر ملكي، وزارة قائمة، ومصادر بيانات مقيدة
 * المخرجات: إقامة مؤقتة وتشغيل مقبول أو مرفوض بسجل تدقيق
 * ثوابت هذه الوحدة:
 *   1) الإقامة مؤقتة وبأمر establish_service فقط.
 *   2) المستفيد agent:* فقط.
 *   3) سقف المدة والعدد من config/services.yaml وممارس عند الحد وفوقه.
 *   4) رفض كل مسار غير معلن أو غير مربوط مغلق ومسجل.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT, AUDITOR, DAY, HOSPITAL, HOSPITAL_DECLARATION, SERVICES, criticalState, establishHospital,
} from './helpers';

function established() {
  const h = criticalState();
  const result = establishHospital(h);
  assert.equal(result.ok, true);
  return h;
}

test('المستشفى يقوم بإعلان معلن وأمر ملكي مطابق، وينسخ نوعه ووضعه من التهيئة', () => {
  const h = established();
  const service = h.s.hospitals.get(HOSPITAL);
  assert.equal(service?.declarationId, HOSPITAL_DECLARATION);
  assert.equal(service?.kind, 'hospital');
  assert.equal(service?.operator, SERVICES);
  assert.equal(service?.mode, 'full');
  assert.equal(h.s.audit.find('service_established').length, 1);
});

test('إعلان مختبر لا يقيم مستشفى، فالنوع مقفل بالإعلان لا بطلب التشغيل', () => {
  const h = criticalState();
  const result = establishHospital(h, { declarationId: 'service:lab-core' });
  assert.equal(result.ok, false);
  assert.equal(h.s.hospitals.list().length, 0);
});

test('معرف خدمة غير صالح أو مكرر يرفض، ولا تتكرر هوية خدمة', () => {
  const h = criticalState();
  assert.equal(establishHospital(h, { serviceId: 'hospital-1' }).ok, false);
  assert.equal(establishHospital(h).ok, true);
  assert.equal(establishHospital(h).ok, false);
});

test('وزارة غير قائمة لا تقيم خدمة ولا يفترضها التشغيل قائمة', () => {
  const h = criticalState();
  assert.equal(h.s.ministries.dissolve(h.royal(SERVICES), SERVICES, 'حل معلن للوزارة', h.now).ok, true);
  assert.equal(establishHospital(h).ok, false);
});

test('المقترح غير المشغل المعلن يرفض وفق RULE-004', () => {
  const h = criticalState();
  const result = h.s.hospitals.establish(h.royalService(HOSPITAL), {
    serviceId: HOSPITAL, declarationId: HOSPITAL_DECLARATION, expiresAt: h.now + DAY,
    proposedBy: AUDITOR, purpose: 'اقتراح جهة رقابية غير مخولة',
  }, h.now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /RULE-004/);
});

test('مدة الخدمة تقبل الحد المعلن وترفضه زائد يوم واحد بلا تقريب', () => {
  const h = criticalState();
  const max = h.s.servicesConfig.policy.max_term_days;
  assert.equal(establishHospital(h, { days: max }).ok, true);
  const extra = establishHospital(h, { serviceId: 'service:after-max', days: max + 1 });
  assert.equal(extra.ok, false);
  if (!extra.ok) assert.match(extra.reason, /تتجاوز الحد/);
});

test('مدة غير صالحة لا تنشئ مستشفى: كسرية أو NaN أو حاضرة أو ماضية', () => {
  const h = criticalState();
  for (const expiresAt of [h.now + 0.5, Number.NaN, h.now, h.now - 1]) {
    assert.equal(establishHospital(h, { serviceId: `service:bad-${String(expiresAt)}`, expiresAt }).ok, false);
  }
  assert.equal(h.s.hospitals.list().length, 0);
});

test('سقف الخدمات شامل للمستشفى والمختبر: يقبل الحد ويرفض ما فوقه بواحد', () => {
  const h = criticalState();
  const max = h.s.servicesConfig.policy.max_services_per_ministry;
  for (let i = 0; i < max - 1; i += 1) {
    assert.equal(establishHospital(h, { serviceId: `service:h-${i}` }).ok, true);
  }
  const lab = h.s.labs.establish(h.royalService('service:l-0'), {
    serviceId: 'service:l-0', declarationId: 'service:lab-core', expiresAt: h.now + DAY,
    proposedBy: SERVICES, purpose: 'خدمة مختبرية ضمن السقف',
  }, h.now);
  assert.equal(lab.ok, true, 'الحد نفسه مقبول ولو وزع بين النوعين');
  assert.equal(establishHospital(h, { serviceId: 'service:over-limit' }).ok, false);
});

test('أمر بفعل آخر أو هدف آخر يرفض، فلا مسار جانبي حول بوابة التاج', () => {
  const h = criticalState();
  const wrongAction = h.s.hospitals.establish(h.royal(HOSPITAL), {
    serviceId: HOSPITAL, declarationId: HOSPITAL_DECLARATION, expiresAt: h.now + DAY,
    proposedBy: SERVICES, purpose: 'محاولة بفعل غير صحيح',
  }, h.now);
  assert.equal(wrongAction.ok, false);
  const wrongTarget = h.s.hospitals.establish(h.royalService('service:other'), {
    serviceId: HOSPITAL, declarationId: HOSPITAL_DECLARATION, expiresAt: h.now + DAY,
    proposedBy: SERVICES, purpose: 'محاولة بهدف غير مطابق',
  }, h.now);
  assert.equal(wrongTarget.ok, false);
});

test('أمر منته او ايقاف شامل يمنعان اقامة الخدمة ببوابة التاج', () => {
  const h = criticalState();
  const stale = h.royalService(HOSPITAL, h.now - 10 * 60 * 1000);
  const staleResult = h.s.hospitals.establish(stale, {
    serviceId: HOSPITAL, declarationId: HOSPITAL_DECLARATION, expiresAt: h.now + DAY,
    proposedBy: SERVICES, purpose: 'امر قديم لا يقام به مستشفى',
  }, h.now);
  assert.equal(staleResult.ok, false);
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'احتواء معلن');
  assert.equal(establishHospital(h, { serviceId: 'service:halted' }).ok, false);
});

test('العملية المعلنة تعمل للمستفيد agent:* وتسجل قبولها', () => {
  const h = established();
  const receipt = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'فرز برمجي معلن',
  }, h.now);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.mode, 'full');
  assert.equal(h.s.audit.find('service_operation_accepted').length, 1);
});

test('النطاق الاخلاقي يرفض معرف مستفيد لا يبدأ agent: ولا يخفي الرفض', () => {
  const h = established();
  const receipt = h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: 'person:forbidden', purpose: 'اختبار النطاق الاخلاقي',
  }, h.now);
  assert.equal(receipt.ok, false);
  assert.equal(h.s.audit.find('service_operation_refused').length, 1);
});

test('عملية غير معلنة او بلا غرض او بطلب غير المشغل ترفض مغلقا', () => {
  const h = established();
  assert.equal(h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:ghost', beneficiary: AGENT, purpose: 'عملية غير معلنة',
  }, h.now).ok, false);
  assert.equal(h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: '  ',
  }, h.now).ok, false);
  assert.equal(h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'طلب جهة اخرى', requestedBy: AUDITOR,
  }, h.now).ok, false);
});

test('حل المستشفى ملكي ونهائي، ولا تعود الخدمة بعد الحل', () => {
  const h = established();
  assert.equal(h.s.hospitals.dissolve(
    h.royalService(HOSPITAL), HOSPITAL, SERVICES, 'انتهاء غرض برمجي معلن', h.now,
  ).ok, true);
  assert.equal(h.s.hospitals.isActive(HOSPITAL, h.now), false);
  assert.equal(h.s.hospitals.dissolve(
    h.royalService(HOSPITAL), HOSPITAL, SERVICES, 'محاولة حل ثانية', h.now,
  ).ok, false);
});

test('انتهاء المدة يخرج المستشفى من الخدمة دون تجديد ضمني', () => {
  const h = criticalState();
  assert.equal(establishHospital(h, { days: 1 }).ok, true);
  const later = h.now + DAY + 1;
  assert.equal(h.s.hospitals.isActive(HOSPITAL, later), false);
  assert.equal(h.s.hospitals.execute(HOSPITAL, {
    operationId: 'operation:triage', beneficiary: AGENT, purpose: 'طلب بعد انتهاء المدة',
  }, later).ok, false);
});
