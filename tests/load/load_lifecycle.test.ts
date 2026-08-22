/**
 * tests/load/load_lifecycle.test.ts — اختبار قبول المرحلة 33
 * شرط القبول في ROADMAP.md حرفيًا: «الحمل الأقصى بلا فقد أوامر ولا تجاوز حصص».
 * المالك: ديوان التدقيق | المدخلات: تهيئة المستودع الفعلية بلا تصغير | المخرجات: حكم واحد
 * التبعيات: bootstrapState + CommandChannel + FairScheduler + LoadDrill
 * الصلاحيات: قياس لا اعتماد؛ كل أمر يمرّ من بوابة التاج (RULE-003)
 * السجلات: load_* في سجل الدولة، وسلسلة التدقيق تُتحقَّق بعد الضغط
 * حالات الفشل: أي فقد أو تجاوز أو مهمة منسية أو خرق عتبة ⇒ الحكم fail والاختبار يسقط
 * الوثيقة المرتبطة: docs/test-reports/phase-33.md
 * ثوابت هذا الاختبار:
 *   1) **الحمل الأقصى المعلن لا حمل مصغّر**: الأرقام من config/load.yaml مباشرة.
 *   2) **الفقد صفر حرفيًا**: يُتحقَّق منه من دفترين مستقلّين لا من واحد.
 *   3) **الحالة تعود إلى خط الأساس**: تمرينٌ يترك أثرًا ليس تمرينًا.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapState, CommandChannel, FairScheduler, LoadDrill, LoadLedger,
} from '../../src/index';

function fullState() {
  const dir = mkdtempSync(join(tmpdir(), 'sool-load-accept-'));
  const now = Date.now();
  const s = bootstrapState({ now, auditPath: join(dir, 'audit.jsonl') });
  const channel = new CommandChannel(s.audit, s.gateway, join(dir, 'channel.json'));
  const scheduler = new FairScheduler(
    s.audit, s.killSwitch, 8,
    s.scaleConfig.policy.scheduler_queue_max, s.scaleConfig.policy.scheduler_owner_queue_max,
  );
  const policy = s.loadConfig.policy;
  const ledger = new LoadLedger({ audit: s.audit, authority: policy.drill_authority, maxLoss: policy.max_command_loss });
  const drill = new LoadDrill({
    audit: s.audit, killSwitch: s.killSwitch, resources: s.resources, ledger, policy, mode: () => s.gateway.mode,
  });
  let counter = 0;
  const issue = () => {
    counter += 1;
    return s.king.issueCommand('create_agent', `agent:accept-${counter}`, { accept: counter }, now);
  };
  return {
    s, dir, policy, channel, scheduler, ledger, drill, issue, now,
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('قبول المرحلة 33: الحمل الأقصى المعلن يمرّ بلا فقد أوامر ولا تجاوز حصص', () => {
  const h = fullState();
  try {
    const baseline = h.s.resources.allocated(h.policy.resource_name);
    const out = h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler, issue: h.issue, now: h.now,
    });
    assert.equal(out.ok, true, 'التمرين لم يُرفض');
    if (!out.ok) return;
    const r = out.report;

    // 1) الحمل الأقصى المعلن فعلًا، لا عيّنة مصغّرة
    assert.equal(r.commands.submitted, h.policy.sustained_commands);
    assert.equal(r.burst.size, h.policy.burst_commands);

    // 2) لا فقد أوامر — من دفترين مستقلّين
    assert.equal(r.ledger.lost, 0);
    assert.equal(r.ledger.mismatches.length, 0);
    assert.equal(r.ledger.declared, h.policy.sustained_commands + h.policy.burst_commands);
    assert.equal(r.ledger.settled, r.ledger.declared);
    assert.equal(r.ledger.observed, r.ledger.declared);
    assert.equal(h.channel.counts().pending, 0);

    // 3) لا تجاوز حصص — والحدّ بُلِغ فعلًا فالرفض واقع لا نظري
    assert.equal(r.quota.overrun, 0);
    assert.equal(r.quota.peakAllocated <= r.quota.total, true);
    assert.equal(r.quota.refused >= 1, true);
    assert.equal(r.quota.restored, true);
    assert.equal(h.s.resources.allocated(h.policy.resource_name), baseline);

    // 4) المجدول أُشبع فوق سقفه ولم ينسَ مهمة
    assert.equal(r.scheduler.probe, h.policy.scheduler_queue_probe);
    assert.equal(r.scheduler.forgotten, 0);
    assert.equal(r.scheduler.refused > 0, true);
    assert.equal(r.scheduler.accepted + r.scheduler.refused, r.scheduler.probe);

    // 5) العتبات الزمنية المعلنة محترمة والحكم واحد لا مجزّأ
    assert.equal(r.commands.p99Ms <= h.policy.channel_p99_ms, true,
      `p99 المقيس ${r.commands.p99Ms} تجاوز العتبة ${h.policy.channel_p99_ms}`);
    assert.equal(r.commands.maxMs <= h.policy.channel_max_ms, true);
    assert.deepEqual(r.breaches, []);
    assert.equal(r.verdict, 'pass');

    // 6) سلسلة التدقيق سليمة بعد الضغط كله
    assert.equal(h.s.audit.verifyIntegrity().valid, true);
  } finally { h.clean(); }
});

test('قبول المرحلة 33: كل أمر تحت الحمل نُفّذ مرة واحدة فقط', () => {
  const h = fullState();
  try {
    let executions = 0;
    const out = h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler,
      issue: h.issue, executor: () => { executions += 1; }, now: h.now,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    const declared = h.policy.sustained_commands + h.policy.burst_commands;
    assert.equal(executions, declared, 'عدد التنفيذات يساوي عدد الأوامر بلا زيادة ولا نقص');
    h.channel.process(() => { executions += 1; }, h.now);
    assert.equal(executions, declared, 'إعادة المعالجة لا تنفّذ شيئًا مرة ثانية');
  } finally { h.clean(); }
});

test('قبول المرحلة 33: الحمل لا يفتح مسارًا جانبيًا حول بوابة التاج', () => {
  const h = fullState();
  try {
    h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler, issue: h.issue, now: h.now,
    });
    const approved = h.s.audit.find('command_approved').length;
    const declared = h.policy.sustained_commands + h.policy.burst_commands;
    assert.equal(approved >= declared, true, 'كل أمر منفَّذ له اعتماد من البوابة');
    assert.equal(h.s.audit.find('side_channel_blocked').length, 0);
    assert.equal(h.s.audit.find('sovereign_violation').length, 0);
  } finally { h.clean(); }
});

test('قبول المرحلة 33: الحالة تعود إلى خط الأساس بعد التمرين', () => {
  const h = fullState();
  try {
    const queuedBefore = h.scheduler.queued();
    const allocatedBefore = h.s.resources.allocated(h.policy.resource_name);
    h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler, issue: h.issue, now: h.now,
    });
    assert.equal(h.scheduler.queued(), queuedBefore, 'لا مهمة عالقة في الطابور');
    assert.equal(h.s.resources.allocated(h.policy.resource_name), allocatedBefore, 'لا حصة محجوزة');
    assert.equal(h.s.mode(), 'normal', 'التمرين لا يترك الدولة في وضع غير طبيعي');
    assert.equal(h.s.killSwitch.status.engaged, false);
  } finally { h.clean(); }
});

test('قبول المرحلة 33: القناة تستعيد كل مصائر الحمل بعد إعادة التشغيل', () => {
  const h = fullState();
  try {
    h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler, issue: h.issue, now: h.now,
    });
    const before = h.channel.counts();
    const reopened = new CommandChannel(h.s.audit, h.s.gateway, join(h.dir, 'channel.json'));
    assert.deepEqual(reopened.counts(), before, 'انقطاع العملية لا يُفقد مصيرًا واحدًا');
    assert.equal(reopened.list().length, h.policy.sustained_commands + h.policy.burst_commands);
  } finally { h.clean(); }
});

test('قبول المرحلة 33: التقرير يُسجَّل في السجل الأبدي بحكمه لا بملخّص شفهي', () => {
  const h = fullState();
  try {
    h.drill.run({
      by: h.policy.drill_authority, channel: h.channel, scheduler: h.scheduler, issue: h.issue, now: h.now,
    });
    const reports = h.s.audit.find('load_drill_report');
    assert.equal(reports.length, 1);
    assert.equal((reports[0]!.detail as { verdict: string }).verdict, 'pass');
    assert.equal((reports[0]!.detail as { lost: number }).lost, 0);
    assert.equal(h.s.audit.find('load_drill_breach').length, 0);
  } finally { h.clean(); }
});
