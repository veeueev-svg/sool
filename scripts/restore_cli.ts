/**
 * scripts/restore_cli.ts — واجهة تنفيذ الاستعادة الملكية من ملف قرصي (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: مجلد تهيئة وملف نسخة | المخرجات: نتيجة أمر archive_restore
 * التبعيات: node:fs وbootstrapState وRestoreRunner | الصلاحيات: لا يبدل حالة إلا بالأمر الملكي الموقّع
 * السجلات: جميعها عبر RoyalArchive وAppendOnlyLog | حالات الفشل: يطبع السبب وينهي التنفيذ برمز فشل
 * اختبارات الوحدة: tests/recovery/restore_runner.test.ts | اختبار القبول: recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: infra/disaster-recovery/RUNBOOK.md
 * ثوابت هذه الواجهة: 1) الملف لا يستعاد مباشرة؛ 2) لا thaw؛ 3) الفشل لا يعلن نجاحا.
 */
import { readFileSync } from 'node:fs';
import { bootstrapState } from '../src/index';

const [configDir, snapshotFile] = process.argv.slice(2);
if (!configDir || !snapshotFile) {
  throw new Error('الاستخدام: restore.sh <مجلد-التهيئة> <ملف-النسخة>');
}
const raw = JSON.parse(readFileSync(snapshotFile, 'utf8')) as { archive?: { snapshotId?: string } };
const snapshotId = raw.archive?.snapshotId;
if (!snapshotId) throw new Error('RECOVERY_SNAPSHOT_ID_MISSING');
const state = bootstrapState({ configDir });
const now = Date.now();
const command = state.king.issueCommand('archive_restore', snapshotId, {}, now);
const result = state.restoreRunner.restore(command, snapshotFile, now);
if (!result.allowed) throw new Error(`RECOVERY_RESTORE_REFUSED:${result.reason}`);
console.log(`استعادة ناجحة: ${snapshotId}؛ التوالد مجمّد؛ وضع الاستمرارية=${state.continuity.current.mode}`);
