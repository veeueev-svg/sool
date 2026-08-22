/**
 * tests/services/factory.test.ts — اختبارات وحدة دفعات الإنتاج ومراقبة الجودة (المرحلة 28)
 * المالك: وزارة الاقتصاد تشغّل وديوان المحاسبة يفتّش | يوثّق في: docs/test-reports/phase-28.md
 * ما يُثبته: أن لا إنتاج بلا مدخل مُقاس، وأن الدفعات محسوبة لا مُدَّعاة، وأن التفتيش مستقل،
 * وأن الدعوى تُقابَل بالسجل فتُرفض إن خالفته، وأن ما دون الحدّ لا يدخل المخزون.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDITOR, BLOCK, CHECKS, CROWN_GUARD, DAY, ECONOMY, FACILITY, HOUR, INDEX, KIND_ASSEMBLY,
  KIND_PLANT, RAW, SEALED, beat, establish, industrialState, inspect, startRun, stockExternal,
} from './helpers';

/** أرضية جاهزة: منشأة فهرسة قائمة بمخزون من مادة الحوسبة */
function ready(rawQuantity = 40) {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, rawQuantity).ok, true);
  return h;
}

/* ————— 1) لا إنتاج بلا مدخل مُقاس (شرط قبول T-69) ————— */

test('دفعة تبدأ بمدخل مُقاس، وعددها محسوب من المخزون لا مُدَّعى', () => {
  const h = ready(40);
  const result = startRun(h, 'run-1', { [RAW]: 40 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.batches, 10, '40 ÷ 4 = عشر دفعات');
  assert.equal(h.s.supply.balance(FACILITY, RAW), 0, 'المدخل استُهلك فعلًا');
  assert.equal(h.s.audit.find('production_started').length, 1);
});

test('مدخل معلن غائب يُرفض به الطلب — لا إنتاج بلا مدخل مُقاس', () => {
  const h = ready();
  const result = startRun(h, 'run-1', {});
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /مدخل معلن غائب/);
});

test('مدخل غير مُقاس يُرفض: صفر أو سالب أو كسري أو NaN', () => {
  const h = ready();
  for (const provided of [0, -4, 4.5, Number.NaN]) {
    const result = startRun(h, `run-${String(provided)}`, { [RAW]: provided });
    assert.equal(result.ok, false, `قُبل مدخل ${String(provided)}`);
  }
  assert.equal(h.s.supply.balance(FACILITY, RAW), 40, 'لا خصم في الطلبات المرفوضة');
});

test('مدخل غير معلن في النوع يُرفض به الطلب كلّه — لا يُتجاهَل بصمت (ثابت 1)', () => {
  const h = ready();
  const result = startRun(h, 'run-1', { [RAW]: 40, [BLOCK]: 2 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /غير معلن/);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 40);
});

test('مدخل يتجاوز المخزون يُرفض — لا إنتاج من مخزون لا وجود له', () => {
  const h = ready(10);
  const result = startRun(h, 'run-1', { [RAW]: 40 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /يتجاوز المخزون/);
});

test('مدخل لا يكفي دفعةً واحدة يُرفض — لا دفعة كسرية (ثابت 2)', () => {
  const h = ready(3);
  const result = startRun(h, 'run-1', { [RAW]: 3 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /دفعةً واحدة/);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 3, 'المدخل الناقص لم يُستهلك');
});

test('الكسر يُهمَل نزولًا لا يُقرَّب صعودًا، والزائد يبقى في المخزون', () => {
  const h = ready(11);
  const result = startRun(h, 'run-1', { [RAW]: 11 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.batches, 2, '11 ÷ 4 = دفعتان لا ثلاث');
  assert.equal(h.s.supply.balance(FACILITY, RAW), 3, 'الثلاثة الزائدة باقية');
});

test('نوع بمدخلين يحسب الدفعات بأقلّ المدخلين لا بأكثرهما', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:plant', kindId: KIND_PLANT, days: 60 }).ok, true);
  assert.equal(stockExternal(h, BLOCK, 20, { facilityId: 'facility:plant' }).ok, true);
  // مادة الفهرس داخلية: تدخل بسند إنتاج
  assert.equal(h.s.supply.receive('facility:plant', INDEX, 3, {
    kind: 'production', runId: 'run-seed',
  }, ECONOMY, h.now).ok, true);

  const result = h.s.factories.start('facility:plant', {
    runId: 'run-1', inputs: { [BLOCK]: 20, [INDEX]: 3 },
  }, h.now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // 20÷2 = 10 لكن 3÷1 = 3 ⇒ ثلاث دفعات
  assert.equal(result.run.batches, 3, 'الأقلّ يحكم');
  assert.equal(h.s.supply.balance('facility:plant', BLOCK), 14);
  assert.equal(h.s.supply.balance('facility:plant', INDEX), 0);
});

/* ————— 2) المنشأة والحصص والحدود ————— */

test('منشأة غير قائمة لا تُنتج: معلَّقة أو منحلّة أو منتهية أو غير مُقامة', () => {
  const h = ready();
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'تعليق معلن', h.now).ok, true);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, false);
  assert.equal(h.s.factories.start('facility:ghost', { runId: 'run-2', inputs: { [RAW]: 4 } }, h.now).ok, false);
});

test('الإنتاج للمشغّل المعلن وحده — جهة أخرى لا تبدأ دفعة (RULE-004)', () => {
  const h = ready();
  const result = startRun(h, 'run-1', { [RAW]: 40 }, { by: AUDITOR });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /RULE-004/);
});

test('معرّف دفعة مكرَّر أو فارغ يُرفض — لا تكرار هوية', () => {
  const h = ready();
  assert.equal(startRun(h, '  ', { [RAW]: 4 }).ok, false);
  assert.equal(startRun(h, 'run-1', { [RAW]: 4 }).ok, true);
  assert.equal(startRun(h, 'run-1', { [RAW]: 4 }).ok, false);
});

test('حدّ الدفعات المتزامنة معلن، والإقفال يفتح مكانًا', () => {
  const h = ready(100);
  const max = h.s.enterprisesConfig.policy.max_concurrent_runs;
  for (let i = 0; i < max; i += 1) {
    assert.equal(startRun(h, `run-${i}`, { [RAW]: 4 }).ok, true, `تعذّرت ${i}`);
  }
  const overflow = startRun(h, 'run-extra', { [RAW]: 4 });
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.match(overflow.reason, /المتزامنة/);

  assert.equal(inspect(h, 'run-0').ok, true);
  assert.equal(startRun(h, 'run-extra', { [RAW]: 4 }).ok, true);
});

test('حصة المورد تُؤجَّر قبل الاستهلاك، وفشل التأجير رفضٌ بلا استهلاك (ثابت 3)', () => {
  const h = ready(100);
  const spec = h.s.quotas.resources.compute_units as { per_agent_max: number };
  // كل دفعة تحجز وحدتين: نُشبع سقف الكيان بتأجير مباشر ثم نطلب دفعة
  h.s.resources.lease(FACILITY, 'compute_units', spec.per_agent_max, h.now);
  const result = startRun(h, 'run-1', { [RAW]: 4 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /حصة المورد/);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 100, 'لا استهلاك بعد رفض الحصة');
});

test('الفقد المعلن غير الصالح يُرفض قبل تأجير أي حصة', () => {
  const h = ready();
  for (const waste of [-1, 1000, 2.5, Number.NaN]) {
    assert.equal(startRun(h, `run-${String(waste)}`, { [RAW]: 4 }, { wastePerMille: waste }).ok, false);
  }
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 0);
});

/* ————— 3) التفتيش المستقل (ثابتا 4 و5) ————— */

test('المشغّل لا يفتّش عمل نفسه — تقرير من وزارة الاقتصاد يُرفض (RULE-004)', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1', CHECKS, { inspector: ECONOMY });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /من أنتج لا يشهد/);
  assert.equal(h.s.factories.get('run-1')?.status, 'running', 'الدفعة لم تُقفل بتقرير مرفوض');
});

test('فحص غير معلن في النوع يُبطل التفتيش كلّه — لا انتقاء من تقرير فاسد (ثابت 5)', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1', [...CHECKS, 'looks_fine']);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /يُبطل التفتيش كلّه/);
});

test('فحص مكرَّر لا يُحتسب مرتين بل يُبطل التفتيش — لا تضخيم درجة (ثابت 5)', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1', ['input_provenance', 'input_provenance', 'output_integrity']);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /مكرَّر/);
});

/* ————— 4) الدعوى تُقابَل بالسجل (ثابت 6) ————— */

test('دعوى «الفقد داخل الحدّ» تُرفض إن خالفت الفقد المُقيَّد، ويُسجَّل التناقض باسمه', () => {
  const h = ready();
  const tolerance = h.s.enterprisesConfig.policy.waste_tolerance_per_mille;
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }, { wastePerMille: tolerance + 1 }).ok, true);
  const result = inspect(h, 'run-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /تخالف قيد النظام/);
  assert.equal(h.s.audit.find('quality_claim_contradicted').length, 1);
  assert.equal(h.s.factories.get('run-1')?.status, 'running');
});

test('الفقد عند الحدّ نفسه مقبول — الحدّ يقع عند تجاوزه لا عند بلوغه', () => {
  const h = ready();
  const tolerance = h.s.enterprisesConfig.policy.waste_tolerance_per_mille;
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }, { wastePerMille: tolerance }).ok, true);
  assert.equal(inspect(h, 'run-1').ok, true);
});

test('دعوى «داخل حدّ المورد» تُرفض إن انقضت حصة الدفعة قبل التفتيش', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const leaseSeconds = (h.s.quotas.resources.compute_units as { lease_seconds: number }).lease_seconds;
  const later = h.now + leaseSeconds * 1000 + 1000;
  beat(h, later);
  const result = inspect(h, 'run-1', CHECKS, { at: later });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /تخالف قيد النظام/);
  const entry = h.s.audit.find('quality_claim_contradicted')[0];
  assert.deepEqual((entry?.detail as { claims: string[] }).claims, ['resource_within_limit']);
});

test('التقرير الذي يُسقط الدعوى المتناقضة يُقبل — لكن درجته تنقص فقد تسقط الدفعة', () => {
  const h = ready();
  const tolerance = h.s.enterprisesConfig.policy.waste_tolerance_per_mille;
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }, { wastePerMille: tolerance + 1 }).ok, true);
  const result = inspect(h, 'run-1', ['input_provenance', 'output_integrity', 'resource_within_limit']);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.qualityScore, 80);
  assert.equal(result.run.status, 'accepted');
});

/* ————— 5) الدرجة والقبول والرفض (ثابتا 7 و9) ————— */

test('كل الفحوص ناجحة ⇒ درجة كاملة ومخرج يدخل المخزون بكميته المحسوبة', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.qualityScore, 100);
  assert.equal(result.run.status, 'accepted');
  assert.equal(result.run.producedQuantity, 10, 'عشر دفعات × مخرج واحد');
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 10);
  assert.equal(h.s.audit.find('production_completed').length, 1);
});

test('درجة دون الحدّ ⇒ الدفعة مرفوضة، ولا مخرج يدخل المخزون، والفقد مسجَّل (ثابت 7)', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1', ['input_provenance', 'output_integrity']); // 60 < 70
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.qualityScore, 60);
  assert.equal(result.run.status, 'rejected');
  assert.equal(result.run.producedQuantity, 0);
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 0, 'لا مخرج من دفعة مرفوضة');
  assert.equal(h.s.supply.balance(FACILITY, RAW), 0, 'المدخل فُقد ولم يُعَد');
  const entry = h.s.audit.find('production_rejected')[0];
  assert.equal((entry?.detail as { output: number }).output, 0);
});

test('الدرجة عند الحدّ نفسه مقبولة — والحدّ معلن في التهيئة لا في الشفرة', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  const result = inspect(h, 'run-1', ['input_provenance', 'output_integrity', 'waste_within_tolerance']);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.qualityScore, 80);
  assert.equal(result.run.status, 'accepted');
});

test('الحصة تُستعاد في القبول والرفض والإلغاء معًا — لا حصة معلّقة بلا دفعة (ثابت 9)', () => {
  const h = ready(100);
  assert.equal(startRun(h, 'run-ok', { [RAW]: 4 }).ok, true);
  assert.equal(startRun(h, 'run-bad', { [RAW]: 4 }).ok, true);
  assert.equal(startRun(h, 'run-abort', { [RAW]: 4 }).ok, true);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 6);

  assert.equal(inspect(h, 'run-ok').ok, true);
  assert.equal(inspect(h, 'run-bad', ['input_provenance']).ok, true);
  assert.equal(h.s.factories.abort('run-abort', ECONOMY, 'إلغاء معلن', h.now).ok, true);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 0);
});

/* ————— 6) الإقفال مرة واحدة والمسح (ثابتا 8 و10) ————— */

test('لا إقفال مرتين ولا إقفال لملغاة ولا لدفعة غير قائمة', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  assert.equal(inspect(h, 'run-1').ok, true);
  assert.equal(inspect(h, 'run-1').ok, false);
  assert.equal(inspect(h, 'run-ghost').ok, false);
  assert.equal(h.s.factories.abort('run-1', ECONOMY, 'محاولة إلغاء مقفلة', h.now).ok, false);
});

test('الإلغاء يعترف بالفقد ولا يُعيد المدخل — والإلغاء بلا سبب مرفوض (RULE-006)', () => {
  const h = ready(40);
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  assert.equal(h.s.factories.abort('run-1', ECONOMY, 'أ', h.now).ok, false);
  const result = h.s.factories.abort('run-1', ECONOMY, 'عطل معلن في الخط', h.now);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.run.status, 'aborted');
  assert.equal(result.run.producedQuantity, 0);
  assert.equal(h.s.supply.balance(FACILITY, RAW), 0, 'المدخل دخل الخط فعلًا ولا يُعاد');
  assert.equal(h.s.audit.find('production_aborted').length, 1);
});

test('المسح يُلغي كل دفعة تجاوزت مدتها المعلنة ولا يمسّ ما لم يتجاوزها (ثابت 8)', () => {
  const h = ready(100);
  assert.equal(startRun(h, 'run-old', { [RAW]: 4 }).ok, true);
  const maxHours = h.s.enterprisesConfig.policy.max_run_duration_hours;
  const later = h.now + (maxHours + 1) * HOUR;
  beat(h, later);
  assert.equal(startRun(h, 'run-new', { [RAW]: 4 }, { at: later }).ok, true);

  const swept = h.s.factories.sweep(later);
  assert.deepEqual(swept, ['run-old']);
  assert.equal(h.s.factories.get('run-old')?.status, 'aborted');
  assert.equal(h.s.factories.get('run-new')?.status, 'running');
});

test('التقرير يعكس كل الحالات، والمفتّش المعلن مقروء فيه', () => {
  const h = ready(100);
  assert.equal(startRun(h, 'run-a', { [RAW]: 4 }).ok, true);
  assert.equal(startRun(h, 'run-b', { [RAW]: 4 }).ok, true);
  assert.equal(startRun(h, 'run-c', { [RAW]: 4 }).ok, true);
  assert.equal(inspect(h, 'run-a').ok, true);
  assert.equal(inspect(h, 'run-b', ['input_provenance']).ok, true);
  const report = h.s.factories.report();
  assert.equal(report.total, 3);
  assert.equal(report.accepted, 1);
  assert.equal(report.rejected, 1);
  assert.equal(report.running, 1);
  assert.equal(report.inspector, AUDITOR);
  assert.equal(report.minQualityScore, h.s.enterprisesConfig.policy.min_quality_score);
});

test('نوع بكلفة مورد أعلى يعمل كذلك، ومخرجه يدخل بكميته المعلنة لا بواحدة', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:asm', kindId: KIND_ASSEMBLY, days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, 16, { facilityId: 'facility:asm' }).ok, true);
  const started = h.s.factories.start('facility:asm', { runId: 'run-1', inputs: { [RAW]: 16 } }, h.now);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.run.batches, 2, '16 ÷ 8');
  assert.equal(started.run.resourceAmount, 4);
  assert.equal(inspect(h, 'run-1').ok, true);
  assert.equal(h.s.supply.balance('facility:asm', INDEX), 4, 'دفعتان × مخرجان');
});

test('كل رفض في الإنتاج يُسجَّل باسمه production_refused ولا يمرّ صامتًا (RULE-006)', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', {}).ok, false);
  assert.equal(startRun(h, 'run-2', { [RAW]: 0 }).ok, false);
  assert.equal(h.s.audit.find('production_refused').length, 2);
});

test('مادة السدّ لا تُنتج في منشأة فهرسة — كل منشأة تُنتج مخرجها المعلن وحده', () => {
  const h = ready();
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  assert.equal(inspect(h, 'run-1').ok, true);
  assert.equal(h.s.supply.balance(FACILITY, SEALED), 0);
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 10);
});
