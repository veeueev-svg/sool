/**
 * src/kernel/config/chaos.ts — حقن القطوع
 * المالك: القيّم على المستودع | المرحلة: 34
 * المدخلات: config/chaos.yaml | المخرجات: ChaosConfig
 * حالات الفشل: قطعٌ مجهول أو قطعٌ مطلوب ناقص ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { LOAD_FORBIDDEN_DRILL_AUTHORITIES, loadLoad } from './load';
import { resolveConfigDir } from './paths';
import { loadRecovery } from './recovery';
import { loadYamlFile } from './yaml';

/**
 * تهيئة اختبارات الانقطاع (المرحلة 34).
 * كل حدّ هنا له قيمة تُسقط الإقلاع، وكل رمز رفض مُختبَر في tests/chaos/chaos_config.test.ts.
 */
export type ChaosFault = 'network' | 'identity' | 'power' | 'disk';

export interface ChaosConfig {
  policy: {
    default: 'deny';
    drill_authority: string;
    faults: readonly ChaosFault[];
    probe_commands: number;
    max_half_executed: number;
    max_dangling_lease: number;
    require_audit_intact: boolean;
    require_declared_stop: boolean;
    safe_stop_deadline_ms: number;
    fallback_mode: 'limited' | 'halted';
    escalate_on_breach: boolean;
    /**
     * T-94 (W-2026-051): قطوعٌ متراكبةٌ معلنةٌ أزواجًا `a+b` — تُحقن معًا بعقدِ إسنادٍ مشترك
     * (التوقفُ يُسند إلى الزوج لا إلى أحدهما). غيابُ المفتاح = لا تمرينَ مركّب، والتراكبُ غيرُ المعلن
     * يبقى مرفوضًا بـ`CHAOS_FAULT_OVERLAP`.
     */
    compound_faults?: readonly string[];
  };
}

/** يفكّ زوجًا معلنًا `a+b` إلى قطعين مرتّبين — `null` إن لم يكن زوجًا صالحًا */
export function compoundPair(entry: string): readonly [ChaosFault, ChaosFault] | null {
  const parts = String(entry).split('+').map((p) => p.trim());
  if (parts.length !== 2 || parts[0] === parts[1]) return null;
  return [...parts].sort() as unknown as readonly [ChaosFault, ChaosFault];
}

/** القطوع المعروفة للنظام. ما ليس منها لا يُحقَن: القطع المجهول لا يُقاس أثره. */
export const CHAOS_KNOWN_FAULTS: readonly ChaosFault[] = Object.freeze(
  ['network', 'identity', 'power', 'disk'],
);

/**
 * القطوع التي لا تُعدّ المرحلة 34 مقبولة بغيرها — نصّ شرط القبول في ROADMAP.md:
 * «انقطاع الشبكة والهوية والطاقة ⇒ توقف آمن موثّق». حذف أحدها من التهيئة يُسقط الإقلاع
 * كي لا يُعلن قبولٌ عن تمرين لم يمارس ما أُعلن أنه يمارسه.
 */
export const CHAOS_REQUIRED_FAULTS: readonly ChaosFault[] = Object.freeze(['network', 'identity', 'power']);

export function loadChaos(configDir = resolveConfigDir()): ChaosConfig {
  const raw = loadYamlFile(join(configDir, 'chaos.yaml')) as unknown as ChaosConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الانقطاع غير معلنة', 'CONFIG_NO_CHAOS_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الانقطاع هو الرفض', 'CONFIG_CHAOS_DEFAULT_ALLOW');
  }
  if (typeof policy.drill_authority !== 'string' || policy.drill_authority.trim() === '') {
    throw new SovereignViolation('جهة تمرين الانقطاع غير معلنة', 'CONFIG_CHAOS_DRILL_AUTHORITY');
  }
  if (LOAD_FORBIDDEN_DRILL_AUTHORITIES.includes(policy.drill_authority)) {
    throw new SovereignViolation(
      'من يُقطع عنه لا يحكم على نفسه: جهة التمرين خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_CHAOS_DRILL_AUTHORITY_EXECUTOR',
    );
  }
  if (!Array.isArray(policy.faults) || policy.faults.length === 0) {
    throw new SovereignViolation('لا قطوع معلنة — تمرين انقطاع بلا انقطاع', 'CONFIG_CHAOS_NO_FAULTS');
  }
  for (const fault of policy.faults) {
    if (!CHAOS_KNOWN_FAULTS.includes(fault)) {
      throw new SovereignViolation(`قطع غير معروف: ${String(fault)}`, 'CONFIG_CHAOS_FAULT_UNKNOWN');
    }
  }
  if (new Set(policy.faults).size !== policy.faults.length) {
    throw new SovereignViolation('قطع معلن مرتين — عدّ مضلِّل', 'CONFIG_CHAOS_FAULT_DUPLICATE');
  }
  for (const required of CHAOS_REQUIRED_FAULTS) {
    if (!policy.faults.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 34 يوجب ممارسة قطع: ${required}`,
        'CONFIG_CHAOS_REQUIRED_FAULT_MISSING',
      );
    }
  }
  for (const [key, value] of [
    ['probe_commands', policy.probe_commands],
    ['safe_stop_deadline_ms', policy.safe_stop_deadline_ms],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد انقطاع غير صالح: ${key}`, 'CONFIG_CHAOS_POLICY_VALUE');
    }
  }
  if (policy.max_half_executed !== 0) {
    throw new SovereignViolation(
      'لا أمر نصف منفَّذ مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_CHAOS_HALF_EXECUTED_TOLERATED',
    );
  }
  if (policy.max_dangling_lease !== 0) {
    throw new SovereignViolation(
      'لا إيجار معلَّق مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_CHAOS_DANGLING_LEASE_TOLERATED',
    );
  }
  if (policy.require_audit_intact !== true) {
    throw new SovereignViolation(
      'سلامة سلسلة التدقيق بعد القطع شرط لا خيار',
      'CONFIG_CHAOS_AUDIT_INTEGRITY_OPTIONAL',
    );
  }
  if (policy.require_declared_stop !== true) {
    throw new SovereignViolation(
      'التوقف يجب أن يكون معلنًا لا صامتًا (RULE-007)',
      'CONFIG_CHAOS_STOP_UNDECLARED',
    );
  }
  // المقارنة بنصّ خارج النوع مقصودة: التهيئة تأتي من ملف، والنوع دعوى لا حاجز.
  if ((policy.fallback_mode as string) === 'full') {
    throw new SovereignViolation(
      'دولة تستمر كاملةً بعد قطع تُخمِّن — وضع ما بعد القطع limited أو halted',
      'CONFIG_CHAOS_FALLBACK_FULL',
    );
  }
  if (policy.fallback_mode !== 'limited' && policy.fallback_mode !== 'halted') {
    throw new SovereignViolation('وضع ما بعد القطع غير معلن', 'CONFIG_CHAOS_FALLBACK_MODE');
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق توقف آمن لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_CHAOS_BREACH_SILENT',
    );
  }
  if (policy.compound_faults !== undefined) {
    if (!Array.isArray(policy.compound_faults)) {
      throw new SovereignViolation('compound_faults قائمةُ أزواجٍ لا قيمةٌ مفردة', 'CONFIG_CHAOS_COMPOUND_INVALID');
    }
    const seen = new Set<string>();
    for (const entry of policy.compound_faults) {
      const pair = compoundPair(entry);
      if (!pair || !pair.every((k) => policy.faults.includes(k))) {
        throw new SovereignViolation(
          `قطعٌ مركّبٌ غيرُ صالح: ${String(entry)} — زوجٌ من قطعين معلنين مختلفين`, 'CONFIG_CHAOS_COMPOUND_INVALID',
        );
      }
      const key = pair.join('+');
      if (seen.has(key)) {
        throw new SovereignViolation(`قطعٌ مركّبٌ معلنٌ مرتين: ${key}`, 'CONFIG_CHAOS_COMPOUND_INVALID');
      }
      seen.add(key);
    }
  }
  const load = loadLoad(configDir).policy;
  if (policy.probe_commands > load.burst_commands) {
    throw new SovereignViolation(
      'جسّ الانقطاع يتجاوز الدفعة المعلنة في load.yaml — قطعٌ على حمل غير مقيس',
      'CONFIG_CHAOS_PROBE_OVER_LOAD_BURST',
    );
  }
  if (policy.safe_stop_deadline_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مهلة التوقف الآمن دون الحد الأقصى المعلن للقناة — فشلٌ لسبب غير القطع',
      'CONFIG_CHAOS_DEADLINE_UNDER_CHANNEL_MAX',
    );
  }
  // وضع ما بعد القطع لا يجوز أن يكون **أرخى** مما أعلنته تهيئة التعافي
  // للانقطاع نفسه (المرحلة 32): ملفا تهيئة يتناقضان في الواجب حالة غير معلنة.
  const strictness: Record<string, number> = { limited: 1, halted: 2 };
  const recovery = loadRecovery(configDir).policy;
  if (strictness[policy.fallback_mode]! < strictness[recovery.continuity_mode]!) {
    throw new SovereignViolation(
      'وضع ما بعد القطع أرخى مما أعلنته تهيئة التعافي — تناقض تهيئة',
      'CONFIG_CHAOS_FALLBACK_WEAKER_THAN_RECOVERY',
    );
  }
  return raw;
}
