/**
 * tests/services/mirror_department.test.ts — أقسام المرآة المؤقتة وفجوات الوظائف (المرحلة 30)
 * المالك: وزارة البحث | المدخلات: سجل الوزارات الفعلي، التاج، وresearch.yaml
 * المخرجات: قسم مؤقت أو كود رفض، وفجوة mirror_gap قابلة للتدقيق | التبعيات: helpers
 * الصلاحيات: إقامة وحل رمزيان بأمر تاج؛ لا تغيير سياسة أو وزارة من هذا الاختبار
 * السجلات: mirror_department_* وmirror_gap* | حالات الفشل: الأكواد جزء من عقد المنع
 * اختبارات الوحدة: هذا الملف | اختبار القبول: research_lifecycle.test.ts
 * الوثيقة: docs/test-reports/phase-30.md | القبول: كل وظيفة قائمة بلا مرآة تظهر فجوة.
 * ثوابت الاختبار: 1) الواقع لا قائمة يدوية؛ 2) قسم واحد لكل وظيفة؛ 3) حد ومدة صارمان؛
 * 4) التاج وحده؛ 5) المرآة توصّي ولا تطبق سياسة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, MIRROR_SERVICES, RESEARCH, SERVICES, establishMirror, establishResearchFunction, researchState,
} from './helpers';

function rejected(result: { readonly ok: boolean; readonly code?: string }, code: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, code);
}

test('يقيم قسم مرآة مؤقتًا لوظيفة وزارة قائمة فعلًا', () => {
  const h = researchState();
  const result = establishMirror(h);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.department.functionMinistry, SERVICES);
  assert.equal(h.s.mirrorDepartments.isActive(MIRROR_SERVICES, h.now), true);
});

test('يرفض قسمًا لوظيفة ليست قائمة في سجل الوزارات', () => {
  const h = researchState();
  rejected(establishMirror(h, { functionMinistry: 'ministry:missing' }), 'MIRROR_FUNCTION_INACTIVE');
});

test('يرفض معرّف قسم لا يبدأ mirror:*', () => {
  const h = researchState();
  rejected(establishMirror(h, { departmentId: 'department:services' }), 'MIRROR_ID_REFUSED');
});

test('يرفض تكرار مرآة الوظيفة نفسها ولو اختلف المعرف', () => {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  rejected(establishMirror(h, { departmentId: 'mirror:services-copy' }), 'MIRROR_FUNCTION_DUPLICATE');
});

test('يمر حد ثلاثة أقسام مرآة ثم يرفض الرابع', () => {
  const h = researchState();
  assert.equal(establishMirror(h, { departmentId: 'mirror:services', functionMinistry: SERVICES }).ok, true);
  assert.equal(establishMirror(h, { departmentId: 'mirror:research', functionMinistry: RESEARCH }).ok, true);
  assert.equal(establishResearchFunction(h, 'ministry:extra-one', 'extra_one').ok, true);
  assert.equal(establishMirror(h, { departmentId: 'mirror:extra-one', functionMinistry: 'ministry:extra-one' }).ok, true);
  assert.equal(establishResearchFunction(h, 'ministry:extra-two', 'extra_two').ok, true);
  rejected(establishMirror(h, { departmentId: 'mirror:extra-two', functionMinistry: 'ministry:extra-two' }), 'MIRROR_DEPARTMENT_LIMIT');
});

test('يمر حد مدة القسم ثلاثين يومًا ويرفض اليوم الحادي والثلاثين', () => {
  const h = researchState();
  assert.equal(establishMirror(h, { days: 30 }).ok, true);
  const second = researchState();
  rejected(establishMirror(second, { days: 31 }), 'MIRROR_TERM_LIMIT_REFUSED');
});

test('يرفض مسار تاج بفعل غير establish_research', () => {
  const h = researchState();
  const result = h.s.mirrorDepartments.establish(h.royal(MIRROR_SERVICES), {
    departmentId: MIRROR_SERVICES, functionMinistry: SERVICES, proposedBy: RESEARCH,
    expiresAt: h.now + DAY, purpose: 'قسم مرآة معلن لاختبار الوظيفة القائمة',
  }, h.now);
  rejected(result, 'MIRROR_CROWN_PATH_REFUSED');
});

test('يسجل الفجوة من الوزارات القائمة لا من قائمة وظائف يدوية', () => {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  assert.equal(establishResearchFunction(h, 'ministry:actual-gap', 'actual_gap').ok, true);
  const gaps = h.s.mirrorDepartments.gaps(h.now);
  assert.equal(gaps.ok, true);
  if (!gaps.ok || !('gaps' in gaps)) return;
  assert.ok(gaps.gaps.includes(RESEARCH));
  assert.ok(gaps.gaps.includes('ministry:actual-gap'));
  assert.ok(h.s.audit.find('mirror_gap').some((entry) => (
    (entry.detail as { code: string }).code === 'MIRROR_GAP'
  )));
});

test('يعيد فحص الفجوة سجلاً جديدًا ولا يخفيها', () => {
  const h = researchState();
  h.s.mirrorDepartments.gaps(h.now);
  h.s.mirrorDepartments.gaps(h.now);
  assert.equal(h.s.audit.find('mirror_gap_checked').length, 2);
  assert.ok(h.s.audit.find('mirror_gap').length >= 2);
});

test('القسم المنتهي يبقى تاريخًا لكنه لا يغطي وظيفته', () => {
  const h = researchState();
  assert.equal(establishMirror(h, { days: 1 }).ok, true);
  const after = h.now + DAY;
  assert.equal(h.s.mirrorDepartments.isActive(MIRROR_SERVICES, after), false);
  assert.notEqual(h.s.mirrorDepartments.get(MIRROR_SERVICES), null);
  const gaps = h.s.mirrorDepartments.gaps(after);
  assert.equal(gaps.ok, true);
  if (gaps.ok && 'gaps' in gaps) assert.ok(gaps.gaps.includes(SERVICES));
});

test('يحل القسم نهائيًا بأمر تاج ويبقي أثره في السجل', () => {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  const dissolved = h.s.mirrorDepartments.dissolve(
    h.royalResearch(MIRROR_SERVICES), MIRROR_SERVICES, 'انتهاء الغرض المعلن', RESEARCH, h.now,
  );
  assert.equal(dissolved.ok, true);
  assert.equal(h.s.mirrorDepartments.isActive(MIRROR_SERVICES, h.now), false);
  assert.equal(h.s.mirrorDepartments.get(MIRROR_SERVICES)?.status, 'dissolved');
});

test('يرفض حل القسم بفاعل غير وزارة البحث', () => {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  rejected(h.s.mirrorDepartments.dissolve(
    h.royalResearch(MIRROR_SERVICES), MIRROR_SERVICES, 'طلب غير مخول', SERVICES, h.now,
  ), 'MIRROR_OPERATOR_REFUSED');
});

test('يرفض تطبيق سياسة مباشرة من قسم المرآة', () => {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  rejected(h.s.mirrorDepartments.applyPolicy(MIRROR_SERVICES, 'policy:target', RESEARCH), 'MIRROR_POLICY_APPLICATION_REFUSED');
});

test('يمنع الإيقاف الملكي إقامة قسم جديد عبر البوابة', () => {
  const h = researchState();
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار إيقاف المرحلة 30');
  rejected(establishMirror(h), 'MIRROR_COMMAND_REFUSED');
});
