/**
 * tests/recovery/backup_scheduler.test.ts — اختبارات مجدول النسخ (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: مهاد تعاف وأوامر ملكية | المخرجات: قبول أو رفض حتمي
 * التبعيات: وحدات src/recovery والأرشيف الملكي | الصلاحيات: اختبارات لا تغيّر سياسة الإنتاج
 * السجلات: تفحص سجلات التعافي حيث يلزم | حالات الفشل: كل مهاد ينظف القرص المؤقت
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذا الاختبار: 1) لا استعادة بلا archive_restore؛ 2) كل ملف مؤقت؛ 3) لا انتظار زمني حقيقي.
 */
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { recoveryHarness, T0 } from './helpers';
test('يأخذ المجدول النسخة الأولى فورًا', () => { const h = recoveryHarness(); try { assert.equal(h.s.backupScheduler.runIfDue(T0).taken, true); } finally { h.clean(); } });
test('لا يأخذ نسخة قبل الفاصل المعلن', () => { const h = recoveryHarness(); try { h.s.backupScheduler.runIfDue(T0); assert.equal(h.s.backupScheduler.runIfDue(T0 + 29_999).taken, false); } finally { h.clean(); } });
test('يأخذ نسخة عند الحد بالضبط', () => { const h = recoveryHarness(); try { h.s.backupScheduler.runIfDue(T0); assert.equal(h.s.backupScheduler.runIfDue(T0 + 30_000).taken, true); } finally { h.clean(); } });
test('يأخذ نسخة فوق الحد بواحد', () => { const h = recoveryHarness(); try { h.s.backupScheduler.runIfDue(T0); assert.equal(h.s.backupScheduler.runIfDue(T0 + 30_001).taken, true); } finally { h.clean(); } });
test('يرفض ساعة راجعة', () => { const h = recoveryHarness(); try { h.s.backupScheduler.runIfDue(T0); assert.throws(() => h.s.backupScheduler.runIfDue(T0 - 1), /RECOVERY_TIME_REVERSED/); } finally { h.clean(); } });
test('يسجل الانتظار قبل موعد النسخة', () => { const h = recoveryHarness(); try { h.s.backupScheduler.runIfDue(T0); h.s.backupScheduler.runIfDue(T0 + 1); assert.equal(h.s.audit.find('recovery_backup_skipped').length, 1); } finally { h.clean(); } });
test('تغيير فاصل التهيئة يغير سلوك الجدولة', () => { const h = recoveryHarness(T0, 1); try { h.s.backupScheduler.runIfDue(T0); assert.equal(h.s.backupScheduler.runIfDue(T0 + 1_000).taken, true); } finally { h.clean(); } });
test('النسخة تكتب داخل المجلد المعلن', () => { const h = recoveryHarness(); try { const r = h.s.backupScheduler.runIfDue(T0); assert.match(r.file ?? '', new RegExp(h.backups)); } finally { h.clean(); } });
test('الاحتفاظ يبقي ثلاث نسخ فقط', () => { const h = recoveryHarness(); try { for (let i = 0; i < 4; i++) h.s.backupScheduler.runIfDue(T0 + i * 30_000); assert.equal(h.s.recoverySnapshots.list().length, 3); } finally { h.clean(); } });
test('النسخة تسجل حجمًا غير صفري', () => { const h = recoveryHarness(); try { assert.ok(h.s.recoverySnapshots.take(T0).bytes > 100); } finally { h.clean(); } });
test('الفاصل لا يغير السياسة من داخل المجدول', () => { const h = recoveryHarness(); try { assert.equal(h.s.recoveryConfig.policy.backup_interval_seconds, 30); } finally { h.clean(); } });
test('اسم الملف منضبط بصيغة النسخ', () => { const h = recoveryHarness(); try { assert.match(h.s.recoverySnapshots.take(T0).file, /recovery-1700000000000-1\.json$/); } finally { h.clean(); } });
import { writeFileSync } from 'node:fs';
import { bootstrapState } from '../../src/index';
function hasCode(error: unknown, code: string): boolean { return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === code; }
function policy(interval: number, verify = true): string {
  return `policy:\n  rto_seconds: 30\n  rpo_seconds: 60\n  backup_interval_seconds: ${interval}\n  retention_count: 3\n  verify_after_restore: ${verify}\n  backup_directory: "/tmp/sool-recovery-config"\n  continuity_mode: limited\n`;
}
test('حد RPO يقبل الفاصل المساوي ويرفض ما فوقه بواحد', () => { const h = recoveryHarness(); try { writeFileSync(`${h.config}/recovery.yaml`, policy(60)); assert.equal(bootstrapState({ configDir: h.config }).recoveryConfig.policy.backup_interval_seconds, 60); writeFileSync(`${h.config}/recovery.yaml`, policy(61)); assert.throws(() => bootstrapState({ configDir: h.config }), (error: unknown) => hasCode(error, 'CONFIG_RPO_UNREACHABLE')); } finally { h.clean(); } });
test('تعطيل التحقق البعدي في التهيئة مرفوض مغلقا', () => { const h = recoveryHarness(); try { writeFileSync(`${h.config}/recovery.yaml`, policy(30, false)); assert.throws(() => bootstrapState({ configDir: h.config }), (error: unknown) => hasCode(error, 'CONFIG_RECOVERY_VERIFY_REQUIRED')); } finally { h.clean(); } });
