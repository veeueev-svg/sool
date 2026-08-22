/**
 * src/services/mirror_department.ts — قسم المرآة للوظائف المعلنة (المرحلة 30)
 * المالك: وزارة البحث
 * المدخلات: وزارة قائمة من سجل الوزارات، سياسة research.yaml، وأمر ملكي establish_research
 * المخرجات: قسم مرآة مؤقت لكل وظيفة أو رفض مسجّل وفجوات وظائف ظاهرة
 * التبعيات: بوابة التاج، سجل التدقيق، ومِجس سجل الوزارات القائم
 * الصلاحيات: إقامة القسم وحلّه بأمر ملكي فقط؛ لا يغيّر القسم سياسة أو وظيفة أو وزارة
 * السجلات: mirror_department_established / mirror_department_dissolved / mirror_department_refused /
 *          mirror_gap_checked / mirror_gap / mirror_policy_application_refused
 * حالات الفشل: وزارة أو مِجس مفقود أو مدة أو أمر أو سقف أو طلب تطبيق سياسة غير صالح => رفض مغلق
 * اختبارات الوحدة: tests/services/mirror_department.test.ts
 * اختبار القبول: tests/services/research_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0014-human-research.md
 * البحث نظري في النظير البشري عبر مصادر معلنة، ولا يمس إنسانًا ولا بياناته.
 * ثوابت هذه الوحدة:
 *   1) **الوظيفة من الواقع لا قائمة يدوية**: لا قسم بلا وزارة قائمة يثبتها مِجس سجل الوزارات.
 *   2) **لا قسم دائم**: مدة القسم إلزامية، والمنتهي لا يعد قسمًا قائمًا ولا يُمحى.
 *   3) **كل وظيفة لها مرآة**: الفجوة تقاس من الوزارات القائمة وتظهر باسم mirror_gap.
 *   4) **الإقامة والحل عبر التاج**: establish_research وهدف مطابق، فلا مسار جانبي (RULE-003).
 *   5) **لا سياسة من المرآة**: القسم يوصي فقط؛ التطبيق المباشر مرفوض ومسجّل (RULE-005).
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { EntityId, SignedRoyalCommand } from '../kernel/types';

export type MirrorDepartmentStatus = 'active' | 'dissolved';

export interface MirrorDepartment {
  readonly departmentId: string;
  readonly functionMinistry: EntityId;
  readonly establishedAt: number;
  readonly expiresAt: number;
  readonly establishedBy: EntityId;
  readonly commandId: string;
  status: MirrorDepartmentStatus;
  dissolvedAt: number | null;
  dissolutionReason: string | null;
}

export interface EstablishMirrorDepartmentInput {
  readonly departmentId: string;
  readonly functionMinistry: EntityId;
  readonly proposedBy: EntityId;
  readonly expiresAt: number;
  readonly purpose: string;
}

export type MirrorDepartmentResult =
  | { readonly ok: true; readonly department: MirrorDepartment; readonly auditId: string }
  | { readonly ok: false; readonly code: string; readonly reason: string; readonly auditId: string };

export type MirrorGapReport = {
  readonly ok: true;
  readonly activeFunctions: readonly EntityId[];
  readonly coveredFunctions: readonly EntityId[];
  readonly gaps: readonly EntityId[];
  readonly auditId: string;
};

export type MinistryActiveProbe = (ministryId: EntityId) => boolean;
export type ActiveMinistriesProbe = () => readonly EntityId[];

export interface MirrorDepartmentDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly maxDepartments: number;
  readonly maxTermMs: number;
  readonly operatorId: EntityId;
}

/**
 * يسجل أقسام المرآة فقط؛ الدرس والبحث في human_research حتى لا يجيز القسم نتيجة بحثه بنفسه.
 */
export class MirrorDepartmentRegistry {
  private readonly departments = new Map<string, MirrorDepartment>();
  private ministryActive: MinistryActiveProbe | null = null;
  private activeMinistries: ActiveMinistriesProbe | null = null;

  constructor(private readonly deps: MirrorDepartmentDeps) {}

  /** الربط البنيوي لا يكتب بعد state_online؛ غيابه يظهر عند أول استعمال برفض مغلق. */
  bindMinistryRegistry(isActive: MinistryActiveProbe, listActive: ActiveMinistriesProbe): void {
    this.ministryActive = isActive;
    this.activeMinistries = listActive;
  }

  private refuse(
    departmentId: string, mode: string, code: string, reason: string, actor: EntityId,
    extra: Record<string, unknown> = {},
  ): MirrorDepartmentResult {
    const entry = this.deps.audit.append(actor, 'mirror_department_refused', {
      departmentId, mode, code, reason, ...extra,
    });
    return { ok: false, code, reason, auditId: entry.hash };
  }

  establish(
    command: SignedRoyalCommand, input: EstablishMirrorDepartmentInput, now = Date.now(),
  ): MirrorDepartmentResult {
    const refuse = (code: string, reason: string, extra: Record<string, unknown> = {}) =>
      this.refuse(input.departmentId, 'establish', code, reason, input.proposedBy, extra);
    if (input.proposedBy !== this.deps.operatorId) {
      return refuse('MIRROR_OPERATOR_REFUSED', 'إقامة قسم المرآة لوزارة البحث المعلنة وحدها (RULE-004)');
    }
    if (typeof input.departmentId !== 'string' || !input.departmentId.startsWith('mirror:')) {
      return refuse('MIRROR_ID_REFUSED', 'معرّف قسم المرآة يجب أن يبدأ mirror:');
    }
    if (typeof input.functionMinistry !== 'string' || !input.functionMinistry.startsWith('ministry:')) {
      return refuse('MIRROR_FUNCTION_ID_REFUSED', 'وظيفة المرآة يجب أن تشير إلى وزارة ministry:* قائمة');
    }
    if (this.departments.has(input.departmentId)) {
      return refuse('MIRROR_DUPLICATE_REFUSED', 'قسم مرآة قائم بهذا المعرّف — لا تكرار هوية');
    }
    if (typeof input.purpose !== 'string' || input.purpose.trim().length < 3) {
      return refuse('MIRROR_PURPOSE_REFUSED', 'لا قسم مرآة بلا غرض معلن');
    }
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      return refuse('MIRROR_TERM_REFUSED', 'لا قسم مرآة بلا نهاية صحيحة مستقبلية');
    }
    if (input.expiresAt - now > this.deps.maxTermMs) {
      return refuse('MIRROR_TERM_LIMIT_REFUSED', 'مدة قسم المرآة تتجاوز الحد المعلن ولا تقرّب', {
        maxTermMs: this.deps.maxTermMs,
      });
    }
    if (this.ministryActive === null) {
      return refuse('MIRROR_MINISTRY_PROBE_MISSING', 'مِجس سجل الوزارات غير مربوط — رفض مغلق');
    }
    if (!this.ministryActive(input.functionMinistry)) {
      return refuse('MIRROR_FUNCTION_INACTIVE', 'وظيفة قائمة بلا وزارة قائمة لا تملك قسم مرآة');
    }
    if (this.activeForFunction(input.functionMinistry, now) !== null) {
      return refuse('MIRROR_FUNCTION_DUPLICATE', 'لكل وظيفة قائمة قسم مرآة واحد فقط');
    }
    const active = this.active(now).length;
    if (active >= this.deps.maxDepartments) {
      return refuse('MIRROR_DEPARTMENT_LIMIT', 'عدد أقسام المرآة القائمة بلغ الحد المعلن', {
        active, max: this.deps.maxDepartments,
      });
    }
    if (command.payload.action !== 'establish_research' || command.payload.target !== input.departmentId) {
      return refuse('MIRROR_CROWN_PATH_REFUSED', 'إقامة قسم المرآة بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('MIRROR_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    const department: MirrorDepartment = {
      departmentId: input.departmentId,
      functionMinistry: input.functionMinistry,
      establishedAt: now,
      expiresAt: input.expiresAt,
      establishedBy: command.payload.issuedBy,
      commandId: command.payload.commandId,
      status: 'active',
      dissolvedAt: null,
      dissolutionReason: null,
    };
    this.departments.set(department.departmentId, department);
    const entry = this.deps.audit.append(this.deps.operatorId, 'mirror_department_established', {
      departmentId: department.departmentId,
      functionMinistry: department.functionMinistry,
      expiresAt: department.expiresAt,
      commandId: department.commandId,
    });
    return { ok: true, department, auditId: entry.hash };
  }

  dissolve(
    command: SignedRoyalCommand, departmentId: string, reason: string, by: EntityId, now = Date.now(),
  ): MirrorDepartmentResult {
    const department = this.departments.get(departmentId);
    const refuse = (code: string, why: string) => this.refuse(departmentId, 'dissolve', code, why, by);
    if (!department) return refuse('MIRROR_NOT_FOUND', 'قسم المرآة غير قائم');
    if (department.status === 'dissolved') return refuse('MIRROR_DISSOLVED_TWICE', 'لا يحل قسم المرآة مرتين');
    if (by !== this.deps.operatorId) {
      return refuse('MIRROR_OPERATOR_REFUSED', 'حل قسم المرآة لوزارة البحث المعلنة وحدها (RULE-004)');
    }
    if (typeof reason !== 'string' || reason.trim().length < 3) return refuse('MIRROR_REASON_REFUSED', 'لا حل بلا سبب معلن');
    if (command.payload.action !== 'establish_research' || command.payload.target !== departmentId) {
      return refuse('MIRROR_CROWN_PATH_REFUSED', 'حل قسم المرآة بفعل establish_research وهدف مطابق فقط (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse('MIRROR_COMMAND_REFUSED', `أمر غير معتمد: ${decision.reason}`);
    department.status = 'dissolved';
    department.dissolvedAt = now;
    department.dissolutionReason = reason.trim();
    const entry = this.deps.audit.append(by, 'mirror_department_dissolved', {
      departmentId, reason: department.dissolutionReason, at: now, final: true,
    });
    return { ok: true, department, auditId: entry.hash };
  }

  /** قراءة الفجوات من سجل الوزارات الحي؛ لا قائمة وظائف مدخلة يدويًا. */
  gaps(now = Date.now(), by: EntityId = this.deps.operatorId): MirrorGapReport | MirrorDepartmentResult {
    if (this.activeMinistries === null) {
      return this.refuse('mirror:registry', 'gaps', 'MIRROR_MINISTRY_LIST_MISSING',
        'قائمة الوزارات القائمة غير مربوطة — لا نخمن الوظائف', by);
    }
    const activeFunctions = [...this.activeMinistries()];
    const coveredFunctions = this.active(now).map((department) => department.functionMinistry);
    const covered = new Set(coveredFunctions);
    const gaps = activeFunctions.filter((ministry) => !covered.has(ministry));
    const entry = this.deps.audit.append(by, 'mirror_gap_checked', {
      activeFunctions, coveredFunctions, gaps, at: now,
    });
    for (const functionMinistry of gaps) {
      this.deps.audit.append(by, 'mirror_gap', { functionMinistry, code: 'MIRROR_GAP', at: now });
    }
    return { ok: true, activeFunctions, coveredFunctions, gaps, auditId: entry.hash };
  }

  /** باب موجود عمدًا كي يثبت أن المرآة توصّي ولا تطبق سياسة (RULE-005). */
  applyPolicy(departmentId: string, policyTarget: string, by: EntityId): MirrorDepartmentResult {
    return this.refuse(departmentId, 'apply_policy', 'MIRROR_POLICY_APPLICATION_REFUSED',
      'قسم المرآة لا يغيّر سياسة؛ يصدر توصية مسجّلة فقط (RULE-005)', by, { policyTarget });
  }

  isActive(departmentId: string, now = Date.now()): boolean {
    const department = this.departments.get(departmentId);
    const active = department !== undefined
      && department.status === 'active'
      && department.expiresAt > now
      && this.ministryActive !== null
      && this.ministryActive(department.functionMinistry);
    this.deps.audit.append(this.deps.operatorId, 'mirror_department_read', { departmentId, active, at: now });
    return active;
  }

  get(departmentId: string): MirrorDepartment | null {
    const department = this.departments.get(departmentId) ?? null;
    this.deps.audit.append(this.deps.operatorId, 'mirror_department_read', { departmentId, found: department !== null });
    return department;
  }
  list(): readonly MirrorDepartment[] {
    const departments = [...this.departments.values()];
    this.deps.audit.append(this.deps.operatorId, 'mirror_department_list_read', { count: departments.length });
    return departments;
  }
  active(now = Date.now()): readonly MirrorDepartment[] {
    return this.list().filter((department) => this.isActive(department.departmentId, now));
  }
  activeForFunction(functionMinistry: EntityId, now = Date.now()): MirrorDepartment | null {
    return this.active(now).find((department) => department.functionMinistry === functionMinistry) ?? null;
  }
  functionOf(departmentId: string): EntityId | null {
    const functionMinistry = this.departments.get(departmentId)?.functionMinistry ?? null;
    this.deps.audit.append(this.deps.operatorId, 'mirror_department_function_read', { departmentId, functionMinistry });
    return functionMinistry;
  }
  report(now = Date.now()): { readonly total: number; readonly active: number; readonly expired: number; readonly dissolved: number } {
    const all = this.list();
    return {
      total: all.length,
      active: this.active(now).length,
      expired: all.filter((department) => department.status === 'active' && department.expiresAt <= now).length,
      dissolved: all.filter((department) => department.status === 'dissolved').length,
    };
  }
}
