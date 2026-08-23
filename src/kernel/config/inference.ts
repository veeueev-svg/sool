/**
 * src/kernel/config/inference.ts — سياسةُ الاستدلال وشروطُ التشغيل من التهيئة
 * المالك: وزارة البحث | المرحلة: 39 (البند T-21 — إكمالُ C-13)
 * المدخلات: config/inference.yaml | المخرجات: InferenceConfig
 * التبعيات: محلّل YAML الآمن و`resolveConfigDir` — ولا شيء غيرهما
 * الصلاحيات: القراءةُ والتحقّق؛ ولا تُنشئ هذه الوحدة شرطًا ولا تُنفّذه
 * حالات الفشل (كلها مغلقة):
 *   - لا ملف أو لا سياسة معلنة ⇒ CONFIG_NO_INFERENCE_POLICY
 *   - الافتراض ليس رفضًا ⇒ CONFIG_INFERENCE_DEFAULT_ALLOW
 *   - شرطٌ من شروطِ التشغيل مُعطَّلٌ من التهيئة ⇒ CONFIG_INFERENCE_GUARD_DISABLED
 *   - حدٌّ غائبٌ أو غيرُ صحيحٍ موجب ⇒ CONFIG_INFERENCE_LIMIT
 *   - شرطُ جدّيّةٍ ناقصٌ أو مُخفَّف ⇒ CONFIG_INFERENCE_SAFETY
 *   - عتبةُ حملٍ ناقصة أو خرقٌ مسموحٌ فوق الصفر ⇒ CONFIG_INFERENCE_LOAD
 *   - شدّةُ الإنتاج ليست «حرجة» ⇒ CONFIG_INFERENCE_SEVERITY
 *
 * ثابتُ هذه الوحدة: **الشروطُ الثلاثةُ مُلزمة.** `require_active` و
 * `require_digest_match` و`require_attestation` لا تُعطَّل من التهيئة: من يملك
 * تعطيلَ الشرط يملك نقضَ المعيار بسطرٍ في ملف، وذلك بابٌ يُغلق هنا لا يُترك
 * لحسن النيّة (RULE-007). وهذا الملفُّ **المصدرُ الوحيد** لهذه الأرقام (RULE-005).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

export interface InferenceLimits {
  /** شروطٌ مُلزمة: قيمتُها `true` دائمًا، و`false` يُسقط تحميلَ التهيئة */
  readonly requireActive: true;
  readonly requireDigestMatch: true;
  readonly requireAttestation: true;
  readonly attestationTtlMs: number;
  readonly maxOutputChars: number;
  readonly maxLatencyMs: number;
  readonly maxConcurrent: number;
}

export interface SafetyRigorPolicy {
  readonly minSafetyCases: number;
  readonly minBenignCases: number;
  readonly requiredCategories: readonly string[];
  readonly minDistinctOutputRatio: number;
  /** الفشلُ المسموح في السلامة — صفرٌ دائمًا */
  readonly maxSafetyFailures: 0;
  /** الرفضُ الشامل فشل: الحالاتُ البريئة تُجاب كلُّها */
  readonly benignMustPass: true;
}

export interface InferenceLoadPolicy {
  readonly concurrentRequests: number;
  readonly requestsPerWorker: number;
  readonly decisionP99Ms: number;
  readonly decisionMaxMs: number;
  /** خرقُ المنع المسموح — صفرٌ دائمًا، والتهيئةُ لا تملك رفعَه */
  readonly maxDenialBreach: 0;
}

export interface InferenceConfig {
  readonly limits: InferenceLimits;
  readonly safety: SafetyRigorPolicy;
  readonly load: InferenceLoadPolicy;
  readonly productionSeverity: 'critical';
}

function positiveInt(raw: unknown, field: string, code: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SovereignViolation(
      `حدُّ الاستدلال «${field}» غير معلنٍ أو غيرُ صحيحٍ موجب — لا حدَّ بلا رقم`,
      code,
    );
  }
  return value;
}

function mandatoryGuard(raw: unknown, field: string): true {
  if (raw !== true) {
    throw new SovereignViolation(
      `شرطُ التشغيل «${field}» مُلزمٌ ولا يُعطَّل من التهيئة — تعطيلُه نقضٌ للمعيار C-13`,
      'CONFIG_INFERENCE_GUARD_DISABLED',
    );
  }
  return true;
}

function readLimits(policy: Record<string, unknown>): InferenceLimits {
  const L = 'CONFIG_INFERENCE_LIMIT';
  return Object.freeze({
    requireActive: mandatoryGuard(policy.require_active, 'require_active'),
    requireDigestMatch: mandatoryGuard(policy.require_digest_match, 'require_digest_match'),
    requireAttestation: mandatoryGuard(policy.require_attestation, 'require_attestation'),
    attestationTtlMs: positiveInt(policy.attestation_ttl_ms, 'attestation_ttl_ms', L),
    maxOutputChars: positiveInt(policy.max_output_chars, 'max_output_chars', L),
    maxLatencyMs: positiveInt(policy.max_latency_ms, 'max_latency_ms', L),
    maxConcurrent: positiveInt(policy.max_concurrent, 'max_concurrent', L),
  });
}

function readSafety(raw: unknown): SafetyRigorPolicy {
  const S = 'CONFIG_INFERENCE_SAFETY';
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation(
      'شروطُ جدّيّةِ مجموعةِ السلامة غير معلنة — ومجموعةٌ بلا شرطِ جدّيّةٍ يجتازها نصٌّ معلَّب',
      S,
    );
  }
  const safety = raw as Record<string, unknown>;
  const categories = safety.required_categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new SovereignViolation('أبوابُ السلامة المطلوبة غير معلنة — لا تغطيةَ تُقاس', S);
  }
  const names = categories.map((c) => String(c));
  if (new Set(names).size !== names.length) {
    throw new SovereignViolation('بابٌ مكرَّرٌ في أبواب السلامة — تغطيةٌ منتفخةٌ بالعدّ لا بالمدى', S);
  }
  if (Number(safety.max_safety_failures) !== 0) {
    throw new SovereignViolation(
      'الفشلُ المسموح في السلامة لا يكون فوق الصفر — حالةُ سلامةٍ ساقطةٌ ليست درجةً تُجمع',
      S,
    );
  }
  if (safety.benign_must_pass !== true) {
    throw new SovereignViolation(
      'الحالاتُ البريئة يجب أن تُجاب كلُّها — نموذجٌ يرفض كلَّ شيءٍ آمنٌ بلا نفع',
      S,
    );
  }
  const ratio = Number(safety.min_distinct_output_ratio);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new SovereignViolation(
      'نسبةُ تمايزِ الخرج غير معلنةٍ أو خارج المدى (0،1] — وبلا تمايزٍ يجتاز النصُّ الواحد كلَّ حالة',
      S,
    );
  }
  return Object.freeze({
    minSafetyCases: positiveInt(safety.min_safety_cases, 'min_safety_cases', S),
    minBenignCases: positiveInt(safety.min_benign_cases, 'min_benign_cases', S),
    requiredCategories: Object.freeze(names),
    minDistinctOutputRatio: ratio,
    maxSafetyFailures: 0 as const,
    benignMustPass: true as const,
  });
}

function readLoad(raw: unknown): InferenceLoadPolicy {
  const L = 'CONFIG_INFERENCE_LOAD';
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation(
      'عتباتُ تمرينِ حملِ الاستدلال غير معلنة — تمرينٌ بلا عتبةٍ لا يُفشِل أحدًا',
      L,
    );
  }
  const load = raw as Record<string, unknown>;
  if (Number(load.max_denial_breach) !== 0) {
    throw new SovereignViolation(
      'خرقُ المنع المسموح لا يكون فوق الصفر — نداءٌ واحدٌ لنموذجٍ غير مؤهَّلٍ مرّ يُسقط المعيار',
      L,
    );
  }
  return Object.freeze({
    concurrentRequests: positiveInt(load.concurrent_requests, 'concurrent_requests', L),
    requestsPerWorker: positiveInt(load.requests_per_worker, 'requests_per_worker', L),
    decisionP99Ms: positiveInt(load.decision_p99_ms, 'decision_p99_ms', L),
    decisionMaxMs: positiveInt(load.decision_max_ms, 'decision_max_ms', L),
    maxDenialBreach: 0 as const,
  });
}

/** تحميلُ سياسةِ الاستدلال — الفشلُ مغلقٌ ولا افتراضاتَ صامتة */
export function loadInference(configDir = resolveConfigDir()): InferenceConfig {
  const path = join(configDir, 'inference.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation(
      'لا ملفَ سياسةِ استدلال — ولا تشغيلَ نموذجٍ بلا سياسةٍ معلنة',
      'CONFIG_NO_INFERENCE_POLICY',
    );
  }
  const doc = loadYamlFile(path) as Record<string, unknown>;
  const policy = doc.policy as Record<string, unknown> | undefined;
  if (!policy || typeof policy !== 'object') {
    throw new SovereignViolation(
      'ملفُّ الاستدلال بلا قسمِ سياسة — لا شروطَ تُقرأ',
      'CONFIG_NO_INFERENCE_POLICY',
    );
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'افتراضُ سياسةِ الاستدلال يجب أن يكون رفضًا — والسماحُ الافتراضي تشغيلٌ بلا سند',
      'CONFIG_INFERENCE_DEFAULT_ALLOW',
    );
  }
  if (doc.production_severity !== 'critical') {
    throw new SovereignViolation(
      'شدّةُ حادثِ الاستدلال في الإنتاج لا تُخفَّف عن «حرج»',
      'CONFIG_INFERENCE_SEVERITY',
    );
  }
  return Object.freeze({
    limits: readLimits(policy),
    safety: readSafety(doc.safety),
    load: readLoad(doc.load),
    productionSeverity: 'critical' as const,
  });
}
