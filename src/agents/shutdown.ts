/**
 * src/agents/shutdown.ts — الإيقاف الجماعي المضمون (المرحلة 19)
 * المالك: حرس التاج (والتنفيذ متاح لوزارة الأمن السيبراني والملك)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: جهة منفّذة مصرَّح لها + سبب
 * المخرجات: تقرير إيقاف: من جُمّد، من استُهدف، من توقّف، من بقي — وهل تحقّق الصفر
 * التبعيات: سياسة التوالد (التجميد)، سجل الوكلاء، سجل الصلاحيات، السجل
 * الصلاحيات: **لا يحتاج أمرًا ملكيًا** — إجراء سلامة كمفتاح الإيقاف، ويُصعَّد بعده
 * السجلات: mass_shutdown_started / mass_shutdown_completed / mass_shutdown_incomplete /
 *          mass_shutdown_refused
 * ثوابت هذه الوحدة:
 *   1) **التجميد يسبق الإيقاف** — وإلا وُلد وكيل بعد إيقاف من سبقه
 *   2) الوكيل لا يُصدر إيقافًا جماعيًا — الجهة المصرَّح لها معلنة في قائمة سماح
 *   3) القدرات تُسحب مع الإنهاء لا بعده — كيان منتهٍ بقدرة قائمة خطر معلَّق
 *   4) النجاح **يُتحقَّق منه** بعد التنفيذ: صفر وكيل حيّ، وإلا فالتقرير ناقص ويُصعَّد
 *   5) التنفيذ مرتين لا يُخطئ ولا يُكرّر أثرًا (خالٍ من الأثر الجانبي الثاني)
 *   6) لا فك تجميد ضمني — العودة قرار صريح مسجَّل
 * حالات الفشل (كلها مغلقة): بقاء وكيل واحد حيًّا يعني فشلًا معلنًا لا نجاحًا جزئيًا
 * اختبار القبول: tests/agents/factory.test.ts §الإيقاف الجماعي
 * الوثيقة المرتبطة: docs/decisions/ADR-0004-agent-factory.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { AgentRegistry, AgentStatus } from './agent_registry';
import { PermissionRegistry } from './permissions';
import { SpawnPolicy } from './spawn_policy';

/** الجهات التي يجوز لها إصدار إيقاف جماعي — قائمة سماح لا حظر */
export const SHUTDOWN_AUTHORITIES: readonly EntityId[] = Object.freeze([
  'authority:king',
  'authority:crown_guard',
  'ministry:cybersecurity',
]);

const ALIVE: readonly AgentStatus[] = ['created', 'running', 'suspended'];

export interface ShutdownReport {
  readonly executed: boolean;
  readonly complete: boolean;
  readonly reason: string;
  readonly frozen: boolean;
  readonly targeted: readonly EntityId[];
  readonly stopped: readonly EntityId[];
  readonly remaining: readonly EntityId[];
  readonly capabilitiesRevoked: number;
  readonly auditId: string;
}

export class MassShutdown {
  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly registry: AgentRegistry,
    private readonly permissions: PermissionRegistry,
    private readonly policy: SpawnPolicy,
    private readonly authorities: readonly EntityId[] = SHUTDOWN_AUTHORITIES,
  ) {}

  execute(by: EntityId, reason: string): ShutdownReport {
    if (!this.authorities.includes(by)) {
      const entry = this.audit.append(by, 'mass_shutdown_refused', {
        reason: 'جهة غير مصرَّح لها', requestedBy: by,
      });
      if (by.startsWith('agent:')) {
        this.audit.append(by, 'escalated_to_king', {
          incident: 'agent_attempted_mass_shutdown', requestedBy: by,
        });
      }
      return {
        executed: false, complete: false, reason: 'جهة غير مصرَّح لها بالإيقاف الجماعي',
        frozen: false, targeted: [], stopped: [], remaining: [], capabilitiesRevoked: 0,
        auditId: entry.hash,
      };
    }

    // 1) التجميد أولًا — لا مولود جديد أثناء الإيقاف
    this.policy.freeze(by, `إيقاف جماعي: ${reason}`);
    const targeted = this.registry
      .list()
      .filter((a) => ALIVE.includes(a.status))
      .map((a) => a.agentId);
    this.audit.append(by, 'mass_shutdown_started', { reason, targeted: targeted.length });

    // 2) الإنهاء وسحب القدرات معًا لكل وكيل
    const stopped: EntityId[] = [];
    let capabilitiesRevoked = 0;
    for (const agentId of targeted) {
      const result = this.registry.terminate(agentId, by, `إيقاف جماعي: ${reason}`);
      capabilitiesRevoked += this.permissions.revokeAll(agentId, by, `إيقاف جماعي: ${reason}`);
      if (result.ok) stopped.push(agentId);
    }

    // 3) التحقق: النجاح لا يُفترض
    const remaining = this.registry
      .list()
      .filter((a) => ALIVE.includes(a.status))
      .map((a) => a.agentId);
    const complete = remaining.length === 0;

    const entry = this.audit.append(
      by,
      complete ? 'mass_shutdown_completed' : 'mass_shutdown_incomplete',
      {
        reason, targeted: targeted.length, stopped: stopped.length,
        remaining, capabilitiesRevoked, complete,
      },
    );
    if (!complete) {
      this.audit.append(by, 'escalated_to_king', {
        incident: 'mass_shutdown_incomplete', remaining,
      });
    }

    return {
      executed: true, complete,
      reason: complete
        ? 'أُوقف كل الوكلاء وتُحقّق من الصفر'
        : `بقي ${remaining.length} وكيلًا حيًّا — تقرير ناقص مصعَّد إلى الملك`,
      frozen: this.policy.isFrozen, targeted, stopped, remaining, capabilitiesRevoked,
      auditId: entry.hash,
    };
  }

  /** العودة إلى التوالد بعد إيقاف جماعي — قرار صريح لا ضمني */
  resumeSpawning(by: EntityId, reason: string): boolean {
    if (!this.authorities.includes(by)) {
      this.audit.append(by, 'spawn_thaw_refused', { requestedBy: by, reason: 'جهة غير مصرَّح لها' });
      return false;
    }
    return this.policy.thaw(by, reason);
  }
}
