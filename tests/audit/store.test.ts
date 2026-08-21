/**
 * tests/audit/store.test.ts — اختبار قبول ثبات السجل والنسخ والاستعادة (المرحلتان 10 و32)
 * المالك: ديوان التدقيق | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppendOnlyLog } from '../../src/audit/append_only_log';
import { AuditStore } from '../../src/audit/store';
import { AuditEntry } from '../../src/kernel/types';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'sool-audit-'));
}

function seeded(n = 5): AppendOnlyLog {
  const log = new AppendOnlyLog();
  for (let i = 0; i < n; i++) log.append('authority:test', 'event', { i });
  return log;
}

test('الحفظ ثم الاستعادة يُبقي السلسلة سليمة وبنفس الطول والرأس', () => {
  const path = join(dir(), 'audit.json');
  const store = new AuditStore(path);
  const log = seeded(8);
  const file = store.save(log, 1000);

  const restored = store.load();
  assert.equal(restored.length, 8);
  assert.equal(restored.verifyIntegrity().valid, true);
  assert.equal(restored.snapshot()[7]!.hash, file.headHash);
});

test('استعادة من ملف غير موجود تُرفض بفشل مغلق', () => {
  const store = new AuditStore(join(dir(), 'missing.json'));
  assert.equal(store.exists(), false);
  assert.throws(() => store.load(), /غير موجود/);
});

test('تعديل محتوى ملف السجل يُكشف عبر البصمة ويُرفض', () => {
  const path = join(dir(), 'audit.json');
  const store = new AuditStore(path);
  store.save(seeded(4), 1000);

  const file = JSON.parse(readFileSync(path, 'utf8')) as { entries: AuditEntry[] };
  (file.entries[2] as { kind: string }).kind = 'event_tampered';
  writeFileSync(path, JSON.stringify(file), 'utf8');

  assert.throws(() => store.load(), /تلاعب مكتشف/);
});

test('حذف سجل من الملف يُكشف ولا يُحمَّل', () => {
  const path = join(dir(), 'audit.json');
  const store = new AuditStore(path);
  store.save(seeded(6), 1000);

  const file = JSON.parse(readFileSync(path, 'utf8')) as
    { entries: AuditEntry[]; length: number; checksum: string };
  file.entries.splice(3, 1);
  file.length = file.entries.length;
  writeFileSync(path, JSON.stringify(file), 'utf8');

  assert.throws(() => store.load(), /تلاعب مكتشف|سلسلة|تسلسل/);
});

test('رفض حفظ سلسلة غير سليمة', () => {
  const path = join(dir(), 'audit.json');
  const store = new AuditStore(path);
  const entries = seeded(3).snapshot().slice(0, 2).map((e, i) => (
    i === 1 ? { ...e, kind: 'مُعدَّل' } : e
  )) as AuditEntry[];
  const broken = AppendOnlyLog.unsafeFromEntries(entries);
  assert.throws(() => store.save(broken), /رفض الحفظ/);
});

test('النسخ الاحتياطية تُدوَّر ويُبقى أحدث N فقط', () => {
  const base = dir();
  const store = new AuditStore(join(base, 'audit.json'));
  const backups = join(base, 'backups');
  const log = seeded(3);
  for (let i = 1; i <= 7; i++) store.backup(log, backups, 3, 1_700_000_000_000 + i * 1000);

  const files = readdirSync(backups).filter((f) => f.startsWith('audit-'));
  assert.equal(files.length, 3);
});

test('الاستعادة تأخذ أحدث نسخة سليمة وتتجاهل الفاسدة', () => {
  const base = dir();
  const store = new AuditStore(join(base, 'audit.json'));
  const backups = join(base, 'backups');
  store.backup(seeded(4), backups, 5, 1_700_000_001_000);   // سليمة
  const latest = store.backup(seeded(9), backups, 5, 1_700_000_002_000); // الأحدث

  // إفساد الأحدث
  const file = JSON.parse(readFileSync(latest, 'utf8')) as { entries: AuditEntry[] };
  (file.entries[0] as { actor: string }).actor = 'مهاجم';
  writeFileSync(latest, JSON.stringify(file), 'utf8');

  const { log, from } = AuditStore.restoreLatest(backups);
  assert.equal(log.length, 4, 'رجعت إلى النسخة السليمة الأقدم');
  assert.match(from, /audit-1700000001000\.json/);
  assert.equal(log.verifyIntegrity().valid, true);
});

test('لا نسخة سليمة ⇒ الاستعادة تفشل بصوت عالٍ لا بصمت', () => {
  const base = dir();
  const backups = join(base, 'backups');
  const store = new AuditStore(join(base, 'audit.json'));
  const only = store.backup(seeded(2), backups, 5, 1_700_000_003_000);
  const file = JSON.parse(readFileSync(only, 'utf8')) as { entries: AuditEntry[] };
  (file.entries[1] as { kind: string }).kind = 'مزور';
  writeFileSync(only, JSON.stringify(file), 'utf8');

  assert.throws(() => AuditStore.restoreLatest(backups), /لا توجد نسخة احتياطية سليمة/);
});
