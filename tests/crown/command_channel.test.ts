/**
 * tests/crown/command_channel.test.ts — اختبار قبول المرحلة 7
 * المالك: حرس التاج | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState } from '../../src/index';
import { CommandChannel } from '../../src/crown/command_channel';

function tmpPath(name = 'channel.json'): string {
  return join(mkdtempSync(join(tmpdir(), 'sool-')), name);
}

test('أمر معتمد ينفَّذ مرة واحدة فقط ولو أُعيد الإرسال والمعالجة', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  const cmd = s.king.issueCommand('approve_phase', 'phase:05');
  let executions = 0;

  channel.submit(cmd);
  channel.submit(cmd); // إدراج مكرر
  channel.process(() => { executions += 1; });
  channel.process(() => { executions += 1; });

  assert.equal(executions, 1, 'التنفيذ مرة واحدة فقط');
  assert.equal(channel.statusOf(cmd.payload.commandId), 'executed');
  assert.equal(channel.counts().executed, 1);
  assert.equal(s.audit.find('command_duplicate_submission').length, 1);
});

test('الفشل الجزئي يُعاد المحاولة ثم ينجح بتنفيذ واحد', () => {
  const s = bootstrapState();
  const channel = new CommandChannel(s.audit, s.gateway, tmpPath());
  const cmd = s.king.issueCommand('appoint_official', 'ministry:infrastructure');
  channel.submit(cmd);

  let attempts = 0;
  let succeeded = 0;
  const flaky = () => {
    attempts += 1;
    if (attempts < 2) throw new Error('انقطاع مؤقّت');
    succeeded += 1;
  };

  const first = channel.process(flaky);
  assert.equal(first[0]!.status, 'pending');
  assert.equal(channel.statusOf(cmd.payload.commandId), 'pending');

  const second = channel.process(flaky);
  assert.equal(second[0]!.status, 'executed');
  assert.equal(succeeded, 1, 'أثر واحد فقط رغم إعادة المحاولة');
  assert.equal(channel.attemptsOf(cmd.payload.commandId), 2);
  assert.equal(s.audit.find('command_channel_retry_scheduled').length, 1);
});

test('الفشل المتكرر فوق السقف يُصنَّف فاشلًا نهائيًا ويُرفع للملك', () => {
  const s = bootstrapState();
  const channel = new CommandChannel(s.audit, s.gateway, tmpPath(), 2);
  const cmd = s.king.issueCommand('amend_policy', 'policy:egress');
  channel.submit(cmd);
  const boom = () => { throw new Error('عطل دائم'); };

  channel.process(boom);
  const last = channel.process(boom);

  assert.equal(last[0]!.status, 'failed');
  assert.equal(channel.counts().failed, 1);
  assert.equal(s.audit.find('command_channel_failed_final').length, 1);
  assert.ok(s.audit.find('escalated_to_king').length >= 1);
});

test('أمر مرفوض من البوابة لا يُنفَّذ ولا يُعاد', () => {
  const s = bootstrapState();
  const channel = new CommandChannel(s.audit, s.gateway, tmpPath());
  s.veto.place(s.king.kingId, 'open_external_account', 'ممنوع قبل المرحلة 26');
  const cmd = s.king.issueCommand('open_external_account', 'external:bank');
  channel.submit(cmd);

  let executions = 0;
  const out = channel.process(() => { executions += 1; });
  assert.equal(out[0]!.status, 'denied');
  assert.equal(executions, 0);
  channel.process(() => { executions += 1; });
  assert.equal(executions, 0, 'المرفوض لا يُعاد');
});

test('الحالة تنجو من إعادة التشغيل ولا يُنفَّذ الأمر مرتين', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const cmd = s.king.issueCommand('approve_phase', 'phase:07');
  let executions = 0;

  const before = new CommandChannel(s.audit, s.gateway, path);
  before.submit(cmd);
  before.process(() => { executions += 1; });
  assert.equal(executions, 1);

  // إعادة تشغيل: قناة جديدة تقرأ نفس الملف
  const after = new CommandChannel(s.audit, s.gateway, path);
  assert.equal(after.statusOf(cmd.payload.commandId), 'executed');
  after.process(() => { executions += 1; });
  assert.equal(executions, 1, 'لا تنفيذ ثانٍ بعد إعادة التشغيل');
});

test('تعديل ملف حالة القناة من الخارج يُكشف ويُرفض التحميل', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  channel.submit(s.king.issueCommand('approve_phase', 'phase:08'));

  const file = JSON.parse(readFileSync(path, 'utf8')) as { records: Array<{ status: string }> };
  file.records[0]!.status = 'executed'; // تلاعب: إخفاء أمر معلّق
  writeFileSync(path, JSON.stringify(file), 'utf8');

  assert.throws(() => new CommandChannel(s.audit, s.gateway, path), /بصمة ملف قناة الأوامر/);
});

/*
 * ما يلي أُضيف في المرحلة 33 بعد أن كشف تمرين الضغط أن الحفظ الكامل بعد كل تغيير
 * كلفته تربيعية. الدواء: يوميّة مبصومة تحت الحمل ولقطة كاملة عند الطيّ.
 * لا يتغيّر الضمان المعلن: لا تغيير في الذاكرة بلا أثر على القرص.
 */
import {
  CHANNEL_JOURNAL_COMPACT_AT, CHANNEL_SNAPSHOT_ALWAYS_UNDER,
} from '../../src/crown/command_channel';

/** حمل يتجاوز عتبة اللقطة الدائمة فتُستعمل اليوميّة */
function overSnapshotThreshold(): number { return CHANNEL_SNAPSHOT_ALWAYS_UNDER + 10; }

test('تحت عتبة اللقطة الدائمة تبقى الحالة لقطة كاملة بلا يوميّة', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  channel.submit(s.king.issueCommand('approve_phase', 'phase:33-a'));
  assert.equal(existsSync(`${path}.journal`), false);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).records.length, 1);
});

test('فوق عتبة اللقطة تُكتب يوميّة، والحالة كلها تُستعاد بعد إعادة التشغيل', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  const count = overSnapshotThreshold();
  for (let i = 0; i < count; i += 1) channel.submit(s.king.issueCommand('approve_phase', `phase:33-b-${i}`));
  assert.equal(existsSync(`${path}.journal`), true, 'الحمل يستعمل اليوميّة');
  const reopened = new CommandChannel(s.audit, s.gateway, path);
  assert.equal(reopened.list().length, count);
  assert.equal(reopened.counts().pending, count);
});

test('اليوميّة تحفظ المصائر لا الإدراج وحده', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  const count = overSnapshotThreshold();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) ids.push(channel.submit(s.king.issueCommand('approve_phase', `phase:33-c-${i}`)).commandId);
  channel.process(() => undefined);
  const reopened = new CommandChannel(s.audit, s.gateway, path);
  for (const id of ids) assert.equal(reopened.statusOf(id), 'executed');
  assert.equal(reopened.counts().pending, 0);
});

test('المنفَّذ قبل إعادة التشغيل لا يُنفَّذ ثانية بعدها ولو مرّ من اليوميّة', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  let executions = 0;
  for (let i = 0; i < overSnapshotThreshold(); i += 1) channel.submit(s.king.issueCommand('approve_phase', `phase:33-d-${i}`));
  channel.process(() => { executions += 1; });
  const before = executions;
  const reopened = new CommandChannel(s.audit, s.gateway, path);
  reopened.process(() => { executions += 1; });
  assert.equal(executions, before, 'لا تنفيذ ثانٍ بعد الاستعادة من اليوميّة');
});

test('تعديل سطر يوميّة من الخارج يُكشف ويُرفض التحميل', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  for (let i = 0; i < overSnapshotThreshold(); i += 1) channel.submit(s.king.issueCommand('approve_phase', `phase:33-e-${i}`));
  const journalPath = `${path}.journal`;
  const lines = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.length > 0);
  const tampered = JSON.parse(lines[0]!);
  tampered.record.status = 'executed'; // تلاعب: إخفاء أمر معلّق
  lines[0] = JSON.stringify(tampered);
  writeFileSync(journalPath, `${lines.join('\n')}\n`, 'utf8');
  assert.throws(() => new CommandChannel(s.audit, s.gateway, path), /بصمة سطر يوميّة القناة/);
});

test('يوميّة بلا لقطة حالة غير مكتملة ولا تُخمَّن', () => {
  const s = bootstrapState();
  const path = tmpPath();
  writeFileSync(`${path}.journal`, '{"checksum":"x","record":{}}\n', 'utf8');
  assert.throws(() => new CommandChannel(s.audit, s.gateway, path), /يوميّة قناة أوامر بلا لقطة/);
});

test('الطيّ يكتب لقطة كاملة ويمحو اليوميّة فلا ينمو وقت الاستعادة بلا حدّ', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  const count = CHANNEL_SNAPSHOT_ALWAYS_UNDER + CHANNEL_JOURNAL_COMPACT_AT + 5;
  for (let i = 0; i < count; i += 1) channel.submit(s.king.issueCommand('approve_phase', `phase:33-f-${i}`));
  const snapshot = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(snapshot.records.length > CHANNEL_SNAPSHOT_ALWAYS_UNDER, true, 'اللقطة طُويت عند السقف');
  const reopened = new CommandChannel(s.audit, s.gateway, path);
  assert.equal(reopened.list().length, count);
});

test('الوصول المتزامن: قناتان مستقلتان على نفس الملف لا تُفقدان سجلًا ولا تكرّانه (T-89)', () => {
  const s = bootstrapState();
  const path = tmpPath();
  // افتح قناتين على نفس المسار قبل أي كتابة — كلٌّ منهما تحمل ذاكرتها الخاصة.
  const a = new CommandChannel(s.audit, s.gateway, path);
  const b = new CommandChannel(s.audit, s.gateway, path);
  const cmdA = s.king.issueCommand('create_agent', 'agent:conc-a-1');
  const cmdB = s.king.issueCommand('create_agent', 'agent:conc-b-1');
  a.submit(cmdA);
  // b لم تُحمَّل بعد تسليم a؛ القفل وإعادة التحميل من القرص هما ما يضمنان رؤية سجل a.
  b.submit(cmdB);
  // قناةٌ ثالثةٌ تستعيدُ الحالةَ من القرص: لا تُفقدُ سجلًّا ولا تُكرّرُه.
  const c = new CommandChannel(s.audit, s.gateway, path);
  const all = c.list();
  assert.equal(all.length, 2, 'سجلَّانِ لا أكثر ولا أقلّ');
  const ids = new Set(all.map((r) => r.commandId));
  assert.equal(ids.has(cmdA.payload.commandId), true, 'سجلُّ القناة الأولى محفوظٌ');
  assert.equal(ids.has(cmdB.payload.commandId), true, 'سجلُّ القناة الثانية محفوظٌ');
});

test('الإنكارُ يُحفظُ على القرص فلا يُعادُ معالجتُه ولا يُضاعفُ عدُّه (T-89)', () => {
  const s = bootstrapState();
  const path = tmpPath();
  const channel = new CommandChannel(s.audit, s.gateway, path);
  // رفضٌ بالاستحقاق: ضع نقضًا على فعل فيُرفض أيُّ أمرٍ يحمله.
  s.veto.place(s.king.kingId, 'open_external_account', 'ممنوع في هذا الاختبار');
  const rejected = s.king.issueCommand('open_external_account', 'external:bank');
  channel.submit(rejected);
  const out1 = channel.process(() => { /* لا تنفّذ */ });
  assert.equal(out1[0]!.status, 'denied', 'سجلٌّ واحدٌ مرفوضٌ في المعالجة الأولى');
  // أعد فتح القناة من القرص: سجلُّ الإنكارِ يجب أن يكون محفوظًا، فلا يُعادُ معالجتُه.
  const reopened = new CommandChannel(s.audit, s.gateway, path);
  const out2 = reopened.process(() => { /* لا تنفّذ */ });
  assert.equal(out2.length, 0, 'لا يُعادُ رفضُ ما رُفض ولم يُحفظ');
  const all = reopened.list();
  const r = all.find((x) => x.commandId === rejected.payload.commandId);
  assert.equal(r?.status, 'denied', 'حالةُ السجلّ المرفوض محفوظةٌ على القرص');
});
