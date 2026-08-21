/**
 * src/models/rollback.ts — التراجع الآمن إلى إصدار سابق (المرحلة 18)
 * المالك: وزارة البحث (والتنفيذ متاح لحرس التاج فورًا)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: معرّف نموذج + سبب التراجع
 * المخرجات: إبطال الإصدار النشط وتنشيط أحدث إصدار معتمد سابق، أو إخلاء النشاط تمامًا
 * التبعيات: سجل النماذج، السجل، مفتاح الإيقاف
 * الصلاحيات: التراجع **لا يحتاج أمرًا ملكيًا** — إجراء سلامة كمفتاح الإيقاف، ويُصعَّد بعده
 * السجلات: model_rollback_started / model_rolled_back / model_rollback_no_target
 * ثوابت هذه الوحدة:
 *   1) التراجع فوري ولا ينتظر إجراءً إداريًا
 *   2) الإصدار المتراجَع عنه يُبطَل نهائيًا فلا يُعاد تنشيطه بالخطأ
 *   3) الهدف هو أحدث إصدار معتمد غير مُبطَل — لا يُنشَّط محجور بحال
 *   4) عدم وجود هدف صالح ⇒ لا نموذج نشط (فشل مغلق) لا استمرار على المعطوب
 *   5) كل تراجع يُصعَّد إلى الملك بعد تنفيذه لا قبله
 * حالات الفشل: لا نموذج نشط أفضل من نموذج غير موثوق
 * اختبار القبول: tests/models/training.test.ts §التراجع
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { ModelRegistry } from './model_registry';

export interface RollbackOutcome {
  readonly ok: boolean;
  readonly from: string | null;
  readonly to: string | null;
  readonly reason: string;
  readonly auditId: string;
}

export class ModelRollback {
  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly models: ModelRegistry,
    private readonly ministryId: EntityId = 'ministry:research',
  ) {}

  /** تراجع فوري: يُبطل النشط ويُنشّط أحدث معتمد سابق، أو يُخلي النشاط */
  rollback(modelId: string, by: EntityId, reason: string, now = Date.now()): RollbackOutcome {
    const from = this.models.activeVersion(modelId);
    this.audit.append(by, 'model_rollback_started', { modelId, from, reason });

    if (!from) {
      const entry = this.audit.append(by, 'model_rollback_refused', {
        modelId, reason: 'لا إصدار نشط للتراجع عنه',
      });
      return { ok: false, from: null, to: null, reason: 'لا إصدار نشط للتراجع عنه', auditId: entry.hash };
    }

    // إبطال النشط أولًا: الاحتواء قبل البديل
    this.models.revoke(modelId, from, by, `تراجع: ${reason}`);

    const candidates = this.models
      .list(modelId)
      .filter((m) => m.status === 'approved' && m.version !== from)
      .sort((a, b) => b.registeredAt - a.registeredAt || (a.version < b.version ? 1 : -1));

    const target = candidates[0];
    if (!target) {
      const entry = this.audit.append(by, 'model_rollback_no_target', {
        modelId, from, reason: 'لا إصدار معتمد سابق — لا نموذج نشط',
      });
      this.audit.append(by, 'escalated_to_king', {
        incident: 'model_rollback_without_target', modelId, from, reason,
      });
      return {
        ok: false, from, to: null,
        reason: 'أُبطل النشط ولا يوجد إصدار معتمد سابق — الدولة بلا نموذج نشط (فشل مغلق)',
        auditId: entry.hash,
      };
    }

    const activated = this.models.activate(modelId, target.version, this.ministryId);
    if (!activated.allowed) {
      const entry = this.audit.append(by, 'model_rollback_failed', {
        modelId, from, to: target.version, reason: activated.reason,
      });
      this.audit.append(by, 'escalated_to_king', {
        incident: 'model_rollback_failed', modelId, from, to: target.version,
      });
      return { ok: false, from, to: null, reason: `تعذّر التنشيط: ${activated.reason}`, auditId: entry.hash };
    }

    const entry = this.audit.append(by, 'model_rolled_back', {
      modelId, from, to: target.version, reason, at: now,
    });
    this.audit.append(by, 'escalated_to_king', {
      incident: 'model_rolled_back', modelId, from, to: target.version, reason,
    });
    return { ok: true, from, to: target.version, reason: 'تراجع ناجح إلى إصدار معتمد سابق', auditId: entry.hash };
  }
}
