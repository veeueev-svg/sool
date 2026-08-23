/**
 * src/kernel/config/intent.ts — سياسةُ حاجز النية على مستوى المعاملات من التهيئة
 * المالك: ديوان التدقيق | المرحلة: 39 (البند T-31 — إكمالُ C-12)
 * المدخلات: config/intent.yaml | المخرجات: IntentConfig
 * التبعيات: محلّل YAML الآمن و`resolveConfigDir` — ولا شيء غيرهما
 * الصلاحيات: القراءةُ والتحقّق؛ ولا تُنشئ هذه الوحدة حاجزًا ولا تُنفّذه
 * السجلات: لا شيء — القراءةُ لا تُقيَّد، والقرارُ يُقيَّد في وحدته
 * حالات الفشل (كلها مغلقة):
 *   - لا ملف أو لا سياسة معلنة ⇒ CONFIG_NO_INTENT_POLICY
 *   - الافتراض ليس رفضًا ⇒ CONFIG_INTENT_DEFAULT_ALLOW
 *   - شرطٌ مُلزمٌ مُعطَّلٌ من التهيئة ⇒ CONFIG_INTENT_GUARD_DISABLED
 *   - حدٌّ غائبٌ أو غيرُ صحيحٍ موجب ⇒ CONFIG_INTENT_LIMIT
 *   - خرقُ معاملاتٍ مسموحٌ فوق الصفر ⇒ CONFIG_INTENT_BREACH
 *   - شدّةُ الإنتاج ليست «حرجة» ⇒ CONFIG_INTENT_SEVERITY
 * اختبار القبول: tests/kernel/intent_config.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0029-argument-intent-and-channels.md
 *
 * ثوابت هذه الوحدة:
 *   1) **الشرطان مُلزمان.** `require_argument_declaration` و`refuse_undeclared_argument`
 *      لا يُعطَّلان من ملف: من يملك تعطيلَ الشرط يملك نقضَ المعيار بسطر (RULE-007).
 *   2) **هذا الملفُّ المصدرُ الوحيد** لهذه الأرقام (RULE-005) — لا نسخةَ منها في الشيفرة.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SovereignViolation } from '../types';
import { resolveConfigDir } from './paths';
import { loadYamlFile } from './yaml';

export interface IntentLimits {
  /** شرطٌ مُلزم: لا خطّةَ بلا إعلانِ معاملات — و`false` يُسقط تحميلَ التهيئة */
  readonly requireArgumentDeclaration: true;
  /** شرطٌ مُلزم: معاملٌ لم يُعلَن يُرفض ولا يُهمَل */
  readonly refuseUndeclaredArgument: true;
  readonly maxArgsPerStep: number;
  readonly maxValuesPerArg: number;
  readonly maxValueChars: number;
  readonly maxStepsPerPlan: number;
  /** خرقُ المعاملات المسموح — صفرٌ دائمًا، والتهيئةُ لا تملك رفعَه */
  readonly maxArgumentBreach: 0;
}

export interface IntentConfig {
  readonly limits: IntentLimits;
  readonly productionSeverity: 'critical';
}

const LIMIT = 'CONFIG_INTENT_LIMIT';

function positiveInt(raw: unknown, field: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new SovereignViolation(
      `حدُّ النية «${field}» غير معلنٍ أو غيرُ صحيحٍ موجب — لا حدَّ بلا رقم`,
      LIMIT,
    );
  }
  return value;
}

function mandatoryGuard(raw: unknown, field: string): true {
  if (raw !== true) {
    throw new SovereignViolation(
      `شرطُ النية «${field}» مُلزمٌ ولا يُعطَّل من التهيئة — تعطيلُه نقضٌ للمعيار C-12`,
      'CONFIG_INTENT_GUARD_DISABLED',
    );
  }
  return true;
}

function readLimits(policy: Record<string, unknown>): IntentLimits {
  if (Number(policy.max_argument_breach) !== 0) {
    throw new SovereignViolation(
      'خرقُ المعاملات المسموح لا يكون فوق الصفر — نداءٌ واحدٌ بقيمةٍ لم تُعلَن يُسقط المعيار',
      'CONFIG_INTENT_BREACH',
    );
  }
  return Object.freeze({
    requireArgumentDeclaration: mandatoryGuard(
      policy.require_argument_declaration, 'require_argument_declaration',
    ),
    refuseUndeclaredArgument: mandatoryGuard(
      policy.refuse_undeclared_argument, 'refuse_undeclared_argument',
    ),
    maxArgsPerStep: positiveInt(policy.max_args_per_step, 'max_args_per_step'),
    maxValuesPerArg: positiveInt(policy.max_values_per_arg, 'max_values_per_arg'),
    maxValueChars: positiveInt(policy.max_value_chars, 'max_value_chars'),
    maxStepsPerPlan: positiveInt(policy.max_steps_per_plan, 'max_steps_per_plan'),
    maxArgumentBreach: 0 as const,
  });
}

/** تحميلُ سياسةِ النية — الفشلُ مغلقٌ ولا افتراضاتَ صامتة */
export function loadIntent(configDir = resolveConfigDir()): IntentConfig {
  const path = join(configDir, 'intent.yaml');
  if (!existsSync(path)) {
    throw new SovereignViolation(
      'لا ملفَ سياسةِ نية — ولا حاجزَ نيةٍ بلا سياسةٍ معلنة',
      'CONFIG_NO_INTENT_POLICY',
    );
  }
  const doc = loadYamlFile(path) as Record<string, unknown>;
  const policy = doc.policy as Record<string, unknown> | undefined;
  if (!policy || typeof policy !== 'object') {
    throw new SovereignViolation(
      'ملفُّ النية بلا قسمِ سياسة — لا شروطَ تُقرأ',
      'CONFIG_NO_INTENT_POLICY',
    );
  }
  if (policy.default !== 'deny') {
    throw new SovereignViolation(
      'افتراضُ سياسةِ النية يجب أن يكون رفضًا — والسماحُ الافتراضي فعلٌ بلا نيةٍ معلنة',
      'CONFIG_INTENT_DEFAULT_ALLOW',
    );
  }
  if (doc.production_severity !== 'critical') {
    throw new SovereignViolation(
      'شدّةُ حادثِ النية في الإنتاج لا تُخفَّف عن «حرج»',
      'CONFIG_INTENT_SEVERITY',
    );
  }
  return Object.freeze({
    limits: readLimits(policy),
    productionSeverity: 'critical' as const,
  });
}
