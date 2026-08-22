/**
 * tests/recovery/restore_runner.test.ts — اختبارات مشغل الاستعادة (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: مهاد تعاف وأوامر ملكية | المخرجات: قبول أو رفض حتمي
 * التبعيات: وحدات src/recovery والأرشيف الملكي | الصلاحيات: اختبارات لا تغيّر سياسة الإنتاج
 * السجلات: تفحص سجلات التعافي حيث يلزم | حالات الفشل: كل مهاد ينظف القرص المؤقت
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذا الاختبار: 1) لا استعادة بلا archive_restore؛ 2) كل ملف مؤقت؛ 3) لا انتظار زمني حقيقي.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'; import { basename, join } from 'node:path'; import { test } from 'node:test'; import assert from 'node:assert/strict';
import { recoveryHarness, seed, take, T0 } from './helpers';
function command(h: ReturnType<typeof recoveryHarness>, at = T0 + 1) { return h.s.king.issueCommand('archive_restore', 'snap:0001', {}, at); }
test('الاستعادة بأمر ملكي تعود بنجاح', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); assert.equal(h.s.restoreRunner.restore(command(h), r.file, T0 + 1).allowed, true); } finally { h.clean(); } });
test('لا استعادة بالفعل الخطأ', () => { const h = recoveryHarness(); try { const r = take(h); const wrong = h.s.king.issueCommand('approve_phase', 'snap:0001', {}, T0 + 1); assert.equal(h.s.restoreRunner.restore(wrong, r.file, T0 + 1).allowed, false); } finally { h.clean(); } });
test('بعد النجاح يبقى التوالد مجمدا', () => { const h = recoveryHarness(); try { const r = take(h); h.s.restoreRunner.restore(command(h), r.file, T0 + 1); assert.equal(h.s.spawnPolicy.isFrozen, true); } finally { h.clean(); } });
test('بعد النجاح تكون الاستمرارية limited', () => { const h = recoveryHarness(); try { const r = take(h); h.s.restoreRunner.restore(command(h), r.file, T0 + 1); assert.equal(h.s.continuity.current.mode, 'limited'); } finally { h.clean(); } });
test('استعادة الغلاف المحرف ترمي وترجع halted', () => { const h = recoveryHarness(); try { const r = take(h); const raw = JSON.parse(readFileSync(r.file, 'utf8')) as { checksum: string }; raw.checksum = 'x'; writeFileSync(r.file, JSON.stringify(raw), 'utf8'); assert.throws(() => h.s.restoreRunner.restore(command(h), r.file, T0 + 1), /RECOVERY_SNAPSHOT_TAMPERED/); assert.equal(h.s.continuity.current.mode, 'halted'); } finally { h.clean(); } });
test('استعادة ملف غائب ترفض', () => { const h = recoveryHarness(); try { assert.throws(() => h.s.restoreRunner.restore(command(h), 'غائب.json', T0 + 1), /RECOVERY_SNAPSHOT_MISSING/); } finally { h.clean(); } });
test('سلسلة التدقيق سليمة بعد الاستعادة', () => { const h = recoveryHarness(); try { const r = take(h); h.s.restoreRunner.restore(command(h), r.file, T0 + 1); assert.equal(h.s.audit.verifyIntegrity().valid, true); } finally { h.clean(); } });
test('تسجل الاستعادة النهائية', () => { const h = recoveryHarness(); try { const r = take(h); h.s.restoreRunner.restore(command(h), r.file, T0 + 1); assert.equal(h.s.audit.find('archive_restored').length, 1); } finally { h.clean(); } });
test('المسار المطلق داخل المجلد مقبول', () => { const h = recoveryHarness(); try { const r = take(h); assert.equal(h.s.restoreRunner.restore(command(h), r.file, T0 + 1).allowed, true); } finally { h.clean(); } });
test('استعادة نسخة مجهولة داخل الأرشيف تقرأ من القرص أولا', () => { const h = recoveryHarness(); const fresh = recoveryHarness(); try { const r = take(h); const persisted = join(fresh.backups, basename(r.file)); mkdirSync(fresh.backups, { recursive: true }); copyFileSync(r.file, persisted); assert.equal(fresh.s.archive.get('snap:0001'), undefined); assert.equal(fresh.s.restoreRunner.restore(command(fresh), persisted, T0 + 1).allowed, true); } finally { fresh.clean(); h.clean(); } });
test('فشل الاستعادة لا يفك التجميد', () => { const h = recoveryHarness(); try { assert.throws(() => h.s.restoreRunner.restore(command(h), 'غائب.json', T0 + 1)); assert.equal(h.s.spawnPolicy.isFrozen, false); } finally { h.clean(); } });
test('الأمر القديم يرفضه التاج', () => { const h = recoveryHarness(); try { const r = take(h); const old = h.s.king.issueCommand('archive_restore', 'snap:0001', {}, T0 - 121_000); assert.equal(h.s.restoreRunner.restore(old, r.file, T0).allowed, false); } finally { h.clean(); } });
