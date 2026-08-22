/**
 * src/kernel/config/paths.ts — تحديد مجلد التهيئة
 * المالك: القيّم على المستودع | المرحلة: 2
 * المدخلات: موقع التنفيذ (src أو dist) | المخرجات: مسار مجلد config
 * حالات الفشل: مجلد التهيئة غير موجود ⇒ CONFIG_DIR_MISSING (فشل مغلق)
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SovereignViolation } from '../types';

/**
 * يحدد مجلد config بالبحث صعودًا من موقع التنفيذ (يعمل من src ومن dist معًا).
 * فشل الإيجاد = فشل مغلق: الدولة لا تعمل بلا تهيئة معلنة (RULE-007).
 */
export function resolveConfigDir(startDir = __dirname): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'config', 'royal-authority.yaml');
    if (existsSync(candidate)) return join(dir, 'config');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation('مجلد التهيئة غير موجود — فشل مغلق', 'CONFIG_DIR_MISSING');
}
