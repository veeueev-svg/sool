/**
 * src/kernel/config/quotas.ts — الحصص والموارد
 * المالك: القيّم على المستودع | المرحلة: 5
 * المدخلات: config/quotas.yaml | المخرجات: QuotasConfig
 * حالات الفشل: قيمة ناقصة أو سالبة ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/** تهيئة الحصص والموارد (المرحلة 5) */
export interface QuotasConfig {
  resources: Record<string, { total: number; per_agent_max: number; lease_seconds: number }>;
  agents: { population_max: number; spawn_rate_per_minute: number };
}

/** يحمّل الحصص ويرفض أي تهيئة ناقصة أو سالبة — فشل مغلق (RULE-007) */
export function loadQuotas(configDir = resolveConfigDir()): QuotasConfig {
  const raw = loadYamlFile(join(configDir, 'quotas.yaml')) as unknown as QuotasConfig;
  if (!raw.resources || Object.keys(raw.resources).length === 0) {
    throw new SovereignViolation('لا موارد معلنة — لا تشغيل بلا حصص', 'CONFIG_NO_RESOURCES');
  }
  guardDeclaredCount('quota_resources', Object.keys(raw.resources).length, 'مواردُ الحصص المعلنة');
  for (const [name, spec] of Object.entries(raw.resources)) {
    if (typeof spec.total !== 'number' || typeof spec.per_agent_max !== 'number'
      || typeof spec.lease_seconds !== 'number') {
      throw new SovereignViolation(`تهيئة مورد ناقصة: ${name}`, 'CONFIG_RESOURCE_INCOMPLETE');
    }
    if (spec.per_agent_max > spec.total) {
      throw new SovereignViolation(`سقف الكيان يتجاوز السقف الكلي: ${name}`, 'CONFIG_RESOURCE_OVER_TOTAL');
    }
  }
  if (!raw.agents || typeof raw.agents.population_max !== 'number' || raw.agents.population_max < 0) {
    throw new SovereignViolation('سقف السكان غير معلن', 'CONFIG_NO_POPULATION_MAX');
  }
  return raw;
}
