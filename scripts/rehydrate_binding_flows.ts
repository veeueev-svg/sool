/**
 * scripts/rehydrate_binding_flows.ts — **ماسحُ الربطِ**: جمعُ تدفّقاتِ الإسنادِ في ملفٍّ
 * واحدٍ قبلَ أوّلِ سؤالٍ (المرحلة 39 · W-2026-040 · تفكيكُ سقفِ الوحدةِ في المعالجةِ الرابعةَ
 * عشرةَ). يملكُ **جمعَ** التدفّقاتِ لا **الحكمَ عليها**: الماسحُ يقرأُ الشجرةَ مرةً واحدةً
 * ويبني خريطةَ (رمزٌ ← تعبيراتُ ما أُسندَ إليه)، والعرّافُ (`rehydrate_value_origin.ts`)
 * هو من يسألُ ويحكمُ. حدُّ القسمةِ سلطةٌ: من يُنتجُ الخريطةَ لا يَقرأُها.
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * الصلاحيات (RULE-004): يقرأُ الشجرةَ ويكتبُ في ذاكرةِ الجلسةِ — لا ملفًّا ولا حكمًا
 *
 * ## إلحاقٌ مؤرَّخٌ (2026-10-27 · المعالجةُ الخامسةَ عشرةَ · عيوبُ الجولةِ العاشرةِ)
 *
 * الترامبولينُ (`X.call`/`X.apply`/`X.bind`) يُحَلُّ إلى دالّةِ البرنامجِ التي يستقبلُها
 * الأساسُ — لا يُكتفى بتوقيعِ النداءِ الذي يعودُ إلى تعريفِ مكتبةٍ (`Function.apply` في
 * `.d.ts` فكانَ يُتخطّى الربطُ) — ووسائطُهُ الفعّالةُ تُفكُّ، والنشرُ من مصفوفةٍ حرفيّةٍ
 * (`f(...[a, b])`) يُفكُّ موضعيًّا. الماسحُ ما زالَ يجمعُ الحوافَّ وحدَها لا يُجسّدُ منظوراتٍ.
 */
import ts from "typescript";
import { resolvesToAssignMerge } from "./rehydrate_value_views";
import { arrayLiteralElement, bindingElementKey, callableWithParams, collectThrows, foldKey, isAssignment, objectLiteralMemberInitializer, symbolID, unwrapFlow, TRAMPOLINE_KEYS } from "./rehydrate_origin_model";

/**
 * قنواتُ المعاملاتِ بينَ الدوالِّ (المعالجةُ الرابعةَ عشرةَ · عيب 6): رمزُ المعاملِ ← وسيطُهُ
 * الفعليّ عندَ مواضعِ نداءِ دالتِهِ — خريطةٌ عامّةٌ بالرموزِ لا بملفٍّ (الرمزُ واحدٌ في
 * البرنامجِ كلِّهِ أينما ذُكرَ).
 */
export const paramFlowMap = new WeakMap<ts.Symbol, ts.Expression[]>();

/** خريطةُ تدفّقاتِ ملفٍّ واحدٍ — تُبنى بمسحٍ كاملٍ في المُنشئِ ثمّ تُقرأُ فقط */
export class BindingFlows {
  /** رموزُ المتغيّراتِ ← تدفّقاتُ إسنادِها (المُهيِّئُ وكلُّ إسنادٍ لاحقٍ في الملفِّ) */
  readonly varFlows = new Map<ts.Symbol, ts.Expression[]>();
  /** (رمزُ الأساسِ، المفتاحُ المطويُّ) ← تدفّقاتُ إعادةِ إسنادِ الخاصّيّةِ */
  private readonly propFlows = new Map<string, ts.Expression[]>();

  constructor(private readonly file: ts.SourceFile, private readonly checker: ts.TypeChecker) {
    this.scan();
  }

  /** تدفّقاتُ إعادةِ إسنادِ خاصّيّةٍ على رمزٍ — فارغةٌ إن لم تُسند */
  propFlowsOf(symbol: ts.Symbol, key: string): readonly ts.Expression[] {
    return this.propFlows.get(`${symbolID(symbol)}\u0000${key}`) ?? [];
  }

  /** مسحٌ واحدٌ للملفِّ كلِّهِ: الإسنادُ يُمسَكُ في ملفِّه */
  private scan(): void {
    const sym = (n: ts.Node): ts.Symbol | undefined => this.checker.getSymbolAtLocation(n);
    const visit = (n: ts.Node): void => {
      // المعالجةُ الرابعةَ عشرةَ (عيب 4): قنواتُ الربطِ تصلُ إلى العضوِ لا المُهيِّئِ كاملًا —
      // التفكيكُ من حرفيٍّ يُربَطُ عضوُهُ بمعرّفِهِ (وإلّا فالمُهيِّئُ كاملًا كما كان)
      if (ts.isVariableDeclaration(n) && n.initializer !== undefined) {
        const initU = unwrapFlow(n.initializer);
        let boundToMember = false;
        if (ts.isObjectBindingPattern(n.name) && ts.isObjectLiteralExpression(initU)) {
          boundToMember = true;
          for (const el of n.name.elements) {
            if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
            const m = objectLiteralMemberInitializer(initU, bindingElementKey(el));
            if (m !== undefined) this.addFlow(sym(el.name), m);
          }
        } else if (ts.isArrayBindingPattern(n.name) && ts.isArrayLiteralExpression(initU)) {
          boundToMember = true;
          n.name.elements.forEach((el, i) => {
            if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) return;
            const m = arrayLiteralElement(initU, i);
            if (m !== undefined) this.addFlow(sym(el.name), m);
          });
        }
        if (!boundToMember) {
          const roots: ts.Identifier[] = [];
          if (ts.isIdentifier(n.name)) roots.push(n.name);
          else this.collectBindingNames(n.name, roots);
          for (const r of roots) this.addFlow(sym(r), n.initializer);
        }
      }
      if (ts.isBinaryExpression(n) && isAssignment(n.operatorToken.kind)) {
        if (ts.isIdentifier(n.left)) this.addFlow(sym(n.left), n.right);
        if (ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression)) {
          this.addPropFlow(sym(n.left.expression), n.left.name.text, n.right);
        }
        if (ts.isElementAccessExpression(n.left) && ts.isIdentifier(n.left.expression)) {
          const k = foldKey(n.left.argumentExpression);
          if (k !== null) this.addPropFlow(sym(n.left.expression), k, n.right);
        }
      }
      if (ts.isForOfStatement(n) && ts.isVariableDeclarationList(n.initializer)) {
        const roots: ts.Identifier[] = [];
        for (const d of n.initializer.declarations) this.collectBindingNames(d.name, roots);
        const exprU = unwrapFlow(n.expression);
        // المعالجةُ الرابعةَ عشرةَ (عيب 4): عنصرُ for-of على مصفوفةٍ حرفيّةٍ — أصلُهُ اتحادُ عناصرِها
        if (ts.isArrayLiteralExpression(exprU)) {
          for (const r of roots) {
            for (const el of exprU.elements) {
              if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) this.addFlow(sym(r), el);
            }
          }
        } else {
          for (const r of roots) this.addFlow(sym(r), n.expression);
        }
      }
      // المعالجةُ الرابعةَ عشرةَ (عيب 4): قناةُ catch — المتغيّرُ يُربَطُ بتعبيراتِ throw في الكتلةِ المحروسةِ
      if (ts.isCatchClause(n)) {
        const v = n.variableDeclaration;
        const parent = n.parent;
        if (v !== undefined && ts.isIdentifier(v.name) && parent !== undefined && ts.isTryStatement(parent)) {
          const thrown: ts.Expression[] = [];
          collectThrows(parent.tryBlock, thrown);
          for (const t of thrown) this.addFlow(sym(v.name), t);
        }
      }
      // المعالجةُ الرابعةَ عشرةَ (عيب 6): مواضعُ نداءِ الدالّةِ تربطُ معاملاتِها بوسائطِها الفعليّةِ —
      // المعاملُ المعلَنُ النوعِ يُسألُ عن أصلِهِ عندَ استدعائِهِ أو ترامبولينِهِ (لا يُخضَّرُ كذبًا).
      // المعالجةُ الخامسةَ عشرةَ (DECLARED_INTERPROC_APPLY_BIND_SPREAD_STILL_A_DOOR): الترامبولينُ
      // (`X.call`/`X.apply`/`X.bind`) يُحَلُّ إلى دالّةِ البرنامجِ التي يستقبلُها الأساسُ (لا
      // تعريفَ مكتبةٍ) ووسائطُهُ الفعّالةُ تُفكُّ (call/bind يُزاحُ وسيطُها · apply تُفكُّ مصفوفةُ الحرفيّاتِ) —
      // والنشرُ `f(...[a, b])` يُفكُّ من حرفيّاتِ المصفوفةِ عنصرًا عنصرًا موضعيًّا.
      if (ts.isCallExpression(n)) {
        const callee = unwrapFlow(n.expression);
        let decl = this.checker.getResolvedSignature(n)?.declaration;
        let args: readonly ts.Expression[] = n.arguments;
        if (decl === undefined || decl.getSourceFile().isDeclarationFile) {
          if (ts.isPropertyAccessExpression(callee) && TRAMPOLINE_KEYS.has(callee.name.text)) {
            const target = this.checker.getTypeAtLocation(callee.expression).getCallSignatures()[0]?.declaration;
            if (target !== undefined && !target.getSourceFile().isDeclarationFile && callableWithParams(target)) {
              decl = target;
              args = effectiveTrampolineArguments(callee.name.text, n);
            }
          }
        }
        if (decl !== undefined && callableWithParams(decl) && !decl.getSourceFile().isDeclarationFile) {
          args = expandSpreadLiterals(args);
          // المعالجةُ السادسةُ عشرةَ (جلسةُ grok — النقشُ 6): أنماطُ التفكيكِ في المعاملاتِ تُربَطُ عضوًا
          // عضوًا بحجّةِ الكائنِ الحرفيِّ (والمصفوفةِ موضعيًّا) — فتُرى من موضعِ النداءِ لا من جذرِها
          decl.parameters.forEach((p, i) => {
            if (ts.isObjectBindingPattern(p.name)) {
              const arg = args[i];
              if (arg !== undefined && ts.isObjectLiteralExpression(arg)) {
                for (const el of p.name.elements) {
                  if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
                  const m = objectLiteralMemberInitializer(arg, el.propertyName === undefined ? el.name.text : keyOfPropertyName(el.propertyName));
                  if (m !== undefined) addParamFlow(sym(el.name), m);
                  else addParamFlow(sym(el.name), arg);
                }
              } else if (arg !== undefined && !ts.isSpreadElement(arg)) {
                for (const el of p.name.elements) {
                  if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) addParamFlow(sym(el.name), arg);
                }
              }
              return;
            }
            if (ts.isArrayBindingPattern(p.name)) {
              const arg = args[i];
              if (arg !== undefined && ts.isArrayLiteralExpression(arg)) {
                p.name.elements.forEach((el, j) => {
                  if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) return;
                  const m = arrayLiteralElement(arg, j);
                  if (m !== undefined) addParamFlow(sym(el.name), m);
                });
              }
              return;
            }
            if (!ts.isIdentifier(p.name)) return;
            if (p.dotDotDotToken !== undefined) {
              // وسيطُ الراحةِ — بقايّا الوسائطِ من الموضعِ (مصفوفةً حرفيّةً صُنعتْ من هذا النداءِ)
              const rest = args.slice(i).filter((a) => !ts.isSpreadElement(a));
              addParamFlow(sym(p.name), ts.factory.createArrayLiteralExpression(rest));
              return;
            }
            const arg = args[i];
            if (arg !== undefined && !ts.isSpreadElement(arg)) addParamFlow(sym(p.name), arg);
          });
        }
        // المعالجةُ السادسةُ عشرةَ (جلسةُ grok — النقشُ 6): طفرةُ `Object.assign` على هدفٍ معرّفٍ —
        // كلُّ عضوٍ من حججِ الكائناتِ الحرفيّةِ يصيرُ تدفّقَ خاصّيّةٍ للهدفِ (الكنيّةُ والمرجعُ يُعامَلانِ دمجًا)
        if (resolvesToAssignMerge(n, this.checker)) {
          const target = n.arguments[0];
          if (target !== undefined && ts.isIdentifier(target)) {
            for (const a of n.arguments.slice(1)) {
              if (!ts.isObjectLiteralExpression(a)) continue;
              for (const m of a.properties) {
                if (ts.isPropertyAssignment(m) && ts.isIdentifier(m.name)) this.addPropFlow(sym(target), m.name.text, m.initializer);
                if (ts.isPropertyAssignment(m) && ts.isStringLiteral(m.name)) this.addPropFlow(sym(target), m.name.text, m.initializer);
                if (ts.isSpreadAssignment(m)) this.bindSpreadToTarget(sym(target), m.expression);
              }
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(this.file);
  }

  /** نشرُ حرفيّاتِ الكائنِ على هدفِ الدمجِ — أعضاءُ المصدرِ الحرفيِّ تُربَطُ بالهدفِ */
  private bindSpreadToTarget(targetSym: ts.Symbol | undefined, expr: ts.Expression): void {
    const u = unwrapFlow(expr);
    if (ts.isObjectLiteralExpression(u)) {
      for (const m of u.properties) {
        if (ts.isPropertyAssignment(m) && ts.isIdentifier(m.name)) this.addPropFlow(targetSym, m.name.text, m.initializer);
      }
      return;
    }
    if (ts.isIdentifier(u)) {
      const s = this.checker.getSymbolAtLocation(u);
      const srcDecl = s?.valueDeclaration ?? s?.declarations?.find((x) => x !== undefined);
      if (srcDecl !== undefined && ts.isVariableDeclaration(srcDecl) && srcDecl.initializer !== undefined) this.bindSpreadToTarget(targetSym, srcDecl.initializer);
    }
  }

  private collectBindingNames(name: ts.BindingName, out: ts.Identifier[]): void {
    if (ts.isIdentifier(name)) out.push(name);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) this.collectBindingNames(el.name, out);
      }
    }
  }

  private addFlow(symbol: ts.Symbol | undefined, rhs: ts.Expression): void {
    if (symbol === undefined) return;
    const flows = this.varFlows.get(symbol);
    if (flows === undefined) this.varFlows.set(symbol, [rhs]);
    else flows.push(rhs);
  }

  private addPropFlow(symbol: ts.Symbol | undefined, key: string, rhs: ts.Expression): void {
    if (symbol === undefined) return;
    const id = `${symbolID(symbol)}\u0000${key}`;
    const flows = this.propFlows.get(id);
    if (flows === undefined) this.propFlows.set(id, [rhs]);
    else flows.push(rhs);
  }
}

/** مفتاحُ اسمِ الخاصّيّةِ في عنصرِ التفكيكِ (اسمٌ بسيطٌ أو حرفيّ) */
function keyOfPropertyName(p: ts.PropertyName): string {
  return ts.isIdentifier(p) ? p.text : ts.isStringLiteral(p) || ts.isNumericLiteral(p) ? p.text : "";
}

/** قناةُ المعاملِ بينَ الدوالِّ — عامّةٌ بالرموزِ (المعالجةُ الرابعةَ عشرةَ · عيب 6) */
function addParamFlow(symbol: ts.Symbol | undefined, rhs: ts.Expression): void {
  if (symbol === undefined) return;
  const flows = paramFlowMap.get(symbol);
  if (flows === undefined) paramFlowMap.set(symbol, [rhs]);
  else flows.push(rhs);
}

/**
 * وسائطُ الترامبولينِ الفعّالةُ (المعالجةُ الخامسةَ عشرةَ): `X.call(t, a, b)` ⇐ [a, b] ·
 * `X.bind(t, a)` ⇐ [a] · `X.apply(t, [a, b])` ⇐ عناصرُ المصفوفةِ الحرفيّةِ (أو وسيطاتُها كما هي).
 */
function effectiveTrampolineArguments(member: string, n: ts.CallExpression): readonly ts.Expression[] {
  if (member === "apply") {
    const arr = n.arguments[1] !== undefined ? unwrapFlow(n.arguments[1]) : undefined;
    if (arr !== undefined && ts.isArrayLiteralExpression(arr)) {
      return arr.elements.filter((el) => !ts.isSpreadElement(el) && !ts.isOmittedExpression(el));
    }
    return n.arguments.slice(1);
  }
  return n.arguments.slice(1); // call · bind — وسيطُ المستقبِلِ يُزاحُ
}

/** النشرُ من مصفوفةٍ حرفيّةٍ `f(...[a, b])` — يُفكُّ موضعيًّا (المعالجةُ الخامسةَ عشرةَ) */
function expandSpreadLiterals(args: readonly ts.Expression[]): readonly ts.Expression[] {
  const out: ts.Expression[] = [];
  for (const a of args) {
    if (!ts.isSpreadElement(a)) {
      out.push(a);
      continue;
    }
    const u = unwrapFlow(a.expression);
    if (ts.isArrayLiteralExpression(u)) {
      for (const el of u.elements) if (!ts.isSpreadElement(el) && !ts.isOmittedExpression(el)) out.push(el);
    } else {
      out.push(a);
    }
  }
  return out;
}
