# التقرير الخام — مجلس المراجعة، الجلسة 19 (gpt)

**البند:** W-2026-064  
**الالتزام المراجع:** `9c4b8ba40dc401c4abcb60ffd0313460cf51a330`  
**نطاق المراجعة:** حارس الروابط وناقلا خوارزمية الكتل والمضمّنات إلى `tests/governance/markdown_blocks.ts` و`tests/governance/markdown_inline.ts`.  
**حدود المراجعة:** لم أعدّل أي ملف من ملفات المشروع؛ هذا التقرير وحده هو المخرج. لم يوجد `BRIEF.md` في جذر الوحدة عند البدء (`find . -maxdepth 3 -name BRIEF.md` لم يُظهره)، لذلك سُجّل هذا الغياب بدل افتراض محتواه. لم أقرأ تقارير أعضاء آخرين أو مسودات منفّذ.

## 1) سلامة الشيء المراجع

- `git rev-parse HEAD` أعاد الالتزام المعلن أعلاه.
- `git diff --exit-code -- . ':!dist'` نجح بلا فرق قبل إنشاء هذا التقرير.
- فرق الدمج `9c4b8ba^1..9c4b8ba` يستبدل الماسحات النمطية القديمة في `tests/governance/doc_links.test.ts` باستدعاء `markdownLinks`، ويضيف محلل الكتل وماسح المضمّنات. لا توجد تبعية `commonmark` في `package.json` أو `package-lock.json`.
- اشتمال النقل ليس ادعاءً لفظيًّا وحده: يستدعي الحارس `markdownLinks(text)` ثم يقيس الوجهات المباشرة والتعريفات؛ والاختبار الحرفي للمسابير موجود في الأسطر 290–308 من `tests/governance/doc_links.test.ts`.

## 2) القياسات المعادة

| الأمر | النتيجة المقاسة | رمز الخروج |
|---|---|---:|
| `npm install` | up to date؛ audited 4 packages؛ 0 vulnerabilities | 0 |
| `npm test` | `tests 2441`، `pass 2440`، `fail 1`؛ لم يُظهر خرج الأداة اسم الساقط بسبب اقتصاص خرج TAP | 1 |
| `npm run verify` | أعاد تشغيل الاختبارات: `tests 2441`، `pass 2441`، `fail 0`؛ ثم مرّت جميع حواجز `verify` حتى `check:work` | 0 |
| `node --test dist/tests/governance/doc_links.test.js` | 16/16 ناجحة، ومنها مسبار الجلسة 18 الحرفي | 0 |
| `npm view commonmark@0.31.2 version` | `0.31.2` متاح | 0 |
| `npm view commonmark@1.0.0 version` | `E404: No match found for version 1.0.0`؛ لا قياس منسوب إلى 1.0.0 | 1 (الأمر الأصلي؛ جُمعت النتيجة في غلاف أخرج 0) |

استعملت `commonmark@0.31.2` مرجعًا خارجيًّا مؤقتًا عبر `npm install --no-save --package-lock=false commonmark@0.31.2`، ثم قارنت عقد AST من `new CommonMark.Parser()` بمخرج `brokenLinksIn('docs/a.md', text, () => false)`؛ لا أضفتها تبعية للمشروع.

## 3) مسابير عيوب الجلسة 18 الحرفية

القاعدة في جدول «الحارس» هي مخرج `brokenLinksIn` (أي الوجهات النسبية المكسورة فقط). مخرج المرجع يسرد عقد الرابط؛ ولذلك يترك رابط URL المطلق خارج مقارنة الحارس.

| العيب | نص المسبار الحرفي/المجموعة | commonmark@0.31.2 | الحارس `brokenLinksIn` | النتيجة |
|---|---|---|---|---|
| `EQUAL_PRECEDENCE` (التلقائي) | `<https://example.com/\`x> [x](missing.md) \`` | `https://example.com/%60x`, `missing.md` | `missing.md` | مطابق للوجهة النسبية المقيسة |
| `EQUAL_PRECEDENCE` (HTML خام) | `<a href="\`"> [x](missing.md) \`` | `missing.md` | `missing.md` | مطابق |
| `FENCE_INFO_BACKTICK` | ```` ```js `not\n[x](missing.md)\n``` ```` | `missing.md` | `missing.md` | عولج التفويت |
| `SCRIPT_SAMELINE_CLOSE_MISS` | `<script></script>\n[x](missing.md)` | `missing.md` | `missing.md` | عولج التفويت |
| `SCRIPT_BLANK_EARLY_EXIT_FP` | `<script>\n\n[x](missing.md)\n</script>` | لا رابط | `[]` | عولج البلاغ الزائد |
| `HEADING_INLINE_CODE_FP` | `` `open\n# `[x](missing.md)` `` | لا رابط | `[]` | عولج البلاغ الزائد |
| الحاويات الثماني | الحالات الثماني الحرفية (4 قائمة و4 اقتباس) في `doc_links.test.ts` | لا رابط في كل حالة | `[]` في كل حالة | عولجت البلاغات الزائدة الثمانية |

أمر المقارنة القابل للإعادة الذي نُفذ بعد البناء:

```sh
node <<'NODE'
const CM = require('commonmark');
const { brokenLinksIn } = require('./dist/tests/governance/doc_links.test.js');
const parser = new CM.Parser();
function refLinks(s) {
  const out = [], w = parser.parse(s).walker(); let e;
  while ((e = w.next())) if (e.entering && e.node.type === 'link') out.push(e.node.destination);
  return out;
}
// تُمرر نصوص المسابير الحرفية الستة إلى refLinks وbrokenLinksIn.
NODE
```

خرج المقارنة أعطى القيم المعروضة في الجدول: تطابق كل وجهة نسبية ينبغي أن يقيسها الحارس، وعدم بلاغ في الحالات الثلاث ذات «لا رابط» (مع مجموعة الحاويات الثماني).

## 4) معيار القبول (§4 من العقد)

| بند القبول | الدليل المعاد | الحكم |
|---|---|---|
| صفر رابط نسبي مكسور في الشجرة | اختبار حارس الروابط ضمن التشغيل المخصّص: ناجح؛ وهو أيضًا ضمن `verify` الناجح | مستوفى |
| الحارس داخل `npm test` وقائمة الانتظار فارغة | اختبار الحارس المخصّص 16/16 ناجح؛ وتشغيل `verify` أعاد مجموعة الاختبارات كاملة 2441/2441 | مستوفى |
| لا رقم منقول غير محروس في ترويسة `ARCHITECTURE.md` وصف الاختبارات مقاس | `check:numbers` داخل `verify` أعلن `tests.total=2441` و`passing=2441` مطابِقين لخرج المشغل | مستوفى |
| `npm run check:criteria` و`npm run verify` | كلاهما مرّ ضمن `verify`؛ والنهاية 0 | مستوفى |

## 5) الحكم

إعادة `npm test` المستقلة الأولى فشلت مرة واحدة (1/2441) ثم أعادت سلسلة `verify` الاختبارات نفسها بنجاح 2441/2441 ورمز 0؛ سُجّل التباين ولا يُمحى. لكنه لا ينقض معيار §4 المقاس في تشغيل `verify` الناجح، ولا يعيد أيًا من مسابير العيوب الستة إلى حالة مخالفة للمرجع 0.31.2. أمّا `commonmark@1.0.0` فغير متاح في npm (E404) ولم يُدّع قياسه.

VERIFIED — مسابير العيوب الستة تطابق commonmark@0.31.2، ومعيار §4 مرّ في `npm run verify` برمز 0.
