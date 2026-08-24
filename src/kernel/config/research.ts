/**
 * src/kernel/config/research.ts — أقسام البحث والمرآة
 * المالك: القيّم على المستودع | المرحلة: 30
 * المدخلات: config/research.yaml | المخرجات: ResearchConfig
 * حالات الفشل: مصدر معرفة غير معلن أو مسار إلى شخص حقيقي ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { guardDeclaredCount } from './declaration_limits';
import { loadYamlFile } from './yaml';

/** تهيئة البحث النظري في النظير البشري وأقسام المرآة (المرحلة 30). */
export type ResearchSourceType = 'public_literature' | 'statistical_aggregate' | 'historical_record';

export interface ResearchConfig {
  policy: {
    default: string;
    max_departments: number;
    max_concurrent_researches: number;
    max_sources_per_research: number;
    max_research_term_days: number;
    review_interval_days: number;
    min_lesson_quality_score: number;
    max_egress_calls: number;
    research_operator: string;
    lesson_approver: string;
    beneficiary_prefix: string;
  };
  allowed_source_types: ResearchSourceType[];
  sources: { id: string; type: ResearchSourceType; title: string }[];
}

/**
 * يحمل حدّ البحث الأخلاقي قبل الإقلاع.
 * البحث نظري في النظير البشري عبر مصادر معلنة، ولا يمس إنسانًا ولا بياناته.
 */
export function loadResearch(configDir = resolveConfigDir()): ResearchConfig {
  const raw = loadYamlFile(join(configDir, 'research.yaml')) as unknown as ResearchConfig;
  const policy = raw.policy;
  if (!policy || policy.default !== 'deny') {
    throw new SovereignViolation('الافتراض في أبحاث البشر هو الرفض', 'CONFIG_RESEARCH_DEFAULT_ALLOW');
  }
  for (const [key, value] of [
    ['max_departments', policy.max_departments],
    ['max_concurrent_researches', policy.max_concurrent_researches],
    ['max_sources_per_research', policy.max_sources_per_research],
    ['max_research_term_days', policy.max_research_term_days],
    ['review_interval_days', policy.review_interval_days],
    ['min_lesson_quality_score', policy.min_lesson_quality_score],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد بحث غير صالح أو غير معلن: ${key}`, 'CONFIG_RESEARCH_POLICY_VALUE');
    }
  }
  if (policy.max_research_term_days > 365) {
    throw new SovereignViolation('مدة البحث تتجاوز سنة — لا بحث دائم', 'CONFIG_RESEARCH_TERM');
  }
  if (policy.min_lesson_quality_score > 100) {
    throw new SovereignViolation('حد جودة الدرس لا يبلغه أي درس صالح', 'CONFIG_RESEARCH_QUALITY_UNREACHABLE');
  }
  if (policy.max_egress_calls !== 0) {
    throw new SovereignViolation('الخروج الشبكي محظور في البحث النظري وسقفه صفر', 'CONFIG_RESEARCH_EGRESS_NOT_ZERO');
  }
  for (const [key, value] of [
    ['research_operator', policy.research_operator],
    ['lesson_approver', policy.lesson_approver],
    ['beneficiary_prefix', policy.beneficiary_prefix],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SovereignViolation(`معرّف بحث غير معلن: ${key}`, 'CONFIG_RESEARCH_PARTY_ID');
    }
  }
  if (policy.beneficiary_prefix !== 'agent:') {
    throw new SovereignViolation('نتيجة البحث لا تفيد إلا agent:* — لا سلطة على بشر', 'CONFIG_RESEARCH_BENEFICIARY_SCOPE');
  }
  if (policy.research_operator === policy.lesson_approver) {
    throw new SovereignViolation('الباحث لا يجيز درسه (RULE-004)', 'CONFIG_RESEARCH_ROLES_MERGED');
  }
  const allowed = new Set<ResearchSourceType>([
    'public_literature', 'statistical_aggregate', 'historical_record',
  ]);
  if (!Array.isArray(raw.allowed_source_types) || raw.allowed_source_types.length === 0) {
    throw new SovereignViolation('لا أنواع مصادر بحث معلنة', 'CONFIG_RESEARCH_NO_SOURCE_TYPES');
  }
  const declaredTypes = new Set<ResearchSourceType>();
  for (const type of raw.allowed_source_types) {
    if (typeof type !== 'string' || !allowed.has(type as ResearchSourceType)) {
      throw new SovereignViolation(`نوع مصدر بحث محظور: ${String(type)}`, 'CONFIG_RESEARCH_SOURCE_TYPE');
    }
    if (declaredTypes.has(type)) {
      throw new SovereignViolation(`نوع مصدر بحث مكرّر: ${type}`, 'CONFIG_RESEARCH_SOURCE_TYPE_DUPLICATE');
    }
    declaredTypes.add(type);
  }
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) {
    throw new SovereignViolation('لا وثائق مصادر معلنة للبحث', 'CONFIG_RESEARCH_NO_SOURCES');
  }
  guardDeclaredCount('research_sources', raw.sources.length, 'وثائقُ مصادر البحث المعلنة');
  const sourceIds = new Set<string>();
  for (const source of raw.sources) {
    if (typeof source.id !== 'string' || !source.id.startsWith('source:')) {
      throw new SovereignViolation('معرّف مصدر البحث يجب أن يبدأ source:', 'CONFIG_RESEARCH_SOURCE_ID');
    }
    if (sourceIds.has(source.id)) {
      throw new SovereignViolation(`مصدر بحث مكرّر: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_DUPLICATE');
    }
    sourceIds.add(source.id);
    if (typeof source.type !== 'string' || !declaredTypes.has(source.type)) {
      throw new SovereignViolation(`مصدر بلا نوع معلن أو بنوع محظور: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_TYPE_UNDECLARED');
    }
    if (typeof source.title !== 'string' || source.title.trim().length < 3) {
      throw new SovereignViolation(`وثيقة مصدر بلا عنوان معلن: ${source.id}`, 'CONFIG_RESEARCH_SOURCE_TITLE');
    }
  }
  if (policy.max_sources_per_research > raw.sources.length) {
    throw new SovereignViolation(
      'سقف مصادر البحث لا يمكن ممارسته بعدد الوثائق المعلنة',
      'CONFIG_RESEARCH_SOURCE_LIMIT_UNREACHABLE',
    );
  }
  return raw;
}
