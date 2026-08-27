/**
 * src/kernel/config/policies.ts — السياساتُ الحاكمةُ على التنفيذ: تُقرأ وتُنفَذ لا تُوصف (T-137)
 * المالك: القيّم على المستودع | المرحلة: 40 (دَينُ إعلانٍ بلا قارئ)
 * المدخلات: config/policies.yaml | المخرجات: {@link PoliciesConfig} أو رفضٌ مغلق
 * التبعيات: paths · yaml · types — ولا شيءَ من طبقةٍ أعلى (النواةُ لا تعرف من يحكمها)
 * الصلاحيات (RULE-004): يقرأ ويحكم بصحّة الإعلان؛ لا يُنفّذ سياسةً ولا يُعدّل ملفًّا
 * حالات الفشل: كلُّها مغلقةٌ برموزٍ مسمّاة — `CONFIG_NO_POLICIES` · `CONFIG_POLICY_UNKNOWN_KEY`
 *   · `CONFIG_POLICY_MISSING_KEY` · `CONFIG_POLICY_MUST_HOLD` · `CONFIG_POLICY_EGRESS_DEFAULT`
 *   · `CONFIG_POLICY_COMMAND_AGE`
 * اختبارات الوحدة: tests/kernel/config_policies.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **ملفُّ تهيئةٍ لا يقرأه أحدٌ كذبٌ موثَّق** (docs/PHASE_PROCEDURE.md §2): كان هذا الملفُّ
 *      يُعلن ثمانيَ سياساتٍ حاكمةٍ ولا يقرؤه سطرٌ واحدٌ في `src/` — فمن قلب `audit_every_decision`
 *      إلى `false` لم يسقط له اختبارٌ ولم يتغيّر في الدولة شيء. وأخطرُ صورِ الكذبِ أن يكون في
 *      ملفِّ **السياسة** نفسِه، لأنّ قارئَه يظنّ أنّه قرأ حاجزًا وقد قرأ زينة.
 *
 *   2) **سياساتٌ لا تُطفَأ بإعلان**: سبعٌ من الثمانِ **قيمتُها الوحيدةُ المقبولة `true`** —
 *      التدقيقُ الإلزاميُّ والفشلُ المغلقُ عند غياب الهويّة أو السياسة وتوقيعُ الأوامر ومنعُ
 *      الإعادة ووصولُ قاطعِ التيّار — لأنّها **قواعدُ حاكمةٌ لا خياراتُ تشغيل**، ومن أعلن
 *      إطفاءَها فقد أعلن دولةً أخرى. فالمحمّلُ لا يقبل `false` صامتًا ولا يُصلحه: **يرفض
 *      الإقلاعَ برمزٍ مسمًّى**. وهذا هو الفرقُ بين تهيئةٍ تُقرأ وتهيئةٍ تُنفَذ.
 *
 *   3) **المفتاحُ المجهولُ رفضٌ لا تجاهل**: من أضاف مفتاحًا إلى الإعلان ولم يُضف له قارئًا هنا
 *      أعاد العلّةَ نفسَها في سطرٍ واحدٍ بدلًا من ملفٍّ كامل. فالإعلانُ مغلقٌ: ثمانيةُ مفاتيحَ
 *      لا تاسعَ لها، ومن زاد فليزد قارئَه ومعناه في الرفض.
 *
 *   4) **حدودُ الرقم مُعلنةٌ ومقيسة**: `max_command_age_seconds` عددٌ صحيحٌ في [1, 600] —
 *      صفرٌ يمنع كلَّ أمرٍ (دولةٌ مقفلة)، وعددٌ ضخمٌ يُبقي الأمرَ الموقَّعَ صالحًا شهرًا
 *      (نافذةُ إعادةٍ مفتوحة). والمعلنُ اليومَ 120.
 *
 *   5) **هذا المحمّلُ يقرأ ولا يربط** (RULE-005): الجهةُ التي تُنفِذ `max_command_age_seconds`
 *      هي `CrownGateway`، وسياستُها تُمرَّر إليها من **جذر التركيب** لا من داخلها. وجذرُ
 *      التركيب (`src/composition/sovereignty.ts`) **خارجَ نطاقِ البند T-137** لأنّه محجوزٌ
 *      لبند T-138 — فالربطُ الكاملُ **دَينٌ معلنٌ باقٍ** لا يُدّعى إنجازُه هنا. وسدَّ هذا
 *      البندُ فراغَه بحاجزٍ لا بربطٍ صامت: `tests/kernel/config_policies.test.ts` يُسقط البناءَ
 *      إن فارقَ ثابتُ `DEFAULT_POLICY` هذا الإعلانَ — فلا ينحرف الرقمانِ في الظلام حتّى يُربطا.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** السياساتُ الثمانِ كما تُعلن — أسماؤها أسماءُ مفاتيحِها في الملف حرفًا */
export interface PoliciesConfig {
  policies: {
    audit_every_decision: boolean;
    fail_closed_on_missing_identity: boolean;
    fail_closed_on_missing_policy: boolean;
    require_signed_commands: boolean;
    replay_protection: boolean;
    max_command_age_seconds: number;
    external_egress_default: 'deny';
    kill_switch_reachable_always: boolean;
  };
}

/**
 * السياساتُ التي **لا تقبل إلّا `true`** (الثابت 2) — قواعدُ حاكمةٌ لا خياراتُ تشغيل،
 * ومع كلِّ واحدةٍ سببُ رفضِها منطوقًا فمن سقط عليه الحاجزُ عرف **لماذا** لا **أنّه سقط**.
 */
export const POLICIES_MUST_HOLD: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['audit_every_decision', 'قرارٌ بلا قيدٍ في السجل قرارٌ لا يُراجَع (RULE-006)'],
  ['fail_closed_on_missing_identity', 'مجهولٌ يعمل بلا هويّةٍ أخطرُ من عملٍ لا يقع'],
  ['fail_closed_on_missing_policy', 'غيابُ السياسة ليس إذنًا (RULE-007)'],
  ['require_signed_commands', 'أمرٌ سياديٌّ بلا توقيعٍ لا يُنسب إلى أحد (RULE-003)'],
  ['replay_protection', 'أمرٌ يُعاد تشغيلُه أمرٌ ثانٍ لم يأذن به أحد'],
  ['kill_switch_reachable_always', 'قاطعُ تيّارٍ لا يُبلَغ ليس قاطعًا (RULE-002)'],
] as const);

/** المفاتيحُ الثمانيةُ المعروفة — إعلانٌ مغلقٌ فالتاسعُ رفضٌ (الثابت 3) */
export const POLICIES_KNOWN_KEYS: readonly string[] = Object.freeze([
  ...POLICIES_MUST_HOLD.map(([key]) => key),
  'max_command_age_seconds',
  'external_egress_default',
]);

/** أدنى وأقصى عمرٍ مقبولٍ للأمر الموقَّع بالثواني (الثابت 4) */
export const POLICY_COMMAND_AGE_BOUNDS = Object.freeze({ min: 1, max: 600 });

/**
 * يقرأ `config/policies.yaml` ويُنفِذ صحّتَه فشلًا مغلقًا.
 * @param configDir مجلدُ الإعلان — افتراضُه المُحدَّدُ بـ{@link resolveConfigDir}
 * @returns الإعلانَ كما هو بعد إنفاذه — يُقرأ ولا يُصلَح
 * @throws SovereignViolation عند أوّلِ مخالفةٍ برمزٍ مسمًّى (RULE-007: لا يُبتلع خطأ)
 */
export function loadPolicies(configDir = resolveConfigDir()): PoliciesConfig {
  const raw = loadYamlFile(join(configDir, 'policies.yaml')) as unknown as PoliciesConfig;
  const policies = raw.policies;
  if (!policies || typeof policies !== 'object') {
    throw new SovereignViolation(
      'السياساتُ الحاكمةُ غيرُ معلنةٍ في config/policies.yaml — وغيابُ السياسة ليس إذنًا',
      'CONFIG_NO_POLICIES',
    );
  }

  for (const key of Object.keys(policies)) {
    if (!POLICIES_KNOWN_KEYS.includes(key)) {
      throw new SovereignViolation(
        `سياسةٌ معلنةٌ بلا قارئٍ يُنفِذها: «${key}» — من زاد مفتاحًا فليزد قارئَه ومعناه في الرفض، `
        + 'وإلّا فقد أعاد علّةَ الإعلانِ الذي لا يقرؤه أحد (T-137)',
        'CONFIG_POLICY_UNKNOWN_KEY',
      );
    }
  }
  for (const key of POLICIES_KNOWN_KEYS) {
    if (!(key in policies)) {
      throw new SovereignViolation(
        `سياسةٌ محكومةٌ غيرُ معلنة: «${key}» — والقارئُ لا يفترض قيمةً لم تُعلن`,
        'CONFIG_POLICY_MISSING_KEY',
      );
    }
  }

  for (const [key, why] of POLICIES_MUST_HOLD) {
    if ((policies as unknown as Record<string, unknown>)[key] !== true) {
      throw new SovereignViolation(
        `سياسةٌ حاكمةٌ لا تُطفَأ بإعلان: «${key}» يجب أن تكون true — ${why}`,
        'CONFIG_POLICY_MUST_HOLD',
      );
    }
  }

  if (policies.external_egress_default !== 'deny') {
    throw new SovereignViolation(
      'الأصلُ في النفاذ الخارجيّ المنعُ: external_egress_default لا يقبل إلّا deny — '
      + 'ومن فتحه بالإعلان فتحه على كلِّ وحدةٍ لم تُسأل',
      'CONFIG_POLICY_EGRESS_DEFAULT',
    );
  }

  const age = policies.max_command_age_seconds;
  const { min, max } = POLICY_COMMAND_AGE_BOUNDS;
  if (!Number.isSafeInteger(age) || age < min || age > max) {
    throw new SovereignViolation(
      `عمرُ الأمر المقبولُ خارجَ حدوده المعلنة: max_command_age_seconds=${String(age)} `
      + `وحدُّه [${min}, ${max}] ثانيةً — فصفرٌ يقفل الدولةَ وعددٌ ضخمٌ يفتح نافذةَ إعادة`,
      'CONFIG_POLICY_COMMAND_AGE',
    );
  }

  return raw;
}
