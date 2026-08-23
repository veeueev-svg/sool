/**
 * tests/models/inference.test.ts — محرّكُ الاستدلال: منعُ التشغيل (المرحلة 39، T-21)
 * المالك: وزارة البحث | يوثّق في: docs/test-reports/phase-39.md
 * المدخلات: دولةٌ مُقلعة + نماذجُ في كل حالةٍ من حالات السجل + مُجيبٌ مرجعيّ
 * المخرجات: قرارُ تشغيلٍ برمزه | التبعيات: InferenceEngine
 * الصلاحيات: التشغيلُ وحده — والمحرّكُ لا يرقّي حالةً ولا يمنح شهادة
 * حالات الفشل: تُقرأ برمزها (`INFERENCE_*`) لا بنصّها العربي المشكول
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md · docs/audit/criteria/C-13.md
 *
 * ثابتُ هذا الملف: **الاختبارُ يطلب تشغيلًا حقيقيًّا** في كل حالة، فما يُقاس هو
 * منعُ التشغيل لا الحجرُ عند التسجيل — وهو نصُّ ملاحظةِ التدقيق على C-13.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, referenceResponder, loadInference } from '../../src/index';
import type { ModelManifest } from '../../src/index';
import { resolveConfigDir } from '../../src/kernel/config';

const NOW = 1_800_000_000_000;
const config = loadInference(resolveConfigDir());
const digest = (seed: string): string => seed.padEnd(64, 'a').slice(0, 64).replace(/[^0-9a-f]/g, 'b');

type State = ReturnType<typeof bootstrapState>;

function manifestOf(modelId: string, version = '1.0.0'): ModelManifest {
  return {
    modelId,
    version,
    source: 'https://models.invalid/reference',
    license: 'apache-2.0',
    shards: [{ path: 'shard-0.bin', digest: digest(`${modelId}${version}`), bytes: 512 }],
    declaredCapabilities: ['text_generation'],
    signature: 'sig:test',
  };
}

/** يُسجّل النموذج ويُعتمد ويُنشّط — كلُّ خطوةٍ بسلطتها */
function activate(s: State, modelId: string, version = '1.0.0'): ModelManifest {
  const manifest = manifestOf(modelId, version);
  s.models.register(manifest);
  s.models.approve(s.king.issueCommand('approve_phase', `${modelId}@${version}`), modelId, version);
  s.models.activate(modelId, version);
  return manifest;
}

/** الطريقُ الكاملُ المستوفي: مُنشَّطٌ ومربوطٌ ومُشهَدٌ له */
function ready(s: State, modelId: string): ModelManifest {
  const manifest = activate(s, modelId);
  s.inference.bindRuntime(modelId, '1.0.0', manifest.shards.map((x) => x.digest), referenceResponder);
  s.inference.registerAttestation(s.safetyAttestor.attest(modelId, '1.0.0', referenceResponder, NOW));
  return manifest;
}

const PROMPT = 'ما الفرق بين نموذجٍ محجور ومعتمد ونشط؟';

test('نموذجٌ غير مسجَّلٍ لا يُشغَّل', () => {
  const s = bootstrapState();
  const out = s.inference.run('m:ghost', PROMPT, NOW);
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'INFERENCE_NOT_ACTIVE');
  assert.equal(out.output, null);
});

test('لا ربطَ أوزانٍ لإصدارٍ غير مسجَّل', () => {
  const s = bootstrapState();
  const bind = s.inference.bindRuntime('m:ghost', '1.0.0', [digest('x')], referenceResponder);
  assert.equal(bind.allowed, false);
  assert.equal(bind.code, 'INFERENCE_UNREGISTERED');
});

test('المحجورُ لا يُشغَّل ولو رُبطت أوزانُه — الربطُ ليس إذنًا', () => {
  const s = bootstrapState();
  const manifest = manifestOf('m:quarantined');
  s.models.register(manifest);
  const bind = s.inference.bindRuntime('m:quarantined', '1.0.0', manifest.shards.map((x) => x.digest), referenceResponder);
  assert.equal(bind.allowed, true);
  const out = s.inference.run('m:quarantined', PROMPT, NOW);
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'INFERENCE_NOT_ACTIVE');
});

test('المعتمدُ غيرُ المنشَّط لا يُشغَّل', () => {
  const s = bootstrapState();
  const manifest = manifestOf('m:approved');
  s.models.register(manifest);
  s.models.approve(s.king.issueCommand('approve_phase', 'm:approved@1.0.0'), 'm:approved', '1.0.0');
  s.inference.bindRuntime('m:approved', '1.0.0', manifest.shards.map((x) => x.digest), referenceResponder);
  const out = s.inference.run('m:approved', PROMPT, NOW);
  assert.equal(out.code, 'INFERENCE_NOT_ACTIVE');
});

test('بصمةُ أوزانٍ تخالف بيانَ التسجيل تُرفض عند الربط', () => {
  const s = bootstrapState();
  activate(s, 'm:mismatch');
  const bind = s.inference.bindRuntime('m:mismatch', '1.0.0', [digest('zzz')], referenceResponder);
  assert.equal(bind.allowed, false);
  assert.equal(bind.code, 'INFERENCE_DIGEST_MISMATCH');
  assert.equal(s.inference.run('m:mismatch', PROMPT, NOW).code, 'INFERENCE_NO_RUNTIME');
});

test('نشطٌ بلا أوزانٍ مربوطةٍ لا يُشغَّل', () => {
  const s = bootstrapState();
  activate(s, 'm:unbound');
  assert.equal(s.inference.run('m:unbound', PROMPT, NOW).code, 'INFERENCE_NO_RUNTIME');
});

test('نشطٌ مربوطٌ بلا شهادةِ سلامةٍ لا يُشغَّل — نصُّ C-13', () => {
  const s = bootstrapState();
  const manifest = activate(s, 'm:unattested');
  s.inference.bindRuntime('m:unattested', '1.0.0', manifest.shards.map((x) => x.digest), referenceResponder);
  const out = s.inference.run('m:unattested', PROMPT, NOW);
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'INFERENCE_NO_ATTESTATION');
});

test('المستوفي للشروطِ كلِّها يُشغَّل، وخرجُه وزمنُه يُقيَّدان', () => {
  const s = bootstrapState();
  ready(s, 'm:ok');
  const out = s.inference.run('m:ok', PROMPT, NOW);
  assert.equal(out.allowed, true);
  assert.equal(out.code, null);
  assert.equal(out.output, referenceResponder(PROMPT));
  assert.equal(out.version, '1.0.0');
  const logged = s.audit.snapshot().filter((e) => e.kind === 'model_inference_allowed');
  assert.equal(logged.length, 1);
});

test('شهادةٌ انتهت مدّتُها تمنع التشغيل', () => {
  const s = bootstrapState();
  ready(s, 'm:stale');
  const expiresAt = NOW + config.limits.attestationTtlMs;
  assert.equal(s.inference.run('m:stale', PROMPT, expiresAt - 1).allowed, true);
  assert.equal(s.inference.run('m:stale', PROMPT, expiresAt).code, 'INFERENCE_ATTESTATION_STALE');
});

test('شهادةٌ على مجموعةٍ غيرِ المعتمدةِ الآن تُرفض', () => {
  const s = bootstrapState();
  const manifest = activate(s, 'm:othersuite');
  s.inference.bindRuntime('m:othersuite', '1.0.0', manifest.shards.map((x) => x.digest), referenceResponder);
  const record = s.safetyAttestor.attest('m:othersuite', '1.0.0', referenceResponder, NOW);
  s.inference.registerAttestation({ ...record, suiteDigest: digest('other') });
  assert.equal(s.inference.run('m:othersuite', PROMPT, NOW).code, 'INFERENCE_SUITE_CHANGED');
});

test('الإبطالُ بين نداءين يمنع النداءَ الثاني', () => {
  const s = bootstrapState();
  ready(s, 'm:revoked');
  assert.equal(s.inference.run('m:revoked', PROMPT, NOW).allowed, true);
  s.models.revoke('m:revoked', '1.0.0', 'ministry:cyber_security', 'اختبارُ الإبطال');
  assert.equal(s.inference.run('m:revoked', PROMPT, NOW).code, 'INFERENCE_NOT_ACTIVE');
});

test('الإيقافُ يمنع الاستدلالَ فوق كل شرطٍ آخر', () => {
  const s = bootstrapState();
  ready(s, 'm:halt');
  s.killSwitch.engage('ministry:cyber_security', 'all', 'اختبارُ الإيقاف');
  const out = s.inference.run('m:halt', PROMPT, NOW);
  assert.equal(out.code, 'INFERENCE_HALTED');
});

test('خرجٌ فوق الحدِّ يُرفض ولا يُقتطع', () => {
  const s = bootstrapState();
  const manifest = activate(s, 'm:long');
  const long = (): string => 'ن'.repeat(config.limits.maxOutputChars + 1);
  s.inference.bindRuntime('m:long', '1.0.0', manifest.shards.map((x) => x.digest), long);
  s.inference.registerAttestation(s.safetyAttestor.attest('m:long', '1.0.0', referenceResponder, NOW));
  const out = s.inference.run('m:long', PROMPT, NOW);
  assert.equal(out.allowed, false);
  assert.equal(out.code, 'INFERENCE_OUTPUT_TOO_LONG');
  assert.equal(out.output, null);
});

test('استثناءٌ في الاستدلال يُعَدُّ رفضًا لا يُتجاهل', () => {
  const s = bootstrapState();
  const manifest = activate(s, 'm:throw');
  s.inference.bindRuntime('m:throw', '1.0.0', manifest.shards.map((x) => x.digest), () => {
    throw new Error('انفجارُ المُجيب');
  });
  s.inference.registerAttestation(s.safetyAttestor.attest('m:throw', '1.0.0', referenceResponder, NOW));
  assert.equal(s.inference.run('m:throw', PROMPT, NOW).code, 'INFERENCE_THROW');
});

test('سقفُ التزامن يُرفض عند بلوغه — ولو بنداءٍ متداخل', () => {
  const s = bootstrapState();
  const manifest = activate(s, 'm:nested');
  let depth = 0;
  const codes: (string | null)[] = [];
  const nested = (prompt: string): string => {
    depth += 1;
    if (depth <= config.limits.maxConcurrent + 1) {
      codes.push(s.inference.run('m:nested', prompt, NOW).code);
    }
    return referenceResponder(prompt);
  };
  s.inference.bindRuntime('m:nested', '1.0.0', manifest.shards.map((x) => x.digest), nested);
  s.inference.registerAttestation(s.safetyAttestor.attest('m:nested', '1.0.0', referenceResponder, NOW));
  s.inference.run('m:nested', PROMPT, NOW);
  assert.ok(codes.includes('INFERENCE_CONCURRENCY'), `الرموزُ المرصودة=${JSON.stringify(codes)}`);
});

test('تقريرُ المحرّك يعدّ السماحَ والرفضَ بالرمز، والسجلُّ يقابله', () => {
  const s = bootstrapState();
  ready(s, 'm:count');
  s.inference.run('m:count', PROMPT, NOW);
  s.inference.run('m:ghost', PROMPT, NOW);
  s.inference.run('m:ghost', PROMPT, NOW);
  const report = s.inference.report();
  assert.equal(report.allowed, 1);
  assert.equal(report.refused, 2);
  assert.equal(report.byCode.INFERENCE_NOT_ACTIVE, 2);
  assert.equal(report.attestations, 1);
  assert.equal(report.boundRuntimes, 1);
  const entries = s.audit.snapshot().filter(
    (e) => e.kind === 'model_inference_allowed' || e.kind === 'model_inference_refused',
  );
  assert.equal(entries.length, 3);
});

test('شهادةٌ بلا إصدارٍ معلنٍ مرفوضة', () => {
  const s = bootstrapState();
  const record = s.safetyAttestor.attest('m:x', '1.0.0', referenceResponder, NOW);
  assert.throws(
    () => s.inference.registerAttestation({ ...record, version: '' }),
    (e: { code?: string }) => e.code === 'INFERENCE_ATTESTATION_INVALID',
  );
});
