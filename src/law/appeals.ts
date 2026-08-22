/**
 * src/law/appeals.ts — الطعن والاستئناف والمراجعة الملكية (المرحلة 22)
 * المالك: وزارة العدل — ومحكمة الاستئناف مستقلة عن محكمة أول درجة
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى محكومة داخل مدة الطعن + طاعن ذو مصلحة
 * المخرجات: طعن مسجَّل يوقف التنفيذ، ثم فصل: تأييد أو نقض أو تخفيف، وأعلاه مراجعة ملكية
 * التبعيات: المحكمة، سجل القوانين، بوابة التاج (للمراجعة الملكية)، السجل
 * الصلاحيات (RULE-004): الطعن للمحكوم عليه (أو للادعاء إن كان الحكم بالبراءة)،
 *   والفصل لمحكمة الاستئناف، والكلمة الأخيرة للملك بفعل سيادي `judicial_review`
 * السجلات: appeal_filed / appeal_refused / appeal_decided / royal_review_requested /
 *   royal_review_decided
 * ثوابت هذه الوحدة:
 *   1) **الطعن يوقف التنفيذ** حتى الفصل — لا عقوبة تُنفَّذ وحكمها معلَّق
 *   2) طعن واحد لكل دعوى، وداخل مدة معلنة، ولا طعن على حكم غير موجود
 *   3) **من يطعن هو ذو المصلحة**: المحكوم عليه في الإدانة، والادعاء في البراءة
 *   4) **قاضي الاستئناف ليس قاضي أول درجة** ولا المدّعي ولا المتهم (RULE-004)
 *   5) التخفيف تخفيف حقيقي: عقوبة أدنى في سلّم الشدّة ومن عقوبات القانون نفسه
 *   6) **المراجعة الملكية تمرّ ببوابة التاج** بفعل سيادي معلن، ولا طعن بعدها
 * حالات الفشل (كلها مغلقة): طاعن بلا مصلحة ⇒ رفض؛ خارج المدة ⇒ رفض؛
 *   تخفيف إلى أشد ⇒ رفض؛ أمر ملكي غير معتمد ⇒ رفض
 * اختبار القبول: tests/law/appeals.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { LawRegistry, PENALTY_SEVERITY, PenaltyKind } from './statutes';
import { AppealOutcome, Court, LegalCase, PUBLIC_DEFENDER } from './courts';
import { APPEAL_COURTS } from './authorities';

/** محاكم الاستئناف المعلنة */
// محاكمُ الاستئناف من `./authorities` — مصدرٌ واحد لكل دور (T-114)
export { APPEAL_COURTS } from './authorities';

export interface AppealRecord {
  readonly appealId: string;
  readonly caseId: string;
  readonly by: EntityId;
  readonly grounds: string;
  readonly filedAt: number;
  readonly outcome: AppealOutcome | null;
  readonly royalReviewRequested: boolean;
}

export type AppealResult =
  | { readonly ok: true; readonly appeal: AppealRecord; readonly legalCase: LegalCase; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface AppealsDeps {
  readonly audit: AppendOnlyLog;
  readonly court: Court;
  readonly law: LawRegistry;
  readonly gateway: CrownGateway;
  readonly appealCourts?: readonly EntityId[];
}

export class AppealsCourt {
  private readonly appeals = new Map<string, AppealRecord>(); // بالمفتاح caseId
  private readonly appealCourts: readonly EntityId[];
  private seq = 0;

  constructor(private readonly deps: AppealsDeps) {
    this.appealCourts = deps.appealCourts ?? APPEAL_COURTS;
  }

  get(caseId: string): AppealRecord | undefined {
    return this.appeals.get(caseId);
  }

  list(): readonly AppealRecord[] {
    return [...this.appeals.values()];
  }

  /** 1) تقديم الطعن — يوقف التنفيذ فورًا */
  file(caseId: string, by: EntityId, grounds: string, now = Date.now()): AppealResult {
    const refuse = (reason: string): AppealResult => {
      const entry = this.deps.audit.append(by, 'appeal_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    };
    const c = this.deps.court.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (!c.ruling) return refuse('لا طعن على حكم غير موجود');
    if (this.appeals.has(caseId)) return refuse('طعن واحد لكل دعوى — استُهلك الطعن');
    if (c.appeal?.royal) return refuse('لا طعن بعد المراجعة الملكية');
    if (c.status === 'enforced') return refuse('الحكم نُفِّذ — لا طعن بعد التنفيذ');
    if (now - c.ruling.at > this.deps.court.appealWindowMs) return refuse('انقضت مدة الطعن');
    if (!grounds.trim()) return refuse('لا طعن بلا أسباب');

    // ثابت 3: ذو المصلحة فقط
    const mayAppeal = c.ruling.guilty
      ? (by === c.defendant || by === PUBLIC_DEFENDER)
      : (by === c.prosecutor);
    if (!mayAppeal) {
      return refuse(c.ruling.guilty
        ? 'الطعن في الإدانة للمحكوم عليه أو محاميه العام'
        : 'الطعن في البراءة للادعاء وحده');
    }

    this.seq += 1;
    const appeal: AppealRecord = {
      appealId: `appeal:${caseId}:${this.seq}`,
      caseId, by, grounds: grounds.trim(), filedAt: now, outcome: null, royalReviewRequested: false,
    };
    this.appeals.set(caseId, appeal);
    const marked = this.deps.court.markAppealPending(caseId, by, appeal.appealId, now);
    if (!marked.ok) return refuse(`تعليق التنفيذ فشل: ${marked.reason}`);
    const entry = this.deps.audit.append(by, 'appeal_filed', {
      caseId, appealId: appeal.appealId, grounds: appeal.grounds,
    });
    return { ok: true, appeal, legalCase: marked.legalCase, auditId: entry.hash };
  }

  /** 2) الفصل في الطعن — من محكمة استئناف ليست قاضي أول درجة */
  decide(
    caseId: string, panel: EntityId,
    verdict: 'upheld' | 'overturned' | 'reduced',
    reason: string,
    reducedTo?: PenaltyKind,
    now = Date.now(),
  ): AppealResult {
    const refuse = (why: string): AppealResult => {
      const entry = this.deps.audit.append(panel, 'appeal_refused', { caseId, reason: why, mode: 'decide' });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const appeal = this.appeals.get(caseId);
    if (!appeal) return refuse('لا طعن مسجَّل في هذه الدعوى');
    if (appeal.outcome) return refuse('الطعن فُصل فيه — لا فصل مرتين');
    const c = this.deps.court.get(caseId);
    if (!c || !c.ruling) return refuse('دعوى أو حكم غير موجود');
    if (!this.appealCourts.includes(panel)) return refuse('جهة غير مخوَّلة بالاستئناف');
    if (panel === c.ruling.judge) return refuse('قاضي أول درجة لا يراجع حكمه (RULE-004)');
    if (panel === c.prosecutor || panel === c.defendant) return refuse('لا فصل من خصم في الدعوى');
    if (!reason.trim()) return refuse('لا فصل بلا تسبيب');

    let penalty: PenaltyKind | 'none' = c.ruling.penalty;
    if (verdict === 'overturned') {
      penalty = 'none';
    } else if (verdict === 'reduced') {
      if (!reducedTo) return refuse('تخفيف بلا عقوبة بديلة');
      if (!c.ruling.guilty) return refuse('لا تخفيف لعقوبة غير قائمة');
      const statute = this.deps.law.applicableAt(c.statuteId, c.occurredAt);
      if (!statute) return refuse('القانون غير نافذ وقت الوقوع');
      if (!statute.penalties.includes(reducedTo)) return refuse('العقوبة البديلة خارج عقوبات القانون');
      const current = c.ruling.penalty === 'none' ? 0 : PENALTY_SEVERITY[c.ruling.penalty];
      if (PENALTY_SEVERITY[reducedTo] >= current) return refuse('التخفيف لا يكون تشديدًا ولا مساواة');
      penalty = reducedTo;
    }

    const outcome: AppealOutcome = {
      appealId: appeal.appealId, panel, verdict, penalty, reason: reason.trim(), at: now, royal: false,
    };
    const applied = this.deps.court.applyAppealOutcome(caseId, outcome);
    if (!applied.ok) return refuse(`تثبيت النتيجة فشل: ${applied.reason}`);
    const updated: AppealRecord = { ...appeal, outcome };
    this.appeals.set(caseId, updated);
    const entry = this.deps.audit.append(panel, 'appeal_decided', {
      caseId, appealId: appeal.appealId, verdict, penalty, reason: outcome.reason,
    });
    return { ok: true, appeal: updated, legalCase: applied.legalCase, auditId: entry.hash };
  }

  /** 3) طلب المراجعة الملكية — يُسجَّل ولا يُلزم الملك بشيء */
  requestRoyalReview(caseId: string, by: EntityId, reason: string, now = Date.now()): AppealResult {
    const refuse = (why: string): AppealResult => {
      const entry = this.deps.audit.append(by, 'appeal_refused', { caseId, reason: why, mode: 'royal_request' });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const appeal = this.appeals.get(caseId);
    if (!appeal) return refuse('لا طعن مسجَّل — المراجعة الملكية بعد استنفاد الاستئناف');
    if (!appeal.outcome) return refuse('الطعن لم يُفصل فيه بعد');
    if (appeal.outcome.royal) return refuse('المراجعة الملكية وقعت — لا تُطلب مرتين');
    const c = this.deps.court.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (by !== c.defendant && by !== PUBLIC_DEFENDER && by !== c.prosecutor) {
      return refuse('طلب المراجعة لذوي المصلحة في الدعوى');
    }
    if (!reason.trim()) return refuse('لا طلب بلا سبب');
    const updated: AppealRecord = { ...appeal, royalReviewRequested: true };
    this.appeals.set(caseId, updated);
    const entry = this.deps.audit.append(by, 'royal_review_requested', { caseId, reason: reason.trim() });
    return { ok: true, appeal: updated, legalCase: c, auditId: entry.hash };
  }

  /**
   * 4) المراجعة الملكية: عفو أو تثبيت — بأمر ملكي معتمد بفعل `judicial_review`.
   * كلمة الملك آخر الكلام: لا طعن بعدها (ثابت 6).
   */
  royalReview(
    command: SignedRoyalCommand, caseId: string,
    decision: 'pardon' | 'confirm', reason: string, now = Date.now(),
  ): AppealResult {
    const refuse = (why: string): AppealResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'appeal_refused', {
        caseId, reason: why, mode: 'royal_review',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const appeal = this.appeals.get(caseId);
    if (!appeal) return refuse('لا طعن مسجَّل في هذه الدعوى');
    if (!appeal.royalReviewRequested) return refuse('لا مراجعة ملكية بلا طلب مسجَّل');
    if (appeal.outcome?.royal) return refuse('المراجعة الملكية وقعت مرة — لا تتكرر');
    const c = this.deps.court.get(caseId);
    if (!c || !c.ruling) return refuse('دعوى أو حكم غير موجود');
    if (c.status === 'enforced') return refuse('الحكم نُفِّذ — المراجعة قبل التنفيذ لا بعده');
    if (!reason.trim()) return refuse('لا مراجعة بلا تسبيب');
    if (command.payload.action !== 'judicial_review') {
      return refuse('المراجعة الملكية فعل سيادي معلن — يلزمها judicial_review');
    }
    if (command.payload.target !== caseId) return refuse('هدف الأمر لا يطابق الدعوى');
    const authorized = this.deps.gateway.authorize(command, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const outcome: AppealOutcome = {
      appealId: appeal.appealId,
      panel: command.payload.issuedBy,
      verdict: decision === 'pardon' ? 'overturned' : 'upheld',
      penalty: decision === 'pardon' ? 'none' : c.ruling.penalty,
      reason: reason.trim(),
      at: now,
      royal: true,
    };
    const applied = this.deps.court.applyAppealOutcome(caseId, outcome);
    if (!applied.ok) return refuse(`تثبيت المراجعة فشل: ${applied.reason}`);
    const updated: AppealRecord = { ...appeal, outcome };
    this.appeals.set(caseId, updated);
    const entry = this.deps.audit.append(command.payload.issuedBy, 'royal_review_decided', {
      caseId, decision, penalty: outcome.penalty, commandId: command.payload.commandId,
    });
    return { ok: true, appeal: updated, legalCase: applied.legalCase, auditId: entry.hash };
  }

  report(): {
    readonly filed: number;
    readonly decided: number;
    readonly pending: number;
    readonly royal: number;
  } {
    const all = this.list();
    return {
      filed: all.length,
      decided: all.filter((a) => a.outcome !== null).length,
      pending: all.filter((a) => a.outcome === null).length,
      royal: all.filter((a) => a.outcome?.royal).length,
    };
  }
}
