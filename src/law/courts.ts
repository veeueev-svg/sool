/**
 * src/law/courts.ts — المحكمة: اتهام ودفاع وحكم مسجَّل (المرحلة 22)
 * المالك: وزارة العدل (والقضاء مستقل عن الادعاء والتنفيذ)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: تهمة من جهة ادعاء مخوَّلة + قانون نافذ وقت الفعل + أدلة مسجَّلة في السجل
 * المخرجات: دعوى بمسار معلن: charged ← defended ← ruled ← (appealed) ← final ← enforced
 * التبعيات: سجل القوانين، السجل غير القابل للمحو
 * الصلاحيات (RULE-004): الادعاء لديوان التدقيق، والدفاع للمتهم أو المحامي العام،
 *   والحكم للقضاء، والتنفيذ لحرس التاج — لا جهة تجمع اثنتين في دعوى واحدة
 * السجلات: charge_filed / charge_refused / defense_submitted / defense_defaulted /
 *   ruling_issued / ruling_refused / case_final / case_enforced /
 *   enforcement_refused / appeal_refused (كل نداءٍ مرفوض يُقيَّد ولا يُهمَل)
 * ثوابت هذه الوحدة:
 *   1) **لا اتهام بلا قانون نافذ وقت وقوع الفعل** — لا أثر رجعي ولو كان القانون قائمًا اليوم
 *   2) **لا اتهام بلا دليل مسجَّل** في سلسلة التدقيق (بصمة قائمة، لا وصف شفهي)
 *   3) **لا حكم بلا دفاع**: إما دفاع المتهم، أو دفاع محامٍ عام بعد انقضاء مدة معلنة —
 *      وسكوت المتهم لا يُعَدّ تنازلًا صامتًا بل يُسجَّل ويُعيَّن له مدافع
 *   4) القاضي ليس المدّعي ولا المتهم ولا المنفّذ (RULE-004)
 *   5) العقوبة من عقوبات القانون المعلنة فقط، ولا عقوبة على غير مُدان
 *   6) **الحكم لا يُعدَّل**: حكم ثانٍ في الدعوى مرفوض — التصحيح بالاستئناف لا بالكتابة فوقه
 *   7) **لا محاكمة مرتين على الفعل ذاته** (نفس المتهم ونفس القانون ونفس لحظة الوقوع)
 *   8) الحكم لا يصير نهائيًا قبل انقضاء مدة الطعن أو الفصل في الطعن
 *   9) **الحرَس في المدخل لا في نيّة المُنادي** (المرحلة 39، البند T-114): `markEnforced`
 *      و`markAppealPending` مدخلان عامّان، فيتحقّقان بنفسهما من الجهة والحكم والنهائية
 *      عبر `./case_guards` — ولا يُعتمد على أن المُنادي هو `Enforcement.execute`.
 *      قبل ذلك كان تعليقٌ في الكود يقول «يُستدعى من التنفيذ»، والتعليق ليس حرَسًا (RULE-001)،
 *      وقد أثبت قياسُ التدقيق (C-14ب، المرحلة 38) أن الانتزاع كان يمرّ فعلًا.
 *  10) **الأشكال والإحصاء والحرَس في وحداتٍ مجاورة** (`case_types.ts` · `case_report.ts` ·
 *      `case_guards.ts`) — بهذا نزل هذا الملف من 404 إلى 347 سطرًا وحُذف صفُّ استثنائه
 *      من `scripts/limits/module_limits.yaml` (سقّاطةُ الدَّين: يُحذف ولا يُرفع).
 * حالات الفشل (كلها مغلقة): جهة غير مخوَّلة ⇒ رفض؛ دليل غير موجود ⇒ رفض؛
 *   حكم قبل دفاع ⇒ رفض؛ عقوبة خارج القانون ⇒ رفض
 * اختبار القبول: tests/law/courts.test.ts, tests/law/case_lifecycle.test.ts,
 *   tests/law/court_guards.test.ts (حرَس المداخل — يسقط إن أُزيل الحرَس)
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { LawRegistry, PenaltyKind, Statute, inScope } from './statutes';
import { PROSECUTION_AUTHORITIES, PUBLIC_DEFENDER, TRIAL_COURTS } from './authorities';
import { guardAppealMark, guardEnforcementMark } from './case_guards';
import {
  AppealOutcome, CASE_STATUSES, CaseResult, CaseStatus, ChargeInput, Defense, LegalCase, Ruling,
} from './case_types';
import { summarizeCases } from './case_report';

// الجهات المعلنة مصدرها `./authorities` — قائمةٌ واحدة لكل دور (T-114)
export { PROSECUTION_AUTHORITIES, TRIAL_COURTS, PUBLIC_DEFENDER } from './authorities';


// أشكالُ الدعوى في `./case_types` — إعلانٌ لا سلوك، ويُعاد تصديرها هنا فلا يتغيّر السطح العام
export {
  CASE_STATUSES, Defense, Ruling, AppealOutcome, LegalCase, ChargeInput, CaseResult,
} from './case_types';
export type { CaseStatus } from './case_types';

export interface CourtDeps {
  readonly audit: AppendOnlyLog;
  readonly law: LawRegistry;
  /** مدة الدفاع قبل تعيين محامٍ عام (مللي ثانية) */
  readonly defenseWindowMs?: number;
  /** مدة الطعن قبل صيرورة الحكم نهائيًا (مللي ثانية) */
  readonly appealWindowMs?: number;
  readonly trialCourts?: readonly EntityId[];
  readonly prosecutors?: readonly EntityId[];
  /** جهات التنفيذ التي وحدها تُعلن التنفيذ في الدعوى (T-114) */
  readonly enforcementAuthorities?: readonly EntityId[];
}

const HOUR = 3_600_000;

export class Court {
  private readonly cases = new Map<string, LegalCase>();
  readonly defenseWindowMs: number;
  readonly appealWindowMs: number;
  private readonly trialCourts: readonly EntityId[];
  private readonly prosecutors: readonly EntityId[];
  private readonly enforcementAuthorities: readonly EntityId[] | undefined;

  constructor(private readonly deps: CourtDeps) {
    this.enforcementAuthorities = deps.enforcementAuthorities;
    this.defenseWindowMs = deps.defenseWindowMs ?? 24 * HOUR;
    this.appealWindowMs = deps.appealWindowMs ?? 48 * HOUR;
    this.trialCourts = deps.trialCourts ?? TRIAL_COURTS;
    this.prosecutors = deps.prosecutors ?? PROSECUTION_AUTHORITIES;
  }

  get(caseId: string): LegalCase | undefined {
    return this.cases.get(caseId);
  }

  list(status?: CaseStatus): readonly LegalCase[] {
    const all = [...this.cases.values()];
    return status ? all.filter((c) => c.status === status) : all;
  }

  /** 1) الاتهام */
  charge(prosecutor: EntityId, input: ChargeInput, now = Date.now()): CaseResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): CaseResult => {
      const entry = this.deps.audit.append(prosecutor, 'charge_refused', {
        caseId: input.caseId, statuteId: input.statuteId, defendant: input.defendant, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (!input.caseId.trim()) return refuse('معرّف دعوى فارغ');
    if (this.cases.has(input.caseId)) return refuse('دعوى بهذا المعرّف قائمة');
    if (!this.prosecutors.includes(prosecutor)) return refuse('جهة غير مخوَّلة بالادعاء');
    if (prosecutor === input.defendant) return refuse('لا يتهم أحد نفسه ولا يخاصم نفسه');
    if (!input.chargeText.trim()) return refuse('لا اتهام بلا بيان تهمة');
    if (!Number.isFinite(input.occurredAt) || input.occurredAt > now) {
      return refuse('لحظة وقوع الفعل غير صالحة أو في المستقبل');
    }

    // ثابت 1: القانون النافذ وقت الوقوع لا وقت الاتهام
    const statute: Statute | undefined = this.deps.law.applicableAt(input.statuteId, input.occurredAt);
    if (!statute) return refuse('لا اتهام بلا قانون نافذ وقت وقوع الفعل — لا أثر رجعي');
    if (!inScope(input.defendant, statute.appliesTo)) {
      return refuse('المتهم خارج نطاق خضوع هذا القانون');
    }
    // T-33 (W-2026-052): التقادمُ بنصّ القانون النافذ وقت الوقوع — لا دعوى إلى الأبد
    const limitationMs = statute.limitationDays * 24 * HOUR;
    if (now - input.occurredAt > limitationMs) {
      return refuse('انقضت مدّةُ التقادم المعلنة في نصّ القانون — لا اتهام بعدها', {
        limitationDays: statute.limitationDays, elapsedMs: now - input.occurredAt,
      });
    }

    // ثابت 2: كل دليل بصمة سجل قائم
    if (input.evidence.length === 0) return refuse('لا اتهام بلا دليل مسجَّل');
    const missing = input.evidence.filter((e) => !this.evidenceExists(e));
    if (missing.length > 0) return refuse('دليل غير موجود في سجل التدقيق', { missing });

    // ثابت 7: لا محاكمة مرتين على الفعل ذاته
    const priorCase = [...this.cases.values()].find(
      (c) => c.defendant === input.defendant && c.statuteId === input.statuteId
        && c.occurredAt === input.occurredAt,
    );
    if (priorCase) return refuse('لا محاكمة مرتين على الفعل ذاته', { priorCase: priorCase.caseId });

    const legalCase: LegalCase = {
      caseId: input.caseId,
      statuteId: statute.statuteId,
      statuteVersion: statute.version,
      defendant: input.defendant,
      prosecutor,
      chargeText: input.chargeText.trim(),
      evidence: [...input.evidence],
      occurredAt: input.occurredAt,
      chargedAt: now,
      defense: null,
      ruling: null,
      appeal: null,
      appealPending: false,
      status: 'charged',
      finalAt: null,
      enforcedAt: null,
      enforcedBy: null,
    };
    this.cases.set(legalCase.caseId, legalCase);
    const entry = this.deps.audit.append(prosecutor, 'charge_filed', {
      caseId: legalCase.caseId, statuteId: statute.statuteId, statuteVersion: statute.version,
      defendant: legalCase.defendant, evidence: legalCase.evidence, occurredAt: legalCase.occurredAt,
    });
    return { ok: true, legalCase, auditId: entry.hash };
  }

  /** 2) الدفاع — من المتهم نفسه أو من المحامي العام المعيَّن له */
  submitDefense(
    caseId: string, by: EntityId, text: string, evidence: readonly string[] = [], now = Date.now(),
  ): CaseResult {
    const refuse = (reason: string): CaseResult => {
      const entry = this.deps.audit.append(by, 'defense_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    };
    const c = this.cases.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (c.status !== 'charged') return refuse('باب الدفاع مغلق في هذه المرحلة');
    if (by !== c.defendant && by !== PUBLIC_DEFENDER) return refuse('لا يدافع إلا المتهم أو محاميه العام');
    if (by === c.prosecutor) return refuse('المدّعي لا يدافع — فصل الأدوار (RULE-004)');
    if (!text.trim()) return refuse('دفاع بلا بيان');
    const missing = evidence.filter((e) => !this.evidenceExists(e));
    if (missing.length > 0) return refuse('دليل دفاع غير موجود في سجل التدقيق');

    const defense: Defense = {
      by, text: text.trim(), evidence: [...evidence], at: now, byDefault: by === PUBLIC_DEFENDER,
    };
    const updated: LegalCase = { ...c, defense, status: 'defended' };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(by, 'defense_submitted', {
      caseId, byDefault: defense.byDefault, evidence: defense.evidence.length,
    });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  /**
   * 3) تعيين محامٍ عام بعد سكوت المتهم — لا يجوز قبل انقضاء المدة،
   * والسكوت يُسجَّل بوصفه سكوتًا لا تنازلًا (ثابت 3).
   */
  appointPublicDefender(caseId: string, by: EntityId = PUBLIC_DEFENDER, now = Date.now()): CaseResult {
    const refuse = (reason: string): CaseResult => {
      const entry = this.deps.audit.append(by, 'defense_refused', { caseId, reason, mode: 'default' });
      return { ok: false, reason, auditId: entry.hash };
    };
    const c = this.cases.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (c.status !== 'charged') return refuse('لا تعيين مدافع في هذه المرحلة');
    if (now - c.chargedAt < this.defenseWindowMs) {
      return refuse('مدة الدفاع لم تنقضِ — لا مدافع حكمي قبل الأجل');
    }
    this.deps.audit.append(by, 'defense_defaulted', {
      caseId, defendant: c.defendant, silenceMs: now - c.chargedAt,
    });
    return this.submitDefense(caseId, PUBLIC_DEFENDER, `دفاع حكمي عن ${c.defendant}: لم يقدّم بيانًا`, [], now);
  }

  /**
   * 3-ب) T-36 (W-2026-052): ساعةُ العدالة — كلُّ دعوى `charged` انقضت مدّةُ دفاعها يُعيَّن لها المحامي
   * العامُّ بمدخله المحروس نفسِه، بلا مُنادٍ خارجيّ. يناديها ماسحُ المواعيد في كلِّ مسحة؛ وتعيد ما عُيِّن.
   */
  defaultSilentDefenses(now = Date.now()): readonly string[] {
    const due = [...this.cases.values()]
      .filter((c) => c.status === 'charged' && now - c.chargedAt >= this.defenseWindowMs);
    return due.filter((c) => this.appointPublicDefender(c.caseId, PUBLIC_DEFENDER, now).ok).map((c) => c.caseId);
  }

  /** 4) الحكم — من قضاء مخوَّل ليس هو المدّعي ولا المتهم */
  rule(
    caseId: string, judge: EntityId,
    verdict: { readonly guilty: boolean; readonly penalty: PenaltyKind | 'none'; readonly reason: string },
    now = Date.now(),
  ): CaseResult {
    const refuse = (reason: string): CaseResult => {
      const entry = this.deps.audit.append(judge, 'ruling_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    };
    const c = this.cases.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (c.ruling) return refuse('الحكم لا يُعدَّل — التصحيح بالاستئناف');
    if (c.status !== 'defended') return refuse('لا حكم بلا دفاع مسجَّل');
    if (!this.trialCourts.includes(judge)) return refuse('جهة غير مخوَّلة بالقضاء');
    if (judge === c.prosecutor) return refuse('القاضي لا يكون المدّعي (RULE-004)');
    if (judge === c.defendant) return refuse('لا يحكم أحد في خصومته');
    if (!verdict.reason.trim()) return refuse('لا حكم بلا تسبيب');

    const statute = this.deps.law.applicableAt(c.statuteId, c.occurredAt);
    if (!statute) return refuse('القانون المستند إليه غير نافذ وقت الوقوع');
    if (verdict.guilty) {
      if (verdict.penalty === 'none') return refuse('إدانة بلا عقوبة — بيان ناقص');
      if (!statute.penalties.includes(verdict.penalty)) {
        return refuse('العقوبة خارج عقوبات القانون المعلنة');
      }
    } else if (verdict.penalty !== 'none') {
      return refuse('لا عقوبة على غير مُدان');
    }

    const ruling: Ruling = {
      judge, guilty: verdict.guilty, penalty: verdict.penalty,
      reason: verdict.reason.trim(), at: now, statuteVersion: statute.version,
    };
    const updated: LegalCase = { ...c, ruling, status: 'ruled' };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(judge, 'ruling_issued', {
      caseId, guilty: ruling.guilty, penalty: ruling.penalty, statuteVersion: ruling.statuteVersion,
      appealWindowMs: this.appealWindowMs,
    });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  /** هل صار الحكم نهائيًا؟ لا نهائية مع طعن قائم ولا قبل انقضاء مدة الطعن (ثابت 8) */
  isFinal(caseId: string, now = Date.now()): boolean {
    const c = this.cases.get(caseId);
    if (!c || !c.ruling) return false;
    if (c.appealPending) return false;
    if (c.status === 'final' || c.status === 'enforced') return true;
    if (c.appeal) return true;
    return now - c.ruling.at >= this.appealWindowMs;
  }

  /** تثبيت النهائية بسجل صريح — يستدعيها التنفيذ قبل أي أثر */
  finalize(caseId: string, by: EntityId, now = Date.now()): CaseResult {
    const refuse = (reason: string): CaseResult => {
      const entry = this.deps.audit.append(by, 'case_finalize_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    };
    const c = this.cases.get(caseId);
    if (!c) return refuse('دعوى غير موجودة');
    if (!c.ruling) return refuse('لا نهائية لحكم غير موجود');
    if (c.appealPending) return refuse('طعن قائم — لا نهائية قبل الفصل فيه');
    if (!this.isFinal(caseId, now)) return refuse('مدة الطعن لم تنقضِ');
    if (c.status === 'final' || c.status === 'enforced') {
      return { ok: true, legalCase: c, auditId: '' };
    }
    const updated: LegalCase = { ...c, status: 'final', finalAt: now };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(by, 'case_final', {
      caseId, guilty: c.ruling.guilty, penalty: c.ruling.penalty,
    });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  /** تعليق التنفيذ لطعن — محروسٌ في المدخل لا بنيّة المُنادي (T-114) */
  markAppealPending(caseId: string, by: EntityId, appealId: string, now = Date.now()): CaseResult {
    const c = this.cases.get(caseId);
    const refused = guardAppealMark(c, by, appealId, PUBLIC_DEFENDER);
    if (refused !== null || !c) {
      const reason = refused ?? 'دعوى غير موجودة';
      const entry = this.deps.audit.append(by, 'appeal_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    }
    const updated: LegalCase = { ...c, appealPending: true, status: 'appealed' };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(by, 'case_appealed', { caseId, appealId, at: now });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  /** يُستدعى من محكمة الاستئناف بعد الفصل: النتيجة تُثبَّت والتنفيذ يُفتَح */
  applyAppealOutcome(caseId: string, outcome: AppealOutcome): CaseResult {
    const c = this.cases.get(caseId);
    if (!c || !c.ruling) {
      const entry = this.deps.audit.append(outcome.panel, 'appeal_refused', {
        caseId, reason: 'لا دعوى أو لا حكم',
      });
      return { ok: false, reason: 'لا دعوى أو لا حكم', auditId: entry.hash };
    }
    const guilty = outcome.verdict === 'overturned' ? false : c.ruling.guilty;
    const ruling: Ruling = {
      ...c.ruling,
      guilty,
      penalty: guilty ? outcome.penalty : 'none',
    };
    const updated: LegalCase = {
      ...c, ruling, appeal: outcome, appealPending: false, status: 'final', finalAt: outcome.at,
    };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(outcome.panel, 'case_final', {
      caseId, viaAppeal: true, verdict: outcome.verdict, guilty, penalty: ruling.penalty,
      royal: outcome.royal,
    });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  /** إعلان التنفيذ — محروسٌ في المدخل: جهةٌ مخوَّلة، وحكمٌ قائم، ونهائيةٌ مثبَّتة (T-114) */
  markEnforced(caseId: string, by: EntityId, now = Date.now()): CaseResult {
    const c = this.cases.get(caseId);
    const refused = guardEnforcementMark(c, by, this.enforcementAuthorities);
    if (refused !== null || !c) {
      const reason = refused ?? 'دعوى غير موجودة';
      const entry = this.deps.audit.append(by, 'enforcement_refused', { caseId, reason });
      return { ok: false, reason, auditId: entry.hash };
    }
    const updated: LegalCase = { ...c, status: 'enforced', enforcedAt: now, enforcedBy: by };
    this.cases.set(caseId, updated);
    const entry = this.deps.audit.append(by, 'case_enforced', {
      caseId, penalty: c.ruling?.penalty ?? 'none',
    });
    return { ok: true, legalCase: updated, auditId: entry.hash };
  }

  report(): {
    readonly total: number;
    readonly byStatus: Readonly<Record<CaseStatus, number>>;
    readonly convictions: number;
    readonly acquittals: number;
  } {
    return summarizeCases<CaseStatus>(this.cases.values(), CASE_STATUSES);
  }

  /** الدليل يجب أن يكون بصمة سجل قائم في السلسلة — لا دليل يُدَّعى ولا يُراجَع */
  private evidenceExists(hash: string): boolean {
    if (!hash.trim()) return false;
    return this.deps.audit.snapshot().some((e) => e.hash === hash);
  }
}
