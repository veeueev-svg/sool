<!--
الخرجُ الخامُّ للمراجع (أ) — GPT-5.6 Sol (OpenAI)، مُعلَنًا لا مُثبَتًا (RULE-019)
هذا الملفُّ **خرجٌ خامٌّ محفوظٌ حرفًا بحرفٍ كما ورد من المراجع** (WORK_CONTROL.md §12:
التلخيصُ لا يُقوم مقامَ الخرجِ الخام). لا يُحرَّر ولا يُصحَّح ولا يُشكَّل، وما فيه من
حكمٍ حكمُ المراجعِ لا حكمُ المنفّذ — والمنفّذُ لا يراجع عملَه (RULE-004).

المراجَع: W-2026-040 · الجولةُ الثالثة · 2026-09-11
حزمةُ الأدلّة: 63 ملفًّا · بصمةُ البيان الجامعة:
  sha256(MANIFEST.sha256) = 8b522c15fcce37b33ef7e184fb67ae31b8dd819df4fb98fc2c89bc3f19adea89
طابق المراجعُ البيانَ بـ`sha256sum -c`: 63/63 · نسختُه للقراءةِ فقط: /tmp/w040r3/reviewer-alpha/evidence/
مُتنُ الطلب: /tmp/w040r3/REVIEW-PROMPT.md (101 سطرًا)
  sha256 = f222149fa47796879639fb1c629064a699a9b84b1af18afbf25a403df4ca2943
الحكم: REJECTED_WITH_NAMED_DEFECT
-->

## هُويّتي (إعلانٌ لا إثبات)

أنا نموذج **ChatGPT من OpenAI**. لا يُكشَف لي في هذه الجلسة اسمُ إصدارٍ أدقُّ يمكنني توثيقُه؛ فهذا تعريفٌ ذاتيٌّ بما أعرفه عن نفسي، وهو **إعلانٌ لا إثبات** لهويّة النموذج أو استقلاله التنظيمي.

## تحقّقُ الحزمة

نفّذتُ أولًا الأمرين المطلوبين حرفيًّا داخل `EVIDENCE_ROOT`. وكانت النتيجة الحرفيّة:

```text
./tests/governance/closed_enums_gate.test.ts: OK
./tests/governance/generated_numbers.test.ts: OK
./version.json: OK
8b522c15fcce37b33ef7e184fb67ae31b8dd819df4fb98fc2c89bc3f19adea89  MANIFEST.sha256
```

البصمة الجامعة مطابقةٌ للمتوقّع. وبيان `MANIFEST.sha256` يحوي 63 سطرًا لثلاثةٍ وستين ملفَّ حمولة؛ ومع ملف البيان نفسه يكون عدد الملفات المادي 64، فلا أعدُّ ذلك تعارضًا مع وصف الحزمة «63 ملفًّا».

راجعتُ الحزمة قراءةً فقط، ولم أستشر الشبكة أو مستودعًا آخر أو مراجعًا آخر. قرأتُ `scripts/rehydrate_dispatch.ts` و`scripts/check_rehydrate_census.ts` سطرًا سطرًا، وراجعتُ الاختبارات والمخارج المحفوظة ذات الصلة.

## حكمي على كلِّ دعوى من دعاوى §2 (تسعُ دعاوى، واحدةً واحدةً)

1. **اشتراط الأثر لا الوجود — مرفوض.** العلاج يرفض الأمثلة الخمسة المعلنة، لكن تعريف `effectful` يقبل أثرًا صوريًّا لا يعيد حالةً. النص الحاكم يقول: `if (ts.isExpressionStatement(stmt)) return !inertExpression(stmt.expression);` (`scripts/rehydrate_dispatch.ts:108`)، ثم إن `inertExpression` لا يعرف إلا حالاتٍ محدودة وينتهي بـ`return false;` (`scripts/rehydrate_dispatch.ts:71-85`). لذلك فإن استبدال فرع `tax_levy` بـ`case 'tax_levy': { state.levySequence += 0; return; }` يحذف الإرجاع الحقيقي كله، لكنه يُعدّ ذا أثر؛ ثم تقبل `caseReaches` البند لأنّها تقول `if (c.statements.some((s) => effectful(s))) return true;` (`scripts/rehydrate_dispatch.ts:136`). هذه هي **الصيغة الثالثة** المطلوبة: أثرٌ صوريٌّ يُخضّر `[RC-03]` بلا إرجاع حقيقي. ويزيدها باب خريطة المعالجات اتساعًا كما في العلل أدناه.

2. **قياس سيادة نداء الحاجز — مرفوض.** عولج شاهد `if (false)` بعينه، لكن `guardsOf` لا يجمع إلا حارسي `if` و`?:`: الشاهد هو `if (ts.isIfStatement(p)...)` ثم `if (ts.isConditionalExpression(p)...)` (`scripts/check_rehydrate_census.ts:252-260`)، وبعدهما يصعد مباشرةً بـ`cur = p` (`:262`). لذلك ينجو مثلًا `if (journal) { while (false) assertRehydrateCensus(...); }`: حارس الحلقة غير ممثّل، وتبقى مجموعة الشروط النصية مساويةً لشروط أول إرجاع، مع أن النداء لا ينفذ. الأثر هو إمكان الإرجاع من دون مرور بالحاجز مع خضرة `[RC-07]`.

3. **قارئ حيّ لـ`[RC-12]` — مرفوض جزئيًّا.** القارئ الحالي حقيقي: `for (const [kind, count] of deps.durable.droppedByKind())` (`src/production/production_scanners.ts:307`). لكن حرس الرجعة لا يثبت «حيًّا»؛ فهو يجعل `found = true` لأي `CallExpression` اسم خاصيته `droppedByKind` (`scripts/check_rehydrate_census.ts:311-312`) من دون فحص قابلية الوصول. حذف القارئ الحقيقي وإضافة `if (false) deps.durable.droppedByKind();` في ملف إنتاج يمرّر `[RC-12]`. أقبل وجود القارئ الحالي، ولا أقبل دعوى أن الآلية تشترط قارئًا حيًّا.

4. **إضافة `[RC-13]` واشتراط `journal_drop` — مقبولة.** القائمة الحية تضم `'journal_drop'` (`src/kernel/config/production_policy.ts:86-101`)، والحارس يقرأ `PRODUCTION_REQUIRED_SCANNERS` ويرفض عند غيابه (`scripts/check_rehydrate_census.ts:327-339`). كما أن الماسح مبني فعلًا في `probes.set('journal_drop', journalDropProbe(deps));` (`src/production/production_scanners.ts:336`).

5. **اختبار الرحلة يقيس الإرجاع لا طول اليومية — مقبولة في حدودها المعلنة.** الاختبار يستبعد `records` صراحةً: `const INPUT_SIZE_FIELDS ... = ['records'];` ثم يحذفه في مبدّل `JSON.stringify` (`tests/data/rehydrate_roundtrip.test.ts:264-276`). ويقارن لكل صنف التقرير الكامل بتقرير نزع قيوده (`:282-305`). القياس المحفوظ يسمّي `knowledge_fact` عند حذف إرجاعه (`docs/test-reports/phase-39-W-2026-040-review-round-2-measurements.txt:73-86`)، والجريان الحالي يمر بثلاثة اختبارات وصفر فشل (`RUN-roundtrip.txt:17-23`).

6. **دوام عدّاد الإسقاط عبر موت العملية — مقبولة في الحد المعلن.** `count` يزيد ثم ينادي `this.persist()` (`src/data/journal_drops.ts:70-74`)، و`persist` يكتب الخريطة إلى القرص (`:108-113`)، والمنشئ يعيد تحميلها (`:49-50`). والجريان المحفوظ يثبت أن العملية الثانية قرأت 2 بعد أن كانت تقرأ 0 قبل العلاج (`docs/test-reports/phase-39-W-2026-040-review-round-2-measurements.txt:88-98`). لا أوسّع هذا إلى سلامة ضد حذف الملف أو الكتابة المتزامنة؛ الوثيقة نفسها تصرّح بأن حذف الملف يعيد الصفر ولا تكشفه سلسلة البصمات (`src/data/journal_drops.ts:29-33`).

7. **قبول خريطة الموزعات الصحيحة — مقبولة من حيث إزالة السلب الكاذب، مع عيبٍ في حد القبول.** القياس المحفوظ يسجل `valid_object_map EXIT=0` بعد أن كان 1 (`docs/test-reports/phase-39-W-2026-040-review-round-2-measurements.txt:29,44`). لكن `handlerMapSites` يجعل `openedByKind` علمًا على مستوى الملف عند أي فتحٍ بأي كائن (`scripts/rehydrate_dispatch.ts:216-231`)، ثم يقبل أي `PropertyAssignment` مطابق في أي كائن إذا كان مهيئه معرّفًا أو وصول خاصية (`:232-243`)؛ فلا يربط جدول التعريف بجدول الفتح، ولا يشترط استدعاء المعالج. لذلك إزالة السلب الكاذب صحيحة، لكن الباب صار يقبل خريطةً خدّاعةً لا تُرجع شيئًا.

8. **تصحيح لغة النجاح والإحالات البائتة — مقبولة جزئيًّا ومرفوضة جزئيًّا.** لغة النجاح الآن تضبط الحد: «ولا يشهد أنّ ذلك الفرعَ يُنفَّذ ... ولا أنّه يُعيد الحالةَ صحيحةً» (`scripts/check_rehydrate_census.ts:346-349`)، وإحالة `src/data/rehydrate_census.ts:35` صارت إلى ملف `.ts`. لكن دعوى العلاج أن حال العقد صار `REVIEW` (`docs/test-reports/phase-39-W-2026-040-remedy-2.md:46`) تخالف العقد نفسه، الذي ما زال يقول: `**الحال:** BLOCKED — رُفض في الجولة الأولى` (`docs/work/orders/W-2026-040.md:4`)، بينما صف العمل يقول `"status": "REVIEW"` (`docs/work/WORK_QUEUE.W-2026-040.json:8`).

9. **اثنتان وعشرون حالة تطفير وحالة حميدة — مرفوضة بوصفها كفايةً للحاجز، مع قبول واقعة التشغيل.** الملف يعرّف اختبار «اثنين وعشرين تطفيرًا» (`tests/data/rehydrate_census_mutations.test.ts:45-46`) ويؤكد رمز الخروج والرمز المعيّن لكل حالة (`:221-227`)، و`RUN-mutations.txt:17-24` يثبت 3 اختبارات ناجحة وصفر فشل. لكن الحالات تنتهي عند `:220` ولا تتضمن الأثر الصوري `+= 0` ولا حارس الحلقة ولا خريطة المعالج الخادعة؛ والحالة الحميدة المودعة ليست خريطة موزعات، بل اختبار «ثلاث إضافات» من التعليقات (`tests/data/rehydrate_census_mutations.test.ts:239-263`). لذلك الجريان حقيقي، لكنه أضيق من العلل التي ما زالت تنجو.

## العللُ المُسمّاة (رمزٌ · رتبةٌ · ملفٌّ:سطرٌ · أثرٌ · شاهدٌ مُقتبَس)

### `EFFECTFUL_NOOP_GREENS_RC03` · `BLOCKING`

- **الموضع:** `scripts/rehydrate_dispatch.ts:71-85,97-114,127-140`؛ ويُستهلك الحكم في `scripts/check_rehydrate_census.ts:153-160`.
- **الأثر:** يمكن حذف إرجاع صنفٍ دائم، وإبقاء إسنادٍ لا يغيّر الحالة مثل `state.levySequence += 0`، فيظل `dispatchSites` غير فارغ وتخضر `[RC-03]`. هذا يعيد الفقد الصامت الذي أنشئ الحاجز لمنعه.
- **الشاهد المقتبس:** `if (ts.isExpressionStatement(stmt)) return !inertExpression(stmt.expression);` (`scripts/rehydrate_dispatch.ts:108`)؛ و`inertExpression` تنتهي بـ`return false;` لكل تعبير غير مصنف (`:85`)؛ ثم `if (c.statements.some((s) => effectful(s))) return true;` (`:136`). وفي المقابل لا يفعل المستدعي أكثر من `if (sites.length === 0) ... [RC-03]` (`scripts/check_rehydrate_census.ts:153-159`).

### `RC07_LOOP_GUARD_NOT_MODELED` · `BLOCKING`

- **الموضع:** `scripts/check_rehydrate_census.ts:224-264,277-294`.
- **الأثر:** يمكن جعل نداء الحاجز غير قابل للتنفيذ داخل `while (false)` مع إبقاء الشرط الخارجي الموافق للإرجاع؛ فيمر اختبار «السيادة» النصي وتعمل مسالك الإرجاع بلا حاجز.
- **الشاهد المقتبس:** جامع الحراس لا يحتوي إلا `if (ts.isIfStatement(p)...)` (`:252`) و`if (ts.isConditionalExpression(p)...)` (`:257`) ثم `cur = p;` (`:262`). والحكم النهائي لا يفحص إلا فرق النصوص: `const narrower = gCensus.texts.filter((t) => !gFirst.texts.includes(t));` (`:287`). لا يُسجَّل حارس `while` ولا يُحكم على ثبات شرطه.

### `RC12_CALL_IS_NOT_LIVE_READER` · `MAJOR`

- **الموضع:** `scripts/check_rehydrate_census.ts:304-325`.
- **الأثر:** يمكن نزع مسار القياس الحقيقي وإبقاء نداء غير قابل للوصول، فيبقى عداد الإسقاط دائمًا لكنه لا يصل إلى مراقب، مع خضرة `[RC-12]`.
- **الشاهد المقتبس:** `if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'droppedByKind') { found = true; return; }` (`scripts/check_rehydrate_census.ts:311-312`). لا يوجد في هذا الشرط فحص وصولٍ أو سيادة؛ لذلك `if (false) deps.durable.droppedByKind();` يفي به حرفيًّا.

### `HANDLER_MAP_DECOY_ACCEPTED` · `MAJOR`

- **الموضع:** `scripts/rehydrate_dispatch.ts:216-244`.
- **الأثر:** يمكن حذف فرع الإرجاع، ووضع كائنٍ فيه مفتاح الصنف قيمته معرّف `noop` مع فتحٍ منفصل بـ`something[record.kind]` من غير استدعاء؛ فيُسجَّل موضع `handler` وتخضر `[RC-03]` بلا إرجاع.
- **الشاهد المقتبس:** العلم العام للملف يُرفع عند `if (ts.isElementAccessExpression(n) && isKindBearing(n.argumentExpression)) { openedByKind = true; ... }` (`scripts/rehydrate_dispatch.ts:220-222`)، ثم يقبل حلقةٌ مستقلة `ts.isPropertyAssignment` إذا كان المفتاح مطابقًا وكانت القيمة `Identifier` أو `PropertyAccessExpression` (`:233-242`). لا مساواة بين كائن الفتح وكائن التعريف، ولا شرط أن تُستدعى القيمة.

### `ORDER_STATUS_STILL_STALE` · `MINOR`

- **الموضع:** `docs/work/orders/W-2026-040.md:4` مقابل `docs/work/WORK_QUEUE.W-2026-040.json:8`، مع دعوى العلاج في `docs/test-reports/phase-39-W-2026-040-remedy-2.md:46`.
- **الأثر:** مصدران حيّان لحال البند يعطيان `BLOCKED` و`REVIEW`، وتقرير العلاج يعلن إصلاحًا لم يقع؛ وهذا يربك الأتمتة والقارئ، لكنه لا يغيّر سلوك الإرجاع.
- **الشاهد المقتبس:** العقد يقول `**الحال:** BLOCKED — رُفض في الجولة الأولى`، وصف العمل يقول `"status": "REVIEW"`، وتقرير العلاج يقول `حالُ العقدِ BLOCKED ← REVIEW مطابقًا للصفّ`.

## دعاوى دليلُها غيرُ كافٍ

- **تقلّب `T-136`: `INSUFFICIENT_EVIDENCE`.** الملف المضموم يبيّن أن الاختبارات تعمل على جذور منسوخة (`tests/governance/closed_enums_gate.test.ts:21-24`)، و`RUN-T136-isolated.txt:1-12` يثبت 12/12 نجاحًا منفردًا، وخرج الحزمة الكامل يمر أيضًا؛ لا يوجد في الحزمة جريانٌ موازٍ فاشل يثبت وصف «متقلّب». أقبل أن الجريان المنفرد مستقر في العينة، ولا أصدّق دعوى التقلّب أو نفيها من هذه المادة.

أما النواقص الأربعة الأخرى التي سُمّيت سابقًا فقد كفت مادتها الآن في حدودها: `PRODUCERS.measured.txt:6-39` يتيح إعادة عد 16 ملفَّ إنتاج و21 صنفًا حرفيًّا؛ و`COMPLETION-RECOMPUTE-INPUTS.txt:5-64` يعطي أوزان المراحل ومجموع 1–38 = 97.00%، و`:67-75` يعطي سبع فجوات وحالتي اكتفاء؛ ومسار `journal_records_dropped` ظاهر من إنشاء finding (`src/production/production_scanners.ts:302-315`) إلى استدعاء الماسحات ورفع الحوادث وتقييدها (`src/production/continuous_supervisor.ts:223-247,325-335`) وبدء المشرف عند فتح التشغيل (`src/production/federated_operation.ts:118-123`)؛ وتشغيل التطفيرات مثبت في `RUN-mutations.txt:17-24`.

## ملاحظاتٌ لا تمنع القبول

- `OBSERVATION — MANIFEST_COUNT_CONVENTION`: الوصف «63 ملفًا» يطابق 63 مدخلًا في البيان؛ ملف البيان نفسه يجعل العدد المادي 64. لا أثر على سلامة البصمات.
- `OBSERVATION — DROP_LEDGER_BOUND`: دوام العدّاد المقاس هو دوام بعد موت عمليةٍ نظيف؛ الوحدة تصرح أن الملف خارج سلسلة البصمات وأن حذفه يعيد الصفر (`src/data/journal_drops.ts:29-33`). لا أرفع هذا عيبًا جديدًا لأن الحد معلن صراحةً.
- `OBSERVATION — CURRENT_TREE_BEHAVIOR`: مواضع الإرجاع الحالية واختبار الرحلة الكامل تمر، لكن الحكم هنا على الحاجز بوصفه مانع رجعة أيضًا؛ وجود الشفرة الصحيحة اليوم لا يعالج قبول الحاجز لتطفيرٍ يعيد العلة غدًا.

REJECTED_WITH_NAMED_DEFECT
