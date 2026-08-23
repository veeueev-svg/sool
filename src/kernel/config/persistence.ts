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
] as const;
export type DurableKind = (typeof DURABLE_KINDS)[number];

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
  return raw;
}
