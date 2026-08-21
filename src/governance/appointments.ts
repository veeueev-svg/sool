/**
 * src/governance/appointments.ts — التعيين والعزل بمسار مفصول (المرحلة 23)
 * المالك: الديوان الملكي (الاقتراح) · الملك (الاعتماد) · حرس التاج (التنفيذ)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: اقتراح من الديوان + أمر ملكي بفعل appoint_official + تنفيذ من حرس التاج
 * المخرجات: منصب مشغول بسلسلة كاملة (اقتراح ← اعتماد ← تنفيذ)، أو رفض بسبب موثّق
 * التبعيات: سجل الوزارات، بوابة التاج، السجل غير القابل للمحو
 * الصلاحيات: ثلاث جهات مختلفة لا تجتمع في واحدة (RULE-004)
 * السجلات: office_declared / appointment_proposed / appointment_approved /
 *   appointment_executed / dismissal_proposed / dismissal_approved / dismissal_executed /
 *   appointment_refused / approval_expired
 * ثوابت هذه الوحدة:
 *   1) **فصل المسار**: المقترح ليس المعتمد، والمعتمد ليس المنفّذ — وتخلّف أي حلقة يمنع الأثر
 *   2) لا تنفيذ لاقتراح لم يُعتمد بأمر ملكي، ولو كان الاقتراح من الديوان نفسه
 *   3) لا أحد يقترح تعيين نفسه، ولا يُعيَّن في منصبين متعارضين (قاضٍ ومدّعٍ مثلًا)
 *   4) **الاعتماد يشيخ**: اعتماد لم يُنفَّذ خلال مدة معلنة يسقط ويُسجَّل — لأن
 *      اعتمادًا قديمًا يُنفَّذ بعد تغيّر الحال تنفيذٌ لظرف لم يُعتمد
 *   5) منصب واحد لصاحب واحد: التعيين في منصب مشغول مرفوض حتى يُعزل صاحبه بمساره
 *   6) العزل بنفس المسار المفصول — لا عزل إداري صامت
 *   7) لا منصب في وزارة غير قائمة، ولا شغل منصب بعد حلّ وزارته
 * حالات الفشل (كلها مغلقة): تنفيذ بلا اعتماد ⇒ رفض؛ تنفيذ من المقترح أو المعتمد ⇒ رفض؛
 *   اعتماد بعد انقضاء المدة ⇒ إسقاط؛ منصب مشغول ⇒ رفض؛ تعارض مناصب ⇒ رفض
 * اختبار القبول: tests/governance/appointments.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0007-government-and-ministries.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { MinistryRegistry, ROYAL_COURT } from './ministries';

/** الجهة المنفّذة للتعيين والعزل — لا تقترح ولا تعتمد (RULE-004) */
export const APPOINTMENT_EXECUTOR: EntityId = 'authority:crown_guard';
/** الجهة المدقّقة — تراجع السلاسل ولا تصنعها */
export const APPOINTMENT_AUDITOR: EntityId = 'authority:audit_bureau';
/** مدة صلاحية الاعتماد غير المنفَّذ: سبعة أيام معلنة لا مخفية */
export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfficeDefinition {
  readonly officeId: string;
  readonly title: string;
  readonly ministryId: EntityId;
  /** مناصب لا تُجمع مع هذا المنصب في شخص واحد */
  readonly conflictsWith: readonly string[];
}

export type ProposalKind = 'appointment' | 'dismissal';
export type ProposalStatus = 'proposed' | 'approved' | 'executed' | 'expired' | 'refused';

export interface Proposal {
  readonly proposalId: string;
  readonly kind: ProposalKind;
  readonly officeId: string;
  /** المرشَّح للتعيين، أو صاحب المنصب المطلوب عزله */
  readonly subject: EntityId;
  readonly reason: string;
  readonly proposedBy: EntityId;
  readonly proposedAt: number;
  readonly status: ProposalStatus;
  readonly approvedBy: EntityId | null;
  readonly approvedAt: number | null;
  readonly commandId: string | null;
  readonly executedBy: EntityId | null;
  readonly executedAt: number | null;
}

export interface OfficeHolder {
  readonly officeId: string;
  readonly holder: EntityId;
  readonly since: number;
  /** سلسلة المشروعية: بصمات سجلات الاقتراح والاعتماد والتنفيذ */
  readonly chain: { readonly proposed: string; readonly approved: string; readonly executed: string };
}

export type AppointmentResult =
  | { readonly ok: true; readonly proposal: Proposal; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AppointmentRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ministries: MinistryRegistry;
  readonly approvalTtlMs?: number;
}

export class AppointmentRegistry {
  private readonly offices = new Map<string, OfficeDefinition>();
  private readonly proposals = new Map<string, Proposal>();
  private readonly holders = new Map<string, OfficeHolder>();
  /** بصمات سجلات كل اقتراح: لا شغل منصب بلا سلسلة كاملة */
  private readonly trails = new Map<string, { proposed: string; approved?: string; executed?: string }>();
  private readonly approvalTtlMs: number;

  constructor(private readonly deps: AppointmentRegistryDeps) {
    this.approvalTtlMs = deps.approvalTtlMs ?? APPROVAL_TTL_MS;
    deps.ministries.bindOccupancyProbe((ministryId) => this.occupiedOffices(ministryId));
  }

  /** إعلان منصب: بأمر ملكي، وفي وزارة قائمة */
  declareOffice(
    command: SignedRoyalCommand, def: OfficeDefinition, now = Date.now(),
  ): { ok: boolean; reason?: string; auditId: string } {
    const refuse = (reason: string) => {
      const entry = this.deps.audit.append(ROYAL_COURT, 'appointment_refused', {
        officeId: def.officeId, reason, mode: 'declare_office',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (!def.officeId.startsWith('office:')) return refuse('معرّف المنصب يبدأ بـ office:');
    if (this.offices.has(def.officeId)) return refuse('منصب معلن سابقًا');
    if (!this.deps.ministries.isActive(def.ministryId)) {
      return refuse('لا منصب في وزارة غير قائمة');
    }
    if (command.payload.action !== 'amend_policy' || command.payload.target !== def.officeId) {
      return refuse('إعلان المنصب يمرّ بأمر amend_policy موجَّه إلى المنصب نفسه');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    this.offices.set(def.officeId, {
      officeId: def.officeId, title: def.title, ministryId: def.ministryId,
      conflictsWith: [...def.conflictsWith],
    });
    const entry = this.deps.audit.append(ROYAL_COURT, 'office_declared', {
      officeId: def.officeId, ministryId: def.ministryId, conflictsWith: def.conflictsWith,
    });
    return { ok: true, auditId: entry.hash };
  }

  /** 1) الاقتراح: من الديوان الملكي وحده، ولا يقترح أحد نفسه */
  propose(
    proposedBy: EntityId,
    input: { proposalId: string; kind: ProposalKind; officeId: string; subject: EntityId; reason: string },
    now = Date.now(),
  ): AppointmentResult {
    const refuse = (reason: string): AppointmentResult => {
      const entry = this.deps.audit.append(proposedBy, 'appointment_refused', {
        proposalId: input.proposalId, officeId: input.officeId, reason, stage: 'propose',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (proposedBy !== ROYAL_COURT) return refuse('الاقتراح من الديوان الملكي وحده (RULE-004)');
    if (this.proposals.has(input.proposalId)) return refuse('معرّف اقتراح مستخدم');
    if (input.reason.trim().length < 3) return refuse('لا اقتراح بلا سبب معلن (RULE-006)');
    if (input.subject === proposedBy) return refuse('لا يقترح أحد تعيين نفسه');
    const office = this.offices.get(input.officeId);
    if (!office) return refuse('منصب غير معلن');
    if (!this.deps.ministries.isActive(office.ministryId)) return refuse('وزارة المنصب غير قائمة');

    const current = this.holders.get(input.officeId);
    if (input.kind === 'appointment') {
      if (current) return refuse('منصب مشغول: يُعزل صاحبه بمساره المعلن أولًا');
      const clash = this.conflictOf(input.subject, office);
      if (clash) return refuse(`تعارض مناصب: المرشَّح يشغل ${clash}`);
    } else {
      if (!current) return refuse('لا عزل لمنصب خالٍ');
      if (current.holder !== input.subject) return refuse('المقصود بالعزل ليس صاحب المنصب');
    }
    for (const p of this.proposals.values()) {
      if (p.officeId === input.officeId && (p.status === 'proposed' || p.status === 'approved')) {
        return refuse('اقتراح قائم على المنصب نفسه — يُحسم قبل غيره');
      }
    }

    const entry = this.deps.audit.append(proposedBy,
      input.kind === 'appointment' ? 'appointment_proposed' : 'dismissal_proposed',
      { proposalId: input.proposalId, officeId: input.officeId, subject: input.subject, reason: input.reason });
    const proposal: Proposal = {
      proposalId: input.proposalId, kind: input.kind, officeId: input.officeId,
      subject: input.subject, reason: input.reason.trim(), proposedBy, proposedAt: now,
      status: 'proposed', approvedBy: null, approvedAt: null, commandId: null,
      executedBy: null, executedAt: null,
    };
    this.proposals.set(proposal.proposalId, proposal);
    this.trails.set(proposal.proposalId, { proposed: entry.hash });
    return { ok: true, proposal, auditId: entry.hash };
  }

  /** 2) الاعتماد: أمر ملكي بفعل appoint_official موجَّه إلى المعنيّ، والمعتمد ليس المقترح */
  approve(command: SignedRoyalCommand, proposalId: string, now = Date.now()): AppointmentResult {
    const refuse = (reason: string): AppointmentResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'appointment_refused', {
        proposalId, reason, stage: 'approve',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return refuse('اقتراح غير موجود');
    if (proposal.status !== 'proposed') return refuse(`حالة الاقتراح ${proposal.status} لا تقبل الاعتماد`);
    if (command.payload.issuedBy === proposal.proposedBy) {
      return refuse('المعتمد لا يكون المقترح (RULE-004)');
    }
    const decision = this.authorize(command, proposal.subject, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    const entry = this.deps.audit.append(command.payload.issuedBy,
      proposal.kind === 'appointment' ? 'appointment_approved' : 'dismissal_approved',
      { proposalId, officeId: proposal.officeId, subject: proposal.subject, commandId: command.payload.commandId });
    const approved: Proposal = {
      ...proposal, status: 'approved', approvedBy: command.payload.issuedBy,
      approvedAt: now, commandId: command.payload.commandId,
    };
    this.proposals.set(proposalId, approved);
    const trail = this.trails.get(proposalId);
    if (trail) trail.approved = entry.hash;
    return { ok: true, proposal: approved, auditId: entry.hash };
  }

  /** 3) التنفيذ: من حرس التاج وحده، وبعد اعتماد لم يشِخ */
  execute(executor: EntityId, proposalId: string, now = Date.now()): AppointmentResult {
    const refuse = (reason: string): AppointmentResult => {
      const entry = this.deps.audit.append(executor, 'appointment_refused', {
        proposalId, reason, stage: 'execute',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return refuse('اقتراح غير موجود');
    if (executor !== APPOINTMENT_EXECUTOR) return refuse('التنفيذ لحرس التاج وحده (RULE-004)');
    if (executor === proposal.proposedBy || executor === proposal.approvedBy) {
      return refuse('المنفّذ لا يكون المقترح ولا المعتمد (RULE-004)');
    }
    if (proposal.status === 'proposed') return refuse('لا تنفيذ لاقتراح لم يُعتمد بأمر ملكي');
    if (proposal.status !== 'approved') return refuse(`حالة الاقتراح ${proposal.status} لا تقبل التنفيذ`);

    const approvedAt = proposal.approvedAt ?? 0;
    if (now - approvedAt > this.approvalTtlMs) {
      const entry = this.deps.audit.append(executor, 'approval_expired', {
        proposalId, approvedAt, now, ttlMs: this.approvalTtlMs,
      });
      this.proposals.set(proposalId, { ...proposal, status: 'expired' });
      return { ok: false, reason: 'سقط الاعتماد بانقضاء مدته — يُعاد المسار من أوله', auditId: entry.hash };
    }

    const office = this.offices.get(proposal.officeId);
    if (!office) return refuse('منصب غير معلن');
    if (!this.deps.ministries.isActive(office.ministryId)) {
      return refuse('وزارة المنصب حُلّت بعد الاعتماد — لا تنفيذ في فراغ');
    }

    const trail = this.trails.get(proposalId);
    if (!trail || trail.approved === undefined) return refuse('سلسلة المشروعية ناقصة');

    if (proposal.kind === 'appointment') {
      if (this.holders.has(proposal.officeId)) return refuse('منصب مشغول');
      const clash = this.conflictOf(proposal.subject, office);
      if (clash) return refuse(`تعارض مناصب: المرشَّح يشغل ${clash}`);
      const entry = this.deps.audit.append(executor, 'appointment_executed', {
        proposalId, officeId: proposal.officeId, holder: proposal.subject,
        commandId: proposal.commandId,
      });
      trail.executed = entry.hash;
      this.holders.set(proposal.officeId, {
        officeId: proposal.officeId, holder: proposal.subject, since: now,
        chain: { proposed: trail.proposed, approved: trail.approved, executed: entry.hash },
      });
      const executed: Proposal = { ...proposal, status: 'executed', executedBy: executor, executedAt: now };
      this.proposals.set(proposalId, executed);
      return { ok: true, proposal: executed, auditId: entry.hash };
    }

    const current = this.holders.get(proposal.officeId);
    if (!current || current.holder !== proposal.subject) return refuse('صاحب المنصب تغيّر بعد الاعتماد');
    const entry = this.deps.audit.append(executor, 'dismissal_executed', {
      proposalId, officeId: proposal.officeId, former: current.holder, commandId: proposal.commandId,
    });
    trail.executed = entry.hash;
    this.holders.delete(proposal.officeId);
    const executed: Proposal = { ...proposal, status: 'executed', executedBy: executor, executedAt: now };
    this.proposals.set(proposalId, executed);
    return { ok: true, proposal: executed, auditId: entry.hash };
  }

  holderOf(officeId: string): OfficeHolder | undefined {
    return this.holders.get(officeId);
  }

  isOfficial(entity: EntityId): boolean {
    return [...this.holders.values()].some((h) => h.holder === entity);
  }

  officesOf(entity: EntityId): readonly string[] {
    return [...this.holders.values()].filter((h) => h.holder === entity).map((h) => h.officeId);
  }

  /** المناصب المشغولة في وزارة — مصدر تحقق سجل الوزارات قبل الحلّ */
  occupiedOffices(ministryId: EntityId): readonly string[] {
    return [...this.holders.values()]
      .filter((h) => this.offices.get(h.officeId)?.ministryId === ministryId)
      .map((h) => h.officeId);
  }

  proposal(proposalId: string): Proposal | undefined {
    return this.proposals.get(proposalId);
  }

  /**
   * تدقيق مستقل (RULE-006): كل منصب مشغول يجب أن تكون سلسلته كاملة.
   * يُعيد المناصب التي لا سلسلة كاملة لها — والقائمة الفارغة هي الحالة السليمة.
   */
  auditChains(auditor: EntityId = APPOINTMENT_AUDITOR): {
    readonly holders: number; readonly broken: readonly string[]; readonly auditId: string;
  } {
    const broken: string[] = [];
    for (const h of this.holders.values()) {
      if (!h.chain.proposed || !h.chain.approved || !h.chain.executed) broken.push(h.officeId);
    }
    const entry = this.deps.audit.append(auditor, 'appointment_chains_audited', {
      holders: this.holders.size, broken: [...broken],
    });
    return { holders: this.holders.size, broken, auditId: entry.hash };
  }

  report(): { offices: number; occupied: number; proposals: number; executed: number; expired: number } {
    const all = [...this.proposals.values()];
    return {
      offices: this.offices.size,
      occupied: this.holders.size,
      proposals: all.length,
      executed: all.filter((p) => p.status === 'executed').length,
      expired: all.filter((p) => p.status === 'expired').length,
    };
  }

  private conflictOf(entity: EntityId, office: OfficeDefinition): string | null {
    const held = this.officesOf(entity);
    for (const o of held) {
      if (office.conflictsWith.includes(o)) return o;
      const other = this.offices.get(o);
      if (other?.conflictsWith.includes(office.officeId)) return o;
    }
    return null;
  }

  private authorize(command: SignedRoyalCommand, subject: EntityId, now: number): Decision {
    if (command.payload.action !== 'appoint_official') {
      return { allowed: false, reason: 'التعيين والعزل بفعل appoint_official وحده', auditId: '' };
    }
    if (command.payload.target !== subject) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق المعنيّ بالاقتراح', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
