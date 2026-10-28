/**
 * اشتقاقاتُ القيمةِ من أبوابِها وفروعِها — الطبقةُ الثالثةُ من منظوراتِ القيمةِ
 * (W-2026-040 · المعالجةُ السادسةُ عشرةَ). فُصلت عنِ العرّافِ (`rehydrate_value_origin.ts`)
 * لحدِّ حجمِ الوحدةِ (سقفُ 400 سطرًا · `scripts/check_module_size.sh`) — والفصلُ طبقةٌ
 * لا تغييرَ سلوكٍ: نصوصٌ محفوظةٌ بأسطرِها حرفيًّا، والاستدعاءُ من موضعِهِ.
 *
 * تسألُ هذهِ الوحدةُ فروعَ الاشتقاقِ الخمسةَ: قراءةُ العضوِ على أساسِ تنفيذٍ أو بابٍ ·
 * قيمةُ دمجِ `Object.assign` · قيمةُ أبوابِ الاشتقاقِ القيميِّ (values · entries…) ·
 * والاشتقاقُ المجهولُ على منظورٍ يحملُ غيرَ البياناتِ (وسائطُهُ تُسألُ أيضًا).
 */
import ts from "typescript";
import { DATA, EXEC, EXEC_UNION, OBJECT_DOOR_KEYS, OPAQUE, REFLECT_DOOR_KEYS, RETURN_UNION, collectReturns, unwrapFlow } from "./rehydrate_origin_model";
import type { ValueOrigin } from "./rehydrate_origin_model";
import { arrayViewElements, materializeViews, resolvesToAssignMerge, viewMemberExpressions, viewMemberMethod, namespaceViewExportDecl } from "./rehydrate_value_views";

/** أبوابُ الاشتقاقِ القيميِّ — نداءٌ عليها يُسألُ عن مادّةِ حججِهِ (المعالجةُ السادسةُ عشرةَ) */
const DOOR_VALUE_DERIVATION_KEYS = new Set(["values", "entries", "keys", "fromEntries", "create", "assign", "getOwnPropertyNames", "getOwnPropertySymbols", "groupBy"]);
import type { ViewContext } from "./rehydrate_value_views";
import { viewAllMemberOrigins } from "./rehydrate_value_probes";
import type { OriginAsk } from "./rehydrate_value_probes";

/** قراءةُ عضوٍ على أساسِ تنفيذٍ — النصُّ محفوظٌ من `propOrigin` بأسطرِهِ (فصلٌ لا إصلاحٌ) */
export function execBasePropOrigin(n: ts.PropertyAccessExpression | ts.ElementAccessExpression, key: string | null, baseOrigin: ValueOrigin, checker: ts.TypeChecker): ValueOrigin {
    // «require.main» فحصُ الوحدةِ الرئيسةِ بياناتٌ لا تنفيذٌ — استثناءٌ معلَنٌ لا تعميمٌ
    const baseU2 = unwrapFlow(n.expression);
    if (ts.isIdentifier(baseU2) && baseU2.text === "require" && key === "main") return DATA;
    // المعالجةُ السادسةُ عشرةَ (جلسةُ grok — الرفضُ الكاذبُ): قراءةُ خاصّيّةٍ على رمزِ تنفيذٍ ليستْ نداءً —
    // القيمةُ تُسألُ من نوعِها: البروتوتيبُ خاملٌ بياناتٌ · والحاملُ للنداءِ (المنشئُ والمجهولُ) تنفيذٌ —
    // فالقراءةُ البريئةُ تخضرُّ والقناةُ الترامبولينيّةُ (`Function.prototype.call`) تُقبَضُ.
    if (key === "prototype") return DATA;
    if (key === "constructor") return baseOrigin;
    // عنصرٌ رقميٌّ من قيمةِ تنفيذٍ — العنصرُ نفسُهُ قد يكونُ حاملَ التنفيذِ (أزواجُ entries) فلا يُغسَلُ
    if (ts.isElementAccessExpression(n) && key !== null && /^\d+$/.test(key)) return baseOrigin;
    const t = checker.getTypeAtLocation(n);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return baseOrigin;
    if (t.getCallSignatures().length > 0 || t.getConstructSignatures().length > 0) {
      return EXEC(`عضوٌ حاملٌ للنداءِ على رمزِ تنفيذٍ («${key}») — قيمتُهُ تُستدعى فتنفيذٌ`);
    }
    return DATA;
}

/** قراءةُ عضوٍ على أساسِ بابٍ — كائنُ العالمِ أو أبوابُهُ الانعكاسيّةُ */
export function doorBasePropOrigin(n: ts.PropertyAccessExpression | ts.ElementAccessExpression, key: string | null, checker: ts.TypeChecker): ValueOrigin {
    const baseU = unwrapFlow(n.expression);
    const name = ts.isIdentifier(baseU) ? baseU.text : "";
    if (name === "Reflect" && key !== null && REFLECT_DOOR_KEYS.has(key)) return EXEC(`«Reflect.${key}» — بابٌ انعكاسيّ`);
    if (name === "Object" && key !== null && OBJECT_DOOR_KEYS.has(key)) return EXEC("«Object.getOwnPropertyDescriptor» — واصفٌ يبلغُ القيمةَ ديناميكيًّا");
    return DATA;
}

/** قيمةُ دمجِ `Object.assign` — اتحادُ مادّةِ حججِهِ كلِّها */
export function assignMergeValue(n: ts.CallExpression, ctx: ViewContext, ask: OriginAsk): ValueOrigin {
  // المعالجةُ السادسةُ عشرةَ: دمجُ `Object.assign` برمزِهِ — الكنيّةُ والمرجعُ المارُّ يُعامَلانِ دمجًا
  // فقيمتُهُ اتحادُ مادّةِ حججِهِ كلِّها (الجولتانِ 11: gpt · grok · gemini)
    let acc: ValueOrigin = DATA;
    for (const a of n.arguments) for (const v of materializeViews(a, ctx)) acc = EXEC_UNION(acc, viewAllMemberOrigins(v, ctx, ask));
    return acc;
}

/** قيمةُ بابِ اشتقاقٍ قيميٍّ — أو `null` إن لم يكنِ النداءُ بابَ اشتقاقٍ */
export function doorDerivationValue(n: ts.CallExpression, callee: ts.PropertyAccessExpression, ctx: ViewContext, ask: OriginAsk, originOf: (e: ts.Expression) => ValueOrigin): ValueOrigin | null {
  // المعالجةُ السادسةُ عشرةَ: أبوابُ الاشتقاقِ القيميِّ — نداءٌ على كائنِ بابٍ يُستخرَجُ أعضاءُ حججِهِ
  // (values · entries · keys · fromEntries · create · from) — القيمةُ من مادّةِ الحججِ لا من شكلِ النداءِ
    const key = callee.name.text;
    const baseOrigin = originOf(callee.expression);
    if ((baseOrigin.kind === "door" || baseOrigin.kind === "global") && DOOR_VALUE_DERIVATION_KEYS.has(key)) {
      let acc: ValueOrigin = DATA;
      for (const a of n.arguments) for (const v of materializeViews(a, ctx)) acc = EXEC_UNION(acc, viewAllMemberOrigins(v, ctx, ask));
      if (acc.kind !== "data") return acc;
      return DATA;
    }
  return null;
}

/** الاشتقاقُ المجهولُ على منظوراتِ الأساسِ — النصُّ محفوظٌ بأسطرِهِ (فصلٌ لا إصلاحٌ) */
export function unknownDerivationOnViews(callee: ts.PropertyAccessExpression, ctx: ViewContext, ask: OriginAsk, originInFile: (e: ts.Expression) => ValueOrigin, callArgVisiting: Set<ts.CallExpression>): ValueOrigin | null {
  const key = callee.name.text;
  const views = materializeViews(callee.expression, ctx);
  let acc: ValueOrigin | null = null;
  for (const v of views) {
    if (v.kind === "unknown") return OPAQUE("اشتقاقٌ على منظورٍ غيرِ مرئيٍّ — لا يُبرهَنُ براءةُ القيمة");
    if (v.kind === "class" || v.kind === "namespace") continue;
    if (viewMemberExpressions(v, key, ctx).length > 0) return null; // المنهجُ مرئيٌّ — سؤالُهُ محلولٌ
    if (viewMemberMethod(v, key, ctx) !== undefined) return null;
    if (namespaceViewExportDecl(v, key, ctx) !== undefined) return null;
    const contents = viewAllMemberOrigins(v, ctx, ask);
    if (contents.kind !== "data") acc = acc === null ? contents : EXEC_UNION(acc, contents);
  }
  if (acc !== null) return OPAQUE("اشتقاقٌ معياريٌّ على منظورٍ يحملُ غيرَ البياناتِ — لا يُبرهَنُ براءةُ القيمة");
  // المعالجةُ السادسةُ عشرةَ (وجهُ concat): الاشتقاقُ المجهولُ يُسألُ أيضًا عن أصولِ **وسائطِهِ** —
  // فالدمجُ (concat · push · unshift) يعيدُ ما حملهُ الوسيطُ والاشتقاقُ بهذهِ الحروفِ لا يُبرهَنُ بريئًا
  if (callee.parent !== undefined && ts.isCallExpression(callee.parent) && callee.parent.expression === callee && !callArgVisiting.has(callee.parent)) {
    callArgVisiting.add(callee.parent);
    try {
      let argAcc: ValueOrigin = DATA;
      for (const a of callee.parent.arguments) {
        if (ts.isSpreadElement(a)) continue;
        argAcc = EXEC_UNION(argAcc, originInFile(a));
        // ومنظوراتُ الوسيطِ — عناصرُ المصفوفةِ وأعضاءُ الكائنِ يحملانِ غيرَ البياناتِ (وجهُ Array.from)
        for (const v of materializeViews(a, ctx)) argAcc = EXEC_UNION(argAcc, viewAllMemberOrigins(v, ctx, ask));
      }
      if (argAcc.kind !== "data") return OPAQUE("اشتقاقٌ معياريٌّ بوسيطٍ يحملُ غيرَ البياناتِ — لا يُبرهَنُ براءةُ القيمة");
    } finally {
      callArgVisiting.delete(callee.parent);
    }
  }
  return null;
}

/** أسئلةُ العرّافِ التي تحتاجها دوالُّ الرموزِ — يُمرَّرُ العرّافُ نفسُهُ */
export interface OracleAsk {
  viewCtx(): ViewContext;
  originOf(e: ts.Expression): ValueOrigin;
  originInFile(e: ts.Expression): ValueOrigin;
}

  /** عنصرُ for-of: عناصرُ منظوراتِ المصفوفةِ — أو حدُّ التعبيرِ كما كانَ إن لم تُجسَّدْ */
export function forOfElementOrigin(f: ts.Expression, oracle: OracleAsk): ValueOrigin {
  const els = arrayViewElements(f, oracle.viewCtx());
  if (els.length === 0) return oracle.originOf(f);
  return els.reduce((acc, el) => RETURN_UNION(acc, oracle.originInFile(el)), DATA);
}

  /** إرجاعُ دالّةٍ ذاتِ جسمٍ: اتحادُ تعبيراتِ `return` — وجسمُ التعبيرِ قيمتُهُ */
export function bodyReturnOrigin(fn: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration, oracle: OracleAsk): ValueOrigin {
  if (fn.body === undefined) return DATA;
  if (!ts.isBlock(fn.body)) {
    const o = oracle.originOf(fn.body);
    return o.kind === "opaque" ? DATA : o; // المعتمُ لا يعبرُ حدودَ الدوالِّ (دَينُ RC-07)
  }
  const rets: ts.Expression[] = [];
  collectReturns(fn.body, rets);
  return rets.reduce((acc, r) => RETURN_UNION(acc, oracle.originOf(r)), DATA);
}
