/**
 * src/kernel/config/declaration_readers.ts — سجلُّ قُرّاءِ الإعلان: لا ملفَّ يُحصى بلا قارئ (T-137)
 * المالك: القيّم على المستودع | المرحلة: 40 (دَينُ إعلانٍ بلا قارئ)
 * المدخلات: أسماءُ ملفّات الإعلان المحصورة (من {@link ./declaration_census})
 * المخرجات: مرورٌ بعددِ الملفّات المفحوصة، أو رفضٌ مغلقٌ باسمِ الملفِّ الذي لا قارئَ له
 * التبعيات: policies · roles · types — ولا شيءَ من طبقةٍ أعلى
 * الصلاحيات (RULE-004): يحكم بوجودِ قارئٍ ولا يكتب قارئًا ولا يقرأ ملفًّا بنفسِه
 * حالات الفشل: `DECLARATION_FILE_WITHOUT_READER` (فشلٌ مغلق — RULE-007)
 * اختبارات الوحدة: tests/kernel/declaration_readers.test.ts
 * بوابةُ التكامل: scripts/check_config_readers.sh (في `npm run verify` وفي CI)
 * الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **إصلاحُ الباب لا إصلاحُ ثلاثةِ ملفّات** (البند T-137): قيس في الجلسة 51 أنّ ثلاثةَ
 *      ملفّاتٍ تُحصى في ميزانيّة الإعلان ولا يقرؤها محمّل. وإعطاءُ الثلاثةِ قُرّاءً يُغلق
 *      **العَرَض**؛ والعلّةُ أنّ **لا حاجزَ** يمنع رابعًا. فهذا السجلُّ هو الحاجز: كلُّ ملفٍّ
 *      في مجلد الإعلان له صفٌّ باسم قارئه، ومن أضاف ملفًّا بلا صفٍّ **أسقط الإقلاعَ والبوابةَ
 *      معًا** لا مرَّ صامتًا.
 *
 *   2) **حاجزانِ لا واحد**: الإقلاعُ يفحص **ما وُجد في المجلد** فيرفض ملفًّا بلا قارئٍ حتّى في
 *      مجلدٍ مؤقّت؛ والبوابةُ (`scripts/check_config_readers.sh`) تفحص **الاتّجاه المقابل** على
 *      المستودع الحقيقيّ: قارئٌ مسجَّلٌ لملفٍّ غائب، أو ملفٌّ في `config/` غيرُ مسجَّل. فما يراه
 *      أحدُهما لا يراه الآخر — والاتّجاهُ الغائبُ عن الإقلاع مقصودٌ ومُعلن: مجلدُ إعلانٍ منسوخٌ
 *      ناقصٌ في اختبارٍ ليس علّةً في الدولة.
 *
 *   3) **قارئُ الإقلاعِ يُنادى لا يُعلَن فقط**: صفٌّ يقول «لي قارئ» ولا يُنادى قارئُه في
 *      الإقلاع كذبٌ من جنسِ ما فُتح البندُ له. فما كان مرجعُه هذا السجلَّ نفسَه
 *      (`read_at_guard`) **يُنادى محمّلُه هنا**، وما كان مرجعُه نطاقَه (`read_in_domain`) يُنادى
 *      محمّلُه في بابه — والسجلُّ يسمّي الموضعَ فيُراجَع بالقراءة لا بالثقة.
 *
 *   4) **إعلانُ الأدواتِ ليس إعلانَ دولة**: ما تقرؤه بوابةٌ ولا تقرؤه دولةٌ **لا يسكن
 *      `config/`**. ولذلك نُقل `module_limits.yaml` إلى `scripts/limits/` — فلا صفَّ له هنا،
 *      لأنّ سقفَ حجمِ الوحدة حدُّ أداةٍ لا سياسةُ دولة.
 *
 *   5) **السياساتُ العامّةُ قارئُها الحرَسُ لا نطاقٌ**: `policies.yaml` و`roles.yaml` ليسا لبابٍ
 *      واحدٍ من أبواب الدولة بل يعلوان الأبوابَ كلَّها (RULE-004 و RULE-005)، فلا نطاقَ يملك
 *      قراءتَهما وحدَه — فقارئُهما حرَسُ الإقلاعِ نفسُه، وهذا موضعٌ مُعلنٌ لا صدفة.
 *
 *   6) **تعداداتُ أسماءِ المفاتيح تُحرس من هنا — وموضعُها النهائيُّ دَينٌ مُعلن**:
 *      `guardClosedMapKeyEnums()` يُنادى مع كلِّ حرسٍ للإعلان، لأنّ موضعَ أخيه
 *      `guardClosedEnums` جذرُ التركيب وهو **محجوزٌ لبندٍ آخر** (W-2026-003) فلا يُلمس.
 *      والحرسُ حقيقيٌّ في كلِّ إقلاع، والدَّينُ دَينُ **موضعٍ** لا دَينُ إنفاذ، وهو مكتوبٌ
 *      هنا لا مستورٌ في سطر.
 */
import { SovereignViolation } from '../types';
import { guardClosedMapKeyEnums } from './closed_enums';
import { loadPolicies } from './policies';
import { loadRoles } from './roles';

/** موضعُ نداءِ القارئ: في حرَسِ الإقلاع نفسِه، أو في نطاقِ صاحبِ الملف */
export type ReaderSite = 'read_at_guard' | 'read_in_domain';

/** صفٌّ في سجلِّ القُرّاء: ملفٌّ واسمُ قارئه وموضعُ ندائه */
export interface DeclarationReader {
  /** اسمُ الملفِّ نسبةً إلى مجلد الإعلان */
  readonly file: string;
  /** اسمُ الدالّةِ القارئة — يُراجَع بالقراءة لا بالثقة */
  readonly reader: string;
  /** الوحدةُ التي تسكنها الدالّة */
  readonly module: string;
  /** موضعُ النداء (الثابت 3) */
  readonly site: ReaderSite;
}

/**
 * قُرّاءُ الإعلان الأربعةُ والعشرون — صفٌّ لكلِّ ملفٍّ في `config/`، لا زيادةَ ولا نقص.
 * وترتيبُه ترتيبُ المجلد أبجديًّا فيُقابَل بالعين مع `ls config/`.
 */
export const DECLARATION_READERS: readonly DeclarationReader[] = Object.freeze([
  { file: 'channels.yaml', reader: 'loadChannels', module: 'src/kernel/config/channels.ts', site: 'read_in_domain' },
  { file: 'chaos.yaml', reader: 'loadChaos', module: 'src/kernel/config/chaos.ts', site: 'read_in_domain' },
  { file: 'confinement.yaml', reader: 'loadConfinement', module: 'src/kernel/config/confinement.ts', site: 'read_in_domain' },
  { file: 'contracts.yaml', reader: 'loadContracts', module: 'src/kernel/config/contracts.ts', site: 'read_in_domain' },
  { file: 'economy.yaml', reader: 'loadEconomy', module: 'src/kernel/config/economy.ts', site: 'read_in_domain' },
  { file: 'enterprises.yaml', reader: 'loadEnterprises', module: 'src/kernel/config/enterprises.ts', site: 'read_in_domain' },
  { file: 'external.yaml', reader: 'loadExternal', module: 'src/kernel/config/external.ts', site: 'read_in_domain' },
  { file: 'inference.yaml', reader: 'loadInference', module: 'src/kernel/config/inference.ts', site: 'read_in_domain' },
  { file: 'intent.yaml', reader: 'loadIntent', module: 'src/kernel/config/intent.ts', site: 'read_in_domain' },
  { file: 'load.yaml', reader: 'loadLoad', module: 'src/kernel/config/load.ts', site: 'read_in_domain' },
  { file: 'persistence.yaml', reader: 'loadPersistence', module: 'src/kernel/config/persistence.ts', site: 'read_in_domain' },
  { file: 'policies.yaml', reader: 'loadPolicies', module: 'src/kernel/config/policies.ts', site: 'read_at_guard' },
  { file: 'production.yaml', reader: 'loadProduction', module: 'src/kernel/config/production.ts', site: 'read_in_domain' },
  { file: 'quotas.yaml', reader: 'loadQuotas', module: 'src/kernel/config/quotas.ts', site: 'read_in_domain' },
  { file: 'recovery.yaml', reader: 'loadRecovery', module: 'src/kernel/config/recovery.ts', site: 'read_in_domain' },
  { file: 'regions.yaml', reader: 'loadRegions', module: 'src/kernel/config/regions.ts', site: 'read_in_domain' },
  { file: 'reproduction.yaml', reader: 'loadReproduction', module: 'src/kernel/config/reproduction.ts', site: 'read_in_domain' },
  { file: 'research.yaml', reader: 'loadResearch', module: 'src/kernel/config/research.ts', site: 'read_in_domain' },
  { file: 'roles.yaml', reader: 'loadRoles', module: 'src/kernel/config/roles.ts', site: 'read_at_guard' },
  { file: 'royal-authority.yaml', reader: 'loadRoyalAuthority', module: 'src/kernel/config/royal_authority.ts', site: 'read_in_domain' },
  { file: 'scale.yaml', reader: 'loadScale', module: 'src/kernel/config/scale.ts', site: 'read_in_domain' },
  { file: 'services.yaml', reader: 'loadServices', module: 'src/kernel/config/services.ts', site: 'read_in_domain' },
  { file: 'staging.yaml', reader: 'loadStaging', module: 'src/kernel/config/staging.ts', site: 'read_in_domain' },
  { file: 'termination.yaml', reader: 'loadTermination', module: 'src/kernel/config/termination.ts', site: 'read_in_domain' },
]);

/** المحمّلاتُ التي يُناديها الحرَسُ بنفسِه (الثابت 3 و5) — مفتاحُها اسمُ الملف */
const GUARD_READERS: Readonly<Record<string, (configDir: string) => unknown>> = Object.freeze({
  'policies.yaml': loadPolicies,
  'roles.yaml': loadRoles,
});

/** يُعيد صفَّ ملفٍّ إن كان مسجَّلًا، وإلّا `undefined` — قراءةٌ بلا حكم */
export function declarationReaderOf(file: string): DeclarationReader | undefined {
  return DECLARATION_READERS.find((r) => r.file === file);
}

/**
 * يحرس أنّ كلَّ ملفٍّ **وُجد** في مجلد الإعلان له قارئٌ مسجَّل، ويُنادي قُرّاءَ الحرَس.
 *
 * الاتّجاهُ المفحوصُ هنا واحدٌ ومقصود (الثابت 2): من الملفِّ الموجودِ إلى قارئه. والاتّجاهُ
 * المقابلُ (قارئٌ مسجَّلٌ لملفٍّ غائب) موضعُه البوابةُ على المستودع الحقيقيّ، لأنّ مجلدَ إعلانٍ
 * منسوخٍ ناقصٍ في اختبارٍ ليس علّةً في الدولة.
 *
 * @param configDir مجلدُ الإعلان — يُمرَّر إلى قُرّاءِ الحرَس
 * @param files أسماءُ الملفّات المحصورة نسبةً إلى المجلد
 * @returns عددَ الملفّات المفحوصة — يُقرأ ولا يُستنتج
 * @throws SovereignViolation عند أوّلِ ملفٍّ بلا قارئٍ مسجَّل، أو عند رفضِ قارئٍ لإعلانه
 */
export function guardDeclarationReaders(configDir: string, files: readonly string[]): number {
  // تعداداتُ أسماءِ المفاتيح تُحرس هنا (الثابت 6): موضعُها النهائيُّ جذرُ التركيب مع أخيها
  // `guardClosedEnums`، وهو محجوزٌ لبندٍ آخر (W-2026-003) — فالنداءُ هنا حرسٌ حقيقيٌّ في كلِّ
  // إقلاعٍ ودَينُ موضعٍ **معلنٌ** لا مستور.
  guardClosedMapKeyEnums();
  for (const file of files) {
    const row = declarationReaderOf(file);
    if (!row) {
      throw new SovereignViolation(
        `ملفُّ إعلانٍ يُحصى في الميزانيّة ولا قارئَ له: «${file}» — إمّا محمّلٌ في الدولة يُنفِذه `
        + 'وصفٌّ باسمه في src/kernel/config/declaration_readers.ts، وإمّا يُخرَج من مجلد الإعلان '
        + 'إلى موضعٍ يُعلن أنّه إعلانُ أدواتٍ لا إعلانُ دولة (كما نُقل module_limits.yaml إلى '
        + 'scripts/limits/). وملفُّ تهيئةٍ لا يقرأه أحدٌ كذبٌ موثَّق (T-137)',
        'DECLARATION_FILE_WITHOUT_READER',
      );
    }
    const read = GUARD_READERS[row.file];
    if (read) read(configDir);
  }
  return files.length;
}
