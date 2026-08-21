/**
 * tests/models/source_verification.test.ts — اختبار قبول المرحلة 16 (استيراد وكيل مفتوح المصدر)
 * المالك: وزارة البحث | يوثّق في: docs/test-reports/phase-16-18.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, AgentImporter } from '../../src/index';
import { generateKeyPair, signPayload, sha256 } from '../../src/identity/keys';
import { ExternalArtifact, ArtifactKind } from '../../src/models/source_verification';

const BYTES = 'وكيل مفتوح المصدر — شيفرة تجريبية';

function scene(opts: { kinds?: readonly ArtifactKind[] } = {}) {
  const s = bootstrapState();
  const keys = generateKeyPair();
  s.artifacts.declareSource({
    name: 'open-forge',
    origin: 'https://example.invalid/open-forge',
    signerPublicKey: keys.publicKey,
    allowedKinds: opts.kinds ?? ['agent', 'weights', 'dataset'],
  });
  return { s, keys };
}

function artifact(
  keys: { privateKey: string },
  over: Partial<ExternalArtifact> = {},
): ExternalArtifact {
  const bytes = over.bytes ?? BYTES;
  const artifactId = over.artifactId ?? 'artifact:agent-001';
  const kind = over.kind ?? 'agent';
  const digest = over.declaredDigest ?? sha256(bytes);
  return {
    artifactId, kind, source: 'open-forge', bytes,
    declaredDigest: digest,
    signature: signPayload(keys.privateKey, { artifactId, kind, digest: sha256(bytes) }),
    license: 'Apache-2.0',
    ...over,
  };
}

// ═══ التحقق والحجر ═══

test('الأثر الصحيح يُحجر ولا يُفرج عنه تلقائيًا', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(keys));
  assert.equal(d.allowed, true);
  assert.equal(s.artifacts.get('artifact:agent-001')?.status, 'quarantined');
  assert.equal(s.artifacts.isReleased('artifact:agent-001'), false);
  assert.equal(s.audit.find('artifact_quarantined').length, 1);
  assert.equal(s.audit.find('artifact_released').length, 0);
});

test('مصدر غير معلن مرفوض — قائمة سماح لا حظر', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:x');
  const d = s.artifacts.verify(cmd, artifact(keys, { artifactId: 'artifact:x', source: 'unknown-hub' }));
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('unknown_source_refused').length, 1);
});

test('نوع غير مسموح من المصدر مرفوض', () => {
  const { s, keys } = scene({ kinds: ['dataset'] });
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(keys));
  assert.equal(d.allowed, false);
  assert.match(d.reason, /لا يُسمح منه/);
});

test('بصمة معلنة مخالفة للمحسوبة تُرفض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(keys, { declaredDigest: 'a'.repeat(64) }));
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('artifact_digest_mismatch').length, 1);
});

test('أثر غير موقَّع مرفوض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(keys, { signature: '' }));
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('unsigned_artifact_refused').length, 1);
});

test('توقيع بمفتاح غريب مرفوض', () => {
  const { s } = scene();
  const stranger = generateKeyPair();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(stranger));
  assert.equal(d.allowed, false);
  assert.equal(s.audit.find('artifact_signature_invalid').length, 1);
});

test('أثر بلا رخصة مرفوض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const d = s.artifacts.verify(cmd, artifact(keys, { license: '' }));
  assert.equal(d.allowed, false);
  assert.match(d.reason, /رخصة/);
});

test('استيراد بأمر لفعل آخر مرفوض', () => {
  const { s, keys } = scene();
  const cmd = s.king.issueCommand('create_agent', 'artifact:agent-001');
  assert.equal(s.artifacts.verify(cmd, artifact(keys)).allowed, false);
});

test('الإيقاف يمنع الاستيراد', () => {
  const { s, keys } = scene();
  s.killSwitch.engage('authority:king', 'all', 'اختبار');
  const cmd = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  assert.equal(s.artifacts.verify(cmd, artifact(keys)).allowed, false);
});

test('تكرار معرّف الأثر مرفوض', () => {
  const { s, keys } = scene();
  const c1 = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  assert.equal(s.artifacts.verify(c1, artifact(keys)).allowed, true);
  const c2 = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  assert.equal(s.artifacts.verify(c2, artifact(keys)).allowed, false);
});

// ═══ الإفراج ═══

test('الإفراج يحتاج أمرًا ثانيًا وتقرير فحص', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  const rel = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const bad = s.artifacts.release(rel, { artifactId: 'artifact:agent-001', reportPath: '' });
  assert.equal(bad.allowed, false);
  const rel2 = s.king.issueCommand('import_artifact', 'artifact:agent-001');
  const ok = s.artifacts.release(rel2, {
    artifactId: 'artifact:agent-001', reportPath: 'docs/test-reports/phase-16-18.md',
  });
  assert.equal(ok.allowed, true);
  assert.equal(s.artifacts.isReleased('artifact:agent-001'), true);
});

test('لا إفراج عن أثر مرفوض أو غير مسجَّل', () => {
  const { s } = scene();
  const rel = s.king.issueCommand('import_artifact', 'artifact:ghost');
  assert.equal(s.artifacts.release(rel, { artifactId: 'artifact:ghost', reportPath: 'p.md' }).allowed, false);
});

test('إعادة الحجر تُصعَّد إلى الملك', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  s.artifacts.release(s.king.issueCommand('import_artifact', 'a'), {
    artifactId: 'artifact:agent-001', reportPath: 'p.md',
  });
  assert.equal(s.artifacts.quarantineAgain('artifact:agent-001', 'authority:crown_guard', 'سلوك شاذ'), true);
  assert.equal(s.artifacts.get('artifact:agent-001')?.status, 'quarantined');
  assert.equal(s.audit.find('artifact_requarantined').length, 1);
  assert.ok(s.audit.find('escalated_to_king').length >= 1);
});

// ═══ الاستيراد كوكيل ═══

function importer(s: ReturnType<typeof bootstrapState>) {
  return new AgentImporter({
    audit: s.audit, verifier: s.artifacts, agents: s.agents,
    permissions: s.permissions, killSwitch: s.killSwitch,
  });
}

test('وكيل مُفرَج عنه يُسجَّل بصفر قدرات وبأصل موثّق', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  s.artifacts.release(s.king.issueCommand('import_artifact', 'a'), {
    artifactId: 'artifact:agent-001', reportPath: 'p.md',
  });
  const res = importer(s).load(s.king.issueCommand('create_agent', 'agent:imported-1'), {
    artifactId: 'artifact:agent-001', agentId: 'agent:imported-1',
    template: 'limited_worker', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, true);
  assert.equal(s.permissions.granted('agent:imported-1', Date.now()).length, 0);
  const audited = s.audit.find('imported_agent_registered');
  assert.equal(audited.length, 1);
  assert.equal(audited[0]?.detail.digest, sha256(BYTES));
});

test('لا تشغيل من الحجر — الأثر المحجور لا يُسجَّل وكيلًا', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  const res = importer(s).load(s.king.issueCommand('create_agent', 'agent:imported-1'), {
    artifactId: 'artifact:agent-001', agentId: 'agent:imported-1',
    template: 'limited_worker', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
  assert.equal(s.audit.find('quarantined_load_refused').length, 1);
});

test('أثر أوزان لا يُسجَّل وكيلًا', () => {
  const { s, keys } = scene();
  const art = artifact(keys, { artifactId: 'artifact:w', kind: 'weights' });
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'artifact:w'), art);
  s.artifacts.release(s.king.issueCommand('import_artifact', 'artifact:w'), {
    artifactId: 'artifact:w', reportPath: 'p.md',
  });
  const res = importer(s).load(s.king.issueCommand('create_agent', 'agent:x'), {
    artifactId: 'artifact:w', agentId: 'agent:x',
    template: 'limited_worker', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
});

test('قالب دور غير معلن يُرفض', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  s.artifacts.release(s.king.issueCommand('import_artifact', 'a'), {
    artifactId: 'artifact:agent-001', reportPath: 'p.md',
  });
  const res = importer(s).load(s.king.issueCommand('create_agent', 'agent:imported-1'), {
    artifactId: 'artifact:agent-001', agentId: 'agent:imported-1',
    template: 'god_mode', supervisor: 'ministry:interior',
  });
  assert.equal(res.ok, false);
});

test('أصل الوكيل المستورد يبقى معروفًا بعد التسجيل', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  s.artifacts.release(s.king.issueCommand('import_artifact', 'a'), {
    artifactId: 'artifact:agent-001', reportPath: 'p.md',
  });
  const imp = importer(s);
  imp.load(s.king.issueCommand('create_agent', 'agent:imported-1'), {
    artifactId: 'artifact:agent-001', agentId: 'agent:imported-1',
    template: 'limited_worker', supervisor: 'ministry:interior',
  });
  const origin = imp.originOf('agent:imported-1');
  assert.equal(origin?.license, 'Apache-2.0');
  assert.equal(origin?.artifactId, 'artifact:agent-001');
});

test('سجل التدقيق يبقى سليمًا بعد كل عمليات الاستيراد', () => {
  const { s, keys } = scene();
  s.artifacts.verify(s.king.issueCommand('import_artifact', 'a'), artifact(keys));
  assert.equal(s.audit.verifyIntegrity().valid, true);
});
