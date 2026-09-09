/**
 * src/kernel/config/closed_enums.ts — سجلُّ التعدادات المغلقة وحرسُها (المرحلة 39، البند T-131)
 * المالك: وزارة النواة | المدخلات: التعداداتُ نفسُها مستوردةً من مواضع إعلانها
 * المخرجات: جدولٌ مجمَّدٌ يربط كلَّ تعدادٍ مغلقٍ بمواضعِ استعماله وبعددِ أعضائه المُثبَت
 * التبعيات: chaos · persistence · production_policy · research · staging · termination · types
 * الصلاحيات: قراءةٌ ومقارنةٌ فقط — لا يقرأ ملفًّا ولا يكتب | السجلات: المُنادي يُدوّن لا هو
 * حالات الفشل: تعدادٌ غيرُ مجمَّدٍ · تعدادٌ فارغٌ · عددُ أعضاءٍ خالفَ المُثبَت ⇒ رفضٌ برمزه
 * اختبارات الوحدة: tests/kernel/closed_enum_bounds.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
 * ثوابت هذه الوحدة:
 *   1) **الغلقُ دعوى حتى يُقاس**: سُمّيت هذه التعداداتُ «مغلقة» في الجلسة 48 فاستُثنيت
 *      من سقوف T-129. والمقيسُ في T-131 أنّ أحدًا منها لم يكن مجمَّدًا في التشغيل
 *      (`Object.isFrozen` ⇒ لا في خمسةَ عشرَ موضعًا)، فكان الغلقُ في الأنواع وحدها:
 *      `readonly` تقولُها الترجمةُ ولا تمنع `push` في التشغيل.
 *   2) **عددُ الأعضاء مُثبَتٌ هنا رقمًا**: من فتح تعدادًا — أضاف عضوًا أو حذفه — أسقط
 *      الإقلاعَ برمزٍ يُسمّي له الطريقَ: إمّا يُحدِّث الرقمَ هنا وقد قرأ أنّه يوسّع بابًا،
 *      وإمّا يُعلن سقفًا في `declaration_budget`. وهذا هو **الإنذارُ** الذي طلبه T-131:
 *      لا يُفتح تعدادٌ في صمت.
 *   3) **الحرسُ لا يعرف مَن يُناديه**: يأخذ الجدولَ مُعامِلًا لتُجرَّب حالاتُ الفشل بجدولٍ
 *      مصنوعٍ في الاختبار، فلا يُثبَت الرفضُ بتخريبِ تعدادٍ حقيقيّ (RULE-005: السياسةُ
 *      لا تُغيَّر من داخل ما تحكمه).
 *   4) **الرقمُ ليس سقفًا**: `members` شهادةٌ على ما هو معلنٌ اليوم لا حدٌّ مسموحٌ للنموّ.
 *      سقفُ النموِّ بابُ T-129 و T-130، وهذا البابُ إنذارُ الفتح لا تسقيفُه.
 */
import { SovereignViolation } from '../types';
import { KNOWN_SOVEREIGN_ACTIONS } from '../types';
import { CHAOS_KNOWN_FAULTS } from './chaos';
import { DURABLE_KINDS } from './persistence';
import {
  PRODUCTION_KNOWN_INCIDENTS,
  PRODUCTION_KNOWN_RUNBOOKS,
  PRODUCTION_KNOWN_SCANNERS,
} from './production_policy';
import { RESEARCH_KNOWN_SOURCE_TYPES } from './research';
import {
  STAGING_KNOWN_INCIDENTS,
  STAGING_KNOWN_RUNBOOKS,
  STAGING_KNOWN_WATCHES,
} from './staging';
import { STOP_KNOWN_PROBES } from './termination';
import { POLICIES_KNOWN_KEYS } from './policies';
import { ROLES_KNOWN_NAMES } from './roles';

/** موضعُ استعمالٍ لتعدادٍ مغلق: مفتاحٌ في ملفِّ تهيئةٍ قيمُه محدودةٌ بأعضاء التعداد */
export interface ClosedEnumUse {
  readonly file: string;
  readonly key: string;
}

/** تعدادٌ مغلقٌ مُسجَّل: اسمُه ومرجعُه وعددُ أعضائه المُثبَت ومواضعُ استعماله */
export interface ClosedEnumBinding {
  readonly name: string;
  readonly values: readonly string[];
  /** عددُ الأعضاء المعلنُ اليوم — تغييرُه فعلٌ مقصودٌ لا صدفة (ثابت 2) */
  readonly members: number;
  readonly uses: readonly ClosedEnumUse[];
}

/**
 * التعداداتُ المغلقةُ الأحدَ عشرَ التي تحدُّ قيمَ خمسةَ عشرَ مفتاحًا في التهيئة.
 * وتعداداتُ **أسماءِ المفاتيح** جدولٌ ثانٍ ({@link CLOSED_MAP_KEY_ENUMS} — T-137) لأنّها
 * تُحرس بالتمام لا بالطول؛ وفاحصُ التعدادات يرى الجدولَينِ معًا — فلا تعدادَ يفلت.
 * والسبعةَ عشرَ في T-129 هي هذه ثلاثةَ عشرَ صفًّا وأربعةٌ لا يحدُّها تعدادٌ بل سقفٌ
 * أو شرطٌ آخر: `regions.required` و`operations[].required_sources`
 * و`modes[].required_sources` (محدودةٌ بسقوفِ `regions` و`service_sources`)
 * و`services.services` (نوعُه مغلقٌ ويرفض المحمّلُ تكرارَ النوع صريحًا).
 */
export const CLOSED_ENUMS: readonly ClosedEnumBinding[] = Object.freeze([
  {
    name: 'CHAOS_KNOWN_FAULTS',
    values: CHAOS_KNOWN_FAULTS as readonly string[],
    members: 4,
    uses: [{ file: 'chaos.yaml', key: 'policy.faults' }],
  },
  {
    name: 'DURABLE_KINDS',
    values: DURABLE_KINDS as readonly string[],
    members: 23,
    uses: [{ file: 'persistence.yaml', key: 'policy.scope' }],
  },
  {
    name: 'PRODUCTION_KNOWN_INCIDENTS',
    values: PRODUCTION_KNOWN_INCIDENTS as readonly string[],
    members: 16,
    uses: [
      { file: 'production.yaml', key: 'policy.severity.critical' },
      { file: 'production.yaml', key: 'policy.severity.high' },
    ],
  },
  {
    name: 'PRODUCTION_KNOWN_SCANNERS',
    values: PRODUCTION_KNOWN_SCANNERS as readonly string[],
    members: 14,
    uses: [{ file: 'production.yaml', key: 'policy.scanners' }],
  },
  {
    name: 'PRODUCTION_KNOWN_RUNBOOKS',
    values: PRODUCTION_KNOWN_RUNBOOKS,
    members: 2,
    uses: [{ file: 'production.yaml', key: 'policy.runbooks' }],
  },
  {
    name: 'KNOWN_SOVEREIGN_ACTIONS',
    values: KNOWN_SOVEREIGN_ACTIONS as readonly string[],
    members: 15,
    uses: [
      { file: 'royal-authority.yaml', key: 'sovereign_actions' },
      { file: 'staging.yaml', key: 'scope.permitted_actions' },
      { file: 'staging.yaml', key: 'scope.forbidden_actions' },
    ],
  },
  {
    name: 'RESEARCH_KNOWN_SOURCE_TYPES',
    values: RESEARCH_KNOWN_SOURCE_TYPES as readonly string[],
    members: 3,
    uses: [{ file: 'research.yaml', key: 'allowed_source_types' }],
  },
  {
    name: 'STAGING_KNOWN_INCIDENTS',
    values: STAGING_KNOWN_INCIDENTS as readonly string[],
    members: 8,
    uses: [
      { file: 'staging.yaml', key: 'policy.severity.critical' },
      { file: 'staging.yaml', key: 'policy.severity.high' },
    ],
  },
  {
    name: 'STAGING_KNOWN_WATCHES',
    values: STAGING_KNOWN_WATCHES as readonly string[],
    members: 5,
    uses: [{ file: 'staging.yaml', key: 'policy.watches' }],
  },
  {
    name: 'STAGING_KNOWN_RUNBOOKS',
    values: STAGING_KNOWN_RUNBOOKS,
    members: 3,
    uses: [{ file: 'staging.yaml', key: 'policy.runbooks' }],
  },
  {
    name: 'STOP_KNOWN_PROBES',
    values: STOP_KNOWN_PROBES as readonly string[],
    members: 5,
    uses: [{ file: 'termination.yaml', key: 'policy.probes' }],
  },
]);

/**
 * موضعُ استعمالٍ لتعدادٍ يحدُّ **أسماءَ مفاتيحِ خريطةٍ** لا قيمَ قائمة (T-137).
 * والفرقُ ليس لفظيًّا بل في ما يُحرس: قيمُ القائمة تُحرس بالعضويّةِ **والطول**، وأسماءُ المفاتيح
 * تُحرس بالعضويّةِ **والتمام** (لا مجهولٌ ولا ناقص) — فتكرارُ المفتاح ممتنعٌ أصلًا في
 * الخريطة، وحالاتُ الرفض غيرُ حالاتِ القوائم. فلو أُدخِلا في {@link CLOSED_ENUMS} لادَّعَيا عقدًا
 * لا يُنفَذ عليهما — ودعوى حرسٍ لا يُنفَذ أسوأُ من غيابِه.
 */
export interface ClosedMapKeyUse {
  readonly file: string;
  /** الخريطةُ التي تُحدُّ أسماءُ مفاتيحِها */
  readonly map: string;
  /** المحمّلُ الذي يُنفِذ الغلقَ — يُراجَع بالقراءة لا بالثقة */
  readonly reader: string;
}

/** تعدادٌ مغلقٌ لأسماءِ مفاتيحٍ: اسمُه ومرجعُه وعددُ أعضائه المُثبَت ومواضعُه */
export interface ClosedMapKeyBinding {
  readonly name: string;
  readonly values: readonly string[];
  readonly members: number;
  readonly uses: readonly ClosedMapKeyUse[];
}

/**
 * التعدادانِ المغلقانِ لأسماءِ المفاتيح (T-137): سياساتُ الدولةِ وأدوارُها.
 * وسُجِّلا هنا ولم يُدخَلا جدولَ القوائم — فالحاجزُ يُوسَّع ليرى ما لم يكن يراه،
 * ولا يُتهرَّب منه بتسميةٍ تُخفي التعدادَ عن فاحصِه.
 */
export const CLOSED_MAP_KEY_ENUMS: readonly ClosedMapKeyBinding[] = Object.freeze([
  {
    name: 'POLICIES_KNOWN_KEYS',
    values: POLICIES_KNOWN_KEYS,
    members: 8,
    uses: [{ file: 'policies.yaml', map: 'policies', reader: 'loadPolicies' }],
  },
  {
    name: 'ROLES_KNOWN_NAMES',
    values: ROLES_KNOWN_NAMES,
    members: 6,
    uses: [{ file: 'roles.yaml', map: 'roles', reader: 'loadRoles' }],
  },
]);

/**
 * حرسُ تعداداتِ أسماءِ المفاتيح — الأسئلةُ الثلاثةُ نفسُها: فارغٌ؟ غيرُ مجمَّد؟ عددٌ انحرف؟
 * @param table جدولُ التعدادات — يُمرَّر لتُجرَّب حالاتُ الفشل بجدولٍ مصنوع (الثابت 3)
 * @returns عددَ التعدادات التي مرّت
 * @throws {SovereignViolation} `CONFIG_CLOSED_ENUM_EMPTY` · `CONFIG_CLOSED_ENUM_NOT_FROZEN`
 *   · `CONFIG_CLOSED_ENUM_CENSUS_DRIFT`
 */
export function guardClosedMapKeyEnums(
  table: readonly ClosedMapKeyBinding[] = CLOSED_MAP_KEY_ENUMS,
): number {
  for (const binding of table) {
    if (binding.values.length === 0) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ فارغ: ${binding.name} — حرسٌ يرفض كلَّ شيءٍ تعطيلٌ لا حماية`,
        'CONFIG_CLOSED_ENUM_EMPTY',
      );
    }
    if (!Object.isFrozen(binding.values)) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ غيرُ مجمَّدٍ في التشغيل: ${binding.name} — `
        + 'الغلقُ في الأنواع وحدها لا يمنع إضافةَ عضوٍ وقتَ التشغيل',
        'CONFIG_CLOSED_ENUM_NOT_FROZEN',
      );
    }
    if (binding.values.length !== binding.members) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ تغيّر عددُ أعضائه: ${binding.name} — `
        + `المُثبَت ${binding.members} والمعلن ${binding.values.length}. `
        + `وهو يحدُّ أسماءَ مفاتيحِ ${binding.uses.length} خريطةٍ في التهيئة، `
        + 'فإن كان الفتحُ مقصودًا فأثبِت العددَ الجديد في src/kernel/config/closed_enums.ts',
        'CONFIG_CLOSED_ENUM_CENSUS_DRIFT',
      );
    }
  }
  return table.length;
}

/** عددُ المفاتيح التي تحدُّها هذه التعدادات — يُقاس من الجدول لا يُكتب رقمًا */
export function closedEnumUseCount(table: readonly ClosedEnumBinding[] = CLOSED_ENUMS): number {
  let n = 0;
  for (const binding of table) n += binding.uses.length;
  return n;
}

/**
 * حرسُ التعدادات المغلقة: يُنادى في الإقلاع فيرفض كلَّ تعدادٍ فُتح بابُه في صمت.
 *
 * ثلاثةُ أسئلةٍ لكلِّ تعداد، وكلُّ واحدٍ منها رفضٌ برمزه:
 *   - **فارغٌ؟** تعدادٌ بلا أعضاءٍ يجعل كلَّ إعلانٍ مرفوضًا فيُقرأ «حرسٌ صارم» وهو تعطيل.
 *   - **غيرُ مجمَّد؟** `readonly` كلامُ الترجمة؛ والتشغيلُ لا يمنع `push` إلّا بالتجميد.
 *   - **عددٌ خالفَ المُثبَت؟** فُتح التعدادُ أو ضُيّق، وكلاهما يوجب قرارًا معلنًا لا صمتًا.
 *
 * @param table جدولُ التعدادات — يُمرَّر لتُجرَّب حالاتُ الفشل بجدولٍ مصنوع (ثابت 3)
 * @returns عددُ التعدادات التي مرّت — رقمٌ يُدوَّن في اليوميّة شهادةً على أنّ الحرس عمل
 * @throws {SovereignViolation} `CONFIG_CLOSED_ENUM_EMPTY` · `CONFIG_CLOSED_ENUM_NOT_FROZEN`
 *   · `CONFIG_CLOSED_ENUM_CENSUS_DRIFT`
 */
export function guardClosedEnums(table: readonly ClosedEnumBinding[] = CLOSED_ENUMS): number {
  for (const binding of table) {
    if (binding.values.length === 0) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ فارغ: ${binding.name} — حرسٌ يرفض كلَّ شيءٍ تعطيلٌ لا حماية`,
        'CONFIG_CLOSED_ENUM_EMPTY',
      );
    }
    if (!Object.isFrozen(binding.values)) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ غيرُ مجمَّدٍ في التشغيل: ${binding.name} — `
        + 'الغلقُ في الأنواع وحدها لا يمنع إضافةَ عضوٍ وقتَ التشغيل',
        'CONFIG_CLOSED_ENUM_NOT_FROZEN',
      );
    }
    if (binding.values.length !== binding.members) {
      throw new SovereignViolation(
        `تعدادٌ مغلقٌ تغيّر عددُ أعضائه: ${binding.name} — `
        + `المُثبَت ${binding.members} والمعلن ${binding.values.length}. `
        + `وهو يحدُّ ${binding.uses.length} مفتاحًا في التهيئة بلا سقفٍ يقابله، `
        + 'فإن كان الفتحُ مقصودًا فأثبِت العددَ الجديد في src/kernel/config/closed_enums.ts '
        + 'أو أعلن سقفًا في src/kernel/config/declaration_budget.ts',
        'CONFIG_CLOSED_ENUM_CENSUS_DRIFT',
      );
    }
  }
  return table.length;
}
