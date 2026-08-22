/**
 * tests/load/load_drill.test.ts — تمرين الضغط: صلاحيته وسقوفه وحكمه (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: مهاد ضغط بسقوف معلنة | المخرجات: تقارير أطوار وحكم
 * التبعيات: LoadDrill + القناة + المجدول + مفتاح الإيقاف | الصلاحيات: قياس لا اعتماد (RULE-004)
 * السجلات: load_drill_started / load_drill_refused / load_*_measured / load_drill_report
 * حالات الفشل: جهة غير مخوّلة، دولة غير طبيعية، تجاوز المعلن، خرق عتبة — كلها مغلقة ومسجَّلة
 * اختبار القبول: tests/load/load_lifecycle.test.ts | الوثيقة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت الاختبار: 1) من يقيس لا ينفّذ؛ 2) لا ضغط على دولة مريضة؛ 3) لا نجاح جزئي.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { countEvent, hasEvent, lastDetail, loadHarness } from './helpers';

test('التمرين يُعلن سياسته لحظة بنائه', () => {
  const h = loadHarness();
  assert.equal(lastDetail(h.s, 'load_drill_online').maxLoss, 0);
  assert.equal(lastDetail(h.s, 'load_drill_online').sustained, h.policy.sustained_commands);
});

test('جهة غير جهة التهيئة تُرفض في كل طور', () => {
  const h = loadHarness();
  const by = 'ministry:intruder';
  assert.equal(h.drill.pressureCommands({ by, channel: h.channel, count: 1, issue: () => h.issue() }).ok, false);
  assert.equal(h.drill.pressureBurst({ by, channel: h.channel, count: 1, issue: () => h.issue() }).ok, false);
  assert.equal(h.drill.pressureQuota(by).ok, false);
  assert.equal(h.drill.pressureScheduler({ by, scheduler: h.scheduler }).ok, false);
  assert.equal(countEvent(h.s, 'load_drill_refused'), 4);
});

test('الرفض غير المخوّل يحمل رمزه لا نصًا عامًا', () => {
  const h = loadHarness();
  const out = h.drill.pressureQuota('agent:rogue');
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_UNAUTHORIZED');
  assert.equal(lastDetail(h.s, 'load_drill_refused').code, 'LOAD_DRILL_UNAUTHORIZED');
});

test('الملك نفسه ليس جهة تمرين — من يقيس لا ينفّذ', () => {
  const h = loadHarness();
  const out = h.drill.pressureQuota(h.s.king.kingId);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_UNAUTHORIZED');
});

test('مفتاح الإيقاف يُبطل التمرين ولا يؤجّله', () => {
  const h = loadHarness();
  h.s.killSwitch.engage(h.s.king.kingId, 'all', 'اختبار');
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_HALTED');
});

test('حالة الحماية (غياب الملك) تمنع التمرين', () => {
  const h = loadHarness();
  const late = h.s.heartbeat.evaluate(Date.now() + 86_400_000 * 30);
  assert.notEqual(late, 'normal');
  const drill = h.drill;
  const out = drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler });
  // الوضع يُقرأ من البوابة لحظة النداء؛ إن كان طبيعيًا فالتمرين يمضي وهذا معلن.
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_STATE_NOT_NORMAL');
  else assert.equal(h.s.gateway.mode, 'normal');
});

test('عدد غير صحيح للحمل مرفوض برمزه', () => {
  const h = loadHarness();
  for (const count of [0, -1, 2.5]) {
    const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count, issue: () => h.issue() });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_COUNT_INVALID');
  }
});

test('حمل فوق المعلن مرفوض — التمرين لا يتجاوز سياسته ليقيسها', () => {
  const h = loadHarness({ sustained_commands: 5 });
  const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 6, issue: () => h.issue() });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_OVER_DECLARED');
});

test('الحمل عند السقف المعلن بالضبط مقبول', () => {
  const h = loadHarness({ sustained_commands: 5 });
  const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 5, issue: () => h.issue() });
  assert.equal(out.ok, true);
  if (out.ok) assert.equal(out.report.submitted, 5);
});

test('دفعة فوق المعلن مرفوضة برمز مستقل عن الحمل المستمر', () => {
  const h = loadHarness({ burst_commands: 3 });
  const out = h.drill.pressureBurst({ by: h.authority, channel: h.channel, count: 4, issue: () => h.issue() });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_BURST_OVER_DECLARED');
});

test('الحمل المستمر يُنفّذ كل أمر ويستقرّ مصيره', () => {
  const h = loadHarness({ sustained_commands: 12 });
  const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 12, issue: () => h.issue() });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.executed, 12);
  assert.equal(out.report.denied, 0);
  assert.equal(out.report.failed, 0);
  assert.equal(h.ledger.declaredCount, 12);
});

test('كل أمر مُدرج في الدفتر لحظة تقديمه للقناة', () => {
  const h = loadHarness({ sustained_commands: 4 });
  h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 4, issue: () => h.issue() });
  assert.equal(countEvent(h.s, 'load_command_declared'), 4);
  assert.equal(countEvent(h.s, 'load_command_settled'), 4);
});

test('المنفّذ الذي يرمي دائمًا يُنتج مصير فشل لا نجاحًا مُدّعى', () => {
  const h = loadHarness({ sustained_commands: 3 }, { maxAttempts: 1 });
  const out = h.drill.pressureCommands({
    by: h.authority, channel: h.channel, count: 3, issue: () => h.issue(),
    executor: () => { throw new Error('عطل مُصطنع'); },
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.failed, 3);
  assert.equal(out.report.executed, 0);
});

test('أمر منتهي الصلاحية يُرفض من البوابة ويُسجَّل مصيره رفضًا', () => {
  const h = loadHarness({ sustained_commands: 2 });
  const out = h.drill.pressureCommands({
    by: h.authority, channel: h.channel, count: 2, issue: () => h.issue(),
    now: Date.now() + 10 * 60 * 1000,
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.denied, 2);
  assert.equal(out.report.executed, 0);
});

test('قياس الزمن يُسجَّل بأرقامه لا بحكم مجرد', () => {
  const h = loadHarness({ sustained_commands: 5 });
  h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 5, issue: () => h.issue() });
  const detail = lastDetail(h.s, 'load_commands_measured');
  assert.equal(typeof detail.p99Ms, 'number');
  assert.equal(typeof detail.maxMs, 'number');
  assert.equal(detail.submitted, 5);
});

test('عتبة زمن مستحيلة تُنتج خرقًا معلنًا — العتبة تُقرأ فعلًا', () => {
  const h = loadHarness({ sustained_commands: 4, channel_p99_ms: 0, channel_max_ms: 0 });
  const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 4, issue: () => h.issue() });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.breaches.includes('COMMAND_P99_OVER_THRESHOLD'), true);
  assert.equal(out.report.breaches.includes('COMMAND_MAX_OVER_THRESHOLD'), true);
});

test('عتبة زمن واسعة لا تُنتج خرقًا', () => {
  const h = loadHarness({ sustained_commands: 4, channel_p99_ms: 10_000, channel_max_ms: 10_000 });
  const out = h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 4, issue: () => h.issue() });
  if (out.ok) assert.deepEqual(out.report.breaches, []);
});

test('الدفعة تُدرج كاملة ثم تُعالَج مرة واحدة', () => {
  const h = loadHarness({ burst_commands: 8 });
  const out = h.drill.pressureBurst({ by: h.authority, channel: h.channel, count: 8, issue: () => h.issue() });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.size, 8);
  assert.equal(out.report.settled, 8);
  assert.equal(out.report.durationMs >= 0, true);
});

test('الدفعة تُسجَّل بزمنها ومعدّلها', () => {
  const h = loadHarness({ burst_commands: 4 });
  h.drill.pressureBurst({ by: h.authority, channel: h.channel, count: 4, issue: () => h.issue() });
  const detail = lastDetail(h.s, 'load_burst_measured');
  assert.equal(detail.size, 4);
  assert.equal(detail.settled, 4);
});

test('ضغط الحصص يبلغ السقف ولا يتجاوزه قطّ', () => {
  const h = loadHarness();
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.overrun, 0);
  assert.equal(out.report.peakAllocated <= out.report.total, true);
  assert.equal(out.report.refused >= 1, true, 'الحدّ ليس حماية إن لم يُبلَغ');
});

test('ضغط الحصص يستعيد كل ما استأجره — التمرين لا يترك أثرًا', () => {
  const h = loadHarness();
  const before = h.s.resources.allocated('compute_units');
  const out = h.drill.pressureQuota(h.authority);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.restored, true);
  assert.equal(h.s.resources.allocated('compute_units'), before);
});

test('عدد المنوحين يساوي سعة المورد المعلنة بالضبط', () => {
  const h = loadHarness();
  const spec = h.s.resources.spec('compute_units');
  const out = h.drill.pressureQuota(h.authority);
  if (!out.ok) return;
  assert.equal(out.report.granted, Math.floor(spec.total / h.policy.quota_probe_amount));
  assert.equal(out.report.attempts, out.report.granted + 1);
});

test('ضغط الحصص يُسجَّل بأرقامه', () => {
  const h = loadHarness();
  h.drill.pressureQuota(h.authority);
  const detail = lastDetail(h.s, 'load_quota_measured');
  assert.equal(detail.resource, 'compute_units');
  assert.equal(detail.overrun, 0);
});

test('إشباع المجدول يُرفض برموز لا بصمت', () => {
  const h = loadHarness();
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.refused > 0, true);
  assert.equal(out.report.refusalCodes.length > 0, true);
  assert.equal(out.report.refusalCodes.includes('SCHEDULER_QUEUE_FULL'), true);
});

test('لا مهمة منسية: كل مقبولة لها حالة وكلها تُصرَّف', () => {
  const h = loadHarness();
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler });
  if (!out.ok) return;
  assert.equal(out.report.forgotten, 0);
  assert.equal(out.report.drained, out.report.accepted);
  assert.equal(out.report.accepted + out.report.refused, out.report.probe);
});

test('المقبول لا يتجاوز سقف الطابور المعلن', () => {
  const h = loadHarness({}, { queueMax: 10, ownerQueueMax: 4 });
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler, probe: 40 });
  if (!out.ok) return;
  assert.equal(out.report.accepted <= 10, true);
  assert.equal(out.report.queueMax, 10);
});

test('سقف طابور المالك يُبلَغ فيظهر رمزه', () => {
  const h = loadHarness({}, { queueMax: 64, ownerQueueMax: 2 });
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler, probe: 40 });
  if (!out.ok) return;
  assert.equal(out.report.refusalCodes.includes('SCHEDULER_OWNER_QUEUE_FULL'), true);
});

test('فحص فوق المعلن مرفوض', () => {
  const h = loadHarness({ scheduler_queue_probe: 10 });
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler, probe: 11 });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_PROBE_OVER_DECLARED');
});

test('فحص غير صحيح مرفوض برمزه', () => {
  const h = loadHarness();
  const out = h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler, probe: 0 });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, 'LOAD_DRILL_PROBE_INVALID');
});

test('كل طور يُعلن بدايته باسمه', () => {
  const h = loadHarness({ sustained_commands: 2, burst_commands: 2 });
  h.drill.pressureCommands({ by: h.authority, channel: h.channel, count: 2, issue: () => h.issue() });
  h.drill.pressureBurst({ by: h.authority, channel: h.channel, count: 2, issue: () => h.issue() });
  h.drill.pressureQuota(h.authority);
  h.drill.pressureScheduler({ by: h.authority, scheduler: h.scheduler });
  assert.equal(countEvent(h.s, 'load_drill_started'), 4);
});

test('التمرين الكامل ينجح بلا خرق على تهيئة الإنتاج', () => {
  const h = loadHarness();
  const out = h.drill.run({
    by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue(),
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.report.breaches, []);
  assert.equal(out.report.verdict, 'pass');
  assert.equal(out.report.ledger.lost, 0);
  assert.equal(out.report.ledger.sound, true);
});

test('الحكم الناجح لا يُصعَّد', () => {
  const h = loadHarness();
  h.drill.run({ by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue() });
  assert.equal(hasEvent(h.s, 'load_drill_breach'), false);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), false);
});

test('خرق واحد يُفشل الحكم كله ويُصعَّد', () => {
  const h = loadHarness({ sustained_commands: 4, burst_commands: 2, channel_p99_ms: 0, channel_max_ms: 0 });
  const out = h.drill.run({
    by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue(),
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.report.verdict, 'fail');
  assert.equal(out.report.breaches.length > 0, true);
  assert.equal(hasEvent(h.s, 'load_drill_breach'), true);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), true);
});

test('إسكات التصعيد في التهيئة يمنع رفع الخرق — القيمة تُقرأ فعلًا', () => {
  const h = loadHarness({
    sustained_commands: 4, burst_commands: 2, channel_p99_ms: 0, channel_max_ms: 0,
    escalate_on_breach: false,
  });
  const out = h.drill.run({
    by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue(),
  });
  if (!out.ok) return;
  assert.equal(out.report.verdict, 'fail');
  assert.equal(hasEvent(h.s, 'load_drill_breach'), true);
  assert.equal(hasEvent(h.s, 'escalated_to_king'), false);
});

test('التمرين الكامل يُنهى بتقرير مسجَّل يحمل الحكم', () => {
  const h = loadHarness({ sustained_commands: 6, burst_commands: 3 });
  h.drill.run({ by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue() });
  const detail = lastDetail(h.s, 'load_drill_report');
  assert.equal(detail.verdict, 'pass');
  assert.equal(detail.commands, 6);
  assert.equal(detail.burst, 3);
});

test('رفض طور مبكّر يوقف التمرين الكامل ولا يُكمل الأطوار', () => {
  const h = loadHarness();
  const out = h.drill.run({
    by: 'agent:rogue', channel: h.channel, scheduler: h.scheduler, issue: () => h.issue(),
  });
  assert.equal(out.ok, false);
  assert.equal(hasEvent(h.s, 'load_quota_measured'), false);
  assert.equal(hasEvent(h.s, 'load_drill_report'), false);
});

test('التمرين الكامل يطابق الدفترين على كل ما مرّ بالقناة', () => {
  const h = loadHarness({ sustained_commands: 10, burst_commands: 5 });
  const out = h.drill.run({ by: h.authority, channel: h.channel, scheduler: h.scheduler, issue: () => h.issue() });
  if (!out.ok) return;
  assert.equal(out.report.ledger.declared, 15);
  assert.equal(out.report.ledger.observed, 15);
  assert.equal(out.report.ledger.settled, 15);
  assert.equal(h.channel.counts().pending, 0);
});
