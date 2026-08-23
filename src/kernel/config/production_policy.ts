/**
 * src/kernel/config/production_policy.ts — مفردات سياسة التشغيل الاتحادي
 * المالك: القيّم على المستودع | المرحلة: 37
 * المدخلات: لا شيء (إعلانات ثابتة) | المخرجات: أنواع وقوائم المعروف والمطلوب
 * حالات الفشل: لا شيء هنا — هذه هي المقاييس التي يُقاس عليها في `production.ts`
 *
 * فُصلت عن المُحمِّل في ورشة الهيكلة (0.24.0) لأن الملف تجاوز سقف 400 سطر
 * المعلن في `config/module_limits.yaml`. المفردات هنا والإنفاذ هناك.
 */
import { IncidentKind, STAGING_KNOWN_INCIDENTS, STAGING_MUST_BE_CRITICAL, STAGING_OPERATORS, WatchKind } from './staging';

// ════════════════════════════════════════════════════════════════════════════
// المرحلة 37 — سياسة التشغيل الاتحادي
//
// الفرق عن المرحلة 36 ليس في العدد بل في طبيعة الشرط: هناك «نافذة» لها مدة تنتهي،
// وهنا «مراقبة مستمرة» بلا مدة. فكل ما كان يُقاس بطول النافذة يُقاس هنا بالصمت
// المسموح وبفجوة إعادة التشغيل. والقاعدة نفسها: لكل رقم قيمةٌ تُسقط الإقلاع.
// ════════════════════════════════════════════════════════════════════════════

/** الماسحات المعروفة: حرّاس المرحلة 36 + الوحدات التي كانت تنتظر نداءً + المرور */
export type ScannerKind =
  | WatchKind
  | 'loads'
  | 'digital_unit'
  | 'factories'
  | 'hospitals'
  | 'retention'
  | 'passage'
  // المرحلة 39 (T-120): ماسحُ الثبات — لا تشغيل اتحاديٌ بحالةٍ لا تنجو من موت العمليّة
  | 'durable_state';

export interface ProductionConfig {
  policy: {
    default: 'deny';
    observer_authority: string;
    supervision: {
      tick_ms: number;
      start_grace_ms: number;
      max_silence_ms: number;
      restart_gap_max_ms: number;
      min_sweeps: number;
      checkpoint_directory: string;
    };
    loads: { pending_max_ms: number };
    regions: {
      required: readonly string[];
      require_crown_passage: boolean;
      require_governor: boolean;
      passage_ttl_ms: number;
      max_suspended: number;
    };
    tolerance: {
      max_critical: number;
      max_unwatched: number;
      max_failed_sweeps: number;
      max_unpassed_action: number;
      min_bypass_proof: number;
    };
    severity: { critical: readonly IncidentKind[]; high: readonly IncidentKind[] };
    scanners: readonly ScannerKind[];
    require_runbook_execution: boolean;
    runbooks: readonly string[];
    require_independent_observer: boolean;
    halt_on_critical: boolean;
    escalate_on_breach: boolean;
  };
}

/** الماسحات المعروفة — ماسحٌ مجهول لا يُعرف ما يمسح فلا تُقاس شهادته */
export const PRODUCTION_KNOWN_SCANNERS: readonly ScannerKind[] = [
  'regions', 'audit_chain', 'scope', 'termination', 'king',
  'loads', 'digital_unit', 'factories', 'hospitals', 'retention', 'passage',
  'durable_state',
];

/**
 * الماسحات التي لا يُعدّ التشغيل الاتحادي مقبولًا بغيرها. شرط القبول نصًّا:
 * «كل الأقاليم تعمل تحت مرور التاج مع مراقبة مستمرة» — فـ«الأقاليم تعمل» توجب
 * ماسح الأقاليم، و«تحت مرور التاج» توجب ماسح المرور، و«مراقبة» لا تُبنى على سلسلة
 * غير مُتحقَّقة (audit_chain) ولا على نطاق غير محروس (scope).
 */
export const PRODUCTION_REQUIRED_SCANNERS: readonly ScannerKind[] = [
  'regions', 'passage', 'audit_chain', 'scope',
  // المرحلة 39 (T-120): الثباتُ مشترطٌ لا مرجوّ — تشغيلٌ دائمٌ بحالةٍ تموت مع العمليّة
  // ليس دائمًا؛ وحذفُ الماسح من التهيئة يُسقط الإقلاع برمزه المعلن.
  'durable_state',
];

/** الحوادث المعروفة في التشغيل الاتحادي */
export const PRODUCTION_KNOWN_INCIDENTS: readonly IncidentKind[] = [
  ...STAGING_KNOWN_INCIDENTS,
  'unit_ledger_mismatch', 'command_loss_over_limit', 'critical_service_unverified',
  'crown_passage_bypass', 'region_action_without_passage', 'state_not_durable',
];

/**
 * ما لا يجوز تصنيفه دون «حرج». يُضاف إلى قائمة المرحلة 36 فعلٌ إقليمي نفُذ بلا إذن
 * مرور: تصنيفه «جسيمًا» يُسقط شرط القبول ضمنًا — لأن الشرط هو ألّا ينفُذ.
 */
export const PRODUCTION_MUST_BE_CRITICAL: readonly IncidentKind[] = [
  ...STAGING_MUST_BE_CRITICAL,
  'region_action_without_passage',
  // T-120: تصنيفُ انعدام الثبات «جسيمًا» يُبقي التشغيل مارًّا والحالةُ تموت مع العمليّة.
  'state_not_durable',
];

/** كتب التشغيل المعروفة في الطور الاتحادي */
export const PRODUCTION_KNOWN_RUNBOOKS: readonly string[] = [
  'federated-operation', 'king-absence',
];

/** الجهات المشغّلة للتشغيل الاتحادي — المراقب ليس منها (RULE-004) */
export const PRODUCTION_OPERATORS: readonly string[] = STAGING_OPERATORS;

/**
 * يحمّل سياسة التشغيل الاتحادي ويرفض كل تهيئة تُسمّي المراقبة «مستمرة» وهي منقطعة،
 * أو تُسمّي الأقاليم «عاملة» وهي معلنة، أو تُسمّي المرور «مُنفَّذًا» بلا دليل رفض.
 */
