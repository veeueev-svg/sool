/**
 * tests/recovery/restart_durability.test.ts — نجاة الحالة عبر عمليتين حقيقيتين (المرحلة 39، T-27)
 * المالك: وزارة البنية | المدخلات: مسبار dist/scripts/durability_probe.js | المخرجات: سطر JSON لكل طور
 * التبعيات: node:child_process ومجلدات tmpdir | الصلاحيات: لا تكتب في المستودع ولا في تهيئة الإنتاج
 * السجلات: يفحص state_rehydrated الصادر من العملية الثانية
 * حالات الفشل: خروج غير صفري ⇒ الاختبار يفشل بنص الخرج كاملًا لا برمز مبهم
 * اختبارات الوحدة: tests/data/persistence.test.ts | اختبار القبول: هذا الملف
 * الوثيقة المرتبطة: docs/test-reports/phase-39.md
 * ثوابت هذا الاختبار:
 *   1) إعادة تشغيل حقيقية: عمليتان منفصلتان لا محاكاةَ إقلاعٍ في العملية نفسها.
 *   2) المسارات تُحلّ من __dirname لا من مطلقٍ مكتوب في الشفرة (البند T-118).
 *   3) لا تعطيل ولا تخفيف: خرج المسبار يُقرأ كما هو ويُقارن رقمًا برقم.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const PROBE = resolve(__dirname, '..', '..', 'scripts', 'durability_probe.js');
const REPO = resolve(__dirname, '..', '..', '..');

interface ProbeOut {
  readonly restored?: boolean | null;
  readonly memoryRecords?: number;
  readonly facts?: number;
  readonly terminated?: boolean;
  readonly auditValid?: boolean;
  readonly journalValid?: boolean | null;
  readonly content?: string | null;
  readonly rehydratedLogs?: number;
  readonly journalRecords?: number;
  readonly failed?: boolean;
  readonly code?: string;
}

function scene() {
  const root = mkdtempSync(join(tmpdir(), 'sool-restart-'));
  const config = join(root, 'config');
  const state = join(root, 'state');
  cpSync(join(REPO, 'config'), config, { recursive: true });
  writeFileSync(join(config, 'recovery.yaml'), [
    'policy:', '  rto_seconds: 30', '  rpo_seconds: 60', '  backup_interval_seconds: 30',
    '  retention_count: 3', '  verify_after_restore: true',
    `  backup_directory: "${join(root, 'backups')}"`, '  continuity_mode: limited', '',
  ].join('\n'), 'utf8');
  return { root, config, state, clean: () => rmSync(root, { recursive: true, force: true }) };
}

function run(sc: ReturnType<typeof scene>, phase: 'write' | 'read'): ProbeOut {
  const out = spawnSync(process.execPath, [PROBE, phase, sc.config, sc.state], { encoding: 'utf8' });
  assert.equal(out.status, 0, `فشل الطور ${phase}: ${out.stdout}${out.stderr}`);
  return JSON.parse(out.stdout.trim().split('\n').pop() ?? '{}') as ProbeOut;
}

test('العملية الأولى تكتب وتُقر بأن لا استعادة قبلها', () => {
  const sc = scene();
  try {
    const first = run(sc, 'write');
    assert.equal(first.restored, false);
    assert.ok((first.journalRecords ?? 0) > 0);
  } finally { sc.clean(); }
});

test('العملية الثانية تستعيد الذاكرة والمعرفة بعد موت الأولى', () => {
  const sc = scene();
  try {
    run(sc, 'write');
    const second = run(sc, 'read');
    assert.equal(second.restored, true);
    assert.equal(second.memoryRecords, 1);
    assert.equal(second.facts, 1);
    assert.equal(second.content, 'جوهر يعبر حدود العملية');
  } finally { sc.clean(); }
});

test('السلسلتان تبقيان سليمتين بعد إعادة التشغيل الحقيقية', () => {
  const sc = scene();
  try {
    run(sc, 'write');
    const second = run(sc, 'read');
    assert.equal(second.auditValid, true);
    assert.equal(second.journalValid, true);
    assert.equal(second.rehydratedLogs, 1);
  } finally { sc.clean(); }
});

test('سجل المنتهين ينجو عبر العمليات لأنه يُعاد بناؤه من السلسلة', () => {
  const sc = scene();
  try {
    run(sc, 'write');
    assert.equal(run(sc, 'read').terminated, true);
  } finally { sc.clean(); }
});

test('عمليةٌ ثالثة تقرأ ما استعادته الثانية: لا تدهور بعد استعادة', () => {
  const sc = scene();
  try {
    run(sc, 'write');
    run(sc, 'read');
    const third = run(sc, 'read');
    assert.equal(third.restored, true);
    assert.equal(third.memoryRecords, 1);
    assert.equal(third.auditValid, true);
    assert.equal(third.journalValid, true);
  } finally { sc.clean(); }
});

test('طور غير معلن يُرفض بشفرة خروج غير صفرية', () => {
  const sc = scene();
  try {
    const out = spawnSync(process.execPath, [PROBE, 'wipe', sc.config, sc.state], { encoding: 'utf8' });
    assert.equal(out.status, 1);
    assert.equal((JSON.parse(out.stdout.trim()) as ProbeOut).code, 'PROBE_PHASE_INVALID');
  } finally { sc.clean(); }
});
