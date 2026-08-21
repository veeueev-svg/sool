/**
 * tests/audit/append_only_log.test.ts — اختبارات قبول المرحلة 10
 * المالك: ديوان التدقيق
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { AuditEntry } from '../../src/kernel/types';

test('السلسلة سليمة بعد إضافات متتابعة', () => {
  const log = new AppendOnlyLog();
  for (let i = 0; i < 50; i++) log.append('agent:x', 'action', { i });
  const report = log.verifyIntegrity();
  assert.equal(report.valid, true);
  assert.equal(report.length, 50);
});

test('تعديل محتوى سجل يُكشف', () => {
  const log = new AppendOnlyLog();
  log.append('king', 'a'); log.append('king', 'b'); log.append('king', 'c');
  const entries = JSON.parse(log.export()) as AuditEntry[];
  (entries[1] as { kind: string }).kind = 'مزور';
  const tampered = AppendOnlyLog.unsafeFromEntries(entries);
  const report = tampered.verifyIntegrity();
  assert.equal(report.valid, false);
  assert.equal(report.brokenAt, 2);
});

test('حذف سجل من منتصف السلسلة يُكشف', () => {
  const log = new AppendOnlyLog();
  log.append('king', 'a'); log.append('king', 'b'); log.append('king', 'c');
  const entries = JSON.parse(log.export()) as AuditEntry[];
  entries.splice(1, 1);
  const report = AppendOnlyLog.unsafeFromEntries(entries).verifyIntegrity();
  assert.equal(report.valid, false);
});

test('الاستعادة من نسخة سليمة تنجح، ومن نسخة فاسدة تُرفض', () => {
  const log = new AppendOnlyLog();
  log.append('king', 'a'); log.append('king', 'b');
  const restored = AppendOnlyLog.import(log.export());
  assert.equal(restored.verifyIntegrity().valid, true);
  const entries = JSON.parse(log.export()) as AuditEntry[];
  (entries[0] as { actor: string }).actor = 'someone';
  assert.throws(() => AppendOnlyLog.import(JSON.stringify(entries)), /فاسدة/);
});

test('السجل يُعطي نسخة للقراءة فقط', () => {
  const log = new AppendOnlyLog();
  log.append('king', 'a');
  const snap = log.snapshot();
  assert.throws(() => { (snap[0] as unknown as { kind: string }).kind = 'x'; });
  assert.equal(log.verifyIntegrity().valid, true);
});
