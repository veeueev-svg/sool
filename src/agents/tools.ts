/**
 * src/agents/tools.ts — سجل الأدوات وحدودها وحصصها (المرحلة 12)
 * المالك: وزارة الأمن السيبراني
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مواصفة أداة معلنة + طلب استخدام من كيان يحمل قدرات ممنوحة
 * المخرجات: نتيجة الأداة أو رفض بسبب موثّق — ولكل استدعاء معرّف تدقيق
 * التبعيات: السجل، سجل الموارد (الحصة)، حارس الخروج (أدوات الشبكة)، مفتاح الإيقاف
 * الصلاحيات: التسجيل من الوزارة المالكة فقط؛ ولا أداة تمنح نفسها قدرة (RULE-005)
 * السجلات: تسجيل الأداة، كل استدعاء (مسموح/مرفوض/فاشل)، كل تجاوز حصة أو سقف
 * ثوابت هذه الوحدة:
 *   1) أداة غير مسجَّلة ⇒ رفض (لا تنفيذ لما لم يُعلَن)
 *   2) لا استدعاء بلا قدرة ممنوحة صريحة
 *   3) لكل أداة حصة موارد وسقف نداءات في نافذة زمنية
 *   4) أداة تحتاج شبكة تمرّ بحارس الخروج، ورفضه نهائي
 *   5) الإيقاف يمنع كل الأدوات بلا استثناء
 *   6) خطأ داخل الأداة ⇒ فشل مسجَّل + استعادة الحصة، ولا نتيجة جزئية
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/agents/tools.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — أدوات الوكلاء وحدودها
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ResourceRegistry } from '../kernel/resource_registry';
import { KillSwitch } from '../security/kill_switch';
import { NetworkEgressGuard } from '../external/network_egress';

export type ToolArgs = Readonly<Record<string, string | number | boolean>>;

export interface ToolSpec {
  readonly name: string;
  readonly owner: string;
  /** القدرة اللازمة — لا استدعاء بلا منحها للكيان */
  readonly requiredCapability: string;
  /** كلفة المورد لكل استدعاء (تُستأجر ثم تُستعاد) */
  readonly cost: { readonly resource: string; readonly amount: number } | null;
  readonly maxCallsPerWindow: number;
  readonly windowMs: number;
  /** إن احتاجت الأداة خروجًا شبكيًا فيجب أن يمرّ بحارس الخروج */
  readonly requiresNetwork: { readonly host: string; readonly port?: number } | null;
  readonly handler: (args: ToolArgs, entity: EntityId) => unknown;
}

export type ToolResult =
  | { readonly ok: true; readonly value: unknown; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface ToolRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly resources?: ResourceRegistry;
  readonly killSwitch?: KillSwitch;
  readonly egress?: NetworkEgressGuard;
  readonly ministryId?: EntityId;
}

export interface ToolUsage {
  readonly tool: string;
  readonly entity: EntityId;
  readonly calls: number;
  readonly denied: number;
  readonly failures: number;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec>();
  private readonly windows = new Map<string, number[]>();
  private readonly stats = new Map<string, { calls: number; denied: number; failures: number }>();
  private readonly ministryId: EntityId;

  constructor(private readonly deps: ToolRegistryDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:cyber_security';
    deps.audit.append(this.ministryId, 'tool_registry_online', {});
  }

  /** تسجيل أداة: بلا حدود معلنة لا تُسجَّل */
  register(spec: ToolSpec): void {
    if (this.tools.has(spec.name)) {
      this.deps.audit.append(this.ministryId, 'tool_registration_refused', {
        tool: spec.name, reason: 'أداة مسجَّلة مسبقًا',
      });
      throw new SovereignViolation(`أداة مسجَّلة مسبقًا: ${spec.name}`, 'TOOL_DUPLICATE');
    }
    if (!spec.requiredCapability || spec.maxCallsPerWindow <= 0 || spec.windowMs <= 0) {
      this.deps.audit.append(this.ministryId, 'tool_registration_refused', {
        tool: spec.name, reason: 'أداة بلا قدرة لازمة أو بلا سقف نداءات',
      });
      throw new SovereignViolation(`أداة بلا حدود معلنة: ${spec.name}`, 'TOOL_SPEC_INVALID');
    }
    if (spec.cost && this.deps.resources) {
      this.deps.resources.spec(spec.cost.resource); // مورد غير مسجَّل ⇒ استثناء سيادي
    }
    this.tools.set(spec.name, spec);
    this.deps.audit.append(this.ministryId, 'tool_registered', {
      tool: spec.name, owner: spec.owner, capability: spec.requiredCapability,
      cost: spec.cost, maxCallsPerWindow: spec.maxCallsPerWindow,
      network: spec.requiresNetwork?.host ?? null,
    });
  }

  get names(): readonly string[] {
    return [...this.tools.keys()];
  }

  usage(tool: string, entity: EntityId): ToolUsage {
    const s = this.stats.get(`${entity}|${tool}`) ?? { calls: 0, denied: 0, failures: 0 };
    return { tool, entity, ...s };
  }

  private bump(tool: string, entity: EntityId, field: 'calls' | 'denied' | 'failures'): void {
    const key = `${entity}|${tool}`;
    const s = this.stats.get(key) ?? { calls: 0, denied: 0, failures: 0 };
    s[field] += 1;
    this.stats.set(key, s);
  }

  /** الاستدعاء الوحيد المسموح لأي أداة — لا مسار جانبي */
  invoke(
    entity: EntityId,
    tool: string,
    args: ToolArgs,
    grants: readonly string[],
    now = Date.now(),
  ): ToolResult {
    const deny = (reason: string, kind = 'tool_denied'): ToolResult => {
      this.bump(tool, entity, 'denied');
      const entry = this.deps.audit.append(entity, kind, { tool, reason, args: Object.keys(args) });
      return { ok: false, reason, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch?.status;
    if (halt?.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      return deny('الإيقاف مُشتغل — لا استخدام لأي أداة');
    }

    const spec = this.tools.get(tool);
    if (!spec) return deny('أداة غير مسجَّلة — الرفض هو الافتراض', 'unregistered_tool_refused');

    if (!grants.includes(spec.requiredCapability)) {
      return deny(`قدرة غير ممنوحة: ${spec.requiredCapability}`, 'capability_missing');
    }

    const wkey = `${entity}|${tool}`;
    const window = (this.windows.get(wkey) ?? []).filter((t) => now - t < spec.windowMs);
    if (window.length >= spec.maxCallsPerWindow) {
      this.windows.set(wkey, window);
      return deny(`تجاوز سقف نداءات الأداة (${spec.maxCallsPerWindow})`, 'tool_rate_exceeded');
    }

    let leaseId: string | null = null;
    if (spec.cost && this.deps.resources) {
      const lease = this.deps.resources.lease(entity, spec.cost.resource, spec.cost.amount, now);
      if (!lease.granted) return deny(`حصة غير كافية: ${lease.reason}`, 'tool_quota_exceeded');
      leaseId = lease.lease.leaseId;
    }

    const release = (): void => {
      if (leaseId && this.deps.resources) this.deps.resources.release(leaseId);
    };

    if (spec.requiresNetwork) {
      if (!this.deps.egress) {
        release();
        return deny('أداة شبكية بلا حارس خروج — رفض مغلق', 'tool_no_egress_guard');
      }
      const decision = this.deps.egress.request(entity, {
        host: spec.requiresNetwork.host, port: spec.requiresNetwork.port, purpose: `tool:${tool}`,
      }, now);
      if (!decision.allowed) {
        release();
        return deny(`الخروج الشبكي مرفوض: ${decision.reason}`, 'tool_egress_denied');
      }
    }

    window.push(now);
    this.windows.set(wkey, window);

    try {
      const value = spec.handler(args, entity);
      release();
      this.bump(tool, entity, 'calls');
      const entry = this.deps.audit.append(entity, 'tool_invoked', {
        tool, capability: spec.requiredCapability, leaseId, args: Object.keys(args),
      });
      return { ok: true, value, auditId: entry.hash };
    } catch (err) {
      release();
      this.bump(tool, entity, 'failures');
      const reason = err instanceof Error ? err.message : 'فشل غير معروف';
      const entry = this.deps.audit.append(entity, 'tool_error', { tool, reason });
      return { ok: false, reason: `فشل الأداة: ${reason}`, auditId: entry.hash };
    }
  }
}
