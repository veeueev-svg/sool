/**
 * scripts/rehydrate_origin_model.ts — **نموذجُ أصلِ القيمةِ**: معجمُ الأصنافِ وأدواتُ
 * الشجرةِ الخالصةُ (المرحلة 39 · W-2026-040 · تفكيكُ سقفِ الوحدةِ في المعالجةِ الرابعةَ
 * عشرةَ: حدُّ القسمةِ **سلطةٌ لا حجم** — هذا الملفُ يملكُ *ما هو الأصلُ* و*أدواتِ قراءةِ
 * الشجرةِ التي لا تحتاجُ حالةً*، والماسحُ يملكُ *جمعَ التدفّقاتِ*، والعرّافُ يملكُ *السؤالَ*).
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * الصلاحيات (RULE-004): قراءةٌ صرفةٌ — لا حالةَ ولا كتابةَ ولا حكمَ
 */
import ts from "typescript";

/** أصنافُ الأصلِ — معجمٌ مغلقٌ لا ثالثَ ولا خامسَ */
export type OriginKind = "data" | "exec" | "opaque" | "global" | "door";
export interface ValueOrigin {
  readonly kind: OriginKind;
  readonly why: string;
}

export const DATA: ValueOrigin = { kind: "data", why: "" };
export const EXEC = (why: string): ValueOrigin => ({ kind: "exec", why });
export const OPAQUE = (why: string): ValueOrigin => ({ kind: "opaque", why });
export const GLOBAL: ValueOrigin = { kind: "global", why: "الكائنُ العالميُّ" };
export const DOOR = (why: string): ValueOrigin => ({ kind: "door", why });

/** أسماءُ رموزِ التنفيذِ العالميّةِ — وصولُها المباشرُ أو مرورُها قيمةً تنفيذٌ */
export const EXEC_GLOBAL_NAMES = new Set(["eval", "Function", "FunctionConstructor", "require"]);
/** مفاتيحُ أبوابِ النصِّ على الكائنِ العالميّ — مطويةً أو بالاسمِ */
export const GLOBAL_EXEC_KEYS = new Set(["eval", "Function", "constructor", "require"]);
/** مفاتيحُ البابِ الانعكاسيّةُ على كائناتِ الأبوابِ */
export const REFLECT_DOOR_KEYS = new Set(["get", "apply", "construct"]);
export const OBJECT_DOOR_KEYS = new Set(["getOwnPropertyDescriptor"]);
/** أعضاءُ الترامبولينِ — المستقبِلُ هو الفاعلُ لا العضوُ */
export const TRAMPOLINE_KEYS = new Set(["call", "apply", "bind"]);

/** اتحادُ الأصلينِ في مسارٍ واحدٍ: التنفيذُ يغلبُ ثمّ المعتمُ ثمّ العالميّةُ والبابُ */
export const EXEC_UNION = (a: ValueOrigin, b: ValueOrigin): ValueOrigin => {
  if (a.kind === "exec" || b.kind === "exec") return a.kind === "exec" ? a : b;
  if (a.kind === "opaque" || b.kind === "opaque") return a.kind === "opaque" ? a : b;
  if (a.kind === "global" || b.kind === "global") return a.kind === "global" ? a : b;
  if (a.kind === "door" || b.kind === "door") return a.kind === "door" ? a : b;
  return DATA;
};

/**
 * اتحادُ الإرجاعِ (المعالجةُ الرابعةَ عشرةَ): الإرجاعُ ينقلُ **التنفيذَ والعالميّةَ والبابَ** — أما
 * **المعتمُ** (معاملٌ `any`/`unknown` بلا برهانٍ) فلا يعبرُ حدودَ الدوالِّ: نقلهُ تحليلٌ بينيٌّ
 * عبرَ المعاملاتِ خارجُ هذا البندِ (دَينُ RC-07 المعلنِ) — والوجوهُ الحيّةُ على نمطِ «دالّةٌ
 * تُعيدُ معاملَها المجهولَ» (deepFreeze · requireText) تُخضَرّ كما كانت.
 */
export const RETURN_UNION = (a: ValueOrigin, b: ValueOrigin): ValueOrigin => {
  if (a.kind === "exec" || b.kind === "exec") return a.kind === "exec" ? a : b;
  if (a.kind === "global" || b.kind === "global") return a.kind === "global" ? a : b;
  if (a.kind === "door" || b.kind === "door") return a.kind === "door" ? a : b;
  return DATA;
};

/** فكُّ أغلفةِ القيمةِ: أقواسٌ · `as`/`satisfies` (تحويلُ النوعِ لا القيمةَ) · `!` · فاصلةٌ · انتظارٌ */
export function unwrapFlow(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isAwaitExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      cur = cur.right;
      continue;
    }
    return cur;
  }
}

/** المفتاحُ المحسوبُ يُطوى من حرفيّاتٍ صريحةٍ (اقترانُ `+` وقالبٌ بلا فتحاتٍ · رقمٌ حرفيٌّ — المعالجةُ الرابعةَ عشرةَ: `[eval][0]`) — لا يخمّن */
export function foldKey(e: ts.Expression): string | null {
  const u = unwrapFlow(e);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isNumericLiteral(u)) return u.text;
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldKey(u.left);
    const r = foldKey(u.right);
    return l === null || r === null ? null : l + r;
  }
  return null;
}

/** نصُّ اسمِ خاصّيّةٍ (معرّفٌ أو حرفيّ) — أو `null` للمحسوبِ */
export function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

/** مفتاحُ عنصرِ التفكيكِ: الاسمُ المعادُ تسميتُهُ أو الاسمُ نفسُهُ */
export function bindingElementKey(el: ts.BindingElement): string | null {
  if (el.propertyName !== undefined) return propertyNameText(el.propertyName);
  return ts.isIdentifier(el.name) ? el.name.text : null;
}

/** مُهيِّئُ عضوٍ في كائنٍ حرفيٍّ (معَ النشرِ المتتالي) — أو `undefined` إن غابَ */
export function objectLiteralMemberInitializer(obj: ts.ObjectLiteralExpression, key: string | null): ts.Expression | undefined {
  if (key === null) return undefined;
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propertyNameText(p.name) === key) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return p.name;
    if (ts.isSpreadAssignment(p)) {
      const u = unwrapFlow(p.expression);
      if (ts.isObjectLiteralExpression(u)) {
        const m = objectLiteralMemberInitializer(u, key);
        if (m !== undefined) return m;
      }
    }
  }
  return undefined;
}

/** عنصرُ مصفوفةٍ حرفيّةٍ بفهرسِهِ — أو `undefined` */
export function arrayLiteralElement(arr: ts.ArrayLiteralExpression, index: number): ts.Expression | undefined {
  const el = arr.elements[index];
  return el !== undefined && !ts.isOmittedExpression(el) && !ts.isSpreadElement(el) ? el : undefined;
}

/** تعبيراتُ `throw` داخلَ كتلةٍ — قناةُ `catch` (المعالجةُ الرابعةَ عشرةَ · عيب 4) */
export function collectThrows(block: ts.Block, out: ts.Expression[]): void {
  const visit = (n: ts.Node): void => {
    if (ts.isThrowStatement(n) && n.expression !== undefined) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  visit(block);
}

/** تعبيراتُ `return` في جسمِ دالّةٍ — بلا النزولِ إلى دالّةٍ متداخلةٍ (إرجاعُها لها) */
export function collectReturns(block: ts.Block, out: ts.Expression[]): void {
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) return;
    if (ts.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
    ts.forEachChild(n, visit);
  };
  visit(block);
}

/** دالّةٌ ذاتُ معاملاتٍ مسمّاةً — مواضعُ ندائِها تربطُ معاملاتِها بوسائطِها الفعليّةِ */
export function callableWithParams(d: ts.Declaration): d is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration {
  return ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d) || ts.isMethodDeclaration(d);
}

export function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** معرّفٌ رقميٌّ مستقرٌّ للرمزِ — مفاتيحُ خريطةِ تدفّقاتِ الخاصّيّةِ (لا هويةَ للرموزِ بينَ ملفّاتِ العرّافين) */
const symbolIDs = new WeakMap<ts.Symbol, number>();
let symbolSeq = 0;
export function symbolID(s: ts.Symbol): number {
  const hit = symbolIDs.get(s);
  if (hit !== undefined) return hit;
  const id = ++symbolSeq;
  symbolIDs.set(s, id);
  return id;
}

/**
 * وسيطاتُ النداءِ الفعّالةُ بعدَ فكِّ الترامبولين — للبابِ الأولِ (تسرّبُ اليوميّةِ وسيطًا).
 * (مُدارةٌ من `rehydrate_value_origin.ts` في تفكيكِ المعالجةِ الرابعةَ عشرةَ: دالةٌ خالصةٌ
 * على الشجرةِ لا تحتاجُ حالةَ العرّافِ)
 */
export function effectiveCallArguments(n: ts.CallExpression): readonly ts.Expression[] {
  const callee = unwrapFlow(n.expression);
  if (!ts.isPropertyAccessExpression(callee) || !TRAMPOLINE_KEYS.has(callee.name.text)) return n.arguments;
  if (callee.name.text === "call") return n.arguments.slice(1);
  if (callee.name.text === "bind") return n.arguments.slice(1);
  // apply: وسيطاتُ المصفوفةِ الحرفيّةِ تُفكُّ عنصرًا عنصرًا (المنشورُ يُعامَلُ وسيطًا واحدًا محتملَ يوميّة)
  const arr = n.arguments[1] !== undefined ? unwrapFlow(n.arguments[1]) : undefined;
  if (arr !== undefined && ts.isArrayLiteralExpression(arr)) return arr.elements;
  return n.arguments;
}

/**
 * بابُ الكائنِ العالميّ: مفاتيحُ التنفيذِ تُرفَضُ · المعروفةُ النوعَ تُخضَرّ · غيرُ المطويةِ
 * معتمةٌ. (مُدارةٌ من `rehydrate_value_origin.ts` في تفكيكِ المعالجةِ الرابعةَ عشرةَ: استعلامٌ
 * خالصٌ عن مدقّقِ الأنواعِ لا حالةَ للعرّافِ فيه)
 */
export function globalDoor(checker: ts.TypeChecker, key: string | null, n: ts.PropertyAccessExpression | ts.ElementAccessExpression): ValueOrigin {
  if (key !== null && GLOBAL_EXEC_KEYS.has(key)) return EXEC(`«globalThis['${key}']» — بابُ تنفيذٍ على الكائنِ العالميّ`);
  if (key === null) return OPAQUE("فهرسةٌ غيرُ مطويةٍ على الكائنِ العالميّ — لا يُبرهَنُ براءةُ المفتاح");
  const t = checker.getTypeAtLocation(n);
  if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
    return OPAQUE(`«globalThis['${key}']» — مفتاحٌ لا يُحَلُّ إلى قيمةٍ معروفةِ النوع`);
  }
  // سلسلةُ الكائنِ العالميّ وكائناتُ الأبوابِ تحفظُ بابَها عبرَ الخاصّيّةِ
  if (checker.typeToString(t) === "typeof globalThis") return GLOBAL;
  const s = checker.getSymbolAtLocation(n);
  const sd = s?.valueDeclaration;
  if (s !== undefined && sd !== undefined && sd.getSourceFile().isDeclarationFile) {
    if (s.name === "Reflect" || s.name === "Object") return DOOR(`«${s.name}» — كائنُ بابٍ انعكاسيّ`);
    if (s.name === "globalThis") return GLOBAL;
  }
  return DATA;
}

/** وحدةُ استيرادِ النطاقِ (`import * as ns`) — أو `undefined`. (مُدارةٌ من `rehydrate_value_origin.ts`: استعلامٌ خالصٌ) */
export function namespaceModuleOf(checker: ts.TypeChecker, base: ts.Expression): ts.Symbol | undefined {
  const u = unwrapFlow(base);
  if (!ts.isIdentifier(u)) return undefined;
  const s = checker.getSymbolAtLocation(u);
  if (s === undefined) return undefined;
  const decl = s.valueDeclaration ?? s.declarations?.[0];
  if (decl === undefined || !ts.isNamespaceImport(decl)) return undefined;
  try {
    return checker.getAliasedSymbol(s);
  } catch {
    return undefined;
  }
}
