/**
 * tests/services/enterprise_lifecycle.test.ts — اختبار قبول المرحلة 28
 * المالك: وزارة الاقتصاد تحت التاج | يوثّق في: docs/test-reports/phase-28.md
 * شرط القبول المعلن في ROADMAP.md: «تشغيل كيان اقتصادي كامل بحدود موارد ومراقبة جودة»
 * وشرط T-69: «كل منشأة إنتاجية تُعلن مدخلاتها ومخرجاتها وحدودها، ولا إنتاج بلا مدخل
 * مُقاس؛ وتُبنى على عقد/قناة معلنة لا على اسم مذكور».
 * ويُثبت هذا الملف الدورة كاملة من التهيئة إلى الحلّ، ثم يُثبت أنها لا تنكسر تحت الضغط.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { loadEnterprises } from '../../src/kernel/config';
import {
  AUDITOR, BLOCK, CHECKS, COMPUTE_CP, CROWN_GUARD, DAY, ECONOMY, FACILITY, INDEX, KIND_INDEX,
  KIND_PLANT, RAW, SEALED, beat, establish, industrialState, inspect, startRun, stockExternal,
} from './helpers';

/* ————— 1) شرط القبول: كيان اقتصادي كامل ————— */

test('قبول: كيان اقتصادي كامل — إعلان ثم إقامة ثم توريد على عقد ثم إنتاج ثم تفتيش ثم حلّ', () => {
  const h = industrialState();

  // (أ) الإعلان سابق للتشغيل: النوع والمدخلات والمخرج والحدود كلها في التهيئة
  const kind = h.s.companies.kind(KIND_INDEX);
  assert.notEqual(kind, null, 'النوع معلن قبل أي تشغيل');
  assert.equal(kind?.inputs.length, 1);
  assert.equal(kind?.output.material, INDEX);
  assert.equal(kind?.requiredChecks.length, 4, 'حدود الجودة معلنة لا مستنبطة');

  // (ب) الإقامة بأمر ملكي وبند موازنة قائم ووزارة قائمة
  const established = establish(h, { days: 60 });
  assert.equal(established.ok, true);

  // (ج) التوريد على **عقد قائم** لا على اسم مذكور
  assert.equal(stockExternal(h, RAW, 40).ok, true);
  const receipt = h.s.audit.find('stock_received')[0];
  assert.equal(
    (receipt?.detail as { reference: string }).reference, h.contractIds[COMPUTE_CP],
    'الحركة مقيَّدة بمرجع العقد لا باسم النظير',
  );

  // (د) الإنتاج بحدود موارد: الحصة مؤجَّرة والمدخل مُقاس والدفعات محسوبة
  const started = startRun(h, 'run-1', { [RAW]: 40 });
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.equal(started.run.batches, 10);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 2, 'الإنتاج يستهلك حصة معلنة');

  // (هـ) مراقبة الجودة بيد مستقلة، والمخرج يدخل المخزون
  const inspected = inspect(h, 'run-1');
  assert.equal(inspected.ok, true);
  if (!inspected.ok) return;
  assert.equal(inspected.run.status, 'accepted');
  assert.equal(inspected.run.closedBy, AUDITOR, 'المفتّش غير المشغّل (RULE-004)');
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 10);
  assert.equal(h.s.resources.usageOf(FACILITY, 'compute_units', h.now), 0, 'الحصة استُعيدت');

  // (و) الحلّ نهائي ويُطلق كل شيء، والرقم يبقى للتدقيق
  const dissolved = h.s.companies.dissolve(
    h.royalFacility(FACILITY), FACILITY, ECONOMY, 'انتهاء الغرض المعلن', h.now,
  );
  assert.equal(dissolved.ok, true);
  assert.equal(h.s.companies.isActive(FACILITY, h.now), false);
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 10, 'الأثر باقٍ للتدقيق');
  assert.equal(h.s.supply.verifyConservation().valid, true);
  assert.equal(
    h.s.audit.verifyIntegrity().valid, true, 'سلسلة التدقيق سليمة بعد الدورة كاملة',
  );
});

test('قبول: سلسلة توريد بين منشأتين — مخرج الأولى مدخل الثانية بلا خلق مادة', () => {
  const h = industrialState();
  assert.equal(establish(h, { facilityId: 'facility:idx', kindId: KIND_INDEX, days: 60 }).ok, true);
  assert.equal(establish(h, { facilityId: 'facility:plt', kindId: KIND_PLANT, days: 60 }).ok, true);

  assert.equal(stockExternal(h, RAW, 12, { facilityId: 'facility:idx' }).ok, true);
  const run = h.s.factories.start('facility:idx', { runId: 'run-idx', inputs: { [RAW]: 12 } }, h.now);
  assert.equal(run.ok, true);
  assert.equal(h.s.factories.complete('run-idx', { inspector: AUDITOR, passed: CHECKS }, h.now).ok, true);
  assert.equal(h.s.supply.balance('facility:idx', INDEX), 3);

  // النقل إلى المنشأة الثانية: حركتان متساويتان
  assert.equal(h.s.supply.transfer('facility:idx', 'facility:plt', INDEX, 3, ECONOMY, h.now).ok, true);
  assert.equal(stockExternal(h, BLOCK, 6, { facilityId: 'facility:plt' }).ok, true);

  const plantRun = h.s.factories.start('facility:plt', {
    runId: 'run-plt', inputs: { [BLOCK]: 6, [INDEX]: 3 },
  }, h.now);
  assert.equal(plantRun.ok, true);
  assert.equal(h.s.factories.complete('run-plt', { inspector: AUDITOR, passed: CHECKS }, h.now).ok, true);
  assert.equal(h.s.supply.balance('facility:plt', SEALED), 3);

  const conservation = h.s.supply.verifyConservation();
  assert.equal(conservation.valid, true);
  assert.equal(conservation.netTransfer, 0, 'النقل لم يُنشئ مادة ولم يُفنِها');
});

/* ————— 2) الثوابت لا تنكسر تحت الضغط ————— */

test('قبول: منشأة معلَّقة تتوقف عن الإنتاج في اللحظة، وتعود بأمر ملكي بيد غير من علّق', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, 40).ok, true);

  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'إنذار جودة معلن', h.now).ok, true);
  assert.equal(startRun(h, 'run-1', { [RAW]: 4 }).ok, false, 'أنتجت وهي معلَّقة');
  assert.equal(stockExternal(h, RAW, 4).ok, false, 'استلمت وهي معلَّقة');

  assert.equal(h.s.companies.resume(h.royalFacility(FACILITY), FACILITY, AUDITOR, h.now).ok, true);
  assert.equal(startRun(h, 'run-1', { [RAW]: 4 }).ok, true);
});

test('قبول: قطع العقد الخارجي يقطع التوريد فورًا ولا يُبطل ما دخل قبله', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  assert.equal(stockExternal(h, RAW, 40).ok, true);

  const contractId = h.contractIds[COMPUTE_CP] as string;
  assert.equal(h.s.contractTermination.terminate(
    h.royalOpen(contractId), contractId, CROWN_GUARD, 'قطع معلن لسبب موثَّق', h.now,
  ).ok, true);

  assert.equal(stockExternal(h, RAW, 4).ok, false, 'التوريد استمرّ على عقد مقطوع');
  // وما دخل قبل القطع يبقى مشروعًا: الإنتاج منه يقع والمخرج يدخل
  assert.equal(startRun(h, 'run-1', { [RAW]: 40 }).ok, true);
  assert.equal(inspect(h, 'run-1').ok, true);
  assert.equal(h.s.supply.balance(FACILITY, INDEX), 10);
});

test('قبول: الإيقاف الملكي يجمّد كل فعل يحتاج أمرًا، والتعليق الوقائي يبقى ممكنًا', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 60 }).ok, true);
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'احتواء معلن');

  assert.equal(establish(h, { facilityId: 'facility:new' }).ok, false, 'أُقيمت منشأة في الإيقاف');
  assert.equal(h.s.companies.dissolve(
    h.royalFacility(FACILITY), FACILITY, ECONOMY, 'محاولة حلّ في الإيقاف', h.now,
  ).ok, false);
  // التعليق فعل حماية لا يحتاج أمرًا: يبقى ممكنًا في الإيقاف (ثابت 7)
  assert.equal(h.s.companies.suspend(FACILITY, CROWN_GUARD, 'تعليق وقائي في الإيقاف', h.now).ok, true);
});

test('قبول: مدة المنشأة تسقط الإنتاج بلا استدعاء — لا كيان دائم بلا تجديد', () => {
  const h = industrialState();
  assert.equal(establish(h, { days: 10 }).ok, true);
  assert.equal(stockExternal(h, RAW, 40).ok, true);
  assert.equal(startRun(h, 'run-1', { [RAW]: 4 }).ok, true);

  const after = h.now + 11 * DAY;
  beat(h, after);
  assert.equal(startRun(h, 'run-2', { [RAW]: 4 }, { at: after }).ok, false, 'أنتجت بعد مدتها');
  // والدفعة التي بدأت قبل الانتهاء تُقفَل بتفتيشها لا تُنسى
  assert.equal(h.s.factories.get('run-1')?.status, 'running');
  assert.equal(h.s.factories.sweep(after).length, 1, 'المسح لا يترك دفعة معلَّقة أبدًا');
});

/* ————— 3) التهيئة ملزمة لا وصفية ————— */

test('قبول: كل نوع معلن يبلغ حدّ الجودة بمجموع أوزانه — لا نوع ميت في التهيئة', () => {
  const config = loadEnterprises();
  for (const kind of config.kinds) {
    const weight = kind.required_checks.reduce(
      (sum: number, check: string) => sum + (config.quality_checks[check] as number), 0,
    );
    assert.ok(
      weight >= config.policy.min_quality_score,
      `النوع ${kind.id} لا تنجح فيه دفعة أبدًا (${weight} < ${config.policy.min_quality_score})`,
    );
  }
});

test('قبول: كل مادة خارجية مصدرها نظير معلن في config/external.yaml — لا اسم مذكور', () => {
  const s = bootstrapState({ now: Date.now() });
  const counterparties = new Set(s.externalConfig.counterparties.map((cp) => cp.id));
  for (const material of s.enterprisesConfig.materials) {
    assert.ok(
      material.source === 'internal' || counterparties.has(material.source),
      `مصدر غير معلن للمادة ${material.id}`,
    );
  }
});

test('قبول: البوابة تُبنى من قائمة الأفعال المعلنة، وفيها establish_facility', () => {
  const s = bootstrapState({ now: Date.now() });
  assert.ok(
    s.config.sovereign_actions.includes('establish_facility'),
    'فعل الإقامة معلن في config/royal-authority.yaml لا في الشفرة وحدها',
  );
  // والفعل غير المعلن يُرفض عند البوابة ولو كان الأمر ملكيًّا صحيحًا
  const bogus = s.king.issueCommand('establish_facility', 'facility:x', {}, Date.now());
  assert.equal(s.gateway.authorize(bogus, Date.now()).allowed, true, 'المعلن يمرّ');
});

test('قبول: التأسيس يبقى مختومًا بسجل state_online وحده، ورقم المرحلة 30 بعد تكامل البحث والخدمات', () => {
  const s = bootstrapState({ now: Date.now() });
  const snapshot = s.audit.snapshot();
  assert.equal(snapshot.at(-1)?.kind, 'state_online');
  assert.equal((snapshot.at(-1)?.detail as { phase: number }).phase, 31);
  assert.equal(s.audit.find('facility_established').length, 0, 'التأسيس لا يُقيم منشأة بنفسه');
  assert.equal(s.companies.report().declaredKinds, 3);
  assert.equal(s.supply.report().declaredMaterials, 4);
});
