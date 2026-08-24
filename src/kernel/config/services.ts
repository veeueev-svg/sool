/**
 * src/kernel/config/services.ts — المستشفيات والمختبرات
 * المالك: القيّم على المستودع | المرحلة: 29
 * المدخلات: config/services.yaml | المخرجات: ServicesConfig
 * حالات الفشل: خدمة بلا وضع معلن أو بلا حدّ سلامة ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/** تهيئة المستشفيات والمختبرات البرمجية (المرحلة 29) — config/services.yaml */
export type DeclaredServiceMode = 'full' | 'limited' | 'halted';

export interface ServicesConfig {
  policy: {
    default: string; max_term_days: number; max_services_per_ministry: number;
    service_operator: string; quality_inspector: string; recovery_verifier: string;
    beneficiary_prefix: string; mode_order: DeclaredServiceMode[]; min_quality_score: number;
  };
  sources: { id: string; name: string }[];
  services: {
    id: string; name: string; kind: string; ministry: string;
    modes: Record<DeclaredServiceMode, { required_sources: string[] | null }>;
    operations: { id: string; minimum_mode: string; required_sources: string[] }[];
  }[];
  quality_checks: Record<string, number>;
}

/**
 * يحمّل سياسة الخدمات الحرجة، ويرفض الوضع الرابع والحدود الميتة قبل أن تقوم خدمة واحدة.
 * المستشفى والمختبر هنا وحدات برمجية للوكلاء `agent:*`، لا بشر ولا بيانات شخصية (DIRECTIVES §6).
 */
export function loadServices(configDir = resolveConfigDir()): ServicesConfig {
  const raw = loadYamlFile(join(configDir, 'services.yaml')) as unknown as ServicesConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في الخدمات الحرجة هو الرفض', 'CONFIG_SERVICES_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['max_term_days', policy.max_term_days], ['max_services_per_ministry', policy.max_services_per_ministry],
    ['min_quality_score', policy.min_quality_score],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حدّ خدمات غير معلن أو غير صالح (${key})`, 'CONFIG_SERVICES_POLICY_VALUE');
    }
  }
  if (policy.max_term_days > 365) {
    throw new SovereignViolation('مدة الخدمة تتجاوز سنة — لا خدمة دائمة', 'CONFIG_SERVICES_TERM');
  }
  for (const [key, value] of [
    ['service_operator', policy.service_operator], ['quality_inspector', policy.quality_inspector],
    ['recovery_verifier', policy.recovery_verifier], ['beneficiary_prefix', policy.beneficiary_prefix],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(`معرّف خدمات غير معلن (${key})`, 'CONFIG_SERVICES_PARTY_ID');
    }
  }
  if (policy.beneficiary_prefix !== 'agent:') {
    throw new SovereignViolation('المستفيدون وكلاء agent:* فقط — لا بشر في الخدمة', 'CONFIG_SERVICES_BENEFICIARY_SCOPE');
  }
  if (policy.service_operator === policy.quality_inspector
    || policy.service_operator === policy.recovery_verifier) {
    throw new SovereignViolation('المشغّل لا يفتّش ولا يرفع الخدمة بيده (RULE-004)', 'CONFIG_SERVICES_ROLES_MERGED');
  }
  const requiredOrder: DeclaredServiceMode[] = ['full', 'limited', 'halted'];
  if (!Array.isArray(policy.mode_order) || policy.mode_order.length !== requiredOrder.length
    || policy.mode_order.some((mode, index) => mode !== requiredOrder[index])) {
    throw new SovereignViolation('أوضاع الخدمة ثلاثة مرتبة: full ثم limited ثم halted', 'CONFIG_SERVICES_MODE_ORDER');
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new SovereignViolation('لا مصادر بيانات معلنة للخدمات', 'CONFIG_SERVICES_NO_SOURCES');
  }
  guardDeclaredCount('service_sources', raw.sources.length, 'مصادرُ بيانات الخدمات المعلنة');
  const sources = new Set<string>();
  for (const source of raw.sources) {
    if (typeof source.id !== 'string' || !source.id.startsWith('source:')) {
      throw new SovereignViolation('معرّف مصدر خدمة غير صالح', 'CONFIG_SERVICES_SOURCE_ID');
    }
    if (sources.has(source.id)) {
      throw new SovereignViolation(`مصدر خدمة مكرّر: ${source.id}`, 'CONFIG_SERVICES_SOURCE_DUPLICATE');
    }
    if (typeof source.name !== 'string' || source.name.trim().length < 3) {
      throw new SovereignViolation(`مصدر خدمة بلا اسم: ${source.id}`, 'CONFIG_SERVICES_SOURCE_NAME');
    }
    sources.add(source.id);
  }
  if (!raw.quality_checks || typeof raw.quality_checks !== 'object'
    || Object.keys(raw.quality_checks).length === 0) {
    throw new SovereignViolation('لا فحوص جودة مختبر معلنة', 'CONFIG_SERVICES_NO_QUALITY_CHECKS');
  }
  guardDeclaredCount(
    'quality_checks', Object.keys(raw.quality_checks).length, 'فحوصُ جودة المختبر المعلنة',
  );
  let qualityTotal = 0;
  for (const [check, weight] of Object.entries(raw.quality_checks)) {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new SovereignViolation(`وزن فحص مختبر غير صالح: ${check}`, 'CONFIG_SERVICES_QUALITY_WEIGHT');
    }
    qualityTotal += weight;
  }
  if (policy.min_quality_score > qualityTotal) {
    throw new SovereignViolation('حدّ جودة المختبر لا يبلغه أي فحص معلن', 'CONFIG_SERVICES_QUALITY_UNREACHABLE');
  }
  if (!Array.isArray(raw.services) || raw.services.length === 0) {
    throw new SovereignViolation('لا خدمات حرجة معلنة', 'CONFIG_SERVICES_NO_DECLARATIONS');
  }
  const serviceIds = new Set<string>();
  const serviceKinds = new Set<string>();
  for (const service of raw.services) {
    if (typeof service.id !== 'string' || !service.id.startsWith('service:')) {
      throw new SovereignViolation('معرّف خدمة غير صالح', 'CONFIG_SERVICES_ID');
    }
    if (serviceIds.has(service.id)) {
      throw new SovereignViolation(`خدمة مكرّرة: ${service.id}`, 'CONFIG_SERVICES_DUPLICATE');
    }
    serviceIds.add(service.id);
    if (service.kind !== 'hospital' && service.kind !== 'lab') {
      throw new SovereignViolation(`نوع خدمة غير معلن: ${service.id}`, 'CONFIG_SERVICES_KIND');
    }
    if (serviceKinds.has(service.kind)) {
      throw new SovereignViolation(`أكثر من إعلان لنوع خدمة واحد: ${service.kind}`, 'CONFIG_SERVICES_KIND_DUPLICATE');
    }
    serviceKinds.add(service.kind);
    if (typeof service.name !== 'string' || service.name.trim().length < 3
      || typeof service.ministry !== 'string' || service.ministry !== policy.service_operator) {
      throw new SovereignViolation(`اسم أو مشغّل خدمة غير معلن: ${service.id}`, 'CONFIG_SERVICES_NAME_OR_OPERATOR');
    }
    if (!service.modes || typeof service.modes !== 'object'
      || Object.keys(service.modes).length !== requiredOrder.length) {
      throw new SovereignViolation(`أوضاع الخدمة ناقصة أو زائدة: ${service.id}`, 'CONFIG_SERVICES_MODES');
    }
    const requirements = new Map<DeclaredServiceMode, Set<string>>();
    for (const mode of requiredOrder) {
      const spec = service.modes[mode];
      if (!spec || (!Array.isArray(spec.required_sources)
        && !(mode === 'halted' && (spec.required_sources as unknown) === null))) {
        throw new SovereignViolation(`مصادر الوضع غير معلنة: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCES');
      }
      const seen = new Set<string>();
      for (const source of (Array.isArray(spec.required_sources) ? spec.required_sources : [])) {
        if (typeof source !== 'string' || !sources.has(source)) {
          throw new SovereignViolation(`مصدر غير معلن للوضع: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCE_UNDECLARED');
        }
        if (seen.has(source)) {
          throw new SovereignViolation(`مصدر مكرّر للوضع: ${service.id}/${mode}`, 'CONFIG_SERVICES_MODE_SOURCE_DUPLICATE');
        }
        seen.add(source);
      }
      requirements.set(mode, seen);
    }
    if ((requirements.get('full') as Set<string>).size === 0
      || (requirements.get('limited') as Set<string>).size === 0
      || (requirements.get('halted') as Set<string>).size !== 0) {
      throw new SovereignViolation(`حدود الأوضاع غير قابلة للتشغيل: ${service.id}`, 'CONFIG_SERVICES_MODE_MINIMUM');
    }
    for (const source of requirements.get('limited') as Set<string>) {
      if (!(requirements.get('full') as Set<string>).has(source)) {
        throw new SovereignViolation(`limited ليس أدنى من full: ${service.id}`, 'CONFIG_SERVICES_MODE_NOT_NESTED');
      }
    }
    if (!Array.isArray(service.operations) || service.operations.length === 0) {
      throw new SovereignViolation(`خدمة بلا عمليات معلنة: ${service.id}`, 'CONFIG_SERVICES_NO_OPERATIONS');
    }
    guardDeclaredCount(
      'service_operations', service.operations.length, `عملياتُ الخدمة المعلنة: ${service.id}`,
    );
    const operationIds = new Set<string>();
    for (const operation of service.operations) {
      if (typeof operation.id !== 'string' || !operation.id.startsWith('operation:')) {
        throw new SovereignViolation(`معرّف عملية غير صالح: ${service.id}`, 'CONFIG_SERVICES_OPERATION_ID');
      }
      if (operationIds.has(operation.id)) {
        throw new SovereignViolation(`عملية مكرّرة: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_DUPLICATE');
      }
      operationIds.add(operation.id);
      if (operation.minimum_mode !== 'full' && operation.minimum_mode !== 'limited') {
        throw new SovereignViolation(`وضع أدنى غير صالح للعملية: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_MODE');
      }
      if (!Array.isArray(operation.required_sources) || operation.required_sources.length === 0) {
        throw new SovereignViolation(`عملية بلا مصادر لازمة: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_NO_SOURCES');
      }
      const seen = new Set<string>();
      for (const source of operation.required_sources) {
        if (typeof source !== 'string' || !sources.has(source)) {
          throw new SovereignViolation(`مصدر عملية غير معلن: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE');
        }
        if (seen.has(source)) {
          throw new SovereignViolation(`مصدر عملية مكرّر: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE_DUPLICATE');
        }
        seen.add(source);
      }
      const minimum = requirements.get(operation.minimum_mode as DeclaredServiceMode) as Set<string>;
      for (const source of seen) {
        if (!minimum.has(source)) {
          throw new SovereignViolation(`عملية تطلب مصدرًا لا يسمح به وضعها الأدنى: ${operation.id}`, 'CONFIG_SERVICES_OPERATION_SOURCE_MODE');
        }
      }
    }
  }
  if (!serviceKinds.has('hospital') || !serviceKinds.has('lab')) {
    throw new SovereignViolation('يلزم إعلان مستشفى ومختبر برمجيين معًا', 'CONFIG_SERVICES_REQUIRED_KINDS');
  }
  return raw;
}
