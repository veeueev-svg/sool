/**
 * src/models/safety_attestation.ts — شهادةُ سلامةٍ تُقاس لا تُدَّعى (المرحلة 39 — البند T-21)
 * المالك: ديوان التدقيق | إكمالُ C-13: «غير مُقيَّم لا يُشغَّل»
 * المدخلات: مجموعةُ السلامة الجدّيّة + سياسةُ `config/inference.yaml` + دالةُ استدلال
 * المخرجات: `AttestationRecord` — أو استثناءٌ برمزٍ صريح، ولا شهادةَ بالافتراض
 * التبعيات: `EvaluationSuite` و`safety_cases` والسجل — ولا سلطةَ تنفيذٍ لهذه الوحدة
 * حالات الفشل (كلها مغلقة):
 *   - مجموعةٌ أصغرُ من الحدّ ⇒ SAFETY_SUITE_TOO_SMALL / SAFETY_BENIGN_TOO_FEW
 *   - بابٌ مطلوبٌ غيرُ مغطّى ⇒ SAFETY_CATEGORY_MISSING
 *   - خرجٌ غيرُ متمايز (نصٌّ معلَّب) ⇒ SAFETY_OUTPUT_NOT_DISTINCT
 *   - حالةُ سلامةٍ ساقطة ⇒ SAFETY_CASE_FAILED
 *   - حالةٌ بريئةٌ مرفوضة ⇒ SAFETY_BENIGN_FAILED
 * اختبار القبول: tests/models/safety_attestation.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0028-inference-gate.md
 *
 * ثوابت هذه الوحدة:
 *
 * 1) **الشهادةُ مربوطةٌ بالمجموعة ببصمتها.** `suiteDigest` بصمةُ معرّفات الحالات؛
 *    فإن استُبدلت المجموعةُ بأضعفَ منها بطلت كلُّ شهادةٍ سابقة، ولم يُستفَد من
 *    تخفيفٍ لاحقٍ بأثرٍ رجعي.
 *
 * 2) **النصُّ المعلَّب يسقط.** تمايزُ الخرج يُقاس على الحالات؛ ونصٌّ ثابتٌ واحدٌ
 *    نسبةُ تمايزِه ≈ 0 فيُرفض قبل أن يُنظر في محتواه.
 *
 * 3) **الشهادةُ تنتهي.** `expiresAt` من `attestation_ttl_ms`؛ وشهادةٌ لا تنتهي
 *    تصير دعوى قديمة يُشغَّل بها ما تغيّر.
 */
import { createHash } from 'node:crypto';
import { EntityId, SovereignViolation } from '../kernel/types';
import { AppendOnlyLog } from '../audit/append_only_log';
import { InferenceConfig } from '../kernel/config/inference';
import { EvalResult, EvaluationSuite } from './evaluation_suite';
import { RigorousCase, RIGOROUS_SAFETY_CASES, coveredCategories } from './safety_cases';

export interface AttestationRecord {
  readonly modelId: string;
  readonly version: string;
  readonly at: number;
  readonly expiresAt: number;
  readonly suiteDigest: string;
  readonly safetyCases: number;
  readonly benignCases: number;
  readonly categories: readonly string[];
  readonly distinctOutputRatio: number;
  readonly result: EvalResult;
}

/** بصمةُ المجموعة: معرّفاتُ الحالات مرتّبةً — تغييرُ الحالات يُبطل الشهادات */
export function suiteDigestOf(cases: readonly RigorousCase[]): string {
  const ids = cases.map((c) => `${c.id}:${c.kind}:${c.category}`).sort();
  return createHash('sha256').update(JSON.stringify(ids), 'utf8').digest('hex');
}

export class SafetyAttestor {
  private readonly suite: EvaluationSuite;

  constructor(
    private readonly audit: AppendOnlyLog,
    private readonly config: InferenceConfig,
    private readonly cases: readonly RigorousCase[] = RIGOROUS_SAFETY_CASES,
    private readonly attestorId: EntityId = 'authority:audit_bureau',
  ) {
    this.suite = new EvaluationSuite(audit, cases, attestorId);
  }

  get suiteDigest(): string {
    return suiteDigestOf(this.cases);
  }

  private fail(modelId: string, version: string, code: string, message: string, at: number): never {
    this.audit.append(this.attestorId, 'model_safety_attestation_failed', {
      modelId, version, code, at, suiteDigest: this.suiteDigest,
    });
    throw new SovereignViolation(message, code);
  }

  /** نسبةُ تمايزِ الخرج: عددُ الأجوبة المتمايزة على عدد الحالات */
  private distinctRatio(infer: (prompt: string) => string): number {
    const seen = new Set<string>();
    for (const c of this.cases) {
      let out = '';
      try { out = infer(c.prompt); } catch { out = `__throw__:${c.id}`; }
      seen.add(out.trim());
    }
    return seen.size / this.cases.length;
  }

  /**
   * يُشهِد لإصدارٍ بعينه بعد قياسٍ فعليّ. لا يرقّي حالةَ نموذجٍ ولا يمنح تشغيلًا:
   * الشهادةُ شرطٌ من شروط المحرّك، والقرارُ هناك.
   */
  attest(
    modelId: string,
    version: string,
    infer: (prompt: string) => string,
    now: number,
  ): AttestationRecord {
    const S = this.config.safety;
    const safetyCases = this.cases.filter((c) => c.kind === 'safety').length;
    const benignCases = this.cases.filter((c) => c.category === 'benign').length;
    if (safetyCases < S.minSafetyCases) {
      this.fail(modelId, version, 'SAFETY_SUITE_TOO_SMALL',
        `حالاتُ السلامة ${safetyCases} دون الحدّ ${S.minSafetyCases} — مجموعةٌ صغيرةٌ ليست تقييمًا`, now);
    }
    if (benignCases < S.minBenignCases) {
      this.fail(modelId, version, 'SAFETY_BENIGN_TOO_FEW',
        `الحالاتُ البريئة ${benignCases} دون الحدّ ${S.minBenignCases} — بلا مقابلٍ يجتاز الجدارُ الصامت`, now);
    }
    const categories = coveredCategories(this.cases);
    const missing = S.requiredCategories.filter((c) => !categories.includes(c));
    if (missing.length > 0) {
      this.fail(modelId, version, 'SAFETY_CATEGORY_MISSING',
        `أبوابٌ مطلوبةٌ غيرُ مغطّاة: ${missing.join('، ')}`, now);
    }

    const ratio = this.distinctRatio(infer);
    if (ratio < S.minDistinctOutputRatio) {
      this.fail(modelId, version, 'SAFETY_OUTPUT_NOT_DISTINCT',
        `تمايزُ الخرج ${ratio.toFixed(3)} دون ${S.minDistinctOutputRatio} — جوابٌ معلَّبٌ لا استدلال`, now);
    }

    const result = this.suite.run(modelId, version, infer);
    const safetyFailures = result.safetyTotal - result.safetyPassed;
    if (safetyFailures > S.maxSafetyFailures) {
      this.fail(modelId, version, 'SAFETY_CASE_FAILED',
        `حالاتُ سلامةٍ ساقطة: ${result.failed.filter((id) => id.startsWith('safety:')).join('، ')}`, now);
    }
    const benignFailed = result.failed.filter((id) => id.startsWith('benign:'));
    if (S.benignMustPass && benignFailed.length > 0) {
      this.fail(modelId, version, 'SAFETY_BENIGN_FAILED',
        `حالاتٌ بريئةٌ رُفضت: ${benignFailed.join('، ')} — الرفضُ الشامل فشلٌ لا نجاح`, now);
    }

    const record: AttestationRecord = Object.freeze({
      modelId,
      version,
      at: now,
      expiresAt: now + this.config.limits.attestationTtlMs,
      suiteDigest: this.suiteDigest,
      safetyCases,
      benignCases,
      categories,
      distinctOutputRatio: Number(ratio.toFixed(4)),
      result,
    });
    this.audit.append(this.attestorId, 'model_safety_attested', {
      modelId, version, at: now, expiresAt: record.expiresAt,
      suiteDigest: record.suiteDigest, safetyCases, benignCases,
      categories, distinctOutputRatio: record.distinctOutputRatio,
    });
    return record;
  }
}
