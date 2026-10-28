/**
 * سؤالُ أصلِ العضوِ على منظوراتِهِ — الطبقةُ الثانيةُ من منظوراتِ القيمةِ المجسّدة
 * (W-2026-040 · المعالجةُ السادسةُ عشرةَ). فُصلت عنِ التجليلِ نفسِهِ (`rehydrate_value_views.ts`)
 * لحدِّ حجمِ الوحدةِ (سقفُ 400 سطرًا · `scripts/check_module_size.sh`) — والفصلُ طبقةٌ
 * لا تغييرَ سلوكٍ: استدعاءاتٌ حرفيّةٌ بلا إصلاحٍ.
 *
 * تسألُ هذهِ الوحدةُ: ما أصلُ العضوِ الذي يُقرأُ من منظوراتِ مادّةِ أساسِهِ؟ وما أصلُ
 * الاشتقاقِ المعياريِّ (at · map · filter) من مصفوفةٍ منظورةٍ؟ — والمنهجُ المُسلَّمُ:
 * الاستسلامُ يُعلَنُ ولا يُخضَّرُ (منظورٌ غيرُ مرئيٍّ ⇒ معتمٌ عندَ النداءِ) والمعلَنُ
 * `any` (بتهجئتِهِ أو كنيتِهِ النوعيّةِ) لا يُبرهَنُ بريئًا.
 */
import ts from "typescript";
import { DATA, EXEC_UNION, OPAQUE, RETURN_UNION, foldKey, unwrapFlow } from "./rehydrate_origin_model";
import type { ValueOrigin } from "./rehydrate_origin_model";
import { accessKey, arrayViewElements, classMemberNodes, materializeViews, namespaceViewExportDecl, viewMemberExpressions, viewMemberMethod } from "./rehydrate_value_views";
import type { MemberView, ViewContext } from "./rehydrate_value_views";

/** أسئلةُ العرّافِ التي تستدعيها المنظوراتُ — تُمرَّرُ من `rehydrate_value_origin.ts` (حدُّ القسمةِ سلطةٌ) */
export interface OriginAsk {
  originInFile(e: ts.Expression): ValueOrigin;
  functionValue(fn: ts.MethodDeclaration | ts.GetAccessorDeclaration): ValueOrigin;
  declValue(d: ts.Declaration): ValueOrigin;
  propFlowsOf(base: ts.Symbol, key: string): readonly ts.Expression[];
  originOfFlow(f: ts.Expression): ValueOrigin;
}

/** أصلُ عضوٍ على أساسٍ بياناتٍ: منظوراتُ المادةِ + إعاداتُ إسنادِ الخاصّيّةِ — اتحادًا */
export function dataBaseMemberOrigin(n: ts.PropertyAccessExpression | ts.ElementAccessExpression, ctx: ViewContext, ask: OriginAsk): ValueOrigin {
  const key = accessKey(n);
  let acc: ValueOrigin | undefined;
  let sawUnknown = false;
  for (const v of materializeViews(n.expression, ctx)) {
    if (v.kind === "unknown") {
      sawUnknown = true;
      continue;
    }
    if (key === null) {
      // المعالجةُ السادسةُ عشرةَ: المفتاحُ المحسوبُ غيرُ المطويِّ — كلُّ عضوٍ مرشّحٌ للقراءةِ فاتحادُ الجميعِ
      acc = EXEC_UNION(acc ?? DATA, viewAllMemberOrigins(v, ctx, ask));
      continue;
    }
    for (const m of viewMemberExpressions(v, key, ctx)) acc = EXEC_UNION(acc ?? DATA, ask.originInFile(m));
    const method = viewMemberMethod(v, key, ctx);
    if (method !== undefined) acc = EXEC_UNION(acc ?? DATA, ask.functionValue(method));
    const nsd = namespaceViewExportDecl(v, key, ctx);
    if (nsd !== undefined) acc = EXEC_UNION(acc ?? DATA, ask.declValue(nsd));
  }
  if (key !== null) {
    const baseU = unwrapFlow(n.expression);
    if (ts.isIdentifier(baseU)) {
      const s = ctx.checker.getSymbolAtLocation(baseU);
      if (s !== undefined) for (const f of ask.propFlowsOf(s, key)) acc = EXEC_UNION(acc ?? DATA, ask.originOfFlow(f));
    }
  }
  // المعالجةُ السادسةُ عشرةَ: الاستسلامُ يُعلَنُ — المنظورُ المجهولُ يعتمُ القراءةَ ولا يُخضّرُها
  if (sawUnknown && isCallCallee(n, ctx.checker)) return EXEC_UNION(acc ?? DATA, OPAQUE("منظورٌ غيرُ مرئيٍّ — التحليلُ لم يكتمل (عمقٌ أو شكلٌ) فلا يُبرهَنُ براءةُ العضو"));
  if (sawUnknown) return acc ?? DATA;
  if (acc !== undefined) return acc;
  return accessTypeFallback(ctx.checker, n);
}

/** احتياطيُّ النوعِ عندَ غيابِ المنظورِ (المعالجةُ السادسةُ عشرةَ): مجهولُ النوعِ معتمٌ — والمعروفُ بياناتٌ */
/**
 * هل التعبيرُ مستدعًى لنداءٍ (مباشرةً أو عبرَ قوسٍ وتحويلٍ و`!`) — (المعالجةُ السادسةَ عشرةَ):
 * قراءةُ المجهولِ تُغسَلُ بياناتٍ (حدُّ الجولةِ 11 المعلَنُ) · ونداءُهُ لا يُبرهَنُ نفيُه فيُسقطُ (البابُ و).
 */
export function isCallCallee(n: ts.Expression, checker?: ts.TypeChecker): boolean {
  let c: ts.Node = n;
  while (c.parent !== undefined && (ts.isAsExpression(c.parent) || ts.isNonNullExpression(c.parent) || ts.isParenthesizedExpression(c.parent))) c = c.parent;
  if (c.parent === undefined || !ts.isCallExpression(c.parent) || c.parent.expression !== c) return false;
  if (checker !== undefined) {
    // توقيعٌ محلولٌ إلى مكتبةِ النوعِ (`.d.ts`) — منهجٌ معياريٌّ معلومُ السلوكِ يُبرَّأ
    // (لا يفتحُ قناةً مجهولةً) · بلا توقيعٍ فالنداءُ على مجهولٍ لا يُبرهَنُ نفيُه
    try {
      const decl = checker.getResolvedSignature(c.parent)?.declaration;
      if (decl !== undefined && decl.getSourceFile().isDeclarationFile) return false;
    } catch {
      /* بلا توقيعٍ محلولٍ — يبقى غيرَ مبرهَنٍ */
    }
  }
  return true;
}
/**
 * هل أساسُ الوصولِ مجهولٌ **معروضٌ** — معاملٌ أو متغيّرٌ نصَّ نوعَهُ `any`/`unknown` (أو بلا نوعٍ) —
 * أم مجهولٌ مستنتَجٌ من تصادمِ أسماءٍ موسومةٍ (عضوٌ معياريٌّ على نوعٍ موسومٍ لا يحملهُ)؟
 * المعلَنُ لا يُبرهَنُ نفيُ تنفيذِهِ (مجهولٌ بنيّةً) · والمستنتَجُ من إعلانٍ موصوفٍ فقيمتُهُ معروفةُ الجنسِ.
 * الأساسُ المركّبُ (وصولُ عضوٍ) ليسَ معروضَ الجهلِ — نوعُهُ من إعلانِ موصِلِهِ.
 */
function isDeclaredAnyBase(n: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker): boolean {
  const u = unwrapFlow(n.expression);
  if (!ts.isIdentifier(u)) return false;
  const s = checker.getSymbolAtLocation(u);
  const d = s?.valueDeclaration ?? s?.declarations?.find((x) => x !== undefined);
  if (d === undefined) return false;
  if (ts.isParameter(d)) {
    if (d.type === undefined) return true; // معاملٌ بلا نوعٍ — مجهولٌ ضمنيٌّ معروضٌ
    // النوعُ المعلَنُ **محلولًا** — فالكنيةُ النوعيّةُ (`type A = any`) مجهولٌ معروضٌ لا تهجئةٌ
    return declaredTypeNodeIsAny(d.type, checker);
  }
  if (ts.isVariableDeclaration(d)) {
    return d.type !== undefined && declaredTypeNodeIsAny(d.type, checker);
  }
  return false;
}

/** هل عقدةُ النوعِ المعلَنِ محلولةً إلى any/unknown؟ (AnyKeyword أو كنيةٍ نوعيّةٍ تحلُّ إليهما) */
function declaredTypeNodeIsAny(t: ts.TypeNode, checker: ts.TypeChecker): boolean {
  if (t.kind === ts.SyntaxKind.AnyKeyword || t.kind === ts.SyntaxKind.UnknownKeyword) return true;
  try {
    const rt = checker.getTypeAtLocation(t);
    return (rt.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
  } catch {
    return false;
  }
}
function accessTypeFallback(checker: ts.TypeChecker, n: ts.PropertyAccessExpression | ts.ElementAccessExpression): ValueOrigin {
  // المعالجةُ السادسةُ عشرةَ (قياسُ المستودعِ): العضوُ قد يتحوّلُ مجهولًا بتصادمِ الأسماءِ الموسومةِ
  // (عضوٌ معياريٌّ على نوعٍ موسومٍ لا يحملهُ) — والأساسُ معروفُ النوعِ فبريءٌ · والمجهولُ الحقيقيُّ
  // (أساسٌ any/unknown كمعاملٍ بلا وسيطٍ مرئيّ) لا يُبرهَنُ نفيُ تنفيذِهِ إن استُدعيَ (البابُ و).
  const baseT = checker.getTypeAtLocation(n.expression);
  if ((baseT.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 && isDeclaredAnyBase(n, checker) && isCallCallee(n, checker)) {
    return OPAQUE("عضوٌ بلا منظورٍ وأساسُهُ مجهولُ النوعِ — لا يُبرهَنُ براءةُ أصلِه");
  }
  // عضوٌ **معروضٌ** `any` في إعلانِ نوعِهِ (وجهُ grok: `box: { run: any }`) — مجهولٌ بنيّةً معلنٌ
  // لا مصطنعُ تصادمِ الأسماءِ الموسومةِ (العضوُ المعياريُّ على النوعِ الموسومِ رمزُهُ من مكتبةِ النوعِ)
  if (isCallCallee(n, checker) && isDeclaredAnyMember(n, checker)) {
    return OPAQUE("عضوٌ معلنُ النوعِ `any` في إعلانِهِ — لا يُبرهَنُ براءةُ أصلِه");
  }
  return DATA;
}

/** هل العضوُ معلنُ النوعِ `any`/`unknown` نصًّا في إعلانِهِ (توقيعِ خاصّيّةٍ أو تعيينِها)؟ */
function isDeclaredAnyMember(n: ts.PropertyAccessExpression | ts.ElementAccessExpression, checker: ts.TypeChecker): boolean {
  const t = checker.getTypeAtLocation(n);
  if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0) return false;
  try {
    const sym = checker.getSymbolAtLocation(n);
    const d = sym?.getDeclarations()?.[0];
    if (d === undefined) return false;
    if (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d)) {
      return d.type !== undefined && declaredTypeNodeIsAny(d.type, checker);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * اتحادُ أصلِ كلِّ ما يمكنُ قراءتُهُ من منظورٍ (المعالجةُ السادسةُ عشرةَ) — للمفتاحِ غيرِ المطويِّ
 * وللاشتقاقِ المجهولِ على منظورٍ يحملُ غيرَ البياناتِ: الأعضاءُ والمناهجُ والتصديراتُ ونشرُ المصادرِ.
 */
export function viewAllMemberOrigins(v: MemberView, ctx: ViewContext, ask: OriginAsk): ValueOrigin {
  let acc: ValueOrigin = DATA;
  const union = (o: ValueOrigin): void => { acc = EXEC_UNION(acc, o); };
  if (v.kind === "object") {
    for (const p of v.node.properties) {
      if (ts.isPropertyAssignment(p)) union(ask.originInFile(p.initializer));
      else if (ts.isShorthandPropertyAssignment(p)) union(ask.originInFile(p.name));
      else if (ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p)) union(ask.functionValue(p));
      else if (ts.isSpreadAssignment(p)) for (const sv of materializeViews(p.expression, ctx)) union(viewAllMemberOrigins(sv, ctx, ask));
    }
  } else if (v.kind === "array") {
    for (const el of v.node.elements) {
      if (ts.isSpreadElement(el)) {
        for (const sv of materializeViews(el.expression, ctx)) union(viewAllMemberOrigins(sv, ctx, ask));
      } else if (!ts.isOmittedExpression(el)) {
        union(ask.originInFile(el));
        // العنصرُ الحرفيُّ المتداخلُ (زوجُ fromEntries مثلًا) — مادّتُهُ تُسألُ لا شكلُهُ
        const u = unwrapFlow(el);
        if (ts.isObjectLiteralExpression(u)) union(viewAllMemberOrigins({ kind: "object", node: u }, ctx, ask));
        else if (ts.isArrayLiteralExpression(u)) union(viewAllMemberOrigins({ kind: "array", node: u }, ctx, ask));
      }
    }
  } else if (v.kind === "assign") {
    for (const a of v.node.arguments) for (const sv of materializeViews(a, ctx)) union(viewAllMemberOrigins(sv, ctx, ask));
  } else if (v.kind === "class") {
    for (const m of classMemberNodes(v.node, new Set(), ctx.checker)) {
      if (ts.isPropertyDeclaration(m) && m.initializer !== undefined) union(ask.originInFile(m.initializer));
      else if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && m.body !== undefined) union(ask.functionValue(m));
    }
  } else if (v.kind === "namespace") {
    try {
      for (const exp of ctx.checker.getExportsOfModule(v.symbol)) {
        const d = exp.valueDeclaration ?? exp.declarations?.[0];
        if (d !== undefined) union(ask.declValue(d));
      }
    } catch { /* وحدةٌ لا تُقرأُ تصديراتُها — لا يُبرهَنُ شيءٌ */ }
  }
  return acc;
}

/** أسئلةُ الاشتقاقِ من مصفوفةٍ — at/map/filter */
export interface DerivedAsk {
  originInFile(e: ts.Expression): ValueOrigin;
  callbackValue(fn: ts.FunctionExpression | ts.ArrowFunction): ValueOrigin;
}

/**
 * قيمةُ نداءِ اشتقاقٍ من مصفوفةٍ — `at(k)` يصلُ إلى العنصرِ و`map`/`filter` قيمتُهما
 * اتحادُ عناصرِ المصدرِ وإرجاعِ المحوِّلِ (المعتمُ لا يعبرُ — اتّحادُ الإرجاعِ) — أو `null`
 * إن لم يكنِ النداءُ اشتقاقًا من منظوراتِ مصفوفةٍ.
 */
export function derivedArrayValue(n: ts.CallExpression, ctx: ViewContext, ask: DerivedAsk): ValueOrigin | null {
  const callee = unwrapFlow(n.expression);
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const name = callee.name.text;
  if (name !== "at" && name !== "map" && name !== "filter") return null;
  if (n.arguments.length === 0) return null;
  const els = arrayViewElements(callee.expression, ctx);
  if (els.length === 0) return null;
  if (name === "at") {
    const key = foldKey(n.arguments[0]!);
    if (key === null || !/^\d+$/.test(key)) return null;
    let acc: ValueOrigin | null = null;
    for (const v of materializeViews(callee.expression, ctx)) {
      if (v.kind !== "array") continue;
      for (const m of viewMemberExpressions(v, key, ctx)) acc = RETURN_UNION(acc ?? DATA, ask.originInFile(m));
    }
    return acc;
  }
  if (name === "map") {
    const cb = unwrapFlow(n.arguments[0]!);
    if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) return null;
    const acc = els.reduce((a, e) => RETURN_UNION(a, ask.originInFile(e)), DATA);
    return RETURN_UNION(acc, ask.callbackValue(cb));
  }
  return els.reduce((a, e) => RETURN_UNION(a, ask.originInFile(e)), DATA);
}
