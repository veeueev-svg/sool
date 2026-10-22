/**
 * مقيّمُ القيمةِ الثابتةِ — W-2026-040 (معالجةُ مجلسِ المراجعةِ الثالثة · الجلسة 153 · §2-ط).
 *
 * **العيبُ الذي يُعالَجُ من جذرِه** (`RC07_ARITHMETIC_COMPARE_FALSY_UNSEEN` وأشقّاؤه
 * `RC07_NUMBER_ZERO_AND_SKIPS_CENSUS` · `RC07_UNARY_PLUS_STRING_ZERO_SKIPS_CENSUS` ·
 * `RC07_BOOLEAN_ZERO_SKIPS_CENSUS` · `RC07_NUMBER_NAN_SKIPS_CENSUS`): كان الحكمُ بثباتِ
 * الكذبِ قائمةَ صيغٍ (`0` و`-0` و`0n` و`BigInt(0)`…) فكلُّ صيغةٍ لم تُسمَّ — `1 - 1` و
 * `0 === 1` و`Number(0)` و`+'0'` و`Boolean(0)` و`Number.NaN` — تُعَدُّ قابلةً للصدق.
 *
 * **العلاجُ:** القيمةُ **تُحسَبُ** بدلالةِ اللغةِ نفسِها لا تُقرأُ من شكلٍ: الحرفيّاتُ
 * الأوّليّةُ، والبادئاتُ (`! - + ~ typeof void`)، والثنائيّاتُ الحسابيّةُ والمقارنةُ
 * والبتّيّةُ والقصرُ والعدميُّ والفاصلةُ، والشرطيُّ، والتحويلاتُ العالميّةُ
 * (`Number`/`Boolean`/`String`/`BigInt`) وثوابتُ `Number.*` و`NaN`/`Infinity`/`undefined`
 * — بشرطِ أن لا يكونَ الاسمُ العالميُّ مظلَّلًا بربطٍ **نطاقُه يحوي الاستعمال** (متغيّرٍ أو وسيطٍ
 * أو استيرادٍ أو دالّةٍ أو صنفٍ — الجولةُ التاسعة: معجميًّا لا «في الملفّ»). والحسابُ يُجريه محرّكُ JavaScript نفسُه على القيمِ
 * المستخرجةِ فلا يُعادُ تعريفُ الدلالة.
 *
 * **حدٌّ معلَنٌ:** ما لا يُحسَبُ (نداءٌ غيرُ ما سُمّي، مرجعٌ، خاصّيّةٌ غيرُ ثابتة) يُعادُ
 * `null` — «لا أعلم». وهذا الحدُّ **لا يُؤيّدُ السيادة**: حارسُ نداءِ الحصرِ ذرّةٌ تُطابَقُ
 * بحرّاسِ الإرجاعِ (`guardsOf`)، فما لا يُحسَبُ لا يُسقِطُ الحارسَ — يبقى ذرّةً لا تُطابِقُ.
 */
import ts from 'typescript';

/** قيمةٌ مركّبةٌ (كائنٌ/مصفوفةٌ/دالّةٌ): صادقةٌ دائمًا وغيرُ معدومةٍ — ولا تدخلُ حسابًا */
const OBJECT = Symbol('object');
export type Constant = { readonly value: unknown };

const NUMBER_CONSTANTS: Record<string, number> = {
  NaN: Number.NaN, POSITIVE_INFINITY: Infinity, NEGATIVE_INFINITY: -Infinity,
  MAX_VALUE: Number.MAX_VALUE, MIN_VALUE: Number.MIN_VALUE, EPSILON: Number.EPSILON,
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
};
const GLOBAL_VALUES: Record<string, unknown> = { undefined, NaN: Number.NaN, Infinity };
const CONVERTERS: Record<string, (v: unknown) => unknown> = {
  Number: (v) => Number(v), Boolean: (v) => Boolean(v), String: (v) => String(v),
  BigInt: (v) => BigInt(v as string | number | bigint | boolean),
};

const declaredCache = new WeakMap<ts.SourceFile, Map<string, ts.Node[]>>();

/** أقربُ حاوٍ كتليٍّ (كتلةٌ · بندُ تبديلٍ · وحدةٌ · ملفّ) — نطاقُ `let`/`const`/الدالّةِ والصنفِ المعلَنَين */
function blockContainer(n: ts.Node): ts.Node {
  let cur: ts.Node = n;
  while (cur.parent !== undefined) {
    const p = cur.parent;
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseBlock(p) || ts.isModuleBlock(p)) return p;
    cur = p;
  }
  return cur;
}

/** أقربُ دالّةٍ أو ملفٍّ — نطاقُ `var` */
function functionContainer(n: ts.Node): ts.Node {
  let cur: ts.Node = n;
  while (cur.parent !== undefined) {
    const p = cur.parent;
    if (ts.isFunctionLike(p) || ts.isSourceFile(p) || ts.isModuleBlock(p)) return p;
    cur = p;
  }
  return cur;
}

/** نطاقُ الربطِ المعجميِّ لإعلانِ اسمٍ — كما تحلُّه اللغةُ نفسُها (أو `null` إن لم يكن الإعلانُ ربطًا) */
function bindingScope(n: ts.Node): ts.Node | null {
  let owner: ts.Node = n;
  while (ts.isBindingElement(owner) || ts.isObjectBindingPattern(owner) || ts.isArrayBindingPattern(owner)) owner = owner.parent;
  if (ts.isParameter(owner)) return owner.parent;
  if (ts.isVariableDeclaration(owner)) {
    if (ts.isCatchClause(owner.parent)) return owner.parent;
    const list = owner.parent;
    if (!ts.isVariableDeclarationList(list)) return null;
    if ((list.flags & ts.NodeFlags.BlockScoped) === 0) return functionContainer(list);
    const holder = list.parent;
    return ts.isForStatement(holder) || ts.isForOfStatement(holder) || ts.isForInStatement(holder) ? holder : blockContainer(list);
  }
  if (ts.isFunctionExpression(owner) || ts.isClassExpression(owner)) return owner; // اسمُها يُرى في جسمِها وحدَه
  if (ts.isFunctionDeclaration(owner) || ts.isClassDeclaration(owner) || ts.isEnumDeclaration(owner)
    || ts.isModuleDeclaration(owner)) return blockContainer(owner);
  if (ts.isImportSpecifier(owner) || ts.isImportClause(owner) || ts.isNamespaceImport(owner)
    || ts.isImportEqualsDeclaration(owner)) return owner.getSourceFile();
  return null;
}

/**
 * كلُّ ربطٍ في الملفِّ باسمِه ونطاقِه المعجميّ. **الجولةُ التاسعة** (gpt `RC07_SHADOWED_NAN_SCOPE_FALSE_REJECT`):
 * كان «اسمٌ مُعرَّفٌ في أيِّ موضعٍ من الملفّ» — فدالّةٌ أخرى تُظلِّلُ `NaN` في جسمِها وحدَه تجعلُ `NaN`
 * العالميَّ في `bootstrapState` «مجهولًا»، فيُرفَضُ وجهٌ حيٌّ. والآن الربطُ لا يُظلِّلُ إلا ما في نطاقِه.
 */
function bindings(sf: ts.SourceFile): Map<string, ts.Node[]> {
  const hit = declaredCache.get(sf);
  if (hit) return hit;
  const out = new Map<string, ts.Node[]>();
  const visit = (n: ts.Node): void => {
    const named = n as ts.Node & { name?: ts.Node };
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)
      || ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isImportSpecifier(n) || ts.isImportClause(n)
      || ts.isNamespaceImport(n) || ts.isBindingElement(n) || ts.isEnumDeclaration(n)
      || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n))
      && named.name && ts.isIdentifier(named.name)) {
      // ربطٌ لا يُعرَفُ نطاقُه يُعَدُّ مُظلِّلًا للملفِّ كلِّه — المجهولُ لا يُجعَلُ عالميًّا
      const scope = bindingScope(n) ?? sf;
      out.set(named.name.text, [...(out.get(named.name.text) ?? []), scope]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  declaredCache.set(sf, out);
  return out;
}

/**
 * يُصدَّر ليَسألَ برهانُ الوصولِ عن التظليلِ قبلَ أن يَعُدَّ `NaN`/`undefined` العالميَّينِ ثابتَي
 * الكذبِ/المعدوميّةِ (الجولةُ الثامنة). **والجولةُ التاسعة**: السؤالُ معجميٌّ — هل في نطاقٍ يحوي هذا
 * الاستعمالَ ربطٌ بهذا الاسم؟ لا «هل في الملفِّ إعلانٌ به».
 */
export function isGlobal(id: ts.Identifier): boolean {
  const sf = id.getSourceFile();
  if (sf === undefined) return false;
  return !(bindings(sf).get(id.text) ?? []).some((scope) => withinNode(id, scope));
}

/**
 * **الجولةُ السادسةُ** (gpt `RC07_COUNTERFEIT_COMPUTED_CALLEE_GREENS`): هل يحلُّ المعرّفُ
 * إلى **استيرادِهِ** لا إلى تظليلٍ أقربَ؟ حَلُّ اللغةِ نفسِهِ: أضيقُ نطاقِ ربطٍ يحوي الاستعمالَ
 * هو صاحبُ الاسمِ — ونطاقُ الاستيرادِ الملفُّ كلُّهُ (الأوسعُ). فإن كان الأضيقُ نطاقًا غيرَ
 * الملفِّ فالتظليلُ قائمٌ والاسمُ ليسَ للاستيرادِ. وما لا ربطَ لهُ أصلًا ليسَ استيرادًا.
 */
export function resolvesToImportBinding(id: ts.Identifier): boolean {
  const sf = id.getSourceFile();
  if (sf === undefined) return false;
  const scopes = (bindings(sf).get(id.text) ?? []).filter((s) => withinNode(id, s));
  if (scopes.length === 0) return false;
  const innermost = scopes.reduce((a, b) => (b.pos >= a.pos && b.end <= a.end ? b : a));
  return innermost === sf;
}

/**
 * **الجولةُ الثامنة:** ثابتٌ محليٌّ بمُبدِّعٍ معلومِ القيمةِ — قيمتُه تُحسَبُ لا تُجهَل.
 * فالمعرّفُ المظلَّلَ بربطٍ محليٍّ ليس مجهولًا أصلًا إذا كان إعلانُه `const` بمبدِّعٍ حرفيٍّ
 * لا يرمي ولا يرجعُ إلى نفسِه (رابطُ قيمةٍ لا حالة) — وإلا فالرفضُ الكاذبُ يعودُ من هذهِ
 * الجهةِ (`const NaN = 1` ثمّ `NaN && …` حيٌّ يُنفَّذُ ولا يُعلَمُ صدقُه ساكنًا).
 */
function localConstValue(id: ts.Identifier): Constant | null {
  const sf = id.getSourceFile();
  if (sf === undefined) return null;
  const found: { decl?: ts.VariableDeclaration } = {}; // حاملٌ لا يُضيِّقُه تحليلُ التدفّقِ داخلَ الإغلاق
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === id.text
      && n.initializer !== undefined
      && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const) !== 0) {
      // أقربُ إعلانٍ نطاقُه يحوي الاستعمال — كحلِّ الاسمِ في اللغةِ نفسِها
      const scope = declarationScopeOf(n);
      const cur = found.decl;
      if (withinNode(id, scope) && (cur === undefined || n.pos > cur.pos)) found.decl = n;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const best = found.decl;
  if (best === undefined || best.initializer === undefined) return null;
  const init = unwrap(best.initializer);
  if (referencesName(init, id.text)) return null; // إسنادٌ راجعٌ — لا قيمةَ معلومةً
  return evaluate(init);
}

/** نطاقُ التعريف: أقربُ كتلةٍ أو ملفٍّ يحويه */
function declarationScopeOf(d: ts.VariableDeclaration): ts.Node {
  let cur: ts.Node = d;
  while (cur.parent !== undefined) {
    const p = cur.parent;
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseBlock(p) || ts.isModuleBlock(p)) return p;
    cur = p;
  }
  return cur;
}

function withinNode(inner: ts.Node, outer: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/** هل يرجعُ التعبيرُ إلى الاسمِ نفسِه؟ (إسنادٌ راجعٌ لا قيمةَ له) */
function referencesName(e: ts.Node, name: string): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name) found = true;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(e);
  return found;
}

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)
      || ts.isTypeAssertionExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    else return cur;
  }
}

const isObj = (v: unknown): boolean => v === OBJECT;

/** القيمةُ الثابتةُ للتعبيرِ إن حُسِبت — وإلا `null` («لا أعلم») */
export function constantOf(expr: ts.Expression | undefined): Constant | null {
  if (expr === undefined) return null;
  try {
    return evaluate(unwrap(expr));
  } catch {
    return null; // حسابٌ يرمي (BigInt(0.5) مثلًا) — لا قيمةَ ثابتة
  }
}

function evaluate(e: ts.Expression): Constant | null {
  const k = e.kind;
  if (k === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (k === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (k === ts.SyntaxKind.NullKeyword) return { value: null };
  if (ts.isNumericLiteral(e)) return { value: Number(e.text) };
  if (ts.isBigIntLiteral(e)) return { value: BigInt(e.text.slice(0, -1)) };
  if (ts.isStringLiteralLike(e)) return { value: e.text };
  if (ts.isArrayLiteralExpression(e) || ts.isObjectLiteralExpression(e) || ts.isArrowFunction(e)
    || ts.isFunctionExpression(e) || ts.isClassExpression(e) || ts.isRegularExpressionLiteral(e)) {
    return { value: OBJECT };
  }
  if (ts.isIdentifier(e)) {
    if (e.text in GLOBAL_VALUES && isGlobal(e)) return { value: GLOBAL_VALUES[e.text] };
    return localConstValue(e); // ثابتٌ محليٌّ حرفيُّ القيمة — يُحسَب (الجولةُ الثامنة)
  }
  if (ts.isVoidExpression(e)) return { value: undefined };
  if (ts.isPropertyAccessExpression(e)) {
    const obj = unwrap(e.expression);
    if (ts.isIdentifier(obj) && obj.text === 'Number' && isGlobal(obj)
      && e.name.text in NUMBER_CONSTANTS) return { value: NUMBER_CONSTANTS[e.name.text] };
    if (e.name.text === 'length') {
      const o = evaluate(obj);
      if (o && typeof o.value === 'string') return { value: o.value.length };
    }
    return null;
  }
  if (ts.isTypeOfExpression(e)) {
    const o = constantOf(e.expression);
    // المركّبُ «object» أو «function» بحسبِ صنفِه — لا يُحسَبُ ولا يُخمَّن
    if (!o || isObj(o.value)) return null;
    return { value: typeof o.value };
  }
  if (ts.isPrefixUnaryExpression(e)) {
    const o = constantOf(e.operand);
    if (!o) return null;
    if (e.operator === ts.SyntaxKind.ExclamationToken) return { value: !o.value };
    if (isObj(o.value)) return null;
    const v = o.value as number;
    switch (e.operator) {
      case ts.SyntaxKind.MinusToken: return { value: -v };
      case ts.SyntaxKind.PlusToken: return { value: +v };
      case ts.SyntaxKind.TildeToken: return { value: ~v };
      default: return null; // ++/-- كتابةٌ لا قيمة
    }
  }
  if (ts.isConditionalExpression(e)) {
    const c = constantOf(e.condition);
    if (!c) return null;
    return constantOf(c.value ? e.whenTrue : e.whenFalse);
  }
  if (ts.isCallExpression(e)) {
    const callee = unwrap(e.expression);
    if (!ts.isIdentifier(callee) || !(callee.text in CONVERTERS) || !isGlobal(callee)) return null;
    if (e.arguments.length === 0) {
      const empty: Record<string, unknown> = { Number: 0, Boolean: false, String: '' };
      return callee.text in empty ? { value: empty[callee.text] } : null;
    }
    const arg = e.arguments[0];
    const convert = CONVERTERS[callee.text];
    if (arg === undefined || convert === undefined || ts.isSpreadElement(arg)) return null;
    const a = constantOf(arg);
    if (!a) return null;
    if (isObj(a.value)) return callee.text === 'Boolean' ? { value: true } : null;
    return { value: convert(a.value) };
  }
  if (ts.isBinaryExpression(e)) return binary(e);
  return null;
}

function binary(e: ts.BinaryExpression): Constant | null {
  const op = e.operatorToken.kind;
  const S = ts.SyntaxKind;
  // القصرُ والعدميُّ والفاصلة: يكفي أحيانًا طرفٌ واحدٌ — ودلالتُها دلالةُ اللغة
  if (op === S.CommaToken) return constantOf(e.right);
  const l = constantOf(e.left);
  if (op === S.AmpersandAmpersandToken) return l ? (l.value ? constantOf(e.right) : l) : null;
  if (op === S.BarBarToken) return l ? (l.value ? l : constantOf(e.right)) : null;
  if (op === S.QuestionQuestionToken) {
    return l ? (l.value === null || l.value === undefined ? constantOf(e.right) : l) : null;
  }
  const r = constantOf(e.right);
  if (!l || !r) return null;
  if (isObj(l.value) || isObj(r.value)) {
    // هويّةُ مركّبين حرفيّين مختلفين — `[] === []` كاذبٌ قطعًا؛ وما سواه لا يُحسَب
    if (op === S.EqualsEqualsEqualsToken) return { value: false };
    if (op === S.ExclamationEqualsEqualsToken) return { value: true };
    return null;
  }
  const a = l.value as never;
  const b = r.value as never;
  switch (op) {
    case S.PlusToken: return { value: (a as number) + (b as number) };
    case S.MinusToken: return { value: a - b };
    case S.AsteriskToken: return { value: a * b };
    case S.SlashToken: return { value: a / b };
    case S.PercentToken: return { value: a % b };
    case S.AsteriskAsteriskToken: return { value: (a as number) ** (b as number) };
    case S.EqualsEqualsEqualsToken: return { value: a === b };
    case S.ExclamationEqualsEqualsToken: return { value: a !== b };
    // eslint-disable-next-line eqeqeq
    case S.EqualsEqualsToken: return { value: a == b };
    // eslint-disable-next-line eqeqeq
    case S.ExclamationEqualsToken: return { value: a != b };
    case S.LessThanToken: return { value: a < b };
    case S.GreaterThanToken: return { value: a > b };
    case S.LessThanEqualsToken: return { value: a <= b };
    case S.GreaterThanEqualsToken: return { value: a >= b };
    case S.AmpersandToken: return { value: a & b };
    case S.BarToken: return { value: a | b };
    case S.CaretToken: return { value: a ^ b };
    case S.LessThanLessThanToken: return { value: a << b };
    case S.GreaterThanGreaterThanToken: return { value: a >> b };
    case S.GreaterThanGreaterThanGreaterThanToken: return { value: (a as number) >>> (b as number) };
    default: return null;
  }
}

/** كاذبٌ قطعًا / صادقٌ قطعًا / معدومٌ قطعًا / غيرُ معدومٍ قطعًا — من القيمةِ المحسوبة */
export const computedFalsy = (e: ts.Expression | undefined): boolean => {
  const c = constantOf(e);
  return c !== null && !isObj(c.value) && !c.value;
};
export const computedTruthy = (e: ts.Expression | undefined): boolean => {
  const c = constantOf(e);
  return c !== null && (isObj(c.value) || !!c.value);
};
export const computedNullish = (e: ts.Expression | undefined): boolean => {
  const c = constantOf(e);
  return c !== null && (c.value === null || c.value === undefined);
};
export const computedNotNullish = (e: ts.Expression | undefined): boolean => {
  const c = constantOf(e);
  return c !== null && c.value !== null && c.value !== undefined;
};
/**
 * القيمةُ الأوّليّةُ لمقارنةِ `case` — **مغلّفةً** لا عاريةً: عددٌ أو نصٌّ أو BigInt أو منطقيٌّ أو
 * معدوم. **الجولةُ التاسعة** (grok `RC07_BIGINT_SWITCH_DEAD_DEFAULT_GREENS`): كانت تُردُّ `string|number`
 * فقط فحرفيُّ BigInt «لا قيمةَ له» ولا يُقطَعُ بـ`default` مطابقٍ ولا `case` مخالف. والغلافُ يفصلُ
 * «لا أعلم» (`null`) عن القيمةِ `null` نفسِها؛ والمقارنةُ `===` كالتبديلِ في اللغة.
 */
export function computedLiteral(e: ts.Expression | undefined): Constant | null {
  const c = constantOf(e);
  return c !== null && !isObj(c.value) && typeof c.value !== 'symbol' ? c : null;
}
