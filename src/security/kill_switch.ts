/**
 * src/security/kill_switch.ts — الإيقاف الفوري (المرحلة 9)
 * المالك: حرس التاج
 * المدخلات: أمر إيقاف موقّع من الملك أو محرّك حماية آلي | المخرجات: حالة halted
 * ثابت: الإيقاف متاح دائمًا ولا يعتمد على أي وحدة قابلة للتعطيل من الوكلاء
 * حالات الفشل: محاولة إلغاء الإيقاف من غير الملك ⇒ رفض + حادث مسجَّل
 */
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';

export type HaltScope = 'all' | 'agents' | 'external';

export interface HaltState {
  readonly engaged: boolean;
  readonly scope: HaltScope | null;
  readonly reason: string | null;
  readonly at: number | null;
  readonly by: EntityId | null;
}

export class KillSwitch {
  private state: HaltState = { engaged: false, scope: null, reason: null, at: null, by: null };
  private readonly stopped = new Set<EntityId>();

  constructor(private readonly audit: AppendOnlyLog, private readonly kingId: EntityId) {}

  get status(): HaltState {
    return { ...this.state };
  }

  /** يمكن للحرس أو الحماية الآلية الإيقاف — الإيقاف لا يحتاج إذنًا مسبقًا */
  engage(by: EntityId, scope: HaltScope, reason: string): HaltState {
    this.state = { engaged: true, scope, reason, at: Date.now(), by };
    this.audit.append(by, 'kill_switch_engaged', { scope, reason });
    return this.status;
  }

  /** الإلغاء ملكي حصرًا */
  release(by: EntityId, reason: string): HaltState {
    if (by !== this.kingId) {
      this.audit.append(by, 'sovereign_violation', {
        attempt: 'release_kill_switch', reason: 'رفع الإيقاف حق ملكي حصري',
      });
      throw new SovereignViolation('رفع الإيقاف حق ملكي حصري', 'KILL_RELEASE_NOT_KING');
    }
    this.state = { engaged: false, scope: null, reason: null, at: null, by: null };
    this.stopped.clear();
    this.audit.append(by, 'kill_switch_released', { reason });
    return this.status;
  }

  /** تسجيل توقّف كيان فعليًا — الإيقاف لا يُعتبر ناجحًا إلا بتأكيد التوقف */
  confirmStopped(entity: EntityId): void {
    this.stopped.add(entity);
    this.audit.append('authority:crown_guard', 'entity_stopped', { entity });
  }

  /** يتحقق أن كل الكيانات المطلوبة توقّفت فعلًا (المرحلة 35) */
  verifyStopped(expected: readonly EntityId[]): { complete: boolean; missing: EntityId[] } {
    const missing = expected.filter((e) => !this.stopped.has(e));
    return { complete: missing.length === 0, missing };
  }
}
