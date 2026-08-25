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
 *   3) **مدى الحصر يُقرأ من ثابتٍ لا من حرفٍ في هذا الملف** (T-133): المشيُ في
 *      {@link ./declaration_reach} يعدّ لواحقَ {@link DECLARATION_REACH.extensions} في المجلد
 *      **وفي مجلداته الفرعيّة** حتى العمق المعلن. وكان الحصرُ يقتصر على `*.yaml` مباشرةً،
 *      فقيس أنّ **240032 بايتًا** في مجلدٍ فرعيٍّ تمرّ بسقفِ المجموع بلا أن يراها.
 *   4) **مسارانِ للحرَس لا مسارٌ واحد** (T-133): هذا الحصرُ يحرس **المجلدَ كلَّه قبل أوّلِ
 *      تحميلٍ** فلا تُبنى دولةٌ نصفَ بناء؛ و{@link ./declaration_reach} يحرس **مجموعَ ما
 *      حُمِّل فعلًا عند كلِّ قراءة** فلا يهرب من نادى محمّلًا مفردًا. والأوّلُ يرى ما لا
 *      يُحمَّل، والثاني يرى ما يُحمَّل من خارج المجلد — فما يراه أحدُهما لا يراه الآخر.
 */
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { guardDeclarationTotals } from './declaration_budget';
import { countNodes, walkDeclarationFiles } from './declaration_reach';
import { noteBootWork } from './declaration_work';
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
 * يقيس مجلدَ التهيئة: ملفاتُه وبايتاتُه وأكبرُها وعُقدُه — قياسٌ بلا حكم.
 * والقراءةُ هنا مباشرةٌ لا عبر `loadYamlFile`: الحصرُ يريد **الحجمَ والنصَّ معًا** في مرورٍ
 * واحدٍ، وسقفُ بايتات الملفِّ الواحد يقع في `loadYamlFile` حين يُحمَّل الملفُّ فعلًا.
 */
export function censusDeclaration(configDir: string): DeclarationCensus {
  const paths = walkDeclarationFiles(configDir);
  let bytes = 0;
  let nodes = 0;
  let largestBytes = 0;
  let largestFile = '';
  for (const path of paths) {
    const size = statSync(path).size;
    bytes += size;
    if (size > largestBytes) {
      largestBytes = size;
      largestFile = relative(configDir, path);
    }
    const fileNodes = countNodes(parseSimpleYaml(readFileSync(path, 'utf8')));
    nodes += fileNodes;
    noteBootWork('file_reads');
    noteBootWork('bytes_read', size);
    noteBootWork('node_visits', fileNodes);
  }
  return { files: paths.length, bytes, largestBytes, largestFile, nodes };
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
