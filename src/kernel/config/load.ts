/**
 * src/kernel/config/load.ts — تمرين الضغط
 * المالك: القيّم على المستودع | المرحلة: 33
 * المدخلات: config/load.yaml | المخرجات: LoadConfig
 * حالات الفشل: جهة تنفيذ تُشغّل التمرين على نفسها ⇒ فشل مغلق (RULE-004)
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadQuotas } from './quotas';
import { loadScale } from './scale';
import { loadYamlFile } from './yaml';

/**
 * تهيئة اختبارات الضغط (المرحلة 33): الحمل المعلن وحدوده وعتباته.
 * كل رقم هنا سياسة تُنفَّذ لا وصف: تمرين يتجاوز المعلن يُرفض، وتقرير يخالف العتبة يفشل.
 * وصفر الفقد وصفر تجاوز الحصص ثابتان لا يُخفَّفان من التهيئة (RULE-009).
 */
export interface LoadConfig {
  policy: {
    default: 'deny';
    drill_authority: string;
    sustained_commands: number;
    burst_commands: number;
    window_seconds: number;
    max_command_loss: number;
    max_quota_overrun: number;
    channel_p99_ms: number;
    channel_max_ms: number;
    scheduler_queue_probe: number;
    resource_name: string;
    quota_probe_amount: number;
    escalate_on_breach: boolean;
  };
}

/** جهات التنفيذ التي لا يجوز أن تُشغّل تمرين الضغط على نفسها (RULE-004). */
export const LOAD_FORBIDDEN_DRILL_AUTHORITIES: readonly string[] = [
  'identity:king', 'authority:crown', 'authority:crown_guard', 'authority:bootstrap',
];

export function loadLoad(configDir = resolveConfigDir()): LoadConfig {
  const raw = loadYamlFile(join(configDir, 'load.yaml')) as unknown as LoadConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الضغط غير معلنة', 'CONFIG_NO_LOAD_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الضغط هو الرفض', 'CONFIG_LOAD_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['sustained_commands', policy.sustained_commands],
    ['burst_commands', policy.burst_commands],
    ['window_seconds', policy.window_seconds],
    ['channel_p99_ms', policy.channel_p99_ms],
    ['channel_max_ms', policy.channel_max_ms],
    ['scheduler_queue_probe', policy.scheduler_queue_probe],
    ['quota_probe_amount', policy.quota_probe_amount],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد ضغط غير صالح: ${key}`, 'CONFIG_LOAD_POLICY_VALUE');
    }
  }
  if (policy.max_command_loss !== 0) {
    throw new SovereignViolation(
      'لا فقد أوامر مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_LOAD_LOSS_TOLERATED',
    );
  }
  if (policy.max_quota_overrun !== 0) {
    throw new SovereignViolation(
      'لا تجاوز حصص مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_LOAD_OVERRUN_TOLERATED',
    );
  }
  if (policy.burst_commands > policy.sustained_commands) {
    throw new SovereignViolation(
      'الدفعة القصوى تتجاوز الحمل المستمر المعلن — حمل غير مقيس',
      'CONFIG_LOAD_BURST_OVER_SUSTAINED',
    );
  }
  if (policy.channel_p99_ms > policy.channel_max_ms) {
    throw new SovereignViolation('عتبة p99 تتجاوز الحد الأقصى للقناة', 'CONFIG_LOAD_LATENCY_THRESHOLD_ORDER');
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق عتبة الضغط لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_LOAD_BREACH_SILENT',
    );
  }
  if (typeof policy.drill_authority !== 'string' || policy.drill_authority.trim() === '') {
    throw new SovereignViolation('جهة تمرين الضغط غير معلنة', 'CONFIG_LOAD_DRILL_AUTHORITY');
  }
  if (LOAD_FORBIDDEN_DRILL_AUTHORITIES.includes(policy.drill_authority)) {
    throw new SovereignViolation(
      'من ينفّذ لا يقيس نفسه: جهة التمرين يجب أن تكون خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_LOAD_DRILL_AUTHORITY_EXECUTOR',
    );
  }
  if (typeof policy.resource_name !== 'string' || policy.resource_name.trim() === '') {
    throw new SovereignViolation('مورد ضغط الحصص غير معلن', 'CONFIG_LOAD_RESOURCE_NAME');
  }
  const quota = loadQuotas(configDir).resources[policy.resource_name];
  if (!quota || quota.total <= 0 || quota.per_agent_max <= 0) {
    throw new SovereignViolation(
      'مورد ضغط الحصص يجب أن يكون موردًا مسجَّلًا بسقف موجب',
      'CONFIG_LOAD_RESOURCE_QUOTA_MISMATCH',
    );
  }
  if (policy.quota_probe_amount > quota.per_agent_max) {
    throw new SovereignViolation(
      'كمية جسّ الحصة تتجاوز سقف الكيان فيصير كل طلب مرفوضًا لسببٍ آخر',
      'CONFIG_LOAD_PROBE_OVER_PER_AGENT',
    );
  }
  const scheduler = loadScale(configDir).policy;
  if (policy.scheduler_queue_probe <= scheduler.scheduler_queue_max) {
    throw new SovereignViolation(
      'جسّ الطابور لا يبلغ سقفه المعلن — إشباع غير مقيس',
      'CONFIG_LOAD_QUEUE_PROBE_UNDER_CAP',
    );
  }
  return raw;
}
