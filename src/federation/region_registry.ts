/**
 * src/federation/region_registry.ts — سجل الأقاليم ونطاقاتها المفوَّضة (المرحلة 24)
 * المالك: مجلس الأقاليم — تحت التاج، لا بجانبه
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل amend_policy موجَّه إلى معرّف الإقليم
 * المخرجات: إقليم قائم بنطاق مفوَّض لا يزاحم غيره، أو رفض بسبب موثّق
 * التبعيات: بوابة التاج (الاعتماد)، السجل غير القابل للمحو، config/regions.yaml (الإعلان)
 * الصلاحيات: التأسيس والتفويض والسحب والحلّ بأمر ملكي فقط
 * السجلات: region_established / delegation_granted / delegation_revoked /
 *           region_dissolved / region_refused / assembly_petitioned /
 *           assembly_override_refused / petition_answered
 * ثوابت هذه الوحدة:
 *   1) لا إقليم إلا بمعرّف معلن في config/regions.yaml — الكود لا يخلق أقاليم من نفسه
 *   2) **التفويض ليس سيادة**: الإقليم يمارس نطاقًا مفوَّضًا، ولا يملكه —
 *      والتفويض يُسحب بالأمر نفسه الذي منحه
 *   3) لا نطاق بمالكين: نطاق واحد لا يمارسه إلا إقليم واحد قائم
 *   4) **نطاقات التاج لا تُفوَّض أبدًا**: السيادة والتدقيق والإنهاء والهوية والسياسة
 *   5) الإقليم لا يفوّض نفسه ولا يوسّع نطاقه (RULE-005)
 *   6) **لا حلّ لإقليم وله حاكم جالس أو تفويض قائم**: يُسحب التفويض ويُعزل الحاكم أولًا،
 *      وإن لم يوجد مصدر يتحقق من الحاكم فالحلّ مرفوض (فشل مغلق لا مفتوح)
 *   7) **اجتماع الأقاليم لا ينقض الملك**: أقصى ما تستطيعه مجتمعةً التماسٌ لا أثر له
 *      إلا بأمر ملكي — ولو حضرت كلها بالإجماع (RULE-003)
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ إقليم غير معلن ⇒ رفض؛
 *   نطاق محفوظ للتاج ⇒ رفض؛ نطاق مزدحم ⇒ رفض؛ حلّ بلا مصدر تحقق ⇒ رفض؛
 *   محاولة نقض جماعي ⇒ رفض مسجَّل باسم كل حاضر
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 */
import { Decision, EntityId, SignedRoyalCommand, SovereignAction } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

/** المجلس الذي يمثّل الأقاليم مجتمعةً — يلتمس ولا يقرّر (ثابت 7) */
export const REGIONS_COUNCIL: EntityId = 'federation:regions';

/**
 * نطاقات محفوظة للتاج لا تُفوَّض لإقليم بحال.
 * سببها: تفويض أيٍّ منها يُنشئ مركز قرار مستقلًّا عن التاج — أي انقسام سيادة.
 */
export const CROWN_RESERVED_DOMAINS: readonly string[] = [
  'sovereignty', 'audit', 'termination', 'identity', 'policy', 'justice',
];

export type Autonomy = 'limited' | 'delegated';

export interface Region {
  readonly regionId: EntityId;
  readonly name: string;
  /** limited: لا نطاق مفوَّض | delegated: يمارس نطاقات معلنة */
  readonly autonomy: Autonomy;
  readonly domains: readonly string[];
  readonly establishedBy: EntityId;
  readonly establishedAt: number;
  readonly commandId: string;
  readonly delegationCommandId: string | null;
  readonly dissolvedAt: number | null;
  readonly dissolveReason: string | null;
}

export interface RegionInput {
  readonly regionId: EntityId;
  readonly name: string;
  readonly proposedBy: EntityId;
}

export type RegionResult =
  | { readonly ok: true; readonly region: Region; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** مصدر يتحقق من حاكم إقليم — يُربط من سجل الحكّام (فشل مغلق قبل الربط) */
export type GovernorProbe = (regionId: EntityId) => EntityId | null;

export interface RegionRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  /** معرّفات الأقاليم المعلنة في config/regions.yaml (ثابت 1) */
  readonly declaredRegions: readonly string[];
  readonly actorId?: EntityId;
}

export class RegionRegistry {
  private readonly regions = new Map<EntityId, Region>();
  private readonly actorId: EntityId;
  /** يبقى null حتى يُربط: والحلّ بلا ربط مرفوض (ثابت 6) */
  private governorProbe: GovernorProbe | null = null;

  constructor(private readonly deps: RegionRegistryDeps) {
    this.actorId = deps.actorId ?? REGIONS_COUNCIL;
  }

  /**
   * ربط مصدر التحقق من الحاكم (سجل الحكّام) — يُستدعى مرة عند التأسيس.
   * لا يُكتب سجل تدقيق هنا عن قصد: التأسيس يُختم بسجل `state_online` وحده،
   * وغياب الربط ليس حادثًا صامتًا لأن الحلّ يُرفض ويُسجَّل عند أول محاولة.
   */
  bindGovernorProbe(probe: GovernorProbe): void {
    this.governorProbe = probe;
  }

  /** 1) التأسيس: بأمر ملكي معتمد، ولمعرّف معلن في التهيئة */
  establish(command: SignedRoyalCommand, input: RegionInput, now = Date.now()): RegionResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): RegionResult => {
      const entry = this.deps.audit.append(this.actorId, 'region_refused', {
        regionId: input.regionId, reason, mode: 'establish', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (!input.regionId.startsWith('region:')) {
      return refuse('معرّف الإقليم يجب أن يبدأ بـ region:');
    }
    if (!this.deps.declaredRegions.includes(input.regionId)) {
      return refuse('إقليم غير معلن في config/regions.yaml — لا إقليم يخلق نفسه (ثابت 1)');
    }
    if (input.name.trim().length < 3) return refuse('لا إقليم بلا اسم معلن');
    if (input.proposedBy === input.regionId) {
      return refuse('الإقليم لا يقترح تأسيس نفسه (RULE-005)');
    }
    const existing = this.regions.get(input.regionId);
    if (existing && existing.dissolvedAt === null) return refuse('إقليم بهذا المعرّف قائم');

    const authorized = this.authorize(command, input.regionId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const region: Region = {
      regionId: input.regionId,
      name: input.name.trim(),
      autonomy: 'limited',
      domains: [],
      establishedBy: command.payload.issuedBy,
      establishedAt: now,
      commandId: command.payload.commandId,
      delegationCommandId: null,
      dissolvedAt: null,
      dissolveReason: null,
    };
    this.regions.set(region.regionId, region);
    const entry = this.deps.audit.append(this.actorId, 'region_established', {
      regionId: region.regionId, name: region.name,
      proposedBy: input.proposedBy, commandId: region.commandId, autonomy: region.autonomy,
    });
    return { ok: true, region, auditId: entry.hash };
  }

  /** 2) التفويض: منح نطاقات مُمارسة — لا ملكيةً ولا سيادة (ثوابت 2 و3 و4) */
  delegate(
    command: SignedRoyalCommand, regionId: EntityId, domains: readonly string[], now = Date.now(),
  ): RegionResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): RegionResult => {
      const entry = this.deps.audit.append(this.actorId, 'region_refused', {
        regionId, reason, mode: 'delegate', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const current = this.regions.get(regionId);
    if (!current || current.dissolvedAt !== null) return refuse('إقليم غير قائم');
    if (domains.length === 0) return refuse('لا تفويض بلا نطاق معلن');
    if (command.payload.issuedBy === regionId) {
      return refuse('الإقليم لا يفوّض نفسه (RULE-005)');
    }

    for (const domain of domains) {
      if (domain.trim().length === 0) return refuse('نطاق فارغ لا يُفوَّض');
      if (CROWN_RESERVED_DOMAINS.includes(domain)) {
        return refuse(`نطاق محفوظ للتاج لا يُفوَّض: «${domain}» (ثابت 4)`, { domain });
      }
      const owner = this.competentFor(domain);
      if (owner && owner.regionId !== regionId) {
        return refuse(`تزاحم نطاق: «${domain}» يمارسه ${owner.regionId}`, { domain });
      }
    }

    const authorized = this.authorize(command, regionId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const updated: Region = {
      ...current,
      autonomy: 'delegated',
      domains: [...domains],
      delegationCommandId: command.payload.commandId,
    };
    this.regions.set(regionId, updated);
    const entry = this.deps.audit.append(this.actorId, 'delegation_granted', {
      regionId, from: current.domains, to: updated.domains, commandId: command.payload.commandId,
    });
    return { ok: true, region: updated, auditId: entry.hash };
  }

  /** 3) السحب: يعود الإقليم محدود الاستقلال — بالأمر نفسه الذي منحه (ثابت 2) */
  revokeDelegation(
    command: SignedRoyalCommand, regionId: EntityId, reason: string, now = Date.now(),
  ): RegionResult {
    const refuse = (why: string): RegionResult => {
      const entry = this.deps.audit.append(this.actorId, 'region_refused', {
        regionId, reason: why, mode: 'revoke',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.regions.get(regionId);
    if (!current || current.dissolvedAt !== null) return refuse('إقليم غير قائم');
    if (current.autonomy !== 'delegated') return refuse('لا تفويض قائمًا يُسحب');
    if (reason.trim().length < 3) return refuse('لا سحب بلا سبب معلن (RULE-006)');

    const authorized = this.authorize(command, regionId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const updated: Region = {
      ...current, autonomy: 'limited', domains: [], delegationCommandId: null,
    };
    this.regions.set(regionId, updated);
    const entry = this.deps.audit.append(this.actorId, 'delegation_revoked', {
      regionId, revoked: current.domains, reason: reason.trim(),
      commandId: command.payload.commandId,
    });
    return { ok: true, region: updated, auditId: entry.hash };
  }

  /** 4) الحلّ: بأمر ملكي، وبشرط لا تفويض قائم ولا حاكم جالس (ثابت 6) */
  dissolve(
    command: SignedRoyalCommand, regionId: EntityId, reason: string, now = Date.now(),
  ): RegionResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): RegionResult => {
      const entry = this.deps.audit.append(this.actorId, 'region_refused', {
        regionId, reason: why, mode: 'dissolve', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.regions.get(regionId);
    if (!current || current.dissolvedAt !== null) return refuse('إقليم غير قائم');
    if (reason.trim().length < 3) return refuse('لا حلّ بلا سبب معلن (RULE-006)');
    if (current.autonomy === 'delegated') {
      return refuse('تفويض قائم: يُسحب بمساره المعلن أولًا', { domains: [...current.domains] });
    }
    if (this.governorProbe === null) {
      return refuse('لا مصدر يتحقق من حاكم الإقليم — الحلّ مرفوض حتى يُربط سجل الحكّام');
    }
    const seated = this.governorProbe(regionId);
    if (seated !== null) {
      return refuse('حاكم جالس: يُعزل بمساره المعلن أولًا', { governor: seated });
    }
    const authorized = this.authorize(command, regionId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const dissolved: Region = { ...current, dissolvedAt: now, dissolveReason: reason.trim() };
    this.regions.set(regionId, dissolved);
    const entry = this.deps.audit.append(this.actorId, 'region_dissolved', {
      regionId, reason: dissolved.dissolveReason, commandId: command.payload.commandId,
    });
    return { ok: true, region: dissolved, auditId: entry.hash };
  }

  /** الإقليم القائم الممارس لنطاق ما — أو null */
  competentFor(domain: string): Region | null {
    for (const r of this.regions.values()) {
      if (r.dissolvedAt === null && r.domains.includes(domain)) return r;
    }
    return null;
  }

  hasDomain(regionId: EntityId, domain: string): boolean {
    const r = this.regions.get(regionId);
    return r !== undefined && r.dissolvedAt === null && r.autonomy === 'delegated'
      && r.domains.includes(domain);
  }

  isActive(regionId: EntityId): boolean {
    const r = this.regions.get(regionId);
    return r !== undefined && r.dissolvedAt === null;
  }

  get(regionId: EntityId): Region | undefined {
    return this.regions.get(regionId);
  }

  active(): readonly Region[] {
    return [...this.regions.values()].filter((r) => r.dissolvedAt === null);
  }

  report(): {
    total: number; active: number; dissolved: number; delegated: number; domains: number;
    declared: number;
  } {
    const all = [...this.regions.values()];
    const active = all.filter((r) => r.dissolvedAt === null);
    const domains = new Set<string>();
    for (const r of active) for (const d of r.domains) domains.add(d);
    return {
      total: all.length,
      active: active.length,
      dissolved: all.length - active.length,
      delegated: active.filter((r) => r.autonomy === 'delegated').length,
      domains: domains.size,
      declared: this.deps.declaredRegions.length,
    };
  }

  /** الاعتماد: فعل amend_policy وهدفه الإقليم نفسه لا غيره */
  private authorize(command: SignedRoyalCommand, regionId: EntityId, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      return { allowed: false, reason: 'بنية الاتحاد تُعدَّل بفعل amend_policy وحده', auditId: '' };
    }
    if (command.payload.target !== regionId) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق الإقليم', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}

/* ————————————————— اجتماع الأقاليم ————————————————— */

export type PetitionStatus = 'pending' | 'accepted' | 'rejected';

export interface Petition {
  readonly petitionId: string;
  readonly attendees: readonly EntityId[];
  readonly subject: string;
  readonly unanimous: boolean;
  readonly raisedAt: number;
  readonly status: PetitionStatus;
  readonly answeredBy: EntityId | null;
  readonly answeredAt: number | null;
  readonly commandId: string | null;
}

export type AssemblyResult =
  | { readonly ok: true; readonly petition: Petition; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface RegionalAssemblyDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly regions: RegionRegistry;
}

/**
 * مجلس الأقاليم مجتمعةً: يلتمس ولا يقرّر (ثابت 7).
 * الفرق جوهري: الالتماس بلا أثر حتى يجيبه الملك بأمر معتمد؛
 * ومحاولة النقض مرفوضة بذاتها ولو حضرت كل الأقاليم بالإجماع.
 */
export class RegionalAssembly {
  private readonly petitions = new Map<string, Petition>();

  constructor(private readonly deps: RegionalAssemblyDeps) {}

  /** التماس جماعي: أقصى ما يستطيعه الاجتماع */
  petition(
    attendees: readonly EntityId[], input: { petitionId: string; subject: string }, now = Date.now(),
  ): AssemblyResult {
    const refuse = (reason: string): AssemblyResult => {
      const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_refused', {
        petitionId: input.petitionId, reason, attending: attendees.length,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (this.petitions.has(input.petitionId)) return refuse('معرّف التماس مستخدم');
    if (input.subject.trim().length < 3) return refuse('لا التماس بلا موضوع معلن');
    if (attendees.length < 2) return refuse('لا اجتماع بأقل من إقليمين');
    if (new Set(attendees).size !== attendees.length) return refuse('حضور مكرَّر لا يُعتدّ به');
    const absent = attendees.filter((a) => !this.deps.regions.isActive(a));
    if (absent.length > 0) return refuse('حاضر ليس إقليمًا قائمًا');

    const totalActive = this.deps.regions.active().length;
    const petition: Petition = {
      petitionId: input.petitionId,
      attendees: [...attendees],
      subject: input.subject.trim(),
      unanimous: attendees.length === totalActive,
      raisedAt: now,
      status: 'pending',
      answeredBy: null,
      answeredAt: null,
      commandId: null,
    };
    this.petitions.set(petition.petitionId, petition);
    const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_petitioned', {
      petitionId: petition.petitionId, subject: petition.subject,
      attending: petition.attendees.length, totalActive, unanimous: petition.unanimous,
      effect: 'لا أثر حتى أمر ملكي',
    });
    return { ok: true, petition, auditId: entry.hash };
  }

  /**
   * محاولة نقض جماعي: مرفوضة دائمًا — ولو بالإجماع الكامل.
   * تُمرَّر إلى بوابة التاج لتسجيلها باسم الاجتماع، ثم تُسجَّل هنا ثانيًا بالعدد والنسبة.
   */
  override(
    attendees: readonly EntityId[], action: SovereignAction, now = Date.now(),
  ): { readonly allowed: false; readonly reason: string; readonly auditId: string } {
    const decision = this.deps.gateway.collectiveOverride(attendees, action);
    const totalActive = this.deps.regions.active().length;
    const entry = this.deps.audit.append(REGIONS_COUNCIL, 'assembly_override_refused', {
      action, attending: attendees.length, totalActive,
      unanimous: totalActive > 0 && attendees.length >= totalActive,
      gatewayReason: decision.reason, at: now,
    });
    return { allowed: false, reason: decision.reason ?? 'اجتماع الأقاليم لا ينقض الملك', auditId: entry.hash };
  }

  /** جواب الملك على الالتماس: أمر معتمد موجَّه إلى مجلس الأقاليم */
  answer(
    command: SignedRoyalCommand, petitionId: string, verdict: 'accepted' | 'rejected',
    now = Date.now(),
  ): AssemblyResult {
    const refuse = (reason: string): AssemblyResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'assembly_refused', {
        petitionId, reason, stage: 'answer',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const petition = this.petitions.get(petitionId);
    if (!petition) return refuse('التماس غير موجود');
    if (petition.status !== 'pending') return refuse(`التماس محسوم سابقًا: ${petition.status}`);
    if (command.payload.action !== 'amend_policy') {
      return refuse('جواب الالتماس بفعل amend_policy وحده');
    }
    if (command.payload.target !== REGIONS_COUNCIL) {
      return refuse('هدف الأمر لا يطابق مجلس الأقاليم');
    }
    if (petition.attendees.includes(command.payload.issuedBy)) {
      return refuse('الملتمس لا يجيب التماسه (RULE-004)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    const answered: Petition = {
      ...petition, status: verdict, answeredBy: command.payload.issuedBy,
      answeredAt: now, commandId: command.payload.commandId,
    };
    this.petitions.set(petitionId, answered);
    const entry = this.deps.audit.append(command.payload.issuedBy, 'petition_answered', {
      petitionId, verdict, commandId: command.payload.commandId,
    });
    return { ok: true, petition: answered, auditId: entry.hash };
  }

  getPetition(petitionId: string): Petition | undefined {
    return this.petitions.get(petitionId);
  }

  pending(): readonly Petition[] {
    return [...this.petitions.values()].filter((p) => p.status === 'pending');
  }

  report(): { total: number; pending: number; accepted: number; rejected: number } {
    const all = [...this.petitions.values()];
    return {
      total: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      accepted: all.filter((p) => p.status === 'accepted').length,
      rejected: all.filter((p) => p.status === 'rejected').length,
    };
  }
}
