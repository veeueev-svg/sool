/**
 * src/services/company_runtime.ts — سجل الشركات والمنشآت الاقتصادية (المرحلة 28)
 * المالك: وزارة الاقتصاد — تُقترح المنشأة منها، ولا تفتّش جودتها بيدها، ولا تُقيمها بأمرها
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نوع منشأة معلن في config/enterprises.yaml + بند موازنة قائم (المرحلة 25)
 *           + وزارة قائمة (المرحلة 23) + أمر ملكي بفعل establish_facility
 * المخرجات: منشأة معلنة، مؤقَّتة بمدة إلزامية، محدودة العدد — أو رفض بسبب موثّق
 * التبعيات: بوابة التاج، سجل التدقيق، سجل الموارد، مصدر تحقق الوزارة، مصدر تحقق الموازنة
 * الصلاحيات: الإقامة والاستئناف والحلّ **بأمر ملكي**؛ والتعليق **بلا أمر** لجهات معلنة
 *            لأنه فعل حماية رخيص الثمن (نظير المرحلة 26 لا المرحلة 27)
 * السجلات: facility_established / facility_refused / facility_suspended /
 *           facility_resumed / facility_dissolved
 * ثوابت هذه الوحدة:
 *   1) **لا منشأة لنوع غير معلن** (RULE-005): الإقامة لا تُنشئ نوعًا مهما صحّ الأمر
 *   2) **لا منشأة بلا مدة**: `expiresAt` إلزامي، ولا يتجاوز `max_term_days`، والمنتهية
 *      غير قائمة بلا استدعاء ولا تُستأنف — والجديدة منشأةٌ جديدة بأمر جديد
 *   3) **لا منشأة بلا بند موازنة قائم**: النفقة معلنة قبل الإقامة، ومصدر التحقق غير
 *      المربوط ⇒ كل إقامة مرفوضة (فشل مغلق)
 *   4) **لا منشأة لوزارة غير قائمة**: الجهة المشغّلة كيانٌ قائم لا اسمٌ مذكور
 *   5) **الاقتراح لوزارة الاقتصاد وحدها** (RULE-004)، والتفتيش لغيرها (المفتّش في
 *      `factory_runtime.ts`) — فلا تشهد يدٌ لعملها
 *   6) **حدّ معلن لعدد منشآت الوزارة**: التفتيت بلا حدّ يُخفي المجموع
 *   7) **التعليق فوري بلا أمر**، و**الاستئناف بأمر ملكي وبغير من علّق** — ما يُرجَع عنه
 *      لا ينتظر، وما لا رجعة فيه يستأذن
 *   8) **الحلّ نهائي**: لا إحياء بعده، ويستعيد كل موارد المنشأة في اللحظة نفسها
 * حالات الفشل (كلها مغلقة): نوع غير معلن ⇒ رفض؛ بلا مدة أو مدة فوق الحدّ ⇒ رفض؛
 *   بند موازنة غائب أو ساقط ⇒ رفض؛ وزارة غير قائمة ⇒ رفض؛ مقترح غير وزارة الاقتصاد ⇒ رفض؛
 *   تجاوز حدّ العدد ⇒ رفض؛ معرّف مكرَّر ⇒ رفض؛ أمر بغير الفعل أو الهدف ⇒ رفض؛
 *   جهة تعليق غير مخوَّلة ⇒ رفض؛ استئناف من نفس من علّق ⇒ رفض؛ حلّ مرتين ⇒ رفض
 * اختبار القبول: tests/services/enterprise_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0012-enterprises.md
 */
import { EntityId, SignedRoyalCommand } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { ResourceRegistry } from '../kernel/resource_registry';

/** وزارة الاقتصاد: الجهة الوحيدة التي تقترح إقامة منشأة (RULE-004) */
export const ECONOMY_MINISTRY: EntityId = 'ministry:economy';

/** نوع منشأة معلن في التهيئة — تُنسخ قيمه من الإعلان لا من الطلب */
export interface DeclaredFacilityKind {
  readonly id: string;
  readonly name: string;
  readonly sector: string;
  readonly inputs: readonly { readonly material: string; readonly quantity: number }[];
  readonly output: { readonly material: string; readonly quantity: number };
  readonly resourceCost: { readonly resource: string; readonly amount: number };
  readonly requiredChecks: readonly string[];
}

export type FacilityStatus = 'active' | 'suspended' | 'dissolved';

export interface Facility {
  readonly facilityId: string;
  readonly kindId: string;
  readonly name: string;
  readonly sector: string;
  readonly operator: EntityId;
  readonly budgetLine: string;
  readonly establishedAt: number;
  /** المدة الإلزامية (ثابت 2) — لا منشأة بلا هذا الحقل */
  readonly expiresAt: number;
  readonly commandId: string;
  readonly purpose: string;
  status: FacilityStatus;
  suspendedAt: number | null;
  suspendedBy: EntityId | null;
  suspensionReason: string | null;
  dissolvedAt: number | null;
  dissolvedBy: EntityId | null;
  dissolutionReason: string | null;
}

export interface EstablishFacilityInput {
  readonly facilityId: string;
  readonly kindId: string;
  /** لحظة الانتهاء — إلزامية: غيابها رفضٌ لا افتراضَ مدةٍ (ثابت 2) */
  readonly expiresAt: number;
  readonly budgetLine: string;
  readonly proposedBy: EntityId;
  readonly purpose: string;
}

export type FacilityResult =
  | { readonly ok: true; readonly facility: Facility; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

/** مصدر يتحقق من قيام الوزارة المشغّلة — فشل مغلق قبل الربط (ثابت 4) */
export type MinistryProbe = (ministryId: EntityId) => boolean;
/** مصدر يتحقق من قيام بند الموازنة — فشل مغلق قبل الربط (ثابت 3) */
export type BudgetLineProbe = (line: string) => boolean;

export interface CompanyRuntimeDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly resources: ResourceRegistry;
  readonly kinds: readonly DeclaredFacilityKind[];
  /** أقصى مدة لأي منشأة — معلنة في config/enterprises.yaml (ثابت 2) */
  readonly maxTermMs: number;
  /** أقصى عدد منشآت قائمة لوزارة واحدة (ثابت 6) */
  readonly maxPerMinistry: number;
  readonly suspendAuthorities: readonly EntityId[];
  readonly operatorId?: EntityId;
  readonly requireBudgetLine?: boolean;
}

export class CompanyRuntime {
  private readonly facilities = new Map<string, Facility>();
  private readonly kinds = new Map<string, DeclaredFacilityKind>();
  private readonly operatorId: EntityId;
  private ministryProbe: MinistryProbe | null = null;
  private budgetProbe: BudgetLineProbe | null = null;

  constructor(private readonly deps: CompanyRuntimeDeps) {
    this.operatorId = deps.operatorId ?? ECONOMY_MINISTRY;
    for (const kind of deps.kinds) this.kinds.set(kind.id, kind);
  }

  /** ربط مصدر التحقق من الوزارة — لا يكتب سجلًّا، وقبله كل إقامة مرفوضة (ثابت 4) */
  bindMinistryProbe(probe: MinistryProbe): void { this.ministryProbe = probe; }
  /** ربط مصدر التحقق من بند الموازنة — لا يكتب سجلًّا، وقبله كل إقامة مرفوضة (ثابت 3) */
  bindBudgetProbe(probe: BudgetLineProbe): void { this.budgetProbe = probe; }

  kind(kindId: string): DeclaredFacilityKind | null { return this.kinds.get(kindId) ?? null; }
  declaredKinds(): readonly DeclaredFacilityKind[] { return [...this.kinds.values()]; }

  /**
   * 1) إقامة منشأة. ترتيب الفحوص مقصود ومُلزم:
   * النوع ← المقترح ← الغرض ← المعرّف ← **المدة** ← الوزارة ← **بند الموازنة** ←
   * حدّ العدد ← الأمر الملكي ← الاعتماد.
   * والمدة تُفحص **قبل** المال والوزارة عن قصد: منشأة بلا نهاية لا يُناقَش تمويلها،
   * لأنها ليست منشأة تُقاس بل التزامٌ دائم بلا حدّ (ثابت 2).
   */
  establish(
    command: SignedRoyalCommand, input: EstablishFacilityInput, now = Date.now(),
  ): FacilityResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}): FacilityResult => {
      const entry = this.deps.audit.append(this.operatorId, 'facility_refused', {
        facilityId: input.facilityId, kindId: input.kindId,
        proposedBy: input.proposedBy, reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };

    const kind = this.kinds.get(input.kindId);
    if (!kind) {
      return refuse('نوع منشأة غير معلن في التهيئة — الإقامة لا تُنشئ نوعًا (ثابت 1)');
    }
    if (input.proposedBy !== this.operatorId) {
      return refuse('اقتراح المنشآت لوزارة الاقتصاد وحدها (RULE-004)');
    }
    if (typeof input.purpose !== 'string' || input.purpose.trim().length < 3) {
      return refuse('لا منشأة بلا غرض معلن (RULE-006)');
    }
    if (typeof input.facilityId !== 'string' || !input.facilityId.startsWith('facility:')) {
      return refuse('معرّف منشأة غير صالح — لا منشأة بلا معرّف معلن');
    }
    if (this.facilities.has(input.facilityId)) {
      return refuse('منشأة قائمة بهذا المعرّف — لا تكرار هوية');
    }
    // ثابت 2: المدة إلزامية — والصفر و NaN والكسري والماضي والمساوي للحظة كلها مرفوضة
    if (!Number.isSafeInteger(input.expiresAt)) {
      return refuse('لا منشأة بلا لحظة انتهاء صالحة — ولا مدة افتراضية تُملأ (ثابت 2)');
    }
    if (input.expiresAt <= now) {
      return refuse('لحظة الانتهاء ماضية أو حاضرة — منشأةٌ منتهية قبل قيامها (ثابت 2)');
    }
    if (input.expiresAt - now > this.deps.maxTermMs) {
      return refuse('المدة تتجاوز الحدّ المعلن — تُرفض ولا تُقرَّب (ثابت 2)', {
        maxTermMs: this.deps.maxTermMs, requestedMs: input.expiresAt - now,
      });
    }
    if (this.ministryProbe === null) {
      return refuse('مصدر التحقق من الوزارة غير مربوط — رفض مغلق (ثابت 4)');
    }
    if (!this.ministryProbe(this.operatorId)) {
      return refuse('الوزارة المشغّلة غير قائمة — لا منشأة لجهة لا وجود لها (ثابت 4)');
    }
    if (this.deps.requireBudgetLine !== false) {
      if (typeof input.budgetLine !== 'string' || input.budgetLine.trim().length === 0) {
        return refuse('لا منشأة بلا بند موازنة معلن (ثابت 3)');
      }
      if (this.budgetProbe === null) {
        return refuse('مصدر التحقق من بند الموازنة غير مربوط — رفض مغلق (ثابت 3)');
      }
      if (!this.budgetProbe(input.budgetLine)) {
        return refuse('بند الموازنة غير قائم أو ساقط — لا منشأة بلا نفقة معلنة (ثابت 3)', {
          budgetLine: input.budgetLine,
        });
      }
    }
    const openCount = this.activeFacilities(now)
      .filter((f) => f.operator === this.operatorId).length;
    if (openCount >= this.deps.maxPerMinistry) {
      return refuse('عدد المنشآت القائمة للوزارة بلغ الحدّ المعلن (ثابت 6)', {
        open: openCount, max: this.deps.maxPerMinistry,
      });
    }
    if (command.payload.action !== 'establish_facility') {
      return refuse('الإقامة بفعل establish_facility وحده (RULE-003)', {
        action: command.payload.action,
      });
    }
    if (command.payload.target !== input.facilityId) {
      return refuse('هدف الأمر لا يطابق معرّف المنشأة — لا أمر عامّ يُقيم أي منشأة', {
        target: command.payload.target,
      });
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر غير معتمد: ${decision.reason}`);

    // القيم تُنسخ من **الإعلان** لا من الطلب: لا يرفع طالبٌ سقفًا بطلبه
    const facility: Facility = {
      facilityId: input.facilityId, kindId: kind.id, name: kind.name, sector: kind.sector,
      operator: this.operatorId, budgetLine: input.budgetLine,
      establishedAt: now, expiresAt: input.expiresAt,
      commandId: command.payload.commandId, purpose: input.purpose.trim(),
      status: 'active',
      suspendedAt: null, suspendedBy: null, suspensionReason: null,
      dissolvedAt: null, dissolvedBy: null, dissolutionReason: null,
    };
    this.facilities.set(facility.facilityId, facility);
    const entry = this.deps.audit.append(this.operatorId, 'facility_established', {
      facilityId: facility.facilityId, kindId: kind.id, sector: kind.sector,
      budgetLine: facility.budgetLine, expiresAt: facility.expiresAt,
      commandId: facility.commandId, purpose: facility.purpose,
    });
    return { ok: true, facility, auditId: entry.hash };
  }

  /**
   * 2) التعليق الفوري — **بلا أمر ملكي** (ثابت 7): الأمر يحتاج وقتًا والقطع لا يحتمله.
   * لكن بجهة معلنة في التهيئة وبسبب مسجَّل، وأثره في اللحظة نفسها:
   * `isActive(moment) = false` فتُرفض كل دفعة إنتاج عند تلك اللحظة.
   */
  suspend(facilityId: string, by: EntityId, reason: string, now = Date.now()): FacilityResult {
    const refuse = (why: string): FacilityResult => {
      const entry = this.deps.audit.append(by, 'facility_refused', {
        facilityId, mode: 'suspend', reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const facility = this.facilities.get(facilityId);
    if (!facility) return refuse('منشأة غير قائمة');
    if (facility.status === 'dissolved') return refuse('منشأة منحلّة — لا تُعلَّق (ثابت 8)');
    if (facility.status === 'suspended') return refuse('منشأة معلَّقة أصلًا — لا تعليق مرتين');
    if (!this.deps.suspendAuthorities.includes(by)) {
      return refuse('جهة غير مخوَّلة بالتعليق (ثابت 7)');
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return refuse('لا تعليق بلا سبب معلن (RULE-006)');
    }
    facility.status = 'suspended';
    facility.suspendedAt = now;
    facility.suspendedBy = by;
    facility.suspensionReason = reason.trim();
    const entry = this.deps.audit.append(by, 'facility_suspended', {
      facilityId, reason: facility.suspensionReason, immediate: true, at: now,
    });
    return { ok: true, facility, auditId: entry.hash };
  }

  /**
   * 3) الاستئناف — **بأمر ملكي وبغير من علّق** (ثابت 7): رفع الحماية أغلى من إنزالها،
   * ومن قطع لا يَصِل بيده، فيُسجَّل `previousBy` ليُقرأ الفصل في السجل لا في النيّة.
   */
  resume(
    command: SignedRoyalCommand, facilityId: string, by: EntityId, now = Date.now(),
  ): FacilityResult {
    const refuse = (why: string): FacilityResult => {
      const entry = this.deps.audit.append(by, 'facility_refused', {
        facilityId, mode: 'resume', reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const facility = this.facilities.get(facilityId);
    if (!facility) return refuse('منشأة غير قائمة');
    if (facility.status !== 'suspended') return refuse('لا استئناف لغير معلَّقة');
    if (facility.expiresAt <= now) {
      return refuse('منشأة انتهت مدتها — لا تُستأنف بل تُقام جديدةً بأمر جديد (ثابت 2)');
    }
    if (by === facility.suspendedBy) {
      return refuse('من علّق لا يستأنف — يدان لا يد (ثابت 7 وRULE-004)');
    }
    if (command.payload.action !== 'establish_facility') {
      return refuse('الاستئناف بفعل establish_facility وحده (RULE-003)');
    }
    if (command.payload.target !== facilityId) {
      return refuse('هدف الأمر لا يطابق معرّف المنشأة');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر غير معتمد: ${decision.reason}`);

    const previousBy = facility.suspendedBy;
    facility.status = 'active';
    facility.suspendedAt = null;
    facility.suspendedBy = null;
    facility.suspensionReason = null;
    const entry = this.deps.audit.append(by, 'facility_resumed', {
      facilityId, by, previousBy, commandId: command.payload.commandId, at: now,
    });
    return { ok: true, facility, auditId: entry.hash };
  }

  /**
   * 4) الحلّ — نهائي بأمر ملكي (ثابت 8). ويستعيد كل موارد المنشأة في اللحظة نفسها،
   * فلا تبقى حصةٌ محتجزة لكيانٍ لا وجود له (نظير `releaseAllFor` في المرحلة 13).
   */
  dissolve(
    command: SignedRoyalCommand, facilityId: string, by: EntityId, reason: string,
    now = Date.now(),
  ): FacilityResult {
    const refuse = (why: string): FacilityResult => {
      const entry = this.deps.audit.append(by, 'facility_refused', {
        facilityId, mode: 'dissolve', reason: why,
      });
      return { ok: false, reason: why, auditId: entry.hash };
    };
    const facility = this.facilities.get(facilityId);
    if (!facility) return refuse('منشأة غير قائمة');
    if (facility.status === 'dissolved') return refuse('لا حلّ مرتين — الحلّ نهائي (ثابت 8)');
    if (typeof reason !== 'string' || reason.trim().length < 3) {
      return refuse('لا حلّ بلا سبب معلن (RULE-006)');
    }
    if (command.payload.action !== 'establish_facility') {
      return refuse('الحلّ بفعل establish_facility وحده (RULE-003)');
    }
    if (command.payload.target !== facilityId) {
      return refuse('هدف الأمر لا يطابق معرّف المنشأة');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر غير معتمد: ${decision.reason}`);

    const released = this.deps.resources.releaseAllFor(facilityId);
    facility.status = 'dissolved';
    facility.dissolvedAt = now;
    facility.dissolvedBy = by;
    facility.dissolutionReason = reason.trim();
    const entry = this.deps.audit.append(by, 'facility_dissolved', {
      facilityId, by, reason: facility.dissolutionReason,
      releasedLeases: released, final: true, at: now,
    });
    return { ok: true, facility, auditId: entry.hash };
  }

  /** المنشأة قائمة إن كانت نشطة **ولم تنته مدتها** — المنتهية غير قائمة بلا استدعاء (ثابت 2) */
  isActive(facilityId: string, now = Date.now()): boolean {
    const facility = this.facilities.get(facilityId);
    if (!facility) return false;
    return facility.status === 'active' && facility.expiresAt > now;
  }

  get(facilityId: string): Facility | null { return this.facilities.get(facilityId) ?? null; }
  list(): readonly Facility[] { return [...this.facilities.values()]; }

  activeFacilities(now = Date.now()): readonly Facility[] {
    return [...this.facilities.values()].filter((f) => this.isActive(f.facilityId, now));
  }

  report(now = Date.now()): {
    readonly declaredKinds: number; readonly total: number; readonly active: number;
    readonly suspended: number; readonly dissolved: number; readonly expired: number;
  } {
    const all = [...this.facilities.values()];
    return {
      declaredKinds: this.kinds.size,
      total: all.length,
      active: all.filter((f) => this.isActive(f.facilityId, now)).length,
      suspended: all.filter((f) => f.status === 'suspended').length,
      dissolved: all.filter((f) => f.status === 'dissolved').length,
      expired: all.filter((f) => f.status === 'active' && f.expiresAt <= now).length,
    };
  }
}
