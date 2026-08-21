/**
 * tests/crown/command_channel.test.ts — اختبار قبول المرحلة 7
 * المالك: حرس التاج | يوثّق في: docs/test-reports/phase-05-09.md
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
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
