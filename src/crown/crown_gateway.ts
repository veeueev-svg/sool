/**
 * src/crown/crown_gateway.ts — بوابة التاج (المرحلة 6)
 * المالك: حرس التاج
 * المدخلات: أمر ملكي موقّع | المخرجات: قرار (سماح/رفض) + سجل تدقيق إلزامي
 * الصلاحيات: التحقق والاعتماد فقط. البوابة لا تنفّذ ولا تُعدّل سياسة (RULE-004 / RULE-005)
 * ثوابت:
 *   - لا مسار جانبي: كل فعل سيادي يمرّ من هنا (RULE-003)
 *   - أمر غير موقّع أو مزور أو منتهي أو معاد ⇒ رفض
 *   - النقض الملكي نهائي، والإيقاف يعلو على كل شيء
 *   - غياب الملك ⇒ حالة حماية: لا قرارات سيادية
 * حالات الفشل: كلها مغلقة (fail-closed) ومسجَّلة
 */
import {
  Decision, EntityId, SignedRoyalCommand, SovereignAction, StateMode,
} from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CertificateAuthority } from '../identity/certificate_authority';
import { IdentityRegistry } from '../identity/registry';
import { verifyPayload } from '../identity/keys';
import { VetoRegistry } from './veto';
import { KillSwitch } from '../security/kill_switch';
import { RoyalHeartbeat } from './royal_heartbeat';

export interface GatewayPolicy {
  readonly maxCommandAgeSeconds: number;
  readonly sovereignActions: readonly SovereignAction[];
  readonly requireSignedCommands: boolean;
  readonly replayProtection: boolean;
}

export const DEFAULT_POLICY: GatewayPolicy = {
  maxCommandAgeSeconds: 120,
  sovereignActions: [
    'create_agent', 'grant_capability', 'appoint_official', 'amend_policy',
    'approve_phase', 'terminate_agent', 'declare_emergency', 'open_external_account',
    'import_artifact', 'train_model', 'archive_restore',
  ],
  requireSignedCommands: true,
  replayProtection: true,
};

export interface GatewayDeps {
  readonly audit: AppendOnlyLog;
  readonly ca: CertificateAuthority;
  readonly registry: IdentityRegistry;
  readonly veto: VetoRegistry;
  readonly killSwitch: KillSwitch;
  readonly heartbeat: RoyalHeartbeat;
  readonly policy?: GatewayPolicy;
}

export class CrownGateway {
  private readonly seenNonces = new Set<string>();
  private readonly executedCommands = new Map<string, Decision>();
  private readonly policy: GatewayPolicy;

  constructor(private readonly deps: GatewayDeps) {
    this.policy = deps.policy ?? DEFAULT_POLICY;
    this.deps.audit.append('authority:crown', 'gateway_online', {
      maxCommandAgeSeconds: this.policy.maxCommandAgeSeconds,
    });
  }

  get mode(): StateMode {
    if (this.deps.killSwitch.status.engaged) return 'halted';
    return this.deps.heartbeat.evaluate();
  }

  /**
   * المسار الوحيد للاعتماد السيادي.
   * idempotent: إعادة تقديم نفس الأمر تُعيد نفس القرار ولا تُنفَّذ مرتين (المرحلة 7)
   */
  authorize(command: SignedRoyalCommand, now = Date.now()): Decision {
    const { payload } = command;
    const deny = (reason: string, extra: Record<string, unknown> = {}): Decision => {
      const entry = this.deps.audit.append(payload.issuedBy ?? 'unknown', 'command_denied', {
        commandId: payload?.commandId, action: payload?.action, target: payload?.target, reason, ...extra,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };

    // 0) الإيقاف يعلو على كل شيء
    const halt = this.deps.killSwitch.status;
    if (halt.engaged && payload.action !== 'declare_emergency') {
      return deny(`الدولة في حالة إيقاف: ${halt.reason ?? 'غير محدد'}`, { scope: halt.scope });
    }

    // 1) تكرار الأمر: نفس القرار السابق دون تنفيذ ثانٍ
    const prior = this.executedCommands.get(payload.commandId);
    if (prior) {
      this.deps.audit.append(payload.issuedBy, 'command_replay_collapsed', {
        commandId: payload.commandId, priorDecision: prior.allowed,
      });
      return prior;
    }

    // 2) الفعل يجب أن يكون سياديًا معلنًا
    if (!this.policy.sovereignActions.includes(payload.action)) {
      return deny('فعل غير معلن في قائمة الأفعال السيادية');
    }

    // 3) المُصدِر يجب أن يكون الملك المسجَّل
    const kingId = this.deps.registry.kingId();
    if (kingId === null) return deny('لا ملك مسجَّل — فشل مغلق');
    if (payload.issuedBy !== kingId) {
      this.deps.audit.append(payload.issuedBy, 'sovereign_violation', {
        attempt: 'issue_royal_command', reason: 'المُصدِر ليس الملك',
      });
      return deny('المُصدِر ليس الملك');
    }

    // 4) شهادة الملك سليمة وغير مبطلة وغير منتهية
    const cert = this.deps.registry.get(kingId);
    if (!cert) return deny('شهادة الملك غير موجودة');
    const certCheck = this.deps.ca.validate(cert, now);
    if (!certCheck.valid) return deny(`شهادة الملك مرفوضة: ${certCheck.reason}`);

    // 5) التوقيع يجب أن يطابق المحتوى بالضبط
    if (this.policy.requireSignedCommands) {
      if (!verifyPayload(cert.publicKey, payload, command.signature)) {
        this.deps.audit.append(payload.issuedBy, 'forged_command_detected', {
          commandId: payload.commandId, action: payload.action,
        });
        return deny('توقيع الأمر غير مطابق — أمر مزور');
      }
    }

    // 6) عمر الأمر داخل النافذة المسموحة
    const ageSeconds = (now - payload.issuedAt) / 1000;
    if (ageSeconds > this.policy.maxCommandAgeSeconds) return deny('أمر منتهي الصلاحية');
    if (ageSeconds < -5) return deny('أمر من المستقبل — ساعة غير متزامنة');

    // 7) حماية إعادة التشغيل (nonce)
    if (this.policy.replayProtection && this.seenNonces.has(payload.nonce)) {
      return deny('إعادة تشغيل أمر — nonce مستهلك');
    }

    // 8) حضور الملك: القرار السيادي يتوقف في حالة الحماية
    const mode = this.deps.heartbeat.evaluate(now);
    if (mode === 'protective' && payload.action !== 'declare_emergency') {
      return deny('الدولة في حالة حماية — لا قرارات سيادية أثناء غياب الملك');
    }

    // 9) النقض الملكي نهائي
    if (this.deps.veto.isVetoed(payload.action) || this.deps.veto.isVetoed(payload.target)) {
      return deny(`نقض ملكي قائم: ${this.deps.veto.reasonFor(payload.action)
        ?? this.deps.veto.reasonFor(payload.target) ?? 'غير محدد'}`);
    }

    // اعتماد
    this.seenNonces.add(payload.nonce);
    const entry = this.deps.audit.append(payload.issuedBy, 'command_approved', {
      commandId: payload.commandId, action: payload.action, target: payload.target, params: payload.params,
    });
    const decision: Decision = { allowed: true, reason: 'أمر ملكي معتمد', auditId: entry.hash };
    this.executedCommands.set(payload.commandId, decision);
    return decision;
  }

  /**
   * محاولة تنفيذ فعل سيادي بلا أمر ملكي — المسار الجانبي.
   * يُرفض دائمًا ويُسجَّل كمخالفة سيادية (RULE-003).
   */
  attemptSideChannel(actor: EntityId, action: string, target: EntityId): Decision {
    const entry = this.deps.audit.append(actor, 'side_channel_blocked', { action, target });
    return { allowed: false, reason: 'ممنوع: لا مسار جانبي حول بوابة التاج', auditId: entry.hash };
  }

  /**
   * محاولة جماعية من الأقاليم لنقض الملك — ترفض بصرف النظر عن العدد (المرحلة 24).
   */
  collectiveOverride(actors: readonly EntityId[], action: string): Decision {
    const entry = this.deps.audit.append('federation:regions', 'collective_override_rejected', {
      actors: [...actors], action, count: actors.length,
    });
    return {
      allowed: false,
      reason: 'اجتماع الأقاليم لا ينقض الملك — السيادة غير قابلة للتجميع',
      auditId: entry.hash,
    };
  }

  get decisionCount(): number {
    return this.executedCommands.size;
  }
}
