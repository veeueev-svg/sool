/**
 * src/models/fine_tuning.ts — تدريب النموذج وشرط الترقية (المرحلة 18)
 * المالك: وزارة البحث (والتقييم بيد ديوان التدقيق)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: نموذج أساس معتمد + أثر بيانات مُفرَج عنه + أمر ملكي بفعل train_model
 * المخرجات: إصدار مرشَّح مسجَّل **محجورًا** إن نجح شرط الترقية، أو رفض موثّق بسببه
 * التبعيات: بوابة التاج، مدقّق الآثار، سجل النماذج، مجموعة التقييم، مفتاح الإيقاف
 * الصلاحيات: التدريب أمر ملكي؛ والترقية لا تعني الاعتماد — الاعتماد أمر ملكي ثانٍ
 * السجلات: training_refused / model_candidate_rejected / model_candidate_accepted
 * ثوابت هذه الوحدة:
 *   1) لا تدريب على بيانات محجورة أو غير موقَّعة — الأثر يجب أن يكون released ونوعه dataset
 *   2) لا تدريب على نموذج غير معتمد
 *   3) التقييم يجري **قبل وبعد** — والأساس يُقاس لا يُفترض
 *   4) فشل حالة سلامة واحدة في المرشَّح ⇒ رفض قاطع بلا نظر إلى الجودة
 *   5) تراجع الجودة عن الأساس ⇒ رفض (لا ترقية على حساب الجودة)
 *   6) النجاح يعني التسجيل محجورًا لا التنشيط — ولا يُحذف الأساس أبدًا (شرط التراجع)
 * حالات الفشل (كلها مغلقة)
 * اختبار القبول: tests/models/training.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0003-external-artifacts.md
 */
import { EntityId, SignedRoyalCommand, Decision } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { CrownGateway } from '../crown/crown_gateway';
import { KillSwitch } from '../security/kill_switch';
import { ArtifactVerifier } from './source_verification';
import { ModelRegistry } from './model_registry';
import { EvaluationSuite, EvalResult } from './evaluation_suite';
import { ModelManifest } from './model_manifest';

export interface TrainingRequest {
  readonly modelId: string;
  readonly baseVersion: string;
  readonly candidateVersion: string;
  readonly datasetArtifactId: string;
  /** بيان الإصدار المرشَّح — أوزانه الجديدة ببصماتها */
  readonly candidateManifest: ModelManifest;
}

export interface TrainingInference {
  readonly base: (prompt: string) => string;
  readonly candidate: (prompt: string) => string;
}

export interface TrainingOutcome {
  readonly promoted: boolean;
  readonly reason: string;
  readonly baseline: EvalResult | null;
  readonly candidate: EvalResult | null;
  readonly auditId: string;
}

export interface FineTuningDeps {
  readonly audit: AppendOnlyLog;
  readonly gateway: CrownGateway;
  readonly killSwitch: KillSwitch;
  readonly verifier: ArtifactVerifier;
  readonly models: ModelRegistry;
  readonly suite: EvaluationSuite;
  readonly ministryId?: EntityId;
}

export class FineTuningRun {
  private readonly ministryId: EntityId;

  constructor(private readonly deps: FineTuningDeps) {
    this.ministryId = deps.ministryId ?? 'ministry:research';
  }

  train(
    command: SignedRoyalCommand,
    req: TrainingRequest,
    infer: TrainingInference,
    now = Date.now(),
  ): TrainingOutcome {
    const refuse = (reason: string, kind = 'training_refused'): TrainingOutcome => {
      const entry = this.deps.audit.append(this.ministryId, kind, {
        modelId: req.modelId, baseVersion: req.baseVersion,
        candidateVersion: req.candidateVersion, reason,
      });
      return { promoted: false, reason, baseline: null, candidate: null, auditId: entry.hash };
    };

    const halt = this.deps.killSwitch.status;
    if (halt.engaged) return refuse('الإيقاف مُشتغل — لا تدريب');
    const decision = this.deps.gateway.authorize(command, now);
    if (!decision.allowed) return refuse(`أمر التدريب مرفوض: ${decision.reason}`);
    if (command.payload.action !== 'train_model') return refuse('الفعل لا يخصّ تدريب نموذج');

    const dataset = this.deps.verifier.get(req.datasetArtifactId);
    if (!dataset) return refuse('أثر بيانات غير مسجَّل');
    if (dataset.kind !== 'dataset') return refuse(`نوع الأثر ${dataset.kind} ليس بيانات تدريب`);
    if (dataset.status !== 'released') {
      return refuse('بيانات محجورة — لا تدريب من الحجر', 'quarantined_dataset_refused');
    }

    const base = this.deps.models.get(req.modelId, req.baseVersion);
    if (!base) return refuse('نموذج الأساس غير مسجَّل');
    if (base.status !== 'approved' && base.status !== 'active') {
      return refuse(`نموذج الأساس بحالة ${base.status} — لا تدريب عليه`);
    }
    if (req.candidateVersion === req.baseVersion) return refuse('إصدار المرشَّح يساوي الأساس');
    if (req.candidateManifest.modelId !== req.modelId
      || req.candidateManifest.version !== req.candidateVersion) {
      return refuse('بيان المرشَّح لا يطابق معرّف النموذج أو إصداره');
    }

    // التقييم قبل: الأساس يُقاس لا يُفترض
    const baseline = this.deps.suite.run(req.modelId, req.baseVersion, infer.base);
    // التقييم بعد
    const candidate = this.deps.suite.run(req.modelId, req.candidateVersion, infer.candidate);

    const reject = (reason: string): TrainingOutcome => {
      const entry = this.deps.audit.append(this.ministryId, 'model_candidate_rejected', {
        modelId: req.modelId, baseVersion: req.baseVersion, candidateVersion: req.candidateVersion,
        reason, baselineScore: baseline.qualityScore, candidateScore: candidate.qualityScore,
        candidateFailed: candidate.failed,
      });
      this.deps.audit.append(this.ministryId, 'escalated_to_king', {
        incident: 'training_rejected', modelId: req.modelId,
        candidateVersion: req.candidateVersion, reason,
      });
      return { promoted: false, reason, baseline, candidate, auditId: entry.hash };
    };

    if (!candidate.safetyClean) {
      return reject(`فشل ${candidate.safetyTotal - candidate.safetyPassed} من حالات السلامة — رفض قاطع`);
    }
    if (candidate.qualityScore < baseline.qualityScore) {
      return reject('تراجع الجودة عن الأساس — لا ترقية بتراجع');
    }

    const registered = this.deps.models.register(
      req.candidateManifest, { origin: 'fine_tuned', baseVersion: req.baseVersion }, now,
    );
    if (!registered.allowed) return refuse(`تسجيل المرشَّح مرفوض: ${registered.reason}`);

    const entry = this.deps.audit.append(this.ministryId, 'model_candidate_accepted', {
      modelId: req.modelId, baseVersion: req.baseVersion, candidateVersion: req.candidateVersion,
      baselineScore: baseline.qualityScore, candidateScore: candidate.qualityScore,
      datasetArtifactId: req.datasetArtifactId, datasetDigest: dataset.digest,
      status: 'quarantined',
    });
    return {
      promoted: true,
      reason: 'قُبل المرشَّح وسُجّل محجورًا — الاعتماد والتنشيط قراران لاحقان',
      baseline, candidate, auditId: entry.hash,
    };
  }
}
