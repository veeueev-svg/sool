/**
 * src/kernel/config/royal_authority.ts — سلطة التاج
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: config/royal-authority.yaml | المخرجات: RoyalAuthorityConfig
 * حالات الفشل: ملكان أو مسار جانبي مسموح أو فعل سيادي مجهول ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { KNOWN_SOVEREIGN_ACTIONS, SovereignAction, SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

export interface RoyalAuthorityConfig {
  state_name: string;
  state_code: string;
  king_count_max: number;
  king_id: string;
  crown_gateway_required: boolean;
  side_channel_allowed: boolean;
  heartbeat_interval_seconds: number;
  absence_grace_seconds: number;
  absence_mode: string;
  /**
   * الأفعال السيادية المعلنة — **ملزمة لا وصفية** (المرحلة 28): البوابة تُبنى منها،
   * ولذلك نوعها `SovereignAction` لا `string`: يضمنه تحقق `loadRoyalAuthority` عند
   * التحميل (فشل مغلق على أي فعل مجهول)، فلا يدخل النوع اسمٌ لم تُعلنه الشفرة.
   */
  sovereign_actions: SovereignAction[];
  veto_final: boolean;
}

/** يحمّل سلطة التاج ويرفض أي تهيئة تخالف الثوابت السيادية */
export function loadRoyalAuthority(configDir = resolveConfigDir()): RoyalAuthorityConfig {
  const raw = loadYamlFile(join(configDir, 'royal-authority.yaml')) as unknown as RoyalAuthorityConfig;
  if (!raw.king_id) throw new SovereignViolation('لا يوجد ملك معرّف', 'CONFIG_NO_KING');
  if (raw.king_count_max !== 1) {
    throw new SovereignViolation('لا يجوز أكثر من ملك واحد', 'CONFIG_MULTIPLE_KINGS');
  }
  if (raw.crown_gateway_required !== true) {
    throw new SovereignViolation('بوابة التاج إلزامية', 'CONFIG_GATEWAY_OPTIONAL');
  }
  if (raw.side_channel_allowed !== false) {
    throw new SovereignViolation('المسار الجانبي ممنوع', 'CONFIG_SIDE_CHANNEL');
  }
  if (raw.veto_final !== true) {
    throw new SovereignViolation('النقض الملكي نهائي', 'CONFIG_VETO_NOT_FINAL');
  }
  // المرحلة 28: قائمة الأفعال السيادية صارت **ملزمة** لا وصفًا: البوابة تقرأ منها،
  // فوجب أن تُرفض قائمةٌ فيها فعلٌ مجهول (فلا يُفتح بابٌ باسم لا تعرفه الدولة)
  // أو فيها تكرار أو لا شيء (فلا تقوم دولةٌ لا فعل سيادي فيها أصلًا) — فشل مغلق.
  if (!Array.isArray(raw.sovereign_actions) || raw.sovereign_actions.length === 0) {
    throw new SovereignViolation(
      'لا أفعال سيادية معلنة — لا سيادة بلا فعل معلن', 'CONFIG_NO_SOVEREIGN_ACTIONS',
    );
  }
  const seenActions = new Set<string>();
  for (const action of raw.sovereign_actions) {
    if (typeof action !== 'string' || !(KNOWN_SOVEREIGN_ACTIONS as readonly string[]).includes(action)) {
      throw new SovereignViolation(
        `فعل سيادي مجهول في التهيئة: ${String(action)}`, 'CONFIG_UNKNOWN_SOVEREIGN_ACTION',
      );
    }
    if (seenActions.has(action)) {
      throw new SovereignViolation(
        `فعل سيادي مكرّر في التهيئة: ${action}`, 'CONFIG_DUPLICATE_SOVEREIGN_ACTION',
      );
    }
    seenActions.add(action);
  }
  return raw;
}
