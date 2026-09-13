<!--
الخرجُ الخامُّ للمراجع (ب) — أُرسِل على نموذجِ Grok 4.6 (xAI) وأعلن عن نفسِه «Grok / xAI»
بلا رقمِّ إصدارٍ أدقّ — مُعلَنًا لا مُثبَتًا (RULE-019)
هذا الملفُّ **خرجٌ خامٌّ محفوظٌ حرفًا بحرفٍ كما ورد من المراجع** (WORK_CONTROL.md §12:
التلخيصُ لا يُقوم مقامَ الخرجِ الخام). لا يُحرَّر ولا يُصحَّح ولا يُشكَّل، وما فيه من
حكمٍ حكمُ المراجعِ لا حكمُ المنفّذ — والمنفّذُ لا يراجع عملَه (RULE-004).

المراجَع: W-2026-040 · الجولةُ الرابعة · 2026-09-13
حزمةُ الأدلّة: 824 ملفًّا (الشجرةُ كاملةً عدا المولَّدات) · بصمةُ البيان الجامعة:
  sha256(MANIFEST.sha256) = d4523a356ce753a0fe1dfc3314fece3e2dbfb221b17e8e019c320049dadb8ec5
طابق المراجعُ البيانَ بـ`sha256sum -c`: 824/824 · نسختُه للقراءةِ فقط: /tmp/w040r4/reviewer-beta/evidence/
القاعدةُ المقيسة: 37f9f9aa986fd787888c7066aa49d891bfd75425 · التجميد: 2026-09-13T20:18:41Z
مُتنُ الطلب: /tmp/w040r4/REVIEW-PROMPT.md (123 سطرًا)
  sha256 = db07199a5040d3e4e08ff7638ed5fa9293246d2c421302e5280223fd91796ffa
الحكم: REJECTED_WITH_NAMED_DEFECT
-->
## هُويّتي (إعلانٌ لا إثبات)

أنا مراجعٌ مستقلٌّ (ب) في هذه الجولة، أُعلَن في طلبِ المهمة باسم **Grok / xAI**. لا يُكشَف لي من داخلِ السياق رقمُ إصدارٍ أدقُّ يمكنني توثيقُه؛ فلا أخمّن إصدارًا. هذا **إعلانٌ ذاتيٌّ لا إثبات** لهويّة النموذج ولا لاستقلاله التنظيميّ.

## إقرارُ العزل

قرأتُ **حزمةَ الأدلّةِ المجمّدةَ وحدها** من `/tmp/w040r4/reviewer-beta/evidence/`، ونسختُ منها إلى مسارِ المسوّدة `/tmp/w040r4/reviewer-beta/scratch/` ما لزم للتشغيل والتطفير. **لم أقرأ** المستودعَ الأصليَّ `/home/user/workspace` محتوًى لهذا البند، ولا `/tmp/w040r4/reviewer-alpha`، ولا `/tmp/w040r4/bundle`، ولا أيَّ خرجِ مراجعةٍ للجولةِ الرابعة. لم أستشر شبكةً ولا المراجعَ الآخر. الحكمُ من قراءة الحزمة وتشغيل شجرتِها المنسوخة في المسوّدة.

## تحقّقُ الحزمة

الأوامرُ كما طُلبت حرفيًّا من جذر الأدلّة:

```
cd /tmp/w040r4/reviewer-beta/evidence
sha256sum -c MANIFEST.sha256 | tail -5
tests/staging/staging_config.test.ts: OK
tests/staging/staging_ledger.test.ts: OK
tests/staging/staging_lifecycle.test.ts: OK
tsconfig.json: OK
version.json: OK

sha256sum MANIFEST.sha256
d4523a356ce753a0fe1dfc3314fece3e2dbfb221b17e8e019c320049dadb8ec5  MANIFEST.sha256

cat BASE-COMMIT.txt FREEZE-TIME.txt
37f9f9aa986fd787888c7066aa49d891bfd75425
2026-09-13T20:18:41Z
```

البصمةُ الجامعة تطابق المتوقَّع `d4523a356ce753a0fe1dfc3314fece3e2dbfb221b17e8e019c320049dadb8ec5`. بيانُ الحزمة 824 سطرًا، و`sha256sum -c` أصاب **824/824** (`OK=824 FAILED=` فارغ). فما حُكم عليه هو ما جُمّد.

## مدخلُ الفحص — الفجوةُ بين النصِّ المطبوع والشجرة

نصُّ نجاح الحاجز بعد `fail === 0` (`scripts/check_rehydrate_census.ts:372-374`) يقول حرفًا:

> يشهد أنّ للصنفِ **فرعًا في شجرةِ النحوِ داخلَه أثرٌ قابلٌ للوصول** من أربعةٍ تُسمّى وحدَها — **إسنادٌ أو نداءٌ لغيرِ أداةِ تسجيلٍ أو رميٌ أو إنشاءٌ** — وما عداها فلا أثرَ له (قائمةُ إثباتٍ لا قائمةُ نفي)، **وشرطٌ ثابتُ الكذبِ يُبطِل ما تحتَه.**

هذا هو شاهدُ الرفض في الجولات الثلاث: وعدٌ مطبوعٌ أوسعُ من الشجرة. قيستُه في المسوّدة فكذّبته الشجرة على صيغٍ تشتغل وتُخضِر الحاجز (`EXIT=0`) حيث يَعِد النصُّ بالرفض.

---

## حكمُ كلِّ دعوى من العشر

### 1) قائمةُ إثباتٍ لا قائمةُ نفي

**مقبولة في حدود ما تقوله عن التصنيف، لا عن الوصول.**

- الافتراض الرافض مقيس: خاتمة `effectful` هي `return false` (`scripts/rehydrate_effect.ts:214-215`)، وخاتمة `effectfulExpression` هي `return false` (`:155-156`). `record.kind;` و`[];` و`while (false) {}` و`try {} finally {}` و`function g() { … }` و`lbl: break lbl;` كلُّها `false` في المسوّدة.
- الأنواع الأربعة تُسمَّى: إسنادٌ (`:122`) · نداءٌ لغير تسجيل (`:131`) · رميٌ (`effectful:170`) · إنشاءٌ (`:133`). لا خامسَ في القائمة.
- مدى الإسناد من ثوابت المترجم لا من سرد يدوي: `kind >= FirstAssignment && kind <= LastAssignment` (`:100-101`). قيس: `FirstAssignment=64` (=`EqualsToken`) · `LastAssignment=79` (=`CaretEqualsToken`) · `PlusEqualsToken=65` · `AmpersandAmpersandEqualsToken=77` · `QuestionQuestionEqualsToken=78` داخل المدى. و`EqualsEqualsToken=35` و`EqualsEqualsEqualsToken=37` **خارجه** فلا يُخلط الإسناد بالمقارنة.

ما يُسقط الدعوى التالية لا هذه: الوصول عبر شرطٍ مركّب ثابت الكذب ليس «خامسًا» في القائمة، بل خرقًا لشرط القابلية للوصول.

### 2) الأثرُ لا يعبُر شرطًا ثابتَ الكذب

**مرفوضة.** العيب المسمّى: `EFFECT_CROSSES_COMPOUND_CONSTANT_FALSY` (رتبة **حاجز**).

الصيغ الحرفيّة التي سمّاها النصُّ (`if (false)` · `while (false)`) تُرفض كما وُعد:

| الصيغة | `effectful` | الحاجز الكامل |
|---|---|---|
| `if (false) { state.x += 1; }` | `false` | `EXIT=1` `[RC-03]` |
| `while (false) { state.x += 1; }` | `false` | (تطفير r3 الرسمي أخضر-يسقط) |
| `false ? (state.x += 1) : 0` | `false` | — |
| `do { state.x += 1; } while (false)` | `true` | حدُّ الدقّة المعلن — يُنفَّذ مرّة |

و`guardsOf` يسجّل `while`/`for`/`do`/`for-of` كما ادُّعي (`scripts/check_rehydrate_census.ts:267-278`): تطفير `if (journal) { if (false && true) assert… }` يسقط بـ`[RC-07]` لأنّ الشرط الإضافيَّ يُضيّق لا لأنّه ثابتُ كذب.

**لكنّ `constantFalsy` لا يعرف إلّا حرفيًّا** (`scripts/rehydrate_effect.ts:68-79`): `false`/`null`/`0`/`''`/`undefined`/`NaN`/`void`/`!ثابتِ صدق`. ولا يغوص في `&&`/`||`. و`effectfulExpression` على الروابط المنطقيّة **يُمرِّر أثرَ أحد الطرفين بلا سؤالٍ عن ثابت الكذب** (`:139-146`) — بينما الشرطيُّ `?:` يسأل (`:148-152`). فالشجرة تناقض وعدها في الجهة التي وعدت بها:

| الصيغة (أثرٌ تحت شرطٍ قيمتُه كذبٌ دائم) | `effectful` | `dispatchSites` | الحاجز |
|---|---|---|---|
| `if (false && true) { state.levySequence += 1; }` | `true` | `["case@…]` | **`EXIT=0`** |
| `if (false \|\| false) { … += 1; }` | `true` | مقبول | **`EXIT=0`** |
| `if (true && false) { … += 1; }` | `true` | مقبول | **`EXIT=0`** |
| `false && (state.levySequence += 1);` | `true` | مقبول | **`EXIT=0`** |
| `true \|\| (state.levySequence += 1);` | `true` | مقبول | **`EXIT=0`** |
| `while (false && true) { … += 1; }` | `true` | — | — |
| `for (; false && true; ) { … }` | `true` | — | — |
| `switch (0) { case 1: … += 1; }` | `true` | مقبول | **`EXIT=0`** |
| `for (const x of []) { … += 1; }` | `true` | مقبول | **`EXIT=0`** |

هذه هي **الصيغة الرابعة للعلّة الأمّ**: نُزِع منطقُ إرجاع `tax_levy` وأُبقي إسنادٌ تحت شرطٍ ثابتِ الكذب غيرِ حرفيّ، فأخضرَ `[RC-03]` وطبَع الحاجزُ أنّ شرطًا ثابتَ الكذب يُبطل ما تحته. والقيد يُدوَّن ويُسقَط صمتًا.

و`do … while (false)` يُنفَّذ مرّة كما أُعلن — هذا الحدُّ صادق. لا يُنجي المركّب.

### 3) تعريفُ الدالّةِ إعلانٌ لا تنفيذ

**مقبولة.** `function g() { state.x += 1; }` → `effectful=false`. تطفير r3 الرسمي (`rehydrate_census_mutations_r3.test.ts:67-71`) يسقط بـ`[RC-03]`. قيس في مجموعة الاختبارات الرسمية: `ok 4` في 5/5.

### 4) خريطةُ المُعالِجين شُدّدت بثلاثةٍ مجتمعةً

**مرفوضة.** العيب: `HANDLER_MAP_DEAD_CALL_ACCEPTED` (رتبة **كبير**).

الثلاثة البنيويّة قائمة جزئيًّا ومقيسة:

- جسم فارغ `{ tax_levy: () => {} }` → `handler_empty` مواقعُه `[]`، وتطفير r3 يسقط بـ`[RC-03]`.
- جدول خدعة غير المفتوح `other[entry.kind]` → `[]`.
- خريطة صحيحة (انتقاء ثم نداء بعد تحقّق) → `EXIT=0` مع 21 — الاختبار الحميد الرسمي `ok 5`.

لكنّ «القيمةُ المُنتقاةُ تُنادى» لا تشترط أن يكون النداء **قابلًا للوصول**. `openedAndCalled` (`scripts/rehydrate_dispatch.ts:253-268`) يجمع نداءً على الفتح أو على اسم المنتقى **بلا `guardsOf`**. قيس:

```
handler_dead_if_false  → ["handler@5"]
handler_dead_call (الحاجز الكامل: if (false) { picked!(); } بعد نزع case)
                       → EXIT=0
```

نداءٌ تحت `if (false)` — وهو الشرط الذي تَعِد الدعوى 2 بإبطاله — يُخضِر `[RC-03]` على خريطة. تشديد الثلاثة لم يُمرِّر النداءَ على حكم الوصول نفسِه.

### 5) `[RC-12]` يشترط قارئًا قابلًا للوصول

**مرفوضة.** العيب: `RC12_COMPOUND_FALSY_READER_ACCEPTED` (رتبة **حاجز** — نفس ثغرة `constantFalsy`/`guardsOf.unsatisfiable`).

`if (false) droppedByKind()` يسقط كما وُعد: الحاجز `EXIT=1` `[RC-12]` (تطفير r3 الرسمي + مسبار المسوّدة).

و`guardsOf` لا يجعل `unsatisfiable` إلّا على حرفيّات `constantFalse` المحلّيّة (`scripts/check_rehydrate_census.ts:229-242` · `:335`). لا `&&` ولا `for-of` فارغ. قيس على الحاجز الكامل بعد نزع القارئ الحقيقي:

| التطفير | النتيجة |
|---|---|
| `if (false) deps.durable.droppedByKind();` | `EXIT=1` `[RC-12]` |
| `if (false && true) deps.durable.droppedByKind();` | **`EXIT=0`** |
| `(0 && deps.durable.droppedByKind()) …` | **`EXIT=0`** |
| `for (const _ of []) deps.durable.droppedByKind();` | **`EXIT=0`** |

الدعوى «لا يُقبل تحت شرطٍ ثابتِ الكذب» كاذبة ما إن يُركَّب الشرط. القارئ الميّت يُخضِر `[RC-12]`.

### 6) الصيغ الإحدى عشرة + السابقة + الحميدة

**مقبولة في العدِّ المقيس للكتلة الرسمية، ومرفوضة بوصفها كفايةً للحاجز.**

شُغِّلت الملفّات الرسمية في المسوّدة بعد `npx tsc`:

```
# tests 5
# pass 5
# fail 0
```

- 11 شكلًا في `rehydrate_census_mutations_r3.test.ts` (9×`RC-03` + `RC-07` + `RC-12`) تسقط برموزها — `ok 4`.
- 22 تطفيرًا في `rehydrate_census_mutations.test.ts` (لا 23: عنوان الاختبار والسطر `:45` وقبول الصفّ يقولون **22**؛ و`remedy-3.md:95` يقول 22+11=33). تسقط برموزها — `ok 2`.
- 3 تعليقات حميدة — `ok 3`.
- خريطة معالجين صحيحة — `ok 5`.
- الجذر السليم `EXIT=0` و21 مستهلكًا — `ok 1`.

فلا سلبٌ كاذبٌ **جديد على تلك الكتلة**. و«23 السابقة» في متن الطلب لا تطابق الشجرة (22). والأهم: الكتلة **أضيق من العلل الحيّة** التي قيست أعلاه (`if (false && true)` · `false && (x += 1)` · `if (false) picked()` · قارئ `[RC-12]` المركّب · `switch (0) { case 1: assert… }`). هذا إعادةٌ لـ`MUTATION_SUITE_NARROWER_THAN_DEFECTS` (رتبة **كبير**): حاجزٌ حالاتُه أضيقُ من عِلله يبقى أخضر على عيبٍ حيّ.

### 7) حدٌّ مُعلَن مقيس: `state.levySequence += 0`

**مقبولة.** الدعوى أنّ الإعلان صادقٌ مقيسٌ لا تسكيت — وهذا في **هذا** الحدِّ بعينه صادق.

- الحاجز الساكن على التطفير: `plus_zero → EXIT=0` (مسبار المسوّدة).
- اختبار الرحلة على التطفير نفسه بعد إبدال بند `tax_levy` بـ`state.levySequence += 0; return;` وإعادة `tsc`:

```
# tests 3
# pass 1
# fail 2
```

سقط «نزع قيود صنفٍ يغيّر التقرير» و«الإقلاع الثاني يُعيد الحالة» (`strict.ok((second.rehydratedFiscal?.levies ?? 0) >= 1)` → `actual: false`). يطابق القياس المحفوظ في `…-review-round-3-measurements.txt:67-73`.

**ولا يُمدَّد هذا الحدُّ إلى `if (false && true)`:** ذاك شرطٌ ثابتُ الكذب تَعِد الشجرة بإبطاله، لا فرقًا دلاليًّا بين `+= 1` و`+= 0`. الوجه السلوكيُّ لا يُبرّر وعدًا ساكنًا كاذبًا.

### 8) الشجرة الحيّة لم يُرفض منها صحيح

**مقبولة في حدود الشجرة الحيّة.**

```
node dist/scripts/check_rehydrate_census.js  → EXIT=0
✓ حصرُ الإرجاع: 23 صنفًا … · 21 بمستهلكٍ له موضعُ توزيعٍ في شجرةِ نحوِه · 2 بإعفاءٍ قائمِ الموجب
```

العدد 21 لم ينقص بعد التشديد. الحالة الحميدة للخريطة تُخضِر. **حدٌّ يُذكر ولا يُرفع هنا حاجزًا على الشجرة الحيّة:** `void` ليس غلافًا في `effectfulExpression` (`unwrap` لا يقشر `VoidExpression` — `scripts/rehydrate_proof.ts:50-54`)، فـ`void (state.levySequence += 1)` و`void foo()` كلاهما `effectful=false` والحاجز `void_restore → EXIT=1 [RC-03]`. سلبٌ كاذب على أسلوب `void this.restore…()` كان مرفوعًا في الجولة الثالثة وما زال. الشجرة الحيّة لا تستعمله اليوم فلم تُرفض منها صحيحة — والعيب ينتظر أول `void`.

### 9) تصحيحات الضبط

**مقبولة جزئيًّا.**

- حال العقد: `docs/work/orders/W-2026-040.md:4` يقول `REVIEW` ويعلن التصحيح العلني لـ`ORDER_STATUS_STILL_STALE`. الصفّ `WORK_QUEUE.json` → `"status": "REVIEW"`. تطابقا.
- معيار القبول رُفع تجميد عدده: «والعددُ يكبر بكلِّ جولةٍ ولا يُجمَّد في هذا السطر: 22 … و11 …». والأسطر التاريخية في `verification` أُرِّخت (`[الجولةُ الأولى · سجلٌّ تاريخي…]` · أربع تطفيرات).
- **بقي** `scripts/check_rehydrate_census.sh` في `scope` والملف **غير موجود** في الحزمة (`sh exists False`). تجميد العدد لا يمسح مسارًا محذوفًا من النطاق. رتبة **صغير** — `WORK_QUEUE_STALE_SH_REMAINS`. لا يغيّر سلوك الإرجاع.

### 10) البوابات

**دليلٌ غير كافٍ على الدعوى كاملة، ومرفوضة في حرف `verify=0` من القياس المحفوظ.**

ما قيس في المسوّدة:

- `check:rehydrate-census` على الشجرة الحيّة: `EXIT=0`.
- `scripts/check_module_size.sh`: `✓ لا وحدة تتجاوز سقفها — الاستثناءات المعلنة: 0` و`exceptions: []` في `scripts/limits/module_limits.yaml:57`.
- اختبارات التطفير الرسمية: 5/5.
- لا `.git` في الحزمة المنسوخة، فلا `check:work` ولا `npm run verify` كاملان هنا.

ما في الحزمة نفسِها يناقض التقرير: `phase-39-W-2026-040-review-round-3-measurements.txt:88-90` يكتب `npm run verify: EXIT=1` و`حواجزُ خضراء: 9`، بينما `phase-39-W-2026-040-remedy-3.md:92` يدّعي `EXIT=0 · 15 حاجزًا أخضر`. و`npm test 2285/2285` محفوظ هناك ولم أُعد تشغيل المئتين والألفين في المسوّدة بعد ثبوت عيب الحاجز. فلا أُصدِّق `verify=0` من التقرير مع قياس خامّ يقول `EXIT=1`.

---

## حدودٌ مُعلَنة دَينًا — هل إعلانُها صادق؟

| الدين | الحكم |
|---|---|
| `PROBE_BEFORE_IS_SIMULATION` — `scripts/rehydrate_census_probe.ts:80` يُحاكي «قبل» بجدول دعاوى بلا `tax_levy` | **صادق.** السطر 79 يقول «يُحاكى». لا يُدَّعى قياسٌ على `6bc0973`. |
| دفتر الإسقاط خارج سلسلة البصم — `src/data/journal_drops.ts:29-33` | **صادق.** «دَينٌ مُعلَنٌ لا مقفول». |
| الإشراف المتّصل مبنيٌّ غير مُشغَّل — `src/composition/operations.ts:73-74` | **صادق.** «تُبنى ولا تبدأ هنا». |
| `T-136` متقلقل تحت التوازي | **دليل غير كاف.** لا جريان موازٍ فاشل في هذه الحزمة (كما في الجولة الثالثة). لا أُصدِّق التقلقل ولا نفيه من هذه المادّة. |

لا تُدَّعى هذه مغلقة — والإعلان فيها أصدق من وعد الأثر.

## ما ليس داخل هذا البند (يُسمَّى ولا يُرفض به)

لا يُغلق C-08 ولا C-21 ولا C-18 ولا T-115ب. الفجوات 7 والإكمال 97.00% — حدٌّ معلن في الصفّ والعقد والتقرير. لم يُوسَّع نطاق التدوين ولم يُنشَأ مستهلك جديد.

**الإعفاء «لا مُنتِجَ له» يسقط آليًّا إن ظهر منتج:** حقٌّ مقيس لا وصف — `scripts/check_rehydrate_census.ts:169-174` (`[RC-04]`)؛ والتطفير الرسمي في `rehydrate_census_mutations.test.ts:85-94` يضيف `j.record('archive_snapshot', {})` فيسقط. ضمن 22 التي مرّت في `ok 2`.

---

## عيوبٌ مسمّاة بالشاهد

### `EFFECT_CROSSES_COMPOUND_CONSTANT_FALSY` · **حاجز**

- **الموضع:** `scripts/rehydrate_effect.ts:68-79` (`constantFalsy` حرفيٌّ) · `:139-146` (`&&`/`||` يمرّران الأثر) · `:180-185` (`IfStatement` يعتمد `constantFalsy`) · ويُستهلك في `scripts/rehydrate_dispatch.ts:101` و`scripts/check_rehydrate_census.ts:153-159`.
- **الوعد المكذَّب:** `scripts/check_rehydrate_census.ts:372-374` «وشرطٌ ثابتُ الكذبِ يُبطِل ما تحتَه».
- **الأثر:** حذف إرجاع صنف دائم وإبقاء `case 'tax_levy': { if (false && true) { state.levySequence += 1; } break; }` — أو `false && (state.levySequence += 1)` — يُخضِر `[RC-03]` والبوابة الساكنة، والقيد يُدوَّن ويُسقَط صمتًا. وهي علّة البند في لباس رابع: عولج `if (false)` فنجا `if (false && true)`.
- **القياس:** انظر الجدول في الدعوى 2؛ الحاجز الكامل `if_false_and_true → {"code":0,"codes":[]}` بينما `if_false_body → {"code":1,"codes":["[RC-03]"]}`.

### `RC12_COMPOUND_FALSY_READER_ACCEPTED` · **حاجز**

- **الموضع:** `scripts/check_rehydrate_census.ts:229-242,333-335`.
- **الأثر:** نزع القارئ الحيّ وإبقاء `if (false && true) deps.durable.droppedByKind()` يُخضِر `[RC-12]`.
- **القياس:** `rc12_if_false → EXIT=1 [RC-12]` · `rc12_if_false_and_true → EXIT=0` · `rc12_and_shortcircuit → EXIT=0` · `rc12_for_of_empty → EXIT=0`.

### `RC07_SWITCH_GUARD_NOT_MODELED` · **حاجز**

- **الموضع:** `scripts/check_rehydrate_census.ts:252-278` — يُجمع `if`/`?:`/`while`/`for`/`do`/`for-of` ولا `switch`.
- **الأثر:** `if (journal) { switch (0) { case 1: assertRehydrateCensus(…); break; default: break; } }` يُبقي نصوص الحراس `{journal}` ⊆ شروط أول إرجاع، والنداء لا يُنفَّذ. الحاجز يطبع «سيادةُ نداءِ الحاجزِ مقيسةٌ».
- **القياس:** `rc07_switch_dead → EXIT=0`. (و`rc07_if_false_and_true → EXIT=1 [RC-07]` بعلّة التضييق النصّي لا بعلّة ثابت الكذب.)

### `HANDLER_MAP_DEAD_CALL_ACCEPTED` · **كبير**

- **الموضع:** `scripts/rehydrate_dispatch.ts:253-268,283-285`.
- **القياس:** `handler_dead_call → EXIT=0`.

### `MUTATION_SUITE_NARROWER_THAN_DEFECTS` · **كبير**

- **الموضع:** `tests/data/rehydrate_census_mutations_r3.test.ts:37-116` — إحدى عشرة صيغةً كلُّها حرفيّة (`while (false)` · `if (false)` · …) ولا مركَّب.
- **الأثر:** الاختبارات 5/5 خضر والحاجز يقبل `if (false && true)`.

### `VOID_ENVELOPE_HIDES_EFFECT` · **كبير** (سلبٌ كاذب، لا تخضير)

- **الموضع:** `scripts/rehydrate_effect.ts:135-137` أغلفة `await`/`yield` فقط · `scripts/rehydrate_proof.ts:50-54`.
- **القياس:** `void (state.levySequence += 1); → effectful=false` · الحاجز `EXIT=1 [RC-03]`.

### `WORK_QUEUE_STALE_SH_REMAINS` · **صغير**

- **الموضع:** `docs/work/WORK_QUEUE.json` نطاق `W-2026-040` ما زال يحوي `scripts/check_rehydrate_census.sh` والملف غائب.

---

## ما جُرِّب في المسوّدة ونتائجُه الخامّ

نُسخت الحزمة إلى `/tmp/w040r4/reviewer-beta/scratch/`، و`npm ci` (3 حزم)، و`npx tsc -p tsconfig.json` بلا خطأ. شُغِّل `_probe_r4.mjs` يستورد `dist/scripts/rehydrate_effect.js` و`rehydrate_dispatch.js` ويُشغّل الحاجز بـ`SOOL_CHECK_ROOT` على جذور `tmpdir`.

**أ) ثوابت المترجم (خام):**

```
FirstAssignment 64
LastAssignment 79
EqualsToken 64
EqualsEqualsToken 35
EqualsEqualsEqualsToken 37
PlusEqualsToken 65
AmpersandAmpersandEqualsToken 77
QuestionQuestionEqualsToken 78
CaretEqualsToken 79
```

**ب) `effectful` على عبارات مصنوعة (مختارات خام):**

```
if (false) { state.x += 1; }                 false
if (false && true) { state.x += 1; }         true
if (false || false) { state.x += 1; }        true
if (true && false) { state.x += 1; }         true
while (false && true) { state.x += 1; }      true
false && (state.x += 1);                     true
true || (state.x += 1);                      true
false ? (state.x += 1) : 0;                  false
void (state.x += 1);                         false
(() => {})();                                true
function g() { state.x += 1; }               false
do { state.x += 1; } while (false);          true
for (const x of []) { state.x += 1; }        true
switch (0) { case 1: state.x += 1; … }       true
```

**ج) `constantFalsy` (خام):**

```
false          {"falsy":true,"truthy":false}
false && true  {"falsy":false,"truthy":false}
false || false {"falsy":false,"truthy":false}
true && false  {"falsy":false,"truthy":false}
0 && 1         {"falsy":false,"truthy":false}
false as const {"falsy":true,"truthy":false}
0n             {"falsy":false,"truthy":false}
```

**د) الحاجز الكامل `SOOL_CHECK_ROOT` (خام، `code`/`codes`):**

```
live                  {"code":0,"codes":[]}
if_false_body         {"code":1,"codes":["[RC-03]"]}
if_false_and_true     {"code":0,"codes":[]}
if_false_or_false     {"code":0,"codes":[]}
if_true_and_false     {"code":0,"codes":[]}
and_assign            {"code":0,"codes":[]}
or_assign             {"code":0,"codes":[]}
plus_zero             {"code":0,"codes":[]}
empty_iife            {"code":0,"codes":[]}
void_restore          {"code":1,"codes":["[RC-03]"]}
switch_dead           {"code":0,"codes":[]}
for_of_empty          {"code":0,"codes":[]}
handler_dead_call     {"code":0,"codes":[]}
rc07_switch_dead      {"code":0,"codes":[]}
rc07_if_false_and_true {"code":1,"codes":["[RC-07]"]}
rc12_if_false         {"code":1,"codes":["[RC-12]"]}
rc12_if_false_and_true {"code":0,"codes":[]}
rc12_and_shortcircuit {"code":0,"codes":[]}
rc12_for_of_empty     {"code":0,"codes":[]}
```

عند `code=0` يطبع الحاجز حدَّه («شرطٌ ثابتُ الكذبِ يُبطِل ما تحتَه») على التطفير الناجي.

**هـ) الاختبارات الرسمية للتطفير:** `# tests 5 # pass 5 # fail 0` (مدة ≈65s).

**و) الرحلة الكاملة على `+= 0`:** `# tests 3 # pass 1 # fail 2`.

**ز) الشجرة الحيّة:** `check_rehydrate_census` → 23/21/2 و`EXIT=0`. `check_module_size` → استثناءات 0.

**ح) `(() => {})()` نداءٌ في قائمة الإثبات فيُقبل ساكنًا — داخل الحدّ المعلن أنّ النداء أثرٌ بنيويٌّ لا إرجاع؛ الوجه السلوكي يُفترض أن يكشفه كـ`+= 0`. لا أرفعه عيبًا مستقلًّا فوق المركّب.**

---

## الحكم الأخير

ثلاث جولات والعيب واحد يُبدّل ثوبه. في الرابعة عولج `if (false)` و`while (false)` حرفيًّا، وبقي **المركّب ثابت الكذب** (`false && true` · `false && (x += 1)` · `switch (0) { case 1: … }`) يُخضِر `[RC-03]` و`[RC-12]` و`[RC-07]` حيث يطبع الحاجز أنّ شرطًا ثابتَ الكذب يُبطل ما تحته وأنّ السيادة مقيسة وأنّ القارئ حيّ. قائمة الإثبات صدقت في جهة التصنيف (أربعة ولا خامس، الافتراض الرفض، مدى الإسناد من المترجم) وكذبت في جهة **الوصول** — وهو ما جعله النصُّ المطبوع عقدًا لا تعليقًا.

حدُّ `+= 0` مُعلَن ومقيس وصادق في نفسه. والشجرة الحيّة خضراء. والإعفاء يسقط بظهور منتج. والديون الأربعة في §6 من `remedy-3.md` معلنة بصدق (مع `INSUFFICIENT_EVIDENCE` لتقلقل T-136). **لا شيء من ذلك يرفع عيبًا حاجزًا مقيسًا يُخضِر البوابة على حذف الإرجاع.**

الحكمُ على أعلى رتبة: **حاجز** · `EFFECT_CROSSES_COMPOUND_CONSTANT_FALSY`.

الحكم: REJECTED_WITH_NAMED_DEFECT
