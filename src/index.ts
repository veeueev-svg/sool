/**
 * src/index.ts — تشكيل الدولة (bootstrap)
 * المالك: القيّم على المستودع | المراحل: 1–10
 * المدخلات: config/royal-authority.yaml | المخرجات: كائن دولة جاهز بترتيب اعتماد صحيح
 * ثابت RULE-002: لا يُنشأ وكيل واسع الصلاحيات قبل اكتمال:
 *   جذر الثقة ← بوابة التاج ← السجل ← المراقبة ← الإيقاف
 */
import { loadRoyalAuthority, resolveConfigDir, RoyalAuthorityConfig } from './kernel/config';
import { AppendOnlyLog } from './audit/append_only_log';
import { CertificateAuthority } from './identity/certificate_authority';
import { IdentityRegistry } from './identity/registry';
import { KingIdentity } from './identity/king_identity';
import { VetoRegistry } from './crown/veto';
import { KillSwitch } from './security/kill_switch';
import { RoyalHeartbeat } from './crown/royal_heartbeat';
import { CrownGateway, DEFAULT_POLICY } from './crown/crown_gateway';
import { CrownGuard } from './crown/guardians';
import { StateMode } from './kernel/types';

export interface DigitalState {
  readonly config: RoyalAuthorityConfig;
  readonly audit: AppendOnlyLog;
  readonly ca: CertificateAuthority;
  readonly registry: IdentityRegistry;
  readonly king: KingIdentity;
  readonly veto: VetoRegistry;
  readonly killSwitch: KillSwitch;
  readonly heartbeat: RoyalHeartbeat;
  readonly gateway: CrownGateway;
  readonly guard: CrownGuard;
  readonly mode: () => StateMode;
}

export function bootstrapState(configDir = resolveConfigDir(), now = Date.now()): DigitalState {
  // 1) السجل أولًا: لا خطوة تأسيس بلا تدقيق
  const audit = new AppendOnlyLog();
  const config = loadRoyalAuthority(configDir);
  audit.append('authority:bootstrap', 'config_loaded', {
    state: config.state_name, code: config.state_code,
  });

  // 2) جذر الثقة ثم هوية الملك
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  const king = new KingIdentity(config.king_id, ca, registry);

  // 3) الحماية: النقض، الإيقاف، النبض
  const veto = new VetoRegistry(audit, king.kingId);
  const killSwitch = new KillSwitch(audit, king.kingId);
  const heartbeat = new RoyalHeartbeat(audit, king.kingId, config.absence_grace_seconds * 1000, now);

  // 4) البوابة أخيرًا — لأنها تعتمد على كل ما سبق
  const gateway = new CrownGateway({
    audit, ca, registry, veto, killSwitch, heartbeat,
    policy: { ...DEFAULT_POLICY, maxCommandAgeSeconds: 120 },
  });
  const guard = new CrownGuard(audit, gateway, killSwitch);

  audit.append('authority:bootstrap', 'state_online', { phase: 10, mode: 'normal' });

  return {
    config, audit, ca, registry, king, veto, killSwitch, heartbeat, gateway, guard,
    mode: () => gateway.mode,
  };
}

export * from './kernel/types';
