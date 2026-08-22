/**
 * src/services/quality_control.ts — مراقبة جودة نتائج المختبر البرمجي (المرحلة 29)
 * المالك: ديوان التدقيق؛ لا يختبر بشرًا ولا يحتفظ ببيانات شخصية (DIRECTIVES §6)
 * المدخلات: نتيجة مختبر معلّقة، فحوص وأوزان معلنة، وتقرير اعتماد مستقل
 * المخرجات: نتيجة معتمدة أو مرفوضة ودرجة قابلة للتدقيق
 * التبعيات: سجل التدقيق، ونتيجة LabRuntime المقيدة بحقائقها
 * الصلاحيات: الاعتماد للمفتش المعلن فقط؛ من أجرى النتيجة لا يعتمدها (RULE-004)
 * السجلات: lab_quality_accepted / lab_quality_rejected / lab_quality_claim_contradicted
 * ثوابت هذه الوحدة:
 *   1) **لا اعتماد بلا فحص معلن موزون**: الدرجة مجموع الأوزان لا رقم حر
 *   2) **من أجرى لا يعتمد**: يد الإجراء ويد الاعتماد منفصلتان ومقروءتان
 *   3) **الواقع يكذب الدعوى**: فحص معلن ناجح وواقعه false يسقط النتيجة كلها
 *   4) **لا اعتماد مرتين**: كل نتيجة تُقفل مرة واحدة، والرفض يبقي الأثر ولا يختفي
 * حالات الفشل: مفتش غير معلن أو نفس المؤدي أو فحص مجهول/مكرر أو حقيقة مناقضة ⇒ رفض مغلق ومسجل
 * اختبار القبول: tests/services/critical_service_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0013-critical-services.md
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { EntityId } from '../kernel/types';
import { LabResultCandidate } from './lab_runtime';

export type LabQualityStatus = 'accepted' | 'rejected';
export interface LabQualityDecision {
  readonly resultId: string;
  readonly status: LabQualityStatus;
  readonly score: number;
  readonly approvedBy: EntityId;
  readonly passed: readonly string[];
  readonly reason: string | null;
  readonly auditId: string;
}
export interface LabQualityReport {
  readonly inspector: EntityId;
  readonly passed: readonly string[];
  readonly note?: string;
}
export type LabQualityResult =
  | { readonly ok: true; readonly decision: LabQualityDecision }
  | { readonly ok: false; readonly reason: string; readonly auditId: string };
export interface QualityControlDeps {
  readonly audit: AppendOnlyLog;
  readonly qualityChecks: Readonly<Record<string, number>>;
  readonly minQualityScore: number;
  readonly inspectorId: EntityId;
}

export class QualityControl {
  private readonly decisions = new Map<string, LabQualityDecision>();
  constructor(private readonly deps: QualityControlDeps) {}

  assess(candidate: LabResultCandidate, report: LabQualityReport, now = Date.now()): LabQualityResult {
    const reject = (reason: string, extra: Record<string, unknown> = {}): LabQualityResult => {
      const entry = this.deps.audit.append(report?.inspector ?? this.deps.inspectorId, 'lab_quality_rejected', {
        resultId: candidate?.resultId ?? 'unknown', reason, ...extra,
      });
      return { ok: false, reason, auditId: entry.hash };
    };
    if (!candidate || typeof candidate !== 'object') return reject('نتيجة مختبر غير قائمة');
    if (this.decisions.has(candidate.resultId)) return reject('نتيجة أُقفلت سابقًا — لا اعتماد مرتين');
    if (!report || typeof report !== 'object' || !Array.isArray(report.passed)) return reject('تقرير الجودة بلا فحوص');
    if (report.inspector !== this.deps.inspectorId) return reject('اعتماد الجودة للمفتش المعلن وحده (RULE-004)');
    if (report.inspector === candidate.performedBy) return reject('من أجرى النتيجة لا يعتمدها (RULE-004)');
    const allowed = new Set(candidate.requiredChecks);
    const seen = new Set<string>();
    for (const check of report.passed) {
      if (typeof check !== 'string' || !allowed.has(check) || this.deps.qualityChecks[check] === undefined) {
        return reject('فحص غير معلن يُبطل تقرير الجودة كله', { check: String(check) });
      }
      if (seen.has(check)) return reject('فحص مكرّر يُبطل تقرير الجودة كله', { check });
      seen.add(check);
    }
    const contradictions = [...seen].filter((check) => candidate.observedChecks[check] !== true);
    if (contradictions.length > 0) {
      this.deps.audit.append(report.inspector, 'lab_quality_claim_contradicted', {
        resultId: candidate.resultId, claims: contradictions, actual: candidate.observedChecks,
      });
      const reason = 'فحص أُعلن سليمًا ويكذّبه الواقع — تُسقط النتيجة';
      const entry = this.deps.audit.append(report.inspector, 'lab_quality_rejected', {
        resultId: candidate.resultId, reason, claims: contradictions, dropped: true,
      });
      // السقوط قرار نهائي أيضًا: لا يسمح أن يعود تقرير لاحق فيحيي نتيجة كذّبها واقعها.
      this.decisions.set(candidate.resultId, {
        resultId: candidate.resultId,
        status: 'rejected',
        score: 0,
        approvedBy: report.inspector,
        passed: [...seen],
        reason,
        auditId: entry.hash,
      });
      return { ok: false, reason, auditId: entry.hash };
    }
    const score = [...seen].reduce((sum, check) => sum + (this.deps.qualityChecks[check] as number), 0);
    const status: LabQualityStatus = score >= this.deps.minQualityScore ? 'accepted' : 'rejected';
    const reason = status === 'accepted' ? null : 'درجة الجودة دون الحدّ المعلن';
    const entry = this.deps.audit.append(report.inspector,
      status === 'accepted' ? 'lab_quality_accepted' : 'lab_quality_rejected', {
        resultId: candidate.resultId, score, minQualityScore: this.deps.minQualityScore,
        passed: [...seen], note: typeof report.note === 'string' ? report.note.trim() : '',
      });
    const decision: LabQualityDecision = {
      resultId: candidate.resultId, status, score, approvedBy: report.inspector,
      passed: [...seen], reason, auditId: entry.hash,
    };
    this.decisions.set(candidate.resultId, decision);
    return { ok: true, decision };
  }
  decision(resultId: string): LabQualityDecision | null { return this.decisions.get(resultId) ?? null; }
  report(): { readonly total: number; readonly accepted: number; readonly rejected: number; readonly minQualityScore: number } {
    const values = [...this.decisions.values()];
    return { total: values.length, accepted: values.filter((d) => d.status === 'accepted').length,
      rejected: values.filter((d) => d.status === 'rejected').length, minQualityScore: this.deps.minQualityScore };
  }
}
