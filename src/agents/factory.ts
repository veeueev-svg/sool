/**
 * src/agents/factory.ts — مصنع الوكلاء: توليد دفعات محكوم (المرحلة 19)
 * المالك: وزارة الداخلية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل create_agent + مخطط معلن + حجم دفعة + مشرف
 * المخرجات: دفعة وكلاء كاملة أو **لا شيء** — ومعرّفاتهم وأصلهم (المخطط والجيل)
 * التبعيات: سياسة التوالد، سجل الوكلاء، سجل الصلاحيات، بوابة التاج، مفتاح الإيقاف
 * الصلاحيات: التوليد أمر ملكي؛ والقدرات لا تُمنح هنا — القالب يُربط ولا يُملأ
 * السجلات: batch_refused / batch_partial_rolled_back / agent_batch_spawned
 * ثوابت هذه الوحدة:
 *   1) أمر الدفعة يُستهلك **مرة واحدة** في المصنع — لا دفعتان بأمر واحد
 *   2) الحكم على الدفعة كاملة قبل إنشاء أي وكيل (سياسة التوالد)
 *   3) **الدفعة إما كاملة أو ملغاة** — أي فشل جزئي يُنهي ما أُنشئ ويُعيد الحساب
 *   4) الوكيل المولَّد يُربط بقالب مخططه وبـ **صفر قدرات** ممنوحة
 *   5) كل وكيل مولَّد يُقيَّد أصله: مخططه وجيله وأمر دفعته
 *   6) الإيقاف يمنع التوليد، والتجميد يمنعه، والسقوف تمنعه
 * حالات الفشل (كلها مغلقة): لا وكيل واحد يبقى من دفعة فاشلة
 * اختبار القبول: tests/agents/factory.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0004-agent-factory.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { AgentRegistry } from './agent_registry';
import { PermissionRegistry } from './permissions';
import { SpawnPolicy } from './spawn_policy';

export interface SpawnBatchRequest {
  readonly blueprintId: string;
  readonly count: number;
  /** الجهة الطالبة — لو كانت وكيلًا رُفض الطلب وصُعّد (منع التوالد الذاتي) */
  readonly requestedBy: EntityId;
  readonly supervisor: EntityId;
}

export interface AgentOrigin {
  readonly blueprintId: string;
  readonly generation: number;
  readonly batchCommandId: string;
  readonly spawnedAt: number;
}

export type SpawnBatchResult =
  | { readonly ok: true; readonly created: readonly EntityId[]; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly created: readonly []; readonly auditId: string };

export interface AgentFactoryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly policy: SpawnPolicy;
  readonly registry: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly ministryId?: EntityId;
}

export class AgentFactory {
  private readonly consumedCommands = new Set<string>();
  private readonly origins = new Map<EntityId, AgentOrigin>();
  private serial = 0;
  private readonly ministryId: EntityId;

  constructor(private readonly deps: AgentFactoryDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:interior';
    deps.audit.append(this.ministryId, 'agent_factory_online', {});
  }

  /** أصل وكيل مولَّد — من أي مخطط وأي جيل وبأي أمر دفعة */
  originOf(agentId: EntityId): AgentOrigin | undefined {
    return this.origins.get(agentId);
  }

  /** كل من وُلد من مخطط معيّن */
  spawnedFrom(blueprintId: string): readonly EntityId[] {
    return [...this.origins.entries()]
      .filter(([, o]) => o.blueprintId === blueprintId)
      .map(([id]) => id);
  }

  spawn(command: SignedRoyalCommand, req: SpawnBatchRequest, now = Date.now()): SpawnBatchResult {
    const refuse = (reason: string, kind = 'batch_refused'): SpawnBatchResult => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        blueprintId: req.blueprintId, count: req.count, requestedBy: req.requestedBy,
        reason, commandId: command.payload.commandId,
      });
      return { ok: false, reason, created: [], auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return refuse('الإيقاف مُشتغل — لا توليد');
    }
    // الثابت الأول: أمر الدفعة يُستهلك مرة واحدة (لا يُستغل تكرار الأمر في البوابة)
    if (this.consumedCommands.has(command.payload.commandId)) {
      return refuse('أمر دفعة مستهلك — لا دفعتان بأمر واحد', 'batch_command_reused');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر التوليد مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'create_agent') return refuse('الفعل لا يخصّ توليد وكلاء');
    if (!req.supervisor) return refuse('لا دفعة بلا مشرف معلن');

    const report = this.deps.registry.report();
    const verdict = this.deps.policy.evaluate({
      blueprintId: req.blueprintId, count: req.count, requestedBy: req.requestedBy,
      population: report.population, populationMax: report.populationMax,
    }, now);
    if (!verdict.allowed) {
      this.consumedCommands.add(command.payload.commandId);
      return refuse(`سياسة التوالد ترفض: ${verdict.reason}`);
    }

    const blueprint = this.deps.policy.blueprint(req.blueprintId);
    if (!blueprint) return refuse('مخطط غير معلن');

    // الأمر يُستهلك عند بدء التنفيذ لا عند نجاحه — فلا يُعاد استعماله بعد فشل جزئي
    this.consumedCommands.add(command.payload.commandId);
    this.deps.policy.recordSpawn(req.blueprintId, req.count, now);

    const created: EntityId[] = [];
    for (let i = 0; i < req.count; i += 1) {
      this.serial += 1;
      const agentId: EntityId = `agent:${req.blueprintId}-${String(this.serial).padStart(4, '0')}`;
      if (!this.deps.permissions.assignTemplate(agentId, blueprint.template)) {
        return this.rollback(created, req, command, 'قالب دور المخطط غير معلن في سجل الصلاحيات');
      }
      const result = this.deps.registry.create(
        command, { agentId, template: blueprint.template, supervisor: req.supervisor }, now,
      );
      if (!result.ok) {
        return this.rollback(created, req, command, `تعذّر إنشاء ${agentId}: ${result.reason}`);
      }
      this.origins.set(agentId, {
        blueprintId: req.blueprintId, generation: blueprint.generation,
        batchCommandId: command.payload.commandId, spawnedAt: now,
      });
      created.push(agentId);
    }

    const entry = this.deps.audit.append(this.ministryId, 'agent_batch_spawned', {
      blueprintId: req.blueprintId, generation: blueprint.generation, count: created.length,
      agents: created, supervisor: req.supervisor, requestedBy: req.requestedBy,
      commandId: command.payload.commandId, population: this.deps.registry.report().population,
    });
    return { ok: true, created, auditId: entry.hash };
  }

  /** إلغاء دفعة فاشلة: إنهاء ما أُنشئ، سحب قدراته، وإعادة الحساب — لا بقايا */
  private rollback(
    created: readonly EntityId[],
    req: SpawnBatchRequest,
    command: SignedRoyalCommand,
    reason: string,
  ): SpawnBatchResult {
    for (const agentId of created) {
      this.deps.registry.terminate(agentId, this.ministryId, `إلغاء دفعة: ${reason}`);
      this.deps.permissions.revokeAll(agentId, this.ministryId, 'إلغاء دفعة');
      this.origins.delete(agentId);
    }
    this.deps.policy.releaseSpawn(req.blueprintId, req.count);
    const entry = this.deps.audit.append(this.ministryId, 'batch_partial_rolled_back', {
      blueprintId: req.blueprintId, requested: req.count, terminated: created.length,
      reason, commandId: command.payload.commandId,
    });
    this.deps.audit.append(this.ministryId, 'escalated_to_king', {
      incident: 'batch_rolled_back', blueprintId: req.blueprintId, reason,
    });
    return { ok: false, reason: `دفعة ملغاة كاملة — ${reason}`, created: [], auditId: entry.hash };
  }
}
