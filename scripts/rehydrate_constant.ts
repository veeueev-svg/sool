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
 * — بشرطِ أن لا يكونَ الاسمُ العالميُّ مظلَّلًا بتعريفٍ في الملفِّ (أيِّ تعريفٍ: متغيّرٍ أو
 * وسيطٍ أو استيرادٍ أو دالّةٍ أو صنفٍ). والحسابُ يُجريه محرّكُ JavaScript نفسُه على القيمِ
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

const declaredCache = new WeakMap<ts.SourceFile, Set<string>>();
/** كلُّ اسمٍ مُعرَّفٍ في الملفِّ بأيِّ صورةٍ — فالاسمُ العالميُّ المظلَّلُ لا يُحسَب */
function declaredNames(sf: ts.SourceFile): Set<string> {
  const hit = declaredCache.get(sf);
  if (hit) return hit;
  const out = new Set<string>();
  const visit = (n: ts.Node): void => {
    const named = n as ts.Node & { name?: ts.Node };
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n)
      || ts.isClassDeclaration(n) || ts.isImportSpecifier(n) || ts.isImportClause(n)
      || ts.isNamespaceImport(n) || ts.isBindingElement(n) || ts.isEnumDeclaration(n)
      || ts.isModuleDeclaration(n) || ts.isImportEqualsDeclaration(n))
      && named.name && ts.isIdentifier(named.name)) out.add(named.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  declaredCache.set(sf, out);
  return out;
}

function isGlobal(id: ts.Identifier): boolean {
  const sf = id.getSourceFile();
  return sf !== undefined && !declaredNames(sf).has(id.text);
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
    return e.text in GLOBAL_VALUES && isGlobal(e) ? { value: GLOBAL_VALUES[e.text] } : null;
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
/** القيمةُ الحرفيّةُ لمقارنةِ `case` — عددٌ أو نصٌّ محسوب */
export function computedLiteral(e: ts.Expression | undefined): string | number | null {
  const c = constantOf(e);
  return c !== null && (typeof c.value === 'string' || typeof c.value === 'number') ? c.value : null;
}
