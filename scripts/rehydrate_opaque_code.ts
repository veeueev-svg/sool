/**
 * scripts/rehydrate_opaque_code.ts — **الشفرةُ المعتمة**: ما لا يُبرهَنُ نفيُ المنتِجِ عليه (المرحلة 39 · W-2026-040 · الجولة 11)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عقدةٌ في شجرةِ نحوِ ملفٍّ من `src/**` ومدقّقُ أنواعِ البرنامج، ومسارُ ملفّ
 * المخرجات: سببٌ مقروءٌ إن كانت العقدةُ/الملفُّ **شفرةً لا يراها النفيُ** — أو `null`
 * التبعيات: مُترجمُ TypeScript وحدَه (حكمُ «يمكنُ أن يكونَ يوميّةً» يُحقَنُ من `rehydrate_producers.ts`)
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ ما يُطابِقُ هنا يُعَدُّ **منتِجًا ممكنًا** لكلِّ صنفٍ مُعفًى (`[RC-14]`)
 * اختبار القبول: tests/data/rehydrate_census_mutations_r11.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * ## الجولةُ الحاديةَ عشرةُ — علاجُ الآليةِ لا توسيعُ قائمةِ الأشكال (محضر الجولة السابعة)
 *
 * حكمَ الأعضاءُ الثلاثةُ بالإجماعِ أنّ تصنيفَ جذرِ `OPAQUE_ABSENCE_STILL_CLOSED_FORM_LIST`
 * «سياسةً» مرفوضٌ بمعيارِ العقدِ §4، وأنّ علاجَ الأبوابِ بقائمةِ أشكالٍ نحويّةٍ (الاسمُ المنقّطُ
 * `Reflect.get` · استعارةُ الأسماءِ · الفهرسُ بالأقواسِ) يُطاردُ الصيغةَ ولا يقيسُ الآلية. فصار
 * القياسُ **بالأنواعِ والرموزِ المحلولةِ** — والمدقّقُ نفسُهُ يحلُّ الاستعارةَ والفهرسةَ بالأقواسِ
 * والعبورَ بينَ الوحداتِ وسلاسلَ `globalThis` كلَّها، فلا شكلًا يُطابَق:
 *
 *   - **(أ) الجسمُ غيرُ المرئي:** نداءٌ نوعُ مستدعاه `Function`/`FunctionConstructor` — قيمةٌ
 *     دالّيّةٌ جسمُها خارجُ البرنامج (منشئُ الدالّةِ من نصٍّ · واصفٌ · صندوقٌ مُعلَّنُ النوع).
 *   - **(ب) الجلبُ الانعكاسيّ:** نداءٌ يُحَلُّ توقيعُه إلى `Reflect.get` أو
 *     `Object.getOwnPropertyDescriptor` — وصولٌ إلى قيمةٍ من خارجِ مجموعةِ دوالِّ البرنامجِ المرئية.
 *   - **(ج) الكائنُ العالميّ:** فهرسٌ على مستقبلٍ نوعُه `typeof globalThis` (بعدَ فكِّ الأغلفة) —
 *     الاستعارةُ المحليّةُ والعبورُ بينَ الوحداتِ وسلسلةُ `globalThis.globalThis` تُرى كلُّها بالنوعِ.
 *   - **(د) محمّلُ الوحداتِ المستعار:** نداءٌ نوعُ مستدعاه هو نوعُ `require` العالميّ (الاستعارةُ
 *     تُرى بالنوعِ) بمحدِّدٍ غيرِ حرفيٍّ أو لوحدةِ تنفيذِ شفرةٍ.
 *   - **(هـ) `eval`:** نداءٌ يُحَلُّ توقيعُه إلى `eval` العالميّ (والاستعارةُ كذلك تُرى بالتوقيعِ).
 *
 * وبقيت أسماءُ أبوابِ النصِّ (`constructor` · `eval` · `Function`) في الوصولِ بالخاصّيّةِ والفهرسِ
 * الحرفيِّ والمطويِّ **حرسًا زائدًا لا برهانًا**: فالآليةُ أعلاه هي البرهان، والاسمُ صِيانةٌ
 * للمستقبلِ المجهولِ النوعِ (`x.constructor` على مستقبلٍ `any` لا يُقيسه (أ)).
 *
 * **حدٌّ معلَنٌ (قياسُ الجولةِ الحاديةَ عشرةَ):** نداءٌ على مستدعًى `any` بلا وسيطِ يوميّةٍ لا
 * يُعلَمُ مصدرُه من أبوابِ الجلبِ (ب/ج/د) لا يُقاسُ هنا — ووراءَه الحارسُ التشغيليُّ
 * (`assertExemptionsHold` عندَ قراءةِ اليوميّةِ يُكذِّبُ الإعفاءَ إن كُتبَ الصنفُ). والمواقعُ
 * الحيّةُ الستُّ (استدعاءاتُ بياناتٍ على قيمٍ `any`: `startsWith`/`trim`/`act`/`verify` في
 * `src/scale/population.ts` و`src/governance/ministries.ts` و`src/staging/{runbook_runner,manifest}.ts`)
 * دَينٌ معلَنٌ بندًا مستقلًّا (تلوينُها خارجَ نطاقِ هذا البند) — لا استثناءً صامتًا.
 *
 * ## البابُ الأول (كما هو منذ الجولة التاسعة) — تسرّبُ اليوميّةِ إلى مُستدعًى لا يُرى جسمُه
 * نداءٌ يمرّرُ يوميّةً وسيطًا إلى مُستدعًى نوعُه `any`/`unknown`/`Function`/`FunctionConstructor`
 * — جسمُه لا يُرى فلا يُبرهَنُ الغياب. (لا يُحذف بإلحاقِ الجولةِ الحاديةَ عشرةَ؛ قياسُ الجلسةِ أكده.)
 */
import ts from "typescript";

/** لواحقُ الشفرةِ التي ينفّذها Node أو يُحوّلها مُحوِّلٌ — وما ليس `.ts` منها لا يراه البرنامجُ النوعيّ */
export const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** ملفٌّ في `src/**` لا يدخلُ البرنامجَ النوعيَّ — فنفيُ المنتِجِ فيه لا يُبرهَن */
export function foreignCodeReason(file: string): string | null {
  return CODE_FILE.test(file) && !file.endsWith(".ts") ? "ملفُّ شفرةٍ غيرُ TypeScript تحت src/** — لا يدخلُ البرنامجَ النوعيَّ فلا يُبرهَنُ نفيُ المنتِجِ فيه" : null;
}

const CODE_MODULES = new Set(["vm", "node:vm", "worker_threads", "node:worker_threads", "module", "node:module"]);

const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
  return cur;
};

/** المفتاحُ المحسوبُ يُطوى من حرفيّاتٍ صريحةٍ (اقترانُ `+` بينَ نصَّينِ وقالبٌ بلا فتحاتٍ) — لا يخمّن */
function foldStringLiteral(e: ts.Expression): string | null {
  const u = unwrap(e);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldStringLiteral(u.left);
    const r = foldStringLiteral(u.right);
    return l === null || r === null ? null : l + r;
  }
  return null;
}

/** محدِّدُ وحدةٍ لا يُقرأُ ساكنًا أو يحملُ شفرتَه في نفسِه */
function opaqueSpecifier(arg: ts.Expression | undefined): boolean {
  if (arg === undefined) return true;
  const e = unwrap(arg);
  if (!ts.isStringLiteralLike(e)) return true;
  return /^(data|blob|https?):/i.test(e.text);
}

/** إعلانُ التوقيعِ المحلولِ لنداءٍ إن كانَ في ملفِّ تعريفاتٍ (خارجَ شفرةِ البرنامجِ المرئيةِ) */
function libSignatureDecl(call: ts.CallExpression, checker: ts.TypeChecker): ts.Declaration | undefined {
  const decl = checker.getResolvedSignature(call)?.declaration;
  return decl !== undefined && decl.getSourceFile().isDeclarationFile ? decl : undefined;
}

/** نوعُ `require` العالميّ — يُحلُّ ويُقارَنُ بالنوعِ (لا بالاسمِ): الاستعارةُ تُرى بالنوعِ */
const requireTypeCache = new WeakMap<ts.TypeChecker, ts.Type>();
function globalRequireType(checker: ts.TypeChecker, at: ts.Node): ts.Type | null {
  const hit = requireTypeCache.get(checker);
  if (hit !== undefined) return hit;
  try {
    const sym = checker.resolveName("require", at, ts.SymbolFlags.Value, false);
    if (sym?.valueDeclaration !== undefined && sym.valueDeclaration.getSourceFile().isDeclarationFile) {
      const t = checker.getTypeOfSymbol(sym);
      requireTypeCache.set(checker, t);
      return t;
    }
  } catch {
    /* تظليلٌ محليٌّ أو تعذّرَ الحلُّ — يُعادُ السؤالُ من موضعٍ آخر */
  }
  return null;
}

/**
 * سببُ عدِّ العقدةِ شفرةً معتمةً — أو `null`. `couldBeJournal` حكمُ «يمكنُ أن يكونَ يوميّةً» نفسُه
 * الذي يقيسُ به نفيُ المنتِجِ المُستقبِلَ (اتجاها الإسناد · `any` · تحويلُ التحويل).
 */
export function opaqueCodeReason(n: ts.Node, checker: ts.TypeChecker, couldBeJournal: (e: ts.Expression) => boolean): string | null {
  // البابُ 1 — تسرّبُ اليوميّةِ إلى مُستدعًى لا يُرى جسمُه (باقٍ من الجولة التاسعة)
  if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.expression.kind !== ts.SyntaxKind.ImportKeyword && n.expression.kind !== ts.SyntaxKind.SuperKeyword && (n.arguments ?? []).some((a) => !ts.isSpreadElement(a) && couldBeJournal(a))) {
    const t = checker.getTypeAtLocation(n.expression);
    const name = checker.typeToString(t);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || name === "Function" || name === "FunctionConstructor") {
      return `يوميّةٌ تُمرَّرُ وسيطًا إلى مُستدعًى معتمٍ (${name}) — جسمُه لا يُرى`;
    }
  }
  // البابُ 2 — تحويلُ النصِّ شفرةً **بالآليةِ** (الجولةُ الحاديةَ عشرةَ)
  // (أ) الجسمُ غيرُ المرئي: مستدعًى نوعُه Function/FunctionConstructor
  if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.expression.kind !== ts.SyntaxKind.ImportKeyword && n.expression.kind !== ts.SyntaxKind.SuperKeyword) {
    const t = checker.getTypeAtLocation(n.expression);
    const name = checker.typeToString(t);
    if (name === "Function" || name === "FunctionConstructor") {
      return `مستدعًى من النوعِ ${name} — قيمةٌ دالّيّةٌ جسمُها خارجُ البرنامجِ المرئي`;
    }
  }
  if (ts.isCallExpression(n)) {
    // (ب) الجلبُ الانعكاسيّ بالتوقيعِ المحلولِ — لا بالاسمِ المنقّطِ
    const decl = libSignatureDecl(n, checker);
    if (decl !== undefined) {
      const sym = (decl as unknown as { symbol?: ts.Symbol }).symbol;
      const owner = (sym as unknown as { parent?: { name?: string } } | undefined)?.parent?.name ?? "";
      if (sym?.name === "get" && /Reflect/i.test(String(owner))) {
        return "انعكاسُ وصولٍ Reflect.get — يبلغُ أيَّ خاصّيّةٍ ومنها منشئَ الدالّةِ ولا يُقرأُ ساكنًا";
      }
      if (sym?.name === "getOwnPropertyDescriptor") {
        return "واصفُ خاصّيّةٍ Object.getOwnPropertyDescriptor — القيمةُ تُبلَغُ ديناميكيًّا فلا يُبرهَنُ غيابُ منشئِ الدالّةِ";
      }
      // (هـ) eval بالتوقيعِ المحلولِ — والاستعارةُ تُرى بالحلِّ لا بالاسمِ
      if (sym?.name === "eval") {
        return "«eval» مُحلَّلُ التوقيعِ — نصٌّ يصيرُ شفرةً في نطاقِهِ ولا يراها النفي";
      }
    }
    // (د) محمّلُ الوحداتِ: نداءٌ نوعُ مستدعاه هو نوعُ require العالميّ — الاستعارةُ تُرى بالنوعِ
    const reqType = globalRequireType(checker, n);
    if (reqType !== null && checker.getTypeAtLocation(n.expression) === reqType) {
      const a = n.arguments[0];
      if (a === undefined || opaqueSpecifier(a)) return "`require()` بمحدِّدٍ غيرِ حرفيّ";
      const lit = checker.getTypeAtLocation(a);
      if (lit.isStringLiteral() && CODE_MODULES.has(lit.value)) {
        return `وحدةُ تنفيذِ شفرةٍ «${lit.value}» عبرَ require — لا يُبرهَنُ غيابُ منتِجٍ معها`;
      }
    }
    // (ب) الاستيرادُ الديناميكيُّ الحرفيُّ لوحدةِ تنفيذِ شفرةٍ — كما في الجولةِ التاسعةِ
    if (n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (opaqueSpecifier(n.arguments[0])) {
        return "`import()` بمحدِّدٍ غيرِ حرفيٍّ أو حاملٍ شفرتَه (data:/blob:/http:)";
      }
      const spec = unwrap(n.arguments[0]!);
      if (ts.isStringLiteralLike(spec) && CODE_MODULES.has(spec.text)) {
        return `وحدةُ تنفيذِ شفرةٍ «${spec.text}» عبرَ import() — لا يُبرهَنُ غيابُ منتِجٍ معها`;
      }
    }
  }
  // (ج) الكائنُ العالميّ: فهرسٌ على مستقبلٍ نوعُه typeof globalThis — بالنوعِ لا بالاسمِ
  if (ts.isElementAccessExpression(n)) {
    let recv: ts.Expression = n.expression;
    for (;;) {
      const u = unwrap(recv);
      if (u === recv) break;
      recv = u;
    }
    if (checker.typeToString(checker.getTypeAtLocation(recv)) === "typeof globalThis") {
      return "فهرسٌ على الكائنِ العالميِّ (مباشرةً أو مستعارًا أو عابرًا للوحداتِ — يُرى بالنوعِ) — بابُ الوصولِ إلى منشئِ الدالّةِ والمخزونِ لا يُقرأُ ساكنًا";
    }
    // حرسٌ زائدٌ (لا برهان): مفاتيحُ أبوابِ النصِّ الحرفيّةُ والمطويّةُ — صيانةُ المستقبلِ المجهولِ النوعِ
    const key = unwrap(n.argumentExpression);
    if (ts.isStringLiteralLike(key) && ["constructor", "eval", "Function"].includes(key.text)) {
      return `فهرسُ «${key.text}» — بابُ منشئِ الدالّةِ من نصّ`;
    }
    const folded = foldStringLiteral(key);
    if (folded !== null && ["constructor", "eval", "Function"].includes(folded)) {
      return `مفتاحٌ محسوبٌ يطوي إلى «${folded}» — بابُ منشئِ الدالّةِ من نصّ`;
    }
  }
  // حرسٌ زائدٌ (لا برهان): خاصّيّةُ أبوابِ النصِّ بالاسمِ — صيانةُ المستقبلِ المجهولِ النوعِ
  if (ts.isPropertyAccessExpression(n) && ["constructor", "eval", "Function"].includes(n.name.text)) {
    return `خاصّيّةُ «${n.name.text}» — بابُ منشئِ الدالّةِ من نصّ`;
  }
  // استيرادُ وحداتِ الشفرةِ الثابتُ — كما هو
  if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteralLike(n.moduleSpecifier)) {
    const spec = n.moduleSpecifier.text;
    if (CODE_MODULES.has(spec) || /^(data|blob|https?):/i.test(spec)) return `وحدةُ تنفيذِ شفرةٍ «${spec}»`;
  }
  return null;
}
