/**
 * src/kernel/config/recovery.ts — التعافي والاستمرارية
 * المالك: القيّم على المستودع | المرحلة: 32
 * المدخلات: config/recovery.yaml | المخرجات: RecoveryConfig
 * حالات الفشل: هدف تعافٍ بلا رقم منفَّذ ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** تهيئة التعافي: أرقام معلنة يجري إنفاذها، لا أهداف تسويقية. */
export interface RecoveryConfig {
  policy: {
    rto_seconds: number;
    rpo_seconds: number;
    backup_interval_seconds: number;
    retention_count: number;
    verify_after_restore: boolean;
    backup_directory: string;
    continuity_mode: 'limited' | 'halted';
  };
}

export function loadRecovery(configDir = resolveConfigDir()): RecoveryConfig {
  const raw = loadYamlFile(join(configDir, 'recovery.yaml')) as unknown as RecoveryConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة التعافي غير معلنة', 'CONFIG_NO_RECOVERY_POLICY');
  for (const [key, value] of [
    ['rto_seconds', policy.rto_seconds], ['rpo_seconds', policy.rpo_seconds],
    ['backup_interval_seconds', policy.backup_interval_seconds], ['retention_count', policy.retention_count],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد تعاف غير صالح: ${key}`, 'CONFIG_RECOVERY_VALUE');
    }
  }
  if (policy.backup_interval_seconds > policy.rpo_seconds) {
    throw new SovereignViolation(
      'فاصل النسخ أكبر من هدف فقد البيانات — وعد RPO غير قابل للتحقق',
      'CONFIG_RPO_UNREACHABLE',
    );
  }
  if (policy.verify_after_restore !== true) {
    throw new SovereignViolation(
      'التحقق بعد الاستعادة إلزامي ولا تقبل سياسة تعطلّه',
      'CONFIG_RECOVERY_VERIFY_REQUIRED',
    );
  }
  if (typeof policy.backup_directory !== 'string' || !policy.backup_directory.startsWith('/')) {
    throw new SovereignViolation('مجلد النسخ يجب أن يكون مسارا مطلقا معلنا', 'CONFIG_RECOVERY_DIRECTORY');
  }
  if (policy.continuity_mode !== 'limited' && policy.continuity_mode !== 'halted') {
    throw new SovereignViolation('وضع الاستمرارية يجب أن يكون limited أو halted', 'CONFIG_CONTINUITY_MODE');
  }
  return raw;
}
