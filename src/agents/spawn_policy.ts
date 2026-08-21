/**
 * src/agents/spawn_policy.ts — سياسة التوالد وحدوده (المرحلة 19)
 * المالك: وزارة الداخلية (بمراجعة وزارة الأمن السيبراني)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مخططات توالد معلنة (blueprints) + طلب دفعة + حالة السكان الحالية
 * المخرجات: حكم واحد على الدفعة **كاملة**: مسموح أو مرفوض بسببه — لا حكم جزئي
 * التبعيات: السجل فقط — السياسة لا تنشئ ولا تنهي، تحكم فقط
 * الصلاحيات: إعلان مخطط = تعديل سياسة بأمر ملكي (amend_policy)؛ التجميد بلا أمر
 * السجلات: blueprint_declared / blueprint_refused / spawn_frozen / spawn_thawed /
 *          spawn_policy_denied
 * ثوابت هذه الوحدة:
 *   1) لا توالد إلا من مخطط معلن معتمد — لا مخطط ضمني
 *   2) **لا وكيل يولّد وكيلًا** — طالب التوالد لا يجوز أن يكون كيانًا من نوع agent
 *   3) سقف نسخ لكل مخطط، وسقف حجم الدفعة، وسقف توالد في الساعة فوق سقف الدقيقة
 *   4) حد الأجيال: مخطط بجيل يفوق الحد مرفوض — النمو محدود عمقًا لا عرضًا فقط
 *   5) الحكم على الدفعة كاملة قبل إنشاء أي وكيل — لا دفعة جزئية
 *   6) التجميد إجراء فوري بلا أمر، ويعلو على كل مخطط معتمد
 * حالات الفشل (كلها مغلقة): أي شك أو نقص ⇒ رفض الدفعة كاملة
 * اختبار القبول: tests/agents/factory.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0004-agent-factory.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

/** مخطط توالد معلن: ما يُسمح بتوليده، وكم، وفي أي جيل */
export interface AgentBlueprint {
  readonly blueprintId: string;
  readonly template: string;
  readonly maxInstances: number;
  /** جيل الوكلاء المولَّدين من هذا المخطط — 1 هو الجيل الأول من سلطة بشرية */
  readonly generation: number;
  readonly purpose: string;
}

export interface SpawnLimits {
  /** أقصى عدد وكلاء في دفعة واحدة */
  readonly batchMax: number;
  /** أقصى عدد وكلاء مولَّدين في الساعة عبر كل المخططات */
  readonly perHourMax: number;
  /** أقصى جيل مسموح — ما فوقه مرفوض */
  readonly generationMax: number;
}

export const DEFAULT_SPAWN_LIMITS: SpawnLimits = Object.freeze({
  batchMax: 8,
  perHourMax: 32,
  generationMax: 2,
});

export interface SpawnRequestFacts {
  readonly blueprintId: string;
  readonly count: number;
  readonly requestedBy: EntityId;
  /** السكان الأحياء الحاليون والسقف السكاني — من سجل الوكلاء */
  readonly population: number;
  readonly populationMax: number;
}

export interface SpawnPolicyDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly limits?: SpawnLimits;
  readonly ministryId?: EntityId;
}

export class SpawnPolicy {
  private readonly blueprints = new Map<string, AgentBlueprint>();
  private readonly instances = new Map<string, number>();
  private readonly spawnTimes: number[] = [];
  private frozen: { readonly by: EntityId; readonly reason: string } | null = null;
  private readonly ministryId: EntityId;
  readonly limits: SpawnLimits;

  constructor(private readonly deps: SpawnPolicyDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:interior';
    this.limits = deps.limits ?? DEFAULT_SPAWN_LIMITS;
    deps.audit.append(this.ministryId, 'spawn_policy_online', { limits: this.limits });
  }

  get isFrozen(): boolean {
    return this.frozen !== null;
  }

  get freezeReason(): string | null {
    return this.frozen?.reason ?? null;
  }

  blueprint(blueprintId: string): AgentBlueprint | undefined {
    return this.blueprints.get(blueprintId);
  }

  list(): readonly AgentBlueprint[] {
    return [...this.blueprints.values()];
  }

  instancesOf(blueprintId: string): number {
    return this.instances.get(blueprintId) ?? 0;
  }

  /** إعلان مخطط توالد — تعديل سياسة بأمر ملكي لا قرار تشغيلي */
  declareBlueprint(command: SignedRoyalCommand, blueprint: AgentBlueprint, now = Date.now()): Decision {
    const refuse = (reason: string): Decision => {
      const entry = this.deps.audit.append(this.ministryId, 'blueprint_refused', {
        blueprintId: blueprint.blueprintId, reason, commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر إعلان المخطط مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'amend_policy') {
      return refuse('إعلان مخطط توالد تعديل سياسة — لا يقع بفعل آخر');
    }
    if (!blueprint.blueprintId || !blueprint.template) return refuse('مخطط بلا معرّف أو بلا قالب دور');
    if (!blueprint.purpose) return refuse('لا مخطط بلا غرض معلن');
    if (this.blueprints.has(blueprint.blueprintId)) return refuse('معرّف مخطط مستخدَم — لا تكرار');
    if (!Number.isInteger(blueprint.maxInstances) || blueprint.maxInstances <= 0) {
      return refuse('سقف نسخ غير صالح — لا مخطط بلا سقف');
    }
    if (!Number.isInteger(blueprint.generation) || blueprint.generation < 1) {
      return refuse('جيل غير صالح');
    }
    if (blueprint.generation > this.limits.generationMax) {
      return refuse(`جيل ${blueprint.generation} يفوق حد الأجيال (${this.limits.generationMax})`);
    }

    this.blueprints.set(blueprint.blueprintId, blueprint);
    const entry = this.deps.audit.append(this.ministryId, 'blueprint_declared', {
      blueprintId: blueprint.blueprintId, template: blueprint.template,
      maxInstances: blueprint.maxInstances, generation: blueprint.generation,
      purpose: blueprint.purpose, commandId: command.payload.commandId,
    });
    return { allowed: true, reason: 'أُعلن المخطط', auditId: entry.hash };
  }

  /** تجميد التوالد — فوري بلا أمر، ويعلو على كل مخطط معتمد */
  freeze(by: EntityId, reason: string): void {
    this.frozen = { by, reason };
    this.deps.audit.append(by, 'spawn_frozen', { reason });
  }

  /** فك التجميد — قرار ملكي أو حرس التاج، ويُسجَّل */
  thaw(by: EntityId, reason: string): boolean {
    if (!this.frozen) return false;
    this.frozen = null;
    this.deps.audit.append(by, 'spawn_thawed', { reason });
    return true;
  }

  /** الحكم على الدفعة كاملة قبل إنشاء أي وكيل */
  evaluate(facts: SpawnRequestFacts, now = Date.now()): Decision {
    const deny = (reason: string, kind = 'spawn_policy_denied'): Decision => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        blueprintId: facts.blueprintId, count: facts.count,
        requestedBy: facts.requestedBy, reason,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    // الثابت الأول: لا وكيل يولّد وكيلًا — ولا مجرّد طلب
    if (facts.requestedBy.startsWith('agent:')) {
      const entry = this.deps.audit.append(this.ministryId, 'self_replication_attempt', {
        requestedBy: facts.requestedBy, blueprintId: facts.blueprintId, count: facts.count,
      });
      this.deps.audit.append(this.ministryId, 'escalated_to_king', {
        incident: 'self_replication_attempt', requestedBy: facts.requestedBy,
      });
      return { allowed: false, reason: 'لا وكيل يولّد وكيلًا — محاولة توالد ذاتي', auditId: entry.hash };
    }
    if (this.frozen) return deny(`التوالد مجمَّد: ${this.frozen.reason}`);
    if (!Number.isInteger(facts.count) || facts.count <= 0) return deny('حجم دفعة غير صالح');
    if (facts.count > this.limits.batchMax) {
      return deny(`حجم الدفعة ${facts.count} يفوق الحد (${this.limits.batchMax})`);
    }

    const blueprint = this.blueprints.get(facts.blueprintId);
    if (!blueprint) return deny('مخطط غير معلن — لا توالد بلا مخطط معتمد');
    if (blueprint.generation > this.limits.generationMax) {
      return deny(`جيل المخطط يفوق حد الأجيال (${this.limits.generationMax})`);
    }

    const used = this.instancesOf(facts.blueprintId);
    if (used + facts.count > blueprint.maxInstances) {
      return deny(
        `تجاوز سقف نسخ المخطط: ${used} + ${facts.count} > ${blueprint.maxInstances}`,
        'blueprint_cap_reached',
      );
    }
    if (facts.population + facts.count > facts.populationMax) {
      return deny(
        `تجاوز السقف السكاني: ${facts.population} + ${facts.count} > ${facts.populationMax}`,
        'population_cap_would_break',
      );
    }

    const recent = this.spawnTimes.filter((t) => now - t < 3_600_000);
    this.spawnTimes.splice(0, this.spawnTimes.length, ...recent);
    if (recent.length + facts.count > this.limits.perHourMax) {
      return deny(
        `تجاوز سقف التوالد في الساعة: ${recent.length} + ${facts.count} > ${this.limits.perHourMax}`,
        'hourly_spawn_cap_reached',
      );
    }

    return { allowed: true, reason: 'الدفعة داخل كل الحدود المعلنة', auditId: '' };
  }

  /** تقييد دفعة نُفّذت فعلًا — يُستدعى بعد النجاح لا قبله */
  recordSpawn(blueprintId: string, count: number, now = Date.now()): void {
    this.instances.set(blueprintId, this.instancesOf(blueprintId) + count);
    for (let i = 0; i < count; i += 1) this.spawnTimes.push(now);
  }

  /** إعادة نسخ إلى الحساب بعد إلغاء دفعة — الرجوع لا يُترك ضمنيًا */
  releaseSpawn(blueprintId: string, count: number): void {
    this.instances.set(blueprintId, Math.max(0, this.instancesOf(blueprintId) - count));
  }

  report(): {
    readonly blueprints: number;
    readonly frozen: boolean;
    readonly instances: Readonly<Record<string, number>>;
    readonly limits: SpawnLimits;
  } {
    return {
      blueprints: this.blueprints.size,
      frozen: this.isFrozen,
      instances: Object.fromEntries(this.instances),
      limits: this.limits,
    };
  }
}
