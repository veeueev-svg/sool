/**
 * src/load/load_drill.ts — تمرين الضغط المعلن (المرحلة 33)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/load.yaml + قناة أوامر + سجل موارد + مجدول + دفتر حمل
 * المخرجات: تقرير ضغط بأرقام مقيسة وحُكم (pass/fail) لا يُجمَّل، وتصعيد عند الخرق
 * التبعيات: قناة الأوامر (المرحلة 7)، سجل الموارد (المرحلة 5)، المجدول (المرحلة 31)،
 *            مفتاح الإيقاف (المرحلة 9)، دفتر الحمل (هذه المرحلة)
 * الصلاحيات: القياس والتصعيد فقط. التمرين لا يعتمد أمرًا ولا يمنح حصة ولا يرفع سقفًا
 *            (RULE-004 و RULE-005): كل ما يفعله يمرّ من الطريق المعلن نفسه.
 * السجلات: load_calibration_measured / load_drill_started / load_drill_refused / load_commands_measured /
 *           load_burst_measured / load_quota_measured / load_scheduler_measured /
 *           load_drill_breach / load_drill_report / escalated_to_king
 * حالات الفشل (كلها مغلقة):
 *   - مُشغّل غير جهة التهيئة ⇒ رفض مسجَّل ولا قياس
 *   - دولة غير طبيعية (إيقاف أو حماية) ⇒ رفض مسجَّل: لا ضغط على دولة مريضة (RULE-007)
 *   - طلب فوق الحمل المعلن ⇒ رفض: التمرين لا يتجاوز سياسته ليقيسها
 *   - أي فقد أو تجاوز حصة أو خرق عتبة ⇒ الحكم fail ويُصعَّد، ولا نجاح جزئي
 * اختبارات الوحدة: tests/load/load_drill.test.ts, tests/load/quota_pressure.test.ts
 * اختبار القبول: tests/load/load_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0017-load-drills.md
 * ثوابت هذه الوحدة:
 *   1) **التمرين لا يتجاوز المعلن**: حمل فوق `sustained_commands` أو دفعة فوق
 *      `burst_commands` مرفوضان — ومن قاس بتجاوز السياسة قاس شيئًا آخر.
 *   2) **لا ضغط إلا على دولة طبيعية**: الإيقاف وحالة الحماية يُبطلان التمرين لا يؤجّلانه.
 *   3) **لا نجاح جزئي**: خرق واحد في أي طور يُفشل الحكم كله (RULE-008).
 *   4) **التمرين لا يترك أثرًا**: كل حصة استأجرها تُستعاد، وكل مهمة أدرجها تُصرَّف،
 *      ويُتحقَّق من العودة إلى خط الأساس — وإلا فهو خرق باسمه لا تنظيف صامت.
 *   5) **من يقيس لا ينفّذ**: المُشغّل من التهيئة وهو جهة تدقيق، والقناة تعتمد وتنفّذ (RULE-004).
 *   6) **الإعلانُ والحكمُ خرجا، والقياسُ بقي** (الجلسة 42 · T-113): الأشكالُ في
 *      `load_drill_types.ts`، وحصرُ الخرق في المقيس دوالَّ **نقيّةً** في `load_breach.ts`؛
 *      وبقي هنا ما **يفعل**: يستأجر حصةً ويُدرج مهمّةً ويكتب قيدَ تدقيق. والسقّاطةُ تقتضي
 *      أنّ سقفَ هذا الملف لا يُرفع بعد اليوم — والصفُّ محذوفٌ من `scripts/limits/module_limits.yaml`.
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { SYNC_CALL_LEASE_SECONDS } from '../kernel/resource_registry';
import { CommandChannel, CommandExecutor } from '../crown/command_channel';
import { FairScheduler } from '../scale/scheduler';
import { LoadFate } from './load_ledger';
import {
  BurstPressureReport, CommandPressureInput, CommandPressureReport, LoadDrillDeps,
  LoadDrillReport, LoadPolicy, PressureOutcome, QuotaPressureReport,
  SchedulerPressureInput, SchedulerPressureReport,
} from './load_drill_types';
import { CalibrationProbe } from './load_calibration_probe';
import {
  burstBreaches, commandBreaches, ledgerBreaches, percentile, quotaBreaches, schedulerBreaches,
} from './load_breach';
import { judgeDrill } from './load_verdicts';

/**
 * واجهةُ التصدير تبقى هنا كما كانت قبل التفكيك: من كان يستورد شكلًا من هذا المسار
 * يستوردُه منه بعد التفكيك — فلا يُعدَّل مستوردٌ ولا اختبارٌ (سابقة `region_registry.ts`).
 */
export type {
  BurstPressureReport, CommandPressureInput, CommandPressureReport, LoadDrillDeps,
  LoadDrillReport, LoadPolicy, PressureOutcome, QuotaPressureReport,
  SchedulerPressureInput, SchedulerPressureReport,
} from './load_drill_types';

const NOOP_EXECUTOR: CommandExecutor = () => undefined;

export class LoadDrill {
  constructor(private readonly deps: LoadDrillDeps) {
    deps.audit.append(deps.policy.drill_authority, 'load_drill_online', {
      sustained: deps.policy.sustained_commands, burst: deps.policy.burst_commands,
      p99Ms: deps.policy.channel_p99_ms, maxMs: deps.policy.channel_max_ms,
      maxLoss: deps.policy.max_command_loss, maxOverrun: deps.policy.max_quota_overrun,
    });
    this.probe = new CalibrationProbe(deps);
  }

  private readonly probe: CalibrationProbe;

  /** بوابة كل طور: الجهة ثم وضع الدولة. الرفض مسجَّل باسم سببه. */
  private admit(by: EntityId, phase: string): string | null {
    if (by !== this.deps.policy.drill_authority) {
      this.refuse(by, phase, 'LOAD_DRILL_UNAUTHORIZED');
      return 'LOAD_DRILL_UNAUTHORIZED';
    }
    if (this.deps.killSwitch.status.engaged) {
      this.refuse(by, phase, 'LOAD_DRILL_HALTED');
      return 'LOAD_DRILL_HALTED';
    }
    const mode = this.deps.mode();
    if (mode !== 'normal') {
      this.refuse(by, phase, 'LOAD_DRILL_STATE_NOT_NORMAL');
      return 'LOAD_DRILL_STATE_NOT_NORMAL';
    }
    return null;
  }

  private refuse(by: EntityId, phase: string, code: string): void {
    this.deps.audit.append(by, 'load_drill_refused', { phase, code });
  }

  /**
   * الطور الأول: حمل مستمر أمرًا أمرًا، من الإدراج إلى المصير، بقياس زمن كل دورة.
   * لا يُعالَج أمران في نداء واحد كي يكون الزمن المقيس زمن أمرٍ بعينه لا معدّل دفعة.
   */
  pressureCommands(input: CommandPressureInput): PressureOutcome<CommandPressureReport> {
    const denial = this.admit(input.by, 'commands');
    if (denial) return { ok: false, code: denial };
    const policy = this.deps.policy;
    if (!Number.isSafeInteger(input.count) || input.count <= 0) {
      this.refuse(input.by, 'commands', 'LOAD_DRILL_COUNT_INVALID');
      return { ok: false, code: 'LOAD_DRILL_COUNT_INVALID' };
    }
    if (input.count > policy.sustained_commands) {
      this.refuse(input.by, 'commands', 'LOAD_DRILL_OVER_DECLARED');
      return { ok: false, code: 'LOAD_DRILL_OVER_DECLARED' };
    }

    const now = input.now ?? Date.now();
    const executor = input.executor ?? NOOP_EXECUTOR;
    const latencies: number[] = [];
    const counted: Record<LoadFate, number> = { executed: 0, denied: 0, failed: 0 };
    this.deps.audit.append(input.by, 'load_drill_started', { phase: 'commands', count: input.count });

    for (let index = 0; index < input.count; index += 1) {
      const command = input.issue(index);
      const startedAt = performance.now();
      this.deps.ledger.declare(command.payload.commandId);
      input.channel.submit(command);
      const outcomes = input.channel.process(executor, now);
      latencies.push(performance.now() - startedAt);
      for (const outcome of outcomes) {
        if (outcome.status === 'pending') continue; // إعادة محاولة: لا مصير بعد
        counted[outcome.status] += 1;
        this.deps.ledger.settle(outcome.commandId, outcome.status);
      }
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const p99Ms = percentile(sorted, 0.99);
    const maxMs = sorted[sorted.length - 1] ?? 0;
    const meanMs = latencies.reduce((sum, value) => sum + value, 0) / (latencies.length || 1);
    const settled = counted.executed + counted.denied + counted.failed;
    const breaches = commandBreaches(
      { p99Ms, maxMs, settled, count: input.count }, policy, this.probe.read(input.by).scale,
    );

    const report: CommandPressureReport = {
      submitted: input.count, executed: counted.executed, denied: counted.denied,
      failed: counted.failed, p99Ms, maxMs, meanMs, breaches,
    };
    this.deps.audit.append(input.by, 'load_commands_measured', {
      submitted: report.submitted, executed: report.executed, denied: report.denied,
      failed: report.failed, p99Ms: Number(p99Ms.toFixed(3)), maxMs: Number(maxMs.toFixed(3)),
      breaches,
    });
    return { ok: true, report };
  }

  /**
   * الطور الثاني: دفعة واحدة بحجم الدفعة المعلنة تُدرج كاملة ثم تُعالَج مرة واحدة.
   * المقيس هنا زمن الدفعة ومعدّل الأمر داخلها — لا يُقدَّم معدّلٌ مكان p99.
   */
  pressureBurst(input: CommandPressureInput): PressureOutcome<BurstPressureReport> {
    const denial = this.admit(input.by, 'burst');
    if (denial) return { ok: false, code: denial };
    const policy = this.deps.policy;
    if (!Number.isSafeInteger(input.count) || input.count <= 0) {
      this.refuse(input.by, 'burst', 'LOAD_DRILL_COUNT_INVALID');
      return { ok: false, code: 'LOAD_DRILL_COUNT_INVALID' };
    }
    if (input.count > policy.burst_commands) {
      this.refuse(input.by, 'burst', 'LOAD_DRILL_BURST_OVER_DECLARED');
      return { ok: false, code: 'LOAD_DRILL_BURST_OVER_DECLARED' };
    }

    const now = input.now ?? Date.now();
    const executor = input.executor ?? NOOP_EXECUTOR;
    this.deps.audit.append(input.by, 'load_drill_started', { phase: 'burst', count: input.count });
    const startedAt = performance.now();
    for (let index = 0; index < input.count; index += 1) {
      const command = input.issue(index);
      this.deps.ledger.declare(command.payload.commandId);
      input.channel.submit(command);
    }
    const outcomes = input.channel.process(executor, now);
    const durationMs = performance.now() - startedAt;

    let settled = 0;
    for (const outcome of outcomes) {
      if (outcome.status === 'pending') continue;
      settled += 1;
      this.deps.ledger.settle(outcome.commandId, outcome.status);
    }
    const perCommandMs = durationMs / input.count;
    const breaches = burstBreaches(
      { settled, count: input.count, perCommandMs }, policy, this.probe.read(input.by).scale,
    );

    const report: BurstPressureReport = { size: input.count, settled, durationMs, perCommandMs, breaches };
    this.deps.audit.append(input.by, 'load_burst_measured', {
      size: report.size, settled: report.settled,
      durationMs: Number(durationMs.toFixed(3)), perCommandMs: Number(perCommandMs.toFixed(3)), breaches,
    });
    return { ok: true, report };
  }

  /**
   * الطور الثالث: ضغط الحصص حتى السقف وواحدًا فوقه.
   * لا يُحقن تخصيص من خارج `lease()`، والمقيس هو أن الذروة لا تتجاوز السقف قطّ.
   */
  pressureQuota(by: EntityId, now = Date.now()): PressureOutcome<QuotaPressureReport> {
    const denial = this.admit(by, 'quota');
    if (denial) return { ok: false, code: denial };
    const policy = this.deps.policy;
    const resource = policy.resource_name;
    const amount = policy.quota_probe_amount;
    const spec = this.deps.resources.spec(resource);
    const baseline = this.deps.resources.allocated(resource, now);
    const capacity = Math.floor((spec.total - baseline) / amount);
    const attempts = capacity + 1; // واحد فوق السقف: الحدّ لا يكون حماية إن لم يُبلَغ
    this.deps.audit.append(by, 'load_drill_started', { phase: 'quota', resource, amount, attempts });

    const entities: EntityId[] = [];
    let granted = 0;
    let refused = 0;
    let overrun = 0;
    let peakAllocated = baseline;
    for (let index = 0; index < attempts; index += 1) {
      const entity: EntityId = `agent:load-quota-${index}`;
      const result = this.deps.resources.lease(entity, resource, amount, now, SYNC_CALL_LEASE_SECONDS);
      if (result.granted) {
        granted += 1;
        entities.push(entity);
      } else {
        refused += 1;
      }
      const allocated = this.deps.resources.allocated(resource, now);
      if (allocated > peakAllocated) peakAllocated = allocated;
      if (allocated > spec.total) overrun += 1;
    }

    for (const entity of entities) this.deps.resources.releaseAllFor(entity);
    const restored = this.deps.resources.allocated(resource, now) === baseline;

    const breaches = quotaBreaches({
      overrun, peakAllocated, total: spec.total, granted, capacity, refused, restored,
    }, policy);

    const report: QuotaPressureReport = {
      resource, amount, attempts, granted, refused,
      peakAllocated, total: spec.total, overrun, restored, breaches,
    };
    this.deps.audit.append(by, 'load_quota_measured', {
      resource, attempts, granted, refused, peakAllocated, total: spec.total, overrun, restored, breaches,
    });
    return { ok: true, report };
  }

  /**
   * الطور الرابع: إشباع المجدول فوق سقفه المعلن.
   * المقيس: كل مهمة مقبولة لها حالة، وكل مرفوضة لها رمز، ولا مهمة بلا أثر.
   */
  pressureScheduler(input: SchedulerPressureInput): PressureOutcome<SchedulerPressureReport> {
    const denial = this.admit(input.by, 'scheduler');
    if (denial) return { ok: false, code: denial };
    const policy = this.deps.policy;
    const probe = input.probe ?? policy.scheduler_queue_probe;
    if (!Number.isSafeInteger(probe) || probe <= 0) {
      this.refuse(input.by, 'scheduler', 'LOAD_DRILL_PROBE_INVALID');
      return { ok: false, code: 'LOAD_DRILL_PROBE_INVALID' };
    }
    if (probe > policy.scheduler_queue_probe) {
      this.refuse(input.by, 'scheduler', 'LOAD_DRILL_PROBE_OVER_DECLARED');
      return { ok: false, code: 'LOAD_DRILL_PROBE_OVER_DECLARED' };
    }
    const scheduler = input.scheduler;
    this.deps.audit.append(input.by, 'load_drill_started', { phase: 'scheduler', probe });

    const accepted: string[] = [];
    const refusalCodes = new Set<string>();
    let refused = 0;
    // مالك «حارّ» معلن يتجاوز سقفه بواحد: سقف عدالة لا يُبلَغ ليس سقفًا، والتوزيع
    // المتساوي وحده يخفي عطل العدالة لأنه لا يصل إليه أبدًا.
    const hot = scheduler.ownerQueueMax + 1;
    const spread = Math.max(1, Math.ceil(Math.max(0, probe - hot) / scheduler.ownerQueueMax));
    for (let index = 0; index < probe; index += 1) {
      const taskId = `task:load-${index}`;
      const owner = index < hot ? 'ministry:load-hot' : `ministry:load-${(index - hot) % spread}`;
      const result = scheduler.enqueue(taskId, owner);
      if (result.ok) accepted.push(taskId);
      else {
        refused += 1;
        refusalCodes.add(result.code);
      }
    }
    const forgotten = accepted.filter((taskId) => scheduler.statusOf(taskId) === null).length;

    let drained = 0;
    for (let guard = 0; guard < probe * 2 + 8; guard += 1) {
      const task = scheduler.next();
      if (!task) break;
      if (scheduler.complete(task.taskId)) drained += 1;
    }

    const breaches = schedulerBreaches({
      forgotten, accepted: accepted.length, queueMax: scheduler.queueMax, refused,
      refusalCodeCount: refusalCodes.size, drained, probe,
    });

    const report: SchedulerPressureReport = {
      probe, accepted: accepted.length, refused, refusalCodes: [...refusalCodes],
      queueMax: scheduler.queueMax, forgotten, drained, breaches,
    };
    this.deps.audit.append(input.by, 'load_scheduler_measured', {
      probe, accepted: accepted.length, refused, refusalCodes: [...refusalCodes],
      forgotten, drained, breaches,
    });
    return { ok: true, report };
  }

  /**
   * التمرين الكامل: الأطوار الأربعة ثم مطابقة الدفترين ثم الحكم.
   * الحكم `pass` لا يُعلن إلا بصفر فقد وصفر تجاوز وصفر خرق عتبة وصفر اختلاف دفتر.
   */
  run(input: {
    readonly by: EntityId;
    readonly channel: CommandChannel;
    readonly scheduler: FairScheduler;
    readonly issue: (index: number) => SignedRoyalCommand;
    readonly count?: number;
    readonly burst?: number;
    readonly executor?: CommandExecutor;
    readonly now?: number;
  }): PressureOutcome<LoadDrillReport> {
    const policy = this.deps.policy;
    const now = input.now ?? Date.now();
    const commands = this.pressureCommands({
      by: input.by, channel: input.channel, count: input.count ?? policy.sustained_commands,
      issue: input.issue, ...(input.executor ? { executor: input.executor } : {}), now,
    });
    if (!commands.ok) return commands;
    const burst = this.pressureBurst({
      by: input.by, channel: input.channel, count: input.burst ?? policy.burst_commands,
      issue: (index) => input.issue(index + (input.count ?? policy.sustained_commands)),
      ...(input.executor ? { executor: input.executor } : {}), now,
    });
    if (!burst.ok) return burst;
    const quota = this.pressureQuota(input.by, now);
    if (!quota.ok) return quota;
    const scheduler = this.pressureScheduler({ by: input.by, scheduler: input.scheduler });
    if (!scheduler.ok) return scheduler;

    const ledger = this.deps.ledger.reconcile(input.channel.list().map((record) => ({
      commandId: record.commandId, status: record.status,
    })));

    // ترتيبُ الرموز عقدٌ: المعايرةُ تُذيَّل آخرًا كي لا يتغيّر ما تقرؤه الاختباراتُ القائمة
    const calibration = this.probe.read(input.by);
    const breaches = [
      ...commands.report.breaches, ...burst.report.breaches,
      ...quota.report.breaches, ...scheduler.report.breaches,
      ...ledgerBreaches(ledger, policy), ...calibration.breaches,
    ];
    // حكمان لا حكمٌ ممزوج (W-2026-023 · ADR-0047): `verdict` صار حكمَ سلامةِ الدولةِ
    // وحدَه — حتميٌّ لا يقرأ ساعةً — والزمنُ له حكمُه وقيدُه ومقياسُه المُعلن.
    const { split, verdict, timing } = judgeDrill(breaches, {
      p99Ms: commands.report.p99Ms, maxMs: commands.report.maxMs,
      perCommandMs: burst.report.perCommandMs,
      calibrationScale: calibration.scale, calibrationMs: calibration.measuredMs,
    });
    const report: LoadDrillReport = {
      calibration,
      commands: commands.report, burst: burst.report, quota: quota.report,
      scheduler: scheduler.report, ledger, breaches, verdict, split, timing,
    };
    if (verdict === 'fail') {
      this.deps.audit.append(input.by, 'load_drill_breach', { breaches: split.integrity, lost: ledger.lost });
      if (policy.escalate_on_breach) {
        this.deps.audit.append(input.by, 'escalated_to_king', {
          reason: 'خرق في تمرين الضغط', breaches: split.integrity,
        });
      }
    }
    // الحمرةُ الزمنيّةُ **تُكتب دائمًا** ولو كانت السلامةُ خضراء: عزلُها عن بوابةِ
    // السلامةِ ليس إسكاتَها، ومن حذف هذا القيدَ حوّل العزلَ إلى تستُّر.
    if (timing.verdict === 'fail') {
      this.deps.audit.append(input.by, 'load_timing_breach', {
        breaches: split.timing, measured: timing.measured,
      });
    }
    this.deps.audit.append(input.by, 'load_drill_report', {
      verdict, breaches,
      integrityBreaches: split.integrity,
      timingVerdict: timing.verdict, timingBreaches: split.timing,
      commands: commands.report.submitted, burst: burst.report.size,
      quotaGranted: quota.report.granted, schedulerAccepted: scheduler.report.accepted,
      lost: ledger.lost,
    });
    return { ok: true, report };
  }
}
