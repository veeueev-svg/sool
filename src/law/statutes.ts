/**
 * src/law/statutes.ts — سجل القوانين المعلنة (المرحلة 22)
 * المالك: وزارة العدل
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل amend_policy + نص قانون معلن
 * المخرجات: قانون بإصدار مرقَّم ونطاق سريان زمني، أو رفض بسبب موثّق
 * التبعيات: بوابة التاج (الاعتماد)، السجل غير القابل للمحو (التدقيق)
 * الصلاحيات: الإصدار والتعديل والإلغاء بأمر ملكي فقط — والاقتراح لا يكفي (RULE-004)
 * السجلات: statute_enacted / statute_refused / statute_amended / statute_repealed
 * ثوابت هذه الوحدة:
 *   1) لا قانون بلا نص ولا عقوبات معلنة ولا تاريخ سريان — القانون المبهم لا يُحاكَم به
 *   2) **لا أثر رجعي**: فعل وقع قبل سريان القانون لا يُحاسب عليه (applicableAt)
 *   3) القانون لا يُعدَّل في مكانه: التعديل إصدار جديد يشير إلى سابقه ويبقيه للتاريخ
 *   4) **من يخضع للقانون لا يشرّعه** (RULE-005): مقترح القانون لا يكون من نطاق خضوعه
 *   5) الإلغاء لا يمحو القانون: يوقف سريانه من لحظة معلنة ويبقى نصّه وأثره
 *   6) العقوبة المسمّاة في الحكم يجب أن تكون من عقوبات القانون المعلنة لا من خارجها
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ نص ناقص ⇒ رفض؛
 *   سريان في الماضي ⇒ رفض؛ تعديل قانون غير موجود أو ملغى ⇒ رفض
 * اختبار القبول: tests/law/statutes.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0006-law-and-courts.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

/** العقوبات المعلنة — لا عقوبة تُبتكر في قاعة المحكمة */
export type PenaltyKind =
  | 'warning'               // تحذير مسجَّل
  | 'capability_revocation' // سحب القدرات الممنوحة
  | 'suspension'            // تعليق التشغيل
  | 'spawn_freeze'          // تجميد التوالد
  | 'termination';          // إنهاء الوكيل (يحتاج أمرًا ملكيًا عند التنفيذ)

export const PENALTY_KINDS: readonly PenaltyKind[] = [
  'warning', 'capability_revocation', 'suspension', 'spawn_freeze', 'termination',
];

/** ترتيب الشدّة — يُستخدم في الاستئناف: التخفيف لا يكون تشديدًا */
export const PENALTY_SEVERITY: Readonly<Record<PenaltyKind, number>> = {
  warning: 1,
  capability_revocation: 2,
  suspension: 3,
  spawn_freeze: 4,
  termination: 5,
};

export type StatuteSeverity = 'minor' | 'major' | 'grave';

export interface Statute {
  readonly statuteId: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly severity: StatuteSeverity;
  /** العقوبات الجائزة بهذا القانون — قائمة مغلقة */
  readonly penalties: readonly PenaltyKind[];
  /** نطاق الخضوع: بادئات أو معرّفات كيانات يسري عليها القانون */
  readonly appliesTo: readonly string[];
  readonly proposedBy: EntityId;
  readonly enactedBy: EntityId;
  readonly enactedAt: number;
  readonly effectiveFrom: number;
  readonly repealedAt: number | null;
  readonly repealReason: string | null;
  readonly commandId: string;
  /** إصدار سابق عُدِّل إلى هذا الإصدار — للتاريخ لا للمحو */
  readonly supersedes: number | null;
  /**
   * T-33 (W-2026-052): مدّةُ التقادم بالأيام — معلنةٌ في نصّ القانون نفسِه (أو افتراضُ درجته المعلن في
   * `LIMITATION_DAYS_BY_SEVERITY`). اتهامٌ بعد انقضائها من لحظة الوقوع يُرفض: لا دعوى إلى الأبد.
   */
  readonly limitationDays: number;
}

/** T-33: افتراضُ التقادم بحسب الدرجة — يُعلن في النصّ ما يخالفه، ولا قانونَ بلا تقادم */
export const LIMITATION_DAYS_BY_SEVERITY: Readonly<Record<StatuteSeverity, number>> = Object.freeze({
  minor: 90, major: 365, grave: 1825,
});
/** T-33: سقفُ التقادم المعلن — عشرُ سنوات */
export const MAX_LIMITATION_DAYS = 3650;

export interface StatuteInput {
  readonly statuteId: string;
  readonly title: string;
  readonly text: string;
  readonly severity: StatuteSeverity;
  readonly penalties: readonly PenaltyKind[];
  readonly appliesTo: readonly string[];
  readonly proposedBy: EntityId;
  readonly effectiveFrom: number;
  /** T-33: تقادمٌ معلنٌ بالأيام — غيابُه = افتراضُ الدرجة */
  readonly limitationDays?: number;
}

export type StatuteResult =
  | { readonly ok: true; readonly statute: Statute; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface LawRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly ministryId?: EntityId;
}

/** هل يخضع الكيان لهذا النطاق؟ مطابقة بالمعرّف الكامل أو بالبادئة (`agent:` مثلًا) */
export function inScope(entity: EntityId, scope: readonly string[]): boolean {
  return scope.some((s) => s === '*' || entity === s || (s.endsWith(':') && entity.startsWith(s)));
}

export class LawRegistry {
  /** كل الإصدارات لكل قانون بترتيب الإصدار — لا إصدار يُحذف */
  private readonly versions = new Map<string, Statute[]>();
  private readonly ministryId: EntityId;

  constructor(private readonly deps: LawRegistryDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:justice';
  }

  /** إصدار قانون جديد بأمر ملكي معتمد */
  enact(command: SignedRoyalCommand, input: StatuteInput, now = Date.now()): StatuteResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): StatuteResult => {
      const entry = this.deps.audit.append(this.ministryId, 'statute_refused', {
        statuteId: input.statuteId, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const shape = this.validateShape(input, now);
    if (shape) return refuse(shape);
    if (this.versions.has(input.statuteId)) {
      return refuse('قانون بهذا المعرّف قائم — التعديل يمرّ بـ amend لا بـ enact');
    }
    const authorized = this.authorize(command, input.statuteId, 'enact', now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const statute: Statute = {
      statuteId: input.statuteId,
      version: 1,
      title: input.title.trim(),
      text: input.text.trim(),
      severity: input.severity,
      penalties: [...input.penalties],
      appliesTo: [...input.appliesTo],
      proposedBy: input.proposedBy,
      enactedBy: command.payload.issuedBy,
      enactedAt: now,
      effectiveFrom: input.effectiveFrom,
      repealedAt: null,
      repealReason: null,
      commandId: command.payload.commandId,
      supersedes: null,
      limitationDays: input.limitationDays ?? LIMITATION_DAYS_BY_SEVERITY[input.severity],
    };
    this.versions.set(statute.statuteId, [statute]);
    const entry = this.deps.audit.append(this.ministryId, 'statute_enacted', {
      statuteId: statute.statuteId, version: 1, severity: statute.severity,
      effectiveFrom: statute.effectiveFrom, penalties: statute.penalties,
      commandId: statute.commandId,
    });
    return { ok: true, statute, auditId: entry.hash };
  }

  /**
   * تعديل قانون قائم: إصدار جديد يشير إلى سابقه — والسابق يبقى نافذًا على ما وقع في زمنه.
   * لا تُعدَّل خصائص الإصدار القديم أبدًا (ثابت 3).
   */
  amend(
    command: SignedRoyalCommand,
    statuteId: string,
    changes: Partial<Omit<StatuteInput, 'statuteId'>>,
    now = Date.now(),
  ): StatuteResult {
    const refuse = (reason: string): StatuteResult => {
      const entry = this.deps.audit.append(this.ministryId, 'statute_refused', {
        statuteId, reason, mode: 'amend',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const chain = this.versions.get(statuteId);
    if (!chain || chain.length === 0) return refuse('قانون غير موجود — لا تعديل لما لم يُشرَّع');
    const current = chain[chain.length - 1]!;
    if (current.repealedAt !== null) return refuse('قانون ملغى — يُشرَّع من جديد لا يُعدَّل');

    const merged: StatuteInput = {
      statuteId,
      title: changes.title ?? current.title,
      text: changes.text ?? current.text,
      severity: changes.severity ?? current.severity,
      penalties: changes.penalties ?? current.penalties,
      appliesTo: changes.appliesTo ?? current.appliesTo,
      proposedBy: changes.proposedBy ?? current.proposedBy,
      effectiveFrom: changes.effectiveFrom ?? Math.max(now, current.effectiveFrom),
      // T-33: تغييرُ الدرجة بلا تقادمٍ معلنٍ يعيد افتراضَ الدرجة الجديدة
      ...(changes.limitationDays !== undefined ? { limitationDays: changes.limitationDays }
        : changes.severity === undefined ? { limitationDays: current.limitationDays } : {}),
    };
    const shape = this.validateShape(merged, now);
    if (shape) return refuse(shape);
    const authorized = this.authorize(command, statuteId, 'amend', now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const next: Statute = {
      ...merged,
      version: current.version + 1,
      title: merged.title.trim(),
      text: merged.text.trim(),
      penalties: [...merged.penalties],
      appliesTo: [...merged.appliesTo],
      enactedBy: command.payload.issuedBy,
      enactedAt: now,
      repealedAt: null,
      repealReason: null,
      commandId: command.payload.commandId,
      supersedes: current.version,
      limitationDays: merged.limitationDays ?? LIMITATION_DAYS_BY_SEVERITY[merged.severity],
    };
    chain.push(next);
    const entry = this.deps.audit.append(this.ministryId, 'statute_amended', {
      statuteId, version: next.version, supersedes: current.version,
      effectiveFrom: next.effectiveFrom, commandId: next.commandId,
    });
    return { ok: true, statute: next, auditId: entry.hash };
  }

  /** إلغاء: يوقف السريان من لحظة معلنة ولا يمحو النص ولا الأحكام السابقة */
  repeal(command: SignedRoyalCommand, statuteId: string, reason: string, now = Date.now()): StatuteResult {
    const refuse = (why: string): StatuteResult => {
      const entry = this.deps.audit.append(this.ministryId, 'statute_refused', {
        statuteId, reason: why, mode: 'repeal',
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const chain = this.versions.get(statuteId);
    if (!chain || chain.length === 0) return refuse('قانون غير موجود');
    const current = chain[chain.length - 1]!;
    if (current.repealedAt !== null) return refuse('قانون ملغى سابقًا');
    if (!reason.trim()) return refuse('لا إلغاء بلا سبب مسجَّل');
    const authorized = this.authorize(command, statuteId, 'repeal', now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const repealed: Statute = { ...current, repealedAt: now, repealReason: reason.trim() };
    chain[chain.length - 1] = repealed;
    const entry = this.deps.audit.append(this.ministryId, 'statute_repealed', {
      statuteId, version: repealed.version, reason: repealed.repealReason, at: now,
    });
    return { ok: true, statute: repealed, auditId: entry.hash };
  }

  /**
   * القانون الذي كان نافذًا في لحظة معيّنة — أساس منع الأثر الرجعي (ثابت 2).
   * يُرجع الإصدار الذي سرى قبل اللحظة ولم يكن ملغى فيها.
   */
  applicableAt(statuteId: string, at: number): Statute | undefined {
    const chain = this.versions.get(statuteId);
    if (!chain) return undefined;
    let found: Statute | undefined;
    for (const v of chain) {
      if (v.effectiveFrom <= at && (v.repealedAt === null || at < v.repealedAt)) {
        if (!found || v.version > found.version) found = v;
      }
    }
    return found;
  }

  /** الإصدار الحالي بصرف النظر عن السريان — للعرض والتدقيق */
  latest(statuteId: string): Statute | undefined {
    const chain = this.versions.get(statuteId);
    return chain && chain.length ? chain[chain.length - 1] : undefined;
  }

  history(statuteId: string): readonly Statute[] {
    return [...(this.versions.get(statuteId) ?? [])];
  }

  list(): readonly Statute[] {
    return [...this.versions.values()].map((c) => c[c.length - 1]!);
  }

  /** القوانين النافذة على كيان في لحظة — يستخدمها الادعاء لتحديد التهمة */
  governing(entity: EntityId, at: number): readonly Statute[] {
    return this.list()
      .map((s) => this.applicableAt(s.statuteId, at))
      .filter((s): s is Statute => !!s && inScope(entity, s.appliesTo));
  }

  report(): {
    readonly total: number;
    readonly inForce: number;
    readonly repealed: number;
    readonly amendments: number;
  } {
    const heads = this.list();
    let amendments = 0;
    for (const chain of this.versions.values()) amendments += chain.length - 1;
    return {
      total: heads.length,
      inForce: heads.filter((s) => s.repealedAt === null).length,
      repealed: heads.filter((s) => s.repealedAt !== null).length,
      amendments,
    };
  }

  /** فحص الشكل قبل أي اعتماد — الرفض قبل استهلاك الأمر الملكي */
  private validateShape(input: StatuteInput, now: number): string | null {
    if (!input.statuteId.trim()) return 'معرّف قانون فارغ';
    if (!input.title.trim() || input.text.trim().length < 8) {
      return 'لا قانون بلا عنوان ونص صريح — القانون المبهم لا يُحاكَم به';
    }
    if (!['minor', 'major', 'grave'].includes(input.severity)) return 'درجة جسامة غير معلنة';
    if (input.limitationDays !== undefined && (!Number.isSafeInteger(input.limitationDays)
      || input.limitationDays <= 0 || input.limitationDays > MAX_LIMITATION_DAYS)) {
      return `مدّة تقادمٍ غير صالحة — عددُ أيامٍ صحيحٌ موجبٌ لا يتجاوز ${MAX_LIMITATION_DAYS} (T-33)`;
    }
    if (input.penalties.length === 0) return 'لا قانون بلا عقوبة معلنة';
    for (const p of input.penalties) {
      if (!PENALTY_KINDS.includes(p)) return `عقوبة غير معلنة: ${p}`;
    }
    if (input.appliesTo.length === 0) return 'لا قانون بلا نطاق خضوع معلن';
    if (!Number.isFinite(input.effectiveFrom)) return 'تاريخ سريان غير صالح';
    if (input.effectiveFrom < now) return 'لا أثر رجعي: السريان لا يبدأ قبل لحظة الإصدار';
    if (!input.proposedBy.trim()) return 'لا قانون بلا جهة مقترحة معلنة';
    // RULE-005: من يخضع للقانون لا يشرّعه
    if (inScope(input.proposedBy, input.appliesTo)) {
      return 'من يخضع للقانون لا يقترحه — فصل السياسة عن الخاضع لها (RULE-005)';
    }
    return null;
  }

  /** كل تشريع يمرّ ببوابة التاج بفعل amend_policy وبهدف هو القانون نفسه (RULE-003) */
  private authorize(command: SignedRoyalCommand, statuteId: string, mode: string, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'statute_refused', {
        statuteId, mode, reason: 'فعل الأمر ليس amend_policy',
      });
      return { allowed: false, reason: 'التشريع فعل سياسة — يلزمه amend_policy', auditId: entry.hash };
    }
    if (command.payload.target !== statuteId) {
      const entry = this.deps.audit.append(command.payload.issuedBy, 'statute_refused', {
        statuteId, mode, reason: 'هدف الأمر لا يطابق القانون',
      });
      return { allowed: false, reason: 'هدف الأمر لا يطابق القانون المقصود', auditId: entry.hash };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
