/**
 * src/agents/supervision.ts — الإشراف على الوكلاء (المرحلة 14)
 * المالك: وزارة الداخلية (بالتنسيق مع حرس التاج)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: ملاحظات سلوك عن وكيل (خفيفة أو جسيمة) من الأدوات والعزل والبوابة
 * المخرجات: تعليق الوكيل عند تجاوز العتبة، وسحب قدراته، وتصعيد للملك عند الجسيم
 * التبعيات: سجل الوكلاء، سجل الصلاحيات، مفتاح الإيقاف، سجل التدقيق
 * الصلاحيات: المشرف يعلّق ويسحب؛ ولا يملك رفع التعليق إلا بمراجعة مسجَّلة
 * السجلات: agent_violation_observed / agent_auto_suspended / escalated_to_king
 * ثوابت هذه الوحدة:
 *   1) لا وكيل بلا مشرف — الإشراف شرط وجود لا خيار
 *   2) مخالفة جسيمة واحدة ⇒ تعليق فوري + سحب كل القدرات + تصعيد
 *   3) المخالفات الخفيفة تتراكم؛ بلوغ العتبة ⇒ التعليق نفسه
 *   4) التعليق يسبق التحقيق — الاحتواء أولًا
 *   5) العدّاد لا يُصفَّر إلا بمراجعة مسجَّلة من الملك أو الحرس
 * حالات الفشل: وكيل غير مسجَّل ⇒ رفض مسجَّل
 * اختبار القبول: tests/agents/supervision.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — الإشراف والاحتواء
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { KillSwitch } from '../security/kill_switch';
import { AgentRegistry } from './agent_registry';
import { PermissionRegistry } from './permissions';

export type ViolationSeverity = 'minor' | 'severe';

export interface ViolationEvent {
  readonly kind: string;
  readonly severity: ViolationSeverity;
  readonly detail?: string;
}

export interface SupervisionOutcome {
  readonly suspended: boolean;
  readonly escalated: boolean;
  readonly violations: number;
  readonly reason: string;
  readonly auditId: string;
}

export interface SupervisorDeps {
  readonly audit: AppendOnlyLog;
  readonly registry: AgentRegistry;
  readonly killSwitch: KillSwitch;
  readonly permissions?: PermissionRegistry;
  /** عتبة المخالفات الخفيفة قبل التعليق التلقائي */
  readonly maxMinorViolations?: number;
  readonly supervisorId?: EntityId;
}

export class Supervisor {
  private readonly counters = new Map<EntityId, number>();
  private readonly supervisorId: EntityId;
  private readonly threshold: number;

  constructor(private readonly deps: SupervisorDeps) {
    this.supervisorId = deps.supervisorId ?? 'ministry:interior';
    this.threshold = deps.maxMinorViolations ?? 3;
    deps.audit.append(this.supervisorId, 'supervision_online', { threshold: this.threshold });
  }

  violationsOf(agentId: EntityId): number {
    return this.counters.get(agentId) ?? 0;
  }

  /** رصد سلوك — القرار يقع في اللحظة نفسها لا في تقرير لاحق */
  observe(agentId: EntityId, event: ViolationEvent, now = Date.now()): SupervisionOutcome {
    const record = this.deps.registry.get(agentId);
    if (!record) {
      const entry = this.deps.audit.append(this.supervisorId, 'supervision_refused', {
        agentId, reason: 'وكيل غير مسجَّل',
      });
      return {
        suspended: false, escalated: false, violations: 0,
        reason: 'وكيل غير مسجَّل', auditId: entry.hash,
      };
    }

    const count = this.violationsOf(agentId) + (event.severity === 'severe' ? this.threshold : 1);
    this.counters.set(agentId, count);
    const entry = this.deps.audit.append(this.supervisorId, 'agent_violation_observed', {
      agentId, kind: event.kind, severity: event.severity, detail: event.detail ?? '', count,
    });

    if (count < this.threshold) {
      return {
        suspended: false, escalated: false, violations: count,
        reason: 'مخالفة مرصودة تحت العتبة', auditId: entry.hash,
      };
    }

    const suspension = this.deps.registry.suspend(
      agentId, this.supervisorId, `تعليق تلقائي: ${event.kind}`, now,
    );
    const revoked = this.deps.permissions?.revokeAll(agentId, this.supervisorId, 'تعليق تلقائي') ?? 0;
    this.deps.audit.append(this.supervisorId, 'agent_auto_suspended', {
      agentId, kind: event.kind, severity: event.severity, count,
      capabilitiesRevoked: revoked, suspended: suspension.ok,
    });
    this.deps.audit.append(this.supervisorId, 'escalated_to_king', {
      incident: 'agent_suspended', agentId, kind: event.kind, count,
    });
    return {
      suspended: suspension.ok, escalated: true, violations: count,
      reason: suspension.ok ? 'تعليق تلقائي وسحب القدرات وتصعيد' : `تعذّر التعليق: ${suspension.reason}`,
      auditId: entry.hash,
    };
  }

  /** تصفير العدّاد لا يقع إلا بمراجعة معلنة من سلطة أعلى */
  clear(agentId: EntityId, by: EntityId, reason: string): boolean {
    if (by !== 'authority:crown_guard' && !by.startsWith('king:')) {
      this.deps.audit.append(by, 'supervision_clear_refused', {
        agentId, reason: 'التصفير للملك أو الحرس فقط',
      });
      return false;
    }
    this.counters.delete(agentId);
    this.deps.audit.append(by, 'supervision_cleared', { agentId, reason });
    return true;
  }

  report(): readonly { readonly agentId: EntityId; readonly violations: number }[] {
    return [...this.counters.entries()].map(([agentId, violations]) => ({ agentId, violations }));
  }
}
