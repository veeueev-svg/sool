/**
 * src/kernel/resource_registry.ts — سجل الموارد والحصص والإيجارات (المرحلة 5)
 * المالك: وزارة البنية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/quotas.yaml + طلبات إيجار من الكيانات
 * المخرجات: إيجار مؤقّت مسجَّل، أو رفض بسبب موثّق
 * التبعيات: السجل غير القابل للمحو (كل منح ورفض وانتهاء يُسجَّل)
 * الصلاحيات: المنح والاستعادة فقط — لا تعديل للسقوف من داخل الوحدة الخاضعة لها (RULE-005)
 * حالات الفشل (كلها مغلقة):
 *   - مورد غير مسجَّل ⇒ SovereignViolation
 *   - طلب يتجاوز سقف الكيان أو المتاح الكلي ⇒ رفض
 *   - مورد بسقف صفري (مثل الخروج الشبكي) ⇒ رفض دائم
 *   - انتهاء مدة الإيجار ⇒ استعادة تلقائية ولا تمديد ضمني
 *   - مدة إيجار مُصرَّح بها غير صالحة (صفر أو سالب أو كسر) ⇒ رفض، ولا تُحمل على الافتراض (T-74)
 *   - مدة مُصرَّح بها فوق سقف الإعلان ⇒ تُقصَّر إلى السقف ويُسجَّل التقصير resource_lease_duration_capped
 *     (فالمستأجر لا يرفع سقف نفسه — RULE-005 — والفارق يُقرأ في السجل لا يُكتَم)
 *   - استعادة إيجار سبق أن استُعيد بانتهاء وقته ⇒ resource_release_missed (كان يُرجع false صامتًا)
 * اختبار القبول: tests/kernel/resource_registry.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — نواة التشغيل والحصص
 */
import { EntityId, SovereignViolation } from './types';
import { AppendOnlyLog } from '../audit/append_only_log';

export interface ResourceSpec {
  readonly total: number;
  readonly per_agent_max: number;
  readonly lease_seconds: number;
}

export interface Lease {
  readonly leaseId: string;
  readonly entity: EntityId;
  readonly resource: string;
  readonly amount: number;
  readonly grantedAt: number;
  readonly expiresAt: number;
}

export type LeaseResult =
  | { readonly granted: true; readonly lease: Lease; readonly auditId: string }
  | { readonly granted: false; readonly reason: string; readonly auditId: string };

export interface ResourceRegistrySnapshot {
  readonly leases: readonly Lease[];
  readonly reservations: readonly [string, readonly EntityId[]][];
  readonly counter: number;
}

export class ResourceRegistry {
  private readonly specs = new Map<string, ResourceSpec>();
  private readonly leases = new Map<string, Lease>();
  /**
   * حصص هويات السكان: سجلّ مورد حقيقي لكن بلا مليون مؤقّت أو مليون سجل تدقيق.
   * هو تخصيص وحدة لكل هوية في مورد معلن، ويُسجّل منح الدفعة واستعادتها لا كل عنصر داخلي.
   */
  private readonly identityReservations = new Map<string, Set<EntityId>>();
  private counter = 0;

  constructor(
    private readonly audit: AppendOnlyLog,
    specs: Readonly<Record<string, ResourceSpec>>,
    /**
     * سجل المنتهين (المرحلة 35). اختياري كي لا تنكسر التركيبات القائمة، لكنه
     * موصولٌ في `bootstrapState`: كيان منتهٍ ظلّ يستأجر موردًا كان عيبًا حقيقيًّا
     * مقيسًا قبل هذه المرحلة — الإنهاء كان يستعيد الموارد ولا يمنع استعادتها.
     */
    private readonly terminated?: { isTerminated(entity: EntityId): boolean },
  ) {
    for (const [name, spec] of Object.entries(specs)) {
      if (spec.total < 0 || spec.per_agent_max < 0 || spec.lease_seconds < 0) {
        throw new SovereignViolation(`سقف مورد غير صالح: ${name}`, 'RESOURCE_SPEC_INVALID');
      }
      this.specs.set(name, spec);
      this.identityReservations.set(name, new Set<EntityId>());
    }
    this.audit.append('ministry:infrastructure', 'resource_registry_online', {
      resources: [...this.specs.keys()],
    });
  }

  /** أسماء الموارد المعلنة — لا يُتعامل مع مورد خارجها */
  get resources(): readonly string[] {
    return [...this.specs.keys()];
  }

  spec(resource: string): ResourceSpec {
    const spec = this.specs.get(resource);
    if (!spec) {
      this.audit.append('ministry:infrastructure', 'unknown_resource_requested', { resource });
      throw new SovereignViolation(`مورد غير مسجَّل: ${resource}`, 'RESOURCE_UNKNOWN');
    }
    return spec;
  }

  /** المخصَّص حاليًا من مورد بعد استبعاد الإيجارات المنتهية */
  allocated(resource: string, now = Date.now()): number {
    this.spec(resource);
    let sum = 0;
    for (const lease of this.leases.values()) {
      if (lease.resource === resource && lease.expiresAt > now) sum += lease.amount;
    }
    return sum + (this.identityReservations.get(resource)?.size ?? 0);
  }

  available(resource: string, now = Date.now()): number {
    return this.spec(resource).total - this.allocated(resource, now);
  }

  /** ما يستخدمه كيان واحد من مورد */
  usageOf(entity: EntityId, resource: string, now = Date.now()): number {
    let sum = 0;
    for (const lease of this.leases.values()) {
      if (lease.entity === entity && lease.resource === resource && lease.expiresAt > now) sum += lease.amount;
    }
    return sum + (this.identityReservations.get(resource)?.has(entity) ? 1 : 0);
  }

  /**
   * يخصص حصة هوية واحدة لكل معرف في دفعة سكان. لا يصنع إيجارًا منفردًا لكل هوية:
   * هذه الحصص سجلية لا تشغيلية، وتسجل الدفعة كلها كي يبقى قياس المليون ممكنا بلا انفجار سجل.
   */
  reserveIdentities(resource: string, entities: readonly EntityId[]): boolean {
    const spec = this.spec(resource);
    const reserved = this.identityReservations.get(resource)!;
    const unique = new Set(entities);
    if (entities.length === 0 || unique.size !== entities.length || spec.per_agent_max < 1
      || reserved.size + entities.length > spec.total || entities.some((entity) => reserved.has(entity))) {
      return false;
    }
    for (const entity of entities) reserved.add(entity);
    this.audit.append('ministry:infrastructure', 'population_resource_reserved', {
      resource, count: entities.length, allocated: reserved.size,
    });
    return true;
  }

  /** يستعيد حصة الهوية عند الإنهاء؛ لا ينجح مرتين ولا يصنع استعادة وهمية. */
  releaseIdentity(resource: string, entity: EntityId): boolean {
    const reserved = this.identityReservations.get(resource);
    if (!reserved?.delete(entity)) return false;
    this.audit.append(entity, 'population_resource_released', { resource });
    return true;
  }

  /**
   * مدة الإيجار (T-74): **عقد** بين طالبٍ يعرف مدة عمله وسقفٍ معلنٍ هو السلطة.
   * `requestedSeconds` غائبةً ⇒ السقف كما كان قبل هذا البند (لا سلوك قائم يتغيّر بلا إعلان).
   * وترجع `null` رفضًا — والرفضُ يُكتب في `lease` لا هنا، فهذه قراءةٌ وحكمٌ لا سجلّ.
   */
  private grantedSeconds(
    entity: EntityId, resource: string, spec: ResourceSpec, requestedSeconds?: number,
  ): number | null {
    if (requestedSeconds === undefined) return spec.lease_seconds;
    if (!Number.isSafeInteger(requestedSeconds) || requestedSeconds <= 0) return null;
    if (requestedSeconds > spec.lease_seconds) {
      // الفارق الذي كان صامتًا: عملٌ مدتُه المعلنة أطول من سقف حصته يُقصَّر ويُقرأ تقصيرُه
      this.audit.append(entity, 'resource_lease_duration_capped', {
        resource, requestedSeconds, grantedSeconds: spec.lease_seconds,
        shortfallSeconds: requestedSeconds - spec.lease_seconds,
      });
      return spec.lease_seconds;
    }
    return requestedSeconds;
  }

  /** منح إيجار مؤقّت — لا استخدام دائم لأي مورد (كل مورد معلن ومسجَّل ومؤقَّت) */
  lease(
    entity: EntityId, resource: string, amount: number, now = Date.now(),
    requestedSeconds?: number,
  ): LeaseResult {
    const deny = (reason: string): LeaseResult => {
      const entry = this.audit.append(entity, 'resource_denied', { resource, amount, reason });
      return { granted: false, reason, auditId: entry.hash };
    };
    if (this.terminated?.isTerminated(entity)) {
      return deny('كيان منتهٍ لا يستأجر موردًا — الإنهاء نهائي (LEASE_ENTITY_TERMINATED)');
    }
    const spec = this.spec(resource); // مورد غير مسجَّل ⇒ استثناء سيادي

    if (!Number.isFinite(amount) || amount <= 0) return deny('كمية غير صالحة');
    if (spec.total === 0 || spec.per_agent_max === 0 || spec.lease_seconds === 0) {
      return deny('المورد معطّل بسقف صفري — رفض افتراضي');
    }
    if (amount > spec.per_agent_max) return deny(`تجاوز سقف الكيان (${spec.per_agent_max})`);
    if (this.usageOf(entity, resource, now) + amount > spec.per_agent_max) {
      return deny(`تجاوز سقف الكيان التراكمي (${spec.per_agent_max})`);
    }
    if (amount > this.available(resource, now)) return deny('لا يوجد متاح كافٍ من المورد');

    const seconds = this.grantedSeconds(entity, resource, spec, requestedSeconds);
    if (seconds === null) {
      return deny('مدة إيجار مُصرَّح بها غير صالحة — عدد صحيح موجب بالثواني (LEASE_DURATION_INVALID)');
    }

    this.counter += 1;
    const lease: Lease = Object.freeze({
      leaseId: `lease:${resource}:${this.counter}`,
      entity, resource, amount,
      grantedAt: now,
      expiresAt: now + seconds * 1000,
    });
    this.leases.set(lease.leaseId, lease);
    const entry = this.audit.append(entity, 'resource_leased', {
      leaseId: lease.leaseId, resource, amount, expiresAt: lease.expiresAt,
      grantedSeconds: seconds, ceilingSeconds: spec.lease_seconds,
    });
    return { granted: true, lease, auditId: entry.hash };
  }

  /**
   * استعادة صريحة قبل الانتهاء. ومن استعاد إيجارًا سبق أن استُعيد بانتهاء وقته
   * كان يُجاب بـ`false` صامتة — فصارت حدثًا مسمّى: العمل عاش بعد حصته وهذا يُقرأ (T-74).
   */
  release(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) {
      this.audit.append('ministry:infrastructure', 'resource_release_missed', { leaseId });
      return false;
    }
    this.leases.delete(leaseId);
    this.audit.append(lease.entity, 'resource_released', { leaseId, resource: lease.resource });
    return true;
  }

  /** استعادة تلقائية لكل إيجار انتهى وقته — تُستدعى من حلقة التشغيل */
  reclaimExpired(now = Date.now()): readonly Lease[] {
    const expired: Lease[] = [];
    for (const [id, lease] of [...this.leases.entries()]) {
      if (lease.expiresAt <= now) {
        this.leases.delete(id);
        expired.push(lease);
        this.audit.append('ministry:infrastructure', 'resource_lease_expired', {
          leaseId: id, entity: lease.entity, resource: lease.resource, amount: lease.amount,
        });
      }
    }
    return expired;
  }

  /** استعادة كل موارد كيان — تُستدعى عند إنهائه (المرحلة 9) */
  releaseAllFor(entity: EntityId): number {
    let count = 0;
    for (const [id, lease] of [...this.leases.entries()]) {
      if (lease.entity === entity) {
        this.leases.delete(id);
        count += 1;
      }
    }
    for (const [resource, reserved] of this.identityReservations) {
      if (reserved.delete(entity)) {
        count += 1;
        this.audit.append(entity, 'population_resource_released', { resource });
      }
    }
    if (count > 0) this.audit.append(entity, 'resource_all_released', { count });
    return count;
  }

  activeLeases(now = Date.now()): readonly Lease[] {
    return [...this.leases.values()].filter((l) => l.expiresAt > now);
  }

  /** تصدير مُغلق للحالة المتغيرة؛ المواصفة والسياسة لا تُنسخان من الذاكرة. */
  exportAll(): ResourceRegistrySnapshot {
    return {
      leases: [...this.leases.values()].map((lease) => ({ ...lease })),
      reservations: [...this.identityReservations.entries()]
        .map(([resource, entities]) => [resource, [...entities]] as const),
      counter: this.counter,
    };
  }

  /** استيراد متحقق يستعمله الأرشيف الملكي وحده أثناء الاستعادة الذرية. */
  importAll(snapshot: ResourceRegistrySnapshot, by: EntityId): boolean {
    if (!Number.isSafeInteger(snapshot.counter) || snapshot.counter < 0) {
      throw new SovereignViolation('عداد موارد مستعاد غير صالح', 'RECOVERY_RESOURCE_COUNTER_INVALID');
    }
    const nextReservations = new Map<string, Set<EntityId>>();
    for (const resource of this.specs.keys()) nextReservations.set(resource, new Set<EntityId>());
    for (const [resource, entities] of snapshot.reservations) {
      const spec = this.specs.get(resource);
      if (!spec || !Array.isArray(entities) || new Set(entities).size !== entities.length
        || entities.some((entity) => typeof entity !== 'string') || entities.length > spec.total) {
        throw new SovereignViolation('حجوز مورد مستعادة غير صالحة', 'RECOVERY_RESOURCE_RESERVATION_INVALID');
      }
      nextReservations.set(resource, new Set(entities));
    }
    const nextLeases = new Map<string, Lease>();
    for (const lease of snapshot.leases) {
      if (!lease || typeof lease.leaseId !== 'string' || !this.specs.has(lease.resource)
        || !Number.isSafeInteger(lease.amount) || lease.amount <= 0 || nextLeases.has(lease.leaseId)) {
        throw new SovereignViolation('إيجار مستعاد غير صالح', 'RECOVERY_RESOURCE_LEASE_INVALID');
      }
      nextLeases.set(lease.leaseId, Object.freeze({ ...lease }));
    }
    for (const [resource, reserved] of nextReservations) {
      const leased = [...nextLeases.values()]
        .filter((lease) => lease.resource === resource)
        .reduce((sum, lease) => sum + lease.amount, 0);
      if (reserved.size + leased > this.spec(resource).total) {
        throw new SovereignViolation('تخصيص المورد المستعاد يتجاوز سقفه', 'RECOVERY_RESOURCE_CAP_EXCEEDED');
      }
    }
    this.leases.clear();
    for (const [id, lease] of nextLeases) this.leases.set(id, lease);
    this.identityReservations.clear();
    for (const [resource, entities] of nextReservations) this.identityReservations.set(resource, entities);
    this.counter = snapshot.counter;
    this.audit.append(by, 'resources_restored', { leases: nextLeases.size });
    return true;
  }
}
