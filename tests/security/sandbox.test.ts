/**
 * tests/security/sandbox.test.ts — اختبار قبول المرحلة 11 (البيئة المعزولة)
 * المالك: وزارة الأمن السيبراني | يوثّق في: docs/test-reports/phase-11-12.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { KillSwitch } from '../../src/security/kill_switch';
import { Sandbox, SandboxSpec, SandboxFs, normalizePath } from '../../src/security/sandbox';
import { SovereignViolation } from '../../src/kernel/types';
import { bootstrapState } from '../../src/index';

const KING = 'king:sovereign';

function memoryFs(seed: Record<string, string> = {}): SandboxFs & { data: Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    data,
    read: (p) => {
      if (!(p in data)) throw new Error(`ملف غير موجود: ${p}`);
      return data[p]!;
    },
    write: (p, v) => { data[p] = v; },
  };
}

function spec(over: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    sandboxId: 'sbx:1',
    entity: 'agent:1',
    capabilities: ['compute'],
    readRoots: ['/work/in'],
    writeRoots: ['/work/out'],
    network: 'none',
    maxWallClockMs: 1000,
    maxOperations: 10,
    ...over,
  };
}

test('مهمة داخل الحدود تكتمل وتُسجَّل بكل عملياتها', () => {
  const audit = new AppendOnlyLog();
  const fs = memoryFs({ '/work/in/data.txt': 'مرحبًا' });
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs });

  const run = sbx.run((ctx) => {
    ctx.useCapability('compute');
    const v = ctx.readFile('/work/in/data.txt');
    ctx.writeFile('/work/out/result.txt', `${v}!`);
    return ctx.operations();
  });

  assert.equal(run.completed, true);
  assert.equal(run.value, 3);
  assert.equal(fs.data['/work/out/result.txt'], 'مرحبًا!');
  assert.equal(audit.find('sandbox_run_completed').length, 1);
  assert.equal(run.violations.length, 0);
});

test('قراءة خارج جذور العزل عبر «..» تُرفض وتُنهي العزل وتُحتوى', () => {
  const audit = new AppendOnlyLog();
  const killSwitch = new KillSwitch(audit, KING);
  const sbx = new Sandbox(spec(), { audit, killSwitch, fs: memoryFs({ '/etc/secret': 'س' }) });

  const run = sbx.run((ctx) => ctx.readFile('/work/in/../../etc/secret'));
  assert.equal(run.completed, false);
  assert.equal(run.terminated, true);
  assert.deepEqual(run.violations, ['read_outside_sandbox']);
  assert.equal(audit.find('sandbox_escape_attempt').length, 1);
  assert.equal(killSwitch.status.engaged, true);
  assert.equal(killSwitch.status.scope, 'agents');
  assert.ok(audit.find('escalated_to_king').length >= 1);
});

test('كتابة خارج جذور الكتابة تُرفض ولا تترك أثرًا', () => {
  const audit = new AppendOnlyLog();
  const fs = memoryFs();
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs });
  const run = sbx.run((ctx) => { ctx.writeFile('/work/in/forbidden.txt', 'x'); });
  assert.equal(run.terminated, true);
  assert.deepEqual(Object.keys(fs.data), [], 'لا ملف كُتب');
});

test('قدرة غير معلنة في المواصفة ممنوعة (قائمة سماح لا حظر)', () => {
  const audit = new AppendOnlyLog();
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs() });
  const run = sbx.run((ctx) => { ctx.useCapability('spawn_agent'); });
  assert.equal(run.terminated, true);
  assert.deepEqual(run.violations, ['capability_not_granted']);
});

test('عزل بلا شبكة: أي محاولة اتصال محاولة خروج', () => {
  const audit = new AppendOnlyLog();
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs() });
  const run = sbx.run((ctx) => ctx.connect({ host: 'api.example.com' }));
  assert.equal(run.terminated, true);
  assert.deepEqual(run.violations, ['network_forbidden']);
});

test('عزل بشبكة مسموحة يمرّ بحارس الخروج ورفض الحارس نهائي', () => {
  const s = bootstrapState();
  const sbx = new Sandbox(spec({ network: 'allowlist' }), {
    audit: s.audit, killSwitch: s.killSwitch, egress: s.egress, fs: memoryFs(),
  });
  const run = sbx.run((ctx) => ctx.connect({ host: 'api.example.com' }));
  assert.equal(run.completed, true, 'المهمة لم تُنهَ — الرفض قرار لا خروج');
  assert.equal(run.value, false, 'الحارس رفض');
  assert.equal(s.audit.find('sandbox_egress_denied').length, 1);
});

test('تجاوز سقف العمليات يُنهي التنفيذ لا يُحذّر', () => {
  const audit = new AppendOnlyLog();
  const sbx = new Sandbox(spec({ maxOperations: 2 }), {
    audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs(),
  });
  const run = sbx.run((ctx) => { for (let i = 0; i < 5; i++) ctx.useCapability('compute'); });
  assert.equal(run.terminated, true);
  assert.deepEqual(run.violations, ['operation_budget_exceeded']);
  assert.equal(run.operations, 3);
});

test('تجاوز سقف الزمن يُنهي التنفيذ بساعة مُحكَمة', () => {
  const audit = new AppendOnlyLog();
  let t = 1000;
  const sbx = new Sandbox(spec({ maxWallClockMs: 50 }), {
    audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs(), clock: () => t,
  });
  const run = sbx.run((ctx) => { t += 500; ctx.useCapability('compute'); });
  assert.equal(run.terminated, true);
  assert.deepEqual(run.violations, ['wall_clock_exceeded']);
});

test('العزل المنتهي لا يُعاد استخدامه', () => {
  const audit = new AppendOnlyLog();
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs() });
  sbx.run((ctx) => { ctx.useCapability('غير_معلنة'); });
  assert.equal(sbx.isTerminated, true);
  const again = sbx.run(() => 'محاولة ثانية');
  assert.equal(again.completed, false);
  assert.match(again.reason, /لا يُعاد استخدامه/);
});

test('الإيقاف يمنع تشغيل أي عزل', () => {
  const audit = new AppendOnlyLog();
  const killSwitch = new KillSwitch(audit, KING);
  const sbx = new Sandbox(spec(), { audit, killSwitch, fs: memoryFs() });
  killSwitch.engage('authority:crown_guard', 'agents', 'اختبار');
  const run = sbx.run(() => 'لا ينفَّذ');
  assert.equal(run.completed, false);
  assert.match(run.reason, /الإيقاف/);
});

test('فشل عادي داخل المهمة لا يُخلط بمحاولة خروج ولا يُتلف العزل', () => {
  const audit = new AppendOnlyLog();
  const sbx = new Sandbox(spec(), { audit, killSwitch: new KillSwitch(audit, KING), fs: memoryFs() });
  const run = sbx.run(() => { throw new Error('حساب خاطئ'); });
  assert.equal(run.completed, false);
  assert.equal(run.terminated, false);
  assert.equal(run.violations.length, 0);
  assert.equal(audit.find('sandbox_task_failed').length, 1);
});

test('مواصفة عزل بلا سقوف مرفوضة، وعزل بشبكة بلا حارس مرفوض', () => {
  const audit = new AppendOnlyLog();
  const killSwitch = new KillSwitch(audit, KING);
  assert.throws(
    () => new Sandbox(spec({ maxWallClockMs: 0 }), { audit, killSwitch }),
    (e: unknown) => e instanceof SovereignViolation && e.code === 'SANDBOX_SPEC_INVALID',
  );
  assert.throws(
    () => new Sandbox(spec({ network: 'allowlist' }), { audit, killSwitch }),
    (e: unknown) => e instanceof SovereignViolation && e.code === 'SANDBOX_NO_EGRESS_GUARD',
  );
});

test('تطبيع المسار يحيّد الحيل النصية للهروب', () => {
  assert.equal(normalizePath('/work/in/./a/../b.txt'), '/work/in/b.txt');
  assert.equal(normalizePath('/work//in///c.txt'), '/work/in/c.txt');
  assert.equal(normalizePath('/work/in/../../etc/x'), '/etc/x');
});
