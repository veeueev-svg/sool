/**
 * tests/services/company.test.ts — اختبارات وحدة سجل الشركات (المرحلة 28)
 * المالك: وزارة الاقتصاد تحت التاج | يوثّق في: docs/test-reports/phase-28.md
 * ما يُثبته: أن المنشأة لا تقوم إلا بنوع معلن ومدة إلزامية وبند موازنة قائم ووزارة قائمة
 * وأمر ملكي مطابق؛ وأن التعليق فوري بلا أمر، والاستئناف بأمر وبغير من علّق، والحلّ نهائي.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGET_LINE, CROWN_GUARD, CYBER, DAY, ECONOMY, FACILITY, FOREIGN, KIND_INDEX, KIND_PLANT,
  AUDITOR, beat, establish, industrialState,
} from './helpers';

/* ————— 1) الإقامة: الإعلان قبل الأمر ————— */

test('منشأة تقوم بنوع معلن وأمر ملكي مطابق، وقيمها تُنسخ من الإعلان لا من الطلب', () => {
  const h = industrialState();
  const result = establish(h);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const facility = result.facility;
  assert.equal(facility.kindId, KIND_INDEX);
  assert.equal(facility.operator, ECONOMY, 'المشغّل من التهيئة لا من الطلب');
  assert.equal(facility.sector, 'data_processing', 'القطاع منقول من الإعلان');
  assert.equal(facility.status, 'active');
  assert.equal(h.s.companies.isActive(FACILITY, h.now), true);
  assert.equal(h.s.audit.find('facility_established').length, 1);
});

test('نوع غير معلن يُرفض ولو صحّ الأمر الملكي — الإقامة لا تُنشئ نوعًا (RULE-005)', () => {
  const h = industrialState();
  const result = establish(h, { kindId: 'facility:weapons-plant' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير معلن/);
  assert.equal(h.s.companies.list().length, 0);
});

test('مقترح غير وزارة الاقتصاد يُرفض — الاقتراح ليد واحدة معلنة (RULE-004)', () => {
  const h = industrialState();
  const result = establish(h, { proposedBy: FOREIGN });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /وزارة الاقتصاد/);
});

test('منشأة بلا غرض معلن تُرفض — ولا يُقبل غرضٌ من حرفين (RULE-006)', () => {
  const h = industrialState();
  assert.equal(establish(h, { purpose: '  ' }).ok, false);
  assert.equal(establish(h, { purpose: 'أب' }).ok, false);
});

test('معرّف بلا سابقة facility يُرفض، والمعرّف المكرَّر يُرفض ثانيةً', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'company-1' }).ok, false);
  assert.equal(establish(h).ok, true);
  const again = establish(h);
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.match(again.reason, /قائمة بهذا المعرّف/);
});

/* ————— 2) المدة الإلزامية (ثابت 2) ————— */

test('لحظة انتهاء غير صحيحة تُرفض: كسرية أو NaN أو صفر أو ماضية أو مساوية للحظة', () => {
  const h = industrialState();
  for (const expiresAt of [
    h.now + 1000.5, Number.NaN, 0, h.now - 1, h.now,
  ]) {
    const result = establish(h, { expiresAt, facilityId: `facility:t-${String(expiresAt)}` });
    assert.equal(result.ok, false, `قُبلت مدة غير صالحة: ${String(expiresAt)}`);
  }
  assert.equal(h.s.companies.list().length, 0);
});

test('مدة تتجاوز الحدّ المعلن تُرفض ولا تُقرَّب إلى الحدّ', () => {
  const h = industrialState();
  const max = h.s.enterprisesConfig.policy.max_term_days;
  const result = establish(h, { days: max + 1 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /تتجاوز الحدّ المعلن/);
  assert.equal(establish(h, { days: max }).ok, true, 'الحدّ نفسه مقبول');
});

test('المنشأة تسقط بانتهاء مدتها بلا استدعاء، ولا تُستأنف بل تُقام جديدةً', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 10 }).ok, true);
  const after = h.now + 11 * DAY;
  beat(h, after);
  assert.equal(h.s.companies.isActive(FACILITY, after), false, 'المنتهية غير قائمة');
  assert.equal(h.s.companies.get(FACILITY)?.status, 'active', 'الحالة المخزَّنة لم تُلمس');
  assert.equal(h.s.companies.report(after).expired, 1);
});

/* ————— 3) بند الموازنة والوزارة: مصادر تحقق لا افتراضات ————— */

test('بند موازنة غير قائم يُرفض — لا منشأة بلا نفقة معلنة', () => {
  const h = industrialState();
  const result = establish(h, { budgetLine: 'budget:ghost' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /بند الموازنة/);
});

test('بند موازنة فارغ نصًّا يُرفض قبل سؤال المصدر', () => {
  const h = industrialState();
  assert.equal(establish(h, { budgetLine: '   ' }).ok, false);
});

test('وزارة اقتصاد غير قائمة تُرفض معها كل إقامة — ولا تُفترض قائمة', () => {
  const h = industrialState();
  // حلّ الوزارة ثم محاولة الإقامة: الكيان المشغّل لم يبق قائمًا
  h.s.ministries.dissolve(h.royal(ECONOMY), ECONOMY, 'إعادة هيكلة معلنة', h.now);
  const result = establish(h);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير قائمة/);
});

/* ————— 4) حدّ العدد (ثابت 6) ————— */

test('عدد المنشآت القائمة للوزارة محدود، والحلّ يفتح مكانًا والتعليق لا يفتحه', () => {
  const h = industrialState();
  const max = h.s.enterprisesConfig.policy.max_facilities_per_ministry;
  for (let i = 0; i < max; i += 1) {
    assert.equal(establish(h, { facilityId: `facility:f-${i}` }).ok, true, `تعذّرت ${i}`);
  }
  const overflow = establish(h, { facilityId: 'facility:f-extra' });
  assert.equal(overflow.ok, false);
  if (overflow.ok) return;
  assert.match(overflow.reason, /بلغ الحدّ المعلن/);

  // التعليق يُخرج المنشأة من القائمة القائمة فيفتح مكانًا — وهذا مقصود: المعلَّقة لا تُنتج
  assert.equal(h.s.companies.suspend('facility:f-0', CROWN_GUARD, 'تعليق معلن', h.now).ok, true);
  assert.equal(establish(h, { facilityId: 'facility:f-extra' }).ok, true);
});

/* ————— 5) الأمر الملكي: باب واحد لا مسار جانبي (RULE-003) ————— */

test('أمر بفعل غير establish_facility يُرفض ولو كان الهدف صحيحًا', () => {
  const h = industrialState();
  const result = h.s.companies.establish(h.royal(FACILITY), {
    facilityId: FACILITY, kindId: KIND_INDEX, expiresAt: h.now + 30 * DAY,
    budgetLine: BUDGET_LINE, proposedBy: ECONOMY, purpose: 'محاولة بفعل آخر',
  }, h.now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /establish_facility/);
});

test('أمر هدفه منشأة أخرى يُرفض — لا أمر عامّ يُقيم أي منشأة', () => {
  const h = industrialState();
  const result = h.s.companies.establish(h.royalFacility('facility:other'), {
    facilityId: FACILITY, kindId: KIND_INDEX, expiresAt: h.now + 30 * DAY,
    budgetLine: BUDGET_LINE, proposedBy: ECONOMY, purpose: 'محاولة بهدف مغاير',
  }, h.now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /هدف الأمر/);
});

test('أمر قديم يتجاوز عمر الأمر المقبول يُرفض عند البوابة', () => {
  const h = industrialState();
  const stale = h.royalFacility(FACILITY, h.now - 10 * 60 * 1000);
  const result = h.s.companies.establish(stale, {
    facilityId: FACILITY, kindId: KIND_INDEX, expiresAt: h.now + 30 * DAY,
    budgetLine: BUDGET_LINE, proposedBy: ECONOMY, purpose: 'أمر متقادم',
  }, h.now);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير معتمد/);
});

test('الدولة في حالة إيقاف لا تُقيم منشأة — الإيقاف يعلو على الإعلان (RULE-007)', () => {
  const h = industrialState();
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار الإيقاف');
  const result = establish(h);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير معتمد/);
});

/* ————— 6) التعليق والاستئناف والحلّ (ثابتا 7 و8) ————— */

test('التعليق فوري بلا أمر ملكي، ويُخرج المنشأة من القائمة في اللحظة نفسها', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  const result = h.s.companies.suspend(FACILITY, CYBER, 'خطر معلن على الجودة', h.now);
  assert.equal(result.ok, true);
  assert.equal(h.s.companies.isActive(FACILITY, h.now), false);
  assert.equal(h.s.audit.find('facility_suspended').length, 1);
});

test('جهة غير مخوَّلة لا تُعلّق، ولا تعليق بلا سبب، ولا تعليق مرتين', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(h.s.companies.suspend(FACILITY, FOREIGN, 'سبب معلن', h.now).ok, false);
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'أ', h.now).ok, false);
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'سبب معلن', h.now).ok, true);
  assert.equal(h.s.companies.suspend(FACILITY, CYBER, 'سبب آخر', h.now).ok, false);
});

test('الاستئناف بأمر ملكي وبغير من علّق — ومن علّق لا يَصِل بيده (RULE-004)', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'تعليق معلن', h.now).ok, true);

  const bySame = h.s.companies.resume(h.royalFacility(FACILITY), FACILITY, CROWN_GUARD, h.now);
  assert.equal(bySame.ok, false);
  if (!bySame.ok) assert.match(bySame.reason, /من علّق لا يستأنف/);

  const byOther = h.s.companies.resume(h.royalFacility(FACILITY), FACILITY, AUDITOR, h.now);
  assert.equal(byOther.ok, true);
  assert.equal(h.s.companies.isActive(FACILITY, h.now), true);
  const entry = h.s.audit.find('facility_resumed')[0];
  assert.equal((entry?.detail as { previousBy: string }).previousBy, CROWN_GUARD, 'الفصل مقروء في السجل');
});

test('لا استئناف لغير معلَّقة، ولا استئناف لمنتهية المدة', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 10 }).ok, true);
  assert.equal(h.s.companies.resume(h.royalFacility(FACILITY), FACILITY, AUDITOR, h.now).ok, false);

  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'تعليق معلن', h.now).ok, true);
  const after = h.now + 11 * DAY;
  beat(h, after);
  const result = h.s.companies.resume(h.royalFacility(FACILITY, after), FACILITY, AUDITOR, after);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /انتهت مدتها/);
});

test('الحلّ نهائي بأمر ملكي، ويستعيد كل حصص المنشأة، ولا يقع مرتين', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  h.s.resources.lease(FACILITY, 'compute_units', 2, h.now);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 2);

  const result = h.s.companies.dissolve(
    h.royalFacility(FACILITY), FACILITY, ECONOMY, 'انتهاء الغرض المعلن', h.now,
  );
  assert.equal(result.ok, true);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 0, 'لا حصة لكيان لا وجود له');
  assert.equal(h.s.companies.isActive(FACILITY, h.now), false);

  const again = h.s.companies.dissolve(
    h.royalFacility(FACILITY), FACILITY, ECONOMY, 'محاولة ثانية', h.now,
  );
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.match(again.reason, /نهائي/);
});

test('المنحلّة لا تُعلَّق ولا تُستأنف — والحلّ بلا سبب مرفوض', () => {
  const h = industrialState();
  assert.equal(establish(h).ok, true);
  assert.equal(h.s.companies.dissolve(h.royalFacility(FACILITY), FACILITY, ECONOMY, 'أ', h.now).ok, false);
  assert.equal(h.s.companies.dissolve(h.royalFacility(FACILITY), FACILITY, ECONOMY, 'سبب معلن', h.now).ok, true);
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'سبب معلن', h.now).ok, false);
  assert.equal(h.s.companies.resume(h.royalFacility(FACILITY), FACILITY, AUDITOR, h.now).ok, false);
});

test('كل رفض يُسجَّل باسمه، والتقرير يعكس الحالات لا يُخفيها', () => {
  const h = industrialState();
  assert.equal(establish(h, { kindId: 'facility:ghost' }).ok, false);
  assert.equal(h.s.audit.find('facility_refused').length, 1);

  assert.equal(establish(h, { facilityId: 'facility:a' }).ok, true);
  assert.equal(establish(h, { facilityId: 'facility:b', kindId: KIND_PLANT }).ok, true);
  assert.equal(h.s.companies.suspend('facility:b', CROWN_GUARD, 'تعليق معلن', h.now).ok, true);
  const report = h.s.companies.report(h.now);
  assert.equal(report.declaredKinds, h.s.enterprisesConfig.kinds.length);
  assert.equal(report.total, 2);
  assert.equal(report.active, 1);
  assert.equal(report.suspended, 1);
});
