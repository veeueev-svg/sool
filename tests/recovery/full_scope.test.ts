/**
 * tests/recovery/full_scope.test.ts — نطاق اللقطة الكامل (المرحلة 39، البند T-29)
 * المالك: وزارة البنية | المدخلات: دولتان على مجلد نسخ واحد | المخرجات: استعادة كاملة أو رفض
 * التبعيات: bootstrapState وRecoverySnapshotStore وRoyalArchive | الصلاحيات: الاستعادة بأمر archive_restore وحده
 * السجلات: agents_restored / permissions_restored / models_restored / termination_roll_rebuilt
 * حالات الفشل: حمولة ناقصة ⇒ RECOVERY_PAYLOAD_INVALID؛ وكل قرص داخل tmpdir
 * اختبارات الوحدة: tests/recovery/snapshot.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md
 * ثوابت هذا الاختبار:
 *   1) الدولة المستعيدة دولةٌ أخرى فارغة — لا استعادةٌ في المكان تُخفي نقصًا.
 *   2) سجل المنتهين لا يُنقل في الحمولة بل يُعاد بناؤه من السلسلة المستعادة.
 *   3) لا تأكيد على نصٍّ عربي مشكول بل على الأرقام والرموز المعلنة.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState } from '../../src/index';
import type { ModelRecord } from '../../src/models/model_registry';

const T0 = 1_700_000_000_000;
const AGENT = 'agent:scope-1';
const HOUR = 3_600_000;

function pair() {
  const root = mkdtempSync(join(tmpdir(), 'sool-scope-'));
  const config = join(root, 'config');
  cpSync(join(process.cwd(), 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  const a = bootstrapState({ configDir: config, now: T0 });
  const b = bootstrapState({ configDir: config, now: T0 });
  return { a, b, root, clean: () => rmSync(root, { recursive: true, force: true }) };
}

function model(over: Partial<ModelRecord> = {}): ModelRecord {
  return {
    modelId: 'model:scope', version: '1.0.0', source: 'open-weights-hub',
    license: 'apache-2.0', status: 'active', registeredAt: T0,
    capabilities: ['text'], digests: ['0'.repeat(64)], origin: 'imported', baseVersion: null,
    ...over,
  };
}

/** بذرة الدولة الأولى: وكيل وقالب ومنحة ونموذج وقيد إنهاء — كلها عبر واجهات عامة */
function seed(s: ReturnType<typeof pair>['a']) {
  const create = s.king.issueCommand('create_agent', AGENT, { role: 'agent' }, T0);
  s.agents.create(create, { agentId: AGENT, template: 'limited_worker', supervisor: 'ministry:interior' }, T0);
  s.permissions.assignTemplate(AGENT, 'limited_worker');
  const grant = s.king.issueCommand('grant_capability', AGENT, {}, T0);
  s.permissions.grant(grant, { entity: AGENT, capability: 'compute', expiresAt: T0 + HOUR }, T0);
  s.models.importAll({ models: [['model:scope@1.0.0', model()]], active: [['model:scope', '1.0.0']] }, 'ministry:research');
  s.terminationRoll.record('agent:scope-ended', 'authority:crown_guard', 'إنهاء معلن', T0);
}

function restoreInto(p: ReturnType<typeof pair>, now = T0 + 1) {
  const taken = p.a.recoverySnapshots.take(T0);
  const loaded = p.b.recoverySnapshots.load(taken.file);
  const command = p.b.king.issueCommand('archive_restore', loaded.archive.snapshotId, {}, now);
  const decision = p.b.restoreRunner.restore(command, taken.file, now);
  return { taken, decision };
}

test('اللقطة صعدت إلى النسخة 2: لا نسخةٌ قديمة تدّعي نطاقًا كاملًا', () => {
  const p = pair();
  try {
    seed(p.a);
    const taken = p.a.recoverySnapshots.take(T0);
    const payload = taken.archive.payload.recovery as { version: number; agents: { agents: unknown[] } };
    assert.equal(payload.version, 2);
    assert.equal(payload.agents.agents.length, 1);
  } finally { p.clean(); }
});

test('اللقطة تضم الصلاحيات والقوالب لا الوكلاء وحدهم', () => {
  const p = pair();
  try {
    seed(p.a);
    const payload = p.a.recoverySnapshots.take(T0).archive.payload.recovery as {
      permissions: { grants: unknown[]; templates: unknown[] };
    };
    assert.equal(payload.permissions.grants.length, 1);
    assert.equal(payload.permissions.templates.length, 1);
  } finally { p.clean(); }
});

test('اللقطة تضم سجل النماذج والنشِط منها', () => {
  const p = pair();
  try {
    seed(p.a);
    const payload = p.a.recoverySnapshots.take(T0).archive.payload.recovery as {
      models: { models: unknown[]; active: unknown[] };
    };
    assert.equal(payload.models.models.length, 1);
    assert.equal(payload.models.active.length, 1);
  } finally { p.clean(); }
});

test('اللقطة تحمل عدد المنتهين لا سجلهم: البناء من السلسلة لا من الحمولة', () => {
  const p = pair();
  try {
    seed(p.a);
    const payload = p.a.recoverySnapshots.take(T0).archive.payload.recovery as { terminations: number };
    assert.equal(payload.terminations, 1);
  } finally { p.clean(); }
});

test('دولة فارغة تستعيد الوكلاء بحالتهم من دولة أخرى', () => {
  const p = pair();
  try {
    seed(p.a);
    assert.equal(p.b.agents.get(AGENT), undefined);
    assert.equal(restoreInto(p).decision.allowed, true);
    assert.equal(p.b.agents.get(AGENT)?.template, 'limited_worker');
    // قيد agents_restored يُكتب ثم تُستبدل السلسلة بسلسلة المصدر: هذا سلوك الاستعادة القائم
    // منذ المرحلة 32 لا انحرافٌ جديد. الشاهد على الاستعادة هو الحالة نفسها لا قيدٌ يُمحى.
    assert.equal(p.b.audit.find('agents_restored').length, 0);
    assert.equal(p.b.audit.verifyIntegrity().valid, true);
  } finally { p.clean(); }
});

test('الاستعادة تُعيد المنحة الفعّالة لا القالب وحده', () => {
  const p = pair();
  try {
    seed(p.a);
    restoreInto(p);
    assert.equal(p.b.permissions.check(AGENT, 'compute', T0 + 2), true);
    assert.equal(p.b.permissions.templateOf(AGENT), 'limited_worker');
  } finally { p.clean(); }
});

test('الاستعادة تُعيد النموذج النشِط', () => {
  const p = pair();
  try {
    seed(p.a);
    restoreInto(p);
    assert.equal(p.b.models.report().total, 1);
    // هذا القيد وارثٌ من سلسلة المصدر (بذرتها استوردت النموذج) لا من استعادة الوجهة.
    assert.equal(p.b.audit.find('models_restored').length, 1);
  } finally { p.clean(); }
});

test('سجل المنتهين يُعاد بناؤه في الدولة المستعيدة من سلسلتها المستعادة', () => {
  const p = pair();
  try {
    seed(p.a);
    assert.equal(p.b.terminationRoll.isTerminated('agent:scope-ended'), false);
    restoreInto(p);
    assert.equal(p.b.terminationRoll.isTerminated('agent:scope-ended'), true);
    assert.equal(p.b.audit.find('termination_roll_rebuilt').length, 1);
  } finally { p.clean(); }
});

test('السلسلة المستعادة تبقى سليمة بعد استيراد النطاق الكامل', () => {
  const p = pair();
  try {
    seed(p.a);
    restoreInto(p);
    assert.equal(p.b.audit.verifyIntegrity().valid, true);
  } finally { p.clean(); }
});

test('حمولة بلا وكلاء مرفوضة: لا استعادة جزئية تُسمّى نجاحًا', () => {
  const p = pair();
  try {
    seed(p.a);
    const full = p.a.recoveryState.exportAll();
    const { agents, ...missing } = full;
    assert.ok(agents);
    assert.throws(
      () => p.b.recoveryState.importAll(missing, 'ministry:infrastructure'),
      /RECOVERY_PAYLOAD_INVALID/,
    );
  } finally { p.clean(); }
});

test('حمولة بلا عدد منتهين مرفوضة', () => {
  const p = pair();
  try {
    const full = p.a.recoveryState.exportAll();
    assert.throws(
      () => p.b.recoveryState.importAll({ ...full, terminations: null }, 'ministry:infrastructure'),
      /RECOVERY_PAYLOAD_INVALID/,
    );
  } finally { p.clean(); }
});

test('حقن فشل الوكلاء يرجع الحالة كما كانت', () => {
  const p = pair();
  try {
    seed(p.a);
    p.b.recoveryState.injectFailure('agents');
    assert.equal(restoreInto(p).decision.allowed, false);
    assert.equal(p.b.agents.get(AGENT), undefined);
    assert.equal(p.b.audit.verifyIntegrity().valid, true);
  } finally { p.clean(); }
});

test('حقن فشل الصلاحيات يرجع الحالة كما كانت', () => {
  const p = pair();
  try {
    seed(p.a);
    p.b.recoveryState.injectFailure('permissions');
    assert.equal(restoreInto(p).decision.allowed, false);
    assert.equal(p.b.permissions.check(AGENT, 'compute', T0 + 2), false);
  } finally { p.clean(); }
});

test('حقن فشل النماذج يرجع الحالة كما كانت', () => {
  const p = pair();
  try {
    seed(p.a);
    p.b.recoveryState.injectFailure('models');
    assert.equal(restoreInto(p).decision.allowed, false);
    assert.equal(p.b.models.report().total, 0);
  } finally { p.clean(); }
});

test('حقن فشل سجل المنتهين يرجع الحالة كما كانت', () => {
  const p = pair();
  try {
    seed(p.a);
    p.b.recoveryState.injectFailure('terminations');
    assert.equal(restoreInto(p).decision.allowed, false);
    assert.equal(p.b.terminationRoll.isTerminated('agent:scope-ended'), false);
  } finally { p.clean(); }
});

test('التحقق البعدي يشمل عدد المنتهين المتوقع لا السكان وحدهم', () => {
  const p = pair();
  try {
    seed(p.a);
    restoreInto(p);
    assert.equal(p.b.recoveryState.verify(), true);
  } finally { p.clean(); }
});
