/**
 * src/kernel/config/reproduction.ts — سياسةُ التوالد وحدودُها من التهيئة
 * المالك: وزارة الداخلية | المرحلة: 39 (البند T-25 — إكمالُ C-11)
 * المدخلات: config/reproduction.yaml | المخرجات: ReproductionConfig
 * التبعيات: محلّل YAML الآمن و`resolveConfigDir` — ولا شيء غيرهما
 * الصلاحيات: القراءةُ والتحقّق؛ ولا تُنشئ هذه الوحدة حدًّا ولا تُنفّذه
 * حالات الفشل (كلها مغلقة):
 *   - لا ملف أو لا سياسة معلنة ⇒ CONFIG_NO_REPRODUCTION_POLICY
 *   - الافتراض ليس رفضًا ⇒ CONFIG_REPRODUCTION_DEFAULT_ALLOW
 *   - حدٌّ غائبٌ أو غيرُ صحيحٍ أو غيرُ موجب ⇒ CONFIG_REPRODUCTION_LIMIT
 *   - عتبةُ حملٍ ناقصة، أو خرقٌ مسموحٌ فوق الصفر ⇒ CONFIG_REPRODUCTION_LOAD
 *   - شدّةُ الإنتاج ليست «حرجة» ⇒ CONFIG_REPRODUCTION_SEVERITY
 *
 * ثابتُ هذه الوحدة: **هذا الملفُّ المصدرُ الوحيد لهذه الحدود.** ولا تُصدَّر من
 * هنا ولا من غيرِها نسخةٌ ثانيةٌ من الأرقام في الشيفرة (RULE-005) — لأن سياستين
 * تعنيان أن إحداهما تكذب، ولا يُعلَم أيُّهما إلا بعد الحادث.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

export interface ReproductionLimits {
  /** أقصى عمقٍ لسلسلةِ الاشتقاق — الجيلُ 1 من سلطةٍ بشريّة مباشرة */
  readonly generationMax: number;
  readonly batchMax: number;
  readonly perHourMax: number;
  /** مهلةُ الحجز: ما لم يُثبَّت ولم يُفرَج عنه خلالها يسقط ويُعاد نصيبُه */
  readonly reservationTtlMs: number;
  readonly maxOutstandingReservations: number;
}

export interface ReproductionLoadPolicy {
  readonly concurrentBatches: number;
  readonly batchSize: number;
  readonly blueprintCap: number;
  /** خرقُ السقف المسموح — صفرٌ دائمًا، والتهيئةُ لا تملك رفعَه */
  readonly maxCapBreach: 0;
  readonly decisionP99Ms: number;
  readonly decisionMaxMs: number;
}

export interface ReproductionConfig {
  readonly limits: ReproductionLimits;
  readonly load: ReproductionLoadPolicy;
  readonly productionSeverity: 'critical';
}

function positiveInt(raw: unknown, field: string, code: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SovereignViolation(
      `حدُّ التوالد «${field}» غير معلنٍ أو غيرُ صحيحٍ موجب — لا حدَّ بلا رقم`,
      code,
    );
  }
  return value;
}

function readLimits(policy: Record<string, unknown>): ReproductionLimits {
  const L = 'CONFIG_REPRODUCTION_LIMIT';
  return Object.freeze({
    generationMax: positiveInt(policy.generation_max, 'generation_max', L),
    batchMax: positiveInt(policy.batch_max, 'batch_max', L),
    perHourMax: positiveInt(policy.per_hour_max, 'per_hour_max', L),
    reservationTtlMs: positiveInt(policy.reservation_ttl_ms, 'reservation_ttl_ms', L),
    maxOutstandingReservations: positiveInt(
      policy.max_outstanding_reservations, 'max_outstanding_reservations', L,
    ),
  });
}

function readLoad(raw: unknown): ReproductionLoadPolicy {
  const L = 'CONFIG_REPRODUCTION_LOAD';
  if (!raw || typeof raw !== 'object') {
    throw new SovereignViolation(
      'عتباتُ تمرينِ الحمل غير معلنة — تمرينٌ بلا عتبةٍ لا يُفشِل أحدًا',
      L,
    );
  }
  const load = raw as Record<string, unknown>;
  const breach = Number(load.max_cap_breach);
  if (breach !== 0) {
    throw new SovereignViolation(
      'خرقُ السقف المسموح لا يكون فوق الصفر — نسخةٌ واحدةٌ فوق السقف انفجارٌ ابتدأ',
      L,
    );
  }
  return Object.freeze({
    concurrentBatches: positiveInt(load.concurrent_batches, 'concurrent_batches', L),
    batchSize: positiveInt(load.batch_size, 'batch_size', L),
    blueprintCap: positiveInt(load.blueprint_cap, 'blueprint_cap', L),
    maxCapBreach: 0 as const,
    decisionP99Ms: positiveInt(load.decision_p99_ms, 'decision_p99_ms', L),
    decisionMaxMs: positiveInt(load.decision_max_ms, 'decision_max_ms', L),
  });
}

/** تحميلُ سياسةِ التوالد — الفشلُ مغلقٌ ولا افتراضاتَ صامتة */
export function loadReproduction(configDir = resolveConfigDir()): ReproductionConfig {
  const path = join(configDir, 'reproduction.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation(
      'لا ملفَ سياسةِ توالد — والتوالدُ بلا سياسةٍ معلنةٍ ممنوع',
      'CONFIG_NO_REPRODUCTION_POLICY',
    );
  }
  const doc = loadYamlFile(path) as Record<string, unknown>;
  const policy = doc.policy as Record<string, unknown> | undefined;
  if (!policy || typeof policy !== 'object') {
    throw new SovereignViolation(
      'ملفُّ التوالد بلا قسمِ سياسة — لا حدودَ تُقرأ',
      'CONFIG_NO_REPRODUCTION_POLICY',
    );
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'افتراضُ سياسةِ التوالد يجب أن يكون رفضًا — والسماحُ الافتراضي انفجارٌ مؤجَّل',
      'CONFIG_REPRODUCTION_DEFAULT_ALLOW',
    );
  }
  const severity = doc.production_severity;
  if (severity !== 'critical') {
    throw new SovereignViolation(
      'شدّةُ حادثِ التوالد في الإنتاج لا تُخفَّف عن «حرج»',
      'CONFIG_REPRODUCTION_SEVERITY',
    );
  }
  return Object.freeze({
    limits: readLimits(policy),
    load: readLoad(doc.load),
    productionSeverity: 'critical' as const,
  });
}
