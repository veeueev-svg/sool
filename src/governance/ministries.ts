/**
 * src/governance/ministries.ts — سجل الوزارات ونطاقات الاختصاص (المرحلة 23)
 * المالك: الديوان الملكي
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: أمر ملكي معتمد بفعل amend_policy موجَّه إلى معرّف الوزارة
 * المخرجات: وزارة قائمة بنطاق اختصاص لا يزاحم غيرها، أو رفض بسبب موثّق
 * التبعيات: بوابة التاج (الاعتماد)، السجل غير القابل للمحو (التدقيق)
 * الصلاحيات: الإنشاء والحلّ بأمر ملكي فقط — والوزارة لا تُنشئ نفسها ولا توسّع اختصاصها
 * السجلات: ministry_established / ministry_dissolved / ministry_refused / mandate_reassigned
 * ثوابت هذه الوحدة:
 *   1) لا وزارة بلا أمر ملكي معتمد، ولا وزارة بلا نطاق اختصاص معلن
 *   2) **لا تزاحم اختصاص**: نطاق واحد لا يملكه إلا وزارة واحدة قائمة —
 *      لأن نطاقًا بمالكين يعني قرارين متعارضين بلا مرجع يحسم
 *   3) الوزارة لا توسّع نطاقها بنفسها: التوسيع تعديل يمرّ بالبوابة (RULE-005)
 *   4) **لا حلّ لوزارة وفيها منصب مشغول**: يُعزل أهلها أولًا بمساره المعلن،
 *      وإن لم يوجد مصدر يتحقق من مناصبها فالحلّ مرفوض (فشل مغلق لا مفتوح)
 *   5) الحلّ لا يمحو الوزارة من السجل: يوقف اختصاصها ويبقي تاريخها
 * حالات الفشل (كلها مغلقة): أمر غير معتمد ⇒ رفض؛ نطاق فارغ أو مزدحم ⇒ رفض؛
 *   حلّ وزارة غير قائمة ⇒ رفض؛ حلّ بلا مصدر تحقق من المناصب ⇒ رفض
 * اختبار القبول: tests/governance/ministries.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0007-government-and-ministries.md
 */
import { Decision, EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';

/** الجهة التي تقترح البنية الحكومية — ولا تعتمدها ولا تنفّذها (RULE-004) */
export const ROYAL_COURT: EntityId = 'authority:royal_court';

export interface Ministry {
  readonly ministryId: EntityId;
  readonly name: string;
  /** نطاقات الاختصاص: كلمات مجال معلنة، لا يملك النطاق إلا وزارة واحدة */
  readonly mandate: readonly string[];
  readonly establishedBy: EntityId;
  readonly establishedAt: number;
  readonly commandId: string;
  readonly dissolvedAt: number | null;
  readonly dissolveReason: string | null;
}

export interface MinistryInput {
  readonly ministryId: EntityId;
  readonly name: string;
  readonly mandate: readonly string[];
  readonly proposedBy: EntityId;
}

export type MinistryResult =
  | { readonly ok: true; readonly ministry: Ministry; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };
export interface MinistrySnapshot { readonly ministries: readonly Ministry[]; }

/** مصدر يتحقق من المناصب المشغولة في وزارة — يُربط من سجل التعيينات */
export type OccupancyProbe = (ministryId: EntityId) => readonly string[];

export interface MinistryRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly actorId?: EntityId;
}

export class MinistryRegistry {
  private readonly ministries = new Map<EntityId, Ministry>();
  private readonly actorId: EntityId;
  /** يبقى null حتى يُربط: والحلّ بلا ربط مرفوض (ثابت 4 — فشل مغلق) */
  private occupancy: OccupancyProbe | null = null;

  constructor(private readonly deps: MinistryRegistryDeps) {
    this.actorId = deps.actorId ?? ROYAL_COURT;
  }

  /**
   * ربط مصدر التحقق من المناصب (سجل التعيينات) — يُستدعى مرة عند التأسيس.
   * لا يُكتب سجل تدقيق هنا عن قصد: التأسيس يُختم بسجل `state_online` وحده،
   * وغياب الربط ليس حادثًا صامتًا لأن الحلّ يُرفض ويُسجَّل عند أول محاولة (فشل مغلق).
   */
  bindOccupancyProbe(probe: OccupancyProbe): void {
    this.occupancy = probe;
  }

  /** إنشاء وزارة بأمر ملكي معتمد */
  establish(command: SignedRoyalCommand, input: MinistryInput, now = Date.now()): MinistryResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): MinistryResult => {
      const entry = this.deps.audit.append(this.actorId, 'ministry_refused', {
        ministryId: input.ministryId, reason, mode: 'establish', ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    if (!input.ministryId.startsWith('ministry:')) {
      return refuse('معرّف الوزارة يجب أن يبدأ بـ ministry:');
    }
    if (input.name.trim().length < 3) return refuse('لا وزارة بلا اسم معلن');
    if (input.mandate.length === 0) return refuse('لا وزارة بلا نطاق اختصاص معلن');
    const active = this.ministries.get(input.ministryId);
    if (active && active.dissolvedAt === null) return refuse('وزارة بهذا المعرّف قائمة');

    // ثابت 2: لا نطاق بمالكين
    for (const domain of input.mandate) {
      const owner = this.competentFor(domain);
      if (owner) {
        return refuse(`تزاحم اختصاص: النطاق «${domain}» يملكه ${owner.ministryId}`, { domain });
      }
    }
    if (input.proposedBy === input.ministryId) {
      return refuse('الوزارة لا تقترح إنشاء نفسها (RULE-005)');
    }

    const authorized = this.authorize(command, input.ministryId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const ministry: Ministry = {
      ministryId: input.ministryId,
      name: input.name.trim(),
      mandate: [...input.mandate],
      establishedBy: command.payload.issuedBy,
      establishedAt: now,
      commandId: command.payload.commandId,
      dissolvedAt: null,
      dissolveReason: null,
    };
    this.ministries.set(ministry.ministryId, ministry);
    const entry = this.deps.audit.append(this.actorId, 'ministry_established', {
      ministryId: ministry.ministryId, mandate: ministry.mandate,
      proposedBy: input.proposedBy, commandId: ministry.commandId,
    });
    return { ok: true, ministry, auditId: entry.hash };
  }

  /** توسيع أو تضييق النطاق — تعديل يمرّ بالبوابة، لا تصرّف داخلي */
  reassignMandate(
    command: SignedRoyalCommand, ministryId: EntityId, mandate: readonly string[], now = Date.now(),
  ): MinistryResult {
    const refuse = (reason: string): MinistryResult => {
      const entry = this.deps.audit.append(this.actorId, 'ministry_refused', {
        ministryId, reason, mode: 'reassign',
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    const current = this.ministries.get(ministryId);
    if (!current || current.dissolvedAt !== null) return refuse('وزارة غير قائمة');
    if (mandate.length === 0) return refuse('لا وزارة بلا نطاق اختصاص معلن');
    for (const domain of mandate) {
      const owner = this.competentFor(domain);
      if (owner && owner.ministryId !== ministryId) {
        return refuse(`تزاحم اختصاص: النطاق «${domain}» يملكه ${owner.ministryId}`);
      }
    }
    const authorized = this.authorize(command, ministryId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const updated: Ministry = { ...current, mandate: [...mandate] };
    this.ministries.set(ministryId, updated);
    const entry = this.deps.audit.append(this.actorId, 'mandate_reassigned', {
      ministryId, from: current.mandate, to: updated.mandate, commandId: command.payload.commandId,
    });
    return { ok: true, ministry: updated, auditId: entry.hash };
  }

  /** حلّ وزارة: بأمر ملكي، وبشرط ألا يبقى فيها منصب مشغول (ثابت 4) */
  dissolve(
    command: SignedRoyalCommand, ministryId: EntityId, reason: string, now = Date.now(),
  ): MinistryResult {
    const refuse = (why: string, extra: Record<string, unknown> = {}): MinistryResult => {
      const entry = this.deps.audit.append(this.actorId, 'ministry_refused', {
        ministryId, reason: why, mode: 'dissolve', ...extra,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const current = this.ministries.get(ministryId);
    if (!current || current.dissolvedAt !== null) return refuse('وزارة غير قائمة');
    if (reason.trim().length < 3) return refuse('لا حلّ بلا سبب معلن (RULE-006)');
    if (this.occupancy === null) {
      return refuse('لا مصدر يتحقق من مناصب الوزارة — الحلّ مرفوض حتى يُربط سجل التعيينات');
    }
    const occupied = this.occupancy(ministryId);
    if (occupied.length > 0) {
      return refuse('مناصب مشغولة: يُعزل أهلها بمساره المعلن أولًا', { occupied: [...occupied] });
    }
    const authorized = this.authorize(command, ministryId, now);
    if (!authorized.allowed) return refuse(`الأمر غير معتمد: ${authorized.reason}`);

    const dissolved: Ministry = { ...current, dissolvedAt: now, dissolveReason: reason.trim() };
    this.ministries.set(ministryId, dissolved);
    const entry = this.deps.audit.append(this.actorId, 'ministry_dissolved', {
      ministryId, reason: dissolved.dissolveReason, commandId: command.payload.commandId,
    });
    return { ok: true, ministry: dissolved, auditId: entry.hash };
  }

  /** الوزارة القائمة صاحبة الاختصاص في نطاق ما — أو null إن لم يوجد */
  competentFor(domain: string): Ministry | null {
    for (const m of this.ministries.values()) {
      if (m.dissolvedAt === null && m.mandate.includes(domain)) return m;
    }
    return null;
  }

  isActive(ministryId: EntityId): boolean {
    const m = this.ministries.get(ministryId);
    return m !== undefined && m.dissolvedAt === null;
  }

  get(ministryId: EntityId): Ministry | undefined {
    return this.ministries.get(ministryId);
  }

  active(): readonly Ministry[] {
    return [...this.ministries.values()].filter((m) => m.dissolvedAt === null);
  }

  report(): { total: number; active: number; dissolved: number; domains: number } {
    const all = [...this.ministries.values()];
    const active = all.filter((m) => m.dissolvedAt === null);
    const domains = new Set<string>();
    for (const m of active) for (const d of m.mandate) domains.add(d);
    return {
      total: all.length,
      active: active.length,
      dissolved: all.length - active.length,
      domains: domains.size,
    };
  }

  /** لقطة للحالة المتغيرة وحدها؛ الاعتماد يبقى في بوابة التاج عند الاستعمال التالي. */
  exportAll(): MinistrySnapshot {
    return { ministries: [...this.ministries.values()].map((ministry) => ({ ...ministry, mandate: [...ministry.mandate] })) };
  }

  /** لا يستدعى إلا داخل الأرشيف الملكي؛ يفحص تزاحم الاختصاص قبل التبديل. */
  importAll(snapshot: MinistrySnapshot, by: EntityId): boolean {
    if (!Array.isArray(snapshot.ministries)
      || new Set(snapshot.ministries.map((ministry) => ministry.ministryId)).size !== snapshot.ministries.length) {
      throw new Error('RECOVERY_MINISTRY_INVALID');
    }
    const domains = new Set<string>();
    for (const ministry of snapshot.ministries) {
      if (!ministry.ministryId.startsWith('ministry:') || !ministry.name
        || !Array.isArray(ministry.mandate) || ministry.mandate.length === 0) {
        throw new Error('RECOVERY_MINISTRY_INVALID');
      }
      if (ministry.dissolvedAt === null) {
        for (const domain of ministry.mandate) {
          if (domains.has(domain)) throw new Error('RECOVERY_MINISTRY_MANDATE_CONFLICT');
          domains.add(domain);
        }
      }
    }
    this.ministries.clear();
    for (const ministry of snapshot.ministries) {
      this.ministries.set(ministry.ministryId, { ...ministry, mandate: [...ministry.mandate] });
    }
    this.deps.audit.append(by, 'ministries_restored', { total: this.ministries.size });
    return true;
  }

  /** الاعتماد: فعل amend_policy وهدفه الوزارة نفسها لا غيرها */
  private authorize(command: SignedRoyalCommand, ministryId: EntityId, now: number): Decision {
    if (command.payload.action !== 'amend_policy') {
      return { allowed: false, reason: 'بنية الحكومة تُعدَّل بفعل amend_policy وحده', auditId: '' };
    }
    if (command.payload.target !== ministryId) {
      return { allowed: false, reason: 'هدف الأمر لا يطابق الوزارة', auditId: '' };
    }
    return this.deps.gateway.authorize(command, now);
  }
}
