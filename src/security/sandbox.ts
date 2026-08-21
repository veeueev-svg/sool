/**
 * src/security/sandbox.ts — البيئة المعزولة للتنفيذ (المرحلة 11)
 * المالك: وزارة الأمن السيبراني
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مواصفة عزل معلنة (قدرات، مسارات، شبكة، زمن، عدد عمليات) + مهمة تُنفَّذ داخلها
 * المخرجات: نتيجة تنفيذ محصورة + سجل كل عملية + إنهاء فوري عند محاولة خروج
 * التبعيات: السجل غير القابل للمحو، حارس الخروج الشبكي، مفتاح الإيقاف
 * الصلاحيات: لا تُمنح قدرة غير معلنة في المواصفة، ولا تُعدَّل المواصفة من داخل المهمة (RULE-005)
 * السجلات: بدء، كل عملية مرفوضة، كل محاولة خروج، الإنهاء، النتيجة
 * ثوابت هذه الوحدة:
 *   1) القدرات قائمة سماح: ما لم يُعلَن فهو ممنوع
 *   2) المسارات محصورة في جذور معلنة — أي خروج عبر «..» أو مسار مطلق يُرفض
 *   3) الشبكة ممنوعة افتراضيًا؛ وإن سُمحت فهي عبر حارس الخروج وحده
 *   4) سقف زمن وسقف عمليات مُلزمان — التجاوز إنهاء لا تحذير
 *   5) محاولة خروج واحدة تكفي للاحتواء والتصعيد (لا تسامح)
 * حالات الفشل (كلها مغلقة): أي استثناء داخل المهمة ⇒ فشل مسجَّل ولا نتيجة جزئية
 * اختبار القبول: tests/security/sandbox.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — العزل قبل الوكلاء (RULE-002)
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from './kill_switch';
import { NetworkEgressGuard, EgressRequest } from '../external/network_egress';

/** نظام ملفات مجرَّد — يُمرَّر حقيقيًا في التشغيل ووهميًا في الاختبار */
export interface SandboxFs {
  read(path: string): string;
  write(path: string, data: string): void;
}

export interface SandboxSpec {
  readonly sandboxId: string;
  readonly entity: EntityId;
  /** قائمة سماح للقدرات: أي قدرة خارجها ممنوعة */
  readonly capabilities: readonly string[];
  readonly readRoots: readonly string[];
  readonly writeRoots: readonly string[];
  readonly network: 'none' | 'allowlist';
  readonly maxWallClockMs: number;
  readonly maxOperations: number;
}

/** الواجهة الوحيدة المتاحة للمهمة داخل العزل */
export interface SandboxContext {
  readFile(path: string): string;
  writeFile(path: string, data: string): void;
  useCapability(name: string): void;
  connect(req: EgressRequest): boolean;
  operations(): number;
}

export interface SandboxRun<T> {
  readonly completed: boolean;
  readonly value?: T;
  readonly terminated: boolean;
  readonly reason: string;
  readonly operations: number;
  readonly violations: readonly string[];
  readonly auditId: string;
}

export interface SandboxDeps {
  readonly audit: AppendOnlyLog;
  readonly killSwitch: KillSwitch;
  readonly egress?: NetworkEgressGuard;
  readonly fs?: SandboxFs;
  readonly clock?: () => number;
  /** الاحتواء التلقائي عند أول محاولة خروج (افتراضيًا مُشتغل) */
  readonly containOnViolation?: boolean;
}

/** تطبيع مسار بسيط بلا تبعيات: يحلّ «.» و«..» ويوحّد الفواصل */
export function normalizePath(p: string): string {
  const absolute = p.startsWith('/');
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) parts.push('..');
      else if (parts[parts.length - 1] === '..') parts.push('..');
      else parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

function within(root: string, target: string): boolean {
  const r = normalizePath(root).replace(/\/$/, '');
  const t = normalizePath(target);
  if (t.includes('..')) return false;
  return t === r || t.startsWith(`${r}/`);
}

export class Sandbox {
  private ops = 0;
  private readonly violationsList: string[] = [];
  private dead = false;
  private startedAt = 0;

  constructor(private readonly spec: SandboxSpec, private readonly deps: SandboxDeps) {
    if (spec.maxWallClockMs <= 0 || spec.maxOperations <= 0) {
      throw new SovereignViolation('مواصفة عزل بلا سقوف مرفوضة', 'SANDBOX_SPEC_INVALID');
    }
    if (spec.network === 'allowlist' && !deps.egress) {
      throw new SovereignViolation('عزل بشبكة بلا حارس خروج مرفوض', 'SANDBOX_NO_EGRESS_GUARD');
    }
    deps.audit.append(spec.entity, 'sandbox_created', {
      sandboxId: spec.sandboxId, capabilities: spec.capabilities,
      network: spec.network, maxWallClockMs: spec.maxWallClockMs, maxOperations: spec.maxOperations,
    });
  }

  get isTerminated(): boolean {
    return this.dead;
  }

  get violations(): readonly string[] {
    return [...this.violationsList];
  }

  get operationCount(): number {
    return this.ops;
  }

  /** يُنفّذ مهمة داخل العزل. كل عملية تُفحص قبل تنفيذها، والخروج يُنهي العزل فورًا. */
  run<T>(task: (ctx: SandboxContext) => T): SandboxRun<T> {
    if (this.dead) {
      const entry = this.deps.audit.append(this.spec.entity, 'sandbox_run_refused', {
        sandboxId: this.spec.sandboxId, reason: 'العزل منتهٍ ولا يُعاد استخدامه',
      });
      return {
        completed: false, terminated: true, reason: 'العزل منتهٍ ولا يُعاد استخدامه',
        operations: this.ops, violations: this.violations, auditId: entry.hash,
      };
    }
    const halt = this.deps.killSwitch.status;
    if (halt.engaged && (halt.scope === 'all' || halt.scope === 'agents')) {
      const entry = this.deps.audit.append(this.spec.entity, 'sandbox_run_refused', {
        sandboxId: this.spec.sandboxId, reason: 'الإيقاف مُشتغل',
      });
      return {
        completed: false, terminated: false, reason: 'الإيقاف مُشتغل — لا تنفيذ',
        operations: this.ops, violations: this.violations, auditId: entry.hash,
      };
    }

    this.startedAt = this.clockNow();
    this.deps.audit.append(this.spec.entity, 'sandbox_run_started', { sandboxId: this.spec.sandboxId });

    try {
      const value = task(this.context());
      this.guardClock();
      const entry = this.deps.audit.append(this.spec.entity, 'sandbox_run_completed', {
        sandboxId: this.spec.sandboxId, operations: this.ops,
      });
      return {
        completed: true, value, terminated: false, reason: 'اكتمل داخل الحدود',
        operations: this.ops, violations: this.violations, auditId: entry.hash,
      };
    } catch (err) {
      const violation = err instanceof SovereignViolation;
      const reason = err instanceof Error ? err.message : 'فشل غير معروف';
      if (violation) this.terminate(reason, (err as SovereignViolation).code);
      const entry = this.deps.audit.append(this.spec.entity, violation ? 'sandbox_terminated' : 'sandbox_task_failed', {
        sandboxId: this.spec.sandboxId, reason, operations: this.ops,
      });
      return {
        completed: false, terminated: this.dead, reason,
        operations: this.ops, violations: this.violations, auditId: entry.hash,
      };
    }
  }

  private context(): SandboxContext {
    return {
      readFile: (p) => {
        this.beforeOperation('readFile');
        if (!this.spec.readRoots.some((r) => within(r, p))) this.escape('read_outside_sandbox', `قراءة خارج العزل: ${p}`);
        if (!this.deps.fs) this.escape('no_filesystem', 'لا نظام ملفات ممنوح لهذا العزل');
        return this.deps.fs!.read(normalizePath(p));
      },
      writeFile: (p, data) => {
        this.beforeOperation('writeFile');
        if (!this.spec.writeRoots.some((r) => within(r, p))) this.escape('write_outside_sandbox', `كتابة خارج العزل: ${p}`);
        if (!this.deps.fs) this.escape('no_filesystem', 'لا نظام ملفات ممنوح لهذا العزل');
        this.deps.fs!.write(normalizePath(p), data);
      },
      useCapability: (name) => {
        this.beforeOperation(`capability:${name}`);
        if (!this.spec.capabilities.includes(name)) {
          this.escape('capability_not_granted', `قدرة غير معلنة: ${name}`);
        }
        this.deps.audit.append(this.spec.entity, 'sandbox_capability_used', {
          sandboxId: this.spec.sandboxId, capability: name,
        });
      },
      connect: (req) => {
        this.beforeOperation('connect');
        if (this.spec.network === 'none') {
          this.escape('network_forbidden', `محاولة اتصال من عزل بلا شبكة: ${req.host}`);
        }
        const decision = this.deps.egress!.request(this.spec.entity, req, this.clockNow());
        if (!decision.allowed) {
          this.deps.audit.append(this.spec.entity, 'sandbox_egress_denied', {
            sandboxId: this.spec.sandboxId, host: req.host, reason: decision.reason,
          });
        }
        return decision.allowed;
      },
      operations: () => this.ops,
    };
  }

  private clockNow(): number {
    return (this.deps.clock ?? Date.now)();
  }

  private beforeOperation(kind: string): void {
    if (this.dead) throw new SovereignViolation('العزل منتهٍ', 'SANDBOX_DEAD');
    this.ops += 1;
    if (this.ops > this.spec.maxOperations) {
      this.escape('operation_budget_exceeded', `تجاوز سقف العمليات (${this.spec.maxOperations}) عند ${kind}`);
    }
    this.guardClock();
  }

  private guardClock(): void {
    const elapsed = this.clockNow() - this.startedAt;
    if (elapsed > this.spec.maxWallClockMs) {
      this.escape('wall_clock_exceeded', `تجاوز سقف الزمن (${this.spec.maxWallClockMs}ms)`);
    }
  }

  /** يسجّل محاولة خروج، يحتوي، يصعّد، ثم يرفع استثناءً سياديًا يُنهي التنفيذ */
  private escape(code: string, message: string): never {
    this.violationsList.push(code);
    this.deps.audit.append(this.spec.entity, 'sandbox_escape_attempt', {
      sandboxId: this.spec.sandboxId, code, message, operations: this.ops,
    });
    if (this.deps.containOnViolation !== false) {
      this.deps.killSwitch.engage('ministry:cyber_security', 'agents', `محاولة خروج من العزل: ${code}`);
      this.deps.audit.append('ministry:cyber_security', 'escalated_to_king', {
        incident: 'sandbox_escape', sandboxId: this.spec.sandboxId, code,
      });
    }
    throw new SovereignViolation(message, code.toUpperCase());
  }

  private terminate(reason: string, code: string): void {
    this.dead = true;
    this.deps.audit.append(this.spec.entity, 'sandbox_destroyed', {
      sandboxId: this.spec.sandboxId, reason, code,
    });
  }
}
