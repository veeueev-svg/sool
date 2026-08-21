/**
 * src/crown/royal_heartbeat.ts — نبض الملك وحالة الغياب (المرحلتان 8 و9)
 * المالك: حرس التاج
 * المدخلات: نبضات موقّتة من الملك | المخرجات: وضع الدولة (normal / protective)
 * ثابت RULE-007: انقطاع النبض ⇒ حالة حماية، لا تخمين ولا استمرار في القرارات السيادية
 * حالات الفشل: نبض من غير الملك ⇒ يُرفض ويُسجَّل
 */
import { EntityId, SovereignViolation, StateMode } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';

export class RoyalHeartbeat {
  private lastBeat: number;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly kingId: EntityId,
    private readonly graceMs: number,
    now = Date.now(),
  ) {
    this.lastBeat = now;
    this.audit.append(kingId, 'heartbeat_initialized', { graceMs });
  }

  beat(actor: EntityId, now = Date.now()): void {
    if (actor !== this.kingId) {
      this.audit.append(actor, 'sovereign_violation', {
        attempt: 'royal_heartbeat', reason: 'النبض الملكي لا يُنتحل',
      });
      throw new SovereignViolation('النبض الملكي لا يُنتحل', 'HEARTBEAT_IMPERSONATION');
    }
    this.lastBeat = now;
  }

  isPresent(now = Date.now()): boolean {
    return now - this.lastBeat <= this.graceMs;
  }

  /** الوضع المشتق من حضور الملك — يُستدعى في كل قرار سيادي */
  mode(now = Date.now()): StateMode {
    return this.isPresent(now) ? 'normal' : 'protective';
  }

  /** تسجيل الدخول في حالة الحماية مرة واحدة لكل انقطاع */
  private declared = false;

  evaluate(now = Date.now()): StateMode {
    const mode = this.mode(now);
    if (mode === 'protective' && !this.declared) {
      this.declared = true;
      this.audit.append('authority:crown_guard', 'protective_mode_entered', {
        lastBeat: this.lastBeat, graceMs: this.graceMs,
      });
    }
    if (mode === 'normal' && this.declared) {
      this.declared = false;
      this.audit.append('authority:crown_guard', 'protective_mode_exited', { lastBeat: this.lastBeat });
    }
    return mode;
  }

  get lastBeatAt(): number {
    return this.lastBeat;
  }
}
