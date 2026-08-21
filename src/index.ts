/**
 * src/index.ts — تشكيل الدولة (bootstrap)
 * المالك: القيّم على المستودع | المراحل: 1–12
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/*.yaml | المخرجات: كائن دولة جاهز بترتيب اعتماد صحيح
 * ثابت RULE-002: لا يُنشأ وكيل واسع الصلاحيات قبل اكتمال:
 *   جذر الثقة ← بوابة التاج ← السجل ← المراقبة ← الإيقاف ← الموارد
 */
import { loadQuotas, loadRoyalAuthority, resolveConfigDir, QuotasConfig, RoyalAuthorityConfig } from './kernel/config';
import { ResourceRegistry } from './kernel/resource_registry';
import { AppendOnlyLog } from './audit/append_only_log';
import { AuditStore } from './audit/store';
import { CertificateAuthority } from './identity/certificate_authority';
import { IdentityRegistry } from './identity/registry';
import { KingIdentity } from './identity/king_identity';
import { VetoRegistry } from './crown/veto';
import { KillSwitch } from './security/kill_switch';
import { RoyalHeartbeat } from './crown/royal_heartbeat';
import { KingMonitor } from './crown/king_monitor';
import { CrownGateway, DEFAULT_POLICY } from './crown/crown_gateway';
import { CrownGuard } from './crown/guardians';
import { CommandChannel } from './crown/command_channel';
import { TerminationOrder, EntityController } from './crown/termination_order';
import { NetworkEgressGuard } from './external/network_egress';
import { ToolRegistry } from './agents/tools';
import { StateMode } from './kernel/types';

export interface DigitalState {
  readonly config: RoyalAuthorityConfig;
  readonly quotas: QuotasConfig;
  readonly audit: AppendOnlyLog;
  readonly ca: CertificateAuthority;
  readonly registry: IdentityRegistry;
  readonly king: KingIdentity;
  readonly veto: VetoRegistry;
  readonly killSwitch: KillSwitch;
  readonly heartbeat: RoyalHeartbeat;
  readonly monitor: KingMonitor;
  readonly resources: ResourceRegistry;
  readonly gateway: CrownGateway;
  readonly guard: CrownGuard;
  readonly egress: NetworkEgressGuard;
  readonly tools: ToolRegistry;
  readonly mode: () => StateMode;
}

export interface BootstrapOptions {
  readonly configDir?: string;
  readonly now?: number;
  /** مسار حفظ سجل التدقيق على القرص (المرحلة 32) — إن غاب، تبقى الحالة في الذاكرة */
  readonly auditPath?: string;
  /** مؤقّت المراقبة بالمللي ثانية — لا يبدأ تلقائيًا إلا عند طلبه */
  readonly monitorTickMs?: number;
  readonly startMonitor?: boolean;
}

export function bootstrapState(options: BootstrapOptions = {}): DigitalState {
  const configDir = options.configDir ?? resolveConfigDir();
  const now = options.now ?? Date.now();

  // 1) السجل أولًا: لا خطوة تأسيس بلا تدقيق
  const audit = new AppendOnlyLog();
  const config = loadRoyalAuthority(configDir);
  const quotas = loadQuotas(configDir);
  audit.append('authority:bootstrap', 'config_loaded', {
    state: config.state_name, code: config.state_code, resources: Object.keys(quotas.resources).length,
  });

  // 2) جذر الثقة ثم هوية الملك
  const ca = new CertificateAuthority(audit);
  const registry = new IdentityRegistry(audit);
  const king = new KingIdentity(config.king_id, ca, registry);

  // 3) الحماية: النقض، الإيقاف، النبض، المراقبة
  const veto = new VetoRegistry(audit, king.kingId);
  const killSwitch = new KillSwitch(audit, king.kingId);
  const heartbeat = new RoyalHeartbeat(audit, king.kingId, config.absence_grace_seconds * 1000, now);
  const monitor = new KingMonitor(audit, heartbeat, {
    tickMs: options.monitorTickMs ?? Math.max(1000, config.heartbeat_interval_seconds * 1000),
    maxAbsenceMs: config.absence_grace_seconds * 1000 * 4,
    killSwitch,
  });

  // 4) الموارد والحصص قبل أي تشغيل (RULE-002: لا وكيل بلا حصة)
  const resources = new ResourceRegistry(audit, quotas.resources);

  // 5) البوابة أخيرًا — لأنها تعتمد على كل ما سبق
  const gateway = new CrownGateway({
    audit, ca, registry, veto, killSwitch, heartbeat,
    policy: { ...DEFAULT_POLICY, maxCommandAgeSeconds: 120 },
  });
  const guard = new CrownGuard(audit, gateway, killSwitch);

  // 6) العزل والخروج الشبكي والأدوات (المرحلتان 11 و12) — بعد البوابة لأن الإذن يمرّ بها
  const egress = new NetworkEgressGuard(audit, gateway, killSwitch, { resources });
  const tools = new ToolRegistry({ audit, resources, killSwitch, egress });

  if (options.startMonitor) monitor.start();
  if (options.auditPath) new AuditStore(options.auditPath).save(audit, now);

  audit.append('authority:bootstrap', 'state_online', { phase: 12, mode: 'normal' });

  return {
    config, quotas, audit, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    resources, gateway, guard, egress, tools,
    mode: () => gateway.mode,
  };
}

export * from './kernel/types';
export { AuditStore } from './audit/store';
export { CommandChannel } from './crown/command_channel';
export { TerminationOrder } from './crown/termination_order';
export type { EntityController } from './crown/termination_order';
export { KingMonitor } from './crown/king_monitor';
export { ResourceRegistry } from './kernel/resource_registry';
export { NetworkEgressGuard } from './external/network_egress';
export type { EgressAllowance, EgressRequest, EgressReport } from './external/network_egress';
export { Sandbox, normalizePath } from './security/sandbox';
export type { SandboxSpec, SandboxContext, SandboxRun, SandboxFs } from './security/sandbox';
export { ToolRegistry } from './agents/tools';
export type { ToolSpec, ToolResult, ToolArgs } from './agents/tools';
