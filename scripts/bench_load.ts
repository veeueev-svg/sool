/**
 * scripts/bench_load.ts — قياس الحمل الفعلي لقناة الأوامر والحصص والمجدول (المرحلة 33)
 * المالك: ديوان التدقيق | المدخلات: config/load.yaml ودولة محلية | المخرجات: أرقام مقيسة لا مقدّرة
 * التبعيات: bootstrapState + CommandChannel + LoadDrill | الصلاحيات: قياس محلي لا يغيّر سياسة
 * السجلات: load_* في سجل التدقيق المحلي | حالات الفشل: حكم fail يطبع الخروق ويخرج بحالة 1
 * اختبارات الوحدة: tests/load/* | اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/test-reports/phase-33-bench.txt
 * ثوابت هذه الوحدة: 1) الأرقام من التمرين نفسه لا من حساب موازٍ؛ 2) الإحماء معلن ومستبعد؛
 *                    3) الخرق يُطبع ولا يُبتلع؛ 4) القياس على تهيئة الإنتاج لا على تهيئة مصغّرة.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootstrapState, CommandChannel, FairScheduler } from '../src/index';

const dir = mkdtempSync(join(tmpdir(), 'sool-bench-load-'));
const now = Date.now();
const state = bootstrapState({ now, auditPath: join(dir, 'audit.jsonl') });
const channel = new CommandChannel(state.audit, state.gateway, join(dir, 'channel.json'));
const scheduler = new FairScheduler(
  state.audit, state.killSwitch, 8,
  state.scaleConfig.policy.scheduler_queue_max, state.scaleConfig.policy.scheduler_owner_queue_max,
);
const policy = state.loadConfig.policy;
let counter = 0;
const issue = (): ReturnType<typeof state.king.issueCommand> => {
  counter += 1;
  return state.king.issueCommand('create_agent', `agent:bench-load-${counter}`, { bench: counter }, now);
};

// الإحماء معلن ومستبعد من العينة: زمن JIT الأول ليس زمن النظام المستقر.
const warmupChannel = new CommandChannel(state.audit, state.gateway, join(dir, 'warmup.json'));
for (let i = 0; i < 50; i += 1) { warmupChannel.submit(issue()); warmupChannel.process(() => undefined, now); }

const began = process.hrtime.bigint();
const outcome = state.loadDrill.run({
  by: policy.drill_authority, channel, scheduler, issue, now,
});
const totalMs = Number(process.hrtime.bigint() - began) / 1_000_000;
if (!outcome.ok) { console.log(`رفض التمرين: ${outcome.code}`); process.exit(1); }
const report = outcome.report;
const memory = process.memoryUsage();

console.log('== قياس الحمل — المرحلة 33 ==');
console.log(`التهيئة: مستمر=${policy.sustained_commands} دفعة=${policy.burst_commands} نافذة=${policy.window_seconds}ث`);
console.log(`العتبات المعلنة (مللي ثانية): p99=${policy.channel_p99_ms} أقصى=${policy.channel_max_ms}؛ سقف الفقد=${policy.max_command_loss}؛ سقف تجاوز الحصة=${policy.max_quota_overrun}`);
console.log(`الحمل المستمر: أُرسل=${report.commands.submitted} نُفِّذ=${report.commands.executed} رُفض=${report.commands.denied} فشل=${report.commands.failed}`);
console.log(`زمن الأمر (مللي ثانية): متوسط=${report.commands.meanMs.toFixed(3)} p99=${report.commands.p99Ms.toFixed(3)} أقصى=${report.commands.maxMs.toFixed(3)}`);
console.log(`الدفعة: حجم=${report.burst.size} استقر=${report.burst.settled} زمن الدفعة=${report.burst.durationMs.toFixed(3)} لكل أمر=${report.burst.perCommandMs.toFixed(3)}`);
console.log(`الحصص: المورد=${report.quota.resource} محاولات=${report.quota.attempts} مُنح=${report.quota.granted} رُفض=${report.quota.refused} الذروة=${report.quota.peakAllocated}/${report.quota.total} تجاوز=${report.quota.overrun} استُعيد=${report.quota.restored}`);
console.log(`المجدول: فحص=${report.scheduler.probe} قُبل=${report.scheduler.accepted} رُفض=${report.scheduler.refused} رموز=${report.scheduler.refusalCodes.join('،') || 'لا شيء'} منسي=${report.scheduler.forgotten} صُرِّف=${report.scheduler.drained}`);
console.log(`الدفتران: مُدرج=${report.ledger.declared} مستقر=${report.ledger.settled} مرصود=${report.ledger.observed} فقد=${report.ledger.lost} اختلافات=${report.ledger.mismatches.length} سليم=${report.ledger.sound}`);
console.log(`الخروق: ${report.breaches.length === 0 ? 'لا شيء' : report.breaches.join('، ')}`);
console.log(`الحكم: ${report.verdict}`);
console.log(`زمن التمرين الكلي (مللي ثانية): ${totalMs.toFixed(3)}`);
console.log(`ذاكرة العملية (MiB): RSS=${(memory.rss / 1048576).toFixed(1)} heapUsed=${(memory.heapUsed / 1048576).toFixed(1)}`);
console.log(`سلامة سلسلة التدقيق: ${state.audit.verifyIntegrity().valid}`);
if (report.verdict !== 'pass') process.exit(1);
