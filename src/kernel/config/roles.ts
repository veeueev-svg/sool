/**
 * src/kernel/config/roles.ts — الأدوارُ وفصلُ الصلاحيات: تُقرأ وتُنفَذ لا تُوصف (T-137)
 * المالك: القيّم على المستودع | المرحلة: 40 (دَينُ إعلانٍ بلا قارئ)
 * المدخلات: config/roles.yaml | المخرجات: {@link RolesConfig} أو رفضٌ مغلق
 * التبعيات: paths · yaml · types — ولا شيءَ من طبقةٍ أعلى (النواةُ لا تعرف من يحكمها)
 * الصلاحيات (RULE-004): يقرأ ويحكم بصحّة الإعلان؛ لا يمنح صلاحيةً ولا ينتزعها
 * حالات الفشل: كلُّها مغلقةٌ برموزٍ مسمّاة — `CONFIG_NO_ROLES` · `CONFIG_ROLE_UNKNOWN`
 *   · `CONFIG_ROLE_MISSING` · `CONFIG_ROLE_FIELD` · `CONFIG_ROLE_SEPARATION`
 *   · `CONFIG_ROLE_KING_EXECUTES` · `CONFIG_ROLE_NO_AUDITOR` · `CONFIG_ROLE_IDLE`
 * اختبارات الوحدة: tests/kernel/config_roles.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0042-declaration-readers.md
 *
 * ثوابت هذه الوحدة:
 *
 *   1) **مصفوفةُ الصلاحيات إعلانٌ كان لا يُقرأ**: هذا الملفُّ هو الموضعُ الذي كُتب فيه فصلُ
 *      الصلاحيات (RULE-004) نصًّا، ولم يقرأه سطرٌ واحدٌ في `src/` — فمن أعطى دورًا `approve`
 *      و`execute` معًا نقض القاعدةَ الحاكمةَ في ملفٍّ لا يحرسه أحد. والقاعدةُ التي لا حاجزَ
 *      لها نصيحةٌ لا قاعدة.
 *
 *   2) **من يعتمد لا يُنفّذ** (RULE-004): لا دورَ يجمع `approve` و`execute`. وهذا **جوهرُ**
 *      الفصل: من اعتمد فعلَ نفسِه فلا اعتمادَ هناك بل تصريحُ نيّة. والرفضُ يسمّي الدورَ
 *      المخالفَ فلا يُبحث عنه يدويًّا.
 *
 *   3) **الملكُ لا ينفّذ**: `king.execute` لا يقبل إلّا `false` — يقترحُ ويعتمدُ وينقضُ،
 *      والتنفيذُ لحرَسِ التاج. فملكٌ ينفّذ بيده لا يبقى له من يراجعه.
 *
 *   4) **لا بدَّ من مدقّقٍ لا يفعل غيرَ التدقيق**: دورٌ واحدٌ على الأقلِّ `audit: true` وسائرُ
 *      حقوقه `false`. فمدقّقٌ يقترح أو ينفّذ يدقّق أثرَ يدِه، والتدقيقُ حينها مرآةٌ لا شهادة.
 *
 *   5) **دورٌ بلا صلاحيةٍ واحدةٍ ليس دورًا**: أربعُ قيمٍ `false` تعني سطرًا يُقرأ ولا يعني
 *      شيئًا — فيُرفض، لأنّ الإعلانَ الذي لا يعني شيئًا هو العلّةُ التي فُتح البند T-137 لها.
 *
 *   6) **الإعلانُ مغلقٌ بأدواره الستّة**: `king` · `crown_guard` · `minister` · `governor`
 *      · `auditor` · `agent`. ومن زاد دورًا فليزد له موضعًا في الدولة يُنفِذه، وإلّا فقد
 *      أعلن اسمًا لا سلطةَ له. ولم يُدخَل هذا في `CLOSED_ENUMS` لأنّ ذاك الجدولَ يحدُّ **قيمَ**
 *      قوائمَ ويُحرس بالعضويّةِ والطول، وهذه **أسماءُ مفاتيحَ** في خريطةٍ تُحرس بالعضويّةِ
 *      والتمام — فسُجِّل في جدولٍ ثانٍ مُعلنٍ لفاحصِه: `CLOSED_MAP_KEY_ENUMS` في
 *      `closed_enums.ts`، ويُنادى حرسُه في كلِّ إقلاعٍ من `declaration_readers.ts`. فلا
 *      تعدادٌ أُخفي عن حاجزه، ولا حاجزٌ ادَّعى عقدًا لا يُنفِذه.
 */
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

/** الحقوقُ الأربعةُ لكلِّ دور — أسماؤها أسماءُ مفاتيحِها في الملف حرفًا */
export interface RolePowers {
  propose: boolean;
  approve: boolean;
  execute: boolean;
  audit: boolean;
}

/** مصفوفةُ الأدوار كما تُعلن */
export interface RolesConfig {
  roles: Record<string, RolePowers>;
}

/** الأدوارُ الستّةُ المعروفة — إعلانٌ مغلقٌ فالسابعُ رفضٌ (الثابت 6) */
export const ROLES_KNOWN_NAMES: readonly string[] = Object.freeze([
  'king', 'crown_guard', 'minister', 'governor', 'auditor', 'agent',
]);

/** الحقوقُ الأربعةُ المطلوبةُ في كلِّ دورٍ — ناقصُها رفضٌ لا افتراض */
export const ROLE_POWER_FIELDS: readonly (keyof RolePowers)[] = Object.freeze([
  'propose', 'approve', 'execute', 'audit',
]);

/**
 * يقرأ `config/roles.yaml` ويُنفِذ فصلَ الصلاحيات فشلًا مغلقًا.
 * @param configDir مجلدُ الإعلان — افتراضُه المُحدَّدُ بـ{@link resolveConfigDir}
 * @returns الإعلانَ كما هو بعد إنفاذه — يُقرأ ولا يُصلَح
 * @throws SovereignViolation عند أوّلِ مخالفةٍ برمزٍ مسمًّى واسمِ الدور المخالف
 */
export function loadRoles(configDir = resolveConfigDir()): RolesConfig {
  const raw = loadYamlFile(join(configDir, 'roles.yaml')) as unknown as RolesConfig;
  const roles = raw.roles;
  if (!roles || typeof roles !== 'object') {
    throw new SovereignViolation(
      'مصفوفةُ الأدوار غيرُ معلنةٍ في config/roles.yaml — وفصلُ الصلاحيات لا يُفترض من الشفرة',
      'CONFIG_NO_ROLES',
    );
  }

  for (const name of Object.keys(roles)) {
    if (!ROLES_KNOWN_NAMES.includes(name)) {
      throw new SovereignViolation(
        `دورٌ معلنٌ لا موضعَ له في الدولة: «${name}» — واسمٌ بلا سلطةٍ إعلانٌ لا يُنفَذ`,
        'CONFIG_ROLE_UNKNOWN',
      );
    }
  }
  for (const name of ROLES_KNOWN_NAMES) {
    if (!(name in roles)) {
      throw new SovereignViolation(
        `دورٌ محكومٌ غيرُ معلن: «${name}» — والقارئُ لا يفترض صلاحيةً لم تُعلن`,
        'CONFIG_ROLE_MISSING',
      );
    }
  }

  let auditorsOnly = 0;
  for (const name of ROLES_KNOWN_NAMES) {
    const powers = roles[name] as RolePowers | undefined;
    for (const field of ROLE_POWER_FIELDS) {
      if (typeof powers?.[field] !== 'boolean') {
        throw new SovereignViolation(
          `حقٌّ غيرُ معلنٍ أو ليس منطقيًّا: roles.${name}.${field} — الحقُّ يُعلن true أو false لا يُسكت عنه`,
          'CONFIG_ROLE_FIELD',
        );
      }
    }
    const p = powers as RolePowers;
    if (p.approve && p.execute) {
      throw new SovereignViolation(
        `دورٌ يجمع الاعتمادَ والتنفيذ: «${name}» — ومن اعتمد فعلَ نفسِه فلا اعتمادَ هناك (RULE-004)`,
        'CONFIG_ROLE_SEPARATION',
      );
    }
    if (!p.propose && !p.approve && !p.execute && !p.audit) {
      throw new SovereignViolation(
        `دورٌ بلا صلاحيةٍ واحدة: «${name}» — سطرٌ يُقرأ ولا يعني شيئًا`,
        'CONFIG_ROLE_IDLE',
      );
    }
    if (p.audit && !p.propose && !p.approve && !p.execute) auditorsOnly += 1;
  }

  if ((roles['king'] as RolePowers).execute) {
    throw new SovereignViolation(
      'الملكُ لا ينفّذ: king.execute لا يقبل إلّا false — فملكٌ ينفّذ بيده لا يبقى له من يراجعه',
      'CONFIG_ROLE_KING_EXECUTES',
    );
  }
  if (auditorsOnly === 0) {
    throw new SovereignViolation(
      'لا مدقّقَ يدقّق ولا يفعل غيرَه — ومدقّقٌ يقترح أو ينفّذ يدقّق أثرَ يدِه (RULE-004)',
      'CONFIG_ROLE_NO_AUDITOR',
    );
  }

  return raw;
}
