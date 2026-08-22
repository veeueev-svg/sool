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

  /** منح إيجار مؤقّت — لا استخدام دائم لأي مورد (كل مورد معلن ومسجَّل ومؤقَّت) */
  lease(entity: EntityId, resource: string, amount: number, now = Date.now()): LeaseResult {
    const deny = (reason: string): LeaseResult => {
      const entry = this.audit.append(entity, 'resource_denied', { resource, amount, reason });
      return { granted: false, reason, auditId: entry.hash };
    };
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

    this.counter += 1;
    const lease: Lease = Object.freeze({
      leaseId: `lease:${resource}:${this.counter}`,
      entity, resource, amount,
      grantedAt: now,
      expiresAt: now + spec.lease_seconds * 1000,
    });
    this.leases.set(lease.leaseId, lease);
    const entry = this.audit.append(entity, 'resource_leased', {
      leaseId: lease.leaseId, resource, amount, expiresAt: lease.expiresAt,
    });
    return { granted: true, lease, auditId: entry.hash };
  }

  /** استعادة صريحة قبل الانتهاء */
  release(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
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
}
