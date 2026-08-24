/**
 * src/kernel/config/declaration_budget.ts — ميزانيّةُ الإعلان: سقفُ المجموع وسقفُ بايتات الملف (T-130)
 * المالك: القيّم على المستودع | المرحلة: 39 (دَينُ سقوفِ العدد)
 * المدخلات: حجمُ ملفٍ بالبايت، أو مجموعُ بايتاتٍ وعُقدٍ مقيسٌ من مجلد التهيئة
 * المخرجات: مرورٌ أو فشلٌ مغلق
 * حالات الفشل: `CONFIG_FILE_OVER_BYTE_CEILING` · `CONFIG_DECLARATION_TOTAL_BYTES_OVER_CEILING`
 *   · `CONFIG_DECLARATION_NODES_OVER_CEILING` · `CONFIG_BUDGET_CEILING_INVALID` (كلُّها فشلٌ مغلق)
 * اختبارات الوحدة: tests/kernel/config_budget.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0034-config-declaration-budget.md
 *   · القياسُ الخام: docs/audit/measurements/phase-39-T130.txt
 *
 * ثوابت هذه الوحدة:
 *   1) **الحرَسُ على كلِّ قائمةٍ ليس حرَسًا على المجموع**: في T-129 صار لكلِّ قائمةٍ سقفٌ
 *      ({@link ./declaration_limits}), وقيس في T-130 أنّ إعلانًا يبلغ **كلَّ** السقوف الثمانيةَ
 *      عشرَ دون تجاوز واحدٍ منها **يمرّ كاملًا**: 136437 بايتًا و3871 عُقدةً، وأكبرُ ملفٍ فيه
 *      24017 بايتًا، ويُقلع في زمنٍ لا يفوق ×1.4 من خطِّ الأساس (قِيس 11.0ms ثمّ 14.6ms
 *      في تشغيلَين — فالزمنُ يُعلن مدًى لا رقمًا، والبايتاتُ والعُقدُ حاصلٌ ثابت).
 *      فثمّ محورانِ لا يحرسهما عددُ القائمة: **بايتاتُ الملف** و**مجموعُ العُقد**.
 *   2) **القيمُ مقيسةٌ لا مُستحسَنة**: كلُّ سقفٍ أدناه أصلُه رقمٌ في
 *      `docs/audit/measurements/phase-39-T130.txt` مضروبٌ بمدًى معلن ومُدوَّرٌ إلى قوّةِ اثنين.
 *      من رفعه فليعد المسبار: `npm run probe:declaration-cost`.
 *   3) **البايتُ يُحرس قبل التحليل لا بعده**: سقفُ الملف يقع في {@link ./yaml} قبل أن يُحلَّل
 *      نصٌّ — فملفٌ بحجم مئتَي كيلوبايت يُردّ ولا يُصرف عليه محلّلٌ ثمّ يُردّ.
 *   4) **الميزانيّةُ تسكن النواةَ لا الملفَّ الذي تحكمها**: كنظيرِها في T-129، ولو كُتبت في
 *      `config/` لكان مَن تجاوزها يوسّعها من داخل ما تحكمه (RULE-005).
 */
import { SovereignViolation } from '../types';

/**
 * ميزانيّةُ الإعلان، مقيسةً من الحالة المجتمعة في `phase-39-T130.txt`:
 * حين تبلغ **كلُّ** السقوف الثمانيةَ عشرَ حدَّها معًا يبلغ الإعلانُ 136437 بايتًا،
 * وأكبرُ ملفٍ فيه 24017 بايتًا، وعُقدُه 3871. فالسقوفُ أدناه فوق ذلك بمدًى معلن.
 */
export const CONFIG_DECLARATION_BUDGET = Object.freeze({
  /**
   * أقصى حجمٍ لملفِّ تهيئةٍ واحد بالبايت — المقيسُ عند الحدّ المجتمع: 24017B (×2.7 متّسع).
   * ولهذا السقفِ أثرٌ مقيسٌ سابق: نفخُ T-129 بلغ بـ`external.yaml` **188703B**، فهو يُردّ
   * بهذا السقفِ وحدَه قبل أن يُنظر في عددِ قائمةٍ فيه.
   */
  file_bytes: 65_536,
  /** أقصى مجموعٍ لبايتات مجلد التهيئة — المقيسُ عند الحدّ المجتمع: 136437B (×1.9 متّسع) */
  total_bytes: 262_144,
  /** أقصى مجموعٍ للعُقد المعلنة في المجلد كلِّه — المقيسُ عند الحدّ المجتمع: 3871 (×2.1 متّسع) */
  declared_nodes: 8_192,
});

/** اسمُ سقفٍ في الميزانيّة — لا يُحرس قدرٌ بسقفٍ مصنوعٍ في موضع النداء */
export type ConfigBudgetCeiling = keyof typeof CONFIG_DECLARATION_BUDGET;

/** سقفٌ صفرٌ أو سالبٌ يُقعد الدولةَ عن الإقلاع، فيُردّ في مكانه لا يُمرَّر */
function ceilingOf(name: ConfigBudgetCeiling): number {
  const max = CONFIG_DECLARATION_BUDGET[name];
  if (!Number.isSafeInteger(max) || max <= 0) {
    throw new SovereignViolation(
      `سقفُ ميزانيّةٍ غيرُ صالحٍ في النواة: ${name}`, 'CONFIG_BUDGET_CEILING_INVALID',
    );
  }
  return max;
}

/**
 * يحرس حجمَ ملفِّ تهيئةٍ واحدٍ بالبايت **قبل تحليله**.
 * @param path مسارُ الملف — يُطبع في الرفض، فمن بلغ السقفَ يعرف أيَّ ملفٍ يقصّ
 * @param bytes الحجمُ المقيسُ بالبايت
 */
export function guardConfigFileBytes(path: string, bytes: number): void {
  const max = ceilingOf('file_bytes');
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new SovereignViolation(
      `حجمُ ملفِّ تهيئةٍ غيرُ مقيس: ${path}`, 'CONFIG_DECLARATION_COUNT_UNMEASURED',
    );
  }
  if (bytes > max) {
    throw new SovereignViolation(
      `ملفُّ تهيئةٍ فوق سقفِ البايتات — ${path} بلغ: ${bytes}/${max}. `
      + 'الميزانيّةُ تسكن النواةَ لا الملفَّ الذي تحكمه (RULE-005)',
      'CONFIG_FILE_OVER_BYTE_CEILING',
    );
  }
}

/**
 * يحرس **مجموعَ** الإعلان: بايتاتِ المجلد كلِّه وعُقدَه المعلنة.
 * ولِمَ رقمان لا رقم؟ لأنّ المحورَين يفترقان: تعليقاتٌ طويلةٌ تُكبر البايتاتَ ولا تُكبر
 * العُقد، وقائمةٌ من مُعرِّفاتٍ قصيرةٍ تُكبر العُقدَ ولا تُكبر البايتاتَ كثيرًا. فمن حرس
 * أحدَهما وحده تركَ البابَ الآخرَ مفتوحًا.
 * @param bytes مجموعُ بايتات ملفات التهيئة
 * @param nodes مجموعُ العُقد المعلنة فيها
 */
export function guardDeclarationTotals(bytes: number, nodes: number): void {
  const maxBytes = ceilingOf('total_bytes');
  const maxNodes = ceilingOf('declared_nodes');
  if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(nodes) || nodes < 0) {
    throw new SovereignViolation(
      'مجموعُ الإعلان غيرُ مقيس — لا يُحرس ما لم يُقس', 'CONFIG_DECLARATION_COUNT_UNMEASURED',
    );
  }
  if (bytes > maxBytes) {
    throw new SovereignViolation(
      `مجموعُ بايتات التهيئة فوق السقف المعلن — بلغ: ${bytes}/${maxBytes}. `
      + 'ما يمرّ قائمةً قائمةً قد لا يمرّ مجموعًا (T-130)',
      'CONFIG_DECLARATION_TOTAL_BYTES_OVER_CEILING',
    );
  }
  if (nodes > maxNodes) {
    throw new SovereignViolation(
      `مجموعُ العُقد المعلنة فوق السقف المعلن — بلغ: ${nodes}/${maxNodes}. `
      + 'ما يمرّ قائمةً قائمةً قد لا يمرّ مجموعًا (T-130)',
      'CONFIG_DECLARATION_NODES_OVER_CEILING',
    );
  }
}
