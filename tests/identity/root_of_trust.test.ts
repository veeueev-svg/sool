/**
 * tests/identity/root_of_trust.test.ts — اختبارات قبول المرحلتين 3 و4
 * المالك: وزارة الهوية | التقرير: docs/test-reports/phase-01-10.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { CertificateAuthority } from '../../src/identity/certificate_authority';
import { IdentityRegistry } from '../../src/identity/registry';
import { KingIdentity } from '../../src/identity/king_identity';
import { generateKeyPair, verifyPayload } from '../../src/identity/keys';
import { SovereignViolation } from '../../src/kernel/types';

test('جذر الثقة يصدر شهادة صالحة ويتحقق منها', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const kp = generateKeyPair();
  const cert = ca.issue('agent:001', 'agent', kp.publicKey);
  assert.equal(ca.validate(cert).valid, true);
});

test('شهادة مبطلة تُرفض', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const cert = ca.issue('agent:002', 'agent', generateKeyPair().publicKey);
  ca.revoke(cert.certId, 'سلوك مشتبه');
  const res = ca.validate(cert);
  assert.equal(res.valid, false);
  assert.match(res.reason, /مبطلة/);
});

test('شهادة منتهية تُرفض', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const cert = ca.issue('agent:003', 'agent', generateKeyPair().publicKey, 1000);
  assert.equal(ca.validate(cert, Date.now() + 5000).valid, false);
});

test('شهادة معدَّلة يدويًا تُرفض (توقيع الجذر لا يطابق)', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const cert = ca.issue('agent:004', 'agent', generateKeyPair().publicKey);
  const tampered = { ...cert, role: 'king' as const };
  assert.equal(ca.validate(tampered).valid, false);
});

test('لا يجوز إصدار هوية ملك ثانية', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  new KingIdentity('king:sool:001', ca, registry);
  assert.throws(
    () => new KingIdentity('king:sool:002', ca, registry),
    (e: unknown) => e instanceof SovereignViolation && (e as SovereignViolation).code === 'CA_SECOND_KING',
  );
  assert.equal(registry.list('king').length, 1);
});

test('توقيع الملك يُتحقق منه، وتغيير حرف واحد يُبطله', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  const king = new KingIdentity('king:sool:001', ca, registry);
  const cmd = king.issueCommand('create_agent', 'agent:new');
  assert.equal(verifyPayload(king.publicKey, cmd.payload, cmd.signature), true);
  const altered = { ...cmd.payload, target: 'agent:other' };
  assert.equal(verifyPayload(king.publicKey, altered, cmd.signature), false);
});

test('هوية الملك لا تُحذف من السجل', () => {
  const audit = new AppendOnlyLog();
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  const king = new KingIdentity('king:sool:001', ca, registry);
  assert.throws(() => registry.remove(king.kingId, 'محاولة'), /الملك/);
});
