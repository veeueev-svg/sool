/**
 * src/composition/deploy_declaration.ts — حصرُ إعلانِ النشر في مسار التركيب (المرحلة 40، البند T-138)
 * المالك: القيّم على المستودع | المراجع: القيّم على المستودع (RULE-004)
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: جذرُ مجلد النشر (`deploy/`) يُستنبط صعودًا كما تفعل قارئاتُ البيان
 * المخرجات: `DeployDeclarationCensus` — مجلداتٌ وملفاتٌ وبايتاتٌ **مقيسةٌ لا موصوفة**
 * التبعيات: `guardDeclarationDirectoryBytes` و`storedDirectoryMeasure` من `src/kernel/config`
 *   — تُعاد استعمالًا لا نسخًا: **هذه الوحدةُ لا تُنشئ حرَسًا ثانيًا، بل تُنادي الحرَسَ القائمَ
 *   في الموضع الصحيح** (وهو نصُّ §3 من عقد `W-2026-003`)
 * الصلاحيات: تقيس وترفض؛ ولا تُصلح إعلانًا ولا تكتب ملفًّا ولا ترفع سقفًا
 * السجلات: لا تكتب — من ينادي الحصرَ هو من يُقيّد قياسَه في السجل (RULE-009)
 * حالات الفشل (كلها مغلقة بأسمائها):
 *   1) مجلدُ النشر غير موجود ⇒ `MANIFEST_DEPLOY_DIR_MISSING`
 *   2) مجلدُ بيئةٍ معلنةٍ غير موجود ⇒ `MANIFEST_DEPLOY_DIR_MISSING`
 *   3) مجموعُ بايتات مجلدِ بيئةٍ فوق السقف ⇒ `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING`
 *   4) عمقُ مجلداتٍ فوق المدى المعلن ⇒ `CONFIG_DECLARATION_REACH_TOO_DEEP`
 *   ولا رمزَ جديدٌ في هذا الملف: الأربعةُ **من المعجم المغلق القائم** (شرطُ قبولِ البند)
 * اختبارُ القبول: tests/composition/deploy_declaration.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0043-deploy-declaration-census.md
 *   · التقرير: docs/test-reports/phase-40-T138.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T138.txt
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **الحصرُ قبل البناء لا عند القراءة**: كان `deploy/staging` و`deploy/production`
 *      يُحرسان في `composeOperations` — آخرِ المُركِّبات — فتُبنى الدولةُ تسعةَ أعشارِها
 *      ثمّ يُقال «إعلانُ النشر أكبرُ من ميزانيّته». وهذا عينُ ما رُفض في `T-130` لمجلد
 *      التهيئة، فسُدّت العلّةُ في مجلدٍ وبقيت في مجلدَين. فصار الحصرُ يقع في
 *      `composeSovereignty` **قبل السجل نفسِه**.
 *
 *   2) **البيئاتُ تُعلَن ولا تُكتشف**: لا يُمشى مجلدُ `deploy/` فيُحرس ما وُجد فيه، بل
 *      تُعلن البيئاتُ قائمةً مجمَّدةً (`DEPLOY_DECLARATION_DIRS`). ومن أضاف بيئةً ثالثةً
 *      ولم يُعلنها لم يُحرس إعلانُها — **وهذا حدٌّ يُعلن لا يُخبَّأ**، وهو مكتوبٌ في §«ما
 *      بقي» من تقرير البند. والسببُ أنّ المشيَ الحرَّ يجعل الحرَسَ يتبع القرصَ لا الإعلانَ،
 *      فيصير عددُ العمل المعدود (T-134) رهنَ ما كتبه أحدٌ في مجلد.
 *
 *   3) **مفتاحُ القياس هو مفتاحُ القارئ نفسُه**: يُحرس `deploy/<البيئة>` لا `deploy/`،
 *      لأنّ دفترَ قياسِ المجلدات (T-140) مُفهرسٌ بمجلدِ الملفِّ المقروء. فلو حُرس الجذرُ
 *      لمُشِيَ المجلدُ مرّتين — مرّةً هنا ومرّةً عند أوّل قراءة — فيُدفَع عملُ إقلاعٍ مرّتين
 *      بلا حكمٍ زائد. وبهذا المفتاح يجد القارئُ قياسًا محفوظًا فيُعَدّ `dir_reuses` لا
 *      `dir_walks`: **الحرَسُ قُدِّم ولم يُضاعَف**.
 *
 *   4) **الحرَسُ عند القراءة يبقى كما هو**: هذه الوحدةُ تُقدِّم الحرَسَ ولا تنقله. فمن نادى
 *      `loadStagingManifest` مفردًا بلا إقلاعٍ يبقى محروسًا كما كان — ولا يُقبل إعلانٌ في
 *      طريقٍ ويُرفض في طريق (درسُ `T-133`).
 *
 *   5) **الغيابُ يُرفض هنا كما كان يُرفض هناك**: مجلدُ نشرٍ غائبٌ كان يُسقط الإقلاعَ في
 *      `composeOperations` برمزِ `MANIFEST_DEPLOY_DIR_MISSING`، فصار يُسقطه أبكرَ **بالرمز
 *      نفسِه**. فلا حالةَ فشلٍ جديدةٌ أُضيفت، ولا رمزَ رفضٍ تغيّر لمن يقرؤه.
 *
 *   6) **ومستنبِطُ الجذر مكرَّرٌ ثالثًا — دَينٌ مُعلنٌ بندًا (`T-145`)**: يستنبط هذا الملفُّ
 *      جذرَ النشر صعودًا، وتستنبطه `resolveDeployDir` و`resolveProductionDeployDir`
 *      كذلك — ثلاثةُ مواضعَ تصعد بشرطٍ واحد. وقد وُحِّد **الشرطُ** ولم يُوحَّد **الكود**،
 *      لأنّ توحيدَه يمسّ قارئتَي بيانٍ خارجَ نطاقِ هذا البند المحجوز (خطوة 2 من
 *      `docs/work/WORK_CONTROL.md`: النطاقُ يُعلن ولا يُوسَّع في أثناء العمل بلا إعلان).
 *      وأثرُه المقيس: مَن مرّر `deployDir` في تشغيلٍ حقيقيٍّ حرَس مجلدًا وقرأ غيرَه —
 *      **ولذلك لا يُمرَّر إلّا في اختبار**، والاختبارُ يُثبت الفرقَ صراحةً لا ضِمنًا.
 */
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { SovereignViolation } from '../kernel/types';
import { guardDeclarationDirectoryBytes, storedDirectoryMeasure } from '../kernel/config';

/**
 * بيئاتُ النشر المعلنةُ حصرًا — مجمَّدةٌ في التشغيل لا `readonly` في الترجمة وحدَها
 * (ثابت 2). وليست تعدادَ تهيئةٍ يحدُّ قيمةً يُعلنها المستعمل، بل قائمةُ **مجلداتٍ يقرؤها
 * هذا الملفُّ**، فلا صفَّ لها في سجل التعدادات المغلقة (`closed_enums.ts`) — وسجلُّ ذاك
 * مدخلُه `src/kernel/config/*.ts` و`src/kernel/types.ts` نصًّا.
 */
export const DEPLOY_DECLARATION_DIRS = Object.freeze(['staging', 'production'] as const);

/** حصرُ إعلانِ النشر: يُقرأ ولا يُستنتج، ويُقيَّد في السجل كما يُقيَّد حصرُ التهيئة */
export type DeployDeclarationCensus = {
  /** جذرُ مجلد النشر كما استُنبط — يُدوَّن لأنّ حصرًا لا يُعرف موضعُه لا يُراجَع */
  readonly root: string;
  /** عددُ مجلدات البيئات المحروسة */
  readonly dirs: number;
  /** عددُ ملفات الإعلان فيها جميعًا — بما في المجلدات الفرعيّة (`runbooks/`) */
  readonly files: number;
  /** مجموعُ بايتاتها جميعًا */
  readonly bytes: number;
  /** أسماءُ البيئات المحروسة بترتيب إعلانها */
  readonly names: readonly string[];
};

/**
 * يبحث عن جذر مجلد النشر صعودًا — **بالشرط الذي تبحث به قارئتا البيان نفسِه**
 * (`deploy/staging/manifest.yaml`)، فلا يُستنبط جذرٌ هنا ويُستنبط غيرُه هناك.
 * @param startDir موضعُ البدء — لا يُمرَّر من خارج الوحدة إلّا في اختبارٍ يقصده
 */
export function resolveDeployRoot(startDir = __dirname): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'deploy', 'staging', 'manifest.yaml'))) return join(dir, 'deploy');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation(
    'مجلد النشر غير موجود: deploy — ولا تُقلع دولةٌ على إعلانِ نشرٍ لا يُحصى (T-138)',
    'MANIFEST_DEPLOY_DIR_MISSING',
  );
}

/**
 * **يحصر إعلانَ النشر ويحرس مجموعَه قبل بناء الدولة** (البند T-138).
 *
 * وهو نداءٌ للحرَس القائم لا حرَسٌ جديد: لكلِّ بيئةٍ معلنةٍ يُنادى
 * `guardDeclarationDirectoryBytes` بمفتاحِ مجلدِها — فيقع السقفُ برمزِه
 * `CONFIG_DECLARATION_DIR_BYTES_OVER_CEILING`، ويُحفظ القياسُ ببصمتِه (T-140)،
 * ويُعاد التحقّقُ منه في خاتمة الإقلاع (T-141) بلا سطرٍ يُضاف هنا.
 *
 * @param root جذرُ مجلد النشر — يُمرَّر في الاختبار ليُنفخ إعلانٌ في نسخةٍ لا في المستودع
 * @returns الحصرُ مقيسًا — يُقيَّده النادي في السجل (RULE-009)
 */
export function guardDeployDeclaration(root = resolveDeployRoot()): DeployDeclarationCensus {
  let bytes = 0;
  let files = 0;
  for (const name of DEPLOY_DECLARATION_DIRS) {
    const dir = join(root, name);
    if (!existsSync(dir)) {
      throw new SovereignViolation(
        `مجلدُ بيئةِ نشرٍ معلنةٍ غير موجود: ${dir} — والبيئةُ المعلنةُ بلا إعلانٍ على القرص `
        + 'دعوى لا تُقرأ (T-138)',
        'MANIFEST_DEPLOY_DIR_MISSING',
      );
    }
    // السقفُ يقع هنا برمزِه القائم — ولا يُبتلع ولا يُبدَّل رمزُه (RULE-007)
    bytes += guardDeclarationDirectoryBytes(dir);
    // عددُ الملفات يُقرأ من القياس المحفوظ لا بمشيةٍ ثانية: لا عملَ إقلاعٍ يُدفع مرّتين
    files += storedDirectoryMeasure(dir)?.files ?? 0;
  }
  return {
    root,
    dirs: DEPLOY_DECLARATION_DIRS.length,
    files,
    bytes,
    names: DEPLOY_DECLARATION_DIRS,
  };
}
