/**
 * tests/recovery/continuity.test.ts — اختبارات الاستمرارية (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: مهاد تعاف وأوامر ملكية | المخرجات: قبول أو رفض حتمي
 * التبعيات: وحدات src/recovery والأرشيف الملكي | الصلاحيات: اختبارات لا تغيّر سياسة الإنتاج
 * السجلات: تفحص سجلات التعافي حيث يلزم | حالات الفشل: كل مهاد ينظف القرص المؤقت
 * اختبارات الوحدة: هذا الملف | اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-32.md
 * ثوابت هذا الاختبار: 1) لا استعادة بلا archive_restore؛ 2) كل ملف مؤقت؛ 3) لا انتظار زمني حقيقي.
 */
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { recoveryHarness, T0 } from './helpers';
test('البداية full', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.current.mode, 'full'); } finally { h.clean(); } });
test('الانقطاع ينتقل إلى limited المعلن', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.enterOutage('انقطاع', T0).mode, 'limited'); } finally { h.clean(); } });
test('بدء الاستعادة يوقف الكل', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.beginRestore(T0).mode, 'halted'); } finally { h.clean(); } });
test('نجاح الاستعادة يبقي limited', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.completeRestore(true, T0).mode, 'limited'); } finally { h.clean(); } });
test('فشل الاستعادة يبقي halted', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.completeRestore(false, T0).mode, 'halted'); } finally { h.clean(); } });
test('full قرار معلن لا استنتاج', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.declareFull('تحقق يدوي', T0).mode, 'full'); } finally { h.clean(); } });
test('سبب فارغ مرفوض', () => { const h = recoveryHarness(); try { assert.throws(() => h.s.continuity.enterOutage('', T0), /CONTINUITY_REASON_REQUIRED/); } finally { h.clean(); } });
test('التحول يسجل في التدقيق', () => { const h = recoveryHarness(); try { h.s.continuity.enterOutage('فحص', T0); assert.equal(h.s.audit.find('continuity_mode_changed').length, 1); } finally { h.clean(); } });
test('الحالة المعادة لا تكشف مرجعًا داخليًا', () => { const h = recoveryHarness(); try { const state = h.s.continuity.current as { mode: string }; state.mode = 'halted'; assert.equal(h.s.continuity.current.mode, 'full'); } finally { h.clean(); } });
test('وقت التحول محفوظ', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.enterOutage('فحص', T0 + 2).at, T0 + 2); } finally { h.clean(); } });
test('سبب التحول محفوظ', () => { const h = recoveryHarness(); try { assert.equal(h.s.continuity.enterOutage('سبب', T0).reason, 'سبب'); } finally { h.clean(); } });
test('الفشل بعد نجاح يعيد halted', () => { const h = recoveryHarness(); try { h.s.continuity.completeRestore(true, T0); assert.equal(h.s.continuity.completeRestore(false, T0 + 1).mode, 'halted'); } finally { h.clean(); } });
