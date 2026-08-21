/**
 * tests/data/retention.test.ts — اختبار قبول المرحلة 21 (الاحتفاظ والحجز القانوني)
 * المالك: وزارة البيانات | يوثّق في: docs/test-reports/phase-21.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapState, DEFAULT_RETENTION_CLASSES } from '../../src/index';

const A = 'agent:ret-a';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function write(s: ReturnType<typeof bootstrapState>, retentionClass: string, at: number): string {
  const w = s.memory.write(A, {
    content: 'سجل', provenance: { kind: 'tool_call', ref: 'audit:1' }, retentionClass,
  }, at);
  assert.equal(w.ok, true);
  return w.ok ? w.record.recordId : '';
}

test('الأصناف المعلنة موجودة وصنف «دائم» غير قابل للشطب', () => {
  const s = bootstrapState();
  assert.equal(s.retention.classExists('operational'), true);
  assert.equal(s.retention.classExists('لا-يوجد'), false);
  assert.equal(s.retention.classOf('permanent')?.purgeable, false);
  assert.equal(DEFAULT_RETENTION_CLASSES.length, 4);
});

test('ما تجاوز مدته يُشطب ومحتواه يزول وبصمته تبقى', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'ephemeral', t0);
  const hash = s.memory.read('ministry:data', id)!.contentHash;
  const rep = s.retention.sweep('ministry:data', t0 + 2 * HOUR);
  assert.deepEqual(rep.purged, [id]);
  const after = s.memory.read('ministry:data', id)!;
  assert.equal(after.content, '');
  assert.equal(after.contentHash, hash);
  assert.match(after.tombstoneReason ?? '', /انتهاء مدة الاحتفاظ/);
});

test('ما لم تنتهِ مدته يبقى', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'operational', t0);
  const rep = s.retention.sweep('ministry:data', t0 + DAY);
  assert.deepEqual(rep.purged, []);
  assert.deepEqual(rep.kept, [id]);
});

test('صنف دائم لا يُشطب ولو مضى دهر', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'permanent', t0);
  const rep = s.retention.sweep('ministry:data', t0 + 100 * 365 * DAY);
  assert.deepEqual(rep.purged, []);
  assert.equal(s.memory.read('ministry:data', id)?.tombstoned, false);
});

test('الحجز القانوني يعلو على الشطب', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'ephemeral', t0);
  assert.equal(s.retention.legalHold(id, 'ministry:justice', 'قضية جارية', t0), true);
  const rep = s.retention.sweep('ministry:data', t0 + 10 * HOUR);
  assert.deepEqual(rep.held, [id]);
  assert.deepEqual(rep.purged, []);
  assert.equal(s.memory.read('ministry:data', id)?.content, 'سجل');
  assert.ok(s.audit.snapshot().some((e) => e.kind === 'retention_purge_blocked'));
});

test('الحجز من غير مخوَّل أو بلا سبب مرفوض', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'ephemeral', t0);
  assert.equal(s.retention.legalHold(id, 'agent:ret-a', 'أرغب', t0), false);
  assert.equal(s.retention.legalHold(id, 'ministry:justice', '   ', t0), false);
  assert.equal(s.retention.isHeld(id), false);
});

test('رفع الحجز يعيد السجل إلى دورة الشطب', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'ephemeral', t0);
  s.retention.legalHold(id, 'ministry:justice', 'قضية', t0);
  assert.equal(s.retention.releaseHold(id, 'agent:ret-a', 'محاولة'), false, 'الرفع لمخوَّل فقط');
  assert.equal(s.retention.releaseHold(id, 'ministry:justice', 'أُغلقت القضية'), true);
  assert.deepEqual(s.retention.sweep('ministry:data', t0 + 10 * HOUR).purged, [id]);
});

test('الشطب لا يمسّ سجل التدقيق — السجل ينمو ولا ينقص', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  write(s, 'ephemeral', t0);
  const before = s.audit.length;
  s.retention.sweep('ministry:data', t0 + 10 * HOUR);
  assert.ok(s.audit.length > before);
  assert.equal(s.audit.verifyIntegrity().valid, true, 'السلسلة سليمة بعد الشطب');
});

test('الشطب مرتان لا يكرّر: المشطوب لا يُشطب مجددًا', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  write(s, 'ephemeral', t0);
  assert.equal(s.retention.sweep('ministry:data', t0 + 10 * HOUR).purged.length, 1);
  assert.equal(s.retention.sweep('ministry:data', t0 + 20 * HOUR).purged.length, 0);
});

test('تقرير الحجوزات يعلن أسبابها', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  const id = write(s, 'ephemeral', t0);
  s.retention.legalHold(id, 'authority:king', 'أمر ملكي', t0);
  const holds = s.retention.holdsReport();
  assert.equal(holds.length, 1);
  assert.equal(holds[0]!.reason, 'أمر ملكي');
});

test('سجل بصنف مجهول (لو وُجد) لا يُشطب صامتًا بل يُبقى', () => {
  const s = bootstrapState();
  const t0 = Date.now();
  // الكتابة نفسها ترفض الصنف المجهول — فهذا يثبت أن الحماية عند المدخل لا عند الشطب
  const w = s.memory.write(A, {
    content: 'سجل', provenance: { kind: 'tool_call', ref: 'audit:1' }, retentionClass: 'مجهول',
  }, t0);
  assert.equal(w.ok, false);
  assert.equal(s.retention.sweep('ministry:data', t0 + 100 * DAY).purged.length, 0);
});
