/**
 * src/kernel/config/contracts.ts — العقود الخارجية
 * المالك: القيّم على المستودع | المرحلة: 27
 * المدخلات: config/contracts.yaml | المخرجات: ContractsConfig
 * حالات الفشل: عقد بلا مهلة أو بلا مخرج إنهاء ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { loadExternal } from './external';
import { guardDeclaredCount } from './declaration_limits';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** تهيئة العقود الخارجية (المرحلة 27) — config/contracts.yaml */
export interface ContractsConfig {
  policy: {
    default: string; require_end_date: boolean; max_term_days: number;
    termination: string; termination_requires_royal_command: boolean;
    termination_suspends_account: boolean; settlement_window_hours: number;
    max_risk_score: number; review_interval_days: number; breach_penalty: number;
    max_open_per_counterparty: number;
    proposer: string; assessor: string; settler: string;
  };
  kinds: {
    id: string; name: string; counterparty: string; purpose: string;
    max_value: number; risk_weight: number;
  }[];
  risk_factors: Record<string, number>;
}

/**
 * يحمّل أنواع العقود الخارجية المعلنة ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * سببه: العقد أخطر من الدفعة — الدفعة تقع مرة، والعقد يُلزم الدولة زمنًا ويُنشئ اعتمادًا.
 * ويتحقق تقاطعيًّا مع config/external.yaml أن كل نوع عقد لنظير **معلن**، وأن مجموع قيم
 * أنواع العقود لنظير واحد **لا يتجاوز سقفه الكلي** — فلا يُتعهَّد بعقد لا تحمله قناته.
 */
export function loadContracts(configDir = resolveConfigDir()): ContractsConfig {
  const raw = loadYamlFile(join(configDir, 'contracts.yaml')) as unknown as ContractsConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة العقود الخارجية غير معلنة', 'CONFIG_NO_CONTRACTS_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في العقود الخارجية هو الرفض', 'CONFIG_CONTRACT_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (المرحلة 27): لا عقد بلا تاريخ انتهاء — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_end_date !== true) {
    throw new SovereignViolation(
      'تاريخ الانتهاء إلزامي في كل عقد خارجي — لا عقد دائم',
      'CONFIG_CONTRACT_NO_END_DATE_RULE',
    );
  }
  if (policy.termination !== 'immediate') {
    throw new SovereignViolation(
      'الإنهاء يجب أن يكون فوريًّا — عقد "سيُنهى" عقدٌ قائم',
      'CONFIG_CONTRACT_TERMINATION_DELAYED',
    );
  }
  if (policy.termination_requires_royal_command !== true) {
    throw new SovereignViolation(
      'الإنهاء بأمر ملكي — إسقاط التزام معلن ليس فعل موظّف',
      'CONFIG_CONTRACT_TERMINATION_WITHOUT_KING',
    );
  }
  if (policy.termination_suspends_account !== true) {
    throw new SovereignViolation(
      'الإنهاء يقطع قناة المال — لا عقد مُنهًى وقناته مفتوحة',
      'CONFIG_CONTRACT_TERMINATION_LEAVES_CHANNEL',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['settlement_window_hours', policy.settlement_window_hours],
    ['max_risk_score', policy.max_risk_score],
    ['review_interval_days', policy.review_interval_days],
    ['breach_penalty', policy.breach_penalty],
    ['max_open_per_counterparty', policy.max_open_per_counterparty],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة العقود (${key})`, 'CONFIG_CONTRACT_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة العقد الخارجي تتجاوز الحدّ المقبول — لا عقد دائم', 'CONFIG_CONTRACT_TERM',
    );
  }
  // RULE-004: من يقترح لا يقدّر ولا يسوّي — ثلاث أيدٍ معلنة لا يد واحدة
  for (const [key, value] of [
    ['proposer', policy.proposer], ['assessor', policy.assessor], ['settler', policy.settler],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة العقود (${key})`, 'CONFIG_CONTRACT_PARTY_ID',
      );
    }
  }
  if (policy.proposer === policy.assessor || policy.proposer === policy.settler
    || policy.assessor === policy.settler) {
    throw new SovereignViolation(
      'المقترح والمقدِّر والمسوِّي لا يكونون جهةً واحدة (RULE-004)',
      'CONFIG_CONTRACT_ROLES_MERGED',
    );
  }
  if (!raw.risk_factors || typeof raw.risk_factors !== 'object'
    || Object.keys(raw.risk_factors).length === 0) {
    throw new SovereignViolation(
      'لا عوامل مخاطر معلنة — لا تقدير بلا مقياس معلن', 'CONFIG_CONTRACT_NO_RISK_FACTORS',
    );
  }
  guardDeclaredCount(
    'contract_risk_factors', Object.keys(raw.risk_factors).length, 'عواملُ مخاطر العقود المعلنة',
  );
  for (const [name, weight] of Object.entries(raw.risk_factors)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن عامل مخاطر غير صالح: ${name}`, 'CONFIG_CONTRACT_RISK_WEIGHT',
      );
    }
  }
  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع عقود معلنة — لا عقد بلا إعلان', 'CONFIG_CONTRACT_NO_KINDS',
    );
  }
  guardDeclaredCount('contract_kinds', raw.kinds.length, 'أنواعُ العقود المعلنة');

  const external = loadExternal(configDir);
  const caps = new Map<string, number>();
  for (const cp of external.counterparties) caps.set(cp.id, cp.total_cap);
  const ids = new Set<string>();
  const committed = new Map<string, number>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('contract:')) {
      throw new SovereignViolation('معرّف نوع عقد غير صالح', 'CONFIG_CONTRACT_KIND_ID');
    }
    if (ids.has(kind.id)) {
      throw new SovereignViolation(`نوع عقد مكرَّر: ${kind.id}`, 'CONFIG_CONTRACT_KIND_DUPLICATE');
    }
    ids.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا اسم: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_NAME');
    }
    if (typeof kind.purpose !== 'string' || kind.purpose.trim().length < 3) {
      throw new SovereignViolation(`نوع عقد بلا غرض: ${kind.id}`, 'CONFIG_CONTRACT_KIND_NO_PURPOSE');
    }
    // RULE-005: العقد لا يُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof kind.counterparty !== 'string' || !caps.has(kind.counterparty)) {
      throw new SovereignViolation(
        `نوع عقد لنظير غير معلن: ${kind.id}`, 'CONFIG_CONTRACT_UNDECLARED_COUNTERPARTY',
      );
    }
    if (!Number.isSafeInteger(kind.max_value) || kind.max_value <= 0) {
      throw new SovereignViolation(
        `سقف قيمة غير معلن أو غير صالح: ${kind.id}`, 'CONFIG_CONTRACT_KIND_VALUE',
      );
    }
    if (!Number.isSafeInteger(kind.risk_weight) || kind.risk_weight <= 0) {
      throw new SovereignViolation(
        `وزن مخاطر غير معلن للنوع: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK',
      );
    }
    // لا يُوقَّع نوع عقد لا يمكن أن يُوقَّع أصلًا: وزن يفوق السقف يعني إعلانًا ميتًا
    if (kind.risk_weight > policy.max_risk_score) {
      throw new SovereignViolation(
        `وزن مخاطر النوع يفوق سقف الدرجة المعلن: ${kind.id}`, 'CONFIG_CONTRACT_KIND_RISK_OVER_MAX',
      );
    }
    const total = (committed.get(kind.counterparty) ?? 0) + kind.max_value;
    committed.set(kind.counterparty, total);
    if (total > (caps.get(kind.counterparty) as number)) {
      throw new SovereignViolation(
        `مجموع قيم عقود النظير يتجاوز سقفه الكلي: ${kind.counterparty}`,
        'CONFIG_CONTRACT_OVER_COUNTERPARTY_CAP',
      );
    }
  }
  return raw;
}
