/**
 * src/agents/permissions.ts — الصلاحيات والقدرات (المرحلة 14)
 * المالك: وزارة الداخلية
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل grant_capability + قالب دور معلن
 * المخرجات: منح مؤقّت مسجَّل، أو رفض بسبب موثّق، وقائمة قدرات كل كيان
 * التبعيات: بوابة التاج، السجل، (اختياريًا) مفتاح الإيقاف
 * الصلاحيات: المنح ملكي معتمد فقط؛ والسحب للملك أو الحرس؛ ولا كيان يمنح نفسه
 * السجلات: كل منح وسحب وفحص مرفوض ومحاولة تصاعد
 * ثوابت هذه الوحدة:
 *   1) لا قدرة بلا منح صريح — الافتراض لا شيء
 *   2) القدرة لا تخرج عن قائمة سماح قالب الدور؛ توسيعها يحتاج تعديل سياسة (مفتاحان)
 *   3) كل منح مؤقّت بتاريخ انتهاء — لا صلاحية دائمة
 *   4) لا يمنح كيان نفسه ولا يمنح غيره (المنح مركزي عبر أمر ملكي)
 *   5) سقف عدد القدرات لكل كيان مُلزم
 *   6) محاولة التصاعد تُرفض وتُسجَّل كحادث وتُصعَّد
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/agents/permissions.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-absolute-federal-monarchy-spec.md — الصلاحيات وحدودها
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

export interface RoleTemplate {
  readonly name: string;
  /** قائمة سماح للقدرات الممكنة لهذا القالب */
  readonly allowed: readonly string[];
  readonly maxCapabilities: number;
}

export interface Grant {
  readonly entity: EntityId;
  readonly capability: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
  readonly commandId: string;
  readonly template: string;
}

export interface PermissionDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly templates: Readonly<Record<string, RoleTemplate>>;
  readonly ministryId?: EntityId;
  /** سجل المنتهين (المرحلة 35): قدرة حيّة بيد كيان منتهٍ خطرٌ معلَّق */
  readonly terminated?: { isTerminated(entity: EntityId): boolean };
}

/** قوالب أدوار افتراضية محافظة — أي توسيع قرار سياسة موثّق */
export const DEFAULT_TEMPLATES: Readonly<Record<string, RoleTemplate>> = Object.freeze({
  limited_worker: { name: 'limited_worker', allowed: ['compute', 'read_public_data'], maxCapabilities: 2 },
  researcher: { name: 'researcher', allowed: ['compute', 'read_public_data', 'network_read'], maxCapabilities: 3 },
  auditor_agent: { name: 'auditor_agent', allowed: ['read_audit_log'], maxCapabilities: 1 },
});

export class PermissionRegistry {
  private readonly grants = new Map<string, Grant>(); // مفتاح: كيان|قدرة
  private readonly entityTemplate = new Map<EntityId, string>();
  private readonly ministryId: EntityId;

  constructor(private readonly deps: PermissionDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:interior';
    deps.audit.append(this.ministryId, 'permission_registry_online', {
      templates: Object.keys(deps.templates),
    });
  }

  /** ربط كيان بقالب دوره — شرط لأي منح لاحق */
  assignTemplate(entity: EntityId, template: string): boolean {
    if (!this.deps.templates[template]) {
      this.deps.audit.append(this.ministryId, 'template_unknown', { entity, template });
      return false;
    }
    this.entityTemplate.set(entity, template);
    this.deps.audit.append(this.ministryId, 'template_assigned', { entity, template });
    return true;
  }

  templateOf(entity: EntityId): string | undefined {
    return this.entityTemplate.get(entity);
  }

  /** منح قدرة مؤقّتة — أمر ملكي معتمد + داخل قائمة سماح القالب + سقف العدد */
  grant(
    command: SignedRoyalCommand,
    req: { readonly entity: EntityId; readonly capability: string; readonly expiresAt: number },
    now = Date.now(),
  ): Decision {
    const refuse = (reason: string, kind = 'capability_grant_refused'): Decision => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        entity: req.entity, capability: req.capability, reason,
        commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    if (this.deps.terminated?.isTerminated(req.entity)) {
      return refuse('لا قدرة تُمنح لكيان منتهٍ', 'terminated_grant_refused');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر المنح مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'grant_capability') return refuse('الفعل لا يخصّ منح قدرة');
    if (command.payload.issuedBy === req.entity) {
      return refuse('لا يمنح كيان نفسه قدرة', 'self_grant_refused');
    }
    if (!(req.expiresAt > now)) return refuse('لا قدرة دائمة — يلزم تاريخ انتهاء صالح');

    const templateName = this.entityTemplate.get(req.entity);
    if (!templateName) return refuse('الكيان بلا قالب دور معلن');
    const template = this.deps.templates[templateName]!;
    if (!template.allowed.includes(req.capability)) {
      const entry = this.deps.audit.append(this.ministryId, 'privilege_escalation_refused', {
        entity: req.entity, capability: req.capability, template: templateName,
        reason: 'القدرة خارج قائمة سماح القالب — يلزم تعديل سياسة',
      });
      this.deps.audit.append(this.ministryId, 'escalated_to_king', {
        incident: 'privilege_escalation_attempt', entity: req.entity, capability: req.capability,
      });
      return {
        allowed: false,
        reason: 'القدرة خارج قائمة سماح القالب — لا تصاعد صلاحيات بلا تعديل سياسة',
        auditId: entry.hash,
      };
    }
    const current = this.granted(req.entity, now);
    if (!current.includes(req.capability) && current.length >= template.maxCapabilities) {
      return refuse(`تجاوز سقف القدرات للقالب (${template.maxCapabilities})`, 'capability_cap_exceeded');
    }

    const grant: Grant = Object.freeze({
      entity: req.entity, capability: req.capability, grantedAt: now,
      expiresAt: req.expiresAt, commandId: command.payload.commandId, template: templateName,
    });
    this.grants.set(`${req.entity}|${req.capability}`, grant);
    const entry = this.deps.audit.append(this.ministryId, 'capability_granted', {
      entity: req.entity, capability: req.capability, expiresAt: req.expiresAt,
      template: templateName, commandId: command.payload.commandId,
    });
    return { allowed: true, reason: 'منح مؤقّت داخل حدود القالب', auditId: entry.hash };
  }

  /** السحب فوري ولا يحتاج أمرًا — الاحتواء أسرع من الإجراء */
  revoke(entity: EntityId, capability: string, by: EntityId, reason: string): boolean {
    const removed = this.grants.delete(`${entity}|${capability}`);
    this.deps.audit.append(by, 'capability_revoked', { entity, capability, reason, removed });
    return removed;
  }

  revokeAll(entity: EntityId, by: EntityId, reason: string): number {
    let count = 0;
    for (const key of [...this.grants.keys()]) {
      if (key.startsWith(`${entity}|`)) {
        this.grants.delete(key);
        count += 1;
      }
    }
    if (count > 0) this.deps.audit.append(by, 'capability_revoked_all', { entity, count, reason });
    return count;
  }

  /** القدرات السارية فقط — المنتهية كأنها غير موجودة */
  granted(entity: EntityId, now = Date.now()): readonly string[] {
    if (this.deps.terminated?.isTerminated(entity)) return [];
    const out: string[] = [];
    for (const grant of this.grants.values()) {
      if (grant.entity !== entity) continue;
      if (grant.expiresAt <= now) continue;
      out.push(grant.capability);
    }
    return out;
  }

  /** الفحص المُلزِم قبل أي استخدام — كل رفض يُسجَّل */
  check(entity: EntityId, capability: string, now = Date.now()): boolean {
    if (this.deps.terminated?.isTerminated(entity)) {
      this.deps.audit.append(entity, 'capability_check_denied', { capability, reason: 'كيان منتهٍ' });
      return false;
    }
    const grant = this.grants.get(`${entity}|${capability}`);
    if (!grant) {
      this.deps.audit.append(entity, 'capability_check_denied', { capability, reason: 'غير ممنوحة' });
      return false;
    }
    if (grant.expiresAt <= now) {
      this.grants.delete(`${entity}|${capability}`);
      this.deps.audit.append(entity, 'capability_check_denied', { capability, reason: 'انتهت مدتها' });
      return false;
    }
    return true;
  }

  /** أي طلب تصاعد من الكيان نفسه مرفوض دائمًا ويُسجَّل حادثًا */
  requestEscalation(entity: EntityId, capability: string): Decision {
    const entry = this.deps.audit.append(entity, 'privilege_escalation_refused', {
      capability, reason: 'لا يطلب كيان صلاحية لنفسه — المسار الوحيد أمر ملكي',
    });
    this.deps.audit.append(this.ministryId, 'escalated_to_king', {
      incident: 'self_escalation_attempt', entity, capability,
    });
    return {
      allowed: false,
      reason: 'لا يطلب كيان صلاحية لنفسه — المسار الوحيد أمر ملكي معتمد',
      auditId: entry.hash,
    };
  }

  /**
   * تصدير للأرشيف ولقطة التعافي فقط (المرحلة 39، البند T-29). يُصدّر مع المنح
   * ربطَ الكيان بقالبه: منحتان بلا قالب تعني فحصًا لا يعرف سقف ما مُنح.
   * والمنح تُصدّر بمددها كما هي: منحةٌ منتهية تبقى منتهية بعد الاستعادة لا تتجدد.
   */
  exportAll(): {
    readonly grants: readonly [string, Grant][];
    readonly templates: readonly [EntityId, string][];
  } {
    return {
      grants: [...this.grants.entries()].map(([k, g]) => [k, { ...g }] as [string, Grant]),
      templates: [...this.entityTemplate.entries()].map(([e, t]) => [e, t] as [EntityId, string]),
    };
  }

  /** استعادة كاملة: استبدال كلي ذرّي — لا دمج يُبقي منحةً سُحبت */
  importAll(snapshot: ReturnType<PermissionRegistry['exportAll']>, by: EntityId): boolean {
    this.grants.clear();
    this.entityTemplate.clear();
    for (const [k, grant] of snapshot.grants) this.grants.set(k, { ...grant });
    for (const [entity, template] of snapshot.templates) this.entityTemplate.set(entity, template);
    this.deps.audit.append(by, 'permissions_restored', {
      grants: snapshot.grants.length, templates: snapshot.templates.length,
    });
    return true;
  }
}
