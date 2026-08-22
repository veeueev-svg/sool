/**
 * tests/services/human_research.test.ts — ضوابط البحث النظري في النظير البشري (المرحلة 30)
 * المالك: وزارة البحث | المدخلات: مهاد وزارات وقسم مرآة ومصادر معلنة وأوامر تاج
 * المخرجات: إثبات قبول المسار النظري أو كود رفض مغلق | التبعيات: index وhelpers
 * الصلاحيات: لا ينشئ الاختبار بشرًا أو اتصالًا؛ يختبر سجلات داخلية فقط
 * السجلات: human_research_* وresearch_trace_* | حالات الفشل: الأكواد أدناه هي العقد
 * اختبارات الوحدة: هذا الملف | اختبار القبول: research_lifecycle.test.ts
 * الوثيقة: docs/test-reports/phase-30.md | القبول: لا بحث بلا مصدر معلن ولا اتصال ولا بشر.
 * ثوابت الاختبار: 1) النظري فقط؛ 2) source:* فقط؛ 3) egress صفر؛ 4) agent:* فقط؛
 * 5) القسم الفعلي يسبق البحث؛ 6) السقف والمدة لا يتساهلان عند الحد أو بعده.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT, DAY, MIRROR_SERVICES, RESEARCH_CASE, RESEARCH_SOURCES, SERVICES, establishMirror,
  researchState, startResearch,
} from './helpers';

function ready() {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  return h;
}

function rejected(result: { readonly ok: boolean; readonly code?: string }, code: string): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, code);
}

test('يبدأ البحث النظري من قسم مرآة قائم ومصدر معلن ومستفيد وكيل', () => {
  const h = ready();
  const result = startResearch(h);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.research.studyType, 'theoretical');
  assert.deepEqual(result.research.sourceIds, [RESEARCH_SOURCES[0]]);
  assert.equal(result.research.beneficiary, AGENT);
});

test('يرفض البحث حين لا يوجد قسم مرآة قائم', () => {
  const h = researchState();
  rejected(startResearch(h), 'RESEARCH_DEPARTMENT_INACTIVE');
});

test('يرفض البحث إذا اختلفت وظيفته عن وظيفة القسم الفعلية', () => {
  const h = ready();
  rejected(startResearch(h, { functionMinistry: 'ministry:not-services' }), 'RESEARCH_FUNCTION_MISMATCH');
});

test('يرفض الشخص أو أي معرّف ليس source:* قبل إنشاء البحث', () => {
  const h = ready();
  rejected(startResearch(h, { sourceIds: ['person:example'] }), 'RESEARCH_PERSONAL_DATA_REFUSED');
});

test('يرفض المصدر غير المعلن أو مجهول النوع ويفشل البحث كله', () => {
  const h = ready();
  rejected(startResearch(h, { sourceIds: ['source:unknown'] }), 'RESEARCH_SOURCE_UNDECLARED_REFUSED');
});

for (const studyType of ['experiment', 'intervention', 'observation'] as const) {
  test(`يرفض منهج ${studyType} لأنه ليس بحثًا نظريًا`, () => {
    const h = ready();
    rejected(startResearch(h, { studyType }), 'RESEARCH_INTERVENTION_REFUSED');
  });
}

for (const studyType of ['survey', 'questionnaire', 'contact'] as const) {
  test(`يرفض ${studyType} لأنه يقتضي تماسًا أو جمعًا من بشر`, () => {
    const h = ready();
    rejected(startResearch(h, { studyType }), 'RESEARCH_CONTACT_REFUSED');
  });
}

test('يرفض أي طلب خروج شبكي ولو كان البحث نظريًا', () => {
  const h = ready();
  rejected(startResearch(h, { egressCalls: 1 }), 'RESEARCH_NETWORK_EGRESS_REFUSED');
});

test('يرفض مستفيدًا خارج نطاق agent:*', () => {
  const h = ready();
  rejected(startResearch(h, { beneficiary: 'person:beneficiary' }), 'RESEARCH_BENEFICIARY_SCOPE_REFUSED');
});

test('يمرّ حد المصادر بالضبط ويرفض مصدرًا رابعًا', () => {
  const h = ready();
  assert.equal(startResearch(h, { sourceIds: RESEARCH_SOURCES }).ok, true);
  const second = ready();
  rejected(startResearch(second, {
    sourceIds: [...RESEARCH_SOURCES, 'source:one-too-many'],
  }), 'RESEARCH_SOURCE_LIMIT');
});

test('يمرّ حد مدة البحث ثلاثين يومًا ويرفض اليوم الحادي والثلاثين', () => {
  const h = ready();
  assert.equal(startResearch(h, { days: 30 }).ok, true);
  const second = ready();
  rejected(startResearch(second, { days: 31 }), 'RESEARCH_TERM_LIMIT_REFUSED');
});

test('يسمح بعدد البحوث المتزامنة المعلن ثم يرفض الذي يليه', () => {
  const h = ready();
  assert.equal(startResearch(h, { researchId: 'research:one' }).ok, true);
  assert.equal(startResearch(h, { researchId: 'research:two' }).ok, true);
  rejected(startResearch(h, { researchId: 'research:three' }), 'RESEARCH_CONCURRENCY_LIMIT');
});

test('يرفض إكمال البحث بغير الباحث المعلن', () => {
  const h = ready();
  assert.equal(startResearch(h).ok, true);
  rejected(h.s.humanResearch.complete(h.royalResearch(RESEARCH_CASE), RESEARCH_CASE, SERVICES, h.now), 'RESEARCH_COMPLETER_REFUSED');
});

test('يرفض إنشاء البحث عبر فعل تاج غير establish_research', () => {
  const h = ready();
  const command = h.royal(RESEARCH_CASE);
  rejected(h.s.humanResearch.start(command, {
    researchId: RESEARCH_CASE, departmentId: MIRROR_SERVICES, functionMinistry: SERVICES,
    sourceIds: [RESEARCH_SOURCES[0]], studyType: 'theoretical', egressCalls: 0,
    researcher: 'ministry:research', beneficiary: AGENT, purpose: 'بحث نظري معلن', expiresAt: h.now + DAY,
  }, h.now), 'RESEARCH_CROWN_PATH_REFUSED');
});

test('لا يبقى البحث قائمًا بعد نهاية مدته ولو ظل السجل محفوظًا', () => {
  const h = ready();
  assert.equal(startResearch(h, { days: 1 }).ok, true);
  const after = h.now + DAY;
  assert.equal(h.s.humanResearch.isActive(RESEARCH_CASE, after), false);
  assert.notEqual(h.s.humanResearch.get(RESEARCH_CASE), null);
});
