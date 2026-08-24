/**
 * src/kernel/config/declaration_limits.ts — سقوفُ العدد المعلن (T-75)
 * المالك: القيّم على المستودع | المرحلة: 39 (دَينُ سقوفِ العدد)
 * المدخلات: عددٌ مقيسٌ من قائمةٍ في تهيئة | المخرجات: مرورٌ أو فشلٌ مغلق
 * حالات الفشل: عددٌ معلنٌ فوق السقف ⇒ `CONFIG_DECLARATION_OVER_CEILING` (فشل مغلق)
 *
 * **ولِمَ سكنت هذه السقوفُ الشفرةَ ولم تسكن الملفَّ الذي تحكمه؟**
 * في T-49 أُعلن سقفُ عددِ الحسابات وبنودِ الموازنة **في `config/economy.yaml`**، وكان ذلك
 * صحيحًا هناك: السقفُ يحكم عددًا **يقوم في التشغيل** بعد الإقلاع، والتهيئةُ تسبقه فتحدّه.
 * أمّا هنا فالمحكومُ هو **الإعلانُ نفسُه**. فلو كُتب `max_kinds` في `config/enterprises.yaml`
 * لكان ملفٌ فيه ألفُ نوعٍ يمرّ **بأن يكتب في نفسه `max_kinds: 1000`** — سقفٌ يوسّعه من يحكمه،
 * وهو عينُ ما يمنعه RULE-005 («لا توسّع من داخل الوحدة التي تحكمها السياسة»).
 * فالسقفُ على الإعلان **لا يُعلن في الملف الذي يحكمه**، بل يسكن النواةَ ثابتًا سياديًّا
 * كنظيره `SOVEREIGN_ACCOUNTS` — يُغيَّر بتعديل شفرةٍ تمرّ على البوابة، لا بسطرٍ في بيانات.
 */
import { SovereignViolation } from '../types';

/**
 * سقوفُ العدد المعلن، مقيسةً على ما هو قائمٌ اليوم لا مخترعةً:
 * `config/enterprises.yaml` يعلن **4** موادَّ و**3** أنواعٍ و**4** فحوصٍ و**4** جهاتِ تعليق.
 * فالسقوفُ أدناه تُبقي متّسعًا معلنًا للنموّ **ولا تُبقي بابًا بلا حدّ** — وكلُّ رفعٍ لها
 * أثرٌ في التاريخ يقرؤه من يأتي، لا سطرٌ يمرّ في تهيئة.
 */
export const DECLARATION_CEILINGS = Object.freeze({
  /** موادُّ الإنتاج المعلنة */
  materials: 64,
  /** أنواعُ المنشآت المعلنة */
  enterprise_kinds: 32,
  /** فحوصُ الجودة المعلنة وأوزانها */
  quality_checks: 16,
  /** الجهاتُ التي تملك تعليقَ منشأة */
  suspend_authorities: 8,
});

/** اسمُ سقفٍ معلن — لا يُحرس عددٌ بسقفٍ مصنوعٍ في موضع النداء */
export type DeclarationCeiling = keyof typeof DECLARATION_CEILINGS;

/**
 * يحرس عددًا معلنًا بسقفه السياديّ.
 * **والرفضُ يحمل العددَين مقيسَين** (`N/M`) لا نصًّا عامًّا: من بلغ سقفًا يجب أن يقرأ
 * كم أعلن وكم السقف، وإلّا صار الحاجزُ لغزًا يُحلّ بقراءة الشفرة.
 * @param ceiling اسمُ السقف السياديّ
 * @param count العددُ المقيسُ من التهيئة
 * @param label ما يُسمّى في نصّ الرفض (عربيّةً، فالرسالةُ تُقرأ لا تُحلَّل)
 */
export function guardDeclaredCount(
  ceiling: DeclarationCeiling, count: number, label: string,
): void {
  const max = DECLARATION_CEILINGS[ceiling];
  // ثابتٌ قابلٌ للوقوع: سقفٌ صفرٌ أو سالبٌ يُقعد الدولةَ عن الإقلاع، فيُردّ في مكانه
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new SovereignViolation(
      `سقفُ إعلانٍ غيرُ صالحٍ في النواة: ${ceiling}`, 'CONFIG_DECLARATION_CEILING_INVALID',
    );
  }
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new SovereignViolation(
      `عددٌ غيرُ مقيسٍ في التهيئة: ${label}`, 'CONFIG_DECLARATION_COUNT_UNMEASURED',
    );
  }
  if (count > max) {
    throw new SovereignViolation(
      `${label} فوق السقف المعلن — بلغ: ${count}/${max}. `
      + 'السقفُ على العدد المعلن يسكن النواةَ لا الملفَّ الذي يحكمه (RULE-005)',
      'CONFIG_DECLARATION_OVER_CEILING',
    );
  }
}
