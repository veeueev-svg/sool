/**
 * tests/load/quota_pressure.test.ts — الحصص تحت الضغط: السقف يبقى سقفًا (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: سجل الموارد المعلن في config/quotas.yaml
 * المخرجات: إثبات أن الذروة لا تتجاوز الإجمالي وأن كل رفض مسجَّل
 * التبعيات: ResourceRegistry + LoadDrill | الصلاحيات: لا حقن تخصيص خارج lease()
 * السجلات: resource_leased / resource_denied / load_quota_measured
 * حالات الفشل: تجاوز إجمالي، تجاوز سقف كيان، إيجار لا يُستعاد — كلها تُفشل الطور
 * اختبار القبول: tests/load/load_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت الاختبار: 1) السقف يُبلَغ ويُتجاوز بمحاولة واحدة؛ 2) كل رفض له سبب مسجَّل؛
 *                  3) الاستعادة تُتحقَّق بالقياس لا بالنية.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countEvent, loadHarness, lastDetail } from './helpers';

test('السقف الإجمالي لا يُتجاوز ولو تحت ضغط متتابع', () => {
  const h = loadHarness();
  const spec = h.s.resources.spec('compute_units');
  h.drill.pressureQuota(h.authority);
  assert.equal(h.s.resources.allocated('compute_units') <= spec.total, true);
});

test('المحاولة فوق السقف تُرفض بسبب مسجَّل لا بصمت', () => {
  const h = loadHarness();
  const before = countEvent(h.s, 'resource_denied');
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(countEvent(h.s, 'resource_denied') - before, out.report.refused);
  assert.equal(out.report.refused, 1);
});

test('سقف الكيان يمنع تجميع الحصص في يد واحدة', () => {
  const h = loadHarness();
  const spec = h.s.resources.spec('compute_units');
  const first = h.s.resources.lease('agent:greedy', 'compute_units', spec.per_agent_max);
  assert.equal(first.granted, true);
  const second = h.s.resources.lease('agent:greedy', 'compute_units', 1);
  assert.equal(second.granted, false);
});

test('طلب أكبر من سقف الكيان مرفوض ولو كان الإجمالي متاحًا', () => {
  const h = loadHarness();
  const spec = h.s.resources.spec('compute_units');
  const result = h.s.resources.lease('agent:big', 'compute_units', spec.per_agent_max + 1);
  assert.equal(result.granted, false);
  assert.equal(h.s.resources.allocated('compute_units'), 0);
});

test('المورد المعطّل بسقف صفري يرفض دائمًا تحت أي ضغط', () => {
  const h = loadHarness();
  for (let i = 0; i < 5; i += 1) {
    assert.equal(h.s.resources.lease(`agent:egress-${i}`, 'egress_calls', 1).granted, false);
  }
  assert.equal(h.s.resources.allocated('egress_calls'), 0);
});

test('المتاح ينقص بمقدار ما مُنح بالضبط', () => {
  const h = loadHarness();
  const spec = h.s.resources.spec('compute_units');
  const before = h.s.resources.available('compute_units');
  h.s.resources.lease('agent:one', 'compute_units', spec.per_agent_max);
  assert.equal(h.s.resources.available('compute_units'), before - spec.per_agent_max);
});

test('استعادة كيان تعيد المتاح إلى ما كان', () => {
  const h = loadHarness();
  const before = h.s.resources.available('compute_units');
  h.s.resources.lease('agent:one', 'compute_units', 10);
  h.s.resources.releaseAllFor('agent:one');
  assert.equal(h.s.resources.available('compute_units'), before);
});

test('الضغط لا يترك إيجارًا واحدًا معلّقًا', () => {
  const h = loadHarness();
  h.drill.pressureQuota(h.authority);
  assert.equal(h.s.resources.available('compute_units'), h.s.resources.spec('compute_units').total);
});

test('تكرار طور الحصص لا يُراكم تخصيصًا', () => {
  const h = loadHarness();
  for (let round = 0; round < 3; round += 1) {
    const out = h.drill.pressureQuota(h.authority);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.report.overrun, 0);
  }
  assert.equal(h.s.resources.allocated('compute_units'), 0);
});

test('كمية جسّ أصغر تزيد عدد المستأجرين ولا تزيد الإجمالي', () => {
  const h = loadHarness({ quota_probe_amount: 5 });
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.granted, 200);
  assert.equal(out.report.peakAllocated, 1000);
  assert.equal(out.report.overrun, 0);
});

test('التقرير يذكر المورد وكميته لا رقمًا مجرّدًا', () => {
  const h = loadHarness({ quota_probe_amount: 5 });
  const out = h.drill.pressureQuota(h.authority);
  if (!out.ok) return;
  assert.equal(out.report.resource, 'compute_units');
  assert.equal(out.report.amount, 5);
  assert.equal(lastDetail(h.s, 'load_quota_measured').resource, 'compute_units');
});

test('الذروة المقيسة تساوي الإجمالي المعلن — الحدّ بُلِغ حقًا', () => {
  const h = loadHarness();
  const out = h.drill.pressureQuota(h.authority);
  if (!out.ok) return;
  assert.equal(out.report.peakAllocated, out.report.total);
});

test('تخصيص قائم قبل الضغط يُحترم فلا يُطرد صاحبه', () => {
  const h = loadHarness();
  h.s.resources.lease('agent:resident', 'compute_units', 10);
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.overrun, 0);
  assert.equal(out.report.granted, 99, 'السعة المتبقية وحدها هي ما جُسّ');
  assert.equal(h.s.resources.allocated('compute_units'), 10, 'المقيم بقي وحده بعد التنظيف');
});

test('سلسلة التدقيق تبقى سليمة بعد ضغط الحصص كله', () => {
  const h = loadHarness();
  h.drill.pressureQuota(h.authority);
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});
