<!--
الخرجُ الخامُّ للمراجع (ب) — Grok 4.6 (xAI)، مُعلَنًا لا مُثبَتًا (RULE-019)
هذا الملفُّ **خرجٌ خامٌّ محفوظٌ حرفًا بحرفٍ كما ورد من المراجع** (WORK_CONTROL.md §12:
التلخيصُ لا يُقوم مقامَ الخرجِ الخام). لا يُحرَّر ولا يُصحَّح ولا يُشكَّل، وما فيه من
حكمٍ حكمُ المراجعِ لا حكمُ المنفّذ — والمنفّذُ لا يراجع عملَه (RULE-004).

المراجَع: W-2026-040 · الجولةُ الثانية · 2026-09-11
حزمةُ الأدلّة: 56 ملفًّا · بصمةُ البيان الجامعة:
  sha256(MANIFEST.sha256) = 86a8daa0193f6e88a66c3a27ef22f3a306a721c2909822dedf1a44be44d77f04
مُتنُ الطلب: /tmp/w040v2/REVIEW-PROMPT.md (124 سطرًا)
  sha256 = 7cc70e46abdfd9dc24c440942076edfc31cd1ff5c64efaa38648e3191e617854
-->

هذا التقرير كُتب من الحزمة المجمّدة في `/tmp/w040v2/reviewer-beta/evidence` وحدها. لم أقرأ ولم ألمس `/home/user/workspace/sool` ولا أي مسار خارج جذر `/tmp/w040v2/reviewer-beta`. لم أشغّل `git` ولم أستخدم شبكة ولا بحثًا ولا أدوات ذاكرة. لم أفترض وجود مراجع آخر في هذه الجولة ولم أراسل أحدًا.

## 2) الهويّة

- **المهمة المعلنة في التكليف:** مراجع ب (xAI) — جولة ثانية على `W-2026-040`.
- **النموذج الذي كتب هذا الخرج:** وكيل Perplexity Computer.
- **المزوّد المعيَّن لهذه الجولة في التكليف:** xAI.
- **الإصدار:** غير معروض لهذه الجلسة. لا أختلق رقم إصدار.
- هذا إقرارٌ ذاتيّ بالمعنى الذي يقيّده `docs/work/WORK_CONTROL.md` §12-3: هويةٌ **معلنة** لا **مثبتة** بمنشأ مقاوم للتلاعب. لا أشهد باستقلال تنظيمي. هذا الخرج **مدخل** لقرار الإغلاق لا سلطته. لا أقول إن البند أُغلق.

## 3) تحقّق الحزمة

من جذر الحزمة:

```
cd /tmp/w040v2/reviewer-beta/evidence
sha256sum -c MANIFEST.sha256
```

- **مطابق:** 56 ملفًا.
- **مخفق:** 0.
- **رمز الخروج:** 0.
- الحزمة تطابق بيانها، فيُحكم عليها.

`BUNDLE-HASH.txt` يعلن:

- `sha256(MANIFEST.sha256) = 86a8daa0193f6e88a66c3a27ef22f3a306a721c2909822dedf1a44be44d77f04`
- `files=56`
- `freeze=2026-09-11T03:29:51Z`
- `measured repo commit 96abd1b256724188cc22c9132c128e3217601813` — رقم الالتزام **معلن** في الملف؛ لم أشغّل `git` للتحقّق منه.

## 4) ما شغّلتُه بنفسي

لم أشغّل `npm test` ولا `npm run verify` على شجرة عمل خارج الحزمة (العزل يمنع ذلك). ما شُغّل داخل الجذر:

1. `sha256sum -c MANIFEST.sha256` — النتيجة أعلاه.
2. **تجربة التفاف على البرهان النحوي:**
   - نُسخ `evidence/scripts/rehydrate_proof.ts` إلى `/tmp/w040v2/reviewer-beta/scratch/rehydrate_proof.ts`.
   - كُتب `/tmp/w040v2/reviewer-beta/scratch/bypass_dispatch.mjs` يعيد استخدام الدوال المصدرّة `dispatchSites` / `caseReaches` / `comparisonReaches` / `nonEmptyBranch` كما هي.
   - التشغيل: `cd /tmp/w040v2/reviewer-beta/scratch && NODE_PATH=/usr/local/lib/node_modules/vercel/node_modules node bypass_dispatch.mjs`
   - TypeScript المستعمل: `typescript@5.9.3` المضمَّن في حزمة vercel (لا وحدة `typescript` محليّة في جذر المراجع).
   - الخرج محفوظ في `/tmp/w040v2/reviewer-beta/scratch/bypass_dispatch_results.json`.
3. عدّ مستقل من ملفات الحزمة لـ 23 / 21 / 2 / 10 تطفيرات / 3 تعليقات / 15 حاجزًا / 2281 / 111 حقلًا / مطابقة نصوص الفجوات.

نتائج تجربة التفاف `tax_levy` (مختصر الشاهد؛ التفاصيل في العيوب):

| الحالة | قبلها الحاجز؟ |
|---|---|
| تعليق فقط يذكر الاسم | لا |
| `console.log('tax_levy')` بلا مقارنة | لا |
| `case 'tax_levy': break;` | **نعم** |
| `case 'tax_levy': { /* todo */ }` | **نعم** |
| `case 'tax_levy': return;` | **نعم** |
| `case 'tax_levy': void 0; break;` | **نعم** |
| `case 'tax_levy': console.log('tax_levy'); break;` | **نعم** |
| `console.log(rec.kind === 'tax_levy')` | **نعم** |
| `const unused = rec.kind === 'tax_levy'` | **نعم** |
| `console.log('ignored' === 'tax_levy')` | **نعم** |
| `() => rec.kind === 'tax_levy'` | **نعم** |
| `{ [kind]: handler }` / `Record` lookup | لا (يرفض توزيعًا صحيحًا) |
| `recs.filter(r => r.kind === 'tax_levy')` | نعم (مقارنة في سهم) |
| `case` / `if` حقيقيّان يستعيدان | نعم (إيجاب صحيح) |

## 5) العيوب

الجواب على سؤال الجولة: العلاج **لا يغلق** عيب الجولة الأولى «برهان المستهلك تطابق سلسلة». ينقله من المعجمي إلى النحوي: الحاجز يخضر على فرع صوري وعلى مقارنة داخل سطر سجل، حتى مقارنة حرفين لا علاقة لهما بـ `rec.kind`. اختبار الرحلة لا يسدّ الثغرة للمسلك الأساسي لأن تقريره يعدّ طول اليوميّة لا أثر الاستعادة.

| الرمز | الخطورة | الملف والسطر | الجوهر | الشاهد |
|---|---|---|---|---|
| `DISPATCH_SITE_ACCEPTS_VACUOUS_BRANCH` | **BLOCKING** | `scripts/rehydrate_proof.ts:58-69` (`caseReaches`)؛ التعليق الكاذب في `:88-90` | «موضع التوزيع» لأي `case` ذي `statements.length > 0`. `break` وكتلة فارغة و`return` و`void 0` وسطر سجل كلها عبارات. `nonEmptyBranch` موجودة ولا تُستعمل لبنود `case`. | تجربة scratch: `case_break` و`case_empty_block_comment` و`case_return_void` و`case_void0` و`case_log_only` كلها `accepted: true`. |
| `DISPATCH_SITE_ACCEPTS_LOG_LINE_COMPARISON` | **BLOCKING** | `scripts/rehydrate_proof.ts:72-86` (`comparisonReaches`) ولا سيما `:81-82` | أي `=== 'kind'` داخل `CallExpression` أو `VariableDeclaration` أو سهم أو `return` تُعدّ موضع توزيع. لا يُشترط أن يكون الطرف الآخر `rec.kind`. سطر السجل الذي رفضته الجولة الأولى عاد في لباس نحوي. | `compare_unrelated_literals`: الملف `console.log('ignored' === 'tax_levy')` → `accepted: true`, `form: 'compare'`. كذلك `compare_in_console_log` و`compare_unused_const`. |
| `ROUNDTRIP_CORE_COUNTS_JOURNAL_LENGTH_NOT_RESTORE` | **BLOCKING** | `src/data/persistence.ts:358-366` (`records: entries.length`) مع `tests/data/rehydrate_roundtrip.test.ts:255-281` | اختبار «نزع الصنف يغيّر التقرير» للمسلك `core` يقارن `JSON.stringify` لتقرير يتضمّن **طول اليوميّة**. نزع أي قيد يغيّر `records` ولو كان معالج الصنف ميتًا (`memoryRecords` يبقى 0 في الحالين). المقياس يتبدّل بغير ما يدّعي قياسه. | شاهد منطقي من الشفرة: `{records:N, memoryRecords:0}` ≠ `{records:N-k, memoryRecords:0}`. الأصناف الأربعة في `persistence.ts` (`audit_entry`…`knowledge_fact`) تسلك هذا التقرير. مع الثغرة النحوية: `if (entry.kind === 'memory_record') { void 0; }` يخضر الحاجز **و** الاختبار. |
| `RC12_IS_PROPERTY_ACCESS_NOT_LIVE_READER` | **MAJOR** | `scripts/check_rehydrate_census.ts:227-243` | `[RC-12]` يخضر إن وُجد `droppedByKind` أو `droppedOutOfScope` خاصيّة وصول في أي ملف تحت `src/**` عدا `persistence.ts`. وصول وهمي يكفي. لا يُشترط أن يكون `journal_drop` في التهيئة ولا أن تُستدعى المسحة. | الشرط في `:233-234` يضع `found = true` على `PropertyAccessExpression` بالاسم فقط. |
| `JOURNAL_DROP_PROBE_NEVER_TICKS_ON_BOOTSTRAP` | **MAJOR** | `src/composition/operations.ts:73-74` و`:96-104`؛ `src/kernel/config/production_policy.ts:86-95` و`:109-117` | قارئ إنتاج **يُبنى**. المراقبة المستمرة **لا تبدأ** عند التركيب. `journal_drop` ليس في `PRODUCTION_REQUIRED_SCANNERS` فيُحذف من التهيئة دون سقوط الإقلاع على ذلك الحرس. `journal_records_dropped` جسيم لا حرج فلا يوقف التشغيل. خيط «يصل أحدًا» ينقطع هنا في الحزمة. | تعليق `:73`: «المراقبة المستمرة تُبنى ولا تبدأ هنا». القائمة المطلوبة `:86-95` بلا `journal_drop`. `MUST_BE_CRITICAL` بلا `journal_records_dropped`. `config/production.yaml:94-104` يصنّفه تحت `high`. |
| `GATE_SUCCESS_TEXT_EXCEEDS_EVIDENCE` | **MAJOR** | `scripts/check_rehydrate_census.ts:248` | النجاح يطبع «يشهد بوجودِ فرعِ توزيعٍ **يعمل**». الدليل هو عبارة غير فارغة أو مقارنة في استدعاء. «يعمل» أكبر من الدليل بمعيار §12 («مُثبَت» لا يُقال إلا لما تقيمه آلية تحقّق مسمّاة تقيس العمل لا الوجود). | النص حرفًا في `:248`. يناقض تعليق `rehydrate_proof.ts:88-90` الذي يقول إن سطر السجل والبند الفارغ ليسا برهانًا — والكود يقبلهما. |
| `WORK_QUEUE_VERIFICATION_STILL_SUBSTRING_CLAIM` | **MAJOR** | `docs/work/WORK_QUEUE.json:271` | حقل `verification` الحيّ ما زال يقول: «21 بمستهلكٍ **يُبرهَنُ اسمُ الصنفِ في شفرتِه**». هذه لغة عيب الجولة الأولى (تطابق الاسم) لا لغة «موضع توزيع». | المقتطف في `:271`. قارن المعالجة التي تزعم في `:270` أن العيب عولج. |
| `DISPATCH_GATE_REJECTS_OBJECT_MAP` | **MAJOR** | `scripts/rehydrate_proof.ts:92-110` | خريطة `{ [kind]: handler }` و`Record` lookup — توزيع صحيح — تُرفض. حاجز يرفض الصحيح يدفع إلى `case` ثم يُفرَّغ الجسم فيُقبل. | تجربة: `object_map_handler` و`record_lookup` → `accepted: false`. المستهلكون الحاليون `switch`/`if` فلا شاهد على كسر إنتاج قائم؛ الشاهد على خاصيّة الحاجز قائم. |
| `STALE_CHECK_SCRIPT_SH_REFERENCE` | **MINOR** | `src/data/rehydrate_census.ts:35` | الثابت (5) ما زال يحيل إلى `scripts/check_rehydrate_census.sh` المحذوف. | السطر `:35`. الحاجز الحيّ هو `.ts`. |
| `ORDER_STATUS_STALE_VS_QUEUE` | **MINOR** | `docs/work/orders/W-2026-040.md:4` مقابل `docs/work/WORK_QUEUE.json:278` | العقد يعلن `BLOCKED` (رفض الجولة الأولى). الصف يعلن `REVIEW` بعد المعالجة. تناقض توثيقي لا يكذب حدّ البند. | العنوان `:4` «الحال: BLOCKED». الصف `:278` «حالُ البند REVIEW». |
| `STALE_2278_IN_LIVE_VERIFICATION` | **MINOR** | `docs/work/WORK_QUEUE.json:274` و`docs/test-reports/phase-39-W-2026-040.md:116` | `:274` يبقى `npm test = 2278/2278` ثم `:280` يقول 2278⇒2281. تقرير البند الأصلي لم يُحدَّث. | RUN الحيّ: `# tests 2281` / `# pass 2281` / `# fail 0`. |

### تفصيل العيب الحاجز الأول — `DISPATCH_SITE_ACCEPTS_VACUOUS_BRANCH`

`caseReaches`:

```
if (clause.statements.length > 0) return true;
```

لا يستدعي `nonEmptyBranch`. لذلك:

- `case 'tax_levy': break;` — `BreakStatement` عبارة → طول > 0 → قبول.
- `case 'tax_levy': { /* todo */ }` — `Block` عبارة واحدة ولو كان داخلها صفر عبارات → قبول.
- `case 'tax_levy': return;` / `void 0` / `console.log(...)` → قبول.

تعليق الدالة نفسها (`:88-90`) يعدّ «بندًا فارغًا» و«سطر سجل» ليسا برهانًا. التنفيذ يخالف التعليق.

**الأثر في العالم:** من حذف منطق `tax_levy` وأبقى `case 'tax_levy': break;` يخضر `check:rehydrate-census` وبوابة الدمج. الصنف يُدوَّن ويُسقَط صمتًا عند الإقلاع — العلّة التي فُتح البند لأجلها. تطفيرات `rehydrate_census.test.ts` العشر تختبر **حذف** البند مع بقاء تعليق/سلسلة، لا تفريغ الجسم. لذلك نجت الثغرة من الاختبار الذي زُعم أنه يغطي عيب الجولة الأولى.

هذا نقل مباشر للعيب `CONSUMER_PROOF_IS_SUBSTRING` من `grep` إلى AST.

### تفصيل العيب الحاجز الثاني — `DISPATCH_SITE_ACCEPTS_LOG_LINE_COMPARISON`

`comparisonReaches` يعود `true` إذا صعد إلى:

- `CallExpression` والمقارنة في الحجج (`:81`)
- `VariableDeclaration` أو `PropertyAssignment` (`:82`)
- `ArrowFunction` أو `ReturnStatement` (`:80`)
- `ConditionalExpression` (`:79`)

ولا يسأل: هل المقارنة على `entry.kind` / `rec.kind`؟ هل النتيجة تُغذّي مسار استعادة؟

الشاهد الأقوى: `console.log('ignored' === 'tax_levy')` — حرفان لا يسندان إلى السجل — `form: 'compare'` مقبول.

**الأثر:** `console.log(rec.kind === 'tax_levy')` أو ثابت غير مستعمل يعيد خضرة الحاجز كما كان `grep "'tax_levy'"` يفعل. اللباس تغيّر؛ الحكم لم يتغيّر.

المسلك `if` يستعمل `nonEmptyBranch` للجسم، فيرفض `{}` الفارغ، لكن `if (entry.kind === 'k') { void 0; }` يُقبل لأن الكتلة غير فارغة عدًّا.

### تفصيل العيب الحاجز الثالث — `ROUNDTRIP_CORE_COUNTS_JOURNAL_LENGTH_NOT_RESTORE`

الحاجز النحوي يطبع أن صحّة الفرع يشهد بها `tests/data/rehydrate_roundtrip.test.ts` (`check_rehydrate_census.ts:249`). ذلك الشاهد، للمسلك `core`، مكسور.

`RehydrateReport.records` = `entries.length` (`persistence.ts:360`)، لا عدد ما استُعيد من ذلك الصنف. `observe` يسلسل التقرير كاملًا (`rehydrate_roundtrip.test.ts:255-257`). المقارنة `full === cut` بعد نزع الصنف (`:279-281`) تنجح حتمًا لأن الطول نقص، حتى لو بقيت حقول الاستعادة (`memoryRecords` / `facts` / `auditEntries`) صفرًا في الحالين.

`now` المختلف (`T0+10` مقابل `T0+20`) لا يدخل التقرير: التقارير الأربعة عدّادات وأعلام بلا طابع زمني. ذلك ليس ثغرة زمنية. الثغرة هي العدّاد `records`.

تقارير `state` / `fiscal` / `governance` لا تتضمّن طول اليوميّة؛ نزع منطقها *قد* يُفضح هناك. المسلك الأساسي — أربعة أصناف — لا.

**الأثر:** ثنائي الحاجز+الرحلة الذي تُسوَّق به المعالجة يُخترَق معًا لأصناف `persistence.ts`. دولة تقلع وتظن ذاكرتها/سجلها مستعادًا وهو ليس كذلك.

### تضييق `journal_drop` — حكم صريح: كان يجب أن يكون عيبًا لا دينًا صامت الأثر

الخيط كما في الحزمة، إلى حيث ينقطع:

1. العدّاد يزداد في `StateJournal.record` عند الخروج عن النطاق (`persistence.ts:139-142`) ويُقرأ بـ `droppedByKind` (`:135-137`).
2. `DurableWitness.droppedByKind` في `production_scanners.ts:65`.
3. `journalDropProbe` (`:302-318`) يرفع `journal_records_dropped` عند الزيادة.
4. `buildProductionScanners` يسجّل `'journal_drop'` (`:336`).
5. `composeOperations` يمرّر `durable: journal` (`operations.ts:85`) ويبني `ContinuousSupervisor` بالماسحات (`:96-104`).
6. **ينقطع الدليل:** التعليق `:73-74` يقول إن المراقبة تُبنى ولا تبدأ هنا؛ من يبدأ المؤقّت هو من يفتح التشغيل الاتحادي. ملفّا `continuous_supervisor.ts` و`federated_operation.ts` **ليسا في الحزمة** — انظر §7.
7. `journal_drop` غائب عن `PRODUCTION_REQUIRED_SCANNERS`. حذفُه من `config/production.yaml` لا يسقط حرس الماسحات المشترطة.
8. الشدّة `high` لا `critical` (`production.yaml:94-104`)؛ غائب عن `PRODUCTION_MUST_BE_CRITICAL`.

الدين مُعلن بصدق من حيث التصنيف. لكن عيب الجولة الأولى في هذا الخيط كان: **رقم لا يُقرأ ليس معلومة**. قارئ لا يُستدعى عند الإقلاع، وغير مشترط، وغير حرج، يعيد الرقم إلى الذاكرة ما لم يُفتح تشغيل اتحادي. ذلك يُفرغ علاج «يصل أحدًا» على مسار الإقلاع الافتراضي. لذلك `JOURNAL_DROP_PROBE_NEVER_TICKS_ON_BOOTSTRAP` **MAJOR** لا دينًا يُكتفى بإعلانه.

`PROBE_BEFORE_IS_SIMULATION`: المسبار ما زال يحاكي «قبل» بجدول دعاوى مُقلَّم (`scripts/rehydrate_census_probe.ts:80`). مُعلن في المعالجة §4. لا يُبطل دعوى الحاجز النحوي نفسها. يبقى دينًا صادق الإعلان — **ليس مانعًا** بمفرده.

`T-136`: أُعلن دينًا. ملف الاختبار `tests/governance/closed_enums_gate.test.ts` **ليس في الحزمة**. لا أحكم هل ما زال يطير. انظر §7.

## 6) ما قَبِلتُه بالدليل

- **التعليق لم يعد يخضر الحاجز.** تجربة `comment_only` و`log_string_only` رُفضتا. ثلاث إضافات التعليق في `rehydrate_census.test.ts:326` موجودة. هذا الجزء من عيب الجولة الأولى **أُغلق** — لا العلّة كلّها.
- **XOR وقت التشغيل:** `rehydrate_census.ts:136-144` يرمي `PERSISTENCE_REHYDRATE_CLAIM_NOT_EXCLUSIVE` إذا كان المستهلك والإعفاء معًا أو كلاهما `null`. تطفير `[RC-11]` موجود.
- **مُعجم الإعفاء مغلق:** `REHYDRATE_EXEMPTION_REASONS` سببان؛ سبب مجهول → `PERSISTENCE_REHYDRATE_EXEMPTION_UNKNOWN` (`:127-131`). صف بائد → `PERSISTENCE_REHYDRATE_CLAIM_STALE`. مكرّر → `DUPLICATE`.
- **نداء الحصر قبل أوّل `rehydrate*` في `src/index.ts`:** `assertRehydrateCensus` في `:130` ثم `rehydrateFromJournal` في `:135`. `[RC-07]` يقارن إزاحة المصدر لا التعليق. (ملاحظة لا عيب: `StateJournal` يكون قد قرأ الملف في الإنشاء قبل هذا السطر؛ الدعوى المقيسة هي «قبل نداء الإرجاع» لا «قبل أي بايت من القرص».)
- **الأعداد 23 / 21 / 2** عُدَّت من ثلاثة مصادر متطابقة: `DURABLE_KINDS` (23) · `config/persistence.yaml` نطاق (23) · `REHYDRATE_CLAIMS` (21 مستهلكًا مسمّى + 2 إعفاء: `archive_snapshot`/`declared_without_producer` و`journal_compacted`/`compaction_marker`).
- **10 تطفيرات:** عشرة `code: 'RC-…'` في `rehydrate_census.test.ts` (RC-01، RC-03 ثلاثًا، RC-04، RC-05، RC-07، RC-10، RC-11، RC-12). **3** إضافات تعليق في اختبار `:326`.
- **2281:** `RUN-verify-output-filtered.txt` سطر `# tests 2281` و`# pass 2281` و`# fail 0`. ورود `not ok` مرتان في ترويسة المرشّح فقط («كلُّ 'not ok' إن وُجد») لا في أحكام TAP.
- **15 حاجزًا:** سلسلة `package.json` `verify` = `build` + `node --test` + `verify_audit_chain` + 12 `check:*` = 15. خرج `check:ci-gates` في RUN: «15 حاجزًا في سلسلةِ التحقّق كلُّها تُشغَّل على الدمج». `.github/workflows/ci.yml:64-65` يشغّل `check_rehydrate_census.js`.
- **تصويب 15→16 وحدة في العقد §3** وقع نصًّا في `docs/work/orders/W-2026-040.md` (التصويب معلن لا صامت). المواضع الأخرى في الحزمة تقول 16 لا 15. **عدّ الوحدات المنتِجة من الشجرة غير ممكن في هذه الحزمة** — انظر §7. التصويب التوثيقي مقبول؛ الرقم 16 نفسه غير معاد العدّ من المنتِجين.
- **111 حقلًا:** عُدَّت `readonly …:` داخل `export interface DigitalState` في `src/composition/state.ts` = **111**.
- **7 فجوات:** خرج حاجز المعايير في RUN: «مستوفى 12 · فجوة 7 · اكتُفي 2». حدّ البند لا يغلق `C-08`/`C-21` معلن بصدق في العقد `:123` والتقرير والمعالجة والصف `:258` و`:277` وADR-0048 `:123`. لم أجد موضعًا يقول «أُغلقت C-08» أو «أُغلق T-115ب».
- **`[RC-10]` مجموعات لا أعداد.** المحلّل `parseSimpleYaml` يتخطّى أسطرًا تبدأ بـ`#` (`yaml.ts:57`). تعليق لاحق على قيمة يُلحق بالنص فيُكسر تطابق الاسم — سقوط مغلق لا تجاوز صامت (عكس عيب الجولة الأولى المعجمي).
- **قارئ العدّاد في الشفرة موجود** (`journalDropProbe` + `droppedByKind` على الواجهة + الماسح في التهيئة والبيان). الوجود لا يساوي الاستدعاء عند الإقلاع — ذلك في العيوب لا هنا.

## 7) `INSUFFICIENT_EVIDENCE` الجزئيّ

لا يبطل جوهر الحكم (الثغرة النحوية شاهدة من الحزمة والتجربة). ينقص:

| الملف الناقص | ماذا كان سيُحسم |
|---|---|
| `src/production/continuous_supervisor.ts` | هل `start`/`sweep` يستدعي الماسحات ويُلحق الحوادث بالسجل. الخيط ينقطع عند المُنشئ. |
| `src/production/federated_operation.ts` (أو مكافئه) | هل فتح التشغيل الاتحادي يبدأ المشرف فعلًا. |
| وحدات التدوين المنتِجة (`src/ledger/**` ونظائرها) | إعادة عدّ «16 وحدة تُنتج 21 صنفًا» من `.record('<kind>'`. الحزمة فيها المستهلكون لا المنتِجون. |
| `COMPLETION_CRITERIA.md` | إعادة حساب **97.00%** من المصدر. الرقم **معلن** متكررًا؛ صيغة النسبة غير قابلة للعدّ هنا. الـ7 فجوات قُبلت من خرج الحاجز في RUN. |
| `tests/governance/closed_enums_gate.test.ts` | هل `T-136` ما زال يطير. أُعلن دينًا؛ لا شاهد في الحزمة على الطيران الحالي. |
| شجرة `src/**` الكاملة | سلوك `[RC-04]` لملف منتج خارج `src/**/*.ts` أو غير قابل للتحليل: الحزمة شريحة. ملاحظة: منتج غير محلَّل مع إعفاء `declared_without_producer` قد يبقى إعفاءً — **تجاوز صامت محتمل** بلا شاهد من شجرة كاملة، لذا `OBSERVATION` لا عيب. |

`97.00%`: أقبله بوصفه **إعلانًا متسقًا غير متغيّر** عبر الحزمة، لا بوصفه رقمًا أعدته من معايير القبول.

## 8) الحكم

العلاج يعيد إنتاج عيب الجولة الأولى في لباس نحوي. الحاجز الساكن يقبل فرعًا صوريًا ومقارنة في سطر سجل. اختبار الرحلة لا يمسك منطقًا ميتًا في المسلك الأساسي لأنه يعدّ طول اليوميّة. دعوى «برهان مستهلك» غير قائمة. هذا مدخل لقرار الإغلاق لا قرار الإغلاق نفسه.

REJECTED_WITH_NAMED_DEFECT
