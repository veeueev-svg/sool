/**
 * src/agents/first_agent.ts — أول وكيل محدود في الدولة (المرحلة 15)
 * المالك: وزارة الداخلية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: وكيل مسجَّل بحالة running + قدرات ممنوحة سارية + مهمة مقيّدة
 * المخرجات: نتيجة مهمة واحدة نُفّذت داخل عزل عبر أدوات مسجَّلة، أو رفض بسببه
 * التبعيات: سجل الوكلاء، سجل الصلاحيات، سجل الأدوات، العزل، مفتاح الإيقاف، الإشراف
 * الصلاحيات: لا شيء ذاتيًا — كل قدرة تأتي منحًا ملكيًا مؤقّتًا ويُفحص عند كل استخدام
 * السجلات: agent_task_started / agent_task_completed / agent_task_refused / agent_stopped
 * ثوابت هذه الوحدة:
 *   1) لا تنفيذ إلا والوكيل في حالة running وتحت مرور التاج (الوضع normal)
 *   2) كل مهمة تجري داخل عزل بسقف زمن وسقف عمليات، ولا تلمس شيئًا خارج جذورها
 *   3) الأدوات وحدها منفذ الفعل — لا مسار جانبي إلى الشبكة أو الملف
 *   4) القدرة تُفحص لحظة الاستخدام لا لحظة البدء
 *   5) أمر الإيقاف يُطبَّق فورًا ويمنع أي تنفيذ لاحق (RULE-001)
 *   6) أي مخالفة تُبلَّغ للمشرف فورًا فيقرّر التعليق
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/agents/first_agent.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — المرحلة 15: أول وكيل محدود
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { CrownGateway } from '../crown/crown_gateway';
import { Sandbox, SandboxSpec, SandboxContext, SandboxFs } from '../security/sandbox';
import { NetworkEgressGuard } from '../external/network_egress';
import { ToolRegistry, ToolArgs, ToolResult } from './tools';
import { AgentRegistry } from './agent_registry';
import { PermissionRegistry } from './permissions';
import { Supervisor } from './supervision';

export interface AgentTask {
  readonly taskId: string;
  /** الأدوات التي تنوي المهمة استخدامها — تُعلن مسبقًا ولا تُكتشف لاحقًا */
  readonly plan: readonly { readonly tool: string; readonly args: ToolArgs }[];
  readonly maxWallClockMs?: number;
  readonly maxOperations?: number;
}

export interface AgentTaskOutcome {
  readonly ok: boolean;
  readonly reason: string;
  readonly results: readonly ToolResult[];
  readonly operations: number;
  readonly auditId: string;
}

export interface LimitedAgentDeps {
  readonly audit: AppendOnlyLog;
  readonly registry: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly tools: ToolRegistry;
  readonly killSwitch: KillSwitch;
  readonly gateway: CrownGateway;
  readonly supervisor?: Supervisor;
  readonly egress?: NetworkEgressGuard;
  readonly fs?: SandboxFs;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
}

export class LimitedAgent {
  private stopped = false;

  constructor(private readonly agentId: EntityId, private readonly deps: LimitedAgentDeps) {}

  get id(): EntityId {
    return this.agentId;
  }

  get isStopped(): boolean {
    return this.stopped;
  }

  /** تنفيذ مهمة واحدة مقيّدة — كل بوابة تُفحص بالترتيب ولا تُتخطّى واحدة */
  run(task: AgentTask, now = Date.now()): AgentTaskOutcome {
    const refuse = (reason: string, kind = 'agent_task_refused'): AgentTaskOutcome => {
      const entry = this.deps.audit.append(this.agentId, kind, { taskId: task.taskId, reason });
      return { ok: false, reason, results: [], operations: 0, auditId: entry.hash };
    };

    if (this.stopped) return refuse('الوكيل مُوقَف نهائيًا — لا تنفيذ');
    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return refuse('الإيقاف مُشتغل — لا تنفيذ');
    }
    if (this.deps.gateway.mode !== 'normal') {
      return refuse(`وضع الدولة ${this.deps.gateway.mode} — لا نشاط للوكلاء`);
    }
    const record = this.deps.registry.get(this.agentId);
    if (!record) return refuse('وكيل غير مسجَّل');
    if (record.status !== 'running') return refuse(`حالة الوكيل ${record.status} — لا تنفيذ`);
    if (task.plan.length === 0) return refuse('خطة مهمة فارغة مرفوضة');

    const spec: SandboxSpec = {
      sandboxId: `sbx:${this.agentId}:${task.taskId}`,
      entity: this.agentId,
      capabilities: [...this.deps.permissions.granted(this.agentId, now)],
      readRoots: this.deps.readRoots ?? [],
      writeRoots: this.deps.writeRoots ?? [],
      network: this.deps.egress ? 'allowlist' : 'none',
      maxWallClockMs: task.maxWallClockMs ?? 5_000,
      maxOperations: task.maxOperations ?? 32,
    };
    const sandbox = new Sandbox(spec, {
      audit: this.deps.audit,
      killSwitch: this.deps.killSwitch,
      egress: this.deps.egress,
      fs: this.deps.fs,
    });

    this.deps.audit.append(this.agentId, 'agent_task_started', {
      taskId: task.taskId, steps: task.plan.length, capabilities: spec.capabilities,
    });

    const results: ToolResult[] = [];
    const run = sandbox.run((ctx: SandboxContext) => {
      for (const step of task.plan) {
        ctx.useCapability('compute'); // كل خطوة تُحاسب على قدرة الحساب
        const grants = this.deps.permissions.granted(this.agentId, now);
        const result = this.deps.tools.invoke(this.agentId, step.tool, step.args, grants, now);
        results.push(result);
        if (!result.ok) {
          this.deps.supervisor?.observe(
            this.agentId,
            { kind: 'tool_denied', severity: 'minor', detail: `${step.tool}: ${result.reason}` },
            now,
          );
          throw new Error(`رفض أداة: ${result.reason}`);
        }
      }
      return results.length;
    });

    if (!run.completed) {
      if (run.violations.length > 0) {
        this.deps.supervisor?.observe(
          this.agentId,
          { kind: 'sandbox_escape_attempt', severity: 'severe', detail: run.violations.join('؛') },
          now,
        );
        this.stopped = true;
      }
      const entry = this.deps.audit.append(this.agentId, 'agent_task_failed', {
        taskId: task.taskId, reason: run.reason, operations: run.operations,
        violations: run.violations, terminated: run.terminated,
      });
      return {
        ok: false, reason: run.reason, results,
        operations: run.operations, auditId: entry.hash,
      };
    }

    const entry = this.deps.audit.append(this.agentId, 'agent_task_completed', {
      taskId: task.taskId, steps: results.length, operations: run.operations,
    });
    return { ok: true, reason: 'اكتملت المهمة داخل الحدود', results, operations: run.operations, auditId: entry.hash };
  }

  /** إيقاف فوري لا رجعة فيه — يُنهي الوكيل في السجل ويستعيد موارده */
  stop(by: EntityId, reason: string, now = Date.now()): boolean {
    this.stopped = true;
    this.deps.permissions.revokeAll(this.agentId, by, `إيقاف: ${reason}`);
    const result = this.deps.registry.terminate(this.agentId, by, reason, now);
    this.deps.audit.append(by, 'agent_stopped', {
      agentId: this.agentId, reason, terminated: result.ok,
    });
    return this.stopped;
  }
}
