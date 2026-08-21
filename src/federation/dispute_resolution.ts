/**
 * src/federation/dispute_resolution.ts — فضّ النزاع بين الأقاليم (المرحلة 24)
 * المالك: الديوان الملكي (محكّمًا) والملك (مرجعًا نهائيًا)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: دعوى إقليم على إقليم بدليل من سجل التدقيق | المخرجات: فضّ مسجَّل أو رفض
 * التبعيات: سجل الأقاليم، بوابة التاج، السجل غير القابل للمحو
 * السجلات: dispute_raised / dispute_answered / response_window_elapsed /
 *           dispute_resolved / dispute_escalated / royal_settlement / dispute_refused
 * ثوابت هذه الوحدة:
 *   1) لا دعوى بلا دليل موجود في سجل التدقيق — الدليل هاش سجل قائم لا كلام
 *   2) **لا أحد يفضّ نزاعًا هو طرف فيه**: المحكّم جهة ثالثة معلنة
 *   3) لا فضّ قبل سماع المدّعى عليه أو انقضاء مدة الردّ (وسكوته يُسجَّل لا يُخفى)
 *   4) **الفضّ لا ينقل اختصاصًا بنفسه**: أقصاه توصية — ونقل النطاق تعديل ملكي
 *      يمرّ بسجل الأقاليم (RULE-003) وإلا صار الحكم مصدرًا موازيًا للسيادة
 *   5) التصعيد إلى الملك حقّ للطرفين، وحكمه نهائي لا يُصعَّد بعده
 *   6) كل فضّ مسجَّل: لا نزاع يُطوى بلا أثر (RULE-006)
 * حالات الفشل (كلها مغلقة): دليل غير موجود ⇒ رفض؛ طرفان متطابقان ⇒ رفض؛
 *   إقليم غير قائم ⇒ رفض؛ محكّم طرف ⇒ رفض؛ فضّ قبل المدة بلا ردّ ⇒ رفض؛
 *   تصعيد من غير طرف ⇒ رفض؛ تصعيد بعد حكم ملكي ⇒ رفض
 * اختبار القبول: tests/federation/federation_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0008-federation-and-governors.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { RegionRegistry, REGIONS_COUNCIL } from './region_registry';

/** المحكّم المعلن: جهة ثالثة لا تكون طرفًا في نزاع إقليمي (ثابت 2) */
export const REGIONAL_ARBITER: EntityId = 'authority:royal_court';
/** مدة ردّ المدّعى عليه قبل أن يجوز الفضّ بسكوته المسجَّل */
export const RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DisputeStatus = 'raised' | 'answered' | 'resolved' | 'escalated' | 'royal_settled';

/**
 * ما يقضي به المحكّم — ولا شيء منها ينقل نطاقًا بنفسه (ثابت 4):
 *  domain_stays: النطاق يبقى لمن يمارسه | domain_transfer_recommended: توصية بنقل يحتاج أمرًا ملكيًا
 *  compensation: تعويض تشغيلي | no_merit: لا وجه للدعوى
 */
export type RemedyKind = 'domain_stays' | 'domain_transfer_recommended' | 'compensation' | 'no_merit';

export interface Ruling {
  readonly by: EntityId;
  readonly inFavorOf: EntityId;
  readonly remedy: RemedyKind;
  readonly note: string;
  readonly at: number;
  /** true إذا فُضّ بعد سكوت المدّعى عليه وانقضاء المدة */
  readonly bySilence: boolean;
}

export interface Dispute {
  readonly disputeId: string;
  readonly claimant: EntityId;
  readonly respondent: EntityId;
  readonly subject: string;
  readonly domain: string;
  readonly evidence: readonly string[];
  readonly raisedAt: number;
  readonly response: { readonly statement: string; readonly at: number } | null;
  readonly status: DisputeStatus;
  readonly ruling: Ruling | null;
  readonly escalation: { readonly by: EntityId; readonly reason: string; readonly at: number } | null;
  readonly royalRuling: {
    readonly commandId: string; readonly inFavorOf: EntityId; readonly at: number;
  } | null;
}

export type DisputeResult =
  | { readonly ok: true; readonly dispute: Dispute; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface RegionalTribunalDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly regions: RegionRegistry;
  readonly responseWindowMs?: number;
}

export class RegionalTribunal {
  private readonly disputes = new Map<string, Dispute>();
  private readonly responseWindowMs: number;

  constructor(private readonly deps: RegionalTribunalDeps) {
    this.responseWindowMs = deps.responseWindowMs ?? RESPONSE_WINDOW_MS;
  }

  /** 1) رفع الدعوى: من إقليم قائم على إقليم قائم، بدليل موجود (ثابت 1) */
  raise(
    claimant: EntityId,
    input: {
      disputeId: string; respondent: EntityId; subject: string; domain: string;
      evidence: readonly string[];
    },
    now = Date.now(),
  ): DisputeResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): DisputeResult => {
      const entry = this.deps.audit.append(claimant, 'dispute_refused', {
        disputeId: input.disputeId, reason, stage: 'raise', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (this.disputes.has(input.disputeId)) return refuse('معرّف نزاع مستخدم');
    if (claimant === input.respondent) return refuse('لا نزاع لإقليم مع نفسه');
    if (!this.deps.regions.isActive(claimant)) return refuse('المدّعي ليس إقليمًا قائمًا');
    if (!this.deps.regions.isActive(input.respondent)) return refuse('المدّعى عليه ليس إقليمًا قائمًا');
    if (input.subject.trim().length < 3) return refuse('لا دعوى بلا موضوع معلن');
    if (input.domain.trim().length === 0) return refuse('لا دعوى بلا نطاق محدَّد');
    if (input.evidence.length === 0) return refuse('لا دعوى بلا دليل مسجَّل (ثابت 1)');
    const missing = input.evidence.filter((e) => !this.evidenceExists(e));
    if (missing.length > 0) return refuse('دليل غير موجود في سجل التدقيق', { missing });

    const open = [...this.disputes.values()].find(
      (d) => d.domain === input.domain
        && (d.status === 'raised' || d.status === 'answered' || d.status === 'escalated')
        && ((d.claimant === claimant && d.respondent === input.respondent)
          || (d.claimant === input.respondent && d.respondent === claimant)),
    );
    if (open) return refuse('نزاع قائم بين الطرفين في النطاق نفسه — يُحسم قبل غيره');

    const dispute: Dispute = {
      disputeId: input.disputeId, claimant, respondent: input.respondent,
      subject: input.subject.trim(), domain: input.domain.trim(), evidence: [...input.evidence],
      raisedAt: now, response: null, status: 'raised', ruling: null,
      escalation: null, royalRuling: null,
    };
    this.disputes.set(dispute.disputeId, dispute);
    const entry = this.deps.audit.append(claimant, 'dispute_raised', {
      disputeId: dispute.disputeId, respondent: dispute.respondent,
      domain: dispute.domain, subject: dispute.subject, evidence: dispute.evidence,
    });
    return { ok: true, dispute, auditId: entry.hash };
  }

  /** 2) الردّ: من المدّعى عليه وحده وداخل المدة (ثابت 3) */
  respond(
    respondent: EntityId, disputeId: string, statement: string, now = Date.now(),
  ): DisputeResult {
    const refuse = (reason: string): DisputeResult => {
      const entry = this.deps.audit.append(respondent, 'dispute_refused', {
        disputeId, reason, stage: 'respond',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const d = this.disputes.get(disputeId);
    if (!d) return refuse('نزاع غير موجود');
    if (d.respondent !== respondent) return refuse('الردّ للمدّعى عليه وحده');
    if (d.status !== 'raised') return refuse(`حالة النزاع ${d.status} لا تقبل الردّ`);
    if (statement.trim().length < 3) return refuse('لا ردّ بلا بيان معلن');
    if (now - d.raisedAt > this.responseWindowMs) return refuse('انقضت مدة الردّ');

    const updated: Dispute = {
      ...d, response: { statement: statement.trim(), at: now }, status: 'answered',
    };
    this.disputes.set(disputeId, updated);
    const entry = this.deps.audit.append(respondent, 'dispute_answered', {
      disputeId, statement: updated.response?.statement ?? '',
    });
    return { ok: true, dispute: updated, auditId: entry.hash };
  }

  /** 3) الفضّ: من المحكّم المعلن، ولا يكون طرفًا (ثوابت 2 و3 و4 و6) */
  resolve(
    arbiter: EntityId,
    disputeId: string,
    ruling: { inFavorOf: EntityId; remedy: RemedyKind; note: string },
    now = Date.now(),
  ): DisputeResult {
    const refuse = (reason: string): DisputeResult => {
      const entry = this.deps.audit.append(arbiter, 'dispute_refused', {
        disputeId, reason, stage: 'resolve',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const d = this.disputes.get(disputeId);
    if (!d) return refuse('نزاع غير موجود');
    if (arbiter !== REGIONAL_ARBITER) return refuse('الفضّ للمحكّم المعلن وحده');
    if (arbiter === d.claimant || arbiter === d.respondent) {
      return refuse('لا يفضّ أحد نزاعًا هو طرف فيه (ثابت 2)');
    }
    if (arbiter === REGIONS_COUNCIL) return refuse('مجلس الأقاليم لا يحكّم بين أعضائه');
    if (d.status !== 'raised' && d.status !== 'answered') {
      return refuse(`حالة النزاع ${d.status} لا تقبل الفضّ`);
    }
    if (ruling.note.trim().length < 3) return refuse('لا فضّ بلا تسبيب معلن (RULE-006)');
    if (ruling.inFavorOf !== d.claimant && ruling.inFavorOf !== d.respondent) {
      return refuse('الحكم لغير طرفي النزاع');
    }

    let bySilence = false;
    if (d.response === null) {
      if (now - d.raisedAt <= this.responseWindowMs) {
        return refuse('لا فضّ قبل سماع المدّعى عليه أو انقضاء مدة الردّ (ثابت 3)');
      }
      bySilence = true;
      this.deps.audit.append(arbiter, 'response_window_elapsed', {
        disputeId, respondent: d.respondent, windowMs: this.responseWindowMs,
      });
    }

    const finalRuling: Ruling = {
      by: arbiter, inFavorOf: ruling.inFavorOf, remedy: ruling.remedy,
      note: ruling.note.trim(), at: now, bySilence,
    };
    const updated: Dispute = { ...d, status: 'resolved', ruling: finalRuling };
    this.disputes.set(disputeId, updated);
    const entry = this.deps.audit.append(arbiter, 'dispute_resolved', {
      disputeId, inFavorOf: finalRuling.inFavorOf, remedy: finalRuling.remedy,
      note: finalRuling.note, bySilence,
      // ثابت 4: الحكم لا ينفّذ نقل نطاق — النقل تعديل ملكي بسجل الأقاليم
      transfersDomain: false,
    });
    return { ok: true, dispute: updated, auditId: entry.hash };
  }

  /** 4) التصعيد: حقّ للطرفين بعد الحكم، ولا يقبل بعد حكم ملكي (ثابت 5) */
  escalate(party: EntityId, disputeId: string, reason: string, now = Date.now()): DisputeResult {
    const refuse = (why: string): DisputeResult => {
      const entry = this.deps.audit.append(party, 'dispute_refused', {
        disputeId, reason: why, stage: 'escalate',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const d = this.disputes.get(disputeId);
    if (!d) return refuse('نزاع غير موجود');
    if (party !== d.claimant && party !== d.respondent) return refuse('التصعيد لطرفي النزاع وحدهما');
    if (d.status === 'royal_settled') return refuse('الحكم الملكي نهائي لا يُصعَّد بعده (ثابت 5)');
    if (d.status !== 'resolved') return refuse('لا تصعيد قبل حكم المحكّم');
    if (reason.trim().length < 3) return refuse('لا تصعيد بلا سبب معلن (RULE-006)');

    const updated: Dispute = {
      ...d, status: 'escalated', escalation: { by: party, reason: reason.trim(), at: now },
    };
    this.disputes.set(disputeId, updated);
    const entry = this.deps.audit.append(party, 'dispute_escalated', {
      disputeId, reason: reason.trim(), priorRuling: d.ruling?.inFavorOf ?? null,
    });
    return { ok: true, dispute: updated, auditId: entry.hash };
  }

  /** 5) الحكم الملكي: مراجعة قضائية معتمدة، ونهايةُ المسار (ثابت 5) */
  royalSettlement(
    command: SignedRoyalCommand, disputeId: string, inFavorOf: EntityId, now = Date.now(),
  ): DisputeResult {
    const refuse = (reason: string): DisputeResult => {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'dispute_refused', {
        disputeId, reason, stage: 'royal',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const d = this.disputes.get(disputeId);
    if (!d) return refuse('نزاع غير موجود');
    if (d.status !== 'escalated') return refuse('لا حكم ملكي بلا تصعيد مسجَّل');
    if (inFavorOf !== d.claimant && inFavorOf !== d.respondent) return refuse('الحكم لغير طرفي النزاع');
    const decision = this.authorize(command, inFavorOf, now);
    if (!decision.allowed) return refuse(`الأمر غير معتمد: ${decision.reason}`);

    const updated: Dispute = {
      ...d, status: 'royal_settled',
      royalRuling: { commandId: command.payload.commandId, inFavorOf, at: now },
    };
    this.disputes.set(disputeId, updated);
    const entry = this.deps.audit.append(command.payload.issuedBy, 'royal_settlement', {
      disputeId, inFavorOf, commandId: command.payload.commandId,
      overturned: d.ruling !== null && d.ruling.inFavorOf !== inFavorOf,
      final: true,
    });
    return { ok: true, dispute: updated, auditId: entry.hash };
  }

  dispute(disputeId: string): Dispute | undefined {
    return this.disputes.get(disputeId);
  }

  /** النزاعات التي لم تُحسم بعد */
  open(): readonly Dispute[] {
    return [...this.disputes.values()].filter(
      (d) => d.status === 'raised' || d.status === 'answered' || d.status === 'escalated',
    );
  }

  report(): {
    total: number; open: number; resolved: number; escalated: number; royalSettled: number;
    bySilence: number;
  } {
    const all = [...this.disputes.values()];
    return {
      total: all.length,
      open: this.open().length,
      resolved: all.filter((d) => d.status === 'resolved').length,
      escalated: all.filter((d) => d.status === 'escalated').length,
      royalSettled: all.filter((d) => d.status === 'royal_settled').length,
      bySilence: all.filter((d) => d.ruling?.bySilence === true).length,
    };
  }

  /** الاعتماد: مراجعة قضائية موجَّهة إلى الطرف المحكوم له */
  private authorize(command: SignedRoyalCommand, target: EntityId, now: number): Decision {
    if (command.payload.action !== 'judicial_review') {
      return { allowed: false, reason: 'الحكم الملكي بفعل judicial_review وحده', auditId: '' };
    }
    if (command.payload.target !== target) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق المحكوم له', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }

  private evidenceExists(hash: string): boolean {
    if (!hash.trim()) return false;
    return this.deps.audit.snapshot().some((e) => e.hash === hash);
  }
}
