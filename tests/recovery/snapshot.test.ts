/**
 * tests/recovery/snapshot.test.ts — اختبارات لقطة التعافي (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: مهاد تعاف وأوامر ملكية | المخرجات: قبول أو رفض حتمي
 * التبعيات: وحدات src/recovery والأرشيف الملكي | الصلاحيات: اختبارات لا تغيّر سياسة الإنتاج
 * السجلات: تفحص سجلات التعافي حيث يلزم | حالات الفشل: كل مهاد ينظف القرص المؤقت
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذا الاختبار: 1) لا استعادة بلا archive_restore؛ 2) كل ملف مؤقت؛ 3) لا انتظار زمني حقيقي.
 */
import { createHash } from 'node:crypto'; import { readFileSync, writeFileSync } from 'node:fs'; import { test } from 'node:test'; import assert from 'node:assert/strict';
import { recoveryHarness, seed, take, T0 } from './helpers';
test('اللقطة تحمل بصمة وغلافا', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); assert.equal(r.archive.contentHash.length, 64); assert.ok(r.bytes > 0); } finally { h.clean(); } });
test('تسجل اللقطة كتابة القرص', () => { const h = recoveryHarness(); try { take(h); assert.equal(h.s.audit.find('recovery_snapshot_written').length, 1); } finally { h.clean(); } });
test('اللقطة تضم السكان', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); const x = r.archive.payload.recovery as { population: { identities: unknown[] } }; assert.equal(x.population.identities.length, 3); } finally { h.clean(); } });
test('اللقطة تضم الحصص', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); const x = r.archive.payload.recovery as { resources: { reservations: [string, string[]][] } }; assert.equal(x.resources.reservations.find(([n]) => n === 'identity_slots')?.[1].length, 3); } finally { h.clean(); } });
test('اللقطة تضم المجدول', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); const x = r.archive.payload.recovery as { scheduler: { tasks: unknown[] } }; assert.equal(x.scheduler.tasks.length, 1); } finally { h.clean(); } });
test('اللقطة تضم الوزارات', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); const x = r.archive.payload.recovery as { ministries: { ministries: unknown[] } }; assert.equal(x.ministries.ministries.length, 1); } finally { h.clean(); } });
test('اللقطة تضم السجل', () => { const h = recoveryHarness(); try { seed(h); const r = take(h); const x = r.archive.payload.recovery as { audit: string }; assert.ok(JSON.parse(x.audit).length > 0); } finally { h.clean(); } });
test('تحريف بايت في الغلاف يرفض التحميل', () => { const h = recoveryHarness(); try { const r = take(h); const raw = readFileSync(r.file, 'utf8'); writeFileSync(r.file, raw.replace('"version":1', '"version":2')); assert.throws(() => h.s.recoverySnapshots.load(r.file), /RECOVERY_SNAPSHOT_TAMPERED/); } finally { h.clean(); } });
test('تحريف حمولة الأرشيف يرفضها بعد إعادة بصمة الغلاف', () => { const h = recoveryHarness(); try { const r = take(h); const raw = JSON.parse(readFileSync(r.file, 'utf8')) as { version: 1; createdAt: number; archive: { contentHash: string }; checksum: string }; raw.archive.contentHash = '0'.repeat(64); raw.checksum = createHash('sha256').update(JSON.stringify({ version: raw.version, createdAt: raw.createdAt, archive: raw.archive }), 'utf8').digest('hex'); writeFileSync(r.file, JSON.stringify(raw), 'utf8'); assert.throws(() => h.s.recoverySnapshots.load(r.file), /RECOVERY_ARCHIVE_TAMPERED/); } finally { h.clean(); } });
test('الملف المفقود يرفض مغلقا', () => { const h = recoveryHarness(); try { assert.throws(() => h.s.recoverySnapshots.load('غائب.json'), /RECOVERY_SNAPSHOT_MISSING/); } finally { h.clean(); } });
test('المسار الخارج عن المجلد مرفوض', () => { const h = recoveryHarness(); try { assert.throws(() => h.s.recoverySnapshots.load('/tmp/غير-مسموح.json'), /RECOVERY_PATH_REFUSED/); } finally { h.clean(); } });
test('التدوير يمحو الأقدم فقط', () => { const h = recoveryHarness(); try { for (let i = 0; i < 4; i++) take(h, T0 + i); const names = h.s.recoverySnapshots.list(); assert.equal(names.length, 3); assert.ok(!names[0]?.includes(`${T0}-1`)); } finally { h.clean(); } });
