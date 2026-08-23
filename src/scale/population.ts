/**
 * src/scale/population.ts — سجل السكان الموسع بلا انفجار عمليات (المرحلة 31)
 * المالك: وزارة البنية
 * المدخلات: دفعة هويات بمعرّفات وملاك وحصص، أمر تاج، وسياسة السكان والشرائح
 * المخرجات: هويات مسجلة في شرائح أو رفض ذري كامل
 * التبعيات: بوابة التاج، سجل التدقيق، شارد الحتمية، ومفتاح الإيقاف
 * الصلاحيات: التسجيل قرار ملكي جماعي؛ الوحدة لا تعدل سقوفها ولا تنشئ عملية نظام
 * السجلات: population_batch_registered / population_refused / population_terminated
 * حالات الفشل: تجاوز سقف أو معدل أو شريحة أو تكرار => رفض كامل ولا تسجيل جزئي
 * اختبارات الوحدة: tests/scale/population.test.ts
 * اختبار القبول: tests/scale/scale_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0015-scale.md
 * ثوابت هذه الوحدة:
 *   1) **الهوية ليست عملية**: السجل يمثل هوية ومالكا وحصة وجدولة فقط، لا مليون عملية نظام.
 *   2) **لا هوية بلا مالك وحصة وشريحة**: حقولها تقيد قبل الكتابة ولا يملأ النظام غائبا.
 *   3) **الدفعة ذرية**: كل فحص قبل الكتابة، فإما الدفعة كلها أو لا شيء.
 *   4) **نافذة المعدل حقيقة**: فوق السقف يرفض في اللحظة ولا يؤجل صامتا.
 *   5) **الإنهاء يجتث السجل**: يسقط كل السكان ويستدعي مسترد الحصة لكل هوية.
 *   6) **عدّاد الشريحة مرآة لا مصدر** (المرحلة 39 — T-119): سقفُ الشريحة يُفحص بعدّادٍ تراكميّ
 *      لا بمسحِ السكان كلِّهم لكلِّ شريحة (كان ذلك تسجيلًا تربيعيًّا). والعدّادُ يُبنى من السجل عند
 *      الاستعادة، و`verifyShardIndex()` يعيد حسابه من السجل ويكشف أيَّ انحرافٍ بينهما.
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { SignedRoyalCommand } from '../kernel/types';
import { ResourceRegistry } from '../kernel/resource_registry';
import { EntityController } from '../crown/termination_order';
import { Sharding, ShardRecord } from './sharding';

export interface PopulationIdentity extends ShardRecord {
  readonly registeredAt: number;
}
export interface PopulationInput {
  readonly agentId: string;
  readonly owner: string;
  readonly resourceQuota: string;
}
export type PopulationResult =
  | { readonly ok: true; readonly registered: number; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly auditId: string };

export interface PopulationSnapshot {
  readonly identities: readonly PopulationIdentity[];
  readonly spawned: readonly { readonly at: number; readonly count: number }[];
}

export class PopulationRegistry {
  private readonly identities = new Map<string, PopulationIdentity>();
  private readonly spawned: { at: number; count: number }[] = [];
  /** عدّاد شغلِ كلِّ شريحة — مرآةٌ تُصان مع كلِّ كتابةٍ وحذف، لا مصدرُ حقيقةٍ مستقلّ (T-119). */
  private readonly shardCounts = new Map<number, number>();

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly killSwitch: KillSwitch,
    private readonly sharding: Sharding,
    readonly populationMax: number,
    readonly spawnRatePerMinute: number,
    private readonly resources: ResourceRegistry,
    private readonly resourceName: string,
    private readonly releaseQuota: (identity: PopulationIdentity) => void = () => {},
  ) {
    audit.append('ministry:infrastructure', 'population_registry_online', { populationMax, spawnRatePerMinute });
  }

  get population(): number { return this.identities.size; }
  get(agentId: string): PopulationIdentity | undefined { return this.identities.get(agentId); }
  records(): Iterable<PopulationIdentity> { return this.identities.values(); }

  /**
   * محوّل سجل الهوية إلى عقد أمر الإنهاء الجماعي.
   * الاعتماد والتأكد والاحتواء تبقى في TerminationOrder؛ لا ينشئ هذا محوّل مسار سلطة جديدا.
   */
  asEntityController(): EntityController {
    return {
      list: () => [...this.identities.keys()],
      stop: (entity) => this.terminate(entity),
      isRunning: (entity) => this.identities.has(entity),
    };
  }

  registerBatch(command: SignedRoyalCommand, inputs: readonly PopulationInput[], now = Date.now()): PopulationResult {
    const deny = (code: string): PopulationResult => {
      const entry = this.audit.append('ministry:infrastructure', 'population_refused', {
        code, commandId: command.payload.commandId, count: inputs.length,
      });
      return { ok: false, code, auditId: entry.hash };
    };
    if (this.killSwitch.status.engaged) return deny('POPULATION_HALTED');
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed || command.payload.action !== 'create_agent') return deny('POPULATION_CROWN_REFUSED');
    if (inputs.length === 0) return deny('POPULATION_EMPTY_BATCH');
    if (this.population + inputs.length > this.populationMax) return deny('POPULATION_CAP_REACHED');
    const recent = this.spawned.filter((item) => now - item.at < 60_000);
    const rate = recent.reduce((sum, item) => sum + item.count, 0);
    if (rate + inputs.length > this.spawnRatePerMinute) return deny('POPULATION_RATE_EXCEEDED');

    const planned = new Map<number, number>();
    const ids = new Set<string>();
    for (const input of inputs) {
      if (!input.agentId.startsWith('agent:') || !input.owner || input.resourceQuota !== `${this.resourceName}:1`) {
        return deny('POPULATION_IDENTITY_INCOMPLETE');
      }
      if (this.resources.spec(this.resourceName).per_agent_max !== 1) return deny('POPULATION_RESOURCE_QUOTA_INVALID');
      if (ids.has(input.agentId) || this.identities.has(input.agentId)) return deny('POPULATION_DUPLICATE_ID');
      ids.add(input.agentId);
      const shardId = this.sharding.shardFor(input.agentId);
      if (this.sharding.isIsolated(shardId)) return deny('POPULATION_SHARD_ISOLATED');
      planned.set(shardId, (planned.get(shardId) ?? 0) + 1);
    }
    for (const [shardId, incoming] of planned) {
      // T-119: عدّادٌ تراكميّ بدل مسحِ السكان لكلِّ شريحة — الفحصُ نفسُه بلا زمنٍ تربيعيّ.
      if ((this.shardCounts.get(shardId) ?? 0) + incoming > this.sharding.perShardMax) {
        return deny('POPULATION_SHARD_FULL');
      }
    }
    if (!this.resources.reserveIdentities(this.resourceName, inputs.map((input) => input.agentId))) {
      return deny('POPULATION_RESOURCE_CAP_REACHED');
    }

    for (const input of inputs) {
      const shardId = this.sharding.shardFor(input.agentId);
      this.identities.set(input.agentId, Object.freeze({ ...input, shardId, registeredAt: now }));
      this.shardCounts.set(shardId, (this.shardCounts.get(shardId) ?? 0) + 1);
    }
    recent.push({ at: now, count: inputs.length });
    this.spawned.splice(0, this.spawned.length, ...recent);
    const entry = this.audit.append('ministry:infrastructure', 'population_batch_registered', {
      commandId: command.payload.commandId, count: inputs.length, population: this.population,
    });
    return { ok: true, registered: inputs.length, auditId: entry.hash };
  }

  /** يستعمله أمر الإنهاء الجماعي بعد اعتماده: لا يبقى سجل أو حصة بلا صاحب. */
  terminateAll(): number {
    const count = this.identities.size;
    for (const identity of [...this.identities.keys()]) this.terminate(identity);
    this.audit.append('authority:crown_guard', 'population_terminated', { count });
    return count;
  }

  private terminate(entity: string): boolean {
    const identity = this.identities.get(entity);
    if (!identity) return false;
    this.resources.releaseIdentity(this.resourceName, entity);
    this.releaseQuota(identity);
    this.identities.delete(entity);
    const remaining = (this.shardCounts.get(identity.shardId) ?? 1) - 1;
    if (remaining > 0) this.shardCounts.set(identity.shardId, remaining);
    else this.shardCounts.delete(identity.shardId);
    return true;
  }

  /** شغلُ شريحةٍ بحسب المرآة — للقياس والمراقبة، لا يُستعمل بديلًا عن سقف الشريحة في السياسة. */
  shardOccupancy(shardId: number): number { return this.shardCounts.get(shardId) ?? 0; }

  /**
   * يعيد حسابَ شغلِ الشرائح من السجل نفسه ويقارنه بالمرآة (T-119).
   * مسحٌ كاملٌ مقصود: هذا فحصُ انحرافٍ دوريّ لا مسارُ تسجيل، ولا يُنادى داخل `registerBatch`.
   */
  verifyShardIndex(): { readonly ok: boolean; readonly drifts: readonly { readonly shardId: number; readonly counted: number; readonly mirrored: number }[] } {
    const counted = new Map<number, number>();
    for (const record of this.identities.values()) counted.set(record.shardId, (counted.get(record.shardId) ?? 0) + 1);
    const drifts: { shardId: number; counted: number; mirrored: number }[] = [];
    for (const shardId of new Set([...counted.keys(), ...this.shardCounts.keys()])) {
      const left = counted.get(shardId) ?? 0;
      const right = this.shardCounts.get(shardId) ?? 0;
      if (left !== right) drifts.push({ shardId, counted: left, mirrored: right });
    }
    return { ok: drifts.length === 0, drifts };
  }

  exportAll(): PopulationSnapshot {
    return {
      identities: [...this.identities.values()].map((identity) => ({ ...identity })),
      spawned: this.spawned.map((item) => ({ ...item })),
    };
  }

  importAll(snapshot: PopulationSnapshot, by: string): boolean {
    if (!Array.isArray(snapshot.identities) || !Array.isArray(snapshot.spawned)
      || new Set(snapshot.identities.map((identity) => identity.agentId)).size !== snapshot.identities.length
      || snapshot.identities.length > this.populationMax
      || snapshot.identities.some((identity) => !identity.agentId.startsWith('agent:')
        || !identity.owner || identity.resourceQuota !== `${this.resourceName}:1`
        || identity.shardId !== this.sharding.shardFor(identity.agentId))) {
      throw new Error('RECOVERY_POPULATION_INVALID');
    }
    this.identities.clear();
    this.shardCounts.clear();
    for (const identity of snapshot.identities) {
      this.identities.set(identity.agentId, Object.freeze({ ...identity }));
      this.shardCounts.set(identity.shardId, (this.shardCounts.get(identity.shardId) ?? 0) + 1);
    }
    this.spawned.splice(0, this.spawned.length, ...snapshot.spawned.map((item) => ({ ...item })));
    this.audit.append(by, 'population_restored', { population: this.population });
    return true;
  }
}
