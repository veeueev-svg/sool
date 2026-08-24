/**
 * src/kernel/config/persistence.ts — سياسة الثبات العام (اليوميّة الدائمة)
 * المالك: وزارة البيانات | المرحلة: 39 (البند T-27)
 * المدخلات: config/persistence.yaml | المخرجات: PersistenceConfig
 * حالات الفشل (كلها مغلقة):
 *   - لا سياسة معلنة ⇒ CONFIG_NO_PERSISTENCE_POLICY
 *   - مجلد اليوميّة ليس مسارًا مطلقًا أو اسم الملف فارغ ⇒ CONFIG_PERSISTENCE_PATH
 *   - fsync_every_record ≠ true ⇒ CONFIG_PERSISTENCE_FSYNC_REQUIRED (وعد النجاة لا يُعطَّل بسياسة)
 *   - verify_chain_on_boot ≠ true ⇒ CONFIG_PERSISTENCE_VERIFY_REQUIRED
 *   - حدّ قيود غير صحيح ⇒ CONFIG_PERSISTENCE_LIMIT
 *   - نطاق فارغ أو صنف غير معروف ⇒ CONFIG_PERSISTENCE_SCOPE
 *   - عتبة ضغط غائبة أو غير موجبة أو لا تقلّ عن سقف القيود ⇒ CONFIG_PERSISTENCE_COMPACTION (T-123)
 *   - سياسة احتفاظ أرشيفات غائبة أو حرسُ الشاهد مُعطَّل ⇒ CONFIG_PERSISTENCE_ARCHIVES (T-123)
 *
 * القاعدة: التهيئة قبل الشفرة. كل قيمة هنا يقرؤها `src/data/persistence.ts` ويُنفذها،
 * ولا قيمة زينة: النطاق يمنع تدوين ما ليس فيه، والحدّ يرفض القيد بعده مغلقًا.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** أصناف القيود المسموح تدوينها — قائمة مغلقة: صنف غير معلن لا يُدوَّن ولا يُقرأ */
export const DURABLE_KINDS = [
  'audit_entry', 'memory_record', 'memory_share', 'knowledge_fact', 'archive_snapshot',
  // T-121: علامةُ الضغط — أوّل قيد في يوميّةٍ مضغوطة، يشهد من أين جاءت وأين أُرشف
  // أصلُها. ليس لوحدات الحالة أن تُدوّنه — الضاغط وحده يكتبه، والإرجاع يتجاوزه.
  'journal_compacted',
  // T-122: أنظمةُ السجل الثلاثة التي كانت خارج التدوين اللحظي: الدفترُ المزدوج،
  // وسجلُ العقود الخارجيّة، والسكان. والسكانُ بالدفعة لا بالهويّة — والرقمُ المقيس
  // هو الحجّة (docs/audit/measurements/phase-39-T122-T123.txt): 4.34ms للقيد الواحد.
  'ledger_entry', 'contract_record', 'population_batch', 'population_terminated',
  // T-125: الوحداتُ الماليّةُ والخارجيّة. حالةٌ تُحدَّث (`treasury_state` · `unit_supply` ·
  // `budget_appropriation` · `tax_levy` · `external_account`) وسلسلةٌ تُضاف ولا تُمحى
  // (`treasury_disbursement` · `external_payment` · `partner_assessment` · `partner_breach`).
  // والفرقُ ليس تسميةً: الأولى يُغني أحدثُها عمّا قبله في الضغط، والثانية لا تُسقَط قطّ.
  'treasury_disbursement', 'treasury_state', 'budget_appropriation', 'tax_levy',
  'unit_supply', 'external_account', 'external_payment', 'partner_assessment',
  'partner_breach',
  // T-126: بنيةُ الحكومة. أربعتُها **حالةٌ** يُغني أحدثُها عمّا قبله: الوزارةُ تُحلّ فتُحدَّث،
  // والاقتراحُ يمرّ بأطوارٍ (مقترح ⇒ معتمد ⇒ منفَّذ) فآخرُ طورٍ يكفي، وصاحبُ المنصب يُعزل
  // فيُقيَّد خلوُّ المنصب بعلامةٍ لا بمحوِ قيد. والمنصبُ نفسُه لا يُلغى بعد إعلانه.
  'ministry_state', 'office_definition', 'appointment_proposal', 'office_holder',
] as const;
export type DurableKind = (typeof DURABLE_KINDS)[number];

/** عتبةُ مناداةِ الضغط (T-123) — رأيٌ يُحسَب، والقرارُ لمن يُقيّده في السجل */
export interface CompactionPolicyConfig {
  compact_at_records: number;
  min_interval_ms: number;
}

/** احتفاظُ الأرشيفات (T-123) — وحرسُ الشاهد مُثبَّت لا مُخَيَّر */
export interface ArchiveRetentionConfig {
  keep_min: number;
  max_age_ms: number;
  require_witness_coverage: boolean;
}

export interface PersistenceConfig {
  policy: {
    journal_directory: string;
    journal_file: string;
    fsync_every_record: boolean;
    verify_chain_on_boot: boolean;
    rebuild_termination_roll: boolean;
    max_journal_records: number;
    scope: readonly DurableKind[];
  };
  compaction: CompactionPolicyConfig;
  archives: ArchiveRetentionConfig;
}

export function loadPersistence(configDir = resolveConfigDir()): PersistenceConfig {
  const file = join(configDir, 'persistence.yaml');
  // غياب الملف رفضٌ مغلق بصنفه المعلن، لا استثناء نظام ملفات يتسرب بلا رمز (RULE-007).
  if (!existsSync(file)) {
    throw new SovereignViolation(`سياسة الثبات غير موجودة: ${file}`, 'CONFIG_NO_PERSISTENCE_POLICY');
  }
  const raw = loadYamlFile(file) as unknown as PersistenceConfig;
  const policy = raw.policy;
  if (!policy) {
    throw new SovereignViolation('سياسة الثبات غير معلنة', 'CONFIG_NO_PERSISTENCE_POLICY');
  }
  if (typeof policy.journal_directory !== 'string' || !policy.journal_directory.startsWith('/')) {
    throw new SovereignViolation('مجلد اليوميّة يجب أن يكون مسارًا مطلقًا معلنًا', 'CONFIG_PERSISTENCE_PATH');
  }
  if (typeof policy.journal_file !== 'string' || policy.journal_file.trim() === ''
    || policy.journal_file.includes('/')) {
    throw new SovereignViolation('اسم ملف اليوميّة يجب أن يكون اسمًا مجرَّدًا', 'CONFIG_PERSISTENCE_PATH');
  }
  if (policy.fsync_every_record !== true) {
    throw new SovereignViolation(
      'مزامنة القرص لكل قيد إلزامية — لا وعد نجاةٍ بسياسة تُعطّلها',
      'CONFIG_PERSISTENCE_FSYNC_REQUIRED',
    );
  }
  if (policy.verify_chain_on_boot !== true) {
    throw new SovereignViolation(
      'التحقق من سلسلة اليوميّة عند الإقلاع إلزامي',
      'CONFIG_PERSISTENCE_VERIFY_REQUIRED',
    );
  }
  if (typeof policy.rebuild_termination_roll !== 'boolean') {
    throw new SovereignViolation('إعادة بناء سجل المنتهين قرار معلن لا مفترض', 'CONFIG_PERSISTENCE_LIMIT');
  }
  if (!Number.isSafeInteger(policy.max_journal_records) || policy.max_journal_records <= 0) {
    throw new SovereignViolation('حدّ قيود اليوميّة غير صالح', 'CONFIG_PERSISTENCE_LIMIT');
  }
  const scope = policy.scope;
  if (!Array.isArray(scope) || scope.length === 0) {
    throw new SovereignViolation('نطاق التدوين غير معلن', 'CONFIG_PERSISTENCE_SCOPE');
  }
  for (const kind of scope) {
    if (!(DURABLE_KINDS as readonly string[]).includes(kind)) {
      throw new SovereignViolation(`صنف تدوين غير معروف: ${kind}`, 'CONFIG_PERSISTENCE_SCOPE');
    }
  }
  validateCompaction(raw);
  validateArchives(raw);
  return raw;
}

/**
 * T-123: العتبةُ تُعلَن أو يُرفض الإقلاع. وشرطُ كونها دون سقفِ القيود جوهريّ:
 * عتبةٌ فوق السقف تعني أن اليوميّة ترفض الكتابة قبل أن يُنادى الضغطُ مرّةً — فتكون
 * السياسةُ حرفًا لا حكمًا (RULE-005: لا قيمةَ زينة في التهيئة).
 */
function validateCompaction(raw: PersistenceConfig): void {
  const compaction = raw.compaction;
  if (!compaction) {
    throw new SovereignViolation(
      'عتبة مناداة الضغط غير معلنة — و«يُنادى يدويًّا» ليست سياسة (T-123)',
      'CONFIG_PERSISTENCE_COMPACTION',
    );
  }
  if (!Number.isSafeInteger(compaction.compact_at_records) || compaction.compact_at_records <= 0) {
    throw new SovereignViolation('عتبة الضغط غير صالحة', 'CONFIG_PERSISTENCE_COMPACTION');
  }
  if (compaction.compact_at_records >= raw.policy.max_journal_records) {
    throw new SovereignViolation(
      'عتبة الضغط يجب أن تقلّ عن سقف قيود اليوميّة — وإلا رُفضت الكتابة قبل أن يُنادى الضغط',
      'CONFIG_PERSISTENCE_COMPACTION',
    );
  }
  if (!Number.isSafeInteger(compaction.min_interval_ms) || compaction.min_interval_ms <= 0) {
    throw new SovereignViolation(
      'فاصل الضغط الأدنى يجب أن يكون موجبًا — الضغط بلا فاصل استنزافٌ لا حماية',
      'CONFIG_PERSISTENCE_COMPACTION',
    );
  }
}

/**
 * T-123: الاحتفاظُ يُعلَن، وحرسُ الشاهد لا يُعطَّل بتهيئة: `false` رفضُ إقلاع.
 * ومحوُ الأرشيفات كلّها ممنوع بـ`keep_min ≥ 1`: مقابلةُ المضغوطِ بأصله حقٌّ لا يسقط.
 */
function validateArchives(raw: PersistenceConfig): void {
  const archives = raw.archives;
  if (!archives) {
    throw new SovereignViolation(
      'سياسة احتفاظ الأرشيفات غير معلنة — والتراكم بلا حدّ ليس سياسة (T-123)',
      'CONFIG_PERSISTENCE_ARCHIVES',
    );
  }
  if (!Number.isSafeInteger(archives.keep_min) || archives.keep_min < 1) {
    throw new SovereignViolation(
      'أقلّ ما يُحتفظ به من الأرشيفات أرشيفٌ واحد على الأقل',
      'CONFIG_PERSISTENCE_ARCHIVES',
    );
  }
  if (!Number.isSafeInteger(archives.max_age_ms) || archives.max_age_ms <= 0) {
    throw new SovereignViolation('عمر الأرشيف الأقصى غير صالح', 'CONFIG_PERSISTENCE_ARCHIVES');
  }
  if (archives.require_witness_coverage !== true) {
    throw new SovereignViolation(
      'إثبات تغطية الشاهد قبل المحو إلزامٌ — لا تُمحى شهادةٌ مطلوبة بسياسة تُعطّله',
      'CONFIG_PERSISTENCE_ARCHIVES',
    );
  }
}
