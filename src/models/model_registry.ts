/**
 * src/models/model_registry.ts — سجل النماذج ودورة اعتمادها (المرحلة 17)
 * المالك: وزارة البحث (والاعتماد بيد الملك)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: بيان نموذج متحقَّق منه + أوامر ملكية للاعتماد
 * المخرجات: نموذج بحالة معلنة: محجور ← معتمد ← نشط، أو مُبطَل — ولا نموذج نشط بلا اعتماد
 * التبعيات: بوابة التاج، السجل، مفتاح الإيقاف
 * الصلاحيات: الاعتماد أمر ملكي؛ والتنشيط لوزارة البحث؛ والإبطال فوري لأي سلطة أمن
 * السجلات: model_registered / model_approved / model_activated / model_revoked
 * ثوابت هذه الوحدة:
 *   1) التسجيل يبدأ دائمًا بحالة محجور — لا نموذج يدخل نشطًا
 *   2) لا تنشيط إلا لنموذج معتمد بأمر ملكي
 *   3) نموذج نشط واحد لكل معرّف — لا نموذجان يعملان معًا
 *   4) الإبطال فوري ولا يحتاج أمرًا (إجراء سلامة)، ويُخلي النشاط فورًا
 *   5) النموذج المُبطَل لا يُعاد تنشيطه — الإبطال نهائي لذلك الإصدار
 *   6) الإيقاف يمنع التنشيط ولا يمنع الإبطال
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/models/model_registry.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { ModelManifest } from './model_manifest';

export type ModelStatus = 'quarantined' | 'approved' | 'active' | 'revoked';

export interface ModelRecord {
  readonly modelId: string;
  readonly version: string;
  readonly source: string;
  readonly license: string;
  readonly status: ModelStatus;
  readonly registeredAt: number;
  readonly capabilities: readonly string[];
  readonly digests: readonly string[];
  readonly origin: 'imported' | 'fine_tuned';
  readonly baseVersion: string | null;
}

export interface ModelRegistryDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly ministryId?: EntityId;
}

function key(modelId: string, version: string): string {
  return `${modelId}@${version}`;
}

export class ModelRegistry {
  private readonly models = new Map<string, ModelRecord>();
  private readonly active = new Map<string, string>(); // modelId → version
  private readonly ministryId: EntityId;

  constructor(private readonly deps: ModelRegistryDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
    deps.audit.append(this.ministryId, 'model_registry_online', {});
  }

  get(modelId: string, version: string): ModelRecord | undefined {
    return this.models.get(key(modelId, version));
  }

  list(modelId?: string): readonly ModelRecord[] {
    const all = [...this.models.values()];
    return modelId ? all.filter((m) => m.modelId === modelId) : all;
  }

  /** الإصدار النشط لهذا النموذج — قد لا يوجد، وذلك وضع مقبول وآمن */
  activeVersion(modelId: string): string | null {
    return this.active.get(modelId) ?? null;
  }

  /** التسجيل: الحالة الابتدائية محجور دائمًا */
  register(
    manifest: ModelManifest,
    opts: { readonly origin?: 'imported' | 'fine_tuned'; readonly baseVersion?: string | null } = {},
    now = Date.now(),
  ): Decision {
    if (this.models.has(key(manifest.modelId, manifest.version))) {
      const entry = this.deps.audit.append(this.ministryId, 'model_register_refused', {
        modelId: manifest.modelId, version: manifest.version, reason: 'إصدار مسجَّل مسبقًا',
      });
      return { allowed: false, reason: 'إصدار مسجَّل مسبقًا — لا تكرار', auditId: entry.hash };
    }
    const record: ModelRecord = {
      modelId: manifest.modelId, version: manifest.version, source: manifest.source,
      license: manifest.license, status: 'quarantined', registeredAt: now,
      capabilities: [...manifest.declaredCapabilities],
      digests: manifest.shards.map((s) => s.digest),
      origin: opts.origin ?? 'imported', baseVersion: opts.baseVersion ?? null,
    };
    this.models.set(key(record.modelId, record.version), record);
    const entry = this.deps.audit.append(this.ministryId, 'model_registered', {
      modelId: record.modelId, version: record.version, source: record.source,
      status: record.status, shards: record.digests.length, origin: record.origin,
    });
    return { allowed: true, reason: 'سُجّل النموذج محجورًا — لا يعمل قبل الاعتماد', auditId: entry.hash };
  }

  /** الاعتماد: أمر ملكي بفعل approve_phase على هدف النموذج */
  approve(command: SignedRoyalCommand, modelId: string, version: string, now = Date.now()): Decision {
    const refuse = (reason: string): Decision => {
      const entry = this.deps.audit.append(this.ministryId, 'model_approval_refused', {
        modelId, version, reason, commandId: command.payload.commandId,
      });
      return { allowed: false, reason, auditId: entry.hash };
    };
    const record = this.models.get(key(modelId, version));
    if (!record) return refuse('نموذج غير مسجَّل');
    if (record.status === 'revoked') return refuse('نموذج مُبطَل — لا اعتماد بعد الإبطال');
    if (record.status !== 'quarantined') return refuse(`حالة النموذج ${record.status} — لا اعتماد`);
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر الاعتماد مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'approve_phase') return refuse('الفعل لا يخصّ اعتماد نموذج');

    this.models.set(key(modelId, version), { ...record, status: 'approved' });
    const entry = this.deps.audit.append(this.ministryId, 'model_approved', {
      modelId, version, commandId: command.payload.commandId,
    });
    return { allowed: true, reason: 'اعتُمد النموذج ولم يُنشّط بعد', auditId: entry.hash };
  }

  /** التنشيط: لنموذج معتمد فقط، وواحد لكل معرّف */
  activate(modelId: string, version: string, by: EntityId = 'ministry:research'): Decision {
    const refuse = (reason: string): Decision => {
      const entry = this.deps.audit.append(by, 'model_activation_refused', { modelId, version, reason });
      return { allowed: false, reason, auditId: entry.hash };
    };
    const halt = this.deps.killSwitch.status;
    if (halt.engaged) return refuse('الإيقاف مُشتغل — لا تنشيط');
    const record = this.models.get(key(modelId, version));
    if (!record) return refuse('نموذج غير مسجَّل');
    if (record.status === 'revoked') return refuse('نموذج مُبطَل — لا تنشيط');
    if (record.status === 'quarantined') return refuse('نموذج محجور غير معتمد — لا تنشيط');
    if (record.status === 'active') return refuse('النموذج نشط بالفعل');

    const current = this.active.get(modelId);
    if (current && current !== version) {
      const old = this.models.get(key(modelId, current));
      if (old) this.models.set(key(modelId, current), { ...old, status: 'approved' });
      this.deps.audit.append(by, 'model_deactivated', { modelId, version: current, reason: 'تنشيط إصدار آخر' });
    }
    this.models.set(key(modelId, version), { ...record, status: 'active' });
    this.active.set(modelId, version);
    const entry = this.deps.audit.append(by, 'model_activated', { modelId, version, previous: current ?? null });
    return { allowed: true, reason: 'نُشّط النموذج', auditId: entry.hash };
  }

  /** الإبطال: فوري بلا أمر — والإجراء الأمني لا ينتظر إجراءً إداريًا */
  revoke(modelId: string, version: string, by: EntityId, reason: string): Decision {
    const record = this.models.get(key(modelId, version));
    if (!record) {
      const entry = this.deps.audit.append(by, 'model_revoke_refused', { modelId, version, reason: 'غير مسجَّل' });
      return { allowed: false, reason: 'نموذج غير مسجَّل', auditId: entry.hash };
    }
    this.models.set(key(modelId, version), { ...record, status: 'revoked' });
    if (this.active.get(modelId) === version) this.active.delete(modelId);
    const entry = this.deps.audit.append(by, 'model_revoked', { modelId, version, reason });
    return { allowed: true, reason: 'أُبطل النموذج فورًا', auditId: entry.hash };
  }

  report(): {
    readonly total: number;
    readonly byStatus: Readonly<Record<ModelStatus, number>>;
    readonly active: readonly string[];
  } {
    const byStatus: Record<ModelStatus, number> = { quarantined: 0, approved: 0, active: 0, revoked: 0 };
    for (const m of this.models.values()) byStatus[m.status] += 1;
    return {
      total: this.models.size,
      byStatus,
      active: [...this.active.entries()].map(([id, v]) => key(id, v)),
    };
  }
}
