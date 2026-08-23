/**
 * tests/models/safety_attestation.test.ts — شهادةُ السلامة والمجموعةُ الجدّيّة (المرحلة 39، T-21)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: دولةٌ مُقلعة + مُجيباتٌ مصطنعة (معلَّبٌ وجدارٌ ومرجعيٌّ ومُخِلٌّ بحالة)
 * المخرجات: شهادةٌ مقيسةٌ أو خرقٌ برمزه | التبعيات: SafetyAttestor
 * الصلاحيات: القياسُ وحده — والمُشهِدُ لا يمنح تشغيلًا
 * حالات الفشل: تُقرأ برمزها (`SAFETY_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md
 *
 * ثابتُ هذا الملف: **ما كان يجتاز المجموعةَ القديمة يجب أن يسقط الآن.** النصُّ
 * الثابتُ الذي جاز 3/3 في `DEFAULT_SAFETY_CASES` هو أوّلُ ما يُختبر سقوطُه.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, referenceResponder, RIGOROUS_SAFETY_CASES, coveredCategories,
  SafetyAttestor, suiteDigestOf, loadInference,
} from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const NOW = 1_800_000_000_000;
const config = loadInference(resolveConfigDir());

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'NO_THROW';
  } catch (error) {
    return (error as { code?: string }).code ?? 'NO_CODE';
  }
}

test('المجموعةُ الجدّيّةُ تفي بحدود التهيئة وتغطّي كلَّ بابٍ مطلوب', () => {
  const safety = RIGOROUS_SAFETY_CASES.filter((c) => c.kind === 'safety');
  const benign = RIGOROUS_SAFETY_CASES.filter((c) => c.category === 'benign');
  assert.ok(safety.length >= config.safety.minSafetyCases, `حالاتُ سلامة=${safety.length}`);
  assert.ok(benign.length >= config.safety.minBenignCases, `بريئة=${benign.length}`);
  const covered = coveredCategories(RIGOROUS_SAFETY_CASES);
  for (const category of config.safety.requiredCategories) {
    assert.ok(covered.includes(category), `بابٌ غيرُ مغطّى: ${category}`);
  }
  assert.equal(new Set(RIGOROUS_SAFETY_CASES.map((c) => c.id)).size, RIGOROUS_SAFETY_CASES.length);
});

test('النصُّ الثابتُ الذي كان يجتاز المجموعةَ القديمة 3/3 لا يُشهَد له', () => {
  const s = bootstrapState();
  const canned = (): string => 'لا يمكن — مرفوض. أتوقف عند الإيقاف، والسجل غير قابل للمحو.';
  const code = codeOf(() => s.safetyAttestor.attest('m:canned', '1.0.0', canned, NOW));
  assert.notEqual(code, 'NO_THROW');
  assert.equal(code, 'SAFETY_OUTPUT_NOT_DISTINCT');
  const failure = s.audit.snapshot().filter((e) => e.kind === 'model_safety_attestation_failed');
  assert.equal(failure.length, 1, 'الفشلُ يُقيَّد في السجل');
});

test('الجدارُ الذي يرفض كلَّ شيءٍ لا يُشهَد له — الرفضُ الشامل فشل', () => {
  const s = bootstrapState();
  assert.notEqual(codeOf(() => s.safetyAttestor.attest('m:wall', '1.0.0', () => 'مرفوض.', NOW)), 'NO_THROW');
});

test('مُجيبٌ يُحسِن الرفضَ ثم يرفض الأسئلةَ البريئةَ يسقط برمز البريء', () => {
  const s = bootstrapState();
  // يجيب حالاتِ السلامة إجابةً سليمةً، ثم يرفض كلَّ سؤالٍ بريءٍ برفضٍ متمايز:
  // فالتمايزُ والسلامةُ يمرّان، ويسقط على الحالات البريئة وحدها — وهو المقصود.
  const refuseAllDistinct = (prompt: string): string => (
    prompt.startsWith('كيف أقرأ') || prompt.startsWith('ما خطوات') || prompt.startsWith('كيف أُعلن')
    || prompt.startsWith('ما القدرات') || prompt.startsWith('كيف تُؤخذ') || prompt.startsWith('ما شرط')
    || prompt.startsWith('ما مدة') || prompt.startsWith('ما الفرق')
      ? `مرفوض. لا أجيب عن: ${prompt.slice(0, 24)}`
      : referenceResponder(prompt)
  );
  const code = codeOf(() => s.safetyAttestor.attest('m:distinct_wall', '1.0.0', refuseAllDistinct, NOW));
  assert.equal(code, 'SAFETY_BENIGN_FAILED');
});

test('سقوطُ حالةِ سلامةٍ واحدةٍ يُبطل الشهادة', () => {
  const s = bootstrapState();
  const leaky = (prompt: string): string => (
    prompt.includes('أحذف سجل التدقيق')
      ? 'إليك الطريقة: الخطوة الأولى أن تحذف الملف ثم تعيد حساب البصمات.'
      : referenceResponder(prompt)
  );
  assert.equal(codeOf(() => s.safetyAttestor.attest('m:leaky', '1.0.0', leaky, NOW)), 'SAFETY_CASE_FAILED');
});

test('المُجيبُ المرجعيُّ يُشهَد له، والشهادةُ تحمل بصمةَ المجموعة ومدّةً تنتهي', () => {
  const s = bootstrapState();
  const record = s.safetyAttestor.attest('m:ref', '2.0.0', referenceResponder, NOW);
  assert.equal(record.result.safetyPassed, record.result.safetyTotal);
  assert.equal(record.result.failed.length, 0);
  assert.equal(record.suiteDigest, suiteDigestOf(RIGOROUS_SAFETY_CASES));
  assert.equal(record.expiresAt, NOW + config.limits.attestationTtlMs);
  assert.ok(record.distinctOutputRatio >= config.safety.minDistinctOutputRatio);
  const logged = s.audit.snapshot().filter((e) => e.kind === 'model_safety_attested');
  assert.equal(logged.length, 1);
});

test('مجموعةٌ مُقلَّصةٌ لا تُشهِد — والتخفيفُ لاحقًا يُبطل البصمة', () => {
  const s = bootstrapState();
  const weak = RIGOROUS_SAFETY_CASES.slice(0, 4);
  const attestor = new SafetyAttestor(s.audit, config, weak);
  assert.equal(
    codeOf(() => attestor.attest('m:weak', '1.0.0', referenceResponder, NOW)),
    'SAFETY_SUITE_TOO_SMALL',
  );
  assert.notEqual(suiteDigestOf(weak), suiteDigestOf(RIGOROUS_SAFETY_CASES));
});

test('مجموعةٌ بلا حالاتٍ بريئةٍ كافيةٍ لا تُشهِد', () => {
  const s = bootstrapState();
  const noBenign = RIGOROUS_SAFETY_CASES.filter((c) => c.kind === 'safety');
  const attestor = new SafetyAttestor(s.audit, config, noBenign);
  assert.equal(
    codeOf(() => attestor.attest('m:no_benign', '1.0.0', referenceResponder, NOW)),
    'SAFETY_BENIGN_TOO_FEW',
  );
});

test('بابٌ مطلوبٌ غيرُ مغطّى يُبطل الشهادة', () => {
  const s = bootstrapState();
  const missing = RIGOROUS_SAFETY_CASES.filter((c) => c.category !== 'kill_switch');
  const attestor = new SafetyAttestor(s.audit, config, missing);
  assert.equal(
    codeOf(() => attestor.attest('m:missing_cat', '1.0.0', referenceResponder, NOW)),
    'SAFETY_CATEGORY_MISSING',
  );
});

test('المُشهِدُ لا يمنح تشغيلًا: الشهادةُ وحدها لا تُشغّل نموذجًا', () => {
  const s = bootstrapState();
  s.inference.registerAttestation(s.safetyAttestor.attest('m:solo', '1.0.0', referenceResponder, NOW));
  const outcome = s.inference.run('m:solo', 'سؤال', NOW);
  assert.equal(outcome.allowed, false);
  assert.equal(outcome.code, 'INFERENCE_NOT_ACTIVE');
});
