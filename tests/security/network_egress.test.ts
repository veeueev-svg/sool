/**
 * tests/security/network_egress.test.ts — اختبار قبول المرحلة 11 (منع الخروج غير المعلن)
 * المالك: وزارة الأمن السيبراني | يوثّق في: docs/test-reports/phase-11-12.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { ResourceRegistry } from '../../src/kernel/resource_registry';
import { NetworkEgressGuard } from '../../src/external/network_egress';
import { CrownGateway } from '../../src/crown/crown_gateway';

/** سجل موارد يسمح بنداءات خروج — لإثبات أن المسار المصرَّح به يعمل */
function permissiveResources(audit: AppendOnlyLog): ResourceRegistry {
  return new ResourceRegistry(audit, {
    egress_calls: { total: 100, per_agent_max: 50, lease_seconds: 60 },
  });
}

test('الافتراض رفض: مضيف غير معلن يُرفض ويُسجَّل كمحاولة غير معلنة', () => {
  const s = bootstrapState();
  const d = s.egress.request('agent:1', { host: 'evil.example.com' });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /غير معلن/);
  assert.equal(s.audit.find('unannounced_egress_attempt').length, 1);
  assert.deepEqual(s.egress.report().unannouncedHosts, ['evil.example.com']);
});

test('تكرار محاولات غير معلنة يُحتوي القناة الخارجية ويُصعَّد للملك', () => {
  const s = bootstrapState();
  for (let i = 0; i < 3; i++) s.egress.request('agent:1', { host: 'evil.example.com' });
  assert.equal(s.egress.isContained, true);
  assert.equal(s.killSwitch.status.engaged, true);
  assert.equal(s.killSwitch.status.scope, 'external');
  assert.ok(s.audit.find('escalated_to_king').length >= 1);
  // وبعد الاحتواء لا يُقبل حتى مضيف آخر
  assert.equal(s.egress.request('agent:2', { host: 'other.example.com' }).allowed, false);
});

test('إذن الخروج لا يُقبل إلا بأمر ملكي معتمد من البوابة', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('open_external_account', 'external:api');
  const forged = { ...cmd, payload: { ...cmd.payload, issuedBy: 'agent:rogue' } };
  const d = s.egress.declare(forged, {
    host: 'api.example.com', port: 443, purpose: 'اختبار', expiresAt: Date.now() + 60_000, maxCallsPerMinute: 5,
  });
  assert.equal(d.allowed, false);
  assert.equal(s.egress.report().allowances.length, 0);
  assert.equal(s.audit.find('egress_allowance_refused').length, 1);
});

test('إذن بلا تاريخ انتهاء صالح أو بلا سقف نداءات يُرفض (لا إذن دائم)', () => {
  const s = bootstrapState();
  const now = Date.now();
  const noExpiry = s.egress.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'a.example.com', port: 443, purpose: 'x', expiresAt: now - 1, maxCallsPerMinute: 5 }, now,
  );
  const noCap = s.egress.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'b.example.com', port: 443, purpose: 'x', expiresAt: now + 60_000, maxCallsPerMinute: 0 }, now,
  );
  assert.equal(noExpiry.allowed, false);
  assert.equal(noCap.allowed, false);
  assert.equal(s.egress.report().allowances.length, 0);
});

test('فعل ملكي لا يخصّ القناة الخارجية لا يصلح لإعلان إذن خروج', () => {
  const s = bootstrapState();
  const now = Date.now();
  const d = s.egress.declare(
    s.king.issueCommand('approve_phase', 'phase:11'),
    { host: 'c.example.com', port: 443, purpose: 'x', expiresAt: now + 60_000, maxCallsPerMinute: 5 }, now,
  );
  assert.equal(d.allowed, false);
  assert.match(d.reason, /لا يخصّ/);
});

test('بالتهيئة الرسمية حتى المضيف المعلن يُرفض لأن حصة الخروج صفر', () => {
  const s = bootstrapState();
  const now = Date.now();
  const declared = s.egress.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'api.example.com', port: 443, purpose: 'تحديثات', expiresAt: now + 600_000, maxCallsPerMinute: 5 }, now,
  );
  assert.equal(declared.allowed, true, 'الإعلان نفسه صحيح');
  const call = s.egress.request('agent:1', { host: 'api.example.com' }, now);
  assert.equal(call.allowed, false);
  assert.match(call.reason, /حصة الخروج/);
});

test('المسار المصرَّح به يعمل حين تُرفع الحصة صراحةً، ويحترم سقف النداءات', () => {
  const s = bootstrapState();
  const audit = s.audit;
  const guard = new NetworkEgressGuard(audit, s.gateway, s.killSwitch, {
    resources: permissiveResources(audit),
  });
  const now = Date.now();
  assert.equal(guard.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'api.example.com', port: 443, purpose: 'تحديثات', expiresAt: now + 600_000, maxCallsPerMinute: 2 }, now,
  ).allowed, true);

  assert.equal(guard.request('agent:1', { host: 'api.example.com' }, now).allowed, true);
  assert.equal(guard.request('agent:1', { host: 'api.example.com' }, now + 1).allowed, true);
  const third = guard.request('agent:1', { host: 'api.example.com' }, now + 2);
  assert.equal(third.allowed, false);
  assert.match(third.reason, /سقف النداءات/);
  assert.equal(guard.report().allowedCalls, 2);
});

test('انتهاء مدة الإذن يمنع الخروج بلا تمديد ضمني', () => {
  const s = bootstrapState();
  const audit = s.audit;
  const guard = new NetworkEgressGuard(audit, s.gateway, s.killSwitch, {
    resources: permissiveResources(audit),
  });
  const now = Date.now();
  guard.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'api.example.com', port: 443, purpose: 'x', expiresAt: now + 1000, maxCallsPerMinute: 5 }, now,
  );
  assert.equal(guard.request('agent:1', { host: 'api.example.com' }, now + 500).allowed, true);
  const after = guard.request('agent:1', { host: 'api.example.com' }, now + 2000);
  assert.equal(after.allowed, false);
  assert.match(after.reason, /انتهت مدة/);
});

test('بروتوكول غير https مرفوض دائمًا حتى لمضيف معلن', () => {
  const s = bootstrapState();
  const audit = s.audit;
  const guard = new NetworkEgressGuard(audit, s.gateway, s.killSwitch, {
    resources: permissiveResources(audit),
  });
  const now = Date.now();
  guard.declare(
    s.king.issueCommand('open_external_account', 'external:api'),
    { host: 'api.example.com', port: 443, purpose: 'x', expiresAt: now + 60_000, maxCallsPerMinute: 5 }, now,
  );
  const d = guard.request('agent:1', { host: 'api.example.com', protocol: 'http' }, now);
  assert.equal(d.allowed, false);
  assert.match(d.reason, /بروتوكول/);
});

test('وضع الحماية يمنع كل خروج مهما كان الإذن', () => {
  const audit = new AppendOnlyLog();
  const protectiveGateway = { mode: 'protective', authorize: () => ({ allowed: false, reason: 'وضع حماية', auditId: 'x' }) } as unknown as CrownGateway;
  const s = bootstrapState();
  const guard = new NetworkEgressGuard(audit, protectiveGateway, s.killSwitch, {
    resources: permissiveResources(audit),
  });
  const d = guard.request('agent:1', { host: 'api.example.com' });
  assert.equal(d.allowed, false);
  assert.match(d.reason, /protective/);
});

test('الإيقاف الخارجي يمنع الخروج فورًا', () => {
  const s = bootstrapState();
  s.killSwitch.engage('authority:crown_guard', 'external', 'اختبار');
  assert.equal(s.egress.request('agent:1', { host: 'api.example.com' }).allowed, false);
});
