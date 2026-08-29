/**
 * src/kernel/config/paths.ts — تحديد مجلد التهيئة، ومصعدُ المجلدات المُعلنِ الواحد
 * المالك: القيّم على المستودع | المرحلة: 2 (والمصعدُ المشتركُ: المرحلة 40 — البند T-145)
 * المدخلات: موقع التنفيذ (src أو dist) ودليلٌ مُعلَنٌ يُبحث عنه صعودًا
 * المخرجات: مسارُ المجلدِ المُعلَن (مجلدُ التهيئة · مجلدُ النشر · مجلدُ بيئةِ نشر)
 * التبعيات: `existsSync` و`path` و`SovereignViolation` — ولا تهيئةَ تُقرأ هنا
 * الصلاحيات: تستنبط وترفض؛ ولا تُنشئ مجلدًا ولا تُصلح إعلانًا ولا تختار بديلًا صامتًا
 * السجلات: لا تكتب — من يستنبط هو من يُقيّد قياسَه (RULE-009)
 * حالات الفشل: الدليلُ المُعلَنُ غير موجودٍ في المدى ⇒ رفضٌ **برمزِ النادي ورسالتِه**
 *   (`CONFIG_DIR_MISSING` لمجلد التهيئة، وسائرُ الرموز تأتي من موضعِ النداء)
 * اختبارُ القبول: tests/kernel/declared_dir_ascent.test.ts (والقائمُ: tests/kernel/config_*.test.ts)
 * الوثيقة المرتبطة: docs/test-reports/phase-40-T145.md
 *   · القياسُ الخام: docs/audit/measurements/phase-40-T145.txt
 *
 * أُخرِج من `src/kernel/config.ts` في ورشة الهيكلة (الإصدار 0.24.0) بلا تغيير سلوك:
 * نفس النصّ ونفس رموز الرفض. والواجهة القديمة ما زالت تُصدّر كل ما هنا.
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **مصعدٌ واحدٌ لا أربعة** (T-145): كانت أربعُ دوالَّ تكتب حلقةَ الصعودِ نفسَها بالحدِّ
 *      نفسِه — `resolveConfigDir` هنا، و`resolveDeployRoot` في `src/composition/deploy_declaration.ts`،
 *      و`resolveDeployDir` في `src/staging/manifest.ts`، و`resolveProductionDeployDir` في
 *      `src/production/production_manifest.ts`. **والمقيسُ أنّ الحدَّ `8` كان أربعَ نسخٍ
 *      مستقلّةً لا ثابتًا واحدًا**: غُيِّر في موضعٍ واحدٍ في نسخةٍ من `dist/` فتغيّر سلوكُ
 *      دالّةٍ واحدةٍ وبقيت الثلاثُ كما هي (§3 من القياس الخامّ). فصار الصعودُ آلةً واحدةً
 *      هنا، والحدُّ ثابتًا مُعلَنًا باسمه.
 *
 *   2) **الآلةُ تُوحَّد والحكمُ لا يُوحَّد**: كلُّ نادٍ يُعلن **دليلَه** (`sentinel`) و
 *      **مُخرَجَه** (`result`) و**رمزَ رفضِه ونصَّه**، فتُحفظ رموزُ الرفضِ الثلاثةُ القائمةُ
 *      كما هي حرفًا (`CONFIG_DIR_MISSING` · `MANIFEST_DEPLOY_DIR_MISSING` ·
 *      `PRODUCTION_MANIFEST_DEPLOY_DIR_MISSING`). **ولم يُوحَّد رمزٌ ولا نصٌّ**، لأنّ توحيدَ
 *      الرموزِ تغييرُ عقدٍ مع كلِّ من يقرؤها — قرارٌ للمراجعِ لا للمنفّذ (RULE-004).
 *
 *   3) **الحدُّ ثابتُ شفرةٍ لا مفتاحُ تهيئة**: `DECLARED_DIR_ASCENT_LIMIT` لا يُقرأ من ملفٍّ،
 *      لأنّ من يستنبط مجلدَ التهيئةِ لا يستطيع أن يقرأ التهيئةَ ليعرف كيف يستنبطه — دَورٌ
 *      لا يُغلق. فالحدُّ يُعلن في الشفرةِ ويُقاس في اختبارٍ ولا يُخفى في حلقة.
 *
 *   4) **الرفضُ مغلقٌ ولا بديلَ صامت**: من لم يجد دليلَه في المدى **يُرفض برمز**، ولا يُرجَع
 *      `process.cwd()` ولا يُخترع جذرٌ. وثمّةَ مصعدٌ خامسٌ في المستودعِ يفعل غيرَ ذلك —
 *      `resolveStateRoot` في `src/production/supervision_checkpoint.ts` يسقط صامتًا إلى
 *      `process.cwd()` — **ولم يُوحَّد هنا لأنّ توحيدَه يُبدّل سقوطًا صامتًا برفضٍ مغلق،
 *      وذلك تغييرُ سلوكٍ يحكم فيه المراجع**. فأُعلن دَينًا مرقَّمًا (`T-157`) ولم يُبتلع.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SovereignViolation } from '../types';

/**
 * مدى الصعود المُعلَن — ثابتٌ **واحدٌ** تقرؤه كلُّ المُستنبِطات (ثابت 1 و3).
 * ومن غيّره غيّرها جميعًا، وذلك مقيسٌ في `tests/kernel/declared_dir_ascent.test.ts`.
 */
export const DECLARED_DIR_ASCENT_LIMIT = 8;

/** رمزُ الرفضِ كما يقبله `SovereignViolation` — يُشتقُّ منه ولا يُعاد تعريفُه */
type ViolationCode = ConstructorParameters<typeof SovereignViolation>[1];

/**
 * إعلانُ صعودٍ واحد: **ما الدليل، وما يُرجَع إن وُجد، وبأيِّ رمزٍ يُرفض إن لم يوجد**.
 * والثلاثةُ تُعلَن في موضعِ النداء (ثابت 2) — فالآلةُ هنا والحكمُ هناك.
 */
export interface DeclaredDirAscent {
  /** أجزاءُ مسارِ الدليلِ نسبيًّا من المُرشَّح — مثالُه: `['config', 'royal-authority.yaml']` */
  readonly sentinel: readonly string[];
  /** أجزاءُ المسارِ المُرجَعِ نسبيًّا من المُرشَّح — قد تكون فارغةً فيُرجَع المُرشَّحُ نفسُه */
  readonly result: readonly string[];
  /** رمزُ الرفضِ المغلقُ للنادي — لا يُوحَّد ولا يُبدَّل (ثابت 2) */
  readonly code: ViolationCode;
  /** نصُّ الرفضِ كما يقرؤه صاحبُه — يُنقل حرفًا ولا يُعاد صياغتُه هنا */
  readonly message: string;
}

/**
 * **يصعد شجرةَ المجلداتِ حتّى يجد دليلًا مُعلَنًا، أو يرفض برمزِ نادِيه** (T-145).
 *
 * وهي الآلةُ الوحيدةُ للصعودِ في المستودع: تعمل من `src/` ومن `dist/` معًا، ومداها
 * `DECLARED_DIR_ASCENT_LIMIT`، وتتوقّف عند جذرِ نظامِ الملفّاتِ ولو بقي من المدى بقيّة.
 *
 * @param ascent الإعلانُ: الدليلُ والمُخرَجُ ورمزُ الرفضِ ونصُّه
 * @param startDir موضعُ البدء — لا يُمرَّر من خارجِ الوحدةِ إلّا في اختبارٍ يقصده
 * @returns مسارَ المجلدِ المُعلَنِ مُطلقًا
 * @throws SovereignViolation برمزِ النادي إن لم يوجد الدليلُ في المدى (RULE-007)
 */
export function ascendToDeclaredDir(ascent: DeclaredDirAscent, startDir: string): string {
  let dir = resolve(startDir);
  for (let i = 0; i < DECLARED_DIR_ASCENT_LIMIT; i += 1) {
    if (existsSync(join(dir, ...ascent.sentinel))) return join(dir, ...ascent.result);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new SovereignViolation(ascent.message, ascent.code);
}

/**
 * يحدد مجلد config بالبحث صعودًا من موقع التنفيذ (يعمل من src ومن dist معًا).
 * فشل الإيجاد = فشل مغلق: الدولة لا تعمل بلا تهيئة معلنة (RULE-007).
 *
 * والدليلُ والرمزُ والنصُّ كما كانا حرفًا — وحدَها الحلقةُ صارت مُشتركةً (T-145).
 */
export function resolveConfigDir(startDir = __dirname): string {
  return ascendToDeclaredDir({
    sentinel: ['config', 'royal-authority.yaml'],
    result: ['config'],
    code: 'CONFIG_DIR_MISSING',
    message: 'مجلد التهيئة غير موجود — فشل مغلق',
  }, startDir);
}
