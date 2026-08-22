/**
 * src/services/hospital_runtime.ts — تشغيل المستشفيات البرمجية الحرجة (المرحلة 29)
 * المالك: وزارة الخدمات؛ المستشفى وحدة برمجية لوكلاء `agent:*` فقط، لا بشر ولا بيانات شخصية
 * المدخلات: إعلان `config/services.yaml` + مصادر بيانات مُتحقَّق منها + أمر ملكي establish_service
 * المخرجات: خدمة مؤقّتة في full أو limited أو halted، أو رفض مسجّل مغلق
 * التبعيات: بوابة التاج، سجل التدقيق، مصدر قيام الوزارة، ومِجسّ مصادر الخدمة
 * الصلاحيات: الإقامة والحلّ والتحقق من التعافي بأمر ملكي؛ هبوط البيانات فوري ومُسجَّل
 * السجلات: service_established / service_refused / service_degraded / service_recovery_pending /
 *          service_recovered / service_dissolved / service_operation_accepted
 * ثوابت هذه الوحدة:
 *   1) **لا مستشفى بشري**: المستفيد يبدأ `agent:`؛ لا حقل لشخص أو بيانات شخصية (DIRECTIVES §6)
 *   2) **ثلاثة أوضاع معلنة فقط**: full ثم limited ثم halted، ولا وضع رابع مخفي
 *   3) **الفقد يهبط ولا يخمّن**: أدنى وضع تسمح به المصادر الباقية يُحسب ويُسجّل بسببها
 *   4) **المحدود لا يُكمل الناقص**: كل عملية تحتاج مصدرًا مفقودًا تُرفض باسمه
 *   5) **الصعود ليس تلقائيًا**: عودة المصدر تفتح انتظار تحقق؛ الكامل لا يعود إلا بتحقق مستقل وأمر
 *   6) **لا خدمة دائمة**: انتهاء المدة يجعلها غير قائمة بلا استدعاء ولا تجديد ضمني
 *   7) **الإقامة والحلّ والرفع عبر التاج**: فعل establish_service وهدف مطابق، لا مسار جانبي
 * حالات الفشل: إعلان أو عملية أو مستفيد أو مصدر أو مدة أو وزارة أو أمر غير صالح ⇒ رفض مغلق ومسجّل
 * اختبار القبول: tests/services/critical_service_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0013-critical-services.md
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { EntityId, SignedRoyalCommand } from '../kernel/types';

export type CriticalServiceMode = 'full' | 'limited' | 'halted';
export const SERVICE_MODE_ORDER: readonly CriticalServiceMode[] = ['full', 'limited', 'halted'];
export const SERVICES_MINISTRY: EntityId = 'ministry:services';
export const SERVICE_MONITOR: EntityId = 'authority:service_monitor';

export interface DeclaredServiceOperation {
  readonly id: string;
  readonly minimumMode: Exclude<CriticalServiceMode, 'halted'>;
  readonly requiredSources: readonly string[];
}

export interface DeclaredCriticalService {
  readonly id: string;
  readonly name: string;
  readonly kind: 'hospital' | 'lab';
  readonly ministry: EntityId;
  readonly modes: Readonly<Record<CriticalServiceMode, readonly string[]>>;
  readonly operations: readonly DeclaredServiceOperation[];
}

export type CriticalServiceStatus = 'active' | 'dissolved';
export interface CriticalService {
  readonly serviceId: string;
  readonly declarationId: string;
  readonly kind: 'hospital' | 'lab';
  readonly name: string;
  readonly operator: EntityId;
  readonly establishedAt: number;
  readonly expiresAt: number;
  readonly commandId: string;
  status: CriticalServiceStatus;
  mode: CriticalServiceMode;
  missingSources: readonly string[];
  lossDeclaredBy: EntityId | null;
  recoveryPending: boolean;
  dissolvedAt: number | null;
  dissolvedBy: EntityId | null;
  dissolutionReason: string | null;
}

export interface EstablishServiceInput {
  readonly serviceId: string;
  readonly declarationId: string;
  readonly expiresAt: number;
  readonly proposedBy: EntityId;
  readonly purpose: string;
}

export interface ServiceOperationInput {
  readonly operationId: string;
  readonly beneficiary: EntityId;
  readonly requestedBy?: EntityId;
  readonly purpose: string;
}

export interface RecoveryVerificationInput {
  /** المصادر التي فُحصت عند العودة؛ لا يقبل التحقق قائمة ناقصة أو مصدرًا لم يعد بعد */
  readonly verifiedSources: readonly string[];
  readonly verifiedBy: EntityId;
  readonly note: string;
}

export type CriticalServiceResult =
  | { readonly ok: true; readonly service: CriticalService; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface ServiceOperationReceipt {
  readonly ok: boolean;
  readonly reason?: string;
  readonly serviceId: string;
  readonly operationId: string;
  readonly beneficiary: EntityId;
  readonly mode: CriticalServiceMode;
  readonly auditId: string;
}

export type MinistryProbe = (ministryId: EntityId) => boolean;
export type ServiceSourceProbe = (sourceId: string, at: number) => boolean;
/** عدّاد مشترك بين أنواع الخدمات، حتى لا يفتح فصل السجلّين حدًّا مضاعفًا للوزارة. */
export type ServiceCountProbe = (ministryId: EntityId, at: number) => number;

export interface CriticalServiceRuntimeDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly declarations: readonly DeclaredCriticalService[];
  readonly kind: 'hospital' | 'lab';
  readonly maxTermMs: number;
  readonly maxActivePerMinistry: number;
  readonly operatorId?: EntityId;
  readonly beneficiaryPrefix: string;
  readonly recoveryVerifier: EntityId;
}

/**
 * نواة مشتركة للمستشفى والمختبر. لا تُصدّر منشئًا عامًا خارج المرحلتين: كل مثيل يثبت نوعه
 * في التبعيات، فلا يتحوّل مستشفى إلى مختبر بطلب أو يستحدث نوعًا من داخله (RULE-005).
 */
export class CriticalServiceRuntime {
  private readonly services = new Map<string, CriticalService>();
  private readonly declarations = new Map<string, DeclaredCriticalService>();
  private ministryProbe: MinistryProbe | null = null;
  private sourceProbe: ServiceSourceProbe | null = null;
  private serviceCountProbe: ServiceCountProbe | null = null;
  protected readonly operatorId: EntityId;

  constructor(protected readonly deps: CriticalServiceRuntimeDeps) {
    this.operatorId = deps.operatorId ?? SERVICES_MINISTRY;
    for (const declaration of deps.declarations) {
      if (declaration.kind === deps.kind) this.declarations.set(declaration.id, declaration);
    }
  }

  bindMinistryProbe(probe: MinistryProbe): void { this.ministryProbe = probe; }
  bindSourceProbe(probe: ServiceSourceProbe): void { this.sourceProbe = probe; }
  bindServiceCountProbe(probe: ServiceCountProbe): void { this.serviceCountProbe = probe; }
  declaration(id: string): DeclaredCriticalService | null { return this.declarations.get(id) ?? null; }
  declarationsList(): readonly DeclaredCriticalService[] { return [...this.declarations.values()]; }

  private refusal(serviceId: string, mode: string, reason: string, by: EntityId = this.operatorId,
    extra: Record<string, unknown> = {}): CriticalServiceResult {
    const entry = this.deps.audit.append(by, 'service_refused', { serviceId, mode, reason, ...extra });
    return { ok: false, reason, auditId: entry.hash };
  }

  private operationRefusal(
    serviceId: string, operationId: string, beneficiary: EntityId, mode: CriticalServiceMode,
    reason: string, extra: Record<string, unknown> = {},
  ): ServiceOperationReceipt {
    const entry = this.deps.audit.append(this.operatorId, 'service_operation_refused', {
      serviceId, operationId, beneficiary, mode, reason, ...extra,
    });
    return { ok: false, reason, serviceId, operationId, beneficiary, mode, auditId: entry.hash };
  }

  private sourceState(declaration: DeclaredCriticalService, mode: CriticalServiceMode, now: number): {
    available: boolean; missing: string[];
  } {
    if (mode === 'halted') return { available: true, missing: [] };
    if (this.sourceProbe === null) return { available: false, missing: [...declaration.modes[mode]] };
    const missing = declaration.modes[mode].filter((source) => !this.sourceProbe!(source, now));
    return { available: missing.length === 0, missing };
  }

  private effectiveMode(declaration: DeclaredCriticalService, now: number): {
    mode: CriticalServiceMode; missing: string[];
  } {
    const full = this.sourceState(declaration, 'full', now);
    if (full.available) return { mode: 'full', missing: [] };
    const limited = this.sourceState(declaration, 'limited', now);
    if (limited.available) return { mode: 'limited', missing: full.missing };
    return { mode: 'halted', missing: [...new Set([...full.missing, ...limited.missing])] };
  }

  /** يُنفّذ الهبوط فقط؛ الصعود محجوب عمدًا حتى verifyRecovery (ثابت 5). */
  reconcile(serviceId: string, observedBy: EntityId = SERVICE_MONITOR, now = Date.now()): CriticalServiceResult {
    const service = this.services.get(serviceId);
    if (!service) return this.refusal(serviceId, 'reconcile', 'خدمة غير قائمة', observedBy);
    if (!this.isActive(serviceId, now)) return this.refusal(serviceId, 'reconcile', 'خدمة غير قائمة أو منتهية', observedBy);
    const declaration = this.declarations.get(service.declarationId);
    if (!declaration) return this.refusal(serviceId, 'reconcile', 'إعلان الخدمة سقط — فشل مغلق', observedBy);
    const effective = this.effectiveMode(declaration, now);
    const before = SERVICE_MODE_ORDER.indexOf(service.mode);
    const after = SERVICE_MODE_ORDER.indexOf(effective.mode);
    if (after > before) {
      service.mode = effective.mode;
      service.missingSources = effective.missing;
      service.lossDeclaredBy = observedBy;
      service.recoveryPending = false;
      const entry = this.deps.audit.append(observedBy, 'service_degraded', {
        serviceId, from: SERVICE_MODE_ORDER[before], to: effective.mode,
        missingSources: effective.missing, reason: 'فقد مصدر معلن — هبوط بلا تخمين', at: now,
      });
      return { ok: true, service, auditId: entry.hash };
    }
    if (after < before && !service.recoveryPending) {
      service.recoveryPending = true;
      const entry = this.deps.audit.append(observedBy, 'service_recovery_pending', {
        serviceId, current: service.mode, availableMode: effective.mode,
        reason: 'عودة المصدر لا ترفع الخدمة بلا تحقق مستقل معلن', at: now,
      });
      return { ok: true, service, auditId: entry.hash };
    }
    const entry = this.deps.audit.append(observedBy, 'service_availability_checked', {
      serviceId, mode: service.mode, missingSources: service.missingSources, at: now,
    });
    return { ok: true, service, auditId: entry.hash };
  }

  establish(command: SignedRoyalCommand, input: EstablishServiceInput, now = Date.now()): CriticalServiceResult {
    const refuse = (reason: string, extra: Record<string, unknown> = {}) =>
      this.refusal(input.serviceId, 'establish', reason, input.proposedBy, extra);
    const declaration = this.declarations.get(input.declarationId);
    if (!declaration) return refuse('إعلان خدمة غير معلن أو من نوع آخر — الإقامة لا تنشئ نوعًا');
    if (input.proposedBy !== this.operatorId || declaration.ministry !== this.operatorId) {
      return refuse('إقامة الخدمة لوزارة الخدمات المعلنة وحدها (RULE-004)');
    }
    if (typeof input.serviceId !== 'string' || !input.serviceId.startsWith('service:')) {
      return refuse('معرّف خدمة غير صالح');
    }
    if (this.services.has(input.serviceId)) return refuse('خدمة قائمة بهذا المعرّف — لا تكرار هوية');
    if (typeof input.purpose !== 'string' || input.purpose.trim().length < 3) return refuse('لا خدمة بلا غرض معلن');
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) {
      return refuse('لا خدمة بلا لحظة انتهاء صحيحة مستقبلية — لا مدة افتراضية');
    }
    if (input.expiresAt - now > this.deps.maxTermMs) {
      return refuse('مدة الخدمة تتجاوز الحدّ المعلن — تُرفض ولا تُقرَّب', { maxTermMs: this.deps.maxTermMs });
    }
    if (this.ministryProbe === null) return refuse('مصدر تحقق الوزارة غير مربوط — رفض مغلق');
    if (!this.ministryProbe(this.operatorId)) return refuse('وزارة الخدمات غير قائمة');
    const active = this.serviceCountProbe?.(this.operatorId, now)
      ?? this.activeServices(now).filter((service) => service.operator === this.operatorId).length;
    if (active >= this.deps.maxActivePerMinistry) {
      return refuse('عدد الخدمات القائمة بلغ الحدّ المعلن', { active, max: this.deps.maxActivePerMinistry });
    }
    if (command.payload.action !== 'establish_service' || command.payload.target !== input.serviceId) {
      return refuse('إقامة الخدمة بفعل establish_service وهدف مطابق وحدهما (RULE-003)');
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر غير معتمد: ${decision.reason}`);
    if (this.sourceProbe === null) return refuse('مِجسّ مصادر الخدمة غير مربوط — رفض مغلق');
    const effective = this.effectiveMode(declaration, now);
    if (effective.mode !== 'full') {
      return refuse('لا إقامة لخدمة لا تملك مصادر وضع full — تُصلح المصادر قبل الإقامة', { missingSources: effective.missing });
    }
    const service: CriticalService = {
      serviceId: input.serviceId, declarationId: declaration.id, kind: declaration.kind, name: declaration.name,
      operator: this.operatorId, establishedAt: now, expiresAt: input.expiresAt,
      commandId: command.payload.commandId, status: 'active', mode: 'full', missingSources: [],
      lossDeclaredBy: null, recoveryPending: false, dissolvedAt: null, dissolvedBy: null, dissolutionReason: null,
    };
    this.services.set(service.serviceId, service);
    const entry = this.deps.audit.append(this.operatorId, 'service_established', {
      serviceId: service.serviceId, declarationId: declaration.id, kind: declaration.kind,
      expiresAt: service.expiresAt, commandId: service.commandId, mode: service.mode,
    });
    return { ok: true, service, auditId: entry.hash };
  }

  execute(serviceId: string, input: ServiceOperationInput, now = Date.now()): ServiceOperationReceipt {
    const beneficiary = input.beneficiary;
    const service = this.services.get(serviceId);
    const baseMode = service?.mode ?? 'halted';
    if (!service) return this.operationRefusal(serviceId, input.operationId, beneficiary, baseMode, 'خدمة غير قائمة');
    if (!this.isActive(serviceId, now)) return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode, 'خدمة غير قائمة أو منتهية');
    // لا تتحول الخدمة إلى ثغرة أثناء الإيقاف العام: التشغيل اليومي ليس أمرًا جديدًا، لكنه
    // يقرأ حكم بوابة التاج قبل لمس أي مصدر أو قبول أي عملية (RULE-003 وRULE-007).
    if (this.deps.gateway.mode !== 'normal') {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode,
        'بوابة التاج ليست في وضع normal — تشغيل الخدمة متوقف آمنًا');
    }
    // تُراجع المصادر عند كل عملية؛ فقدها لا ينتظر مؤقّتًا ولا عميلًا آخر (RULE-007).
    this.reconcile(serviceId, SERVICE_MONITOR, now);
    if (!beneficiary.startsWith(this.deps.beneficiaryPrefix)) {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode,
        'المستفيد خارج النطاق الأخلاقي — الخدمة لوكيل agent:* فقط', { beneficiaryPrefix: this.deps.beneficiaryPrefix });
    }
    if (typeof input.purpose !== 'string' || input.purpose.trim().length < 3) {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode, 'لا عملية بلا غرض معلن');
    }
    if ((input.requestedBy ?? this.operatorId) !== this.operatorId) {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode, 'طلب العملية للمشغّل المعلن وحده (RULE-004)');
    }
    const declaration = this.declarations.get(service.declarationId);
    if (!declaration) return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode, 'إعلان الخدمة غير قائم — فشل مغلق');
    const operation = declaration.operations.find((candidate) => candidate.id === input.operationId);
    if (!operation) return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode, 'عملية غير معلنة في التهيئة');
    if (service.mode === 'halted') {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode,
        'الخدمة في توقف آمن — لا عملية بلا مصادرها الأساسية', { missingSources: service.missingSources });
    }
    if (service.mode === 'limited' && operation.minimumMode === 'full') {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode,
        'العملية تحتاج وضع full ومصادر فُقدت — تُرفض بنصّها لا بصمت', { missingSources: service.missingSources });
    }
    const missing = this.sourceProbe === null ? [...operation.requiredSources]
      : operation.requiredSources.filter((source) => !this.sourceProbe!(source, now));
    if (missing.length > 0) {
      return this.operationRefusal(serviceId, input.operationId, beneficiary, service.mode,
        'العملية تحتاج مصدرًا مفقودًا معلنًا — لا إكمال للناقص', { missingSources: missing });
    }
    const entry = this.deps.audit.append(this.operatorId, 'service_operation_accepted', {
      serviceId, operationId: operation.id, beneficiary, mode: service.mode, at: now,
    });
    return { ok: true, serviceId, operationId: operation.id, beneficiary, mode: service.mode, auditId: entry.hash };
  }

  verifyRecovery(
    command: SignedRoyalCommand, serviceId: string, input: RecoveryVerificationInput, now = Date.now(),
  ): CriticalServiceResult {
    const service = this.services.get(serviceId);
    if (!service) return this.refusal(serviceId, 'recover', 'خدمة غير قائمة', input.verifiedBy);
    if (!this.isActive(serviceId, now)) return this.refusal(serviceId, 'recover', 'خدمة غير قائمة أو منتهية', input.verifiedBy);
    if (input.verifiedBy !== this.deps.recoveryVerifier) {
      return this.refusal(serviceId, 'recover', 'التحقق من التعافي لجهة مستقلة معلنة وحدها (RULE-004)', input.verifiedBy);
    }
    if (input.verifiedBy === service.lossDeclaredBy) {
      return this.refusal(serviceId, 'recover', 'من أعلن الفقد لا يرفع الخدمة بيده (RULE-004)', input.verifiedBy);
    }
    if (typeof input.note !== 'string' || input.note.trim().length < 3 || !Array.isArray(input.verifiedSources)) {
      return this.refusal(serviceId, 'recover', 'لا رفع بلا تحقق معلن وقائمة مصادر', input.verifiedBy);
    }
    if (command.payload.action !== 'establish_service' || command.payload.target !== serviceId) {
      return this.refusal(serviceId, 'recover', 'رفع الخدمة بفعل establish_service وهدف مطابق وحدهما (RULE-003)', input.verifiedBy);
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return this.refusal(serviceId, 'recover', `أمر غير معتمد: ${decision.reason}`, input.verifiedBy);
    const declaration = this.declarations.get(service.declarationId);
    if (!declaration || this.sourceProbe === null) return this.refusal(serviceId, 'recover', 'إعلان أو مِجسّ مصدر غير متاح — رفض مغلق', input.verifiedBy);
    const expected = declaration.modes.full;
    const verified = new Set(input.verifiedSources);
    if (verified.size !== expected.length || expected.some((source) => !verified.has(source))) {
      return this.refusal(serviceId, 'recover', 'التحقق لا يغطي كل مصادر full المعلنة', input.verifiedBy);
    }
    const unavailable = expected.filter((source) => !this.sourceProbe!(source, now));
    if (unavailable.length > 0) {
      return this.refusal(serviceId, 'recover', 'مصدر عاد بالقول لا بالواقع — لا رفع', input.verifiedBy, { unavailable });
    }
    service.mode = 'full';
    service.missingSources = [];
    service.recoveryPending = false;
    const entry = this.deps.audit.append(input.verifiedBy, 'service_recovered', {
      serviceId, to: 'full', verifiedSources: [...verified], note: input.note.trim(),
      commandId: command.payload.commandId, at: now,
    });
    return { ok: true, service, auditId: entry.hash };
  }

  dissolve(command: SignedRoyalCommand, serviceId: string, by: EntityId, reason: string, now = Date.now()): CriticalServiceResult {
    const service = this.services.get(serviceId);
    if (!service) return this.refusal(serviceId, 'dissolve', 'خدمة غير قائمة', by);
    if (service.status === 'dissolved') return this.refusal(serviceId, 'dissolve', 'لا حلّ مرتين — الحل نهائي', by);
    if (typeof reason !== 'string' || reason.trim().length < 3) return this.refusal(serviceId, 'dissolve', 'لا حلّ بلا سبب معلن', by);
    if (command.payload.action !== 'establish_service' || command.payload.target !== serviceId) {
      return this.refusal(serviceId, 'dissolve', 'حل الخدمة بفعل establish_service وهدف مطابق وحدهما (RULE-003)', by);
    }
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return this.refusal(serviceId, 'dissolve', `أمر غير معتمد: ${decision.reason}`, by);
    service.status = 'dissolved';
    service.dissolvedAt = now;
    service.dissolvedBy = by;
    service.dissolutionReason = reason.trim();
    const entry = this.deps.audit.append(by, 'service_dissolved', { serviceId, reason: service.dissolutionReason, final: true, at: now });
    return { ok: true, service, auditId: entry.hash };
  }

  isActive(serviceId: string, now = Date.now()): boolean {
    const service = this.services.get(serviceId);
    return service !== undefined && service.status === 'active' && service.expiresAt > now;
  }
  get(serviceId: string): CriticalService | null { return this.services.get(serviceId) ?? null; }
  list(): readonly CriticalService[] { return [...this.services.values()]; }
  activeServices(now = Date.now()): readonly CriticalService[] { return this.list().filter((service) => this.isActive(service.serviceId, now)); }
  report(now = Date.now()): { readonly declared: number; readonly total: number; readonly full: number; readonly limited: number; readonly halted: number; readonly expired: number; readonly dissolved: number } {
    const all = this.list();
    return {
      declared: this.declarations.size, total: all.length,
      full: all.filter((service) => this.isActive(service.serviceId, now) && service.mode === 'full').length,
      limited: all.filter((service) => this.isActive(service.serviceId, now) && service.mode === 'limited').length,
      halted: all.filter((service) => this.isActive(service.serviceId, now) && service.mode === 'halted').length,
      expired: all.filter((service) => service.status === 'active' && service.expiresAt <= now).length,
      dissolved: all.filter((service) => service.status === 'dissolved').length,
    };
  }
}

/** مستشفى برمجي لوكلاء مسجّلين؛ النوع مُقفل في البناء ولا يتبدّل بالطلب. */
export class HospitalRuntime extends CriticalServiceRuntime {
  constructor(deps: Omit<CriticalServiceRuntimeDeps, 'kind'>) { super({ ...deps, kind: 'hospital' }); }
}
