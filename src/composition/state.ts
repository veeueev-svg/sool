/**
 * src/composition/state.ts — عقد الدولة وخيارات التأسيس
 * المالك: القيّم على المستودع | المراحل: 1–37
 * المدخلات: لا شيء — إعلان أنواع فقط
 * المخرجات: `DigitalState` (كل ما تحمله الدولة) و`BootstrapOptions`
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * نُقل حرفًا بحرف من `src/index.ts` في تفكيك البند T-112 (0.25.0): لا سطر منطق
 * أُضيف ولا حُذف ولا أُعيد ترتيبه. الترتيب داخل الوحدة مُلزم كما كان في الجذر.
 */
import {
  PersistenceConfig, QuotasConfig, RoyalAuthorityConfig, EconomyConfig, ExternalConfig, ContractsConfig, EnterprisesConfig, ServicesConfig, ResearchConfig, ScaleConfig, RecoveryConfig, LoadConfig, ChaosConfig, TerminationConfig, StagingConfig, ProductionConfig,
} from '../kernel/config';
import { ResourceRegistry } from '../kernel/resource_registry';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CertificateAuthority } from '../identity/certificate_authority';
import { IdentityRegistry } from '../identity/registry';
import { KingIdentity } from '../identity/king_identity';
import { VetoRegistry } from '../crown/veto';
import { KillSwitch } from '../security/kill_switch';
import { RoyalHeartbeat } from '../crown/royal_heartbeat';
import { KingMonitor } from '../crown/king_monitor';
import { CrownGateway } from '../crown/crown_gateway';
import { CrownGuard } from '../crown/guardians';
import { NetworkEgressGuard } from '../external/network_egress';
import { ExternalAccountRegistry } from '../external/account_registry';
import { PaymentControls } from '../external/payment_controls';
import { PartnerRisk } from '../external/partner_risk';
import { ExternalContractRegistry } from '../external/contract_registry';
import { ContractTermination } from '../external/contract_termination';
import { CompanyRuntime } from '../services/company_runtime';
import { SupplyChain } from '../services/supply_chain';
import { FactoryRuntime } from '../services/factory_runtime';
import { HospitalRuntime } from '../services/hospital_runtime';
import { LabRuntime } from '../services/lab_runtime';
import { QualityControl } from '../services/quality_control';
import { MirrorDepartmentRegistry } from '../services/mirror_department';
import { HumanResearchRegistry } from '../services/human_research';
import { ToolRegistry } from '../agents/tools';
import { AgentMemory } from '../data/agent_memory';
import { KnowledgeGraph } from '../data/knowledge_graph';
import { RoyalArchive } from '../data/royal_archive';
import { RetentionPolicy } from '../data/retention';
import { StateJournal, RehydrateReport } from '../data/persistence';
import { AgentRegistry } from '../agents/agent_registry';
import { PermissionRegistry } from '../agents/permissions';
import { Supervisor } from '../agents/supervision';
import { AgentImporter } from '../agents/import';
import { SpawnPolicy } from '../agents/spawn_policy';
import { AgentFactory } from '../agents/factory';
import { MassShutdown } from '../agents/shutdown';
import { AlignmentAudit } from '../alignment/alignment_charter';
import { DeceptionProbe } from '../security/deception_test';
import { CollusionDetector } from '../security/collusion_detector';
import { LawRegistry } from '../law/statutes';
import { Court } from '../law/courts';
import { AppealsCourt } from '../law/appeals';
import { Enforcement } from '../law/enforcement';
import { MinistryRegistry } from '../governance/ministries';
import { AppointmentRegistry } from '../governance/appointments';
import { Cabinet } from '../governance/cabinet';
import { RegionRegistry, RegionalAssembly } from '../federation/region_registry';
import { GovernorRegistry } from '../federation/governor';
import { RegionalTribunal } from '../federation/dispute_resolution';
import { RegionMonitor } from '../federation/region_monitor';
import { Ledger } from '../economy/ledger';
import { DigitalUnit } from '../economy/digital_unit';
import { Budget } from '../economy/budget';
import { Treasury } from '../economy/treasury';
import { RevenueService } from '../economy/tax';
import { ArtifactVerifier } from '../models/source_verification';
import { ModelRegistry } from '../models/model_registry';
import { OpenWeightsImporter } from '../models/open_weights_import';
import { SafetyAttestor } from '../models/safety_attestation';
import { InferenceEngine } from '../models/inference';
import { StateMode } from '../kernel/types';
import { PopulationRegistry } from '../scale/population';
import { Sharding } from '../scale/sharding';
import { FairScheduler } from '../scale/scheduler';
import { ContinuityController } from '../recovery/continuity';
import { RecoverySnapshotStore, RecoveryStateParticipant } from '../recovery/snapshot';
import { BackupScheduler } from '../recovery/backup_scheduler';
import { RestoreRunner } from '../recovery/restore_runner';
import { LoadLedger } from '../load/load_ledger';
import { LoadDrill } from '../load/load_drill';
import { FaultInjector } from '../chaos/fault_injector';
import { SafeStopLedger } from '../chaos/safe_stop_ledger';
import { ChaosDrill } from '../chaos/chaos_drill';
import { TerminationRoll } from '../kernel/termination_roll';
import { TerminationLedger } from '../termination/termination_ledger';
import { OperationScope } from '../staging/operation_scope';
import { IncidentMonitor } from '../staging/incident_monitor';
import { RunbookRunner } from '../staging/runbook_runner';
import { StagingLedger } from '../staging/staging_ledger';
import { StagingManifest } from '../staging/manifest';
import { RegionalPassage } from '../production/regional_passage';
import { ContinuousSupervisor } from '../production/continuous_supervisor';
import { ProductionLedger } from '../production/production_ledger';
import { ProductionManifest } from '../production/production_manifest';
import { FederatedOperation } from '../production/federated_operation';

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
  /** المُشهِدُ للسلامة والمحرّكُ الذي لا يُشغَّل نموذجٌ إلا منه (المرحلة 39 — T-21) */
  readonly safetyAttestor: SafetyAttestor;
  readonly inference: InferenceEngine;
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
  readonly regions: RegionRegistry;
  readonly assembly: RegionalAssembly;
  readonly governors: GovernorRegistry;
  readonly tribunal: RegionalTribunal;
  readonly regionMonitor: RegionMonitor;
  readonly economyConfig: EconomyConfig;
  readonly externalConfig: ExternalConfig;
  readonly ledger: Ledger;
  readonly unit: DigitalUnit;
  readonly budget: Budget;
  readonly treasury: Treasury;
  readonly revenue: RevenueService;
  readonly externalAccounts: ExternalAccountRegistry;
  readonly payments: PaymentControls;
  readonly contractsConfig: ContractsConfig;
  readonly partnerRisk: PartnerRisk;
  readonly contracts: ExternalContractRegistry;
  readonly contractTermination: ContractTermination;
  readonly enterprisesConfig: EnterprisesConfig;
  readonly companies: CompanyRuntime;
  readonly supply: SupplyChain;
  readonly factories: FactoryRuntime;
  readonly servicesConfig: ServicesConfig;
  readonly hospitals: HospitalRuntime;
  readonly labs: LabRuntime;
  readonly qualityControl: QualityControl;
  readonly researchConfig: ResearchConfig;
  readonly mirrorDepartments: MirrorDepartmentRegistry;
  readonly humanResearch: HumanResearchRegistry;
  readonly scaleConfig: ScaleConfig;
  readonly sharding: Sharding;
  readonly population: PopulationRegistry;
  readonly scheduler: FairScheduler;
  readonly recoveryConfig: RecoveryConfig;
  readonly continuity: ContinuityController;
  readonly recoveryState: RecoveryStateParticipant;
  readonly recoverySnapshots: RecoverySnapshotStore;
  readonly backupScheduler: BackupScheduler;
  readonly restoreRunner: RestoreRunner;
  readonly loadConfig: LoadConfig;
  readonly loadLedger: LoadLedger;
  readonly loadDrill: LoadDrill;
  readonly chaosConfig: ChaosConfig;
  readonly faultInjector: FaultInjector;
  readonly safeStopLedger: SafeStopLedger;
  readonly chaosDrill: ChaosDrill;
  readonly terminationConfig: TerminationConfig;
  readonly terminationRoll: TerminationRoll;
  readonly terminationLedger: TerminationLedger;
  readonly stagingConfig: StagingConfig;
  readonly stagingManifest: StagingManifest;
  readonly operationScope: OperationScope;
  readonly incidentMonitor: IncidentMonitor;
  readonly runbookRunner: RunbookRunner;
  readonly stagingLedger: StagingLedger;
  readonly productionConfig: ProductionConfig;
  readonly productionManifest: ProductionManifest;
  readonly passage: RegionalPassage;
  readonly continuousSupervisor: ContinuousSupervisor;
  readonly productionLedger: ProductionLedger;
  readonly federatedOperation: FederatedOperation;
  /** سياسة الثبات المعلنة (المرحلة 39، البند T-27) — تُقرأ دائمًا وتُنفَّذ عند إعلان المجلد */
  readonly persistenceConfig: PersistenceConfig;
  /** اليوميّة الدائمة إن أُعلن `persistenceDir`، وإلا `null`: لا ادّعاء ثباتٍ بلا وسيط */
  readonly journal: StateJournal | null;
  /** تقرير الإرجاع عند الإقلاع — `null` حين لا يوميّة، و`restored:false` ليوميّة فارغة */
  readonly rehydrated: RehydrateReport | null;
  readonly mode: () => StateMode;
}

export interface BootstrapOptions {
  readonly configDir?: string;
  readonly now?: number;
  /** مسار حفظ سجل التدقيق على القرص (المرحلة 32) — إن غاب، تبقى الحالة في الذاكرة */
  readonly auditPath?: string;
  /**
   * مجلد اليوميّة الدائمة (المرحلة 39، البند T-27). إن أُعلن: تُدوَّن كتابات السجل والذاكرة
   * والمعرفة لحظتها، ويُرجَع ما فيه عند الإقلاع. وإن غاب: لا تدوين ولا إرجاع ولا ادّعاء نجاة.
   * يُقدَّم على المجلد المعلن في `config/persistence.yaml` — والباقي (النطاق والحدّ والمزامنة) من التهيئة.
   */
  readonly persistenceDir?: string;
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
  /** مُدد الاتحاد (المرحلة 24): مدة ردّ المدّعى عليه ومهل المراقبة — تُعلن ولا تُخفى */
  readonly federation?: {
    readonly approvalTtlMs?: number;
    readonly responseWindowMs?: number;
    readonly vacancyGraceMs?: number;
    readonly disputeGraceMs?: number;
  };
}
