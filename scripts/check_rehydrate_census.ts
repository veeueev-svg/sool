/**
 * scripts/check_rehydrate_census.ts — حاجزُ حصرِ إرجاعِ أصنافِ اليوميّة (المرحلة 39 · W-2026-040)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: config/persistence.yaml (بمُحلِّلِ المستودعِ نفسِه) · src/data/rehydrate_census.ts
 *   · src/kernel/config/persistence.ts · src/index.ts · src/** — والجذرُ يُوجَّه بـ`SOOL_CHECK_ROOT`
 * المخرجات: رمز 0 إن كان كلُّ صنفٍ في النطاق مُدَّعًى ودعواه قائمةً على **بنيةِ الشفرة**، و1 مع الحكم
 * التبعيات: مُترجمُ TypeScript (شجرةُ النحو) + مُحلِّلُ YAML الداخليّ. لا grep على الشفرة.
 * الصلاحيات (RULE-004): فحصٌ يقرأ ولا يُصلح؛ لا يُضيف دعوى ولا يُعدّل نطاقًا
 * السجلات: خرجٌ نصّي في البوابة
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · القياسُ الخام: docs/test-reports/phase-39-W-2026-040-measurements.txt
 *   · سجلُّ المراجعةِ التي أوجبت هذه الصيغة: docs/test-reports/phase-39-W-2026-040-review-round-1.md
 *
 * ## لماذا كُتب هذا الحاجزُ من جديد
 *
 * صيغتُه الأولى كانت تُبرهن الاستهلاكَ بـ`grep -qF "'kind'"` ورفضها المراجعانِ المستقلّانِ بعيبٍ
 * واحد: **تطابقُ السلسلةِ ليس برهانَ استهلاك** — فاسمُ الصنفِ في تعليقٍ لا يُقرأ يُخضِّر الحاجزَ.
 * فالبرهانُ هنا **نحويٌّ لا معجميّ**: لا تُقبل الدعوى إلّا إن ورد اسمُ الصنفِ في **موضعِ توزيعٍ**
 * له فرعٌ غيرُ فارغٍ قابلٌ للوصول، والتعليقاتُ ليست عُقَدًا فلا تُرى أصلًا. **وحدُّ البرهانِ
 * مُعلَن**: يشهد أنّ للصنفِ فرعَ توزيعٍ داخلَه أثرًا قابلًا للوصولِ (إسنادٌ أو نداءٌ لغيرِ أداةِ
 * تسجيلٍ أو رميٌ أو إنشاءٌ — قائمةُ إثباتٍ لا قائمةَ نفي)، ولا يشهد أنّ الفرعَ يُنفَّذُ تشغيليًّا
 * ولا أنّه يُعيد الحالةَ صحيحةً — ذاك يشهدُ به اختبارُ الرحلةِ الكاملةِ وهما معًا لا أحدُهما.
 *
 * ## ثوابتُ هذا الفحص
 *
 * 1) **يقرأ من الجذرِ نصًّا لا بالاستيراد** (`SOOL_CHECK_ROOT`) — وحاجزٌ لا يُرى ساقطًا ليس حاجزًا.
 * 2) **النطاقُ يُقرأ بمُحلِّلِ YAML الحقيقيّ** وتُقابَلُ المجموعاتُ لا الأعدادُ — فلا يُعَدُّ المجهولُ
 *    ويُسكَت عنه.
 * 3) **لكلِّ حكمٍ رمزٌ لاتينيٌّ ثابت** `[RC-NN]`: النصُّ يُنقَّح والرمزُ عقدٌ بين الفحصِ واختباره.
 * 4) **الحصرُ الأعمى يسقط**: مدخلٌ موجودٌ وحصيلتُه صفرٌ يعني أنّ الصيغةَ تغيّرت والفحصُ عَمِي.
 *
 * الاستخدام: node dist/scripts/check_rehydrate_census.js
 */
import { readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseSimpleYaml } from "../src/kernel/config/yaml";
import { argumentSites, constructionSites, lineOf, parseFile, producerSites, readClaims, readDeclared, readReasons, readStringArray, sourceFiles, walk } from "./rehydrate_proof";
import type { Claim } from "./rehydrate_proof";

import { dispatchSites } from "./rehydrate_dispatch";
import { guardsOf } from "./rehydrate_reachability";
import { barrierLaw, bodyThrows, calleeOf, chokepointGuarded, isLawfulBarrierCall, resolvedTargetName, unwrapCallee } from "./rehydrate_barrier_binding";
import { buildSrcProgram, typedProducerVerdicts } from "./rehydrate_producers";

const ROOT = process.env.SOOL_CHECK_ROOT ?? ".";
const CFG = join(ROOT, "config/persistence.yaml");
const CENSUS = join(ROOT, "src/data/rehydrate_census.ts");
const KINDS = join(ROOT, "src/kernel/config/persistence.ts");
const BOOT = join(ROOT, "src/index.ts");
const SRC = join(ROOT, "src");

let fail = 0;
const say = (s: string): void => {
  console.log(s);
};
const bad = (s: string): void => {
  fail = 1;
  console.log(s);
};

// ── المدخلات ───────────────────────────────────────────────────────────────────────
say("حاجزُ حصرِ الإرجاع: لكلِّ صنفٍ في النطاق دعوى قائمةٌ على بنيةِ الشفرة (W-2026-040)");
for (const f of [CFG, CENSUS, KINDS, BOOT]) {
  if (!existsSync(f)) {
    say(`✗ [RC-09] مدخلٌ غائب: ${relative(ROOT, f)} — فحصٌ بلا مدخلٍ لا يحكم، ولا يُقال «لا انحراف»`);
    process.exit(1);
  }
}

const censusSf = parseFile(CENSUS);
const claims = readClaims(censusSf);
const declared = readDeclared(parseFile(KINDS));
const reasons = readReasons(censusSf);
const yamlDoc = parseSimpleYaml(readFileSync(CFG, "utf8"));
const policy = (yamlDoc.policy ?? {}) as Record<string, unknown>;
const rawScope = Array.isArray(policy.scope) ? policy.scope.map((v) => String(v)) : [];

say(`  المقيس: نطاقُ التدوين ${rawScope.length} عنصرًا · جدولُ الدعاوى ${claims.length} صفًّا` + ` · التعدادُ المغلق ${declared.length} صنفًا · مُعجمُ الإعفاء ${reasons.length} سببًا`);

// ── [RC-06] حصرٌ أعمى ────────────────────────────────────────────────────────────────
if (rawScope.length === 0 || claims.length === 0 || declared.length === 0 || reasons.length === 0) {
  say(`✗ [RC-06] حصرٌ أعمى: قُرئ ${rawScope.length} من النطاق و${claims.length} من الجدول و${declared.length} من التعداد و${reasons.length} من المُعجم — والمدخلاتُ موجودة: فالصيغةُ تغيّرت والفحصُ عَمِي. لا يُطبع «✓» على حصرٍ فارغ.`);
  process.exit(1);
}

// ── [RC-10] مقابلةُ مجموعاتٍ لا أعداد: كلُّ عضوٍ في النطاقِ عضوٌ في التعدادِ المغلق ─────
const declaredSet = new Set(declared);
const scope: string[] = [];
const seenScope = new Set<string>();
for (const item of rawScope) {
  if (!declaredSet.has(item)) {
    bad(`✗ [RC-10] عضوٌ في نطاق التدوين ليس عضوًا في التعداد المغلق: «${item}» — قُوبلت المجموعتان عضوًا عضوًا: فلا يُنجي تعليقٌ لاحقٌ ولا خطأُ كتابةٍ، يسقط ولا يُعَدّ.`);
    continue;
  }
  if (seenScope.has(item)) {
    bad(`✗ [RC-10] عضوٌ مكرّرٌ في نطاق التدوين: ${item} — تكرارٌ يُخفي أيَّ سطرٍ حكَم`);
    continue;
  }
  seenScope.add(item);
  scope.push(item);
}

// ── [RC-01] صنفٌ في النطاق بلا صفٍّ في الجدول ────────────────────────────────────────
const byKind = new Map<string, Claim>();
for (const c of claims) byKind.set(c.kind, c);
for (const kind of scope) {
  if (!byKind.has(kind)) {
    bad(`✗ [RC-01] صنفٌ في نطاق التدوين بلا دعوى إرجاع: ${kind} — يُدوَّن على القرص ويُسقَط صمتًا عند الإقلاع (يُضاف صفٌّ في REHYDRATE_CLAIMS أو يُنزع من scope).`);
  }
}

// ── فحصُ كلِّ صفّ ────────────────────────────────────────────────────────────────────
const files = sourceFiles(SRC);
let typed: ReturnType<typeof typedProducerVerdicts> | undefined;
let srcProgram: ts.Program | undefined;
const programOf = (): ts.Program => (srcProgram ??= buildSrcProgram(files));
const exemptKinds = claims.filter((c) => c.exemption === "declared_without_producer").map((c) => c.kind);
let provenConsumers = 0;
let provenExempt = 0;
for (const claim of claims) {
  const { kind, consumer, exemption } = claim;

  if (!declaredSet.has(kind)) {
    bad(`✗ [RC-02] صفٌّ لصنفٍ ليس في التعداد المغلق: ${kind} — لا حرسَ على معدوم (RULE-001).`);
    continue;
  }

  // [RC-11] حرسُ الحصرِ المتبادل ساكنًا — كما يُحرَس في التشغيل
  if (consumer !== null && exemption !== null) {
    bad(`✗ [RC-11] صفٌّ بمستهلكٍ وإعفاءٍ معًا: ${kind} (السطر ${claim.line}) — الدعوى واحدةٌ لا اثنتان، والجمعُ يُخفي أيَّهما حكَم.`);
    continue;
  }
  if (consumer === null && exemption === null) {
    bad(`✗ [RC-11] صفٌّ بلا مستهلكٍ ولا إعفاء: ${kind} (السطر ${claim.line}) — صفٌّ لا يقول شيئًا لا يُدَّعى به.`);
    continue;
  }

  if (consumer !== null) {
    const path = join(ROOT, consumer);
    if (!existsSync(path)) {
      bad(`✗ [RC-03] مستهلكٌ مُدَّعًى لا وجودَ لملفّه: ${kind} ⇐ ${consumer}`);
      continue;
    }
    const sites = dispatchSites(parseFile(path), kind);
    if (sites.length === 0) {
      bad(`✗ [RC-03] مستهلكٌ مُدَّعًى بلا موضعِ توزيعٍ في شجرةِ نحوِه: ${kind} ⇐ ${consumer}`);
      say("         لا يكفي ذكرُ الاسم: يُطلب بندُ `case` له عباراتٌ أو مقارنةُ هُويّةٍ في شرطٍ له فرعٌ يعمل — واسمٌ في تعليقٍ أو سطرِ سجلٍّ ليس استهلاكًا وهو أخطرُ من غيابِ الدعوى لأنّه يُطمئن.");
      continue;
    }
    provenConsumers += 1;
    continue;
  }

  if (!reasons.includes(exemption as string)) {
    bad(`✗ [RC-08] سببُ إعفاءٍ خارجَ المُعجم المغلق: ${kind} (الإعفاء: «${exemption}»)`);
    continue;
  }

  if (exemption === "declared_without_producer") {
    const foreignWrites: string[] = [];
    const producers = producerSites(ROOT, files, kind, foreignWrites);
    // **الجولةُ السابعة** (§2-ط): والنفيُ يُسأَلُ عنه المترجمُ لا الشكلُ — والمجهولُ لا يؤيّدُ الإعفاء
    typed ??= typedProducerVerdicts(ROOT, files, exemptKinds, programOf());
    const verdict = typed.get(kind) ?? {
      definite: [],
      possible: ["(لا حكمَ — لا يُقاسُ النفي)"],
    };
    const definite = [...new Set([...producers, ...verdict.definite])];
    if (definite.length > 0) {
      bad(`✗ [RC-04] إعفاءٌ بطل موجبُه: ${kind} مُعفًى بحجّة «لا مُنتِجَ له» وله مُنتِجٌ في: ${definite.join(" ")} — يُكتب له مستهلكُ إرجاعٍ أو يُنزع من scope.`);
      continue;
    }
    const possible = [...new Set([...verdict.possible, ...foreignWrites])];
    if (possible.length > 0) {
      bad(`✗ [RC-14] غيابُ المُنتِجِ لا يُبرهَن: ${kind} مُعفًى بحجّة «لا مُنتِجَ له» ونداءاتُ يوميّةٍ لا يُعرَفُ صنفُها: ` + possible.join(" · "));
      say("         لا يُدّعى أنّ له منتِجًا؛ يُرفَضُ الإعفاءُ لأنّ نفيَه لم يُبرهَن — المجهولُ لا يؤيّدُ الإعفاء.");
      continue;
    }
    provenExempt += 1;
    continue;
  }

  if (exemption === "compaction_marker") {
    const compactor = join(ROOT, "src/data/journal_compaction.ts");
    if (!existsSync(compactor)) {
      bad(`✗ [RC-05] إعفاءٌ بحجّة «علامةُ ضغط» ولا ملفَّ ضاغطٍ أصلًا: ${kind}`);
      continue;
    }
    const compactorSf = parseFile(compactor);
    // البرهانُ شقّان لا شقّ: الضاغطُ **يبني** العلامة، والضاغطُ **يقرؤها**. وكلاهما عقدةٌ
    // في الشجرة لا سطرُ نصّ — فتعليقٌ يذكر الاسمَ لا يُنجي هنا.
    const built = constructionSites(compactorSf, kind);
    const used = [...dispatchSites(compactorSf, kind), ...argumentSites(compactorSf, kind)];
    if (built.length === 0 || used.length === 0) {
      bad(`✗ [RC-05] إعفاءٌ بحجّة «علامةُ ضغط» وبرهانُه ناقصٌ في src/data/journal_compaction.ts: ${kind}` + ` — مواضعُ بناءٍ ${built.length} · مواضعُ قراءةٍ ${used.length} (يُطلب واحدٌ من كلٍّ)`);
      continue;
    }
    provenExempt += 1;
    continue;
  }

  bad(`✗ [RC-08] سببُ إعفاءٍ لا حرسَ له في هذا الفحص: ${kind} (الإعفاء: «${exemption}»)`);
}

// ── [RC-07] الحاجزُ منادًى نداءً حقيقيًّا في مسارِ الإقلاع، وقبلَ أوّلِ إرجاع ─────────────
// **الجولةُ الحاديةَ عشرةَ** (عيوبُ الجولةِ السابعةِ 4.1/4.2/4.3): الهويّةُ **رمزٌ محلولٌ يُطابَقُ
// بعقدةِ التعريفِ** (التفصيلُ في `rehydrate_barrier_binding`) — لا نصُّ معرّفٍ ولا لاحقةُ محدِّدِ
// استيرادٍ: فكنيّةُ مصدَّرٍ لا يرمي تسقطُ بالاسمِ الذاتيّ، والوحدةُ المزيفةُ بملكيّةِ الملفّ،
// والتسميةُ الواضحةُ (`as checkCensus`) والنطاقُ (`census.assertRehydrateCensus`) يخضرّانِ لأنّهما
// يصلانِ إلى التعريفِ نفسِهِ. **وحدُّ معلَن:** حاجزٌ لا يملكُ جسمُهُ رميًا ليس حاجزًا — شاهدٌ
// بنيويّ؛ والسلوكُ يشهدُ لهُ اختبارُ الوحدةِ بالحقنِ (الحقنُ شرطُ البرهانِ، لا «يحتوي رميًا»
// وحدَهُ حكمًا نهائيًّا).
const law = barrierLaw(programOf(), CENSUS, ["assertRehydrateCensus", "assertExemptionsHold"]);
if (law === null) {
  bad("✗ [RC-07] وحدةُ الحصرِ (src/data/rehydrate_census.ts) غائبَةٌ عن البرنامجِ النوعيّ — لا هويةَ تُقاس (RULE-001).");
} else {
  for (const name of ["assertRehydrateCensus", "assertExemptionsHold"]) {
    const decls = law.lawful.get(name);
    if (decls === undefined || decls.size === 0) {
      bad(`✗ [RC-07] لا تعريفَ قانونيًّا لـ«${name}» في وحدةِ الحصرِ — الكنيّةُ لا تُنشئُ تعريفًا (RULE-001).`);
    } else {
      for (const d of decls) {
        if (!bodyThrows(d)) bad(`✗ [RC-07] «${name}» بلا رميٍّ في جسمِهِ — حاجزٌ صوريٌّ لا يمنعُ شيئًا (RULE-001).`);
      }
    }
  }
}
// ملفُ الإقلاعِ من البرنامجِ النوعيِّ نفسِهِ لا من تحليلٍ مستقلّ — فالرموزُ تُحَلُّ بالمدقّقِ الذي بُنيَ منه القانونُ (الجولةُ الحاديةَ عشرةَ).
const bootSf = programOf().getSourceFile(BOOT) ?? parseFile(BOOT);
const censusCalls: ts.CallExpression[] = [];
const rehydrateCalls: ts.CallExpression[] = [];
// **الجولةُ السابعة** (`RC07_PARENTHESIZED_REHYDRATE_CALLEE_BLINDS_GATE`): المُستدعى يُقرأُ بعدَ فكِّ الأغلفةِ — والحلُّ الرمزيُّ يرى الفهرسَ الحرفيَّ والنطاقَ والاستعارةَ كلَّها.
const leafTextOf = (e: ts.Expression): string => {
  const leaf = unwrapCallee(e);
  return ts.isIdentifier(leaf) ? leaf.text : ts.isPropertyAccessExpression(leaf) ? leaf.name.text : ts.isElementAccessExpression(leaf) && ts.isStringLiteralLike(leaf.argumentExpression) ? leaf.argumentExpression.text : "";
};
walk(bootSf, (n) => {
  if (!ts.isCallExpression(n)) return;
  if (law !== null && isLawfulBarrierCall(n, law, "assertRehydrateCensus")) {
    censusCalls.push(n);
    return;
  }
  const name = law === null ? undefined : resolvedTargetName(law.checker, n.expression);
  if (name === "assertRehydrateCensus" || (name === undefined && leafTextOf(n.expression) === "assertRehydrateCensus")) {
    bad(`✗ [RC-07] نداءٌ بالاسمِ «assertRehydrateCensus» لا يحلُّ إلى تعريفِهِ القانونيّ في وحدةِ الحصرِ (السطر ${lineOf(bootSf, n)}) — كنيّةُ مصدَّرٍ أو وحدةٌ مزيفةٌ أو تظليلٌ: المجهولُ لا يؤيّدُ السيادة (RULE-001).`);
    return;
  }
  if (name !== undefined && /^rehydrate[A-Z]/.test(name)) rehydrateCalls.push(n);
});
// والمرجعُ الهاربُ — رمزٌ حلّ إلى اسمِ حاجزٍ أو إرجاعٍ في غيرِ موضعِ المُستدعى (إسنادٌ · `.call` · وسيطٌ) — يسقطُ برمزِه لا يُتجاهَل.
walk(bootSf, (n) => {
  const isId = ts.isIdentifier(n);
  const isKey = ts.isStringLiteralLike(n) && ts.isElementAccessExpression(n.parent) && n.parent.argumentExpression === n;
  if (!isId && !isKey) return;
  const text = (n as ts.Identifier | ts.StringLiteral).text;
  if (!/^rehydrate[A-Z]/.test(text) && text !== "assertRehydrateCensus" && text !== "assertExemptionsHold") return;
  if (calleeOf(n) !== null) return;
  let up: ts.Node = n;
  while (up.parent !== undefined && !ts.isSourceFile(up.parent)) up = up.parent;
  if (ts.isImportDeclaration(up) || ts.isExportDeclaration(up)) return;
  const finalName = law === null ? undefined : resolvedTargetName(law.checker, n as ts.Expression);
  if (finalName !== undefined && !/^rehydrate[A-Z]/.test(finalName) && finalName !== "assertRehydrateCensus" && finalName !== "assertExemptionsHold") return;
  bad(`✗ [RC-07] مرجعٌ إلى «${text}» في غيرِ موضعِ المُستدعى (السطر ${lineOf(bootSf, n)}) — ` + "نداءٌ عبرَ اسمٍ آخرَ لا تُقاسُ سيادتُه، والمجهولُ لا يؤيّدُ السيادة (RULE-001).");
});
// ── [RC-07] الحراسةُ في نقطةِ الاختناقِ — قراءةُ اليوميّةِ (`StateJournal.read`) تمرُّ بالحاجزَينِ، وإعادةُ القيدِ تُكذّبُ الإعفاءَ — لا «نداءٌ في أيّ موضعٍ من الملفّ».
if (law !== null) {
  const persistenceSf = programOf().getSourceFile(join(ROOT, "src/data/persistence.ts"));
  if (persistenceSf === undefined) {
    bad("✗ [RC-07] src/data/persistence.ts غائبٌ عن البرنامجِ النوعيّ — لا تُقاسُ حراسةُ نقطةِ الاختناق (RULE-001).");
  } else {
    const chokepoints: Array<readonly [string, string | null, string]> = [
      ["read", "StateJournal", "assertRehydrateCensus"],
      ["read", "StateJournal", "assertExemptionsHold"],
      ["rehydrateFromJournal", null, "assertExemptionsHold"],
    ];
    for (const [fn, owner, barrier] of chokepoints) {
      const verdict = chokepointGuarded(persistenceSf, law, owner, fn, barrier);
      if (verdict !== true) {
        bad(`✗ [RC-07] ${verdict === null ? `دالّةُ الاختناقِ «${fn}»${owner !== null ? ` في ${owner}` : ""} غائبَةٌ عن src/data/persistence.ts — لا تُقاسُ الحراسةُ أصلًا` : `نداءُ «${barrier}» غائبٌ عن دالّةِ الاختناقِ «${fn}» — وجودُهُ في موضعٍ آخرَ من الملفِّ لا يثبتُ حراسةَ نقطةِ الاختناق`} (RULE-001).`);
      }
    }
  }
}

if (censusCalls.length === 0) {
  bad("✗ [RC-07] حاجزُ الحصر غيرُ منادًى نداءً في مسار الإقلاع (src/index.ts) — والاسمُ في تعليقٍ ليس نداءً (RULE-001).");
} else if (rehydrateCalls.length === 0) {
  bad("✗ [RC-07] لا نداءَ إرجاعٍ واحدٌ في مسار الإقلاع — فالحاجزُ يحرس بابًا لا يُدخَل منه (RULE-001).");
} else {
  // (الجولتانِ الخامسةُ `RC07_COMMA_CONJUNCT_DECOY_GREENS` والتاسعةُ `RC07_CATCH_NONTHROWING_CALL_COUNTED_LIVE`):
  // الحكمُ لكلِّ نداءِ حاجزٍ — الميتُ حتمًا يُسقِط (حاجزٌ صوريّ) — وسيادةُ كلِّ نداءِ إرجاعٍ أن يسودَه حاجزٌ واحدٌ
  // على الأقلّ: قبلَه، في دالّتِه، وذرّاتُه محتواةٌ في ذرّاتِه. والسيّدُ يُسمّى بسطرِه.
  const ordered = [...rehydrateCalls].sort((a, b) => a.getStart(bootSf) - b.getStart(bootSf));
  const gOf = new Map(censusCalls.map((c) => [c, guardsOf(bootSf, c)] as const));
  for (const [c, g] of gOf) {
    if (g.unsatisfiable) {
      bad(`✗ [RC-07] نداءُ الحاجزِ تحت شرطٍ لا يصدُق أبدًا (السطر ${lineOf(bootSf, c)}: ` + `${g.texts.join(" · ")}) — نداءٌ لا يُنفَّذ ليس حاجزًا (RULE-001).`);
    }
  }
  const sovereigns = new Set<ts.CallExpression>();
  let sovereignOk = true;
  for (const call of ordered) {
    const gCall = guardsOf(bootSf, call);
    const before = censusCalls.filter((c) => c.getStart(bootSf) < call.getStart(bootSf));
    const sameFn = before.filter((c) => gOf.get(c)?.fn === gCall.fn);
    const sovereign = sameFn.find((c) => {
      const g = gOf.get(c);
      return g !== undefined && !g.unsatisfiable && g.atoms.every((t) => gCall.atoms.includes(t));
    });
    if (sovereign !== undefined) {
      sovereigns.add(sovereign);
      continue;
    }
    sovereignOk = false;
    if (before.length === 0) {
      bad(`✗ [RC-07] الحاجزُ منادًى بعدَ إرجاع (السطر ${lineOf(bootSf, censusCalls[0]!)} بعد ` + `${lineOf(bootSf, call)}) — حكمٌ بعد الفعلِ لا يمنعه.`);
    } else if (sameFn.length === 0) {
      bad(`✗ [RC-07] نداءُ الحاجزِ وإرجاع (السطر ${lineOf(bootSf, call)}) في دالّتَينِ ` + "مختلفتَين — فلا يُقاس ترتيبٌ بينهما (RULE-001).");
    } else {
      // الاحتواءُ **ذرّاتٍ** (الجولةُ الخامسة): كلُّ ذرّةٍ من شروطِ الحاجزِ يجبُ أن تحرسَ النداء
      const nearest = sameFn[sameFn.length - 1]!;
      const narrower = (gOf.get(nearest)?.atoms ?? []).filter((t) => !gCall.atoms.includes(t));
      bad(`✗ [RC-07] الحاجزُ محروسٌ بشرطٍ لا يحرسُ الإرجاع (السطر ${lineOf(bootSf, call)}): ` + `${narrower.join(" · ") || "نداءُ حاجزٍ لا يُنفَّذ"} — فمسلكٌ يُرجِع ولا يمرُّ بالحاجزِ قائمٌ — والمطلوبُ سيادةٌ لا مجرّدُ ترتيب.`);
    }
    break;
  }
  if (sovereignOk) {
    const lines = [...sovereigns].map((c) => `السطر ${lineOf(bootSf, c)} {${gOf.get(c)?.texts.join(" · ") || "لا شرط"}}`);
    say(`  سيادةُ نداءِ الحاجزِ مقيسةٌ على ${ordered.length} نداءِ إرجاعٍ: السيّدُ ${lines.join(" · ")} ` + `— شروطُه مُحتواةٌ بالذرّاتِ في شروطِ كلِّ نداءٍ منها (من ${censusCalls.length} نداءِ حاجز)`);
  }
}

// ── [RC-12] عدّادُ الإسقاطِ يقرؤه مسارُ إنتاج، لا مسبارٌ ولا اختبار ─────────────────────
/**
 * **قراءةٌ حيّةٌ لا وصولٌ مَيّت** (الجولةُ الثانيةُ `RC12_IS_PROPERTY_ACCESS_NOT_LIVE_READER`):
 * يُطلَبُ **نداءٌ** لـ`droppedByKind()` أو قراءةُ `droppedOutOfScope` داخلَ تعبيرٍ يُستعمَل.
 * **وعيبُ الجولةِ الثالثةِ** `RC12_CALL_IS_NOT_LIVE_READER`: كان النداءُ يُقبل حيثما وقعَ ولو
 * تحتَ شرطٍ لا يصدُق أبدًا — فصار يُشترط أن يكونَ قابلًا للوصولِ بالجامعِ نفسِهِ الذي يقيسُ
 * سيادةَ `[RC-07]` (`guardsOf`).
 */
const readers = files.filter((f) => {
  const rel = relative(ROOT, f);
  if (rel === "src/data/persistence.ts" || rel.startsWith("src/data/rehydrate")) return false;
  const sf = parseFile(f);
  let found = false;
  walk(sf, (n) => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "droppedByKind") {
      if (!guardsOf(sf, n).unsatisfiable) found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "droppedOutOfScope" && n.parent !== undefined && !ts.isExpressionStatement(n.parent) && !ts.isVoidExpression(n.parent) && !guardsOf(sf, n).unsatisfiable) found = true;
  });
  return found;
});
if (readers.length === 0) {
  bad("✗ [RC-12] عدّادُ الإسقاطِ لا يقرؤه مسارُ إنتاجٍ واحد قراءةً حيّةً: `droppedByKind()` غيرُ منادًى ولا `droppedOutOfScope` مقروءٌ في تعبير — رقمٌ يموت مع العملية، ووصولٌ بالاسمِ لا يُنادَى ليس قارئًا (RULE-001).");
} else {
  say(`  قارئو عدّادِ الإسقاطِ في الإنتاج: ${readers.map((f) => relative(ROOT, f)).join(" · ")}`);
}

// ── [RC-13] ماسحُ الإسقاطِ **مشترَطٌ** في السياسة، فرفعُه من التهيئةِ يُسقِط الإقلاع ────
const POLICY = join(ROOT, "src/kernel/config/production_policy.ts");
if (!existsSync(POLICY)) {
  bad(`✗ [RC-13] ملفُ سياسةِ الإنتاجِ غيرُ موجود: ${relative(ROOT, POLICY)}`);
} else {
  const required = readStringArray(parseFile(POLICY), "PRODUCTION_REQUIRED_SCANNERS");
  if (required.length === 0) {
    bad("✗ [RC-13] حصرٌ أعمى: PRODUCTION_REQUIRED_SCANNERS لم تُقرأ من الشجرة — تغيرّتِ الصيغةُ فعَمِي الفحص.");
  } else if (!required.includes("journal_drop")) {
    bad("✗ [RC-13] ماسحُ `journal_drop` غيرُ مشترَطٍ في PRODUCTION_REQUIRED_SCANNERS — فرفعُه من التهيئةِ لا يُسقِط شيئًا.");
    say("         قارئٌ يُرفَع من التهيئةِ بلا حرسٍ يعيد الرقمَ إلى الصمت (RULE-007).");
  } else {
    say(`  ماسحُ الإسقاطِ مشترَطٌ: journal_drop في PRODUCTION_REQUIRED_SCANNERS (${required.length} ماسحًا مشترَطًا)`);
  }
}

if (fail === 0) {
  say(`✓ حصرُ الإرجاع: ${scope.length} صنفًا في النطاق كلُّها مُدَّعاة · ${provenConsumers} بمستهلكٍ` + ` له موضعُ توزيعٍ في شجرةِ نحوِه · ${provenExempt} بإعفاءٍ قائمِ الموجب · والحاجزُ منادًى قبل أوّلِ إرجاع`);
  say("  وحدُّ البرهانِ مُعلَن: فرعٌ في شجرةِ النحوِ فيه أثرٌ قابلٌ للوصولِ من أربعةٍ تُسمّى وحدَها — إسنادٌ أو");
  say("  نداءٌ لغيرِ أداةِ تسجيلٍ أو رميٌ أو إنشاءٌ (قائمةُ إثباتٍ لا نفي) — والأثرُ مقيّدٌ بالوصولِ (روابطُ المنطقِ");
  say("  بقصرِ الدارةِ · بندُ تبديلٍ لا يوافقُ مُميّزَه · مرورٌ على مصفوفةٍ فارغةٍ حرفيًّا · catch خاوٍ من try).");
  say("  **ولا يشهد أنّ الفرعَ يُنفَّذُ تشغيليًّا ولا أنّه يُعيد الحالةَ صحيحةً**؛ وإسنادٌ لا يُغيّر قيمةً (`x += 0`)");
  say("  أثرٌ بنيويٌّ لا يُرجِع شيئًا — حدٌّ مُعلَنٌ يكشفُه الوجهُ السلوكيُّ لا الساكن؛ وصحّةُ ما في الفرعِ");
  say("  يشهد بها اختبارُ الرحلةِ الكاملة: tests/data/rehydrate_roundtrip.test.ts — والأصلُ في rehydrate_reachability.ts");
}
process.exit(fail);
