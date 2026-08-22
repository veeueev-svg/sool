/**
 * src/services/lab_runtime.ts — تشغيل المختبرات البرمجية ونتائجها (المرحلة 29)
 * المالك: وزارة الخدمات؛ المختبر وحدة برمجية لوكلاء `agent:*` فقط، لا بشر ولا عينات بشرية
 * المدخلات: خدمة مختبر قائمة في hospital_runtime + عملية معلنة + حقائق أداة مجردة
 * المخرجات: نتيجة معلّقة لا تعتمد حتى يمرّرها quality_control بفحوص معلنة ومستقلة
 * التبعيات: CriticalServiceRuntime وسجل التدقيق
 * الصلاحيات: إجراء النتيجة للمشغّل؛ الاعتماد محظور هنا ومخصص لمراقبة الجودة المستقلة
 * السجلات: lab_result_created / lab_result_refused
 * ثوابت هذه الوحدة:
 *   1) **لا نتيجة بلا خدمة قائمة**: كل نتيجة تسبقها عملية مختبر معلنة تمر بمِجسّ المصادر
 *   2) **لا مستفيد بشري**: الفحص يرث قيد `agent:*` من تشغيل الخدمة (DIRECTIVES §6)
 *   3) **النتيجة معلّقة لا معتمدة**: الإنشاء لا يساوي الاعتماد (RULE-004)
 *   4) **الواقع يُقيَّد قبل التقرير**: حقائق الفحوص لا تتبدل بتقرير المفتّش اللاحق
 * حالات الفشل: نتيجة مكررة أو عملية مرفوضة أو حقائق ناقصة ⇒ رفض مغلق ومسجّل
 * اختبار القبول: tests/services/critical_service_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0013-critical-services.md
 */
import { EntityId } from '../kernel/types';
import {
  CriticalServiceRuntime, CriticalServiceRuntimeDeps, ServiceOperationInput, ServiceOperationReceipt,
} from './hospital_runtime';
import { AppendOnlyLog } from '../audit/append_only_log';

export interface LabResultCandidate {
  readonly resultId: string;
  readonly serviceId: string;
  readonly operationId: string;
  readonly beneficiary: EntityId;
  readonly performedBy: EntityId;
  readonly createdAt: number;
  readonly requiredChecks: readonly string[];
  /** حقائق الأداة/السجل عند الإنشاء؛ false يكذب ادعاء نجاح الفحص لاحقًا. */
  readonly observedChecks: Readonly<Record<string, boolean>>;
}

export interface LabPerformInput extends ServiceOperationInput {
  readonly resultId: string;
  readonly observedChecks: Readonly<Record<string, boolean>>;
}

export type LabPerformResult =
  | { readonly ok: true; readonly result: LabResultCandidate; readonly auditId: string }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };

export interface LabRuntimeDeps extends Omit<CriticalServiceRuntimeDeps, 'kind'> {
  readonly audit: AppendOnlyLog;
  readonly qualityChecks: Readonly<Record<string, number>>;
}

export class LabRuntime extends CriticalServiceRuntime {
  private readonly results = new Map<string, LabResultCandidate>();

  constructor(private readonly labDeps: LabRuntimeDeps) {
    super({ ...labDeps, kind: 'lab' });
  }

  /** تنفيذ العملية ثم قيد نتيجة معلّقة؛ لا توجد في هذه الوحدة دالة اعتماد عمدًا. */
  perform(serviceId: string, input: LabPerformInput, now = Date.now()): LabPerformResult {
    const receipt: ServiceOperationReceipt = this.execute(serviceId, input, now);
    if (!receipt.ok) return { ok: false, reason: receipt.reason as string, auditId: receipt.auditId };
    if (typeof input.resultId !== 'string' || !input.resultId.startsWith('result:')) {
      const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_refused', {
        serviceId, resultId: input.resultId, reason: 'معرّف نتيجة غير صالح',
      });
      return { ok: false, reason: 'معرّف نتيجة غير صالح', auditId: entry.hash };
    }
    if (this.results.has(input.resultId)) {
      const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_refused', {
        serviceId, resultId: input.resultId, reason: 'نتيجة قائمة بهذا المعرّف — لا تكرار',
      });
      return { ok: false, reason: 'نتيجة قائمة بهذا المعرّف — لا تكرار', auditId: entry.hash };
    }
    if (input.observedChecks === null || typeof input.observedChecks !== 'object') {
      const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_refused', {
        serviceId, resultId: input.resultId, reason: 'حقائق الفحص غير معلنة',
      });
      return { ok: false, reason: 'حقائق الفحص غير معلنة', auditId: entry.hash };
    }
    const requiredChecks = Object.keys(this.labDeps.qualityChecks);
    for (const check of Object.keys(input.observedChecks)) {
      if (!requiredChecks.includes(check)) {
        const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_refused', {
          serviceId, resultId: input.resultId, reason: 'حقيقة فحص غير معلن', check,
        });
        return { ok: false, reason: 'حقيقة فحص غير معلن', auditId: entry.hash };
      }
    }
    for (const check of requiredChecks) {
      if (typeof input.observedChecks[check] !== 'boolean') {
        const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_refused', {
          serviceId, resultId: input.resultId, reason: 'حقيقة فحص معلن غائبة', check,
        });
        return { ok: false, reason: 'حقيقة فحص معلن غائبة', auditId: entry.hash };
      }
    }
    const result: LabResultCandidate = {
      resultId: input.resultId, serviceId, operationId: input.operationId, beneficiary: input.beneficiary,
      performedBy: input.requestedBy ?? this.operatorId, createdAt: now,
      requiredChecks, observedChecks: { ...input.observedChecks },
    };
    this.results.set(result.resultId, result);
    const entry = this.labDeps.audit.append(this.operatorId, 'lab_result_created', {
      resultId: result.resultId, serviceId, operationId: result.operationId,
      beneficiary: result.beneficiary, performedBy: result.performedBy, checks: result.requiredChecks,
    });
    return { ok: true, result, auditId: entry.hash };
  }

  result(resultId: string): LabResultCandidate | null { return this.results.get(resultId) ?? null; }
  resultsList(): readonly LabResultCandidate[] { return [...this.results.values()]; }
}
