/**
 * src/kernel/config/production.ts — التشغيل الاتحادي
 * المالك: القيّم على المستودع | المرحلة: 37
 * المدخلات: config/production.yaml | المخرجات: ProductionConfig
 * حالات الفشل: ماسحٌ مجهول أو حدٌّ بلا رمز رفض ⇒ فشل مغلق (41 رمزًا)
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والمفردات في `production_policy.ts`.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { loadChaos } from './chaos';
import { loadLoad } from './load';
import { resolveConfigDir } from './paths';
import { loadRegions } from './regions';
import { loadStaging } from './staging';
import { loadYamlFile } from './yaml';
import { PRODUCTION_KNOWN_INCIDENTS, PRODUCTION_KNOWN_RUNBOOKS, PRODUCTION_KNOWN_SCANNERS, PRODUCTION_MUST_BE_CRITICAL, PRODUCTION_OPERATORS, PRODUCTION_REQUIRED_SCANNERS, ProductionConfig } from './production_policy';

export function loadProduction(configDir = resolveConfigDir()): ProductionConfig {
  const raw = loadYamlFile(join(configDir, 'production.yaml')) as unknown as ProductionConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة التشغيل الاتحادي غير معلنة', 'CONFIG_NO_PRODUCTION_POLICY');
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'الافتراض في التشغيل الاتحادي منعٌ لا سماح — لا يُرخى بعد التشغيل المحدود',
      'CONFIG_PRODUCTION_DEFAULT_ALLOW',
    );
  }
  if (!policy.observer_authority || policy.observer_authority.trim().length === 0) {
    throw new SovereignViolation(
      'لا مراقب معلن — تشغيلٌ يشهد لنفسه',
      'CONFIG_PRODUCTION_OBSERVER_AUTHORITY',
    );
  }
  if (PRODUCTION_OPERATORS.includes(policy.observer_authority)) {
    throw new SovereignViolation(
      'المراقب من المشغّلين — من يشغّل الاتحاد لا يشهد لنفسه أنه مراقَب (RULE-004)',
      'CONFIG_PRODUCTION_OBSERVER_IS_OPERATOR',
    );
  }

  const sup = policy.supervision;
  if (!sup) {
    throw new SovereignViolation(
      'لا مراقبة معلنة — «مستمرة» بلا أرقام دعوى',
      'CONFIG_PRODUCTION_NO_SUPERVISION',
    );
  }
  const positives: readonly [string, number][] = [
    ['tick_ms', sup.tick_ms],
    ['start_grace_ms', sup.start_grace_ms],
    ['max_silence_ms', sup.max_silence_ms],
    ['restart_gap_max_ms', sup.restart_gap_max_ms],
    ['min_sweeps', sup.min_sweeps],
    ['pending_max_ms', policy.loads?.pending_max_ms as number],
    ['passage_ttl_ms', policy.regions?.passage_ttl_ms as number],
  ];
  for (const [name, value] of positives) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new SovereignViolation(
        `قيمة غير صالحة في سياسة التشغيل الاتحادي: «${name}»`,
        'CONFIG_PRODUCTION_SUPERVISION_VALUE',
      );
    }
  }
  if (sup.min_sweeps < 2) {
    throw new SovereignViolation(
      'مسحة واحدة لا تُسمّى مراقبة مستمرة — الاستمرار يُقاس بتكرارٍ لا بحدوث',
      'CONFIG_PRODUCTION_MIN_SWEEPS',
    );
  }
  if (sup.start_grace_ms < sup.tick_ms) {
    throw new SovereignViolation(
      'مهلة البدء أقصر من دورة المسح — خرقٌ حتميّ لا قياس',
      'CONFIG_PRODUCTION_GRACE_UNDER_TICK',
    );
  }
  if (sup.max_silence_ms <= sup.tick_ms) {
    throw new SovereignViolation(
      'الصمت المسموح لا يجاوز دورة المسح — فجوةٌ تُعلن في كل دورة سليمة',
      'CONFIG_PRODUCTION_SILENCE_UNDER_TICK',
    );
  }
  if (!sup.checkpoint_directory || sup.checkpoint_directory.trim().length === 0) {
    throw new SovereignViolation(
      'لا نقطة تفتيش معلنة — مراقبةٌ لا تعبر إعادة التشغيل ليست مستمرة',
      'CONFIG_PRODUCTION_NO_CHECKPOINT_DIR',
    );
  }

  const regions = policy.regions;
  if (!regions || !Array.isArray(regions.required) || regions.required.length === 0) {
    throw new SovereignViolation(
      'لا أقاليم مشترطة — «كل الأقاليم تعمل» بلا مرجع تُقاس عليه',
      'CONFIG_PRODUCTION_NO_REGIONS',
    );
  }
  const declared = new Set(loadRegions(configDir).regions.map((r) => r.id));
  const seenRegion = new Set<string>();
  for (const id of regions.required) {
    if (seenRegion.has(id)) {
      throw new SovereignViolation(
        `إقليم مشترط مكرّر: «${id}» — التكرار يُضخّم العدد ولا يُضيف عملًا`,
        'CONFIG_PRODUCTION_REGION_DUPLICATE',
      );
    }
    seenRegion.add(id);
    if (!declared.has(id)) {
      throw new SovereignViolation(
        `إقليم مشترط غير معلن في regions.yaml: «${id}» — شرطٌ يستحيل استيفاؤه`,
        'CONFIG_PRODUCTION_REGION_UNDECLARED',
      );
    }
  }
  if (regions.require_crown_passage !== true) {
    throw new SovereignViolation(
      'مرور التاج غير مشترط — تعطيله ينقض شرط القبول نصًّا',
      'CONFIG_PRODUCTION_PASSAGE_OPTIONAL',
    );
  }
  if (regions.require_governor !== true) {
    throw new SovereignViolation(
      'إقليم مفوَّض بلا حاكم سلطةٌ بلا مسؤول (المرحلة 24)',
      'CONFIG_PRODUCTION_GOVERNOR_OPTIONAL',
    );
  }
  if (regions.max_suspended !== 0) {
    throw new SovereignViolation(
      'إقليم موقوف مُحتمَل في تشغيل يُقال إنه اتحادي كامل',
      'CONFIG_PRODUCTION_SUSPENDED_TOLERATED',
    );
  }

  const tol = policy.tolerance;
  if (!tol) {
    throw new SovereignViolation(
      'لا حدود تحمّل معلنة — تشغيلٌ بلا سقف خرق',
      'CONFIG_PRODUCTION_NO_TOLERANCE',
    );
  }
  if (tol.max_critical !== 0) {
    throw new SovereignViolation(
      'حادث حرج مُحتمَل في تشغيل مستمر — الشرط لا يقبل استثناءً',
      'CONFIG_PRODUCTION_CRITICAL_TOLERATED',
    );
  }
  if (tol.max_unwatched !== 0) {
    throw new SovereignViolation(
      'ماسحٌ معلن لا يمسح مُحتمَل — قدرةٌ لا يناديها أحد (T-105)',
      'CONFIG_PRODUCTION_UNWATCHED_TOLERATED',
    );
  }
  if (tol.max_failed_sweeps !== 0) {
    throw new SovereignViolation(
      'مسحة منهارة مُحتمَلة — صمت الماسح يمرّ بلا أثر',
      'CONFIG_PRODUCTION_FAILED_SWEEP_TOLERATED',
    );
  }
  if (tol.max_unpassed_action !== 0) {
    throw new SovereignViolation(
      'فعل إقليمي بلا إذن مرور مُحتمَل — نقضُ الشرط نفسه',
      'CONFIG_PRODUCTION_UNPASSED_TOLERATED',
    );
  }
  if (typeof tol.min_bypass_proof !== 'number' || tol.min_bypass_proof < 1) {
    throw new SovereignViolation(
      'لا دليل رفض مشترط — «مُنفَّذ» بلا محاولة تجاوزٍ مرفوضة دعوى',
      'CONFIG_PRODUCTION_BYPASS_UNPROVEN',
    );
  }

  const severity = policy.severity;
  if (!severity || !Array.isArray(severity.critical) || severity.critical.length === 0) {
    throw new SovereignViolation(
      'لا حوادث حرجة معلنة — تصنيفٌ يُفرغ التوقف الآمن',
      'CONFIG_PRODUCTION_NO_CRITICAL_KINDS',
    );
  }
  const high = Array.isArray(severity.high) ? severity.high : [];
  for (const kind of [...severity.critical, ...high]) {
    if (!PRODUCTION_KNOWN_INCIDENTS.includes(kind)) {
      throw new SovereignViolation(
        `حادث مجهول في التصنيف: «${kind}» — ما لا يُعرف لا يُقاس`,
        'CONFIG_PRODUCTION_INCIDENT_UNKNOWN',
      );
    }
  }
  for (const kind of severity.critical) {
    if (high.includes(kind)) {
      throw new SovereignViolation(
        `حادث مصنّف حرجًا وجسيمًا معًا: «${kind}»`,
        'CONFIG_PRODUCTION_SEVERITY_CONTRADICTION',
      );
    }
  }
  for (const kind of PRODUCTION_MUST_BE_CRITICAL) {
    if (!severity.critical.includes(kind)) {
      throw new SovereignViolation(
        `حادثٌ لا يجوز تخفيفه: «${kind}» — تصنيفه دون حرج يُسقط شرط القبول`,
        'CONFIG_PRODUCTION_CRITICAL_DOWNGRADED',
      );
    }
  }

  if (!Array.isArray(policy.scanners) || policy.scanners.length === 0) {
    throw new SovereignViolation(
      'لا ماسحات معلنة — مراقبةٌ بلا ما تمسحه',
      'CONFIG_PRODUCTION_NO_SCANNERS',
    );
  }
  const seenScanner = new Set<string>();
  for (const scanner of policy.scanners) {
    if (!PRODUCTION_KNOWN_SCANNERS.includes(scanner)) {
      throw new SovereignViolation(
        `ماسح مجهول: «${scanner}»`,
        'CONFIG_PRODUCTION_SCANNER_UNKNOWN',
      );
    }
    if (seenScanner.has(scanner)) {
      throw new SovereignViolation(
        `ماسح مكرّر: «${scanner}» — التكرار يُضخّم عدد المسحات ولا يُضيف مراقبة`,
        'CONFIG_PRODUCTION_SCANNER_DUPLICATE',
      );
    }
    seenScanner.add(scanner);
  }
  for (const required of PRODUCTION_REQUIRED_SCANNERS) {
    if (!seenScanner.has(required)) {
      throw new SovereignViolation(
        `ماسح مشترط غائب: «${required}» — شرط القبول لا يُستوفى بدونه`,
        'CONFIG_PRODUCTION_REQUIRED_SCANNER_MISSING',
      );
    }
  }

  if (policy.require_runbook_execution !== true) {
    throw new SovereignViolation(
      'كتاب التشغيل يُنفَّذ لا يُقرأ (RULE-008)',
      'CONFIG_PRODUCTION_RUNBOOK_OPTIONAL',
    );
  }
  if (!Array.isArray(policy.runbooks) || policy.runbooks.length === 0) {
    throw new SovereignViolation(
      'لا كتب تشغيل معلنة — تنفيذٌ بلا مكتوب',
      'CONFIG_PRODUCTION_NO_RUNBOOKS',
    );
  }
  const seenBook = new Set<string>();
  for (const book of policy.runbooks) {
    if (!PRODUCTION_KNOWN_RUNBOOKS.includes(book)) {
      throw new SovereignViolation(
        `كتاب تشغيل مجهول: «${book}»`,
        'CONFIG_PRODUCTION_RUNBOOK_UNKNOWN',
      );
    }
    if (seenBook.has(book)) {
      throw new SovereignViolation(
        `كتاب تشغيل مكرّر: «${book}»`,
        'CONFIG_PRODUCTION_RUNBOOK_DUPLICATE',
      );
    }
    seenBook.add(book);
  }

  if (policy.require_independent_observer !== true) {
    throw new SovereignViolation(
      'المراقبة المستقلة غير مشترطة — شهادةٌ على النفس',
      'CONFIG_PRODUCTION_OBSERVER_OPTIONAL',
    );
  }
  if (policy.halt_on_critical !== true) {
    throw new SovereignViolation(
      'حادث حرج يوجب التوقف الآمن ولا يُواصَل عليه (RULE-007)',
      'CONFIG_PRODUCTION_CRITICAL_CONTINUES',
    );
  }
  if (policy.escalate_on_breach !== true) {
    throw new SovereignViolation(
      'خرقٌ لا يمرّ بلا تصعيد — لا سياسة تُسكته',
      'CONFIG_PRODUCTION_BREACH_SILENT',
    );
  }

  const load = loadLoad(configDir).policy;
  if (sup.tick_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'دورة مسح أسرع من أقصى زمن أمر معلن — تُنتج حادثًا حتميًّا لا حقيقيًّا',
      'CONFIG_PRODUCTION_TICK_UNDER_CHANNEL_MAX',
    );
  }
  if (policy.loads.pending_max_ms < load.channel_max_ms) {
    throw new SovereignViolation(
      'عمر الأمر المسموح أقصر من زمن مروره — أمرٌ يُعدّ مفقودًا قبل أن يُمهَل',
      'CONFIG_PRODUCTION_PENDING_UNDER_CHANNEL_MAX',
    );
  }
  const staging = loadStaging(configDir).policy;
  if (sup.tick_ms > staging.window.tick_ms) {
    throw new SovereignViolation(
      'مسح التشغيل الاتحادي أبطأ من مسح التشغيل المحدود — تدرّجٌ منقوض',
      'CONFIG_PRODUCTION_TICK_OVER_STAGING',
    );
  }
  const chaos = loadChaos(configDir).policy;
  if (sup.restart_gap_max_ms < chaos.safe_stop_deadline_ms) {
    throw new SovereignViolation(
      'فجوة إعادة التشغيل المسموحة أقصر من مهلة التوقف الآمن — توقفٌ نظاميّ يُعدّ خرقًا',
      'CONFIG_PRODUCTION_RESTART_GAP_UNDER_SAFE_STOP',
    );
  }
  return raw;
}
