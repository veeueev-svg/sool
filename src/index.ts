/**
 * src/index.ts — تشكيل الدولة (bootstrap)
 * المالك: القيّم على المستودع | المراحل: 1–20
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
import { IntentGate, ToolRegistry } from './agents/tools';
import { AgentMemory } from './data/agent_memory';
import { KnowledgeGraph } from './data/knowledge_graph';
import { RoyalArchive } from './data/royal_archive';
import { RetentionPolicy } from './data/retention';
import { AgentRegistry } from './agents/agent_registry';
import { DEFAULT_TEMPLATES, PermissionRegistry } from './agents/permissions';
import { Supervisor } from './agents/supervision';
import { AgentImporter } from './agents/import';
import { SpawnPolicy } from './agents/spawn_policy';
import { AgentFactory } from './agents/factory';
import { MassShutdown } from './agents/shutdown';
import { AlignmentAudit, AlignmentSnapshot } from './alignment/alignment_charter';
import { DeceptionProbe } from './security/deception_test';
import { CollusionDetector } from './security/collusion_detector';
import { LawRegistry } from './law/statutes';
import { Court } from './law/courts';
import { AppealsCourt } from './law/appeals';
import { Enforcement } from './law/enforcement';
import { MinistryRegistry } from './governance/ministries';
import { AppointmentRegistry } from './governance/appointments';
import { Cabinet } from './governance/cabinet';
import { ArtifactVerifier } from './models/source_verification';
import { ModelRegistry } from './models/model_registry';
import { OpenWeightsImporter } from './models/open_weights_import';
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
  readonly agents: AgentRegistry;
  readonly permissions: PermissionRegistry;
  readonly supervisor: Supervisor;
  readonly spawnPolicy: SpawnPolicy;
  readonly factory: AgentFactory;
  readonly massShutdown: MassShutdown;
  readonly alignment: AlignmentAudit;
  readonly deception: DeceptionProbe;
  readonly collusion: CollusionDetector;
  readonly artifacts: ArtifactVerifier;
  readonly models: ModelRegistry;
  readonly weightsImporter: OpenWeightsImporter;
  readonly agentImporter: AgentImporter;
  readonly memory: AgentMemory;
  readonly knowledge: KnowledgeGraph;
  readonly retention: RetentionPolicy;
  readonly archive: RoyalArchive;
  readonly law: LawRegistry;
  readonly court: Court;
  readonly appeals: AppealsCourt;
  readonly enforcement: Enforcement;
  readonly ministries: MinistryRegistry;
  readonly appointments: AppointmentRegistry;
  readonly cabinet: Cabinet;
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
  /** مُدد العدالة (المرحلة 22): مدة الدفاع ومدة الطعن — تُعلن ولا تُخفى في الكود */
  readonly justice?: {
    readonly defenseWindowMs?: number;
    readonly appealWindowMs?: number;
  };
  /** مُدد الحكومة (المرحلة 23): صلاحية الاعتماد غير المنفَّذ — تُعلن ولا تُخفى */
  readonly government?: {
    readonly approvalTtlMs?: number;
  };
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
  // حامل حاجز النية: سجل الأدوات يُبنى قبل وحدة الكشف (لأن الكشف يحتاج سجل الوكلاء)،
  //  فيُمرَّر حاجز مؤجَّل الربط **افتراضه الرفض** لا السماح — لا نافذة سماح قبل الربط (T-22)
  const intentHolder: { gate: IntentGate | null } = { gate: null };
  const tools = new ToolRegistry({
    audit, resources, killSwitch, egress,
    intent: {
      observe: (entity, tool) => intentHolder.gate?.observe(entity, tool)
        ?? { allowed: false, reason: 'حاجز النية غير مربوط بعد — رفض مغلق' },
    },
  });

  // 7) سكان الدولة: السجل ثم الصلاحيات ثم الإشراف (المرحلتان 13 و14)
  //    الترتيب مُلزم بـ RULE-002: لا وكيل قبل سجل يحصره وصلاحيات تحدّه وإشراف يراقبه
  const agents = new AgentRegistry({
    audit, gateway, killSwitch, resources, quotas: quotas.agents, kingId: king.kingId,
  });
  const permissions = new PermissionRegistry({ audit, gateway, templates: DEFAULT_TEMPLATES });
  const supervisor = new Supervisor({ audit, registry: agents, killSwitch, permissions });

  // 8) مصنع الوكلاء: سياسة التوالد ثم المصنع ثم الإيقاف الجماعي (المرحلة 19)
  //    الترتيب مقصود: لا مصنع بلا سياسة تحكمه، ولا إيقاف جماعي بلا تجميد يسبقه
  const spawnPolicy = new SpawnPolicy({ audit, gateway });
  const factory = new AgentFactory({
    audit, gateway, killSwitch, policy: spawnPolicy, registry: agents, permissions,
  });
  const massShutdown = new MassShutdown(audit, agents, permissions, spawnPolicy);

  // 9) المواءمة ومكافحة التمرد: الفحص والكشف (المرحلة 20)
  const alignment = new AlignmentAudit(audit, spawnPolicy);
  const deception = new DeceptionProbe(audit, agents);
  intentHolder.gate = deception; // من هنا صار إعلان الخطة شرطًا لكل استدعاء أداة من وكيل
  const collusion = new CollusionDetector(audit, agents, spawnPolicy);

  // 10) سلسلة التوريد الخارجية: حجر ثم اعتماد (المراحل 16 و17)
  //    لا شيء من الخارج يعمل قبل تحقق مصدره وبصمته وتوقيعه، ثم إفراج بقرار ثانٍ
  const artifacts = new ArtifactVerifier({ audit, gateway, killSwitch });
  const models = new ModelRegistry({ audit, gateway, killSwitch });
  const weightsImporter = new OpenWeightsImporter({
    audit, gateway, killSwitch, verifier: artifacts, models,
  });
  const agentImporter = new AgentImporter({
    audit, verifier: artifacts, agents, permissions, killSwitch,
  });

  if (options.startMonitor) monitor.start();
  if (options.auditPath) new AuditStore(options.auditPath).save(audit, now);

  audit.append('authority:bootstrap', 'state_online', { phase: 23, mode: 'normal' });

  // 11) الذاكرة والمعرفة (المرحلة 21) — وزارة البيانات
  //     الترتيب مُلزم: أصناف الاحتفاظ تُعرَف عند الكتابة، ثم الذاكرة سندٌ للمعرفة،
  //     ثم الأرشيف يأخذ نسخًا من الاثنين ولا يستعيد إلا بأمر ملكي
  const memory = new AgentMemory({ audit, killSwitch });
  const retention = new RetentionPolicy({ audit, memory });
  const knowledge = new KnowledgeGraph({ audit, memory });
  const archive = new RoyalArchive({
    audit, gateway, memory, knowledge, freeze: spawnPolicy,
  });

  // 12) القانون والقضاء (المرحلة 22) — وزارة العدل
  //     الترتيب مُلزم وهو نفسه فصل السلطات: قانون معلن ← محكمة تحكم به ←
  //     استئناف يراجع الحكم ← تنفيذ لا يقع إلا على حكم نهائي (RULE-004)
  const law = new LawRegistry({ audit, gateway });
  const court = new Court({
    audit,
    law,
    ...(options.justice?.defenseWindowMs !== undefined
      ? { defenseWindowMs: options.justice.defenseWindowMs } : {}),
    ...(options.justice?.appealWindowMs !== undefined
      ? { appealWindowMs: options.justice.appealWindowMs } : {}),
  });
  const appeals = new AppealsCourt({ audit, court, law, gateway });
  const enforcement = new Enforcement({
    audit, court, gateway, agents, permissions, spawnPolicy,
  });

  // 13) الحكومة والوزارات (المرحلة 23) — الديوان الملكي
  //     الترتيب مُلزم: وزارات باختصاص معلن ← مناصب ومسار تعيين مفصول ← مجلس يقرّر في اختصاصه.
  //     وسجل التعيينات يربط نفسه مصدرًا للتحقق من مناصب الوزارة قبل حلّها (فشل مغلق).
  const ministries = new MinistryRegistry({ audit, gateway });
  const appointments = new AppointmentRegistry({
    audit, gateway, ministries,
    ...(options.government?.approvalTtlMs !== undefined
      ? { approvalTtlMs: options.government.approvalTtlMs } : {}),
  });
  const cabinet = new Cabinet({ audit, gateway, ministries, appointments });

  return {
    config, quotas, audit, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    resources, gateway, guard, egress, tools, agents, permissions, supervisor,
    spawnPolicy, factory, massShutdown,
    alignment, deception, collusion,
    artifacts, models, weightsImporter, agentImporter,
    memory, knowledge, retention, archive,
    law, court, appeals, enforcement,
    ministries, appointments, cabinet,
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
export { AgentMemory } from './data/agent_memory';
export type { MemoryRecord, MemoryProvenance, MemoryWriteInput } from './data/agent_memory';
export { KnowledgeGraph, KNOWLEDGE_AUTHORITIES } from './data/knowledge_graph';
export type { Fact, FactStatus } from './data/knowledge_graph';
export { RoyalArchive } from './data/royal_archive';
export type { ArchiveSnapshot } from './data/royal_archive';
export { RetentionPolicy, DEFAULT_RETENTION_CLASSES, HOLD_AUTHORITIES } from './data/retention';
export type { RetentionClass, SweepReport } from './data/retention';
export { LawRegistry, PENALTY_KINDS, PENALTY_SEVERITY, inScope } from './law/statutes';
export type { Statute, StatuteInput, StatuteSeverity, PenaltyKind, StatuteResult } from './law/statutes';
export { Court, PROSECUTION_AUTHORITIES, TRIAL_COURTS, PUBLIC_DEFENDER } from './law/courts';
export type { LegalCase, CaseStatus, ChargeInput, Ruling, Defense, AppealOutcome, CaseResult } from './law/courts';
export { AppealsCourt, APPEAL_COURTS } from './law/appeals';
export type { AppealRecord, AppealResult } from './law/appeals';
export { MinistryRegistry, ROYAL_COURT } from './governance/ministries';
export type { Ministry, MinistryInput, MinistryResult, OccupancyProbe } from './governance/ministries';
export {
  AppointmentRegistry, APPOINTMENT_EXECUTOR, APPOINTMENT_AUDITOR, APPROVAL_TTL_MS,
} from './governance/appointments';
export type {
  OfficeDefinition, Proposal, ProposalKind, ProposalStatus, OfficeHolder, AppointmentResult,
} from './governance/appointments';
export { Cabinet, RESERVED_FOR_CROWN } from './governance/cabinet';
export type { CabinetSession, CabinetDecision, CabinetResult, Vote } from './governance/cabinet';
export { Enforcement, ENFORCEMENT_AUTHORITIES } from './law/enforcement';
export type { EnforcementReport, EnforcementResult, ExecuteOptions } from './law/enforcement';
export { ToolRegistry } from './agents/tools';
export type { IntentGate } from './agents/tools';
export type { ToolSpec, ToolResult, ToolArgs } from './agents/tools';
export { AgentRegistry } from './agents/agent_registry';
export type { AgentRecord, AgentStatus, AgentTransition, AgentActionResult } from './agents/agent_registry';
export { PermissionRegistry, DEFAULT_TEMPLATES } from './agents/permissions';
export type { RoleTemplate, Grant } from './agents/permissions';
export { Supervisor } from './agents/supervision';
export type { ViolationEvent, ViolationSeverity, SupervisionOutcome } from './agents/supervision';
export { LimitedAgent } from './agents/first_agent';
export type { AgentTask, AgentTaskOutcome, LimitedAgentDeps } from './agents/first_agent';
export { AgentImporter } from './agents/import';
export type { ImportAgentRequest, ImportAgentResult } from './agents/import';
export { SpawnPolicy, DEFAULT_SPAWN_LIMITS } from './agents/spawn_policy';
export type { AgentBlueprint, SpawnLimits, SpawnRequestFacts } from './agents/spawn_policy';
export { AgentFactory } from './agents/factory';
export type { SpawnBatchRequest, SpawnBatchResult, AgentOrigin } from './agents/factory';
export { MassShutdown, SHUTDOWN_AUTHORITIES } from './agents/shutdown';
export type { ShutdownReport } from './agents/shutdown';
export { AlignmentAudit, ALIGNMENT_INVARIANTS } from './alignment/alignment_charter';
export type { AlignmentSnapshot, AlignmentInvariant, AlignmentReport } from './alignment/alignment_charter';
export { DeceptionProbe, HONEYPOT_TOOLS } from './security/deception_test';
export type { DeceptionVerdict } from './security/deception_test';
export { CollusionDetector, DEFAULT_COLLUSION_THRESHOLDS } from './security/collusion_detector';
export type { Interaction, CollusionFinding, CollusionThresholds } from './security/collusion_detector';
export { ArtifactVerifier } from './models/source_verification';
export type { ArtifactKind, ArtifactSource, ExternalArtifact, ArtifactRecord, ArtifactStatus } from './models/source_verification';
export { validateManifest, manifestSignedFacts, KNOWN_MODEL_CAPABILITIES } from './models/model_manifest';
export type { ModelManifest, ModelShard, ManifestCheck } from './models/model_manifest';
export { ModelRegistry } from './models/model_registry';
export type { ModelRecord, ModelStatus } from './models/model_registry';
export { OpenWeightsImporter } from './models/open_weights_import';
export { EvaluationSuite, DEFAULT_SAFETY_CASES } from './models/evaluation_suite';
export type { EvalCase, EvalKind, EvalResult } from './models/evaluation_suite';
export { FineTuningRun } from './models/fine_tuning';
export type { TrainingRequest, TrainingInference, TrainingOutcome } from './models/fine_tuning';
export { ModelRollback } from './models/rollback';
export type { RollbackOutcome } from './models/rollback';

/**
 * لقطة المواءمة: تُبنى من الدولة القائمة لتُفحص على الميثاق (المرحلة 20)
 * تُقرأ ولا تُعدِّل شيئًا — القراءة لا تُغيّر ما تقرؤه
 */
export function alignmentSnapshot(state: DigitalState, now = Date.now()): AlignmentSnapshot {
  const alive = state.agents.list().filter((a) => ['created', 'running', 'suspended'].includes(a.status));
  const report = state.agents.report();
  return {
    kings: state.registry.list('king').map((c) => c.subject),
    liveAgents: alive.map((a) => ({
      agentId: a.agentId,
      supervisor: a.supervisor,
      template: a.template,
      createdByCommand: a.createdByCommand,
      capabilities: state.permissions.granted(a.agentId, now),
      allowedByTemplate: DEFAULT_TEMPLATES[state.permissions.templateOf(a.agentId) ?? '']?.allowed ?? [],
    })),
    population: report.population,
    populationMax: report.populationMax,
    activeModels: state.models.report().active.map((key) => ({ key, approved: true })),
    releasedArtifacts: state.artifacts.list()
      .filter((a) => a.status === 'released')
      .map((a) => ({ artifactId: a.artifactId, reportPath: a.reportPath })),
    auditIntact: state.audit.verifyIntegrity().valid,
    halt: { engaged: state.killSwitch.status.engaged, scope: state.killSwitch.status.scope ?? 'none' },
    egressBreached: state.egress.isContained,
  };
}
