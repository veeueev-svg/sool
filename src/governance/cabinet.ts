/**
 * src/governance/cabinet.ts — مجلس الوزراء: قرار جماعي لا يعلو على التاج (المرحلة 23)
 * المالك: الديوان الملكي
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: جلسة يحضرها أصحاب مناصب قائمون + قرار في نطاق اختصاص معلن
 * المخرجات: قرار مسجَّل بأصواته وجهة تنفيذه، أو رفض بسبب موثّق
 * التبعيات: سجل الوزارات، سجل التعيينات، بوابة التاج، السجل غير القابل للمحو
 * الصلاحيات: للمجلس أن يقرّر في اختصاصه، وليس له فعل سيادي ولو أجمع
 * السجلات: cabinet_convened / cabinet_decided / cabinet_decision_executed /
 *   cabinet_refused / cabinet_quorum_failed / cabinet_override_refused
 * ثوابت هذه الوحدة:
 *   1) **الإجماع ليس سلطة**: قرار جماعي في فعل سيادي مرفوض ولو اتفق كل الوزراء —
 *      لأن جمع الأصوات لو صار طريقًا ثانيًا للسيادة لصار الطريق الأول زينة
 *   2) لا يحضر الجلسة إلا صاحب منصب قائم — والمعزول لا يصوّت
 *   3) لا قرار بلا نصاب معلن (أكثر من نصف أصحاب المناصب الحاضرين للمجلس)
 *   4) لا يصوّت إلا حاضر، ولا يصوّت أحد مرتين، والصوت يُسجَّل باسم صاحبه
 *   5) **لا تنفيذ من غير ذي اختصاص**: القرار ينفّذه صاحب النطاق وحده
 *   6) القرار لا يُعدَّل بعد إعلانه: يُنقض بقرار جديد مسجَّل أو بنقض ملكي
 * حالات الفشل (كلها مغلقة): حضور غير أهل ⇒ رفض؛ نصاب ناقص ⇒ رفض؛ فعل سيادي ⇒ رفض؛
 *   تنفيذ من غير ذي اختصاص ⇒ رفض؛ تنفيذ قرار ساقط ⇒ رفض
 * اختبار القبول: tests/governance/cabinet.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0007-government-and-ministries.md
 */
import { EntityId, SignedRoyalCommand, SovereignAction } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { MinistryRegistry, ROYAL_COURT } from './ministries';
import { AppointmentRegistry } from './appointments';

/** الأفعال المحجوزة للتاج — لا يبلغها قرار جماعي (ثابت 1) */
export const RESERVED_FOR_CROWN: readonly SovereignAction[] = [
  'create_agent', 'grant_capability', 'appoint_official', 'amend_policy', 'approve_phase',
  'terminate_agent', 'declare_emergency', 'open_external_account', 'import_artifact',
  'train_model', 'archive_restore', 'judicial_review',
];

export type Vote = 'for' | 'against' | 'abstain';

export interface CabinetSession {
  readonly sessionId: string;
  readonly convenedBy: EntityId;
  readonly attendees: readonly EntityId[];
  readonly at: number;
  readonly quorum: number;
  readonly closedAt: number | null;
}

export interface CabinetDecision {
  readonly decisionId: string;
  readonly sessionId: string;
  readonly domain: string;
  readonly subject: string;
  readonly votes: Readonly<Record<EntityId, Vote>>;
  readonly forCount: number;
  readonly againstCount: number;
  readonly passed: boolean;
  readonly executingMinistry: EntityId;
  readonly decidedAt: number;
  readonly executedBy: EntityId | null;
  readonly executedAt: number | null;
  /** T-38 (W-2026-053): لحظةُ سقوط القرار لزوال اختصاص وزارته بعد الإجازة — `null` ما دام قائمًا */
  readonly lapsedAt?: number | null;
}

export type CabinetResult<T> =
  | { readonly ok: true; readonly value: T; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface CabinetDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ministries: MinistryRegistry;
  readonly appointments: AppointmentRegistry;
}

export class Cabinet {
  private readonly sessions = new Map<string, CabinetSession>();
  private readonly decisions = new Map<string, CabinetDecision>();

  constructor(private readonly deps: CabinetDeps) {}

  /** عقد جلسة: من الديوان الملكي، وبحضور أصحاب مناصب قائمين، وبنصاب */
  convene(
    convenedBy: EntityId,
    input: { sessionId: string; attendees: readonly EntityId[] },
    now = Date.now(),
  ): CabinetResult<CabinetSession> {
    const refuse = (reason: string, kind = 'cabinet_refused'): CabinetResult<CabinetSession> => {
      const entry = this.deps.audit.append(convenedBy, kind, {
        sessionId: input.sessionId, reason, stage: 'convene',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (convenedBy !== ROYAL_COURT) return refuse('عقد الجلسة من الديوان الملكي وحده');
    if (this.sessions.has(input.sessionId)) return refuse('معرّف جلسة مستخدم');

    const unique = [...new Set(input.attendees)];
    const outsiders = unique.filter((a) => !this.deps.appointments.isOfficial(a));
    if (outsiders.length > 0) {
      return refuse(`لا يحضر إلا صاحب منصب قائم: ${outsiders.join('، ')}`);
    }
    const seats = this.seatCount();
    const quorum = Math.floor(seats / 2) + 1;
    if (unique.length < quorum) {
      return refuse(`نصاب ناقص: الحاضرون ${unique.length} والنصاب ${quorum}`, 'cabinet_quorum_failed');
    }

    const session: CabinetSession = {
      sessionId: input.sessionId, convenedBy, attendees: unique, at: now, quorum, closedAt: null,
    };
    this.sessions.set(session.sessionId, session);
    const entry = this.deps.audit.append(convenedBy, 'cabinet_convened', {
      sessionId: session.sessionId, attendees: session.attendees, quorum, seats,
    });
    return { ok: true, value: session, auditId: entry.hash };
  }

  /** قرار في نطاق اختصاص معلن — والفعل السيادي مرفوض ولو أجمعوا (ثابت 1) */
  decide(
    input: {
      sessionId: string; decisionId: string; domain: string; subject: string;
      votes: Readonly<Record<EntityId, Vote>>; sovereignAction?: SovereignAction;
    },
    now = Date.now(),
  ): CabinetResult<CabinetDecision> {
    const refuse = (reason: string, kind = 'cabinet_refused'): CabinetResult<CabinetDecision> => {
      const entry = this.deps.audit.append(ROYAL_COURT, kind, {
        sessionId: input.sessionId, decisionId: input.decisionId, reason, stage: 'decide',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const session = this.sessions.get(input.sessionId);
    if (!session) return refuse('جلسة غير موجودة');
    if (session.closedAt !== null) return refuse('جلسة مرفوعة — لا قرار بعد رفعها');
    if (this.decisions.has(input.decisionId)) return refuse('معرّف قرار مستخدم');

    if (input.sovereignAction !== undefined) {
      if (RESERVED_FOR_CROWN.includes(input.sovereignAction)) {
        const denial = this.deps.gateway.collectiveOverride(session.attendees, input.sovereignAction);
        const entry = this.deps.audit.append(ROYAL_COURT, 'cabinet_override_refused', {
          sessionId: session.sessionId, decisionId: input.decisionId,
          action: input.sovereignAction, attendees: session.attendees.length,
          gatewayReason: denial.reason,
        });
        return {
          ok: false,
          reason: 'فعل سيادي لا يبلغه قرار جماعي ولو أجمع المجلس — يمرّ بأمر ملكي',
          auditId: entry.hash,
        };
      }
    }

    const voters = Object.keys(input.votes) as EntityId[];
    const strangers = voters.filter((v) => !session.attendees.includes(v));
    if (strangers.length > 0) return refuse(`صوّت من لم يحضر: ${strangers.join('، ')}`);
    if (voters.length === 0) return refuse('لا قرار بلا أصوات');

    const ministry = this.deps.ministries.competentFor(input.domain);
    if (!ministry) return refuse(`لا وزارة قائمة صاحبة اختصاص في النطاق «${input.domain}»`);

    let forCount = 0;
    let againstCount = 0;
    for (const v of voters) {
      const vote = input.votes[v];
      if (vote === 'for') forCount += 1;
      else if (vote === 'against') againstCount += 1;
    }
    const passed = forCount > session.attendees.length / 2;

    const decision: CabinetDecision = {
      decisionId: input.decisionId, sessionId: session.sessionId, domain: input.domain,
      subject: input.subject, votes: { ...input.votes }, forCount, againstCount, passed,
      executingMinistry: ministry.ministryId, decidedAt: now, executedBy: null, executedAt: null,
      lapsedAt: null,
    };
    this.decisions.set(decision.decisionId, decision);
    const entry = this.deps.audit.append(ROYAL_COURT, 'cabinet_decided', {
      decisionId: decision.decisionId, sessionId: session.sessionId, domain: decision.domain,
      forCount, againstCount, passed, executingMinistry: decision.executingMinistry,
    });
    return { ok: true, value: decision, auditId: entry.hash };
  }

  /** التنفيذ: من الوزارة صاحبة الاختصاص وحدها، وبشرط أن يكون منصبها مشغولًا */
  execute(executor: EntityId, decisionId: string, now = Date.now()): CabinetResult<CabinetDecision> {
    const refuse = (reason: string): CabinetResult<CabinetDecision> => {
      const entry = this.deps.audit.append(executor, 'cabinet_refused', {
        decisionId, reason, stage: 'execute',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const decision = this.decisions.get(decisionId);
    if (!decision) return refuse('قرار غير موجود');
    if (!decision.passed) return refuse('قرار لم يُجَز — لا تنفيذ لما سقط في التصويت');
    if (decision.executedAt !== null) return refuse('قرار منفَّذ سابقًا');
    if (executor !== decision.executingMinistry) {
      return refuse(`لا تنفيذ من غير ذي اختصاص: النطاق لـ ${decision.executingMinistry}`);
    }
    if (!this.deps.ministries.isActive(executor)) return refuse('وزارة غير قائمة');
    if (decision.lapsedAt) return refuse('قرار ساقط بزوال الاختصاص — لا تنفيذ إلا بإعادة إسنادٍ ملكيّة (T-38)');
    // T-38: الاختصاصُ يُقرأ لحظةَ التنفيذ لا لحظةَ الإجازة — فإن زال سقط القرار ويُسجَّل سقوطُه
    const owner = this.deps.ministries.competentFor(decision.domain);
    if (owner?.ministryId !== decision.executingMinistry) {
      this.decisions.set(decisionId, { ...decision, lapsedAt: now });
      const entry = this.deps.audit.append(executor, 'cabinet_decision_lapsed', {
        decisionId, domain: decision.domain, formerMinistry: decision.executingMinistry,
        currentOwner: owner?.ministryId ?? null, at: now,
      });
      return { ok: false, reason: 'زال اختصاصُ الوزارة بعد الإجازة — سقط القرار (T-38)', auditId: entry.hash };
    }
    if (this.deps.appointments.occupiedOffices(executor).length === 0) {
      return refuse('لا تنفيذ من وزارة بلا صاحب منصب قائم');
    }

    const executed: CabinetDecision = { ...decision, executedBy: executor, executedAt: now };
    this.decisions.set(decisionId, executed);
    const entry = this.deps.audit.append(executor, 'cabinet_decision_executed', {
      decisionId, domain: decision.domain, subject: decision.subject,
    });
    return { ok: true, value: executed, auditId: entry.hash };
  }

  /**
   * T-38: إعادةُ إسنادِ قرارٍ مُجازٍ إلى صاحب الاختصاص القائم — بأمرٍ ملكيٍّ (`amend_policy` موجَّهٍ إلى
   * القرار)، ولا تُعيد التصويت: تنقل التنفيذ وحده ويُرفع السقوط.
   */
  reassign(command: SignedRoyalCommand, decisionId: string, now = Date.now()): CabinetResult<CabinetDecision> {
    const refuse = (reason: string): CabinetResult<CabinetDecision> => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'cabinet_refused', { decisionId, reason, stage: 'reassign' });
      return { ok: false, reason, auditId: entry.hash };
    };
    const decision = this.decisions.get(decisionId);
    if (!decision || !decision.passed || decision.executedAt !== null) return refuse('لا إعادة إسناد إلا لقرارٍ مُجازٍ لم يُنفَّذ');
    const owner = this.deps.ministries.competentFor(decision.domain);
    if (!owner) return refuse(`لا وزارة قائمة صاحبة اختصاص في النطاق «${decision.domain}»`);
    if (owner.ministryId === decision.executingMinistry) return refuse('الاختصاصُ لم يتغيّر — لا إعادة إسناد');
    if (command.payload.action !== 'amend_policy' || command.payload.target !== decisionId) {
      return refuse('إعادةُ الإسناد بأمر amend_policy موجَّهٍ إلى القرار نفسِه');
    }
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);
    const updated: CabinetDecision = { ...decision, executingMinistry: owner.ministryId, lapsedAt: null };
    this.decisions.set(decisionId, updated);
    const entry = this.deps.audit.append(command.payload.issuedBy, 'cabinet_decision_reassigned', {
      decisionId, from: decision.executingMinistry, to: owner.ministryId, commandId: command.payload.commandId,
    });
    return { ok: true, value: updated, auditId: entry.hash };
  }

  /** رفع الجلسة: لا قرار بعدها إلا بجلسة جديدة */
  close(convenedBy: EntityId, sessionId: string, now = Date.now()): CabinetResult<CabinetSession> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closedAt !== null || convenedBy !== ROYAL_COURT) {
      const entry = this.deps.audit.append(convenedBy, 'cabinet_refused', {
        sessionId, reason: 'رفع جلسة غير قائمة أو من غير الديوان', stage: 'close',
      });
      return { ok: false, reason: 'رفع جلسة غير قائمة أو من غير الديوان', auditId: entry.hash };
    }
    const closed: CabinetSession = { ...session, closedAt: now };
    this.sessions.set(sessionId, closed);
    const entry = this.deps.audit.append(convenedBy, 'cabinet_session_closed', { sessionId });
    return { ok: true, value: closed, auditId: entry.hash };
  }

  session(sessionId: string): CabinetSession | undefined {
    return this.sessions.get(sessionId);
  }

  decision(decisionId: string): CabinetDecision | undefined {
    return this.decisions.get(decisionId);
  }

  report(): { sessions: number; decisions: number; passed: number; executed: number; seats: number } {
    const all = [...this.decisions.values()];
    return {
      sessions: this.sessions.size,
      decisions: all.length,
      passed: all.filter((d) => d.passed).length,
      executed: all.filter((d) => d.executedAt !== null).length,
      seats: this.seatCount(),
    };
  }

  /** عدد المقاعد: كل منصب مشغول في وزارة قائمة */
  private seatCount(): number {
    let seats = 0;
    for (const m of this.deps.ministries.active()) {
      seats += this.deps.appointments.occupiedOffices(m.ministryId).length;
    }
    return seats;
  }
}
