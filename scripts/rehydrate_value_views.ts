/**
 * scripts/rehydrate_value_views.ts — **منظوراتُ المادةِ**: تجسيدُ مصدرِ القيمةِ (المرحلة 39 ·
 * W-2026-040 · المعالجةُ الخامسةَ عشرةَ · عيوبُ الجولةِ العاشرةِ الستَّ عشرةَ). الوصولُ
 * بخصوصيّةٍ أو فهرسٍ لا يُسألُ عن شكلِ أساسِهِ بل عن **مادّتِهِ**: كلُّ تعبيرٍ يُجسَّدُ إلى
 * منظوراتٍ — كائنٌ حرفيٌّ · مصفوفةٌ حرفيّةٌ · دمجُ `Object.assign` · صنفٌ مُنشأٌ من تعريفٍ
 * مرئيٍّ في البرنامجِ · وحدةُ نطاقٍ (`import * as ns`) — والعضوُ يُقرأُ من منظوراتِ مصدرِهِ
 * (المفتاحُ المحسوبُ يُطوى والوصولُ المتداخلُ ينزلُ عضوًا عضوًا والمعرّفُ يُتْبَعُ إلى كلِّ
 * تدفّقاتِ إسنادِهِ اتحادًا لا أولِ تدفّقٍ). هذه الوحدةُ **خالصةٌ على الشجرةِ**: لا تسألُ
 * عرّافًا ولا تحكمُ — تُنتجُ تعبيراتِ الأعضاءِ وإعلاناتِ المناهجِ، والسؤالُ عن أصلِها
 * (`rehydrate_value_origin.ts`) يُوجَّهُ إلى عرّافِ ملفِّها.
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * الصلاحيات (RULE-004): قراءةٌ صرفةٌ للشجرةِ عبرَ مدقّقِ الأنواعِ — لا كتابةَ ولا حكمَ
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * التبعيات: مُترجمُ TypeScript وحدَه
 */
import ts from "typescript";
import { DATA, EXEC_UNION, RETURN_UNION, bindingElementKey, foldKey, namespaceModuleOf, propertyNameText, unwrapFlow } from "./rehydrate_origin_model";
import type { ValueOrigin } from "./rehydrate_origin_model";

/** سياقُ التجسيدِ: المدقّقُ وتدفّقاتُ المعرّفِ في ملفِّهِ (العرّافُ يزوّدُها بالتوجيهِ العابرِ للملفاتِ) */
export interface ViewContext {
  readonly checker: ts.TypeChecker;
  flowsOf(id: ts.Identifier): readonly ts.Expression[];
}

/** منظورٌ مُجسَّدٌ — مادةُ القيمةِ التي يُقرأُ منها العضوُ */
export type MemberView =
  | { readonly kind: "object"; readonly node: ts.ObjectLiteralExpression }
  | { readonly kind: "array"; readonly node: ts.ArrayLiteralExpression }
  | { readonly kind: "assign"; readonly node: ts.CallExpression }
  | { readonly kind: "class"; readonly node: ts.ClassDeclaration }
  | { readonly kind: "namespace"; readonly symbol: ts.Symbol };

const MAX_DEPTH = 4;

/** مفتاحُ وصولٍ (خصوصيّةٌ أو فهرسٌ) مطويًّا — أو `null` للمحسوبِ غيرِ القابلِ للطيِّ */
export function accessKey(n: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  return ts.isPropertyAccessExpression(n) ? n.name.text : foldKey(n.argumentExpression);
}

/** `Object.assign(…)` الحرفيُّ — دمجٌ يُقرأُ أعضاؤُهُ من وسيطاتِهِ الكائنيّةِ الحرفيّةِ */
function isAssignCall(e: ts.Expression): e is ts.CallExpression {
  if (!ts.isCallExpression(e)) return false;
  const c = unwrapFlow(e.expression);
  return ts.isPropertyAccessExpression(c) && c.name.text === "assign" && ts.isIdentifier(c.expression) && c.expression.text === "Object";
}

/** صنفُ `new` في البرنامجِ المرئيِّ (لا تعريفاتِ المكتباتِ) — أو `undefined` */
function classDeclOf(e: ts.NewExpression, ctx: ViewContext): ts.ClassDeclaration | undefined {
  const t = ctx.checker.getTypeAtLocation(e);
  const sym = t.getSymbol();
  const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
  return decl !== undefined && ts.isClassDeclaration(decl) && !decl.getSourceFile().isDeclarationFile ? decl : undefined;
}

/** مفتاحُ اسمِ خاصّيّةٍ يطابقُ (المحسوبُ يُطوى من حرفيّاتِهِ) */
function propertyKeyMatches(name: ts.PropertyName, key: string): boolean {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text === key;
  if (ts.isComputedPropertyName(name)) return foldKey(name.expression) === key;
  return false;
}

/** تصديرُ وحدةِ نطاقٍ بالمفتاحِ — أو `undefined` */
function exportOf(checker: ts.TypeChecker, moduleSym: ts.Symbol, key: string): ts.Symbol | undefined {
  try {
    return checker.getExportsOfModule(moduleSym).find((e) => e.name === key);
  } catch {
    return undefined;
  }
}

/**
 * تجسيدُ تعبيرٍ إلى منظوراتِ مادّتِهِ — المعرّفُ يُتْبَعُ إلى **كلِّ** تدفّقاتِ إسنادِهِ
 * (اتحادًا) والوصولُ المتداخلُ ينزلُ عضوًا عضوًا والعمقُ مقيَّدٌ (لا استدلالًا بلا حدٍّ).
 */
export function materializeViews(e: ts.Expression, ctx: ViewContext, depth: number = MAX_DEPTH): MemberView[] {
  if (depth < 0) return [];
  const u = unwrapFlow(e);
  if (ts.isObjectLiteralExpression(u)) return [{ kind: "object", node: u }];
  if (ts.isArrayLiteralExpression(u)) return [{ kind: "array", node: u }];
  if (isAssignCall(u)) return [{ kind: "assign", node: u }];
  if (ts.isNewExpression(u)) {
    const cls = classDeclOf(u, ctx);
    return cls === undefined ? [] : [{ kind: "class", node: cls }];
  }
  if (ts.isIdentifier(u)) {
    const ns = namespaceModuleOf(ctx.checker, u);
    if (ns !== undefined) return [{ kind: "namespace", symbol: ns }];
    const out: MemberView[] = [];
    for (const f of ctx.flowsOf(u)) out.push(...materializeViews(f, ctx, depth - 1));
    return out;
  }
  if (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) {
    const key = accessKey(u);
    if (key === null) return [];
    const out: MemberView[] = [];
    for (const view of materializeViews(u.expression, ctx, depth - 1)) {
      for (const m of viewMemberExpressions(view, key, ctx, depth - 1)) out.push(...materializeViews(m, ctx, depth - 1));
    }
    return out;
  }
  return [];
}

/** تعبيراتُ عضوٍ في منظوراتٍ — المُهيِّئُ والاسمُ المختصرُ والنشرُ والدمجُ وخصيصةُ الصنفِ وتصديرُ الوحدةِ */
export function viewMemberExpressions(view: MemberView, key: string, ctx: ViewContext, depth: number = MAX_DEPTH): ts.Expression[] {
  if (depth < 0) return [];
  const out: ts.Expression[] = [];
  if (view.kind === "object") {
    for (const p of view.node.properties) {
      if (ts.isPropertyAssignment(p) && propertyKeyMatches(p.name, key)) out.push(p.initializer);
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) out.push(p.name);
      else if (ts.isSpreadAssignment(p)) {
        for (const v of materializeViews(p.expression, ctx, depth - 1)) out.push(...viewMemberExpressions(v, key, ctx, depth - 1));
      }
    }
  } else if (view.kind === "array" && /^\d+$/.test(key)) {
    const el = view.node.elements[Number(key)];
    if (el !== undefined && !ts.isOmittedExpression(el) && !ts.isSpreadElement(el)) out.push(el);
  } else if (view.kind === "assign") {
    for (const a of view.node.arguments) {
      const au = unwrapFlow(a);
      if (ts.isObjectLiteralExpression(au)) out.push(...viewMemberExpressions({ kind: "object", node: au }, key, ctx, depth - 1));
    }
  } else if (view.kind === "class") {
    for (const m of view.node.members) {
      if (ts.isPropertyDeclaration(m) && m.initializer !== undefined && m.name !== undefined && propertyKeyMatches(m.name, key)) out.push(m.initializer);
    }
  } else if (view.kind === "namespace") {
    const exp = exportOf(ctx.checker, view.symbol, key);
    const d = exp?.valueDeclaration ?? exp?.declarations?.[0];
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) out.push(d.initializer);
  }
  return out;
}

/** منهجٌ أو جالبٌ في منظورٍ — قيمتُهُ إرجاعُهُ (تُسألُ من عرّافِ ملفِّهِ) */
export function viewMemberMethod(view: MemberView, key: string): ts.MethodDeclaration | ts.GetAccessorDeclaration | undefined {
  const members: readonly ts.Node[] = view.kind === "object" ? view.node.properties : view.kind === "class" ? view.node.members : [];
  for (const m of members) {
    if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) && m.name !== undefined && propertyKeyMatches(m.name, key)) return m;
  }
  return undefined;
}

/** إعلانُ تصديرِ وحدةِ نطاقٍ (الدالّاتُ المصدَّرةُ) — أو `undefined` */
export function namespaceViewExportDecl(view: MemberView, key: string, ctx: ViewContext): ts.Declaration | undefined {
  if (view.kind !== "namespace") return undefined;
  const exp = exportOf(ctx.checker, view.symbol, key);
  return exp?.valueDeclaration ?? exp?.declarations?.[0];
}

/** عنصرُ تفكيكٍ: مصادرُهُ من جذرِ إعلانِهِ بمسارِ مفاتيحِهِ — والقيمةُ الافتراضيةُ عندَ غيابِ العضوِ الأخيرِ */
export function bindingElementSources(el: ts.BindingElement, ctx: ViewContext): ts.Expression[] {
  // مسارُ المفاتيحِ يُجمعُ صعودًا من العنصرِ إلى جذرِ الإعلانِ (متداخلًا كانَ أو ذا قيمةٍ افتراضيةٍ)
  const keys: string[] = [];
  let node: ts.Node = el;
  let root: ts.VariableDeclaration | ts.ForOfStatement | undefined;
  while (root === undefined) {
    if (ts.isBindingElement(node)) {
      const pattern = node.parent;
      if (pattern === undefined || (!ts.isObjectBindingPattern(pattern) && !ts.isArrayBindingPattern(pattern))) return [];
      if (ts.isObjectBindingPattern(pattern)) keys.unshift(bindingElementKey(node) ?? "");
      else keys.unshift(String(pattern.elements.indexOf(node)));
      node = pattern;
      continue;
    }
    const p = node.parent;
    if (p === undefined) return [];
    if (ts.isBindingElement(p) || ts.isObjectBindingPattern(p) || ts.isArrayBindingPattern(p)) {
      node = p;
      continue;
    }
    if (ts.isVariableDeclaration(p) || ts.isForOfStatement(p)) root = p;
    else return []; // معاملُ دالّةٍ أو نمطٌ بلا جذرِ إسنادٍ — حدٌّ معلَنٌ (RC-07)
  }
  let exprs: ts.Expression[] = [];
  if (ts.isForOfStatement(root)) exprs = [root.expression];
  else if (root.initializer !== undefined) exprs = [root.initializer];
  else return [];
  for (let i = 0; i < keys.length; i++) {
    const next: ts.Expression[] = [];
    for (const e of exprs) {
      for (const v of materializeViews(e, ctx)) next.push(...viewMemberExpressions(v, keys[i]!, ctx));
    }
    if (next.length === 0) return i === keys.length - 1 && el.initializer !== undefined ? [el.initializer] : [];
    exprs = next;
  }
  return exprs;
}

/** عناصرُ منظوراتِ المصفوفةِ لتعبيرٍ — لقيمةِ عنصرِ for-of والاشتقاقِ منها */
export function arrayViewElements(e: ts.Expression, ctx: ViewContext, depth: number = MAX_DEPTH): ts.Expression[] {
  const out: ts.Expression[] = [];
  for (const v of materializeViews(e, ctx, depth)) {
    if (v.kind !== "array") continue;
    for (const el of v.node.elements) {
      if (!ts.isOmittedExpression(el) && !ts.isSpreadElement(el)) out.push(el);
    }
  }
  return out;
}

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
  if (key === null) return DATA;
  let acc: ValueOrigin | undefined;
  for (const v of materializeViews(n.expression, ctx)) {
    for (const m of viewMemberExpressions(v, key, ctx)) acc = EXEC_UNION(acc ?? DATA, ask.originInFile(m));
    const method = viewMemberMethod(v, key);
    if (method !== undefined) acc = EXEC_UNION(acc ?? DATA, ask.functionValue(method));
    const nsd = namespaceViewExportDecl(v, key, ctx);
    if (nsd !== undefined) acc = EXEC_UNION(acc ?? DATA, ask.declValue(nsd));
  }
  const baseU = unwrapFlow(n.expression);
  if (ts.isIdentifier(baseU)) {
    const s = ctx.checker.getSymbolAtLocation(baseU);
    if (s !== undefined) for (const f of ask.propFlowsOf(s, key)) acc = EXEC_UNION(acc ?? DATA, ask.originOfFlow(f));
  }
  return acc ?? DATA;
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
