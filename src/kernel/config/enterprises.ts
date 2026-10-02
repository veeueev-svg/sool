/**
 * src/kernel/config/enterprises.ts — المنشآت الاقتصادية
 * المالك: القيّم على المستودع | المرحلة: 28
 * المدخلات: config/enterprises.yaml | المخرجات: EnterprisesConfig
 * حالات الفشل: منشأة بلا سقف أو بلا مالك معلن ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { guardDeclaredCount } from './declaration_limits';
import { loadExternal } from './external';
import { resolveConfigDir } from './paths';
import { loadQuotas } from './quotas';
import { loadYamlFile } from './yaml';

/** تهيئة المنشآت الاقتصادية (المرحلة 28) — config/enterprises.yaml */
export interface EnterprisesConfig {
  policy: {
    default: string; require_measured_inputs: boolean; require_budget_line: boolean;
    max_term_days: number; max_facilities_per_ministry: number;
    max_concurrent_runs: number; max_run_duration_hours: number;
    min_quality_score: number; waste_tolerance_per_mille: number;
    /** T-72: دفعاتٌ فوق التسامح تعلّق المنشأة آليًّا */
    waste_breaches_to_suspend: number;
    operator: string; inspector: string;
    suspend_authorities: string[];
  };
  quality_checks: Record<string, number>;
  materials: { id: string; name: string; unit: string; source: string }[];
  kinds: {
    id: string; name: string; sector: string;
    inputs: { material: string; quantity: number }[];
    output: { material: string; quantity: number };
    resource_cost: { resource: string; amount: number };
    required_checks: string[];
  }[];
}

/**
 * يحمّل إعلان المنشآت الاقتصادية ويرفض أي إعلان يفتح بابًا أوسع من الثوابت السيادية.
 * وأهمّ ما يتحقق منه — تنفيذًا للدرس المنقول من الجلسة 13 — أن **كل ثابت قابل للوقوع**:
 *   - مجموع أوزان فحوص كل نوع ≥ الحدّ الأدنى للجودة، وإلّا كان النوع إعلانًا ميتًا
 *     لا تنجح فيه دفعة أبدًا، ومراقبة الجودة فيه شعارًا لا حماية.
 *   - الحدّ الأدنى للجودة ≤ مجموع كل الأوزان المعلنة، وإلّا استحال القبول في كل نوع.
 *   - كلفة الموارد لكل نوع ≤ سقف الكيان الواحد في `config/quotas.yaml`، وإلّا رُفض
 *     كل تأجير فلا تعمل المنشأة ولو صحّ كل ما قبله.
 * ويتحقق تقاطعيًّا مع `config/external.yaml` أن مصدر كل مادة خارجية **نظير معلن**،
 * فلا تدخل مادة على اسم مذكور بل على قناة قائمة (ADR-0011 قرار 1).
 *
 * وأُضيف في T-75 حرسُ **عددِ ما يُعلن** لا صحّتِه وحدها: كل شرطٍ فيما سبق يفحص العنصرَ
 * الواحد، فتهيئةٌ بألفِ نوعٍ كلُّها صحيحةُ الشكل كانت **تمرّ بلا رفض** — والسقوفُ القائمة
 * (`max_facilities_per_ministry` وغيرُها) تحدّ العددَ **القائم** لا العددَ **المعلن**.
 * والسقوفُ في `declaration_limits.ts` لا هنا، لأنّ سقفًا يُعلن في الملف المحكوم يوسّعه
 * من يحكمه (RULE-005).
 */
export function loadEnterprises(configDir = resolveConfigDir()): EnterprisesConfig {
  const raw = loadYamlFile(join(configDir, 'enterprises.yaml')) as unknown as EnterprisesConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة المنشآت غير معلنة', 'CONFIG_NO_ENTERPRISES_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في المنشآت هو الرفض', 'CONFIG_ENTERPRISE_DEFAULT_ALLOW',
    );
  }
  // شرط القبول المعلن (T-69): لا إنتاج بلا مدخل مُقاس — ولا تُعطَّل هذه القاعدة بتهيئة
  if (policy.require_measured_inputs !== true) {
    throw new SovereignViolation(
      'المدخل المُقاس إلزامي — لا إنتاج بلا مدخل يُقاس',
      'CONFIG_ENTERPRISE_UNMEASURED_INPUTS',
    );
  }
  if (policy.require_budget_line !== true) {
    throw new SovereignViolation(
      'بند الموازنة إلزامي — لا منشأة بلا نفقة معلنة',
      'CONFIG_ENTERPRISE_NO_BUDGET_RULE',
    );
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days],
    ['max_facilities_per_ministry', policy.max_facilities_per_ministry],
    ['max_concurrent_runs', policy.max_concurrent_runs],
    ['max_run_duration_hours', policy.max_run_duration_hours],
    ['min_quality_score', policy.min_quality_score],
    ['waste_tolerance_per_mille', policy.waste_tolerance_per_mille],
    ['waste_breaches_to_suspend', policy.waste_breaches_to_suspend],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير معلنة أو غير صالحة في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_POLICY_VALUE',
      );
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation(
      'مدة المنشأة تتجاوز الحدّ المقبول — لا منشأة دائمة', 'CONFIG_ENTERPRISE_TERM',
    );
  }
  if (policy.waste_tolerance_per_mille >= 1000) {
    throw new SovereignViolation(
      'تسامح الفقد يبلغ المدخل كلّه — حدٌّ لا يقع', 'CONFIG_ENTERPRISE_WASTE_TOLERANCE',
    );
  }
  // RULE-004: من يشغّل لا يفتّش — يدان معلنتان لا يد واحدة
  for (const [key, value] of [
    ['operator', policy.operator], ['inspector', policy.inspector],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(
        `جهة غير معلنة بمعرّف نصّي في سياسة المنشآت (${key})`, 'CONFIG_ENTERPRISE_PARTY_ID',
      );
    }
  }
  if (policy.operator === policy.inspector) {
    throw new SovereignViolation(
      'المشغّل والمفتّش لا يكونان جهةً واحدة (RULE-004)', 'CONFIG_ENTERPRISE_ROLES_MERGED',
    );
  }
  if (!Array.isArray(policy.suspend_authorities) || policy.suspend_authorities.length === 0) {
    throw new SovereignViolation(
      'لا جهة تملك تعليق منشأة — حماية بلا يد تمارسها', 'CONFIG_ENTERPRISE_NO_SUSPENDERS',
    );
  }
  for (const who of policy.suspend_authorities) {
    if (typeof who !== 'string' || who.trim().length === 0) {
      throw new SovereignViolation(
        'جهة تعليق غير معلنة بمعرّف نصّي', 'CONFIG_ENTERPRISE_SUSPENDER_ID',
      );
    }
  }
  // T-72: التعليقُ الآليُّ بالهدر بيد المشغّل — فمشغّلٌ لا يملك التعليقَ يجعل الحدَّ وعدًا لا يُنفَّذ
  if (!policy.suspend_authorities.includes(policy.operator)) {
    throw new SovereignViolation(
      'المشغّلُ ليس جهةَ تعليقٍ معلنة — حدُّ الهدرِ لا يدَ تنفّذه', 'CONFIG_ENTERPRISE_WASTE_SUSPENDER',
    );
  }

  guardDeclaredCount(
    'suspend_authorities', policy.suspend_authorities.length, 'جهاتُ تعليق المنشآت المعلنة',
  );

  if (!raw.quality_checks || typeof raw.quality_checks !== 'object'
    || Object.keys(raw.quality_checks).length === 0) {
    throw new SovereignViolation(
      'لا فحوص جودة معلنة — لا مراقبة بلا مقياس معلن', 'CONFIG_ENTERPRISE_NO_CHECKS',
    );
  }
  guardDeclaredCount(
    'quality_checks', Object.keys(raw.quality_checks).length, 'فحوصُ الجودة المعلنة',
  );
  let weightTotal = 0;
  for (const [name, weight] of Object.entries(raw.quality_checks)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(
        `وزن فحص جودة غير صالح: ${name}`, 'CONFIG_ENTERPRISE_CHECK_WEIGHT',
      );
    }
    weightTotal += weight;
  }
  if (policy.min_quality_score > weightTotal) {
    throw new SovereignViolation(
      'الحدّ الأدنى للجودة يفوق مجموع كل الأوزان المعلنة — قبولٌ مستحيل',
      'CONFIG_ENTERPRISE_MIN_QUALITY_UNREACHABLE',
    );
  }

  if (!Array.isArray(raw.materials) || raw.materials.length === 0) {
    throw new SovereignViolation(
      'لا مواد معلنة — لا إنتاج بلا مادة معلنة', 'CONFIG_ENTERPRISE_NO_MATERIALS',
    );
  }
  guardDeclaredCount('materials', raw.materials.length, 'الموادُّ المعلنة');
  const external = loadExternal(configDir);
  const counterparties = new Set(external.counterparties.map((cp) => cp.id));
  const materials = new Map<string, { source: string }>();
  for (const material of raw.materials) {
    if (typeof material.id !== 'string' || !material.id.startsWith('material:')) {
      throw new SovereignViolation('معرّف مادة غير صالح', 'CONFIG_ENTERPRISE_MATERIAL_ID');
    }
    if (materials.has(material.id)) {
      throw new SovereignViolation(
        `مادة مكرَّرة: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_DUPLICATE',
      );
    }
    if (typeof material.name !== 'string' || material.name.trim().length < 3) {
      throw new SovereignViolation(
        `مادة بلا اسم: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_NAME',
      );
    }
    if (typeof material.unit !== 'string' || material.unit.trim().length === 0) {
      throw new SovereignViolation(
        `مادة بلا وحدة قياس: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_NO_UNIT',
      );
    }
    // RULE-005: المادة لا تُنشئ نظيرًا — النظير معلن في external.yaml وحده
    if (typeof material.source !== 'string'
      || (material.source !== 'internal' && !counterparties.has(material.source))) {
      throw new SovereignViolation(
        `مصدر مادة غير معلن: ${material.id}`, 'CONFIG_ENTERPRISE_MATERIAL_SOURCE',
      );
    }
    materials.set(material.id, { source: material.source });
  }

  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    throw new SovereignViolation(
      'لا أنواع منشآت معلنة — لا منشأة بلا إعلان', 'CONFIG_ENTERPRISE_NO_KINDS',
    );
  }
  guardDeclaredCount('enterprise_kinds', raw.kinds.length, 'أنواعُ المنشآت المعلنة');
  const quotas = loadQuotas(configDir);
  const kindIds = new Set<string>();
  for (const kind of raw.kinds) {
    if (typeof kind.id !== 'string' || !kind.id.startsWith('facility:')) {
      throw new SovereignViolation('معرّف نوع منشأة غير صالح', 'CONFIG_ENTERPRISE_KIND_ID');
    }
    if (kindIds.has(kind.id)) {
      throw new SovereignViolation(
        `نوع منشأة مكرَّر: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_DUPLICATE',
      );
    }
    kindIds.add(kind.id);
    if (typeof kind.name !== 'string' || kind.name.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا اسم: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_NAME',
      );
    }
    if (typeof kind.sector !== 'string' || kind.sector.trim().length < 3) {
      throw new SovereignViolation(
        `نوع منشأة بلا قطاع معلن: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_SECTOR',
      );
    }
    if (!Array.isArray(kind.inputs) || kind.inputs.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا مدخلات معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_INPUTS',
      );
    }
    const seenInputs = new Set<string>();
    for (const input of kind.inputs) {
      if (typeof input.material !== 'string' || !materials.has(input.material)) {
        throw new SovereignViolation(
          `مدخل من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_MATERIAL',
        );
      }
      if (seenInputs.has(input.material)) {
        throw new SovereignViolation(
          `مدخل مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_DUPLICATE',
        );
      }
      seenInputs.add(input.material);
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
        throw new SovereignViolation(
          `كمية مدخل غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_INPUT_QUANTITY',
        );
      }
    }
    if (!kind.output || typeof kind.output.material !== 'string'
      || !materials.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج من مادة غير معلنة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_MATERIAL',
      );
    }
    if (!Number.isSafeInteger(kind.output.quantity) || kind.output.quantity <= 0) {
      throw new SovereignViolation(
        `كمية مخرج غير مُقاسة: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_QUANTITY',
      );
    }
    // المادة المنتَجة داخليًّا مصدرها الدولة: لا يُدَّعى أن مصنعًا يُنتج مادةً خارجية
    if ((materials.get(kind.output.material) as { source: string }).source !== 'internal') {
      throw new SovereignViolation(
        `مخرج يُدَّعى إنتاجه ومصدره خارجي: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_EXTERNAL',
      );
    }
    if (seenInputs.has(kind.output.material)) {
      throw new SovereignViolation(
        `مخرج هو نفسه مدخل — إنتاجٌ يدّعي نفسه: ${kind.id}`, 'CONFIG_ENTERPRISE_OUTPUT_IS_INPUT',
      );
    }
    if (!kind.resource_cost || typeof kind.resource_cost.resource !== 'string'
      || !quotas.resources[kind.resource_cost.resource]) {
      throw new SovereignViolation(
        `كلفة مورد غير معلن في الحصص: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_UNDECLARED',
      );
    }
    if (!Number.isSafeInteger(kind.resource_cost.amount) || kind.resource_cost.amount <= 0) {
      throw new SovereignViolation(
        `كلفة مورد غير صالحة: ${kind.id}`, 'CONFIG_ENTERPRISE_RESOURCE_AMOUNT',
      );
    }
    // ثابت قابل للوقوع: كلفة تفوق سقف الكيان الواحد تجعل كل تأجير مرفوضًا ⇒ نوعٌ ميت
    const spec = quotas.resources[kind.resource_cost.resource] as {
      per_agent_max: number;
    };
    if (kind.resource_cost.amount > spec.per_agent_max) {
      throw new SovereignViolation(
        `كلفة المورد تفوق سقف الكيان الواحد — منشأة لا تعمل أبدًا: ${kind.id}`,
        'CONFIG_ENTERPRISE_RESOURCE_OVER_ENTITY_MAX',
      );
    }
    if (!Array.isArray(kind.required_checks) || kind.required_checks.length === 0) {
      throw new SovereignViolation(
        `نوع منشأة بلا فحوص جودة: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_NO_CHECKS',
      );
    }
    const seenChecks = new Set<string>();
    let kindWeight = 0;
    for (const check of kind.required_checks) {
      if (typeof check !== 'string' || raw.quality_checks[check] === undefined) {
        throw new SovereignViolation(
          `فحص جودة غير معلن في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_UNDECLARED',
        );
      }
      if (seenChecks.has(check)) {
        throw new SovereignViolation(
          `فحص جودة مكرَّر في النوع: ${kind.id}`, 'CONFIG_ENTERPRISE_KIND_CHECK_DUPLICATE',
        );
      }
      seenChecks.add(check);
      kindWeight += raw.quality_checks[check] as number;
    }
    // الدرس المنقول من الجلسة 13: ثابتٌ لا يقع ليس حماية بل شعار
    if (kindWeight < policy.min_quality_score) {
      throw new SovereignViolation(
        `مجموع أوزان فحوص النوع لا يبلغ الحدّ الأدنى — نوعٌ لا تنجح فيه دفعة: ${kind.id}`,
        'CONFIG_ENTERPRISE_KIND_QUALITY_UNREACHABLE',
      );
    }
  }
  return raw;
}
