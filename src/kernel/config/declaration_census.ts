/**
 * src/kernel/config/declaration_census.ts — حصرُ الإعلان: يُقاس المجلدُ ثمّ يُحرس مجموعُه (T-130)
 * المالك: القيّم على المستودع | المرحلة: 39 (دَينُ سقوفِ العدد)
 * المدخلات: مسارُ مجلد التهيئة | المخرجات: قياسٌ ({@link DeclarationCensus}) ثمّ مرورٌ أو فشلٌ مغلق
 * حالات الفشل: مجلدٌ غيرُ مقروءٍ ⇒ استثناءُ نظامِ الملفات؛ ومجموعٌ فوق السقف ⇒ رمزُ الرفض من
 *   {@link ./declaration_budget} (فشلٌ مغلق — RULE-007: لا يُبتلع خطأ)
 * اختبارات الوحدة: tests/kernel/config_budget.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0034-config-declaration-budget.md
 *
 * ثوابت هذه الوحدة:
 *   1) **العُقدةُ مفتاحٌ أو عنصر**: يُعَدُّ كلُّ مفتاحٍ في خريطةٍ وكلُّ عنصرٍ في قائمةٍ في
 *      المستند كلِّه، لا القوائمُ المسقوفةُ وحدها. فما فُتح بابُه لاحقًا يُحسب اليومَ.
 *   2) **الحصرُ لا يُحمّل الدولةَ**: يقرأ ويحلّل ولا يبني كائنًا سياديًّا ولا يكتب في سجل،
 *      فوقوعُه لا يترك أثرًا نصفيًّا — وهو أوّلُ ما يُنادى في تركيب السيادة قبل أيِّ محمّل.
 *   3) **الحدُّ المُعلن للحصر**: يقتصر على `*.yaml` مباشرةً في المجلد. فما يُخبّأ في مجلدٍ
 *      فرعيٍّ أو بلاحقةٍ أخرى **لا يُحصى**، وهذا انحرافٌ مُعلنٌ لا مسكوتٌ عنه: البندُ T-133.
 *   4) **مسارُ الحرَس واحدٌ لا اثنان**: من نادى محمّلًا مفردًا لا يمرّ بهذا الحصر — يمرّ
 *      بسقفِ بايتات ملفِّه في {@link ./yaml} وبسقفِ قوائمه، لا بسقفِ المجموع. وذاك مُعلنٌ في
 *      T-133 أيضًا: حرَسُ المجموع حرَسُ إقلاعٍ لا حرَسُ نداءٍ مفرد.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { guardDeclarationTotals } from './declaration_budget';
import { parseSimpleYaml } from './yaml';

/** قياسُ مجلد التهيئة كما هو — أرقامٌ تُقرأ لا حكمٌ يُصدر */
export type DeclarationCensus = {
  /** عددُ ملفات `*.yaml` المحصورة */
  readonly files: number;
  /** مجموعُ بايتاتها */
  readonly bytes: number;
  /** حجمُ أكبرِها بالبايت */
  readonly largestBytes: number;
  /** اسمُ أكبرِها — يُقرأ في التقارير فلا يُبحث عنه يدويًّا */
  readonly largestFile: string;
  /** مجموعُ العُقد المعلنة: كلُّ مفتاحٍ في خريطةٍ وكلُّ عنصرٍ في قائمة */
  readonly nodes: number;
};

/**
 * مجموعُ العُقد المعلنة في مستندٍ مُحلَّل.
 * ليس قياسًا لحجمِ الذاكرة بل لعددِ ما أُعلن — وهو أحدُ محورَي ميزانيّة T-130.
 */
export function countNodes(value: unknown): number {
  if (Array.isArray(value)) {
    let n = value.length;
    for (const item of value) n += countNodes(item);
    return n;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    let n = entries.length;
    for (const item of entries) n += countNodes(item);
    return n;
  }
  return 0;
}

/**
 * يقيس مجلدَ التهيئة: ملفاتُه وبايتاتُه وأكبرُها وعُقدُه — قياسٌ بلا حكم.
 * والقراءةُ هنا مباشرةٌ لا عبر `loadYamlFile`: الحصرُ يريد **الحجمَ والنصَّ معًا** في مرورٍ
 * واحدٍ، وسقفُ بايتات الملفِّ الواحد يقع في `loadYamlFile` حين يُحمَّل الملفُّ فعلًا.
 */
export function censusDeclaration(configDir: string): DeclarationCensus {
  const names = readdirSync(configDir).filter((f) => f.endsWith('.yaml')).sort();
  let bytes = 0;
  let nodes = 0;
  let largestBytes = 0;
  let largestFile = '';
  for (const name of names) {
    const path = join(configDir, name);
    const size = statSync(path).size;
    bytes += size;
    if (size > largestBytes) {
      largestBytes = size;
      largestFile = name;
    }
    nodes += countNodes(parseSimpleYaml(readFileSync(path, 'utf8')));
  }
  return { files: names.length, bytes, largestBytes, largestFile, nodes };
}

/**
 * يقيس ثمّ يحرس: مجموعُ الإعلان لا يتجاوز ميزانيّتَه المعلنة في النواة.
 * يُنادى مرّةً واحدةً في أوّلِ تركيبِ السيادة — قبل أن يُحمَّل محمّلٌ واحد، فلا تُبنى دولةٌ
 * نصفَ بناءٍ ثمّ يُقال «الإعلانُ أكبرُ من ميزانيّته».
 * @returns القياسُ نفسُه ليُدوَّن في السجل — فالحرَسُ الصامتُ لا يُقرأ أثرُه
 */
export function guardDeclarationBudget(configDir: string): DeclarationCensus {
  const census = censusDeclaration(configDir);
  guardDeclarationTotals(census.bytes, census.nodes);
  return census;
}
