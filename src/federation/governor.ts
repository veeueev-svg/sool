/**
 * src/federation/governor.ts — سجل حكّام الأقاليم (المرحلة 24)
 * المالك: الديوان الملكي (الاقتراح) وحرس التاج (التنفيذ)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: ترشيح من الديوان ← اعتماد بأمر ملكي appoint_official ← تنفيذ من الحرس
 * المخرجات: حاكم جالس يمارس النطاق المفوَّض لإقليمه وحده، أو رفض بسبب موثّق
 * التبعيات: سجل الأقاليم، بوابة التاج، السجل غير القابل للمحو
 * السجلات: governor_proposed / governor_approved / governor_seated /
 *           recall_proposed / recall_approved / governor_recalled /
 *           governor_refused / region_action_executed / governor_act_refused /
 *           governor_approval_expired
 * ثوابت هذه الوحدة:
 *   1) **الإقليم لا يختار حاكمه**: الترشيح من الديوان الملكي، والاعتماد ملكي،
 *      والتنفيذ من الحرس — ثلاث جهات لا تجتمع في واحدة (RULE-004)
 *   2) لا حاكم لإقليمين: الجمع يجعل نطاقين بقرار واحد
 *   3) الحاكم يفعل داخل النطاق المفوَّض لإقليمه وحده — وخارجه رفض مسجَّل
 *   4) **سحب التفويض يُسكت الحاكم فورًا**: لا يبقى له فعل بعد السحب
 *   5) الحاكم لا يبلغ فعلًا سياديًا بحال — ولو كان النطاق مفوَّضًا له
 *   6) العزل يمرّ بالمسار الثلاثي نفسه: لا عزل بقرار جهة واحدة
 *   7) الاعتماد يشيخ: تنفيذ بعد انقضاء المدة مرفوض ويعاد المسار من أوله
 * حالات الفشل (كلها مغلقة): ترشيح من غير الديوان ⇒ رفض؛ ترشيح الإقليم لحاكمه ⇒ رفض؛
 *   اعتماد من المقترح ⇒ رفض؛ تنفيذ من غير الحرس ⇒ رفض؛ فعل خارج النطاق ⇒ رفض؛
 *   فعل بعد سحب التفويض أو حلّ الإقليم ⇒ رفض؛ فعل سيادي ⇒ رفض
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 */
import { Decision, EntityId, SignedRoyalCommand, SovereignAction } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { RegionRegistry } from './region_registry';

/** الجهة التي ترشّح الحكّام — ولا تعتمد ولا تنفّذ (RULE-004) */
export const GOVERNOR_PROPOSER: EntityId = 'authority:royal_court';
/** الجهة التي تنفّذ الجلوس والعزل */
export const GOVERNOR_EXECUTOR: EntityId = 'authority:crown_guard';
/** مدة صلاحية الاعتماد قبل أن يشيخ */
export const GOVERNOR_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type NominationKind = 'appointment' | 'recall';
export type NominationStatus = 'proposed' | 'approved' | 'executed' | 'expired';

export interface Nomination {
  readonly nominationId: string;
  readonly kind: NominationKind;
  readonly regionId: EntityId;
  readonly candidate: EntityId;
  readonly reason: string;
  readonly proposedBy: EntityId;
  readonly proposedAt: number;
  readonly status: NominationStatus;
  readonly approvedBy: EntityId | null;
  readonly approvedAt: number | null;
  readonly commandId: string | null;
  readonly executedBy: EntityId | null;
  readonly executedAt: number | null;
}

export interface GovernorSeat {
  readonly regionId: EntityId;
  readonly governor: EntityId;
  readonly since: number;
  /** سلسلة المسؤولية الثلاثية: من اقترح، من اعتمد، من نفّذ (RULE-006) */
  readonly chain: { readonly proposed: string; readonly approved: string; readonly executed: string };
}

export type GovernorResult =
  | { readonly ok: true; readonly nomination: Nomination; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export type ActResult =
  | { readonly ok: true; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface GovernorRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly regions: RegionRegistry;
  readonly approvalTtlMs?: number;
}

export class GovernorRegistry {
  private readonly nominations = new Map<string, Nomination>();
  private readonly seats = new Map<EntityId, GovernorSeat>();
  private readonly trails = new Map<string, { proposed: string; approved?: string; executed?: string }>();
  private readonly approvalTtlMs: number;

  constructor(private readonly deps: GovernorRegistryDeps) {
    this.approvalTtlMs = deps.approvalTtlMs ?? GOVERNOR_APPROVAL_TTL_MS;
    // يربط نفسه مصدرًا للتحقق من الحاكم قبل حلّ الإقليم (فشل مغلق في سجل الأقاليم)
    this.deps.regions.bindGovernorProbe((regionId) => this.governorOf(regionId)?.governor ?? null);
  }

  /** 1) الترشيح: من الديوان الملكي وحده — والإقليم لا يرشّح حاكمه (ثابت 1) */
  propose(
    proposedBy: EntityId,
    input: {
      nominationId: string; kind: NominationKind; regionId: EntityId;
      candidate: EntityId; reason: string;
    },
    now = Date.now(),
  ): GovernorResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): GovernorResult => {
      const entry = this.deps.audit.append(proposedBy, 'governor_refused', {
        nominationId: input.nominationId, regionId: input.regionId, reason, stage: 'propose', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (proposedBy !== GOVERNOR_PROPOSER) {
      return refuse('الترشيح من الديوان الملكي وحده — والإقليم لا يختار حاكمه (ثابت 1)');
    }
    if (input.regionId === proposedBy) return refuse('الإقليم لا يرشّح حاكمه');
    if (this.nominations.has(input.nominationId)) return refuse('معرّف ترشيح مستخدم');
    if (input.reason.trim().length < 3) return refuse('لا ترشيح بلا سبب معلن (RULE-006)');
    if (input.candidate === input.regionId) return refuse('الإقليم لا يكون حاكم نفسه');
    if (input.candidate === proposedBy) return refuse('لا يرشّح المقترح نفسه (RULE-004)');
    if (!this.deps.regions.isActive(input.regionId)) return refuse('إقليم غير قائم');

    const seat = this.seats.get(input.regionId);
    if (input.kind === 'appointment') {
      if (seat) return refuse('مقعد مشغول: يُعزل صاحبه بمساره المعلن أولًا');
      const elsewhere = [...this.seats.values()].find((s) => s.governor === input.candidate);
      if (elsewhere) {
        return refuse(`لا حاكم لإقليمين: المرشَّح يحكم ${elsewhere.regionId} (ثابت 2)`);
      }
    } else {
      if (!seat) return refuse('لا عزل لمقعد خالٍ');
      if (seat.governor !== input.candidate) return refuse('المقصود بالعزل ليس حاكم الإقليم');
    }
    for (const n of this.nominations.values()) {
      if (n.regionId === input.regionId && (n.status === 'proposed' || n.status === 'approved')) {
        return refuse('ترشيح قائم على الإقليم نفسه — يُحسم قبل غيره');
      }
    }

    const entry = this.deps.audit.append(proposedBy,
      input.kind === 'appointment' ? 'governor_proposed' : 'recall_proposed',
      {
        nominationId: input.nominationId, regionId: input.regionId,
        candidate: input.candidate, reason: input.reason.trim(),
      });
    const nomination: Nomination = {
      nominationId: input.nominationId, kind: input.kind, regionId: input.regionId,
      candidate: input.candidate, reason: input.reason.trim(), proposedBy, proposedAt: now,
      status: 'proposed', approvedBy: null, approvedAt: null, commandId: null,
      executedBy: null, executedAt: null,
    };
    this.nominations.set(nomination.nominationId, nomination);
    this.trails.set(nomination.nominationId, { proposed: entry.hash });
    return { ok: true, nomination, auditId: entry.hash };
  }

  /** 2) الاعتماد: أمر ملكي بفعل appoint_official موجَّه إلى المرشَّح، والمعتمد ليس المقترح */
  approve(command: SignedRoyalCommand, nominationId: string, now = Date.now()): GovernorResult {
    const refuse = (reason: string): GovernorResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'governor_refused', {
        nominationId, reason, stage: 'approve',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const nomination = this.nominations.get(nominationId);
    if (!nomination) return refuse('ترشيح غير موجود');
    if (nomination.status !== 'proposed') {
      return refuse(`حالة الترشيح ${nomination.status} لا تقبل الاعتماد`);
    }
    if (command.payload.issuedBy === nomination.proposedBy) {
      return refuse('المعتمد لا يكون المقترح (RULE-004)');
    }
    if (command.payload.issuedBy === nomination.regionId) {
      return refuse('الإقليم لا يعتمد حاكمه (ثابت 1)');
    }
    const decision = this.authorize(command, nomination.candidate, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    const entry = this.deps.audit.append(command.payload.issuedBy,
      nomination.kind === 'appointment' ? 'governor_approved' : 'recall_approved',
      {
        nominationId, regionId: nomination.regionId, candidate: nomination.candidate,
        commandId: command.payload.commandId,
      });
    const approved: Nomination = {
      ...nomination, status: 'approved', approvedBy: command.payload.issuedBy,
      approvedAt: now, commandId: command.payload.commandId,
    };
    this.nominations.set(nominationId, approved);
    const trail = this.trails.get(nominationId);
    if (trail) trail.approved = entry.hash;
    return { ok: true, nomination: approved, auditId: entry.hash };
  }

  /** 3) التنفيذ: من حرس التاج وحده، وبعد اعتماد لم يشِخ (ثابت 7) */
  execute(executor: EntityId, nominationId: string, now = Date.now()): GovernorResult {
    const refuse = (reason: string): GovernorResult => {
      const entry = this.deps.audit.append(executor, 'governor_refused', {
        nominationId, reason, stage: 'execute',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const nomination = this.nominations.get(nominationId);
    if (!nomination) return refuse('ترشيح غير موجود');
    if (executor !== GOVERNOR_EXECUTOR) return refuse('التنفيذ لحرس التاج وحده (RULE-004)');
    if (executor === nomination.proposedBy || executor === nomination.approvedBy) {
      return refuse('المنفّذ لا يكون المقترح ولا المعتمد (RULE-004)');
    }
    if (nomination.status === 'proposed') return refuse('لا تنفيذ لترشيح لم يُعتمد بأمر ملكي');
    if (nomination.status !== 'approved') {
      return refuse(`حالة الترشيح ${nomination.status} لا تقبل التنفيذ`);
    }
    const approvedAt = nomination.approvedAt ?? 0;
    if (now - approvedAt > this.approvalTtlMs) {
      const entry = this.deps.audit.append(executor, 'governor_approval_expired', {
        nominationId, approvedAt, now, ttlMs: this.approvalTtlMs,
      });
      this.nominations.set(nominationId, { ...nomination, status: 'expired' });
      return { ok: false, reason: 'سقط الاعتماد بانقضاء مدته — يُعاد المسار من أوله', auditId: entry.hash };
    }
    // لا تنفيذ في فراغ: الإقليم قد يُحلّ بين الاعتماد والتنفيذ
    if (!this.deps.regions.isActive(nomination.regionId)) return refuse('إقليم غير قائم');

    const trail = this.trails.get(nominationId);
    if (nomination.kind === 'appointment') {
      if (this.seats.has(nomination.regionId)) return refuse('مقعد مشغول');
      const entry = this.deps.audit.append(executor, 'governor_seated', {
        nominationId, regionId: nomination.regionId, governor: nomination.candidate,
        chain: {
          proposed: nomination.proposedBy, approved: nomination.approvedBy, executed: executor,
        },
      });
      this.seats.set(nomination.regionId, {
        regionId: nomination.regionId,
        governor: nomination.candidate,
        since: now,
        chain: {
          proposed: trail?.proposed ?? '', approved: trail?.approved ?? '', executed: entry.hash,
        },
      });
      const executed: Nomination = {
        ...nomination, status: 'executed', executedBy: executor, executedAt: now,
      };
      this.nominations.set(nominationId, executed);
      if (trail) trail.executed = entry.hash;
      return { ok: true, nomination: executed, auditId: entry.hash };
    }

    const seat = this.seats.get(nomination.regionId);
    if (!seat || seat.governor !== nomination.candidate) return refuse('حاكم الإقليم تغيّر — يُعاد المسار');
    this.seats.delete(nomination.regionId);
    const entry = this.deps.audit.append(executor, 'governor_recalled', {
      nominationId, regionId: nomination.regionId, governor: nomination.candidate,
      reason: nomination.reason,
      chain: { proposed: nomination.proposedBy, approved: nomination.approvedBy, executed: executor },
    });
    const executed: Nomination = {
      ...nomination, status: 'executed', executedBy: executor, executedAt: now,
    };
    this.nominations.set(nominationId, executed);
    if (trail) trail.executed = entry.hash;
    return { ok: true, nomination: executed, auditId: entry.hash };
  }

  /**
   * فعل الحاكم: داخل النطاق المفوَّض لإقليمه وحده (ثوابت 3 و4 و5).
   * الفعل الإداري لا يمرّ بالبوابة — لكنه يُسجَّل، ويُرفض إن تجاوز النطاق.
   */
  act(
    governor: EntityId,
    input: { regionId: EntityId; domain: string; action: string; sovereign?: SovereignAction },
    now = Date.now(),
  ): ActResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): ActResult => {
      const entry = this.deps.audit.append(governor, 'governor_act_refused', {
        regionId: input.regionId, domain: input.domain, action: input.action, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const seat = this.seats.get(input.regionId);
    if (!seat || seat.governor !== governor) return refuse('ليس حاكم هذا الإقليم');
    if (!this.deps.regions.isActive(input.regionId)) return refuse('إقليم غير قائم');
    if (input.action.trim().length < 3) return refuse('لا فعل بلا وصف معلن (RULE-006)');
    if (input.sovereign !== undefined) {
      return refuse('الحاكم لا يبلغ فعلًا سياديًا — السيادة للتاج وحده (ثابت 5)', {
        attempted: input.sovereign,
      });
    }
    if (!this.deps.regions.hasDomain(input.regionId, input.domain)) {
      return refuse('خارج النطاق المفوَّض — أو التفويض مسحوب (ثوابت 3 و4)');
    }

    const entry = this.deps.audit.append(governor, 'region_action_executed', {
      regionId: input.regionId, domain: input.domain, action: input.action.trim(), at: now,
    });
    return { ok: true, auditId: entry.hash };
  }

  governorOf(regionId: EntityId): GovernorSeat | undefined {
    return this.seats.get(regionId);
  }

  isGovernor(entity: EntityId): boolean {
    return [...this.seats.values()].some((s) => s.governor === entity);
  }

  seatedRegions(): readonly GovernorSeat[] {
    return [...this.seats.values()];
  }

  nomination(nominationId: string): Nomination | undefined {
    return this.nominations.get(nominationId);
  }

  /** سلاسل المسؤولية: لكل ترشيح من اقترح ومن اعتمد ومن نفّذ (RULE-006) */
  auditChains(): Record<string, { proposed: string; approved?: string; executed?: string }> {
    const out: Record<string, { proposed: string; approved?: string; executed?: string }> = {};
    for (const [id, trail] of this.trails) out[id] = { ...trail };
    return out;
  }

  report(): { nominations: number; seated: number; vacant: number; expired: number } {
    const all = [...this.nominations.values()];
    const activeRegions = this.deps.regions.active();
    return {
      nominations: all.length,
      seated: this.seats.size,
      vacant: activeRegions.filter((r) => !this.seats.has(r.regionId)).length,
      expired: all.filter((n) => n.status === 'expired').length,
    };
  }

  /** الاعتماد: فعل appoint_official وهدفه المرشَّح نفسه */
  private authorize(command: SignedRoyalCommand, candidate: EntityId, now: number): Decision {
    if (command.payload.action !== 'appoint_official') {
      return { allowed: false, reason: 'جلوس الحاكم بفعل appoint_official وحده', auditId: '' };
    }
    if (command.payload.target !== candidate) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق المرشَّح', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
