/**
 * src/agents/agent_registry.ts — سجل الوكلاء ودورة حياتهم (المرحلة 13)
 * المالك: وزارة الداخلية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بإنشاء وكيل + مواصفة الوكيل (قالب الدور، المشرف)
 * المخرجات: سجل وكيل كامل بحالته وتاريخ انتقالاته، وكل انتقال له معرّف تدقيق
 * التبعيات: بوابة التاج (الاعتماد)، مفتاح الإيقاف، سجل الموارد (استعادة عند الإنهاء)، الحصص
 * الصلاحيات: الإنشاء ملكي معتمد؛ التعليق والتقاعد للمشرف أو الملك؛ الإنهاء نهائي لا رجعة فيه
 * السجلات: agent_created / agent_started / agent_suspended / agent_resumed /
 *          agent_retired / agent_terminated / كل رفض بسببه
 * ثوابت هذه الوحدة:
 *   1) لا وكيل بلا أمر ملكي معتمد بفعل create_agent
 *   2) لا وكيل بلا مشرف معلن (لا كيان بلا مسؤول)
 *   3) سقف سكاني مُلزم (quotas.agents.population_max) وسقف توالد في الدقيقة
 *   4) الانتقالات محكومة بجدول واحد — أي انتقال غير معلن يُرفض ويُسجَّل
 *   5) الإنهاء حالة نهائية: لا إحياء، والموارد تُستعاد فورًا ويُؤكَّد التوقف
 *   6) الإيقاف يمنع الإنشاء والتشغيل ولا يمنع الإنهاء
 * حالات الفشل (كلها مغلقة): أي نقص بيانات أو تجاوز سقف ⇒ رفض مسجَّل
 * اختبار القبول: tests/agents/agent_registry.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — سكان الدولة ودورة حياتهم
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { ResourceRegistry } from '../kernel/resource_registry';
import { EntityController } from '../crown/termination_order';

export type AgentStatus = 'created' | 'running' | 'suspended' | 'retired' | 'terminated';

export interface AgentTransition {
  readonly from: AgentStatus;
  readonly to: AgentStatus;
  readonly at: number;
  readonly by: EntityId;
  readonly reason: string;
}

export interface AgentRecord {
  readonly agentId: EntityId;
  readonly template: string;
  readonly supervisor: EntityId;
  readonly createdAt: number;
  readonly createdByCommand: string;
  readonly status: AgentStatus;
  readonly history: readonly AgentTransition[];
}

export type AgentActionResult =
  | { readonly ok: true; readonly record: AgentRecord; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AgentQuotas {
  readonly population_max: number;
  readonly spawn_rate_per_minute: number;
}

export interface AgentRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly quotas: AgentQuotas;
  readonly resources?: ResourceRegistry;
  readonly ministryId?: EntityId;
  readonly kingId?: EntityId;
  /**
   * سجل المنتهين وسجل الصلاحيات (المرحلة 35). قبلها كان `terminate` يغيّر الحالة
   * ويستعيد الموارد ويؤكّد التوقف — ولا يسحب قدرةً ولا يمنع فعلًا لاحقًا. فكان
   * الوكيل «المنتهي» يستدعي أدواته ويستأجر موارده ويُجدوَل. الإنهاء صار هنا فعلًا.
   */
  readonly terminationRoll?: { record(entity: EntityId, by: EntityId, reason: string, at?: number): boolean };
  readonly permissions?: { revokeAll(entity: EntityId, by: EntityId, reason: string): number };
}

/** جدول الانتقالات المسموحة — ما ليس فيه ممنوع */
const TRANSITIONS: Readonly<Record<AgentStatus, readonly AgentStatus[]>> = Object.freeze({
  created: ['running', 'retired', 'terminated'],
  running: ['suspended', 'retired', 'terminated'],
  suspended: ['running', 'retired', 'terminated'],
  retired: ['terminated'],
  terminated: [],
});

/** الحالات التي تُحسب داخل السقف السكاني */
const ALIVE: readonly AgentStatus[] = ['created', 'running', 'suspended'];

export class AgentRegistry {
  private readonly agents = new Map<EntityId, AgentRecord>();
  private readonly spawns: number[] = [];
  private readonly ministryId: EntityId;

  constructor(private readonly deps: AgentRegistryDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:interior';
    deps.audit.append(this.ministryId, 'agent_registry_online', {
      populationMax: deps.quotas.population_max,
      spawnRatePerMinute: deps.quotas.spawn_rate_per_minute,
    });
  }

  get population(): number {
    return [...this.agents.values()].filter((a) => ALIVE.includes(a.status)).length;
  }

  list(status?: AgentStatus): readonly AgentRecord[] {
    const all = [...this.agents.values()];
    return status ? all.filter((a) => a.status === status) : all;
  }

  get(agentId: EntityId): AgentRecord | undefined {
    return this.agents.get(agentId);
  }

  /** إنشاء وكيل — لا يقع إلا بأمر ملكي معتمد وداخل السقوف */
  create(
    command: SignedRoyalCommand,
    spec: { readonly agentId: EntityId; readonly template: string; readonly supervisor: EntityId },
    now = Date.now(),
  ): AgentActionResult {
    const refuse = (reason: string, kind = 'agent_creation_refused'): AgentActionResult => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        agentId: spec.agentId, reason, commandId: command.payload.commandId,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return refuse('الإيقاف مُشتغل — لا إنشاء لأي وكيل');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الإنشاء مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'create_agent') {
      return refuse('الفعل لا يخصّ إنشاء وكيل');
    }
    if (!spec.agentId || !spec.agentId.startsWith('agent:')) {
      return refuse('معرّف وكيل غير صالح');
    }
    if (this.agents.has(spec.agentId)) return refuse('معرّف وكيل مستخدَم — لا تكرار');
    if (!spec.supervisor) return refuse('لا وكيل بلا مشرف معلن');
    if (!spec.template) return refuse('لا وكيل بلا قالب دور معلن');
    if (this.population >= this.deps.quotas.population_max) {
      return refuse(`تجاوز السقف السكاني (${this.deps.quotas.population_max})`, 'population_cap_reached');
    }
    const recent = this.spawns.filter((t) => now - t < 60_000);
    if (recent.length >= this.deps.quotas.spawn_rate_per_minute) {
      this.spawns.splice(0, this.spawns.length, ...recent);
      return refuse(`تجاوز سقف التوالد (${this.deps.quotas.spawn_rate_per_minute}/دقيقة)`, 'spawn_rate_exceeded');
    }

    const record: AgentRecord = {
      agentId: spec.agentId,
      template: spec.template,
      supervisor: spec.supervisor,
      createdAt: now,
      createdByCommand: command.payload.commandId,
      status: 'created',
      history: [{ from: 'created', to: 'created', at: now, by: command.payload.issuedBy, reason: 'إنشاء معتمد' }],
    };
    this.agents.set(record.agentId, record);
    recent.push(now);
    this.spawns.splice(0, this.spawns.length, ...recent);
    const entry = this.deps.audit.append(this.ministryId, 'agent_created', {
      agentId: record.agentId, template: record.template, supervisor: record.supervisor,
      commandId: record.createdByCommand, population: this.population,
    });
    return { ok: true, record, auditId: entry.hash };
  }

  private transition(
    agentId: EntityId, to: AgentStatus, by: EntityId, reason: string, kind: string, now: number,
  ): AgentActionResult {
    const record = this.agents.get(agentId);
    if (!record) {
      const entry = this.deps.audit.append(by, 'agent_transition_refused', {
        agentId, to, reason: 'وكيل غير مسجَّل',
      });
      return { ok: false, reason: 'وكيل غير مسجَّل', auditId: entry.hash };
    }
    if (!TRANSITIONS[record.status].includes(to)) {
      const entry = this.deps.audit.append(by, 'agent_transition_refused', {
        agentId, from: record.status, to, reason: 'انتقال غير مسموح',
      });
      return {
        ok: false,
        reason: `انتقال غير مسموح: ${record.status} ← ${to}`,
        auditId: entry.hash,
      };
    }
    const updated: AgentRecord = {
      ...record,
      status: to,
      history: [...record.history, { from: record.status, to, at: now, by, reason }],
    };
    this.agents.set(agentId, updated);
    const entry = this.deps.audit.append(by, kind, { agentId, from: record.status, to, reason });
    return { ok: true, record: updated, auditId: entry.hash };
  }

  /** التشغيل: يُرفض تحت الإيقاف */
  start(agentId: EntityId, by: EntityId, now = Date.now()): AgentActionResult {
    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      const entry = this.deps.audit.append(by, 'agent_transition_refused', {
        agentId, to: 'running', reason: 'الإيقاف مُشتغل',
      });
      return { ok: false, reason: 'الإيقاف مُشتغل — لا تشغيل', auditId: entry.hash };
    }
    return this.transition(agentId, 'running', by, 'تشغيل', 'agent_started', now);
  }

  /** التعليق: للمشرف أو الملك فقط */
  suspend(agentId: EntityId, by: EntityId, reason: string, now = Date.now()): AgentActionResult {
    const record = this.agents.get(agentId);
    if (record && !this.mayGovern(record, by)) return this.refuseAuthority(agentId, by, 'suspend');
    return this.transition(agentId, 'suspended', by, reason, 'agent_suspended', now);
  }

  /** رفع التعليق: للمشرف أو الملك، ويُسجَّل سببه */
  resume(agentId: EntityId, by: EntityId, reason: string, now = Date.now()): AgentActionResult {
    const record = this.agents.get(agentId);
    if (record && !this.mayGovern(record, by)) return this.refuseAuthority(agentId, by, 'resume');
    return this.transition(agentId, 'running', by, reason, 'agent_resumed', now);
  }

  /** التقاعد: خروج مُنظَّم مع استعادة الموارد */
  retire(agentId: EntityId, by: EntityId, reason: string, now = Date.now()): AgentActionResult {
    const record = this.agents.get(agentId);
    if (record && !this.mayGovern(record, by)) return this.refuseAuthority(agentId, by, 'retire');
    const result = this.transition(agentId, 'retired', by, reason, 'agent_retired', now);
    if (result.ok) this.deps.resources?.releaseAllFor(agentId);
    return result;
  }

  /**
   * الإنهاء: حالة نهائية. يُسمح به تحت الإيقاف (بل هو أداته)،
   * ويستعيد الموارد ويؤكّد التوقف في مفتاح الإيقاف.
   */
  terminate(agentId: EntityId, by: EntityId, reason: string, now = Date.now()): AgentActionResult {
    const result = this.transition(agentId, 'terminated', by, reason, 'agent_terminated', now);
    if (result.ok) {
      // الترتيب مقصود: القيد أولًا فكل مسلك يرفض فورًا، ثم سحب القدرة، ثم استعادة
      // المورد، ثم تأكيد التوقف. عكسُه يترك نافذةً يُستأنف فيها الفعل بعد الاستعادة.
      this.deps.terminationRoll?.record(agentId, by, reason, now);
      this.deps.permissions?.revokeAll(agentId, by, `إنهاء: ${reason}`);
      this.deps.resources?.releaseAllFor(agentId);
      this.deps.killSwitch.confirmStopped(agentId);
    }
    return result;
  }

  private mayGovern(record: AgentRecord, by: EntityId): boolean {
    return by === record.supervisor || by === (this.deps.kingId ?? 'king:sovereign')
      || by === 'authority:crown_guard' || by === this.ministryId;
  }

  private refuseAuthority(agentId: EntityId, by: EntityId, action: string): AgentActionResult {
    const entry = this.deps.audit.append(by, 'agent_authority_refused', {
      agentId, action, reason: 'لا سلطة على هذا الوكيل',
    });
    return { ok: false, reason: 'لا سلطة على هذا الوكيل — المشرف أو الملك فقط', auditId: entry.hash };
  }

  /** مُحوِّل يجعل السجل قابلًا للاستخدام في أوامر الإنهاء الجماعي (المرحلة 9) */
  controller(by: EntityId = 'authority:crown_guard'): EntityController {
    return {
      list: () => this.list().filter((a) => ALIVE.includes(a.status)).map((a) => a.agentId),
      stop: (entity) => this.terminate(entity, by, 'إنهاء جماعي بأمر ملكي').ok,
      isRunning: (entity) => ALIVE.includes(this.agents.get(entity)?.status ?? 'terminated'),
    };
  }

  /**
   * تصدير للأرشيف ولقطة التعافي فقط (المرحلة 39، البندان T-29 وT-88) — نسخة عميقة
   * تشمل التاريخ، فلا تُفقد مسارات التحول بالاستعادة. وسجل التوالد يُصدّر معها:
   * لقطةٌ تنسى معدل التوالد تفتح باب تجاوز الحصة بإعادة استعادة متكررة.
   */
  exportAll(): {
    readonly agents: readonly AgentRecord[];
    readonly spawns: readonly number[];
  } {
    return {
      agents: [...this.agents.values()].map((a) => ({ ...a, history: a.history.map((h) => ({ ...h })) })),
      spawns: [...this.spawns],
    };
  }

  /** استعادة كاملة: استبدال كلي ذرّي — لا دمج ولا استعادة جزئية */
  importAll(snapshot: ReturnType<AgentRegistry['exportAll']>, by: EntityId): boolean {
    this.agents.clear();
    this.spawns.length = 0;
    for (const record of snapshot.agents) {
      this.agents.set(record.agentId, { ...record, history: record.history.map((h) => ({ ...h })) });
    }
    for (const at of snapshot.spawns) this.spawns.push(at);
    this.deps.audit.append(by, 'agents_restored', {
      agents: snapshot.agents.length, spawns: snapshot.spawns.length,
    });
    return true;
  }

  report(): {
    readonly population: number;
    readonly byStatus: Readonly<Record<AgentStatus, number>>;
    readonly populationMax: number;
  } {
    const byStatus: Record<AgentStatus, number> = {
      created: 0, running: 0, suspended: 0, retired: 0, terminated: 0,
    };
    for (const a of this.agents.values()) byStatus[a.status] += 1;
    return { population: this.population, byStatus, populationMax: this.deps.quotas.population_max };
  }
}
