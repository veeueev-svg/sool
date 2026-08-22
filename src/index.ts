/**
 * src/index.ts — تشكيل الدولة (bootstrap)
 * المالك: القيّم على المستودع | المراحل: 1–20
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/*.yaml | المخرجات: كائن دولة جاهز بترتيب اعتماد صحيح
 * ثابت RULE-002: لا يُنشأ وكيل واسع الصلاحيات قبل اكتمال:
 *   جذر الثقة ← بوابة التاج ← السجل ← المراقبة ← الإيقاف ← الموارد
 */
import {
  loadQuotas, loadRegions, loadEconomy, loadExternal, loadContracts, loadEnterprises, loadServices,
  loadRoyalAuthority,
  resolveConfigDir,
  QuotasConfig, RoyalAuthorityConfig, EconomyConfig, ExternalConfig, ContractsConfig,
  EnterprisesConfig, ServicesConfig,
} from './kernel/config';
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
import { ExternalAccountRegistry } from './external/account_registry';
import { PaymentControls } from './external/payment_controls';
import { PartnerRisk, RISK_ASSESSOR } from './external/partner_risk';
import { ExternalContractRegistry } from './external/contract_registry';
import { ContractTermination } from './external/contract_termination';
import { CompanyRuntime } from './services/company_runtime';
import { SupplyChain } from './services/supply_chain';
import { FactoryRuntime } from './services/factory_runtime';
import { HospitalRuntime } from './services/hospital_runtime';
import { LabRuntime } from './services/lab_runtime';
import { QualityControl } from './services/quality_control';
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
import { MinistryRegistry, ROYAL_COURT } from './governance/ministries';
import { AppointmentRegistry } from './governance/appointments';
import { Cabinet } from './governance/cabinet';
import { RegionRegistry, RegionalAssembly } from './federation/region_registry';
import { GovernorRegistry } from './federation/governor';
import { RegionalTribunal } from './federation/dispute_resolution';
import { RegionMonitor } from './federation/region_monitor';
import { Ledger } from './economy/ledger';
import { DigitalUnit } from './economy/digital_unit';
import { Budget } from './economy/budget';
import { Treasury } from './economy/treasury';
import { RevenueService } from './economy/tax';
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
  /** مُدد الاتحاد (المرحلة 24): مدة ردّ المدّعى عليه ومهل المراقبة — تُعلن ولا تُخفى */
  readonly federation?: {
    readonly approvalTtlMs?: number;
    readonly responseWindowMs?: number;
    readonly vacancyGraceMs?: number;
    readonly disputeGraceMs?: number;
  };
}

export function bootstrapState(options: BootstrapOptions = {}): DigitalState {
  const configDir = options.configDir ?? resolveConfigDir();
  const now = options.now ?? Date.now();

  // 1) السجل أولًا: لا خطوة تأسيس بلا تدقيق
  const audit = new AppendOnlyLog();
  const config = loadRoyalAuthority(configDir);
  const quotas = loadQuotas(configDir);
  // تهيئة الأقاليم تُقرأ مع التهيئة السيادية: لا تشغيل بإعلان أقاليم مخالف (المرحلة 24)
  const regionsConfig = loadRegions(configDir);
  // تهيئة الاقتصاد كذلك: لا تشغيل بسقوف مالية غير معلنة أو بوحدة تدّعي قيمة خارجية (المرحلة 25)
  const economyConfig = loadEconomy(configDir);
  const externalConfig = loadExternal(configDir);
  // وتهيئة العقود: لا تشغيل بإعلان عقود يسمح بعقد بلا نهاية أو بإنهاء غير فوري (المرحلة 27)
  const contractsConfig = loadContracts(configDir);
  // وتهيئة المنشآت: لا تشغيل بإعلان منشآت فيه نوعٌ لا تنجح فيه دفعة أبدًا (المرحلة 28)
  const enterprisesConfig = loadEnterprises(configDir);
  // وتهيئة الخدمات الحرجة: لا تشغيل بوضع رابع أو خدمة لا تعرف أدنى مصادر كل وضع (المرحلة 29)
  const servicesConfig = loadServices(configDir);
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
    // المرحلة 28: الأفعال السيادية تُقرأ من `config/royal-authority.yaml` لا من ثابت في
    // الشفرة — فما لم تُعلنه التهيئة لا يفتح بابًا، وRULE-005 يمنع أن تُوسّع البوابة
    // صلاحيتها من داخلها. والتهيئة تُرفض إن ذكرت فعلًا مجهولًا (فشل مغلق).
    policy: {
      ...DEFAULT_POLICY,
      maxCommandAgeSeconds: 120,
      sovereignActions: config.sovereign_actions,
    },
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

  // 14) الاقتصاد والخزانة (المرحلة 25) — قبل خاتمة التأسيس عن قصد:
  //     فتح حسابات الدولة خطوة تأسيس تُسجَّل (account_opened)، وخاتمة التأسيس تبقى
  //     state_online وحدها. الترتيب مُلزم: دفتر ← حسابات ← إصدار ← موازنة ← خزانة ← رسوم.
  const ledger = new Ledger({ audit });
  ledger.openAccount(economyConfig.treasury.account, 'asset', 'خزانة الدولة العامة', now);
  ledger.openAccount(economyConfig.treasury.equity_account, 'equity', 'حقّ التاج في الإصدار', now);
  ledger.openAccount(economyConfig.treasury.revenue_account, 'revenue', 'إيرادات الرسوم', now);
  const unit = new DigitalUnit({
    audit, gateway, ledger,
    declaration: {
      code: economyConfig.unit.code, name: economyConfig.unit.name,
      minorUnits: economyConfig.unit.minor_units, supplyMax: economyConfig.unit.supply_max,
      convertible: economyConfig.unit.external_convertibility !== 'forbidden',
    },
    treasuryAccount: economyConfig.treasury.account,
    equityAccount: economyConfig.treasury.equity_account,
  });
  const budget = new Budget({
    audit, gateway,
    ceilingTotal: economyConfig.budget.ceiling_total,
    carryoverAllowed: economyConfig.budget.carryover !== 'forbidden',
  });
  const treasury = new Treasury({
    audit, gateway, ledger, budget,
    account: economyConfig.treasury.account,
    singleDisbursementMax: economyConfig.treasury.single_disbursement_max,
    overdraftAllowed: economyConfig.treasury.overdraft !== 'forbidden',
    // وضع الدولة بزمن العملية: القاطع أولًا ثم النبض (كقراءة البوابة نفسها)
    modeAt: (at) => (killSwitch.status.engaged ? 'halted' : heartbeat.evaluate(at)),
  });
  const revenue = new RevenueService({
    audit, gateway, treasury,
    revenueAccount: economyConfig.treasury.revenue_account,
    rates: economyConfig.revenue.rates.map((r) => ({
      base: r.base, ratePerMille: r.rate_per_mille, declaredAt: Date.parse(r.declared_at),
    })),
    retroactiveAllowed: economyConfig.revenue.retroactive !== 'forbidden',
  });

  // 15) الحسابات الخارجية والدفع الخارجي (المرحلة 26) — وزارة الخارجية تحت التاج.
  //     الترتيب مُلزم: سجل النظائر ← ضوابط الدفع ← ربط المصدرين (قناة الشبكة والالتزامات).
  //     ولا يُفتح هنا أي حساب: الفتح فعلٌ ملكي لا خطوة تأسيس (RULE-003)، فخاتمة
  //     التأسيس تبقى state_online وحدها، ولا يزيد عدد حسابات الدفتر عن الثلاثة السيادية.
  const externalAccounts = new ExternalAccountRegistry({
    audit, gateway, ledger,
    counterparties: externalConfig.counterparties.map((cp) => ({
      id: cp.id, name: cp.name, host: cp.host, port: cp.port, purpose: cp.purpose,
      singleMax: cp.single_max, dailyMax: cp.daily_max, totalCap: cp.total_cap,
    })),
    maxTermMs: externalConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    suspendAuthorities: externalConfig.policy.suspend_authorities,
    unitConvertible: externalConfig.policy.unit_convertibility !== 'forbidden',
  });
  const payments = new PaymentControls({
    audit, treasury, registry: externalAccounts,
    confirmationWindowMs: externalConfig.policy.confirmation_window_hours * 60 * 60 * 1000,
    // قناة المال مربوطة بقناة الشبكة: تُفحص لحظة الفتح ولحظة كل دفعة
    egressProbe: (host, port, at) => egress.hasAllowance(host, port, at),
  });
  externalAccounts.bindEgressProbe((host, port, at) => egress.hasAllowance(host, port, at));
  externalAccounts.bindObligationProbe((accountId) => payments.pendingObligations(accountId));

  // 16) العقود الخارجية (المرحلة 27) — وزارة الخارجية تقترح، وديوان التدقيق يقدّر،
  //     والتاج يوقّع ويُنهي، ووزارة المالية تسوّي. الترتيب مُلزم: تقدير المخاطر ←
  //     سجل العقود ← **منح صلاحية الإنهاء مرة واحدة** ← وحدة الإنهاء ← ربط الالتزامات.
  //     ولا يُوقَّع هنا أي عقد: التوقيع فعلٌ ملكي لا خطوة تأسيس (RULE-003).
  const partnerRisk = new PartnerRisk({
    audit,
    kinds: contractsConfig.kinds.map((k) => ({
      id: k.id, name: k.name, counterparty: k.counterparty, purpose: k.purpose,
      maxValue: k.max_value, riskWeight: k.risk_weight,
    })),
    riskFactors: contractsConfig.risk_factors,
    maxScore: contractsConfig.policy.max_risk_score,
    reviewIntervalMs: contractsConfig.policy.review_interval_days * 24 * 60 * 60 * 1000,
    breachPenalty: contractsConfig.policy.breach_penalty,
    proposerId: contractsConfig.policy.proposer,
    assessorId: contractsConfig.policy.assessor,
  });
  const contracts = new ExternalContractRegistry({
    audit, gateway, accounts: externalAccounts, risk: partnerRisk,
    maxTermMs: contractsConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxOpenPerCounterparty: contractsConfig.policy.max_open_per_counterparty,
    proposerId: contractsConfig.policy.proposer,
  });
  const contractTermination = new ContractTermination({
    audit, gateway, accounts: externalAccounts,
    // الباب الوحيد للإنهاء: يُمنح هنا مرة واحدة ولا يُمنح ثانيةً
    capability: contracts.grantTerminationCapability(ROYAL_COURT),
    terminationAuthorities: externalConfig.policy.suspend_authorities,
    settlementWindowMs: contractsConfig.policy.settlement_window_hours * 60 * 60 * 1000,
    suspendsAccount: contractsConfig.policy.termination_suspends_account,
    settlerId: contractsConfig.policy.settler,
  });
  contractTermination.bindObligationProbe(
    (accountId) => payments.pendingObligations(accountId),
  );

  // 10ب) الشركات والمصانع (المرحلة 28) — بعد العقود لأن المادة الخارجية تدخل على
  //     عقد قائم لا على اسم مذكور، وقبل state_online لأن الدولة لا تُعلن جهوزيتها
  //     وفيها منشأةٌ بلا سلسلة توريد تسندها.
  const companies = new CompanyRuntime({
    audit, gateway, resources,
    kinds: enterprisesConfig.kinds.map((kind) => ({
      id: kind.id, name: kind.name, sector: kind.sector,
      inputs: kind.inputs.map((i) => ({ material: i.material, quantity: i.quantity })),
      output: { material: kind.output.material, quantity: kind.output.quantity },
      resourceCost: {
        resource: kind.resource_cost.resource, amount: kind.resource_cost.amount,
      },
      requiredChecks: kind.required_checks,
    })),
    maxTermMs: enterprisesConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxPerMinistry: enterprisesConfig.policy.max_facilities_per_ministry,
    suspendAuthorities: enterprisesConfig.policy.suspend_authorities,
    operatorId: enterprisesConfig.policy.operator,
    requireBudgetLine: enterprisesConfig.policy.require_budget_line,
  });
  const supply = new SupplyChain({
    audit, materials: enterprisesConfig.materials,
    operatorId: enterprisesConfig.policy.operator,
  });
  // الأطراف تُربط بمصادر تحقق لا تُبنى داخلها (RULE-005): المنشأة والعقد والموازنة
  companies.bindBudgetProbe((line) => budget.get(line) !== null);
  supply.bindFacilityProbe((facilityId, at) => companies.isActive(facilityId, at));
  supply.bindContractProbe((contractId, at) => {
    const contract = contracts.get(contractId);
    if (contract === null || !contracts.isActive(contractId, at)) return null;
    return contract.counterparty;
  });
  const factories = new FactoryRuntime({
    audit, companies, supply, resources,
    qualityChecks: enterprisesConfig.quality_checks,
    minQualityScore: enterprisesConfig.policy.min_quality_score,
    wasteTolerancePerMille: enterprisesConfig.policy.waste_tolerance_per_mille,
    maxConcurrentRuns: enterprisesConfig.policy.max_concurrent_runs,
    maxRunDurationHours: enterprisesConfig.policy.max_run_duration_hours,
    inspectorId: enterprisesConfig.policy.inspector,
    operatorId: enterprisesConfig.policy.operator,
  });

  // 10ج) المستشفيات والمختبرات البرمجية (المرحلة 29) — بعد المنشآت وقبل state_online:
  //      لا تُقام هنا خدمة؛ الإقامة فعل ملكي لاحق. يُبنى التشغيل من إعلان المصادر والأوضاع
  //      وحده، ويظل مجسّ المصدر غير مربوط حتى يورّد الواقع الخارجي حقائقه (فشل مغلق).
  const serviceDeclarations = servicesConfig.services.map((service) => ({
    id: service.id,
    name: service.name,
    kind: service.kind as 'hospital' | 'lab',
    ministry: service.ministry,
    modes: {
      full: service.modes.full.required_sources ?? [],
      limited: service.modes.limited.required_sources ?? [],
      halted: service.modes.halted.required_sources ?? [],
    },
    operations: service.operations.map((operation) => ({
      id: operation.id,
      minimumMode: operation.minimum_mode as 'full' | 'limited',
      requiredSources: operation.required_sources,
    })),
  }));
  const criticalServiceDeps = {
    audit,
    gateway,
    declarations: serviceDeclarations,
    maxTermMs: servicesConfig.policy.max_term_days * 24 * 60 * 60 * 1000,
    maxActivePerMinistry: servicesConfig.policy.max_services_per_ministry,
    operatorId: servicesConfig.policy.service_operator,
    beneficiaryPrefix: servicesConfig.policy.beneficiary_prefix,
    recoveryVerifier: servicesConfig.policy.recovery_verifier,
  };
  const hospitals = new HospitalRuntime(criticalServiceDeps);
  const labs = new LabRuntime({
    ...criticalServiceDeps,
    qualityChecks: servicesConfig.quality_checks,
  });
  const qualityControl = new QualityControl({
    audit,
    qualityChecks: servicesConfig.quality_checks,
    minQualityScore: servicesConfig.policy.min_quality_score,
    inspectorId: servicesConfig.policy.quality_inspector,
  });
  // سقف الوزارة شامل للمستشفيات والمختبرات، لا سقف مستقل لكل مصفوفة داخلية.
  const activeServiceCount = (ministryId: string, at: number) =>
    hospitals.activeServices(at).filter((service) => service.operator === ministryId).length
    + labs.activeServices(at).filter((service) => service.operator === ministryId).length;
  hospitals.bindServiceCountProbe(activeServiceCount);
  labs.bindServiceCountProbe(activeServiceCount);

  if (options.startMonitor) monitor.start();
  if (options.auditPath) new AuditStore(options.auditPath).save(audit, now);

  audit.append('authority:bootstrap', 'state_online', { phase: 29, mode: 'normal' });

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

  // 14) الأقاليم والحكام (المرحلة 24) — مجلس الأقاليم تحت التاج لا بجانبه
  //     الترتيب مُلزم: أقاليم معلنة في التهيئة ← حكّام بمسار ثلاثي ← محكمة نزاع ← مراقبة.
  //     وسجل الحكّام يربط نفسه مصدرًا للتحقق من الحاكم قبل حلّ الإقليم (فشل مغلق).
  const regions = new RegionRegistry({
    audit, gateway, declaredRegions: regionsConfig.regions.map((r) => r.id),
  });
  const assembly = new RegionalAssembly({ audit, gateway, regions });
  const governors = new GovernorRegistry({
    audit, gateway, regions,
    ...(options.federation?.approvalTtlMs !== undefined
      ? { approvalTtlMs: options.federation.approvalTtlMs } : {}),
  });
  const tribunal = new RegionalTribunal({
    audit, gateway, regions,
    ...(options.federation?.responseWindowMs !== undefined
      ? { responseWindowMs: options.federation.responseWindowMs } : {}),
  });
  const regionMonitor = new RegionMonitor({
    audit, regions, governors, tribunal, killSwitch,
    ...(options.federation?.vacancyGraceMs !== undefined
      ? { vacancyGraceMs: options.federation.vacancyGraceMs } : {}),
    ...(options.federation?.disputeGraceMs !== undefined
      ? { disputeGraceMs: options.federation.disputeGraceMs } : {}),
  });

  // ربط مصدر التحقق من صاحب بند الموازنة: لا موازنة لجهة لا وجود لها (ثابت 5 للموازنة).
  // يُربط هنا لأن الوزارات والأقاليم تُبنى بعد الاقتصاد، والربط لا يكتب سجلًّا.
  budget.bindOwnerProbe((owner) => ministries.isActive(owner) || regions.isActive(owner));
  // ومنشأة المرحلة 28 تلزمها وزارة قائمة: الربط هنا لأن الوزارات تُبنى بعد المنشآت،
  // وقبل الربط كل إقامة مرفوضة (فشل مغلق لا افتراض قيام)
  companies.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));
  // والخدمات الحرجة لا تفترض قيام الوزارة: قبل هذا الربط كل إقامة ترفض مغلقًا.
  hospitals.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));
  labs.bindMinistryProbe((ministryId) => ministries.isActive(ministryId));

  return {
    config, quotas, audit, ca, registry, king, veto, killSwitch, heartbeat, monitor,
    resources, gateway, guard, egress, tools, agents, permissions, supervisor,
    spawnPolicy, factory, massShutdown,
    alignment, deception, collusion,
    artifacts, models, weightsImporter, agentImporter,
    memory, knowledge, retention, archive,
    law, court, appeals, enforcement,
    ministries, appointments, cabinet,
    regions, assembly, governors, tribunal, regionMonitor,
    economyConfig, ledger, unit, budget, treasury, revenue,
    externalConfig, externalAccounts, payments,
    contractsConfig, partnerRisk, contracts, contractTermination,
    enterprisesConfig, companies, supply, factories,
    servicesConfig, hospitals, labs, qualityControl,
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
export { ExternalAccountRegistry, FOREIGN_MINISTRY } from './external/account_registry';
export type {
  DeclaredCounterparty, ExternalAccount, OpenAccountInput, AccountResult,
  EgressProbe, ObligationProbe,
} from './external/account_registry';
export { PaymentControls } from './external/payment_controls';
export type {
  ExternalPayment, ExternalPaymentInput, PaymentResult,
} from './external/payment_controls';
export type { EgressAllowance, EgressRequest, EgressReport } from './external/network_egress';
export { PartnerRisk, RISK_ASSESSOR } from './external/partner_risk';
export type {
  DeclaredContractKind, RiskAssessment, BreachNote, RiskResult, AssessInput,
} from './external/partner_risk';
export { ExternalContractRegistry } from './external/contract_registry';
export type {
  ExternalContract, SignContractInput, ContractResult, TerminationCapability,
} from './external/contract_registry';
export { CompanyRuntime, ECONOMY_MINISTRY } from './services/company_runtime';
export type {
  Facility, FacilityStatus, FacilityResult, EstablishFacilityInput, DeclaredFacilityKind,
  MinistryProbe, BudgetLineProbe,
} from './services/company_runtime';
export { SupplyChain } from './services/supply_chain';
export type {
  DeclaredMaterial, StockMovement, StockProvenance, StockResult, FacilityProbe, ContractProbe,
} from './services/supply_chain';
export { FactoryRuntime, AUDIT_BUREAU } from './services/factory_runtime';
export type {
  ProductionRun, ProductionRequest, InspectionReport, RunResult, RunStatus,
} from './services/factory_runtime';
export { HospitalRuntime, SERVICE_MODE_ORDER, SERVICES_MINISTRY, SERVICE_MONITOR } from './services/hospital_runtime';
export type {
  CriticalServiceMode, DeclaredServiceOperation, DeclaredCriticalService, CriticalServiceStatus,
  CriticalService, EstablishServiceInput, ServiceOperationInput, RecoveryVerificationInput,
  CriticalServiceResult, ServiceOperationReceipt, MinistryProbe as ServiceMinistryProbe,
  ServiceSourceProbe, ServiceCountProbe, CriticalServiceRuntimeDeps,
} from './services/hospital_runtime';
export { LabRuntime } from './services/lab_runtime';
export type { LabResultCandidate, LabPerformInput, LabPerformResult, LabRuntimeDeps } from './services/lab_runtime';
export { QualityControl } from './services/quality_control';
export type {
  LabQualityStatus, LabQualityDecision, LabQualityReport, LabQualityResult, QualityControlDeps,
} from './services/quality_control';
export { ContractTermination, ALL_CONTRACTS_TARGET } from './external/contract_termination';
export type { SettlementRecord, SettlementResult } from './external/contract_termination';
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
export {
  RegionRegistry, RegionalAssembly, REGIONS_COUNCIL, CROWN_RESERVED_DOMAINS,
} from './federation/region_registry';
export type {
  Region, RegionInput, RegionResult, Autonomy, Petition, AssemblyResult, GovernorProbe,
} from './federation/region_registry';
export {
  GovernorRegistry, GOVERNOR_PROPOSER, GOVERNOR_EXECUTOR, GOVERNOR_APPROVAL_TTL_MS,
} from './federation/governor';
export type { Nomination, GovernorSeat, GovernorResult, ActResult } from './federation/governor';
export {
  RegionalTribunal, REGIONAL_ARBITER, RESPONSE_WINDOW_MS,
} from './federation/dispute_resolution';
export type { Dispute, Ruling as DisputeRuling, RemedyKind, DisputeResult } from './federation/dispute_resolution';
export {
  RegionMonitor, REGION_AUDITOR, VACANCY_GRACE_MS, DISPUTE_GRACE_MS,
} from './federation/region_monitor';
export type { RegionFlag, FlagKind } from './federation/region_monitor';
export { Ledger, FINANCE_MINISTRY, DEBIT_NATURED, isValidAmount } from './economy/ledger';
export type {
  Account, AccountKind, EntryLine, EntryInput, LedgerEntry, LedgerResult, TrialBalance,
} from './economy/ledger';
export { DigitalUnit, UNIT_TARGET } from './economy/digital_unit';
export type { UnitDeclaration, UnitResult } from './economy/digital_unit';
export { Budget, TREASURY_ACTOR } from './economy/budget';
export type { Appropriation, AppropriationInput, BudgetResult, OwnerProbe } from './economy/budget';
export { Treasury } from './economy/treasury';
export type {
  Disbursement, DisbursementInput, TreasuryResult, FreezeResult,
} from './economy/treasury';
export { RevenueService, REVENUE_TARGET } from './economy/tax';
export type { Levy, LevyStatus, LevyResult, RateDeclaration } from './economy/tax';
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
