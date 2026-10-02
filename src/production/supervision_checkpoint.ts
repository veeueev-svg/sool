/**
 * src/production/supervision_checkpoint.ts — نقطة تفتيش تعبر إعادة التشغيل (المرحلة 37)
 * المالك: ديوان التدقيق — المراقب يكتبها والمراقب يقرؤها، ولا يكتبها مشغّل (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مجلد معلن في `config/production.yaml` وتقرير المراقبة اللحظي
 * المخرجات: ملف JSON بمجموع تحقّق، تُقرأ منه فجوة إعادة التشغيل فتُقاس ولا تُفترض
 * التبعيات: canonicalize/sha256 من وحدة المفاتيح، نظام الملفات
 * الصلاحيات: الكتابة في مجلد الحالة المعلن وحده؛ ولا يقرأ الملف كإقلاعٍ أول لو عُدّل
 * السجلات: لا تُسجّل الوحدة بنفسها — المراقب يُقيّد `production_checkpoint_written`
 * ثوابت هذه الوحدة:
 *   1) **الغياب ليس صفرًا**: ملفٌ غير موجود ⇒ `null` (إقلاع أول معلن)، لا فجوة صفرية
 *      تُقرأ سلامةً — لأن «لا أعرف» ليست «لا فجوة»
 *   2) **العبث يُرفض ولا يُطوى**: ملفٌ عُدّل من الخارج يرمي `CHECKPOINT_TAMPERED`،
 *      فلا تصير إعادةُ التشغيل بابًا لمسح الزمن (RULE-006 و RULE-007)
 *   3) **الحالة ليست وثيقة**: تُكتب في `.state/` المستثنى من الإصدار، فلا يُدفع تشغيلٌ
 *      إلى المستودع بدلًا من توثيقه
 *   4) **جذرُ الدولةِ يُستنبط أو يُرفض** (T-157 · W-2026-042): المسارُ النسبيُّ يُحلّ من الجذرِ
 *      الذي فيه `package.json` بالمصعدِ الواحدِ `ascendToDeclaredDir`؛ ومن لم يجده في المدى
 *      **يُرفض بـ`SUPERVISION_STATE_ROOT_MISSING`** — وكان يسقط صامتًا إلى `process.cwd()`
 *      فتُكتب نقطةُ التفتيشِ في جذرٍ ليس جذرَها بلا رمزٍ ولا سجلّ.
 * حالات الفشل (كلها مغلقة): مجلد غير موجود ⇒ يُنشأ؛ ملف تالف/معدَّل ⇒ رفض صريح؛
 *   قراءة بلا كتابة سابقة ⇒ null؛ جذرُ الدولةِ غيرُ موجودٍ في المدى ⇒ SUPERVISION_STATE_ROOT_MISSING
 * اختبار القبول: tests/production/continuous_supervisor.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0021-federated-operation.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { SovereignViolation } from '../kernel/types';
import { ascendToDeclaredDir } from '../kernel/config/paths';
import { canonicalize, sha256 } from '../identity/keys';

export interface SupervisionCheckpoint {
  /** لحظة آخر مسحة ناجحة */
  readonly at: number;
  readonly sweeps: number;
  readonly incidents: number;
  readonly bootAt: number;
}

interface CheckpointFile {
  readonly checkpoint: SupervisionCheckpoint;
  readonly checksum: string;
}

/** يحلّ موضع الملف: المسار المعلن نسبيًّا يُحلّ من جذر المستودع لا من مجلد التشغيل */
export function resolveCheckpointPath(directory: string, root?: string): string {
  const base = isAbsolute(directory)
    ? directory
    : resolve(root ?? resolveStateRoot(), directory);
  return join(base, 'supervision.json');
}

/** ثابت 4 (T-157): جذرُ الدولةِ بالمصعدِ الواحد — أو رفضٌ مغلق، ولا `process.cwd()` بديلًا صامتًا */
export function resolveStateRoot(startDir = __dirname): string {
  return ascendToDeclaredDir({
    sentinel: ['package.json'],
    result: [],
    code: 'SUPERVISION_STATE_ROOT_MISSING',
    message: 'جذر الدولة غير موجود — لا تُكتب نقطة التفتيش في مجلد التشغيل الحالي (فشل مغلق · T-157)',
  }, startDir);
}

export class CheckpointStore {
  constructor(private readonly path: string) {}

  /** ثابت 1: الغياب يُعلن غيابًا */
  read(): SupervisionCheckpoint | null {
    if (!existsSync(this.path)) return null;
    let parsed: CheckpointFile;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CheckpointFile;
    } catch {
      throw new SovereignViolation(
        'نقطة التفتيش غير قابلة للقراءة — لا تُقرأ فجوةٌ من ملف تالف',
        'CHECKPOINT_UNREADABLE',
      );
    }
    if (!parsed || !parsed.checkpoint || typeof parsed.checksum !== 'string') {
      throw new SovereignViolation(
        'نقطة تفتيش بلا مجموع تحقّق — لا يُبنى قياس على ما لا يُتحقّق منه',
        'CHECKPOINT_UNREADABLE',
      );
    }
    // ثابت 2: العبث يُرفض
    if (sha256(canonicalize(parsed.checkpoint)) !== parsed.checksum) {
      throw new SovereignViolation(
        'نقطة التفتيش عُدّلت من خارج المراقب — إعادة التشغيل لا تمسح الزمن',
        'CHECKPOINT_TAMPERED',
      );
    }
    return parsed.checkpoint;
  }

  write(checkpoint: SupervisionCheckpoint): void {
    const directory = dirname(this.path);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    const file: CheckpointFile = {
      checkpoint,
      checksum: sha256(canonicalize(checkpoint)),
    };
    writeFileSync(this.path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}
