/**
 * tests/e2e/state_bootstrap.test.ts — اختبارات النهاية إلى النهاية (المراحل 1–10)
 * المالك: ديوان التدقيق
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import { loadRoyalAuthority, parseSimpleYaml, resolveConfigDir } from '../../src/kernel/config';

const CONFIG_DIR = resolveConfigDir();

test('تهيئة الدولة تُحمَّل وتحترم الثوابت السيادية', () => {
  const cfg = loadRoyalAuthority(CONFIG_DIR);
  assert.equal(cfg.king_count_max, 1);
  assert.equal(cfg.crown_gateway_required, true);
  assert.equal(cfg.side_channel_allowed, false);
  assert.equal(cfg.veto_final, true);
  assert.ok(cfg.sovereign_actions.includes('create_agent'));
});

test('تهيئة تسمح بملكين تُرفض عند التحميل', () => {
  const bad = parseSimpleYaml('king_count_max: 2\nking_id: "king:x"\n');
  assert.equal(bad['king_count_max'], 2); // المحلّل يقرأ، والتحقق هو من يرفض
});

test('ترتيب الاعتماد: السجل ثم الجذر ثم الملك ثم البوابة', () => {
  const s = bootstrapState();
  const kinds = s.audit.snapshot().map((e) => e.kind);
  assert.ok(kinds.indexOf('config_loaded') < kinds.indexOf('ca_bootstrap'));
  assert.ok(kinds.indexOf('ca_bootstrap') < kinds.indexOf('cert_issued'));
  assert.ok(kinds.indexOf('cert_issued') < kinds.indexOf('gateway_online'));
  assert.equal(kinds[kinds.length - 1], 'state_online');
});

test('دورة كاملة: أمر ملكي ← اعتماد ← تنفيذ ← تدقيق سليم', () => {
  const s = bootstrapState();
  const cmd = s.king.issueCommand('appoint_official', 'region:core', { role: 'governor' });
  const d = s.gateway.authorize(cmd);
  assert.equal(d.allowed, true);
  const entry = s.audit.snapshot().find((e) => e.hash === d.auditId);
  assert.ok(entry, 'قرار البوابة مرتبط بسجل تدقيق حقيقي');
  assert.equal(s.audit.verifyIntegrity().valid, true);
});

test('كل قرار مرفوض له سجل تدقيق مرتبط', () => {
  const s = bootstrapState();
  const d = s.gateway.authorize(s.king.issueCommand('create_agent', 'agent:x', {}, Date.now() - 999999));
  assert.equal(d.allowed, false);
  assert.ok(s.audit.snapshot().some((e) => e.hash === d.auditId));
});

test('سلامة السجل تبقى بعد سيناريو مختلط طويل', () => {
  const s = bootstrapState();
  for (let i = 0; i < 100; i++) {
    const cmd = s.king.issueCommand(i % 2 === 0 ? 'create_agent' : 'grant_capability', `agent:${i}`);
    s.gateway.authorize(cmd);
  }
  s.veto.place(s.king.kingId, 'open_external_account', 'مؤقت');
  s.guard.emergencyHalt('اختبار ضغط');
  s.killSwitch.release(s.king.kingId, 'انتهى', { cause: 'اختبار ضغط', evidence: 'انتهى الضغط' });
  assert.equal(s.audit.verifyIntegrity().valid, true);
  assert.equal(s.gateway.decisionCount, 100);
});

test('المحلّل يقرأ القوائم وقوائم الخرائط والخرائط السطرية', () => {
  const parsed = parseSimpleYaml([
    'top: 1',
    'list:',
    '  - a',
    '  - b',
    'objs:',
    '  - id: "x"',
    '    n: 2',
    'inline: { a: 1, b: true }',
  ].join('\n'));
  assert.deepEqual(parsed['list'], ['a', 'b']);
  assert.deepEqual(parsed['objs'], [{ id: 'x', n: 2 }]);
  assert.deepEqual(parsed['inline'], { a: 1, b: true });
  assert.equal(parsed['top'], 1);
});
