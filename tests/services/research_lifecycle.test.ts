/**
 * tests/services/research_lifecycle.test.ts — قبول دورة البحث النظري المرآتية (المرحلة 30)
 * المالك: وزارة البحث | المدخلات: تهيئة البحث، التاج، الوزارات، أقسام المرآة والمصادر
 * المخرجات: دورة بحث ودرس وتوصية مسجلة أو رفض مغلق قابل للتدقيق | التبعيات: helpers وconfig
 * الصلاحيات: توصية فقط؛ لا تطبيق سياسة ولا اتصال ولا موضوع بشري | السجلات: كل مسارات المرحلة 30
 * حالات الفشل: الإيقاف والمدة والدرس البالي والسلسلة المقطوعة والتهيئة ترفض بلا استثناء
 * اختبارات الوحدة: human_research وmirror_department | اختبار القبول: هذا الملف
 * الوثيقة: docs/test-reports/phase-30.md | القبول: بحث نظري كامل في النظير البشري بلا تدخل في بشر.
 * ثوابت الاختبار: 1) مصدر معلن؛ 2) بحث مؤقت؛ 3) إجازة مستقلة؛ 4) أثر الدرس لا يحذف؛
 * 5) التوصية لا سياسة؛ 6) كل سقف يختبر عنده وفوقه أو يرفض من التهيئة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadResearch } from '../../src/kernel/config';
import {
  AGENT, AUDITOR, DAY, LESSON, RECOMMENDATION, RESEARCH, RESEARCH_CASE, RESEARCH_SOURCES,
  approveLesson, completeResearch, establishMirror, proposeLesson, researchState, startResearch,
} from './helpers';

function ready() {
  const h = researchState();
  assert.equal(establishMirror(h).ok, true);
  return h;
}

function completeAndApprove(h: ReturnType<typeof ready>, lessonId = LESSON, qualityScore = 70): void {
  assert.equal(startResearch(h).ok, true);
  assert.equal(completeResearch(h).ok, true);
  assert.equal(proposeLesson(h, { lessonId, qualityScore }).ok, true);
  assert.equal(approveLesson(h, lessonId).ok, true);
}

function recommend(h: ReturnType<typeof ready>, recommendationId = RECOMMENDATION, at = h.now) {
  return h.s.humanResearch.recommend(h.royalResearch(recommendationId, at), {
    recommendationId, lessonId: LESSON, recommendedFor: AGENT, recommendedBy: RESEARCH,
    text: 'توصية معلنة لتحسين واجهة برمجية للوكيل المسجل',
  }, at);
}

function copiedConfig(change: (yaml: string) => string): string {
  const root = mkdtempSync('/tmp/sool-phase-30-');
  const configDir = join(root, 'config');
  cpSync('/home/user/workspace/sool/config', configDir, { recursive: true });
  const file = join(configDir, 'research.yaml');
  writeFileSync(file, change(readFileSync(file, 'utf8')));
  return configDir;
}

function rejectionCode(work: () => unknown): string | null {
  try {
    work();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? null;
  }
}

test('قبول: وظيفة قائمة ثم مرآة ثم بحث نظري ثم درس مستقل ثم توصية مسجلة بلا تطبيق سياسة', () => {
  const h = ready();
  completeAndApprove(h);
  const trace = h.s.humanResearch.traceTo(LESSON);
  assert.equal(trace.ok, true);
  if (!trace.ok) return;
  assert.equal(trace.research.researchId, RESEARCH_CASE);
  assert.deepEqual(trace.sources.map((source) => source.id), [RESEARCH_SOURCES[0]]);
  const rec = recommend(h);
  assert.equal(rec.ok, true);
  if (!rec.ok) return;
  assert.equal(rec.recommendation.applied, false);
  assert.equal(h.s.mirrorDepartments.applyPolicy('mirror:services', 'policy:no-direct-change', RESEARCH).ok, false);
  assert.equal(h.s.audit.verifyIntegrity().valid, true);
});

test('يرفض الباحث أن يجيز درسه ويثبت استقلال جهة الإجازة المعلنة', () => {
  const h = ready();
  assert.equal(startResearch(h).ok, true);
  assert.equal(completeResearch(h).ok, true);
  assert.equal(proposeLesson(h).ok, true);
  const result = approveLesson(h, LESSON, RESEARCH);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'LESSON_SELF_APPROVAL_REFUSED');
});

test('يمر حد جودة الدرس سبعين بالضبط ويرفض تسعة وستين', () => {
  const accepted = ready();
  completeAndApprove(accepted, LESSON, 70);
  assert.equal(accepted.s.humanResearch.lesson(LESSON)?.status, 'approved');

  const rejected = ready();
  assert.equal(startResearch(rejected).ok, true);
  assert.equal(completeResearch(rejected).ok, true);
  assert.equal(proposeLesson(rejected, { qualityScore: 69 }).ok, true);
  const result = approveLesson(rejected);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'LESSON_QUALITY_BELOW_MINIMUM');
  assert.equal(rejected.s.humanResearch.lesson(LESSON)?.status, 'rejected');
});

test('الدرس يبلى عند حد المراجعة ولا يحذف من التاريخ', () => {
  const h = ready();
  completeAndApprove(h);
  const staleAt = h.now + 14 * DAY;
  h.s.heartbeat.beat(h.s.king.kingId, staleAt);
  const result = recommend(h, RECOMMENDATION, staleAt);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'LESSON_STALE');
  assert.notEqual(h.s.humanResearch.lesson(LESSON), null);
  assert.equal(h.s.humanResearch.report(staleAt).staleLessons, 1);
});

test('مراجعة مستقلة تعيد قابلية الدرس البالي للتوصية', () => {
  const h = ready();
  completeAndApprove(h);
  const staleAt = h.now + 14 * DAY;
  h.s.heartbeat.beat(h.s.king.kingId, staleAt);
  assert.equal(h.s.humanResearch.reviewLesson(h.royalResearch(LESSON, staleAt), LESSON, AUDITOR, staleAt).ok, true);
  assert.equal(recommend(h, RECOMMENDATION, staleAt).ok, true);
});

test('إبطال مصدر معلن يقطع سلسلة الدرس ويمنع التوصية دون حذف البحث', () => {
  const h = ready();
  completeAndApprove(h);
  assert.equal(h.s.humanResearch.invalidateSource(
    h.royalResearch(RESEARCH_SOURCES[0]), RESEARCH_SOURCES[0], AUDITOR, 'سحب سند المصدر المعلن', h.now,
  ).ok, true);
  const trace = h.s.humanResearch.traceTo(LESSON);
  assert.equal(trace.ok, false);
  if (!trace.ok) assert.equal(trace.code, 'LESSON_TRACE_BROKEN');
  const rec = recommend(h);
  assert.equal(rec.ok, false);
  if (!rec.ok) assert.equal(rec.code, 'LESSON_TRACE_BROKEN');
  assert.notEqual(h.s.humanResearch.get(RESEARCH_CASE), null);
});

test('البحث المنتهي لا يكتمل ولا ينتج درسًا متأخرًا', () => {
  const h = ready();
  assert.equal(startResearch(h, { days: 1 }).ok, true);
  const after = h.now + DAY;
  const completed = completeResearch(h, RESEARCH_CASE, after);
  assert.equal(completed.ok, false);
  if (!completed.ok) assert.equal(completed.code, 'RESEARCH_NOT_ACTIVE');
  const lesson = proposeLesson(h, { at: after });
  assert.equal(lesson.ok, false);
  if (!lesson.ok) assert.equal(lesson.code, 'LESSON_RESEARCH_INCOMPLETE');
});

test('الإيقاف الملكي يمنع إقفال بحث قائم لأنه قرار سيادي', () => {
  const h = ready();
  assert.equal(startResearch(h).ok, true);
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار إيقاف البحث');
  const result = completeResearch(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'RESEARCH_COMMAND_REFUSED');
});

test('التوصية لا تقبل مستفيدًا بشريًا حتى بعد إجازة الدرس', () => {
  const h = ready();
  completeAndApprove(h);
  const result = h.s.humanResearch.recommend(h.royalResearch(RECOMMENDATION), {
    recommendationId: RECOMMENDATION, lessonId: LESSON, recommendedFor: 'person:recipient', recommendedBy: RESEARCH,
    text: 'محاولة توجيه لا تصح',
  }, h.now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'RECOMMENDATION_BENEFICIARY_SCOPE_REFUSED');
});

test('تغيير سقف البحوث في التهيئة يغير السلوك التشغيلي فعلًا', () => {
  const configDir = copiedConfig((yaml) => yaml.replace('max_concurrent_researches: 2', 'max_concurrent_researches: 1'));
  const h = researchState({ configDir });
  assert.equal(establishMirror(h).ok, true);
  assert.equal(startResearch(h, { researchId: 'research:first' }).ok, true);
  const second = startResearch(h, { researchId: 'research:second' });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, 'RESEARCH_CONCURRENCY_LIMIT');
});

test('ترفض التهيئة أي سقف خروج شبكي غير صفري قبل بناء الدولة', () => {
  const configDir = copiedConfig((yaml) => yaml.replace('max_egress_calls: 0', 'max_egress_calls: 1'));
  assert.equal(rejectionCode(() => loadResearch(configDir)), 'CONFIG_RESEARCH_EGRESS_NOT_ZERO');
});

test('ترفض التهيئة نوع مصدر خارج المجموعة الآمنة قبل بناء الدولة', () => {
  const configDir = copiedConfig((yaml) => yaml.replace('type: "historical_record"', 'type: "interview"'));
  assert.equal(rejectionCode(() => loadResearch(configDir)), 'CONFIG_RESEARCH_SOURCE_TYPE_UNDECLARED');
});

test('تعلن التهيئة الرفض الافتراضي وكل أنواع المصادر الآمنة الثلاثة', () => {
  const config = loadResearch('/home/user/workspace/sool/config');
  assert.equal(config.policy.default, 'deny');
  assert.deepEqual(config.allowed_source_types, [
    'public_literature', 'statistical_aggregate', 'historical_record',
  ]);
  assert.equal(config.policy.max_egress_calls, 0);
});
