/**
 * src/crown/termination_order.ts — أوامر الإنهاء الجماعي (المرحلة 9)
 * المالك: حرس التاج
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي موقّع بفعل terminate_agent أو declare_emergency
 * المخرجات: إيقاف كل الكيانات المستهدَفة + تأكيد التوقف + استعادة الموارد
 * التبعيات: بوابة التاج (اعتماد)، مفتاح الإيقاف (تأكيد التوقف)، سجل الموارد (الاستعادة)
 * الصلاحيات: التنفيذ فقط — لا اعتماد ذاتي (RULE-004)
 * ثوابت:
 *   - لا إنهاء بلا أمر معتمد من البوابة
 *   - النجاح لا يُعلَن إلا بتأكيد توقف كل كيان مستهدَف
 *   - كيان لم يتوقف ⇒ إيقاف شامل + تصعيد للملك، ولا يُعلَن نجاح جزئي
 *   - كل موارد الكيان المنتهي تُستعاد فورًا
 * حالات الفشل (كلها مغلقة): استثناء من المتحكّم يُعامل كعدم توقف
 * اختبار القبول: tests/crown/termination_order.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-monarchy-comprehensive-spec.md — حرس الملك والإنهاء والإيقاف
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from './crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { ResourceRegistry } from '../kernel/resource_registry';

/** متحكّم الكيانات: يعرف من يعمل، ويحاول إيقافه، ويُبلّغ عن حالته */
export interface EntityController {
  list(): readonly EntityId[];
  stop(entity: EntityId): boolean;
  isRunning(entity: EntityId): boolean;
}

export interface TerminationReport {
  readonly executed: boolean;
  readonly reason: string;
  readonly targeted: readonly EntityId[];
  readonly stopped: readonly EntityId[];
  readonly failed: readonly EntityId[];
  readonly complete: boolean;
  readonly resourcesReclaimed: number;
  readonly auditId: string;
}

export class TerminationOrder {
  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly killSwitch: KillSwitch,
    private readonly controller: EntityController,
    private readonly resources?: ResourceRegistry,
    private readonly guardId: EntityId = 'authority:crown_guard',
  ) {}

  /**
   * ينفّذ أمر إنهاء. الهدف "all" يعني كل الكيانات العاملة،
   * أو تُحدَّد قائمة في params.targets مفصولة بفواصل.
   */
  execute(command: SignedRoyalCommand, now = Date.now()): TerminationReport {
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed) {
      const entry = this.audit.append(this.guardId, 'mass_termination_refused', {
        commandId: command.payload.commandId, reason: decision.reason,
      });
      return {
        executed: false, reason: decision.reason, targeted: [], stopped: [], failed: [],
        complete: false, resourcesReclaimed: 0, auditId: entry.hash,
      };
    }

    const targeted = this.resolveTargets(command);
    this.audit.append(this.guardId, 'mass_termination_started', {
      commandId: command.payload.commandId, count: targeted.length, targeted: [...targeted],
    });

    const stopped: EntityId[] = [];
    const failed: EntityId[] = [];
    let reclaimed = 0;

    for (const entity of targeted) {
      let ok = false;
      try {
        ok = this.controller.stop(entity) && !this.controller.isRunning(entity);
      } catch (err) {
        this.audit.append(this.guardId, 'termination_error', { entity, error: (err as Error).message });
        ok = false;
      }
      if (ok) {
        this.killSwitch.confirmStopped(entity);
        stopped.push(entity);
        reclaimed += this.resources?.releaseAllFor(entity) ?? 0;
      } else {
        failed.push(entity);
        this.audit.append(this.guardId, 'termination_failed', { entity });
      }
    }

    const check = this.killSwitch.verifyStopped(targeted);
    const complete = failed.length === 0 && check.complete;

    if (!complete) {
      // فشل جزئي ⇒ لا نجاح جزئي: إيقاف شامل وتصعيد
      this.killSwitch.engage(this.guardId, 'all', 'إنهاء جماعي غير مكتمل — احتواء وقائي');
      this.audit.append(this.guardId, 'escalated_to_king', {
        reason: 'إنهاء جماعي غير مكتمل', failed: [...failed], missing: [...check.missing],
      });
    }

    const entry = this.audit.append(this.guardId, complete ? 'mass_termination_complete' : 'mass_termination_incomplete', {
      commandId: command.payload.commandId,
      stopped: stopped.length, failed: failed.length, resourcesReclaimed: reclaimed,
    });

    return {
      executed: true,
      reason: complete
        ? 'تم إنهاء كل الكيانات المستهدَفة وتأكيد توقفها'
        : `إنهاء غير مكتمل: ${failed.length} كيانًا لم يتوقف — تم الاحتواء والتصعيد`,
      targeted, stopped, failed, complete, resourcesReclaimed: reclaimed, auditId: entry.hash,
    };
  }

  private resolveTargets(command: SignedRoyalCommand): readonly EntityId[] {
    const { target, params } = command.payload;
    const listed = params['targets'];
    if (typeof listed === 'string' && listed.trim() !== '') {
      return listed.split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (target === 'all' || target === '*') return [...this.controller.list()];
    return [target];
  }
}
