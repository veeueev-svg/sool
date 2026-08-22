/**
 * src/recovery/restore_runner.ts — تشغيل استعادة القرص عبر الأرشيف الملكي (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: أمر ملكي واسم نسخة | المخرجات: قرار استعادة كامل أو رفض
 * التبعيات: RecoverySnapshotStore وRoyalArchive والاستمرارية | الصلاحيات: archive_restore فقط
 * السجلات: archive_restore_* من الأرشيف وcontinuity_mode_changed
 * حالات الفشل: ملف محرّف أو أمر مرفوض أو تحقق بعدي فاشل ⇒ رجوع الحالة السابقة
 * اختبارات الوحدة: tests/recovery/restore_runner.test.ts
 * اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0016-recovery.md
 * ثوابت هذه الوحدة:
 *   1) قراءة الملف لا تبدل الدولة: الأرشيف الملكي هو مسار التبديل الوحيد.
 *   2) لا قبول بلا تحقق بعدي: سياسة false مرفوضة عند التحميل.
 *   3) لا فك للتوالد: لا يستدعي هذا الملف thaw مطلقا.
 */
import { SignedRoyalCommand, Decision } from '../kernel/types';
import { RoyalArchive } from '../data/royal_archive';
import { ContinuityController } from './continuity';
import { RecoverySnapshotStore } from './snapshot';
export class RestoreRunner {
  constructor(private readonly store: RecoverySnapshotStore, private readonly archive: RoyalArchive, private readonly continuity: ContinuityController) {}
  restore(command: SignedRoyalCommand, file: string, now = Date.now()): Decision {
    try {
      const loaded = this.store.load(file);
      const result = this.archive.restore(command, loaded.archive.snapshotId, now);
      this.continuity.completeRestore(result.allowed, now);
      return result;
    } catch (error) {
      this.continuity.completeRestore(false, now);
      throw error;
    }
  }
}
