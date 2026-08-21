/**
 * tests/models/model_registry.test.ts — اختبار قبول المرحلة 17 (استيراد نموذج مفتوح الأوزان)
 * المالك: وزارة البحث | يوثّق في: docs/test-reports/phase-16-18.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, validateManifest, ModelManifest } from '../../src/index';
import { generateKeyPair, signPayload, sha256 } from '../../src/identity/keys';
import { manifestSignedFacts } from '../../src/models/model_manifest';

const SHARD_A = 'أوزان الشريحة الأولى';
const SHARD_B = 'أوزان الشريحة الثانية';

function scene() {
  const s = bootstrapState();
  const keys = generateKeyPair();
  s.artifacts.declareSource({
    name: 'open-weights-hub',
    origin: 'https://example.invalid/hub',
    signerPublicKey: keys.publicKey,
    allowedKinds: ['weights'],
  });
  return { s, keys };
}

function manifest(keys: { privateKey: string }, over: Partial<ModelManifest> = {}): ModelManifest {
  const base = {
    modelId: over.modelId ?? 'model:scribe',
    version: over.version ?? '1.0.0',
    source: over.source ?? 'open-weights-hub',
    license: over.license ?? 'Apache-2.0',
    shards: over.shards ?? [
      { path: 'shard-a.bin', digest: sha256(SHARD_A), bytes: 128 },
      { path: 'shard-b.bin', digest: sha256(SHARD_B), bytes: 256 },
    ],
    declaredCapabilities: over.declaredCapabilities ?? ['text_generation'],
  };
  const signature = over.signature ?? signPayload(keys.privateKey, manifestSignedFacts({
    ...base, signature: '',
  } as ModelManifest));
  return { ...base, signature } as ModelManifest;
}

const BYTES = { 'shard-a.bin': SHARD_A, 'shard-b.bin': SHARD_B };

// ═══ البيان ═══

test('بيان سليم يُقبل', () => {
  const { keys } = scene();
  assert.equal(validateManifest(manifest(keys)).valid, true);
});

test('بيان بلا شرائح مرفوض', () => {
  const { keys } = scene();
  const check = validateManifest(manifest(keys, { shards: [] }));
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => /لا شرائح/.test(e)));
});

test('بصمة شريحة غير سليمة الشكل مرفوضة', () => {
  const { keys } = scene();
  const check = validateManifest(manifest(keys, {
    shards: [{ path: 'a.bin', digest: 'قصيرة', bytes: 10 }],
  }));
  assert.equal(check.valid, false);
});

test('حجم شريحة صفر مرفوض', () => {
  const { keys } = scene();
  const check = validateManifest(manifest(keys, {
    shards: [{ path: 'a.bin', digest: sha256(SHARD_A), bytes: 0 }],
  }));
  assert.equal(check.valid, false);
});

test('قدرة غير معروفة تُبطل البيان', () => {
  const { keys } = scene();
  const check = validateManifest(manifest(keys, { declaredCapabilities: ['self_replication'] }));
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => /غير معروفة/.test(e)));
});

test('بيان بلا رخصة أو إصدار غير قياسي مرفوض', () => {
  const { keys } = scene();
  assert.equal(validateManifest(manifest(keys, { license: '' })).valid, false);
  assert.equal(validateManifest(manifest(keys, { version: 'v1' })).valid, false);
});

test('مسار شريحة مكرّر مرفوض', () => {
  const { keys } = scene();
  const check = validateManifest(manifest(keys, {
    shards: [
      { path: 'a.bin', digest: sha256(SHARD_A), bytes: 1 },
      { path: 'a.bin', digest: sha256(SHARD_B), bytes: 1 },
    ],
  }));
  assert.equal(check.valid, false);
});

// ═══ الاستيراد ═══

test('استيراد ناجح يسجّل النموذج محجورًا لا نشطًا', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(keys), BYTES);
  assert.equal(d.allowed, true);
  assert.equal(s.models.get('model:scribe', '1.0.0')?.status, 'quarantined');
  assert.equal(s.models.activeVersion('model:scribe'), null);
  assert.equal(s.audit.find('weights_imported').length, 1);
});

test('شريحة واحدة مختلفة البصمة تُبطل الاستيراد كله', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(keys), {
    'shard-a.bin': SHARD_A, 'shard-b.bin': 'أوزان مبدَّلة',
  });
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('shard_digest_mismatch').length, 1);
  assert.equal(s.models.get('model:scribe', '1.0.0'), undefined);
});

test('شريحة معلنة وبايتاتها غائبة تُرفض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(keys), { 'shard-a.bin': SHARD_A });
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('shard_missing').length, 1);
});

test('توقيع بيان غريب مرفوض', () => {
  const { s } = scene();
  const stranger = generateKeyPair();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(stranger), BYTES);
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('manifest_signature_invalid').length, 1);
});

test('مصدر أوزان غير معلن مرفوض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(keys, { source: 'shadow-hub' }), BYTES);
  assert.equal(d.allowed, false);
});

test('بيان غير صالح يُرفض قبل أي فحص بايتات', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'model:scribe');
  const d = s.weightsImporter.import(cmd, manifest(keys, { license: '' }), BYTES);
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('manifest_invalid').length, 1);
});

// ═══ دورة الاعتماد ═══

function imported() {
  const { s, keys } = scene();
  s.weightsImporter.import(s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys), BYTES);
  return { s, keys };
}

test('لا تنشيط لنموذج محجور', () => {
  const { s } = imported();
  const d = s.models.activate('model:scribe', '1.0.0');
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('model_activation_refused').length, 1);
});

test('الاعتماد بأمر ملكي ثم التنشيط', () => {
  const { s } = imported();
  const ap = s.models.approve(s.king.issueCommand('approve_phase', 'model:scribe@1.0.0'), 'model:scribe', '1.0.0');
  assert.equal(ap.allowed, true);
  assert.equal(s.models.activate('model:scribe', '1.0.0').allowed, true);
  assert.equal(s.models.activeVersion('model:scribe'), '1.0.0');
});

test('الاعتماد بفعل لا يخصّه مرفوض', () => {
  const { s } = imported();
  const ap = s.models.approve(s.king.issueCommand('train_model', 'model:scribe'), 'model:scribe', '1.0.0');
  assert.equal(ap.allowed, false);
});

test('نموذج نشط واحد لكل معرّف', () => {
  const { s, keys } = imported();
  s.models.approve(s.king.issueCommand('approve_phase', 'x'), 'model:scribe', '1.0.0');
  s.models.activate('model:scribe', '1.0.0');
  s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'),
    manifest(keys, { version: '1.1.0' }), BYTES,
  );
  s.models.approve(s.king.issueCommand('approve_phase', 'y'), 'model:scribe', '1.1.0');
  s.models.activate('model:scribe', '1.1.0');
  assert.equal(s.models.activeVersion('model:scribe'), '1.1.0');
  assert.equal(s.models.get('model:scribe', '1.0.0')?.status, 'approved');
  assert.equal(s.models.report().byStatus.active, 1);
});

test('الإبطال فوري ويُخلي النشاط ولا يُعاد الاعتماد بعده', () => {
  const { s } = imported();
  s.models.approve(s.king.issueCommand('approve_phase', 'x'), 'model:scribe', '1.0.0');
  s.models.activate('model:scribe', '1.0.0');
  assert.equal(s.models.revoke('model:scribe', '1.0.0', 'authority:crown_guard', 'سلوك مسمَّم').allowed, true);
  assert.equal(s.models.activeVersion('model:scribe'), null);
  const ap = s.models.approve(s.king.issueCommand('approve_phase', 'z'), 'model:scribe', '1.0.0');
  assert.equal(ap.allowed, false);
  assert.equal(s.models.activate('model:scribe', '1.0.0').allowed, false);
});

test('الإيقاف يمنع التنشيط ولا يمنع الإبطال', () => {
  const { s } = imported();
  s.models.approve(s.king.issueCommand('approve_phase', 'x'), 'model:scribe', '1.0.0');
  s.killSwitch.engage('authority:king', 'all', 'اختبار');
  assert.equal(s.models.activate('model:scribe', '1.0.0').allowed, false);
  assert.equal(s.models.revoke('model:scribe', '1.0.0', 'authority:king', 'احتواء').allowed, true);
});

test('تكرار الإصدار مرفوض والسجل يبقى سليمًا', () => {
  const { s, keys } = imported();
  const d = s.weightsImporter.import(
    s.king.issueCommand('import_artifact', 'model:scribe'), manifest(keys), BYTES,
  );
  assert.equal(d.allowed, false);
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
