/**
 * src/recovery/backup_scheduler.ts — جدولة النسخ الدورية المقيدة بسياسة RPO (المرحلة 32)
 * المالك: وزارة البنية | المدخلات: الوقت وسياسة النسخ | المخرجات: نسخة أو انتظار معلن
 * التبعيات: RecoverySnapshotStore والسجل | الصلاحيات: لا يغير السياسة ولا يستعيد
 * السجلات: recovery_backup_due / recovery_backup_skipped
 * حالات الفشل: زمن راجع أو تهيئة غير صالحة ⇒ لا وعد كاذب ولا نسخة صامتة
 * اختبارات الوحدة: tests/recovery/backup_scheduler.test.ts
 * اختبار القبول: tests/recovery/recovery_lifecycle.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0016-recovery.md
 * ثوابت هذه الوحدة:
 *   1) لا تؤخذ نسخة قبل الفاصل: RPO سياسة تنفيذية لا تعليق.
 *   2) النسخة عند الحد مسموحة: يختبر الحد وفوقه بواحد.
 *   3) لا ساعة راجعة: تمنع نسب زمنية مضللة عند الانقطاع.
 */
import { AppendOnlyLog } from '../audit/append_only_log';
import { RecoverySnapshotStore } from './snapshot';
export class BackupScheduler {
  private lastAt: number | null = null;
  constructor(private readonly store: RecoverySnapshotStore, private readonly audit: AppendOnlyLog, readonly intervalSeconds: number) {}
  runIfDue(now = Date.now()): { readonly taken: boolean; readonly file?: string } {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('RECOVERY_TIME_INVALID');
    if (this.lastAt !== null && now < this.lastAt) throw new Error('RECOVERY_TIME_REVERSED');
    if (this.lastAt !== null && now - this.lastAt < this.intervalSeconds * 1000) {
      this.audit.append('ministry:infrastructure', 'recovery_backup_skipped', { now, lastAt: this.lastAt });
      return { taken: false };
    }
    const taken = this.store.take(now); this.lastAt = now;
    this.audit.append('ministry:infrastructure', 'recovery_backup_due', { now, file: taken.file });
    return { taken: true, file: taken.file };
  }
}
