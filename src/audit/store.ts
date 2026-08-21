/**
 * src/audit/store.ts — ثبات سجل التدقيق على القرص والنسخ الاحتياطية (المرحلتان 10 و32)
 * المالك: ديوان التدقيق
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: سجل في الذاكرة | المخرجات: ملف سلسلة على القرص + نسخ احتياطية مؤرَّخة
 * الصلاحيات: كتابة إضافية واستعادة متحقَّق منها — لا حذف لسجل من الملف
 * حالات الفشل (كلها مغلقة):
 *   - ملف مفقود ⇒ استعادة ترفض ولا تُنشئ سلسلة فارغة صامتة
 *   - ملف معدَّل ⇒ التحقق يفشل والاستعادة تُرفض
 *   - بصمة الملف لا تطابق محتواه ⇒ رفض
 * اختبار القبول: tests/audit/store.test.ts
 * الوثيقة المرتبطة: docs/specs/digital-state-build-guide.md — الرقابة والتدقيق، التعافي
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AuditEntry } from '../kernel/types';
import { AppendOnlyLog } from './append_only_log';
import { canonicalize, sha256 } from '../identity/keys';

export interface AuditFile {
  readonly version: 1;
  readonly savedAt: number;
  readonly length: number;
  readonly headHash: string;
  readonly checksum: string; // بصمة المحتوى كاملًا — تكشف تعديل الملف من الخارج
  readonly entries: readonly AuditEntry[];
}

function checksumOf(entries: readonly AuditEntry[]): string {
  return sha256(canonicalize(entries));
}

export class AuditStore {
  constructor(private readonly path: string) {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /** كتابة السجل كاملًا مع بصمة — لا تُكتب سلسلة غير سليمة */
  save(log: AppendOnlyLog, now = Date.now()): AuditFile {
    const report = log.verifyIntegrity();
    if (!report.valid) {
      throw new Error(`رفض الحفظ: السلسلة غير سليمة (${report.reason} عند ${report.brokenAt})`);
    }
    const entries = log.snapshot();
    const file: AuditFile = {
      version: 1,
      savedAt: now,
      length: entries.length,
      headHash: entries.length ? entries[entries.length - 1]!.hash : '0'.repeat(64),
      checksum: checksumOf(entries),
      entries,
    };
    writeFileSync(this.path, JSON.stringify(file), 'utf8');
    return file;
  }

  exists(): boolean {
    return existsSync(this.path);
  }

  /** استعادة متحقَّق منها: بصمة الملف ثم سلسلة التجزئة كاملة */
  load(): AppendOnlyLog {
    if (!this.exists()) throw new Error(`ملف السجل غير موجود: ${this.path} — فشل مغلق`);
    const file = JSON.parse(readFileSync(this.path, 'utf8')) as AuditFile;
    if (file.version !== 1) throw new Error('إصدار ملف سجل غير مدعوم');
    if (file.length !== file.entries.length) throw new Error('طول الملف لا يطابق عدد السجلات');
    if (checksumOf(file.entries) !== file.checksum) {
      throw new Error('بصمة ملف السجل لا تطابق محتواه — تلاعب مكتشف');
    }
    const log = AppendOnlyLog.import(JSON.stringify(file.entries)); // يتحقق من السلسلة أو يرفض
    const head = log.snapshot()[log.length - 1];
    if (log.length > 0 && head!.hash !== file.headHash) {
      throw new Error('رأس السلسلة لا يطابق المعلن في الملف');
    }
    return log;
  }

  /** نسخة احتياطية مؤرَّخة مع تدوير — تُبقي أحدث N نسخة */
  backup(log: AppendOnlyLog, backupDir: string, keep = 5, now = Date.now()): string {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
    const target = join(backupDir, `audit-${now}.json`);
    const tmp = new AuditStore(target);
    tmp.save(log, now);
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith('audit-') && f.endsWith('.json'))
      .sort();
    while (files.length > keep) {
      const oldest = files.shift()!;
      unlinkSync(join(backupDir, oldest));
    }
    return target;
  }

  /** استعادة من أحدث نسخة احتياطية سليمة، وتجاهل الفاسدة بترتيب تنازلي */
  static restoreLatest(backupDir: string): { log: AppendOnlyLog; from: string } {
    if (!existsSync(backupDir)) throw new Error(`مجلد النسخ غير موجود: ${backupDir}`);
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith('audit-') && f.endsWith('.json'))
      .sort()
      .reverse();
    const failures: string[] = [];
    for (const f of files) {
      try {
        const log = new AuditStore(join(backupDir, f)).load();
        return { log, from: f };
      } catch (err) {
        failures.push(`${f}: ${(err as Error).message}`);
      }
    }
    throw new Error(`لا توجد نسخة احتياطية سليمة. المحاولات: ${failures.join(' | ') || 'لا ملفات'}`);
  }
}
