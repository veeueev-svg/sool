/**
 * scripts/closed_enum_cases.ts — جدولُ القوائم المحدودةِ بتعدادٍ مغلق (المرحلة 39، البند T-131)
 * المالك: القيّم على المستودع | المدخلات: مجلدُ تهيئةٍ منسوخٌ في tmpdir (لا يُلمس المستودع)
 * المخرجات: جدولُ حالاتٍ يُقرأ من مسبارِ T-131 ومن اختباراته — لا يطبع ولا يقيس
 * التبعيات: src/kernel/config/* · scripts/declaration_cases.ts (النفخُ والرفضُ ومسارُ الجذر)
 * الصلاحيات: قراءةُ التهيئة وكتابةٌ في المسار المُعطى وحده | السجلات: لا يكتب في اليوميّة
 * حالات الفشل: مفتاحٌ غيرُ موجودٍ للنفخ ⇒ استثناءٌ صريح (RULE-007: لا يُبتلع خطأ)
 * اختبارات الوحدة: tests/kernel/closed_enum_bounds.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0035-closed-enum-bounds.md
 * ثوابت هذه الوحدة:
 *   1) **التعدادُ يُقرأ رمزًا لا نصًّا**: كلُّ حالةٍ تحمل **مرجعَ المصفوفة نفسِها** المستوردةَ
 *      من النواة، فمن حذف عنصرًا منها أو فتحها رأى الرقمَ يتغيّر في القياس. ومسحُ النصِّ
 *      يُخطئ عند أوّلِ إعادةِ تسمية.
 *   2) **قيمةٌ معلومةٌ وقيمةٌ مجهولةٌ لكلِّ حالة**: المعلومةُ **تُقرأ من التعداد** لا تُكتب
 *      حرفًا، والمجهولةُ نصٌّ لا يقع فيه — فالرفضُ إن جاء جاء من العضويّة لا من صياغة.
 *   3) **ما لا يُحدُّه تعدادٌ لا يُدرَج**: القوائمُ الثلاثُ المحدودةُ بسقفٍ في T-129
 *      (`regions.required` · `required_sources` ×2) ليست من هذا الباب — سُمّيت في القياس
 *      الخام بسببها ولم تُحسب في التسعةَ عشرَ (RULE-009: ما يُستثنى يُسمّى).
 *   4) **`services.services` لا تُنفخ بالتكرار**: نوعُها مغلقٌ (hospital · lab) **والمحمّلُ
 *      يرفض تكرارَ النوع صريحًا**، فبابُها مغلقٌ بشرطٍ آخرَ مقيسٍ في T-129 لا بعضويّةٍ وحدها.
 */
import { loadChaos } from '../src/kernel/config/chaos';
import { loadPersistence, DURABLE_KINDS } from '../src/kernel/config/persistence';
import { loadProduction } from '../src/kernel/config/production';
import {
  PRODUCTION_KNOWN_INCIDENTS,
  PRODUCTION_KNOWN_RUNBOOKS,
  PRODUCTION_KNOWN_SCANNERS,
} from '../src/kernel/config/production_policy';
import { loadResearch, RESEARCH_KNOWN_SOURCE_TYPES } from '../src/kernel/config/research';
import { loadRoyalAuthority } from '../src/kernel/config/royal_authority';
import {
  loadStaging,
  STAGING_KNOWN_INCIDENTS,
  STAGING_KNOWN_RUNBOOKS,
  STAGING_KNOWN_WATCHES,
} from '../src/kernel/config/staging';
import { loadTermination, STOP_KNOWN_PROBES } from '../src/kernel/config/termination';
import { CHAOS_KNOWN_FAULTS } from '../src/kernel/config/chaos';
import { KNOWN_SOVEREIGN_ACTIONS } from '../src/kernel/types';

/** قائمةٌ **محدودةٌ بتعدادٍ مغلق**: قيمُها من مجموعةٍ مُعلنةٍ في الشفرة لا مُعرِّفاتٌ حرّة */
export type ClosedCase = {
  /** اسمُ التعداد كما يُقرأ في الشفرة — للتقرير لا للمطابقة */
  readonly enumName: string;
  /** التعدادُ نفسُه: مرجعٌ لا نصّ (ثابت 1) */
  readonly values: readonly string[];
  readonly file: string;
  /** المفتاحُ في ملفِّ التهيئة كما يظهر في سطرٍ منفرد */
  readonly key: string;
  readonly load: (dir: string) => unknown;
  /** سطرُ عنصرٍ بقيمةٍ مُعطاة — الصياغةُ صياغةُ الملف (نصٌّ مُقتبسٌ أو حرّ) */
  readonly entry: (value: string) => readonly string[];
};

/** قيمةٌ لا تقع في تعدادٍ: تُبنى من التعداد نفسِه فلا تصادف عضوًا فيه */
export function alien(values: readonly string[]): string {
  let candidate = 'zzz_not_in_enum';
  while (values.includes(candidate)) candidate += '_x';
  return candidate;
}

/**
 * المواضعُ المحدودةُ بتعدادٍ مغلق: **13 صفًّا** من السبعةَ عشرَ التي استُثنيت في T-129،
 * مبسوطةً إلى **15 مفتاحًا** (صفَّا `severity` في الإنتاج والوسيط مفتاحان لا مفتاح).
 * والأربعةُ الباقيةُ ليست من هذا الباب وتُسمّى بسببها في القياس الخام (ثابتان 3 و4).
 */
export const CLOSED_CASES: readonly ClosedCase[] = [
  {
    enumName: 'CHAOS_KNOWN_FAULTS', values: CHAOS_KNOWN_FAULTS as readonly string[],
    file: 'chaos.yaml', key: 'faults', load: loadChaos,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'DURABLE_KINDS', values: DURABLE_KINDS as readonly string[],
    file: 'persistence.yaml', key: 'scope', load: loadPersistence,
    entry: (v) => [`- ${v}`],
  },
  {
    enumName: 'PRODUCTION_KNOWN_INCIDENTS (critical)',
    values: PRODUCTION_KNOWN_INCIDENTS as readonly string[],
    file: 'production.yaml', key: 'critical', load: loadProduction,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'PRODUCTION_KNOWN_INCIDENTS (high)',
    values: PRODUCTION_KNOWN_INCIDENTS as readonly string[],
    file: 'production.yaml', key: 'high', load: loadProduction,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'PRODUCTION_KNOWN_SCANNERS', values: PRODUCTION_KNOWN_SCANNERS as readonly string[],
    file: 'production.yaml', key: 'scanners', load: loadProduction,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'PRODUCTION_KNOWN_RUNBOOKS', values: PRODUCTION_KNOWN_RUNBOOKS as readonly string[],
    file: 'production.yaml', key: 'runbooks', load: loadProduction,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'KNOWN_SOVEREIGN_ACTIONS (royal)', values: KNOWN_SOVEREIGN_ACTIONS as readonly string[],
    file: 'royal-authority.yaml', key: 'sovereign_actions', load: loadRoyalAuthority,
    entry: (v) => [`- ${v}`],
  },
  {
    enumName: 'RESEARCH_KNOWN_SOURCE_TYPES',
    values: RESEARCH_KNOWN_SOURCE_TYPES as readonly string[],
    file: 'research.yaml', key: 'allowed_source_types', load: loadResearch,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'KNOWN_SOVEREIGN_ACTIONS (staging permitted)',
    values: KNOWN_SOVEREIGN_ACTIONS as readonly string[],
    file: 'staging.yaml', key: 'permitted_actions', load: loadStaging,
    entry: (v) => [`- ${v}`],
  },
  {
    enumName: 'KNOWN_SOVEREIGN_ACTIONS (staging forbidden)',
    values: KNOWN_SOVEREIGN_ACTIONS as readonly string[],
    file: 'staging.yaml', key: 'forbidden_actions', load: loadStaging,
    entry: (v) => [`- ${v}`],
  },
  {
    enumName: 'STAGING_KNOWN_INCIDENTS (critical)',
    values: STAGING_KNOWN_INCIDENTS as readonly string[],
    file: 'staging.yaml', key: 'critical', load: loadStaging,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'STAGING_KNOWN_INCIDENTS (high)',
    values: STAGING_KNOWN_INCIDENTS as readonly string[],
    file: 'staging.yaml', key: 'high', load: loadStaging,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'STAGING_KNOWN_WATCHES', values: STAGING_KNOWN_WATCHES as readonly string[],
    file: 'staging.yaml', key: 'watches', load: loadStaging,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'STAGING_KNOWN_RUNBOOKS', values: STAGING_KNOWN_RUNBOOKS as readonly string[],
    file: 'staging.yaml', key: 'runbooks', load: loadStaging,
    entry: (v) => [`- "${v}"`],
  },
  {
    enumName: 'STOP_KNOWN_PROBES', values: STOP_KNOWN_PROBES as readonly string[],
    file: 'termination.yaml', key: 'probes', load: loadTermination,
    entry: (v) => [`- "${v}"`],
  },
];
