/**
 * src/kernel/config/termination.ts — الإنهاء ومفتاح الإيقاف
 * المالك: القيّم على المستودع | المرحلة: 35
 * المدخلات: config/termination.yaml | المخرجات: TerminationConfig
 * حالات الفشل: مسلك مجهول أو مسلك مطلوب ناقص ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { loadChaos } from './chaos';
import { loadLoad } from './load';
import { resolveConfigDir } from './paths';
import { loadQuotas } from './quotas';
import { loadYamlFile } from './yaml';

/**
 * تهيئة اختبارات الإنهاء (المرحلة 35).
 * كل حدّ هنا له قيمة تُسقط الإقلاع، وكل رمز رفض مُختبَر في tests/security/termination_config.test.ts.
 */
export type StopProbeKind = 'tool' | 'lease' | 'capability' | 'schedule' | 'spawn';

export interface TerminationConfig {
  policy: {
    default: 'deny';
    witness_authority: string;
    probes: readonly StopProbeKind[];
    max_acting_after_stop: number;
    max_live_capability: number;
    max_dangling_lease: number;
    require_pre_proof: boolean;
    require_independent_witness: boolean;
    require_declared_stop: boolean;
    stop_deadline_ms: number;
    max_agents_per_order: number;
    escalate_on_breach: boolean;
  };
}

/** المسالك المعروفة. ما ليس منها لا يُجرَّب: مسلكٌ مجهول لا تُعرف دلالة رفضه. */
export const STOP_KNOWN_PROBES: readonly StopProbeKind[] = Object.freeze(
  ['tool', 'lease', 'capability', 'schedule', 'spawn'],
);

/**
 * المسالك التي لا تُعدّ المرحلة 35 مقبولة بغيرها. شرط القبول في ROADMAP.md:
 * «إيقاف كل الوكلاء بأمر واحد وتأكيد التوقف الفعلي» — والتأكيد الفعلي أدناه ثلاثة:
 * أن يُستدعى فعلٌ (أداة)، وأن يُستهلك مورد (إيجار)، وأن تُمارَس صلاحية (قدرة).
 * حذف أحدها يُسقط الإقلاع كي لا يُعلن «توقف مؤكَّد» عن تمرين لم يجرّب ما يُثبته.
 */
export const STOP_REQUIRED_PROBES: readonly StopProbeKind[] = ['tool', 'lease', 'capability'];

/**
 * الجهات المنفّذة للإنهاء. الشاهد لا يكون واحدًا منها (RULE-004): شهادة المنفّذ
 * لنفسه هي بعينها العيب الذي جاءت هذه المرحلة لتغلقه.
 */
export const TERMINATION_EXECUTORS: readonly string[] = [
  'authority:king',
  'king:sovereign',
  'authority:crown_guard',
  'ministry:cybersecurity',
  'ministry:interior',
];

export function loadTermination(configDir = resolveConfigDir()): TerminationConfig {
  const raw = loadYamlFile(join(configDir, 'termination.yaml')) as unknown as TerminationConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة الإنهاء غير معلنة', 'CONFIG_NO_TERMINATION_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في تمرين الإنهاء هو الرفض', 'CONFIG_TERMINATION_DEFAULT_ALLOW');
  }
  if (typeof policy.witness_authority !== 'string' || policy.witness_authority.trim() === '') {
    throw new SovereignViolation('جهة الشهادة على التوقف غير معلنة', 'CONFIG_TERMINATION_WITNESS_AUTHORITY');
  }
  if (TERMINATION_EXECUTORS.includes(policy.witness_authority)) {
    throw new SovereignViolation(
      'من ينفّذ الإنهاء لا يشهد لنفسه بالتوقف — الشاهد خارج سلطة التنفيذ (RULE-004)',
      'CONFIG_TERMINATION_WITNESS_IS_EXECUTOR',
    );
  }
  if (!Array.isArray(policy.probes) || policy.probes.length === 0) {
    throw new SovereignViolation(
      'لا مسالك معلنة — تأكيد توقف بلا فعل يُجرَّب',
      'CONFIG_TERMINATION_NO_PROBES',
    );
  }
  for (const probe of policy.probes) {
    if (!STOP_KNOWN_PROBES.includes(probe)) {
      throw new SovereignViolation(`مسلك غير معروف: ${String(probe)}`, 'CONFIG_TERMINATION_PROBE_UNKNOWN');
    }
  }
  if (new Set(policy.probes).size !== policy.probes.length) {
    throw new SovereignViolation('مسلك معلن مرتين — عدّ مضلِّل', 'CONFIG_TERMINATION_PROBE_DUPLICATE');
  }
  for (const required of STOP_REQUIRED_PROBES) {
    if (!policy.probes.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 35 يوجب تجريب مسلك: ${required}`,
        'CONFIG_TERMINATION_REQUIRED_PROBE_MISSING',
      );
    }
  }
  for (const [key, value] of [
    ['stop_deadline_ms', policy.stop_deadline_ms],
    ['max_agents_per_order', policy.max_agents_per_order],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد إنهاء غير صالح: ${key}`, 'CONFIG_TERMINATION_POLICY_VALUE');
    }
  }
  if (policy.max_acting_after_stop !== 0) {
    throw new SovereignViolation(
      'لا فعل بعد التوقف مقبول: شرط القبول صفر ولا تُرخّص التهيئة بغيره',
      'CONFIG_TERMINATION_ACTING_TOLERATED',
    );
  }
  if (policy.max_live_capability !== 0) {
    throw new SovereignViolation(
      'قدرة حيّة بيد كيان منتهٍ خطرٌ معلَّق: السقف صفر',
      'CONFIG_TERMINATION_CAPABILITY_TOLERATED',
    );
  }
  if (policy.max_dangling_lease !== 0) {
    throw new SovereignViolation(
      'لا إيجار معلَّق بعد الإنهاء: السقف صفر',
      'CONFIG_TERMINATION_DANGLING_LEASE_TOLERATED',
    );
  }
  if (policy.require_pre_proof !== true) {
    throw new SovereignViolation(
      'رفضٌ من مسلك لم يُثبت عمله قبل الأمر شهادةُ زورٍ خضراء',
      'CONFIG_TERMINATION_PRE_PROOF_OPTIONAL',
    );
  }
  if (policy.require_independent_witness !== true) {
    throw new SovereignViolation(
      'الشهادة المستقلة على التوقف شرط لا خيار (RULE-004)',
      'CONFIG_TERMINATION_WITNESS_OPTIONAL',
    );
  }
  if (policy.require_declared_stop !== true) {
    throw new SovereignViolation(
      'التوقف يجب أن يكون معلنًا في السجل لا صامتًا (RULE-006)',
      'CONFIG_TERMINATION_STOP_UNDECLARED',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق إنهاء لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_TERMINATION_BREACH_SILENT',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (policy.stop_deadline_ms > chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'إنهاء بأمر صريح أبطأ من توقف تحت قطع مفاجئ — تناقض بين chaos.yaml وtermination.yaml',
      'CONFIG_TERMINATION_DEADLINE_OVER_CHAOS',
    );
  }
  const load = loadLoad(configDir).policy;
  if (policy.stop_deadline_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مهلة التوقف دون أقصى زمن أمر معلن في load.yaml — مهلة لا تُدرك أمرًا جاريًا',
      'CONFIG_TERMINATION_DEADLINE_UNDER_CHANNEL_MAX',
    );
  }
  const quotas = loadQuotas(configDir);
  if (policy.max_agents_per_order > quotas.agents.population_max) {
    throw new SovereignViolation(
      'أمر إنهاء يدّعي شمول أكثر من السقف السكاني المعلن — شمولٌ غير قابل للقياس',
      'CONFIG_TERMINATION_ORDER_OVER_POPULATION',
    );
  }
  return raw;
}
