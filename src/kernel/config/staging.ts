/**
 * src/kernel/config/staging.ts — التشغيل المحدود
 * المالك: القيّم على المستودع | المرحلة: 36
 * المدخلات: config/staging.yaml | المخرجات: StagingConfig
 * حالات الفشل: حرسٌ مجهول أو نافذة أقصر من مهلة التوقف الآمن ⇒ فشل مغلق
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { join } from 'node:path';
import { KNOWN_SOVEREIGN_ACTIONS, SovereignAction, SovereignViolation } from '../types';
import { loadChaos } from './chaos';
import { loadLoad } from './load';
import { resolveConfigDir } from './paths';
import { loadQuotas } from './quotas';
import { loadYamlFile } from './yaml';

/** أصناف الحوادث المعروفة في التشغيل المحدود */
export type IncidentKind =
  | 'authority_without_holder'
  | 'crown_domain_drift'
  | 'audit_chain_broken'
  | 'scope_violation'
  | 'terminated_entity_acting'
  | 'overdue_batch'
  | 'unresolved_dispute'
  | 'expired_retention'
  // المرحلة 37: حوادث الماسحات التي كانت دَينًا مفتوحًا (T-105) وحوادث مرور التاج
  | 'unit_ledger_mismatch'
  | 'command_loss_over_limit'
  | 'critical_service_unverified'
  | 'crown_passage_bypass'
  | 'region_action_without_passage'
  // المرحلة 39 (T-120): حالةٌ في الذاكرة وحدها في تشغيلٍ يُقال إنه دائم — وعدُ نجاةٍ لا حاملَ له
  | 'state_not_durable'
  // المرحلة 39 (T-16): عمليّةٌ غيرُ محصورة في النواة — «صفر أثرٍ خارجيٍّ غير معلن»
  // دعوى لا يحملها إلا حاجزٌ خارج الشيفرة، فمن خرج من البوابة لم يخرج من النواة
  | 'process_not_confined';

/** الحرّاس المعروفون: كل واحد ماسحٌ حقيقي في وحدة قائمة */
export type WatchKind = 'regions' | 'audit_chain' | 'scope' | 'termination' | 'king';

export interface StagingConfig {
  policy: {
    default: 'deny';
    observer_authority: string;
    window: { duration_ms: number; tick_ms: number; min_ticks: number };
    scope: {
      permitted_actions: readonly SovereignAction[];
      forbidden_actions: readonly SovereignAction[];
      max_agents: number;
    };
    severity: { critical: readonly IncidentKind[]; high: readonly IncidentKind[] };
    tolerance: { max_critical: number; max_unwatched: number; max_failed_ticks: number };
    watches: readonly WatchKind[];
    require_runbook_execution: boolean;
    runbooks: readonly string[];
    require_independent_observer: boolean;
    halt_on_critical: boolean;
    escalate_on_breach: boolean;
  };
}

/** الحرّاس المعروفون. حرسٌ مجهول لا يُعرف ماذا يمسح، فلا تُقاس شهادته. */
export const STAGING_KNOWN_WATCHES: readonly WatchKind[] = Object.freeze([
  'regions', 'audit_chain', 'scope', 'termination', 'king',
]);

/**
 * الحرّاس الذين لا تُعدّ المرحلة 36 مقبولة بغيرهم. شرط القبول في ROADMAP.md:
 * «تشغيل مقيَّد لمدة مراقبة كاملة بلا حادث حرج» — و«مقيَّد» يوجب حرس النطاق،
 * و«بلا حادث» يوجب حرسًا يقرأ سلامة السلسلة، وإلّا فالشهادة على صمتٍ لا على سلامة.
 */
export const STAGING_REQUIRED_WATCHES: readonly WatchKind[] = Object.freeze(['scope', 'audit_chain']);

/** الحوادث المعروفة بأسمائها — التهيئة هي المصدر وهذه هي المقياس */
export const STAGING_KNOWN_INCIDENTS: readonly IncidentKind[] = Object.freeze([
  'authority_without_holder', 'crown_domain_drift', 'audit_chain_broken',
  'scope_violation', 'terminated_entity_acting',
  'overdue_batch', 'unresolved_dispute', 'expired_retention',
]);

/**
 * الحوادث التي لا يجوز أن تُصنَّف دون «حرج». خرق نطاق في تشغيل مقيَّد هو نقضُ
 * القيد نفسه، وسلسلة تدقيق مكسورة تُبطل كل شهادة تُبنى عليها (RULE-006)،
 * وكيانٌ منتهٍ يعمل هو ثقب المرحلة 35 عائدًا. تصنيفها «جسيمة» يُسقط الشرط ضمنًا.
 */
export const STAGING_MUST_BE_CRITICAL: readonly IncidentKind[] = Object.freeze([
  'scope_violation', 'audit_chain_broken', 'terminated_entity_acting',
]);

/** كتب التشغيل المعروفة — ما ليس منها لا يُنفَّذ: كتابٌ مجهول لا يُعرف تحققه */
export const STAGING_KNOWN_RUNBOOKS: readonly string[] = Object.freeze([
  'limited-operation', 'incident-response', 'halt-and-recover',
]);

/**
 * الجهات المشغّلة للتشغيل المحدود. المراقب لا يكون واحدًا منها (RULE-004):
 * من يشغّل النافذة لا يشهد لنفسه أنها مرّت بلا حادث.
 */
export const STAGING_OPERATORS: readonly string[] = Object.freeze([
  'authority:king',
  'king:sovereign',
  'authority:crown_guard',
  'authority:royal_court',
  'ministry:infrastructure',
]);

export function loadStaging(configDir = resolveConfigDir()): StagingConfig {
  const raw = loadYamlFile(join(configDir, 'staging.yaml')) as unknown as StagingConfig;
  const policy = raw.policy;
  if (!policy) throw new SovereignViolation('سياسة التشغيل المحدود غير معلنة', 'CONFIG_NO_STAGING_POLICY');
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'النطاق يُبنى منعًا لا سماحًا: الافتراض في التشغيل المحدود هو الرفض',
      'CONFIG_STAGING_DEFAULT_ALLOW',
    );
  }
  if (typeof policy.observer_authority !== 'string' || policy.observer_authority.trim() === '') {
    throw new SovereignViolation('جهة المراقبة غير معلنة', 'CONFIG_STAGING_OBSERVER_AUTHORITY');
  }
  if (STAGING_OPERATORS.includes(policy.observer_authority)) {
    throw new SovereignViolation(
      'من يشغّل النافذة لا يشهد لنفسه أنها مرّت بلا حادث (RULE-004)',
      'CONFIG_STAGING_OBSERVER_IS_OPERATOR',
    );
  }

  const window = policy.window;
  if (!window) throw new SovereignViolation('نافذة المراقبة غير معلنة', 'CONFIG_STAGING_NO_WINDOW');
  for (const [key, value] of [
    ['duration_ms', window.duration_ms],
    ['tick_ms', window.tick_ms],
    ['min_ticks', window.min_ticks],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new SovereignViolation(`حد نافذة غير صالح: ${key}`, 'CONFIG_STAGING_WINDOW_VALUE');
    }
  }
  if (window.duration_ms < window.tick_ms * window.min_ticks) {
    throw new SovereignViolation(
      'مدة النافذة أقصر من أقل عدد مسحات مشترط — نافذة يستحيل أن تُقبل',
      'CONFIG_STAGING_WINDOW_TOO_SHORT',
    );
  }

  const scope = policy.scope;
  if (!scope) throw new SovereignViolation('نطاق التشغيل غير معلن', 'CONFIG_STAGING_NO_SCOPE');
  if (!Array.isArray(scope.permitted_actions) || scope.permitted_actions.length === 0) {
    throw new SovereignViolation(
      'نطاق بلا فعل مسموح: تشغيلٌ لا يفعل شيئًا لا يُراقب',
      'CONFIG_STAGING_NO_PERMITTED_ACTIONS',
    );
  }
  if (!Array.isArray(scope.forbidden_actions) || scope.forbidden_actions.length === 0) {
    throw new SovereignViolation(
      'نطاق بلا فعل ممنوع ليس قيدًا: «محدود» يوجب ما لا يُفعل',
      'CONFIG_STAGING_NO_FORBIDDEN_ACTIONS',
    );
  }
  for (const action of [...scope.permitted_actions, ...scope.forbidden_actions]) {
    if (!KNOWN_SOVEREIGN_ACTIONS.includes(action)) {
      throw new SovereignViolation(`فعل سيادي غير معروف: ${String(action)}`, 'CONFIG_STAGING_ACTION_UNKNOWN');
    }
  }
  if (new Set(scope.permitted_actions).size !== scope.permitted_actions.length
    || new Set(scope.forbidden_actions).size !== scope.forbidden_actions.length) {
    throw new SovereignViolation('فعل معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_ACTION_DUPLICATE');
  }
  for (const action of scope.forbidden_actions) {
    if (scope.permitted_actions.includes(action)) {
      throw new SovereignViolation(
        `فعل مسموح وممنوع في وقت واحد: ${action} — نطاق لا يُنفَّذ`,
        'CONFIG_STAGING_ACTION_CONTRADICTION',
      );
    }
  }
  if (!Number.isSafeInteger(scope.max_agents) || scope.max_agents <= 0) {
    throw new SovereignViolation('سقف سكان التشغيل المحدود غير صالح', 'CONFIG_STAGING_MAX_AGENTS');
  }

  const severity = policy.severity;
  if (!severity || !Array.isArray(severity.critical) || severity.critical.length === 0) {
    throw new SovereignViolation(
      'لا حادث حرج معلن: شرطٌ يقول «بلا حادث حرج» بلا تعريف للحرج غير قابل للقياس',
      'CONFIG_STAGING_NO_CRITICAL_KINDS',
    );
  }
  for (const kind of [...severity.critical, ...(severity.high ?? [])]) {
    if (!STAGING_KNOWN_INCIDENTS.includes(kind)) {
      throw new SovereignViolation(`حادث غير معروف: ${String(kind)}`, 'CONFIG_STAGING_INCIDENT_UNKNOWN');
    }
  }
  // T-131: تكرارُ حادثٍ في قائمته الواحدة — قِيس قبولُه ألفًا وأربعًا وعشرين نسخةً.
  for (const list of [severity.critical, severity.high ?? []]) {
    if (new Set(list).size !== list.length) {
      throw new SovereignViolation(
        'حادث معلن مرتين في تصنيفٍ واحد — عدٌّ مضلِّلٌ وطولٌ بلا سقف',
        'CONFIG_STAGING_INCIDENT_DUPLICATE',
      );
    }
  }
  for (const kind of severity.critical) {
    if ((severity.high ?? []).includes(kind)) {
      throw new SovereignViolation(
        `حادث حرج وجسيم في وقت واحد: ${kind} — تصنيف لا يُحكم به`,
        'CONFIG_STAGING_SEVERITY_CONTRADICTION',
      );
    }
  }
  for (const kind of STAGING_MUST_BE_CRITICAL) {
    if (!severity.critical.includes(kind)) {
      throw new SovereignViolation(
        `حادث لا يجوز تصنيفه دون حرج: ${kind}`,
        'CONFIG_STAGING_CRITICAL_DOWNGRADED',
      );
    }
  }

  const tolerance = policy.tolerance;
  if (!tolerance) throw new SovereignViolation('سقوف التسامح غير معلنة', 'CONFIG_STAGING_NO_TOLERANCE');
  if (tolerance.max_critical !== 0) {
    throw new SovereignViolation(
      'شرط القبول «بلا حادث حرج»: سقفٌ يسمح بواحد يُبطل الشرط نصًّا',
      'CONFIG_STAGING_CRITICAL_TOLERATED',
    );
  }
  if (tolerance.max_unwatched !== 0) {
    throw new SovereignViolation(
      'حرس معلن لم يمسح قطّ خرقٌ: نافذة لم يُنظر فيها لا تشهد بالسلامة',
      'CONFIG_STAGING_UNWATCHED_TOLERATED',
    );
  }
  if (tolerance.max_failed_ticks !== 0) {
    throw new SovereignViolation(
      'مسحة انهارت خرقٌ: صمت الماسح ليس سلامة',
      'CONFIG_STAGING_FAILED_TICK_TOLERATED',
    );
  }

  if (!Array.isArray(policy.watches) || policy.watches.length === 0) {
    throw new SovereignViolation(
      'لا حرس معلن — مراقبة بلا ماسح انتظارٌ لا مراقبة',
      'CONFIG_STAGING_NO_WATCHES',
    );
  }
  for (const watch of policy.watches) {
    if (!STAGING_KNOWN_WATCHES.includes(watch)) {
      throw new SovereignViolation(`حرس غير معروف: ${String(watch)}`, 'CONFIG_STAGING_WATCH_UNKNOWN');
    }
  }
  if (new Set(policy.watches).size !== policy.watches.length) {
    throw new SovereignViolation('حرس معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_WATCH_DUPLICATE');
  }
  for (const required of STAGING_REQUIRED_WATCHES) {
    if (!policy.watches.includes(required)) {
      throw new SovereignViolation(
        `شرط قبول المرحلة 36 يوجب حرسًا: ${required}`,
        'CONFIG_STAGING_REQUIRED_WATCH_MISSING',
      );
    }
  }

  if (policy.require_runbook_execution !== true) {
    throw new SovereignViolation(
      'كتاب التشغيل يُنفَّذ لا يُقرأ: كتابٌ لم يُنفَّذ وثيقةٌ لا إجراء',
      'CONFIG_STAGING_RUNBOOK_OPTIONAL',
    );
  }
  if (!Array.isArray(policy.runbooks) || policy.runbooks.length === 0) {
    throw new SovereignViolation('لا كتاب تشغيل معلن', 'CONFIG_STAGING_NO_RUNBOOKS');
  }
  for (const book of policy.runbooks) {
    if (!STAGING_KNOWN_RUNBOOKS.includes(book)) {
      throw new SovereignViolation(`كتاب تشغيل غير معروف: ${String(book)}`, 'CONFIG_STAGING_RUNBOOK_UNKNOWN');
    }
  }
  if (new Set(policy.runbooks).size !== policy.runbooks.length) {
    throw new SovereignViolation('كتاب معلن مرتين — عدّ مضلِّل', 'CONFIG_STAGING_RUNBOOK_DUPLICATE');
  }
  if (policy.require_independent_observer !== true) {
    throw new SovereignViolation(
      'المراقبة المستقلة شرط لا خيار (RULE-004)',
      'CONFIG_STAGING_OBSERVER_OPTIONAL',
    );
  }
  if (policy.halt_on_critical !== true) {
    throw new SovereignViolation(
      'حادث حرج في تشغيل مقيَّد يوجب التوقف الآمن ولا يُواصَل عليه (RULE-007)',
      'CONFIG_STAGING_CRITICAL_CONTINUES',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرق نافذة لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_STAGING_BREACH_SILENT',
    );
  }

  const load = loadLoad(configDir).policy;
  if (window.tick_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'مسحة أسرع من أقصى زمن أمر معلن في load.yaml — تُنتج حادثًا حتميًّا لا حقيقيًّا',
      'CONFIG_STAGING_TICK_UNDER_CHANNEL_MAX',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (window.duration_ms < chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'نافذة أقصر من مهلة التوقف الآمن — لا تُدرك توقفًا لو وقع حادث حرج',
      'CONFIG_STAGING_WINDOW_UNDER_SAFE_STOP',
    );
  }
  const quotas = loadQuotas(configDir);
  if (scope.max_agents > quotas.agents.population_max) {
    throw new SovereignViolation(
      'سقف سكان التشغيل المحدود فوق السقف السكاني المعلن — قيدٌ أرخى من الأصل',
      'CONFIG_STAGING_AGENTS_OVER_POPULATION',
    );
  }
  return raw;
}
