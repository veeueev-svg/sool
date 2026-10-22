/**
 * scripts/rehydrate_opaque_code.ts — **الشفرةُ المعتمة**: ما لا يُبرهَنُ نفيُ المنتِجِ عليه (المرحلة 39 · W-2026-040 · الجولة 9)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عقدةٌ في شجرةِ نحوِ ملفٍّ من `src/**` ومدقّقُ أنواعِ البرنامج، ومسارُ ملفّ
 * المخرجات: سببٌ مقروءٌ إن كانت العقدةُ/الملفُّ **شفرةً لا يراها النفيُ** — أو `null`
 * التبعيات: مُترجمُ TypeScript وحدَه (حكمُ «يمكنُ أن يكونَ يوميّةً» يُحقَنُ من `rehydrate_producers.ts`)
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ ما يُطابِقُ هنا يُعَدُّ **منتِجًا ممكنًا** لكلِّ صنفٍ مُعفًى (`[RC-14]`)
 * اختبار القبول: tests/data/rehydrate_census_mutations_r9.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * ## العيبانِ اللذانِ أوجبا هذه الوحدة (محضر `docs/work/council/W-2026-040-5.json`)
 *
 *   - `RC07_DYNAMIC_PRODUCERS_UNSEEN` (grok §5-ج `FUNCTION_CTOR_EVAL_STRING_PRODUCER_GREENS_STATIC_GATE`):
 *     `new Function('j', 'j.record("archive_snapshot")')(j)` و`eval(…)` و`globalThis['Function']` و
 *     `import('data:…')` تكتبُ قيدَ صنفٍ مُعفًى بحجّةِ «لا منتِجَ له» وتجتازُ `tsc` والحاجزَ الساكن.
 *   - `JS_IN_SRC_UNSEEN_BY_CENSUS_SCAN` (grok §5-د): ملفُّ `.js` تحت `src/**` لا يدخلُ البرنامجَ النوعيَّ.
 *
 * ## العقدُ — من أين يُكتَبُ القيد؟
 *
 * اليوميّةُ لا يكتبُها إلا من **يملكُ مرجعًا إليها**. فنفيُ المنتِجِ برهانٌ على شفرةٍ **مرئيّةٍ** تملكُ
 * المرجع؛ وما يجعلُ الشفرةَ غيرَ مرئيّةٍ ثلاثةُ أبوابٍ — كلُّ بابٍ منها يُسقِطُ دعوى الغياب:
 *   1) **تسرّبُ اليوميّةِ إلى مُستدعًى معتم**: نداءٌ أو إنشاءٌ وسيطُه يمكنُ أن يكونَ يوميّةً ومُستدعاه
 *      نوعُه `any`/`unknown`/`Function`/`FunctionConstructor` — الجسمُ الذي يتلقّاها لا يُرى (يشملُ
 *      `new Function(…)(j)` و`m.default(j)` بعدَ `import()` أيًّا كان مصدرُ الشفرة).
 *   2) **تحويلُ النصِّ شفرةً**: `eval` (يرى النطاقَ المحليَّ فلا يحتاجُ وسيطًا) · `Function` اسمًا في
 *      موضعِ قيمة · خاصّيّةُ `constructor` (منشئُ الدالّةِ من أيِّ دالّة) · فهرسٌ محسوبٌ على الكائنِ
 *      العالميّ · `import()`/`require()` بمحدِّدٍ غيرِ حرفيٍّ أو `data:`/`blob:` · وحداتُ `vm`/`worker_threads`/`module`.
 *   3) **ملفُّ شفرةٍ غيرُ TypeScript** تحت `src/**` (`.js .mjs .cjs .jsx .tsx .mts .cts`) — النطاقُ
 *      المحصورُ `src/**` لا `src/**\/*.ts`، والبرنامجُ النوعيُّ لا يراه.
 *
 * **القياسُ قبلَ الكتابة** (الشجرةُ `5a38482`): لا شيءَ من الأبوابِ الثلاثةِ في `src/**` — 6 نداءاتٍ
 * مُستدعاها `any` ولا يوميّةَ في وسائطِها — فلا رفضَ كاذبًا على الحيّ.
 *
 * **حدٌّ معلَن:** يوميّةٌ تُخزَّنُ في حالةٍ عامّةٍ (`globalThis.x = j`) ثمّ تقرؤها شفرةٌ معتمةٌ من غيرِ وسيط —
 * الكتابةُ إلى الكائنِ العالميِّ بفهرسٍ حرفيٍّ لا تُسمّى هنا؛ والبابُ 2 يُسقِطُ كلَّ **قراءةٍ معتمةٍ** لها
 * (`eval`/`Function`/فهرسٌ محسوب)، فالمسلكُ المعروفُ مغلق، ومسلكٌ لم يُقَس يُسمّى حين يُقاس.
 */
import ts from 'typescript';

/** لواحقُ الشفرةِ التي ينفّذها Node أو يُحوّلها مُحوِّلٌ — وما ليس `.ts` منها لا يراه البرنامجُ النوعيّ */
export const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** ملفٌّ في `src/**` لا يدخلُ البرنامجَ النوعيَّ — فنفيُ المنتِجِ فيه لا يُبرهَن */
export function foreignCodeReason(file: string): string | null {
  return CODE_FILE.test(file) && !file.endsWith('.ts')
    ? 'ملفُّ شفرةٍ غيرُ TypeScript تحت src/** — لا يدخلُ البرنامجَ النوعيَّ فلا يُبرهَنُ نفيُ المنتِجِ فيه'
    : null;
}

const CODE_MODULES = new Set(['vm', 'node:vm', 'worker_threads', 'node:worker_threads', 'module', 'node:module']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);

const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)
    || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
  return cur;
};

/**
 * **الجولةُ السادسةُ** (grok `RC14_COMPUTED_CONSTRUCTOR_KEY_UNSEEN`): المفتاحُ المحسوبُ لا يُقرأُ
 * ساكنًا — إلا إن طُويَ من حرفيّاتٍ فيُعرفُ نصُّه (اقترانُ `+` بينَ نصَّينِ وقالبٌ بلا فتحاتٍ).
 * الطيُّ لا يخمّنُ: ما لم يُطوَ من حرفيّاتٍ صريحةٍ يبقى مجهولًا لا يؤيّدُ الغياب (قاعدةُ «المجهولُ لا يؤيّد»).
 */
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

/**
 * **الجولةُ السادسةُ** (grok `RC14_ALIASED_GLOBAL_COMPUTED_FUNCTION_UNSEEN`): الاسمُ المستعارُ
 * للكائنِ العالميّ (`const g = globalThis`) كان ينجو لأنّ الفحصَ يسألُ عن معرّفٍ من
 * `GLOBAL_OBJECTS` حرفًا. فصار الاسمُ يُحَلُّ إلى تعريفِهِ تعقيبيًّا (قائمةُ تعريفٍ واحدةً لا
 * اجتيازَ ملفٍّ): تعريفٌ بادئُهُ كائنٌ عالميٌّ أو اسمٌ يُحَلُّ كذلك — والوسيطُ الوحيدُ للوصولِ إلى
 * تعريفٍ غيرِ موجودٍ (معاملٌ · استيرادٌ · تعريفٌ خارجَ الملفِّ) هو «لا يُبرهَنُ العالميّة»
 * فتسقطُ الصيغةُ المسمّاةُ فقط لا كلَّ فهرسٍ محسوبٍ (الحدُّ المعلنُ في تقريرِ المعالجةِ العاشرة).
 */
function isGlobalObjectOrAlias(e: ts.Expression, checker: ts.TypeChecker): boolean {
  let cur: ts.Expression = unwrap(e);
  const seen = new Set<ts.VariableDeclaration>();
  for (;;) {
    if (!ts.isIdentifier(cur)) return false;
    if (GLOBAL_OBJECTS.has(cur.text)) return true;
    const decl = checker.getSymbolAtLocation(cur)?.valueDeclaration;
    if (decl === undefined || !ts.isVariableDeclaration(decl) || seen.has(decl)) return false;
    seen.add(decl);
    if (decl.initializer === undefined) return false;
    cur = unwrap(decl.initializer);
  }
}

/** هل المعرّفُ في موضعِ قيمةٍ (لا اسمَ نوعٍ ولا اسمَ إعلانٍ ولا اسمَ خاصّيّةٍ بعدَ نقطة) */
function isValueIdentifier(id: ts.Identifier): boolean {
  let p: ts.Node = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p)
    || ts.isPropertySignature(p) || ts.isMethodSignature(p)) && p.name === id) return false;
  if (ts.isQualifiedName(p) || ts.isImportSpecifier(p) || ts.isExportSpecifier(p)) return false;
  for (; p !== undefined && !ts.isSourceFile(p); p = p.parent) if (ts.isTypeNode(p)) return false;
  return true;
}

/** محدِّدُ وحدةٍ لا يُقرأُ ساكنًا أو يحملُ شفرتَه في نفسِه */
function opaqueSpecifier(arg: ts.Expression | undefined): boolean {
  if (arg === undefined) return true;
  const e = unwrap(arg);
  if (!ts.isStringLiteralLike(e)) return true;
  return /^(data|blob|https?):/i.test(e.text);
}

/**
 * سببُ عدِّ العقدةِ شفرةً معتمةً — أو `null`. `couldBeJournal` حكمُ «يمكنُ أن يكونَ يوميّةً» نفسُه
 * الذي يقيسُ به نفيُ المنتِجِ المُستقبِلَ (اتجاها الإسناد · `any` · تحويلُ التحويل).
 */
export function opaqueCodeReason(
  n: ts.Node, checker: ts.TypeChecker, couldBeJournal: (e: ts.Expression) => boolean,
): string | null {
  // البابُ 1 — تسرّبُ اليوميّةِ إلى مُستدعًى لا يُرى جسمُه
  if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && n.expression.kind !== ts.SyntaxKind.ImportKeyword
    && n.expression.kind !== ts.SyntaxKind.SuperKeyword && (n.arguments ?? []).some((a) => !ts.isSpreadElement(a) && couldBeJournal(a))) {
    const t = checker.getTypeAtLocation(n.expression);
    const name = checker.typeToString(t);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || name === 'Function' || name === 'FunctionConstructor') {
      return `يوميّةٌ تُمرَّرُ وسيطًا إلى مُستدعًى معتمٍ (${name}) — جسمُه لا يُرى`;
    }
  }
  // البابُ 2 — تحويلُ النصِّ شفرةً
  if (ts.isIdentifier(n) && (n.text === 'eval' || n.text === 'Function') && isValueIdentifier(n)) {
    return `«${n.text}» في موضعِ قيمة — نصٌّ يصيرُ شفرةً لا يراها النفي`;
  }
  if (ts.isPropertyAccessExpression(n) && ['constructor', 'eval', 'Function'].includes(n.name.text)) {
    return `خاصّيّةُ «${n.name.text}» — بابُ منشئِ الدالّةِ من نصّ`;
  }
  if (ts.isElementAccessExpression(n)) {
    const key = unwrap(n.argumentExpression);
    if (ts.isStringLiteralLike(key) && ['constructor', 'eval', 'Function'].includes(key.text)) {
      return `فهرسُ «${key.text}» — بابُ منشئِ الدالّةِ من نصّ`;
    }
    // **الجولةُ السادسةُ** (grok `RC14_COMPUTED_CONSTRUCTOR_KEY_UNSEEN`): مفتاحٌ محسوبٌ
    // يطوي إلى اسمِ بابِ الشفرةِ — `(() => 0)['constr'+'uctor']` لا يُقرأُ ساكنًا إلا بالطيّ.
    const folded = foldStringLiteral(key);
    if (folded !== null && ['constructor', 'eval', 'Function'].includes(folded)) {
      return `مفتاحٌ محسوبٌ يطوي إلى «${folded}» — بابُ منشئِ الدالّةِ من نصّ`;
    }
    const obj = unwrap(n.expression);
    // **الجولةُ السادسةُ** (grok `RC14_ALIASED_GLOBAL_COMPUTED_FUNCTION_UNSEEN`): الفهرسُ
    // المحسوبُ على اسمٍ يُحَلُّ إلى الكائنِ العالميّ — استعارُهُ كان ينجو.
    if (!ts.isStringLiteralLike(key) && !ts.isNumericLiteral(key) && ts.isIdentifier(obj)
      && isGlobalObjectOrAlias(obj, checker)) {
      return `فهرسٌ محسوبٌ على الكائنِ العالميِّ «${obj.text}» (مباشرةً أو مستعارًا) — يبلغُ منشئَ الدالّةِ ولا يُقرأُ ساكنًا`;
    }
  }
  // **الجولةُ السادسةُ** (grok `RC14_REFLECT_GET_FUNCTION_UNSEEN` · `RC14_DESCRIPTOR_FUNCTION_UNSEEN`):
  // الوصولُ الانعكاسيُّ يبلغُ أيَّ خاصّيّةٍ — ومنها منشئَ الدالّةِ — بلا قراءةٍ ساكنةٍ فلا يُبرهَنُ الغياب.
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && ts.isIdentifier(n.expression.expression)) {
    const obj = n.expression.expression.text;
    const prop = n.expression.name.text;
    if (obj === 'Reflect' && prop === 'get') {
      return 'انعكاسُ وصولٍ Reflect.get — يبلغُ أيَّ خاصّيّةٍ ومنها منشئَ الدالّةِ ولا يُقرأُ ساكنًا';
    }
    if (obj === 'Object' && prop === 'getOwnPropertyDescriptor') {
      return 'واصفُ خاصّيّةٍ Object.getOwnPropertyDescriptor — القيمةُ تُبلَغُ ديناميكيًّا فلا يُبرهَنُ غيابُ منشئِ الدالّةِ';
    }
  }
  if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
    if (opaqueSpecifier(n.arguments[0])) {
      return '`import()` بمحدِّدٍ غيرِ حرفيٍّ أو حاملٍ شفرتَه (data:/blob:/http:)';
    }
    // **الجولةُ السادسةُ** (grok `RC14_DYNAMIC_IMPORT_CODE_MODULE_UNSEEN`): الاستيرادُ الديناميكيُّ
    // الحرفيُّ لوحدةِ تنفيذِ شفرةٍ — `import('node:vm')` — كان ينجو لأنّ `require` والاستيرادَ
    // الساكنَ وحدَهما يُسألان. الوصولُ إلى وحدةِ الشفرةِ بابُ إنتاجٍ لا يُبرهَنُ غيابُه.
    const spec = unwrap(n.arguments[0]!);
    if (ts.isStringLiteralLike(spec) && CODE_MODULES.has(spec.text)) {
      return `وحدةُ تنفيذِ شفرةٍ «${spec.text}» عبرَ import() — لا يُبرهَنُ غيابُ منتِجٍ معها`;
    }
  }
  if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'require') {
    const a = n.arguments[0];
    if (opaqueSpecifier(a)) return '`require()` بمحدِّدٍ غيرِ حرفيّ';
    const spec = unwrap(a!);
    if (ts.isStringLiteralLike(spec) && CODE_MODULES.has(spec.text)) return `وحدةُ تنفيذِ شفرةٍ «${spec.text}»`;
  }
  if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined
    && ts.isStringLiteralLike(n.moduleSpecifier)) {
    const spec = n.moduleSpecifier.text;
    if (CODE_MODULES.has(spec) || /^(data|blob|https?):/i.test(spec)) return `وحدةُ تنفيذِ شفرةٍ «${spec}»`;
  }
  return null;
}
