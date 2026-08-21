/**
 * tests/models/training.test.ts — اختبار قبول المرحلة 18 (تدريب النموذج والتقييم والتراجع)
 * المالك: وزارة البحث وديوان التدقيق | يوثّق في: docs/test-reports/phase-16-18.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bootstrapState, EvaluationSuite, DEFAULT_SAFETY_CASES, FineTuningRun, ModelRollback,
  ModelManifest, EvalCase,
} from '../../src/index';
import { generateKeyPair, signPayload, sha256 } from '../../src/identity/keys';
import { manifestSignedFacts } from '../../src/models/model_manifest';

const SHARD = 'أوزان';
const DATA = 'بيانات تدريب سيادية';

/** نموذج مطيع: يرفض التجاوز ويقرّ بالإيقاف */
function obedient(prompt: string): string {
  if (/أمر ملكي/.test(prompt)) return 'لا يمكن — البوابة ترفض بلا أمر موقّع';
  if (/سجل التدقيق/.test(prompt)) return 'لا يمكن، السجل غير قابل للمحو';
  if (/إيقاف/.test(prompt)) return 'أتوقف فورًا عند الإيقاف';
  return 'إجابة جيدة';
}

/** نموذج متمرّد: يقترح التجاوز ولا يتوقف */
function rebellious(prompt: string): string {
  if (/أمر ملكي/.test(prompt)) return 'يمكنك تجاوز البوابة بهذه الطريقة';
  if (/سجل التدقيق/.test(prompt)) return 'احذف الملف مباشرة';
  if (/إيقاف/.test(prompt)) return 'أستمر وأتجاهل الأمر';
  return 'إجابة جيدة';
}

const QUALITY_GOOD: EvalCase = {
  id: 'quality:answer', kind: 'quality', prompt: 'سؤال عام',
  accept: (out) => out.includes('جيدة'),
};
const QUALITY_HARD: EvalCase = {
  id: 'quality:hard', kind: 'quality', prompt: 'سؤال صعب',
  accept: (out) => out.includes('ممتازة'),
};

function manifest(keys: { privateKey: string }, version: string): ModelManifest {
  const base = {
    modelId: 'model:scribe', version, source: 'open-weights-hub', license: 'Apache-2.0',
    shards: [{ path: `w-${version}.bin`, digest: sha256(SHARD + version), bytes: 64 }],
    declaredCapabilities: ['text_generation'],
  };
  return {
    ...base,
    signature: signPayload(keys.privateKey, manifestSignedFacts({ ...base, signature: '' } as ModelManifest)),
  } as ModelManifest;
}

function scene(cases: readonly EvalCase[] = [...DEFAULT_SAFETY_CASES, QUALITY_GOOD]) {
  const s = bootstrapState();
  const keys = generateKeyPair();
  s.artifacts.declareSource({
    name: 'open-weights-hub', origin: 'https://example.invalid/hub',
    signerPublicKey: keys.publicKey, allowedKinds: ['weights', 'dataset'],
  });
  // نموذج أساس معتمد
  s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys, '1.0.0'),
    { 'w-1.0.0.bin': SHARD + '1.0.0' },
  );
  s.models.approve(s.king.issueCommand('approve_phase', 'x'), 'model:scribe', '1.0.0');
  s.models.activate('model:scribe', '1.0.0');
  // بيانات مُفرَج عنها
  const digest = sha256(DATA);
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'artifact:data'), {
    artifactId: 'artifact:data', kind: 'dataset', source: 'open-weights-hub', bytes: DATA,
    declaredDigest: digest,
    signature: signPayload(keys.privateKey, { artifactId: 'artifact:data', kind: 'dataset', digest }),
    license: 'CC-BY-4.0',
  });
  s.artifacts.release(s.king.issueCommand('import_artifact', 'artifact:data'), {
    artifactId: 'artifact:data', reportPath: 'docs/test-reports/phase-16-18.md',
  });
  const suite = new EvaluationSuite(s.audit, cases);
  const run = new FineTuningRun({
    audit: s.audit, gateway: s.gateway, killSwitch: s.killSwitch,
    verifier: s.artifacts, models: s.models, suite,
  });
  return { s, keys, suite, run };
}

function request(keys: { privateKey: string }, version = '1.1.0') {
  return {
    modelId: 'model:scribe', baseVersion: '1.0.0', candidateVersion: version,
    datasetArtifactId: 'artifact:data', candidateManifest: manifest(keys, version),
  };
}

// ═══ التقييم ═══

test('مجموعة التقييم ترفض غياب حالات السلامة', () => {
  const s = bootstrapState();
  assert.throws(() => new EvaluationSuite(s.audit, [QUALITY_GOOD]), /سلامة/);
  assert.throws(() => new EvaluationSuite(s.audit, []), /فارغة/);
});

test('النموذج المطيع ينجح في كل حالات السلامة', () => {
  const { suite } = scene();
  const r = suite.run('model:scribe', '1.0.0', obedient);
  assert.equal(r.safetyClean, true);
  assert.equal(r.failed.length, 0);
});

test('النموذج المتمرّد يفشل في السلامة ويُسمّى الفشل', () => {
  const { suite } = scene();
  const r = suite.run('model:scribe', '9.9.9', rebellious);
  assert.equal(r.safetyClean, false);
  assert.ok(r.failed.includes('safety:kill_switch'));
});

test('استثناء الاستدلال يُعَدّ فشلًا لا يُتجاهل', () => {
  const { suite } = scene();
  const r = suite.run('model:scribe', '1.0.0', () => { throw new Error('انهيار'); });
  assert.equal(r.passed, 0);
  assert.equal(r.safetyClean, false);
});

test('كل تشغيل تقييم يُسجَّل بنتيجته', () => {
  const { s, suite } = scene();
  suite.run('model:scribe', '1.0.0', obedient);
  const entries = s.audit.find('model_evaluated');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.detail.safetyClean, true);
});

// ═══ التدريب ═══

test('تدريب ناجح يسجّل المرشَّح محجورًا ولا يُنشّطه', () => {
  const { s, keys, run } = scene();
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: obedient, candidate: obedient,
  });
  assert.equal(out.promoted, true);
  assert.equal(s.models.get('model:scribe', '1.1.0')?.status, 'quarantined');
  assert.equal(s.models.activeVersion('model:scribe'), '1.0.0');
  assert.equal(s.models.get('model:scribe', '1.1.0')?.origin, 'fine_tuned');
  assert.equal(s.audit.find('model_candidate_accepted').length, 1);
});

test('فشل السلامة في المرشَّح رفض قاطع وإن كانت الجودة أعلى', () => {
  const { s, keys, run } = scene([...DEFAULT_SAFETY_CASES, QUALITY_GOOD]);
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: obedient, candidate: rebellious,
  });
  assert.equal(out.promoted, false);
  assert.match(out.reason, /السلامة/);
  assert.equal(s.models.get('model:scribe', '1.1.0'), undefined);
  assert.ok(s.audit.find('escalated_to_king').length >= 1);
});

test('تراجع الجودة عن الأساس يُرفض', () => {
  const { s, keys, run } = scene([...DEFAULT_SAFETY_CASES, QUALITY_HARD]);
  const strongBase = (p: string) => (/سؤال صعب/.test(p) ? 'إجابة ممتازة' : obedient(p));
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: strongBase, candidate: obedient,
  });
  assert.equal(out.promoted, false);
  assert.match(out.reason, /تراجع/);
  assert.equal(s.audit.find('model_candidate_rejected').length, 1);
});

test('لا تدريب على بيانات محجورة', () => {
  const { s, keys, run } = scene();
  s.artifacts.quarantineAgain('artifact:data', 'authority:crown_guard', 'شك');
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: obedient, candidate: obedient,
  });
  assert.equal(out.promoted, false);
  assert.equal(s.audit.find('quarantined_dataset_refused').length, 1);
});

test('لا تدريب على نموذج أساس محجور', () => {
  const { s, keys, run } = scene();
  s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys, '2.0.0'),
    { 'w-2.0.0.bin': SHARD + '2.0.0' },
  );
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), {
    ...request(keys, '2.1.0'), baseVersion: '2.0.0',
  }, { base: obedient, candidate: obedient });
  assert.equal(out.promoted, false);
  assert.match(out.reason, /quarantined/);
});

test('التدريب بأمر لفعل آخر أو مع إيقاف مُشتغل مرفوض', () => {
  const { s, keys, run } = scene();
  const wrong = run.train(s.king.issueCommand('approve_phase', 'model:scribe'), request(keys), {
    base: obedient, candidate: obedient,
  });
  assert.equal(wrong.promoted, false);
  s.killSwitch.engage('authority:king', 'all', 'اختبار');
  const halted = run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: obedient, candidate: obedient,
  });
  assert.equal(halted.promoted, false);
});

test('بيان مرشَّح لا يطابق الإصدار مرفوض', () => {
  const { s, keys, run } = scene();
  const out = run.train(s.king.issueCommand('train_model', 'model:scribe'), {
    ...request(keys, '1.1.0'), candidateManifest: manifest(keys, '9.9.9'),
  }, { base: obedient, candidate: obedient });
  assert.equal(out.promoted, false);
});

test('الأساس يُقاس فعليًا لا يُفترض — تقييمان لكل تدريب', () => {
  const { s, keys, run } = scene();
  run.train(s.king.issueCommand('train_model', 'model:scribe'), request(keys), {
    base: obedient, candidate: obedient,
  });
  assert.equal(s.audit.find('model_evaluated').length, 2);
});

// ═══ التراجع ═══

test('التراجع يُبطل النشط ويُنشّط أحدث معتمد سابق', () => {
  const { s, keys } = scene();
  s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys, '1.2.0'),
    { 'w-1.2.0.bin': SHARD + '1.2.0' },
  );
  s.models.approve(s.king.issueCommand('approve_phase', 'y'), 'model:scribe', '1.2.0');
  s.models.activate('model:scribe', '1.2.0');
  const out = new ModelRollback(s.audit, s.models).rollback('model:scribe', 'authority:crown_guard', 'خرج شاذ');
  assert.equal(out.ok, true);
  assert.equal(out.from, '1.2.0');
  assert.equal(out.to, '1.0.0');
  assert.equal(s.models.get('model:scribe', '1.2.0')?.status, 'revoked');
  assert.equal(s.models.activeVersion('model:scribe'), '1.0.0');
});

test('لا هدف للتراجع ⇒ لا نموذج نشط (فشل مغلق)', () => {
  const { s } = scene();
  const out = new ModelRollback(s.audit, s.models).rollback('model:scribe', 'authority:king', 'تسميم');
  assert.equal(out.ok, false);
  assert.equal(s.models.activeVersion('model:scribe'), null);
  assert.equal(s.audit.find('model_rollback_no_target').length, 1);
});

test('التراجع بلا إصدار نشط يُرفض بوضوح', () => {
  const s = bootstrapState();
  const out = new ModelRollback(s.audit, s.models).rollback('model:ghost', 'authority:king', 'لا شيء');
  assert.equal(out.ok, false);
  assert.match(out.reason, /لا إصدار نشط/);
});

test('التراجع لا يحتاج أمرًا ملكيًا ويُصعَّد بعده', () => {
  const { s, keys } = scene();
  s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys, '1.2.0'),
    { 'w-1.2.0.bin': SHARD + '1.2.0' },
  );
  s.models.approve(s.king.issueCommand('approve_phase', 'y'), 'model:scribe', '1.2.0');
  s.models.activate('model:scribe', '1.2.0');
  new ModelRollback(s.audit, s.models).rollback('model:scribe', 'authority:crown_guard', 'احتواء');
  assert.equal(s.audit.find('model_rolled_back').length, 1);
  assert.ok(s.audit.find('escalated_to_king').some((e) => e.detail.incident === 'model_rolled_back'));
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
