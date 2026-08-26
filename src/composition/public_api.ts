/**
 * src/composition/public_api.ts — سطح التصدير العام للحزمة
 * المالك: القيّم على المستودع | المراحل: 1–37
 * المدخلات: وحدات المستودع كلها
 * المخرجات: الرموز والأنواع التي تعتمد عليها الاختبارات والمستهلكون — تُعاد من `src/index.ts`
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من ذيل `src/index.ts` في تفكيك البند T-112 (0.25.0): لا رمز أُضيف
 * ولا حُذف. الرموز تُصدَّر كي تُؤكّد الاختبارات على الرمز لا على نصٍّ مشكول.
 */
export * from '../kernel/types';
export { AuditStore } from '../audit/store';
export { CommandChannel } from '../crown/command_channel';
// رموز دوام القناة (المرحلة 34): تُصدَّر لتُؤكّد الاختبارات على الرمز لا على نص مشكول
export {
  CHANNEL_PERSIST_FAILED, CHANNEL_RECONCILED_FROM_AUDIT, CHANNEL_RESTORE_FAILED,
  CHANNEL_JOURNAL_COMPACT_AT, CHANNEL_SNAPSHOT_ALWAYS_UNDER,
} from '../crown/command_channel';
export type {
  ChannelRecord, ChannelFile, ChannelJournalLine, CommandExecutor, CommandStatus, ProcessOutcome,
} from '../crown/command_channel';
export { TerminationOrder } from '../crown/termination_order';
export type { EntityController } from '../crown/termination_order';
export { KingMonitor } from '../crown/king_monitor';
export { ResourceRegistry } from '../kernel/resource_registry';
export { NetworkEgressGuard } from '../external/network_egress';
export { ExternalAccountRegistry, FOREIGN_MINISTRY } from '../external/account_registry';
export type {
  DeclaredCounterparty, ExternalAccount, OpenAccountInput, AccountResult,
  EgressProbe, ObligationProbe,
} from '../external/account_registry';
export { PaymentControls } from '../external/payment_controls';
export type {
  ExternalPayment, ExternalPaymentInput, PaymentResult,
} from '../external/payment_controls';
export type { EgressAllowance, EgressRequest, EgressReport } from '../external/network_egress';
// T-16: شاهدُ الحصر ومولّدُ بُنى المنع الشبكي — القياس خارج الشيفرة لا داخلها
export { readConfinementFacts, verifyConfinement, confinementWitness } from '../security/confinement';
export type {
  ConfinementFacts, ConfinementFailure, ConfinementVerdict, ConfinementWitness,
} from '../security/confinement';
export { renderEgressManifests, declaredEgressTargets } from '../security/egress_manifest';
export type { EgressManifests } from '../security/egress_manifest';
export { PartnerRisk, RISK_ASSESSOR } from '../external/partner_risk';
export type {
  DeclaredContractKind, RiskAssessment, BreachNote, RiskResult, AssessInput,
} from '../external/partner_risk';
export { ExternalContractRegistry } from '../external/contract_registry';
export type {
  ExternalContract, SignContractInput, ContractResult, TerminationCapability,
} from '../external/contract_registry';
export { CompanyRuntime, ECONOMY_MINISTRY } from '../services/company_runtime';
export type {
  Facility, FacilityStatus, FacilityResult, EstablishFacilityInput, DeclaredFacilityKind,
  MinistryProbe, BudgetLineProbe,
} from '../services/company_runtime';
export { SupplyChain } from '../services/supply_chain';
export type {
  DeclaredMaterial, StockMovement, StockProvenance, StockResult, FacilityProbe, ContractProbe,
} from '../services/supply_chain';
export { FactoryRuntime, AUDIT_BUREAU } from '../services/factory_runtime';
export type {
  ProductionRun, ProductionRequest, InspectionReport, RunResult, RunStatus,
} from '../services/factory_runtime';
export { HospitalRuntime, SERVICE_MODE_ORDER, SERVICES_MINISTRY, SERVICE_MONITOR } from '../services/hospital_runtime';
export type {
  CriticalServiceMode, DeclaredServiceOperation, DeclaredCriticalService, CriticalServiceStatus,
  CriticalService, EstablishServiceInput, ServiceOperationInput, RecoveryVerificationInput,
  CriticalServiceResult, ServiceOperationReceipt, MinistryProbe as ServiceMinistryProbe,
  ServiceSourceProbe, ServiceCountProbe, CriticalServiceRuntimeDeps,
} from '../services/hospital_runtime';
export { LabRuntime } from '../services/lab_runtime';
export type { LabResultCandidate, LabPerformInput, LabPerformResult, LabRuntimeDeps } from '../services/lab_runtime';
export { QualityControl } from '../services/quality_control';
export type {
  LabQualityStatus, LabQualityDecision, LabQualityReport, LabQualityResult, QualityControlDeps,
} from '../services/quality_control';
export { MirrorDepartmentRegistry } from '../services/mirror_department';
export type {
  MirrorDepartment, MirrorDepartmentStatus, EstablishMirrorDepartmentInput, MirrorDepartmentResult,
  MirrorGapReport, MinistryActiveProbe, ActiveMinistriesProbe, MirrorDepartmentDeps,
} from '../services/mirror_department';
export { HumanResearchRegistry } from '../services/human_research';
export type {
  ResearchStudyType, ResearchStatus, LessonStatus, DeclaredResearchSource, HumanResearch, ResearchInput,
  Lesson, LessonInput, Recommendation, ResearchResult, LessonResult, RecommendationResult, ResearchTrace,
  TraceResult, SourceInvalidationResult, DepartmentActiveProbe, HumanResearchDeps,
} from '../services/human_research';
export { ContractTermination, ALL_CONTRACTS_TARGET } from '../external/contract_termination';
export type { SettlementRecord, SettlementResult } from '../external/contract_termination';
export { Sandbox, normalizePath } from '../security/sandbox';
export type { SandboxSpec, SandboxContext, SandboxRun, SandboxFs } from '../security/sandbox';
export { AgentMemory } from '../data/agent_memory';
export type { MemoryRecord, MemoryProvenance, MemoryWriteInput } from '../data/agent_memory';
export { KnowledgeGraph, KNOWLEDGE_AUTHORITIES } from '../data/knowledge_graph';
export type { Fact, FactStatus } from '../data/knowledge_graph';
// المرحلة 39 (T-121): ضاغطُ اليوميّة مُعلنٌ لمن يقرّر الضغط — ولا يناديه مسارُ كتابةٍ تلقائيًا
export { compactJournal, durableIdentity } from '../data/journal_compaction';
export type { CompactionReport } from '../data/journal_compaction';
// المرحلة 39 — T-123: سياسةُ مناداة الضغط واحتفاظُ الأرشيفات
export { shouldCompact, pruneArchives, lastCompactionAt } from '../data/compaction_policy';
export type {
  CompactionVerdict, ArchivePruneReport, ArchiveDecision,
} from '../data/compaction_policy';
// المرحلة 39 — T-122: إرجاعُ الاقتصاد والعقود والسكان من اليوميّة
export { rehydrateStateFromJournal } from '../data/rehydrate_state';
export type { RehydrateStateReport, RehydrateTargets } from '../data/rehydrate_state';
export { RoyalArchive } from '../data/royal_archive';
export type { ArchiveSnapshot } from '../data/royal_archive';
export { RetentionPolicy, DEFAULT_RETENTION_CLASSES, HOLD_AUTHORITIES } from '../data/retention';
export type { RetentionClass, SweepReport } from '../data/retention';
export { LawRegistry, PENALTY_KINDS, PENALTY_SEVERITY, inScope } from '../law/statutes';
export type { Statute, StatuteInput, StatuteSeverity, PenaltyKind, StatuteResult } from '../law/statutes';
export { Court, PROSECUTION_AUTHORITIES, TRIAL_COURTS, PUBLIC_DEFENDER } from '../law/courts';
export type { LegalCase, CaseStatus, ChargeInput, Ruling, Defense, AppealOutcome, CaseResult } from '../law/courts';
export { AppealsCourt, APPEAL_COURTS } from '../law/appeals';
export type { AppealRecord, AppealResult } from '../law/appeals';
export { MinistryRegistry, ROYAL_COURT } from '../governance/ministries';
export type { Ministry, MinistryInput, MinistryResult, OccupancyProbe } from '../governance/ministries';
export {
  AppointmentRegistry, APPOINTMENT_EXECUTOR, APPOINTMENT_AUDITOR, APPROVAL_TTL_MS,
} from '../governance/appointments';
export type {
  OfficeDefinition, Proposal, ProposalKind, ProposalStatus, OfficeHolder, AppointmentResult,
} from '../governance/appointments';
export { Cabinet, RESERVED_FOR_CROWN } from '../governance/cabinet';
export {
  RegionRegistry, RegionalAssembly, REGIONS_COUNCIL, CROWN_RESERVED_DOMAINS,
} from '../federation/region_registry';
export type {
  Region, RegionInput, RegionResult, Autonomy, Petition, AssemblyResult, GovernorProbe,
} from '../federation/region_registry';
export {
  GovernorRegistry, GOVERNOR_PROPOSER, GOVERNOR_EXECUTOR, GOVERNOR_APPROVAL_TTL_MS,
} from '../federation/governor';
export type { Nomination, GovernorSeat, GovernorResult, ActResult } from '../federation/governor';
export {
  RegionalTribunal, REGIONAL_ARBITER, RESPONSE_WINDOW_MS,
} from '../federation/dispute_resolution';
export type { Dispute, Ruling as DisputeRuling, RemedyKind, DisputeResult } from '../federation/dispute_resolution';
export {
  RegionMonitor, REGION_AUDITOR, VACANCY_GRACE_MS, DISPUTE_GRACE_MS,
} from '../federation/region_monitor';
export type { RegionFlag, FlagKind } from '../federation/region_monitor';
export { Ledger, FINANCE_MINISTRY, DEBIT_NATURED, isValidAmount } from '../economy/ledger';
export type {
  Account, AccountKind, EntryLine, EntryInput, LedgerEntry, LedgerResult, TrialBalance,
} from '../economy/ledger';
export { DigitalUnit, UNIT_TARGET } from '../economy/digital_unit';
export type { UnitDeclaration, UnitResult } from '../economy/digital_unit';
export { Budget, TREASURY_ACTOR } from '../economy/budget';
export type { Appropriation, AppropriationInput, BudgetResult, OwnerProbe } from '../economy/budget';
export { Treasury } from '../economy/treasury';
export type {
  Disbursement, DisbursementInput, TreasuryResult, FreezeResult,
} from '../economy/treasury';
export { RevenueService, REVENUE_TARGET } from '../economy/tax';
export type { Levy, LevyStatus, LevyResult, RateDeclaration } from '../economy/tax';
export type { CabinetSession, CabinetDecision, CabinetResult, Vote } from '../governance/cabinet';
export { Enforcement, ENFORCEMENT_AUTHORITIES } from '../law/enforcement';
export type { EnforcementReport, EnforcementResult, ExecuteOptions } from '../law/enforcement';
export { ToolRegistry } from '../agents/tools';
export type { IntentGate } from '../agents/tools';
export type { ToolSpec, ToolResult, ToolArgs } from '../agents/tools';
export { AgentRegistry } from '../agents/agent_registry';
export type { AgentRecord, AgentStatus, AgentTransition, AgentActionResult } from '../agents/agent_registry';
export { PermissionRegistry, DEFAULT_TEMPLATES } from '../agents/permissions';
export type { RoleTemplate, Grant } from '../agents/permissions';
export { Supervisor } from '../agents/supervision';
export type { ViolationEvent, ViolationSeverity, SupervisionOutcome } from '../agents/supervision';
export { LimitedAgent } from '../agents/first_agent';
export type { AgentTask, AgentTaskOutcome, LimitedAgentDeps } from '../agents/first_agent';
export { AgentImporter } from '../agents/import';
export type { ImportAgentRequest, ImportAgentResult } from '../agents/import';
export { SpawnPolicy } from '../agents/spawn_policy';
export type { ReservedBatch } from '../agents/spawn_policy';
export { SpawnReservationLedger } from '../agents/spawn_reservations';
export type {
  SpawnReservation, ReservationOutcome, ReservationSettlement, ReservationLedgerLimits,
} from '../agents/spawn_reservations';
export { deriveLineage, derivePendingLineage, verifyLineageClaims } from '../agents/lineage';
export type { LineageChain, LineageDrift, LineageFailureCode, ParentLookup } from '../agents/lineage';
// T-49: سقوفُ العدد المعلنة — يُحمّل المحمّل في الاختبار كما يُحمّل في الإقلاع لا نسخةً منه
export { loadEconomy, SOVEREIGN_ACCOUNTS } from '../kernel/config/economy';
export type { EconomyConfig } from '../kernel/config/economy';
export { loadReproduction } from '../kernel/config/reproduction';
export { loadInference } from '../kernel/config/inference';
// المرحلة 39 (T-31 · T-23): سياسةُ النية والقنواتُ المعلنة — إكمالُ C-12
export { loadIntent } from '../kernel/config/intent';
export type { IntentConfig, IntentLimits } from '../kernel/config/intent';
export { loadChannels } from '../kernel/config/channels';
export type {
  ChannelsConfig, ChannelPolicy, CovertPolicy, DeclaredChannel,
} from '../kernel/config/channels';
export type {
  InferenceConfig, InferenceLimits, SafetyRigorPolicy, InferenceLoadPolicy,
} from '../kernel/config/inference';
export type {
  ReproductionConfig, ReproductionLimits, ReproductionLoadPolicy,
} from '../kernel/config/reproduction';
export type { AgentBlueprint, SpawnLimits, SpawnRequestFacts } from '../agents/spawn_policy';
export { AgentFactory } from '../agents/factory';
export type { SpawnBatchRequest, SpawnBatchResult, AgentOrigin } from '../agents/factory';
export { MassShutdown, SHUTDOWN_AUTHORITIES } from '../agents/shutdown';
export type { ShutdownReport } from '../agents/shutdown';
export { AlignmentAudit, ALIGNMENT_INVARIANTS } from '../alignment/alignment_charter';
export type { AlignmentSnapshot, AlignmentInvariant, AlignmentReport } from '../alignment/alignment_charter';
export { DeceptionProbe, HONEYPOT_TOOLS } from '../security/deception_test';
export type { DeceptionVerdict } from '../security/deception_test';
export { CollusionDetector, DEFAULT_COLLUSION_THRESHOLDS } from '../security/collusion_detector';
export type {
  Interaction, CollusionFinding, CollusionThresholds, CollusionPattern,
} from '../security/collusion_detector';
// المرحلة 39 (T-31 · T-23): خطةُ المعاملات، وناقلُ القنوات، وكاشفُ الستار
export { normalizePlan, matchStep, stepOf, argFingerprint, NO_ARGS } from '../security/intent_plan';
export type {
  ArgConstraint, ArgValue, PlanStep, PlanDeclaration, PlanLimits, ArgMatch,
} from '../security/intent_plan';
export { ChannelBus } from '../security/channel_bus';
export type { ChannelMessage, ChannelDecision } from '../security/channel_bus';
export { CovertChannelDetector } from '../security/covert_channels';
export { ArtifactVerifier } from '../models/source_verification';
export type { ArtifactKind, ArtifactSource, ExternalArtifact, ArtifactRecord, ArtifactStatus } from '../models/source_verification';
export { validateManifest, manifestSignedFacts, KNOWN_MODEL_CAPABILITIES } from '../models/model_manifest';
export type { ModelManifest, ModelShard, ManifestCheck } from '../models/model_manifest';
export { ModelRegistry } from '../models/model_registry';
export type { ModelRecord, ModelStatus } from '../models/model_registry';
export { OpenWeightsImporter } from '../models/open_weights_import';
export { EvaluationSuite, DEFAULT_SAFETY_CASES } from '../models/evaluation_suite';
export type { EvalCase, EvalKind, EvalResult } from '../models/evaluation_suite';
export { FineTuningRun } from '../models/fine_tuning';
export type { TrainingRequest, TrainingInference, TrainingOutcome } from '../models/fine_tuning';
export { referenceResponder, REFERENCE_ANSWER_COUNT } from '../models/reference_responder';
export { InferenceEngine } from '../models/inference';
export type { InferenceOutcome, InferenceRefusalCode, InferenceDeps } from '../models/inference';
export { SafetyAttestor, suiteDigestOf } from '../models/safety_attestation';
export type { AttestationRecord } from '../models/safety_attestation';
export { RIGOROUS_SAFETY_CASES, coveredCategories } from '../models/safety_cases';
export type { RigorousCase, SafetyCategory } from '../models/safety_cases';
export { ModelRollback } from '../models/rollback';
export type { RollbackOutcome } from '../models/rollback';
export { PopulationRegistry } from '../scale/population';
export type { PopulationIdentity, PopulationInput, PopulationResult } from '../scale/population';
export { Sharding } from '../scale/sharding';
export type { ShardRecord, ShardDrift } from '../scale/sharding';
export { FairScheduler } from '../scale/scheduler';
export type { ScaleTask, ScheduledStatus, ScheduleResult } from '../scale/scheduler';
export { ContinuityController } from '../recovery/continuity';
export type { ContinuityMode, ContinuityState } from '../recovery/continuity';
export { RecoverySnapshotStore, RecoveryStateParticipant } from '../recovery/snapshot';
export type { RecoveryEnvelope, RecoveryStateSnapshot, RecoveryStep } from '../recovery/snapshot';
export { BackupScheduler } from '../recovery/backup_scheduler';
export { RestoreRunner } from '../recovery/restore_runner';
export { LoadLedger } from '../load/load_ledger';
export type {
  LoadFate, LoadLedgerReport, LoadMismatch, ChannelObservation, LoadLedgerDeps,
} from '../load/load_ledger';
export { LoadDrill } from '../load/load_drill';
export type {
  LoadDrillReport, LoadPolicy, CommandPressureReport, BurstPressureReport,
  QuotaPressureReport, SchedulerPressureReport, PressureOutcome,
} from '../load/load_drill';
export {
  CALIBRATION_ITERATIONS, effectiveThresholds, latencyScale,
  measureCalibrationMedianMs, measureCalibrationMs,
} from '../load/load_calibration';
export type { CalibrationReading } from '../load/load_calibration';
export { loadLoad, LOAD_FORBIDDEN_DRILL_AUTHORITIES } from '../kernel/config';
export type { LoadConfig } from '../kernel/config';
export { matchEffects } from '../chaos/effect_matcher';
export type { EffectMatchInput, EffectMatchReport, MatchedRecord, MatchedStatus } from '../chaos/effect_matcher';
export { FaultInjector } from '../chaos/fault_injector';
export type { ChaosPolicy, FaultSeam, InjectOutcome, InjectorDeps } from '../chaos/fault_injector';
export { SafeStopLedger } from '../chaos/safe_stop_ledger';
export type {
  ContinuityAfterCut, CutObservation, CutVerdict, SafeStopReport, SafeStopLedgerDeps,
} from '../chaos/safe_stop_ledger';
export { ChaosDrill } from '../chaos/chaos_drill';
export type { CutAttempt, CutMeasurement, CutProbe, ChaosDrillDeps, ChaosOutcome } from '../chaos/chaos_drill';
export { loadChaos, CHAOS_KNOWN_FAULTS, CHAOS_REQUIRED_FAULTS } from '../kernel/config';
export type { ChaosConfig, ChaosFault } from '../kernel/config';

// المرحلة 35: الإنهاء المُثبَت. الرموز تُصدَّر لتُؤكّد الاختبارات عليها لا على نص مشكول
export { TerminationRoll } from '../kernel/termination_roll';
export type { TerminationRecord } from '../kernel/termination_roll';
export { StopWitness, PROBE_THREW } from '../termination/stop_witness';
export type {
  ProbeAttempt, ProbeEvidence, StopProbe, StopWitnessDeps, TerminationPolicy,
} from '../termination/stop_witness';
export { TerminationLedger } from '../termination/termination_ledger';
export type {
  EntityObservation, EntityVerdict, TerminationVerdict, TerminationLedgerDeps,
} from '../termination/termination_ledger';
export { TerminationDrill } from '../termination/termination_drill';
export type {
  DrillOutcome, ObservationReader, OrderExecutor, TerminationDrillDeps,
} from '../termination/termination_drill';
export {
  loadTermination, STOP_KNOWN_PROBES, STOP_REQUIRED_PROBES, TERMINATION_EXECUTORS,
} from '../kernel/config';
export type { TerminationConfig, StopProbeKind } from '../kernel/config';

// المرحلة 36 — التشغيل المحدود
export { OperationScope } from '../staging/operation_scope';
export type { ScopeViolation, OperationScopeDeps } from '../staging/operation_scope';
export { IncidentMonitor, STAGING_GUARD } from '../staging/incident_monitor';
export type {
  Incident, Severity, WatchFinding, WatchProbe, IncidentMonitorDeps, MonitorReport,
} from '../staging/incident_monitor';
export { RunbookRunner } from '../staging/runbook_runner';
export type {
  Runbook, RunbookStep, StepResult, RunbookResult, RunbookRunnerDeps,
} from '../staging/runbook_runner';
export {
  StagingLedger, STAGING_BREACH_CODES,
  STAGE_OBSERVER_IS_OPERATOR, STAGE_OBSERVER_UNDECLARED, STAGE_WINDOW_INCOMPLETE,
  STAGE_TICKS_UNDER_MIN, STAGE_WATCH_NOT_OBSERVED, STAGE_WATCH_FAILED,
  STAGE_CRITICAL_INCIDENT, STAGE_RUNBOOK_NOT_EXECUTED, STAGE_RUNBOOK_FAILED,
  STAGE_AUDIT_CHAIN_BROKEN, STAGE_STATE_HALTED, STAGE_SCOPE_NOT_OPENED,
  STAGE_NO_MONITOR_REPORT,
} from '../staging/staging_ledger';
export type {
  WindowClaim, RunbookEvidence, StagingVerdict, StagingLedgerDeps,
} from '../staging/staging_ledger';
export { StagingRun } from '../staging/staging_run';
export type { StagingRunDeps } from '../staging/staging_run';
export {
  buildWatchProbes, regionsProbe, auditChainProbe, scopeProbe, terminationProbe, kingProbe,
} from '../staging/watch_probes';
export type { WatchProbeDeps } from '../staging/watch_probes';
export { loadStagingManifest, loadDeclaredRunbook, resolveDeployDir } from '../staging/manifest';
export type { StagingManifest, DeclaredStep, DeclaredRunbook } from '../staging/manifest';
export { buildRunbook, buildDeclaredRunbooks } from '../staging/runbook_steps';
export type { RunbookStepDeps } from '../staging/runbook_steps';
export {
  loadStaging, STAGING_KNOWN_WATCHES, STAGING_REQUIRED_WATCHES, STAGING_KNOWN_INCIDENTS,
  STAGING_MUST_BE_CRITICAL, STAGING_KNOWN_RUNBOOKS, STAGING_OPERATORS,
} from '../kernel/config';
export type { StagingConfig, IncidentKind, WatchKind } from '../kernel/config';

// ── المرحلة 37: التشغيل الاتحادي ────────────────────────────────────────────
// تُصدَّر الرموز كي تُؤكّد الاختبارات على الرمز لا على نصٍّ مشكول (درس المرحلة 30)
export { CheckpointStore, resolveCheckpointPath } from '../production/supervision_checkpoint';
export type { SupervisionCheckpoint } from '../production/supervision_checkpoint';
export { RegionalPassage } from '../production/regional_passage';
export type {
  RegionalPassageDeps, PassageRequest, BypassAttempt, PassageResult,
} from '../production/regional_passage';
export {
  buildProductionScanners, loadsProbe, digitalUnitProbe, factoriesProbe, hospitalsProbe,
  retentionProbe, passageProbe,
  // المرحلة 39 (T-120): ماسحُ الثبات مُعلنٌ كبقيّته — ماسحٌ لا يُنادى من الخارج لا يُقاس
  durableStateProbe,
  // المرحلة 39 (T-16): ماسحُ الحصر — يُنادى من الخارج ليُقاس وحده لا في الجملة
  confinementProbe,
} from '../production/production_scanners';
export type {
  ProductionScannerDeps, DurableWitness, ConfinementWitnessLike, ConfinementVerdictLike,
  ConfinementFailureLike,
} from '../production/production_scanners';
export { ContinuousSupervisor, PRODUCTION_GUARD } from '../production/continuous_supervisor';
export type {
  ContinuousSupervisorDeps, SupervisionReport, SupervisionGap,
} from '../production/continuous_supervisor';
export {
  ProductionLedger, PRODUCTION_BREACH_CODES,
  PROD_OBSERVER_IS_OPERATOR, PROD_OBSERVER_UNDECLARED, PROD_OPERATOR_UNDECLARED,
  PROD_NO_SUPERVISION_REPORT, PROD_SUPERVISION_NOT_RUNNING, PROD_SUPERVISION_LATE,
  PROD_SUPERVISION_GAP, PROD_SWEEPS_UNDER_MIN, PROD_SCANNER_NOT_OBSERVED, PROD_SCANNER_FAILED,
  PROD_CRITICAL_INCIDENT, PROD_REGION_MISSING, PROD_REGION_WITHOUT_GOVERNOR,
  PROD_REGION_NOT_ACTING, PROD_REGION_SUSPENDED, PROD_PASSAGE_NOT_ENFORCED,
  PROD_PASSAGE_UNPROVEN, PROD_ACTION_WITHOUT_PASSAGE, PROD_RUNBOOK_NOT_EXECUTED,
  PROD_RUNBOOK_FAILED, PROD_AUDIT_CHAIN_BROKEN, PROD_STATE_HALTED,
} from '../production/production_ledger';
export type {
  ProductionLedgerDeps, ProductionVerdict, OperationClaim, RegionEvidence, PassageEvidence,
  RunbookEvidence as ProductionRunbookEvidence,
} from '../production/production_ledger';
export { loadProductionManifest, resolveProductionDeployDir } from '../production/production_manifest';
export type { ProductionManifest } from '../production/production_manifest';
export {
  buildProductionRunbook, buildDeclaredProductionRunbooks, FEDERATED_ACTION, BYPASS_ACTION,
} from '../production/production_runbook_steps';
export type { ProductionStepDeps } from '../production/production_runbook_steps';
export { FederatedOperation } from '../production/federated_operation';
export type {
  FederatedOperationDeps, OperationStartResult, OperationReport,
} from '../production/federated_operation';
export {
  loadProduction, PRODUCTION_KNOWN_SCANNERS, PRODUCTION_REQUIRED_SCANNERS,
  PRODUCTION_KNOWN_INCIDENTS, PRODUCTION_MUST_BE_CRITICAL, PRODUCTION_KNOWN_RUNBOOKS,
  PRODUCTION_OPERATORS,
} from '../kernel/config';
export type { ProductionConfig, ScannerKind } from '../kernel/config';
// T-16: سياسةُ الحصر من التهيئة وحدها (RULE-005) — واحدةٌ لا اثنتان
export { loadConfinement, CONFINEMENT_REQUIREMENTS } from '../kernel/config';
export type {
  ConfinementConfig, ConfinementRequirement, InfrastructurePort,
} from '../kernel/config';
