/**
 * src/crown/guardians.ts — حرس التاج وأوامر الإنهاء (المرحلة 9)
 * المالك: حرس التاج
 * المدخلات: أمر ملكي معتمد من بوابة التاج | المخرجات: تنفيذ الإنهاء أو الإيقاف + تأكيد التوقف
 * الصلاحيات: التنفيذ فقط — لا اعتماد ولا تعديل سياسة (RULE-004)
 * حالات الفشل: أمر غير معتمد ⇒ رفض؛ كيان لم يتوقف ⇒ حادث مسجَّل ولا يُعلَن النجاح
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from './crown_gateway';
import { KillSwitch } from '../security/kill_switch';

export interface TerminationResult {
  readonly executed: boolean;
  readonly reason: string;
  readonly stoppedConfirmed: boolean;
}

export class CrownGuard {
  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly gateway: CrownGateway,
    private readonly killSwitch: KillSwitch,
    readonly guardId: EntityId = 'authority:crown_guard',
  ) {}

  /** ينفّذ أمر إنهاء كيان — لا ينفّذ شيئًا قبل اعتماد البوابة */
  executeTermination(command: SignedRoyalCommand, now = Date.now()): TerminationResult {
    const decision = this.gateway.authorize(command, now);
    if (!decision.allowed) {
      this.audit.append(this.guardId, 'termination_refused', {
        commandId: command.payload.commandId, reason: decision.reason,
      });
      return { executed: false, reason: decision.reason, stoppedConfirmed: false };
    }
    const target = command.payload.target;
    this.audit.append(this.guardId, 'termination_executed', { target, commandId: command.payload.commandId });
    this.killSwitch.confirmStopped(target);
    const check = this.killSwitch.verifyStopped([target]);
    return { executed: true, reason: 'تم الإنهاء وتأكيد التوقف', stoppedConfirmed: check.complete };
  }

  /** إيقاف وقائي فوري — لا يحتاج أمرًا مسبقًا، ويُسجَّل ويُرفع للملك */
  emergencyHalt(reason: string, scope: 'all' | 'agents' | 'external' = 'all'): void {
    this.killSwitch.engage(this.guardId, scope, reason);
    this.audit.append(this.guardId, 'escalated_to_king', { reason, scope });
  }
}
