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
import { DATA, EXEC_UNION, OPAQUE, RETURN_UNION, bindingElementKey, foldKey, namespaceModuleOf, propertyNameText, unwrapFlow } from "./rehydrate_origin_model";
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
  | { readonly kind: "class"; readonly node: ts.ClassDeclaration | ts.ClassExpression }
  | { readonly kind: "namespace"; readonly symbol: ts.Symbol }
  /** المعالجةُ السادسةُ عشرةَ: شكلٌ قابلٌ للاستكشافِ لم يُرَ — الاستسلامُ يُعلَنُ ولا يُخضَّرُ */
  | { readonly kind: "unknown"; readonly why: string };

const UNKNOWN_VIEW = (why: string): MemberView => ({ kind: "unknown", why });

/**
 * ميزانيةُ عمقِ التجسيدِ — سلاسلُ المحاضرِ الحرفيّةِ تصلُ السادسَ (خامُّ grok 5) فلا يجوزُ
 * أن يستهلكَها الميزانُ قبلَ بلوغِ الورقةِ؛ وما بعدَ الميزانيةِ يُعلَنُ لا يُخضَّرُ.
 */
const MAX_DEPTH = 8;

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

/**
 * المعالجةُ السادسةُ عشرةَ: الدمجُ يُعرَفُ برمزِهِ لا بنصِّهِ — نداءٌ يحلُّ توقيعُهُ إلى تعريفِ مكتبةٍ
 * اسمُهُ `assign` (كنيّةُ `Object.assign` وتفكيكُها ومرجعُها المارُّ) يُعامَلُ دمجًا — والنصُّ
 * المباشرُ يبقى الطريقَ الأولَ.
 */
export function resolvesToAssignMerge(n: ts.CallExpression, checker: ts.TypeChecker): boolean {
  const c = unwrapFlow(n.expression);
  if (ts.isPropertyAccessExpression(c) && c.name.text === "assign" && ts.isIdentifier(c.expression) && c.expression.text === "Object") return true;
  if (ts.isIdentifier(c) && c.text === "Object" && false) return false; // لا معنى لنداءِ Object نفسِهِ — يُبقى للتوثيقِ
  try {
    const decl = checker.getResolvedSignature(n)?.declaration;
    return decl !== undefined && decl.getSourceFile().isDeclarationFile && (decl as ts.NamedDeclaration).name !== undefined && ((decl as ts.NamedDeclaration).name as ts.Identifier).text === "assign";
  } catch {
    return false;
  }
}

/** صنفُ `new` في البرنامجِ المرئيِّ (لا تعريفاتِ المكتباتِ) — أو `undefined` */
function classDeclOf(e: ts.NewExpression, ctx: ViewContext): ts.ClassDeclaration | ts.ClassExpression | undefined {
  const t = ctx.checker.getTypeAtLocation(e);
  const sym = t.getSymbol();
  const decl = sym?.valueDeclaration ?? sym?.declarations?.[0];
  if (decl !== undefined && (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) && !decl.getSourceFile().isDeclarationFile) return decl;
  // المعالجةُ السادسةُ عشرةَ: `new (class {...})()` — تعبيرُ الصنفِ الحرفيُّ يُرى كما يُرى تعريفُهُ
  const direct = unwrapFlow(e.expression);
  if (ts.isClassExpression(direct) && !direct.getSourceFile().isDeclarationFile) return direct;
  return undefined;
}

/** مفتاحُ اسمِ خاصّيّةٍ يطابقُ (المحسوبُ يُطوى من حرفيّاتِهِ) — والخاصُّ `#name` يُطابقُ نصَّه */
function propertyKeyMatches(name: ts.PropertyName, key: string): boolean {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text === key;
  if (ts.isPrivateIdentifier(name)) return name.text === key;
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
 * مسحٌ بنيويٌّ رخيصٌ للشجرةِ المرئيّةِ بحثًا عن علاماتِ التنفيذِ (المعالجةُ السادسةُ عشرةَ):
 * حين يعجزُ التجسيدُ عن إكمالِ المسحِ لا يُعمَمُ العتيمُ على البريءِ — بل يُسألُ ما تبقّى
 * من الشجرةِ: هل تحملُ رمزَ تنفيذٍ ظاهرًا (`eval` · `Function` · `require` · استيرادٌ
 * ديناميكيٌّ)؟ فإن وُجدَ فعتيمٌ (لا يُبرهَنُ البريءُ) وإلا فبياناتٌ كما كانَ الحاجزُ.
 * المسحُ لا يتبعُ تدفّقاتٍ ولا رموزًا — شجرةُ النحوِ متناهيةٌ فلا دورانَ.
 */
function containsExecMarker(node: ts.Node, aliases: number = 3): boolean {
  if (ts.isIdentifier(node)) {
    if (node.text === "eval" || node.text === "Function" || node.text === "require") return true;
    // كنيةٌ بسيطةٌ: `const execute = eval` — تُتْبَعُ إعلانُها الموضعيَّ اتّباعًا محدودًا
    // (متناهٍ في أسماءِ الملفِّ لا تدفّقاتِه) فلا يُخضَّرُ المجهولُ بكنيةٍ (قياسُ المراجعِ)
    if (aliases > 0 && node.parent !== undefined && ts.isVariableDeclaration(node.parent) && node.parent.initializer !== undefined) {
      return containsExecMarker(node.parent.initializer, aliases - 1);
    }
    return false;
  }
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Function") return true;
  return node.forEachChild((c) => containsExecMarker(c, aliases)) === true;
}

/**
 * تجسيدُ تعبيرٍ إلى منظوراتِ مادّتِهِ — المعرّفُ يُتْبَعُ إلى **كلِّ** تدفّقاتِ إسنادِهِ
 * (اتحادًا) والوصولُ المتداخلُ ينزلُ عضوًا عضوًا والعمقُ مقيَّدٌ (لا استدلالًا بلا حدٍّ).
 */
export function materializeViews(e: ts.Expression, ctx: ViewContext, depth: number = MAX_DEPTH): MemberView[] {
  const u = unwrapFlow(e);
  if (ts.isObjectLiteralExpression(u)) return [{ kind: "object", node: u }];
  if (ts.isArrayLiteralExpression(u)) return [{ kind: "array", node: u }];
  if (isAssignCall(u)) return [{ kind: "assign", node: u }];
  if (ts.isNewExpression(u)) {
    const cls = classDeclOf(u, ctx);
    return cls === undefined ? [] : [{ kind: "class", node: cls }];
  }
  // المعالجةُ السادسةُ عشرةَ: الاستيرادُ الديناميكيُّ — وحدةٌ تُحَلُّ فتُقرأُ تصديراتُها (الجولةُ 11)
  if (ts.isCallExpression(u) && u.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const modSym = importModuleSymbol(u, ctx);
    return modSym === undefined ? [UNKNOWN_VIEW("استيرادٌ ديناميكيٌّ لا يُحَلُّ إلى وحدةٍ مرئيّةٍ")] : [{ kind: "namespace", symbol: modSym }];
  }
  if (ts.isIdentifier(u)) {
    const ns = namespaceModuleOf(ctx.checker, u);
    if (ns !== undefined) return [{ kind: "namespace", symbol: ns }];
    // المعالجةُ السادسةُ عشرةَ: المعرّفُ الصنفُ — أشكالُ الصنفِ (الساكنُ والوارثُ والخاصُّ) تُرى
    const cls = classOfIdentifier(u, ctx);
    if (cls !== undefined) return [{ kind: "class", node: cls }];
    const flows = ctx.flowsOf(u);
    if (flows.length === 0) return [];
    if (depth <= 0) {
      // نفدَ العمقُ — المسحُ البنيويُّ للباقي يفرّقُ البريءَ من الحاملِ لتنفيذٍ ظاهرٍ
      return flows.some((f) => containsExecMarker(unwrapFlow(f)))
        ? [UNKNOWN_VIEW("نفدَ عمقُ التجسيدِ وتدفّقاتُ المعرّفِ باقيةٌ وفيها رمزُ تنفيذٍ ظاهرٌ — لا يُبرهَنُ براءةُ العضو")]
        : [];
    }
    const out: MemberView[] = [];
    for (const f of flows) out.push(...materializeViews(f, ctx, depth - 1));
    return out;
  }
  // المعالجةُ السادسةُ عشرةَ: `this` — مادّتُهُ الصنفُ أو الكائنُ الذي يحويهِ
  if (u.kind === ts.SyntaxKind.ThisKeyword) return thisViewOf(u as ts.ThisExpression);
  if (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) {
    const key = accessKey(u);
    if (key === null) return []; // المفتاحُ المحسوبُ يُسألُ عندَ القراءةِ (اتحادُ الأعضاءِ) لا عندَ النزولِ
    if (depth <= 0) {
      return containsExecMarker(u)
        ? [UNKNOWN_VIEW("نفدَ عمقُ التجسيدِ والوصولُ متداخلٌ وفيهِ رمزُ تنفيذٍ ظاهرٌ — لا يُبرهَنُ براءةُ العضو")]
        : [];
    }
    const out: MemberView[] = [];
    for (const view of materializeViews(u.expression, ctx, depth - 1)) {
      for (const m of viewMemberExpressions(view, key, ctx, depth - 1)) out.push(...materializeViews(m, ctx, depth - 1));
    }
    return out;
  }
  // شكلٌ غيرُ مجسَّدٍ — نتيجةُ نداءٍ أو تعبيرٌ لا مادّةَ لهُ: المسحُ البنيويُّ يفرّقُ (بريءٌ ⇒ لا منظورَ كما كانَ)
  return containsExecMarker(u)
    ? [UNKNOWN_VIEW("شكلٌ غيرُ مجسَّدٍ يحملُ رمزَ تنفيذٍ ظاهرًا — لا يُبرهَنُ براءةُ العضو")]
    : [];
}

/** صنفُ معرّفٍ في البرنامجِ المرئيِّ — أو `undefined` (المعالجةُ السادسةُ عشرةَ) */
function classOfIdentifier(u: ts.Identifier, ctx: ViewContext): ts.ClassDeclaration | ts.ClassExpression | undefined {
  const s = ctx.checker.getSymbolAtLocation(u);
  const d = s?.valueDeclaration ?? s?.declarations?.[0];
  if (d !== undefined && (ts.isClassDeclaration(d) || ts.isClassExpression(d)) && !d.getSourceFile().isDeclarationFile) return d;
  return undefined;
}

/** وحدةُ استيرادٍ ديناميكيٍّ — بالرمزِ على المحدِّدِ أو رمزِ نوعِ النداءِ (المعالجةُ السادسةُ عشرةَ) */
function importModuleSymbol(n: ts.CallExpression, ctx: ViewContext): ts.Symbol | undefined {
  const spec = n.arguments[0];
  if (spec === undefined) return undefined;
  try {
    const bySpec = ctx.checker.getSymbolAtLocation(spec);
    if (bySpec !== undefined) return bySpec;
    return ctx.checker.getTypeAtLocation(n).getSymbol() ?? undefined;
  } catch {
    return undefined;
  }
}

/** منظورُ `this` — أقربُ منهجٍ يحويهِ: صنفُهُ أو كائنُهُ الحرفيُّ (المعالجةُ السادسةُ عشرةَ) */
function thisViewOf(u: ts.ThisExpression): MemberView[] {
  // `this` ليس معرّفًا — أقربُ حاويٍّ منهجيٍّ يشهدُ لمادّتِه
  let p: ts.Node | undefined = u.parent;
  while (p !== undefined && !ts.isSourceFile(p)) {
    if ((ts.isMethodDeclaration(p) || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) && p.parent !== undefined) {
      if (ts.isClassDeclaration(p.parent) || ts.isClassExpression(p.parent)) return [{ kind: "class", node: p.parent }];
      if (ts.isObjectLiteralExpression(p.parent)) return [{ kind: "object", node: p.parent }];
    }
    p = p.parent;
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
    // المعالجةُ السادسةُ عشرةَ: النشرُ في عنصرِ المصفوفةِ — عناصرُ مصدرِهِ مرشّحةٌ كلُّها (الموضعُ مجهولٌ)
    for (const e of view.node.elements) {
      if (!ts.isSpreadElement(e)) continue;
      for (const v of materializeViews(e.expression, ctx, depth - 1)) {
        if (v.kind !== "array") continue;
        for (const se of v.node.elements) if (!ts.isOmittedExpression(se) && !ts.isSpreadElement(se)) out.push(se);
      }
    }
  } else if (view.kind === "assign") {
    // المعالجةُ السادسةُ عشرةَ: الدمجُ يُقرأُ من كلِّ حججِهِ — الحرفيُّ والمعرّفُ والهدفُ سواءٌ (جلسةُ gpt: الوسيطُ المعرفُ)
    for (const a of view.node.arguments) {
      for (const v of materializeViews(a, ctx, depth - 1)) out.push(...viewMemberExpressions(v, key, ctx, depth - 1));
    }
  } else if (view.kind === "class") {
    // المعالجةُ السادسةُ عشرةَ: الوراثةُ — الأعضاءُ تُطلَبُ من التعريفِ ومن أسلافِهِ المرئيّينَ (جلسةُ gemini)
    for (const m of classMemberNodes(view.node, new Set(), ctx.checker)) {
      if (ts.isPropertyDeclaration(m) && m.initializer !== undefined && m.name !== undefined && propertyKeyMatches(m.name, key)) out.push(m.initializer);
    }
  } else if (view.kind === "namespace") {
    const exp = exportOf(ctx.checker, view.symbol, key);
    const d = exp?.valueDeclaration ?? exp?.declarations?.[0];
    if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined) out.push(d.initializer);
  }
  return out;
}


/** أعضاءُ صنفٍ وأسلافُهُ المرئيّونَ — اتحادًا (المعالجةُ السادسةُ عشرةَ: الوراثةُ) */
export function classMemberNodes(cls: ts.ClassDeclaration | ts.ClassExpression, seen: Set<ts.ClassDeclaration | ts.ClassExpression>, checker: ts.TypeChecker): readonly ts.Node[] {
  if (seen.has(cls)) return [];
  seen.add(cls);
  const out: ts.Node[] = [...cls.members];
  for (const h of cls.heritageClauses ?? []) {
    if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
    for (const t of h.types) {
      const base = unwrapFlow(t.expression);
      if (!ts.isIdentifier(base)) continue;
      // الأصلُ يُحَلُّ بالمدقّقِ لا بالنصِّ — كنيّةُ الصنفِ وتصديرُهُ يُريانِ تعريفَهُ
      const s = checker.getSymbolAtLocation(base);
      const d = s?.valueDeclaration ?? s?.declarations?.[0];
      if (d !== undefined && (ts.isClassDeclaration(d) || ts.isClassExpression(d)) && !d.getSourceFile().isDeclarationFile) {
        out.push(...classMemberNodes(d, seen, checker));
      }
    }
  }
  return out;
}

/** منهجٌ أو جالبٌ في منظورٍ — قيمتُهُ إرجاعُهُ (تُسألُ من عرّافِ ملفِّهِ) */
export function viewMemberMethod(view: MemberView, key: string, ctx: ViewContext): ts.MethodDeclaration | ts.GetAccessorDeclaration | undefined {
  const members: readonly ts.Node[] = view.kind === "object" ? view.node.properties : view.kind === "class" ? classMemberNodes(view.node, new Set(), ctx.checker) : [];
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
