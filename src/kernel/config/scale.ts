/**
 * src/kernel/config/scale.ts — توسّع السكان
 * المالك: القيّم على المستودع | المرحلة: 31
 * المدخلات: config/scale.yaml | المخرجات: ScaleConfig
 * حالات الفشل: سقف سكاني بلا شرائح أو شريحة فوق السقف ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadQuotas } from './quotas';
import { loadYamlFile } from './yaml';

/** تهيئة توسّع السكان؛ هذه السياسة تحكم سجل الهويات الشاردي لا سجل وكلاء المرحلة 13 الصغير. */
export interface ScaleConfig {
  policy: {
    default: string;
    population_max: number;
    shard_count: number;
    per_shard_max: number;
    spawn_rate_per_minute: number;
    gateway_p99_ms: number;
    gateway_max_ms: number;
    acceptance_population: number;
    acceptance_headroom_percent: number;
    scheduler_max_concurrent: number;
    scheduler_queue_max: number;
    scheduler_owner_queue_max: number;
    rebalance: string;
    resource_name: string;
  };
}

/**
 * يحمل حدود السكان المقاسة قبل الإقلاع.
 * لا يرث `quotas.agents` عمدا: ذلك السقف (64) هو سجل الوكلاء التنفيذيين للمرحلة 13،
 * أما هذه السياسة فهي لسجل هوية/حصة/جدولة موسع ومعلن، فلا يوجد رقمان للحقيقة نفسها.
 */
export function loadScale(configDir = resolveConfigDir()): ScaleConfig {
  const raw = loadYamlFile(join(configDir, 'scale.yaml')) as unknown as ScaleConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في توسع السكان هو الرفض', 'CONFIG_SCALE_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['population_max', policy.population_max],
    ['shard_count', policy.shard_count],
    ['per_shard_max', policy.per_shard_max],
    ['spawn_rate_per_minute', policy.spawn_rate_per_minute],
    ['gateway_p99_ms', policy.gateway_p99_ms],
    ['gateway_max_ms', policy.gateway_max_ms],
    ['acceptance_population', policy.acceptance_population],
    ['scheduler_max_concurrent', policy.scheduler_max_concurrent],
    ['scheduler_queue_max', policy.scheduler_queue_max],
    ['scheduler_owner_queue_max', policy.scheduler_owner_queue_max],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد التوسع غير صالح: ${key}`, 'CONFIG_SCALE_POLICY_VALUE');
    }
  }
  if (!Number.isSafeInteger(policy.acceptance_headroom_percent)
    || policy.acceptance_headroom_percent < 0 || policy.acceptance_headroom_percent >= 100) {
    throw new SovereignViolation('هامش قبول القياس غير صالح', 'CONFIG_SCALE_HEADROOM');
  }
  if (policy.population_max > policy.shard_count * policy.per_shard_max) {
    throw new SovereignViolation(
      'السقف الكلي يتجاوز مجموع سعة الشرائح — لا فائض صامت',
      'CONFIG_SCALE_SHARD_CAP_MISMATCH',
    );
  }
  if (policy.acceptance_population > policy.population_max) {
    throw new SovereignViolation('عدد قبول القياس يتجاوز السكان المعلنين', 'CONFIG_SCALE_ACCEPTANCE_OVER_POPULATION');
  }
  if (policy.scheduler_owner_queue_max > policy.scheduler_queue_max) {
    throw new SovereignViolation('سقف طابور المالك يتجاوز الطابور الكلي', 'CONFIG_SCALE_OWNER_QUEUE_OVER_TOTAL');
  }
  if (policy.gateway_p99_ms > policy.gateway_max_ms) {
    throw new SovereignViolation('عتبة p99 تتجاوز الحد الأقصى للبوابة', 'CONFIG_SCALE_GATEWAY_THRESHOLD_ORDER');
  }
  if (policy.rebalance !== 'forbidden') {
    throw new SovereignViolation('إعادة توازن صامتة ممنوعة في المرحلة 31', 'CONFIG_SCALE_REBALANCE_ALLOWED');
  }
  if (typeof policy.resource_name !== 'string' || policy.resource_name.trim() === '') {
    throw new SovereignViolation('مورد حصة الهوية غير معلن', 'CONFIG_SCALE_RESOURCE_NAME');
  }
  const quota = loadQuotas(configDir).resources[policy.resource_name];
  if (!quota || quota.total !== policy.population_max || quota.per_agent_max !== 1) {
    throw new SovereignViolation(
      'حصة الهوية يجب أن تكون موردًا مسجلًا بسقف السكان ووحدة لكل هوية',
      'CONFIG_SCALE_RESOURCE_QUOTA_MISMATCH',
    );
  }
  return raw;
}
