/**
 * src/kernel/config/regions.ts — الأقاليم المعلنة
 * المالك: القيّم على المستودع | المرحلة: 24
 * المدخلات: config/regions.yaml | المخرجات: RegionsConfig
 * حالات الفشل: إقليم بلا حاكم أو نطاق مجهول ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/** تهيئة الأقاليم المعلنة (أُعلنت في المرحلة 2 وصارت مُلزمة في المرحلة 24) */
export interface RegionDeclaration {
  id: string;
  name: string;
  governor: string;
  autonomy_level: string;
}

export interface RegionsConfig {
  regions: RegionDeclaration[];
  collective_override_of_king: string;
}

/**
 * يحمّل الأقاليم المعلنة ويرفض أي تهيئة تخالف الثوابت السيادية.
 * سببه: قبل المرحلة 24 كان config/regions.yaml معلنًا ولا يقرؤه أحد — إعلان بلا أثر.
 * بعدها: لا يقوم إقليم إلا إن كان معرّفه معلنًا هنا (RULE-005 — لا توسّع من الداخل).
 */
export function loadRegions(configDir = resolveConfigDir()): RegionsConfig {
  const raw = loadYamlFile(join(configDir, 'regions.yaml')) as unknown as RegionsConfig;
  if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
    throw new SovereignViolation('لا أقاليم معلنة — لا اتحاد بلا إعلان', 'CONFIG_NO_REGIONS');
  }
  guardDeclaredCount('regions', raw.regions.length, 'أقاليمُ الاتحاد المعلنة');
  if (raw.collective_override_of_king !== 'forbidden') {
    throw new SovereignViolation(
      'نقض الأقاليم المجتمعة للملك ممنوع — السيادة غير قابلة للتجميع',
      'CONFIG_COLLECTIVE_OVERRIDE_ALLOWED',
    );
  }
  const seen = new Set<string>();
  for (const region of raw.regions) {
    if (typeof region.id !== 'string' || !region.id.startsWith('region:')) {
      throw new SovereignViolation('معرّف إقليم غير صالح', 'CONFIG_REGION_ID');
    }
    if (seen.has(region.id)) {
      throw new SovereignViolation(`إقليم مكرَّر: ${region.id}`, 'CONFIG_REGION_DUPLICATE');
    }
    seen.add(region.id);
    if (typeof region.name !== 'string' || region.name.trim().length < 3) {
      throw new SovereignViolation(`إقليم بلا اسم معلن: ${region.id}`, 'CONFIG_REGION_NO_NAME');
    }
    if (region.autonomy_level !== 'limited' && region.autonomy_level !== 'delegated') {
      throw new SovereignViolation(
        `مستوى استقلال غير معلن أو غير مسموح: ${region.id}`, 'CONFIG_REGION_AUTONOMY',
      );
    }
  }
  return raw;
}
