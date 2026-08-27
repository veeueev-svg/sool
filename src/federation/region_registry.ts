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
 *      إلا بأمر ملكي — ولو حضرت كلها بالإجماع (RULE-003) — ومحلُّه الآن
 *      src/federation/regional_assembly.ts وهذا الملفُ يُعيد تصديرَه
 *  10) **تفكيكُ الجلسة 41 (البند T-113)**: كان هذا الملفُ **454 سطرًا** فوق سقف 400،
 *      فخرجت الأشكالُ والإعلاناتُ إلى region_types.ts، وخرج **اجتماعُ الأقاليم** إلى
 *      regional_assembly.ts لأنه سلطةٌ أخرى: السجلُّ يقرّر بأمرٍ ملكي، والاجتماعُ لا
 *      يقرّر شيئًا. والنقلُ **حرفيٌّ بلا إصلاح**، والواجهةُ باقيةٌ في هذا المسار
 *      (إعادةُ تصديرٍ أدناه) فلم يُعدَّل مستوردٌ ولا اختبار، والدليلُ خطُّ الأساس نفسه
 *      أخضر. وحُذف صفُّ استثنائه من scripts/limits/module_limits.yaml بلا رفع سقف (سقّاطة)
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ إقليم غير معلن ⇒ رفض؛
 *   نطاق محفوظ للتاج ⇒ رفض؛ نطاق مزدحم ⇒ رفض؛ حلّ بلا مصدر تحقق ⇒ رفض؛
 *   محاولة نقض جماعي ⇒ رفض مسجَّل باسم كل حاضر
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import {
  CROWN_RESERVED_DOMAINS, GovernorProbe, Region, RegionInput, RegionRegistryDeps, RegionResult,
  REGIONS_COUNCIL,
} from './region_types';

/**
 * إعادةُ تصديرٍ للواجهة: من كان يستورد من هذا المسار يجد ما كان يجده حرفًا —
 * فالتفكيكُ لا يُكسر مستوردًا (ثابت 10). ومن أراد الأصلَ فوحدتُه مكتوبةٌ أعلاه.
 */
export {
  CROWN_RESERVED_DOMAINS, REGIONS_COUNCIL,
} from './region_types';
export type {
  Autonomy, AssemblyResult, GovernorProbe, Petition, PetitionStatus, Region, RegionInput,
  RegionRegistryDeps, RegionResult,
} from './region_types';
export { RegionalAssembly } from './regional_assembly';
export type { RegionalAssemblyDeps } from './regional_assembly';

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
