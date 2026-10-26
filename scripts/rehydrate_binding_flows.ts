/**
 * scripts/rehydrate_binding_flows.ts — **ماسحُ الربطِ**: جمعُ تدفّقاتِ الإسنادِ في ملفٍّ
 * واحدٍ قبلَ أوّلِ سؤالٍ (المرحلة 39 · W-2026-040 · تفكيكُ سقفِ الوحدةِ في المعالجةِ الرابعةَ
 * عشرةَ). يملكُ **جمعَ** التدفّقاتِ لا **الحكمَ عليها**: الماسحُ يقرأُ الشجرةَ مرةً واحدةً
 * ويبني خريطةَ (رمزٌ ← تعبيراتُ ما أُسندَ إليه)، والعرّافُ (`rehydrate_value_origin.ts`)
 * هو من يسألُ ويحكمُ. حدُّ القسمةِ سلطةٌ: من يُنتجُ الخريطةَ لا يَقرأُها.
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * الصلاحيات (RULE-004): يقرأُ الشجرةَ ويكتبُ في ذاكرةِ الجلسةِ — لا ملفًّا ولا حكمًا
 */
import ts from "typescript";
import { arrayLiteralElement, bindingElementKey, callableWithParams, collectThrows, foldKey, isAssignment, objectLiteralMemberInitializer, symbolID, unwrapFlow } from "./rehydrate_origin_model";

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
      // المعاملُ المعلَنُ النوعِ يُسألُ عن أصلِهِ عندَ استدعائِهِ أو ترامبولينِهِ (لا يُخضَّرُ كذبًا)
      if (ts.isCallExpression(n)) {
        const decl = this.checker.getResolvedSignature(n)?.declaration;
        if (decl !== undefined && callableWithParams(decl) && !decl.getSourceFile().isDeclarationFile) {
          decl.parameters.forEach((p, i) => {
            if (p.dotDotDotToken !== undefined || !ts.isIdentifier(p.name)) return;
            const arg = n.arguments[i];
            if (arg !== undefined && !ts.isSpreadElement(arg)) addParamFlow(sym(p.name), arg);
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(this.file);
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

/** قناةُ المعاملِ بينَ الدوالِّ — عامّةٌ بالرموزِ (المعالجةُ الرابعةَ عشرةَ · عيب 6) */
function addParamFlow(symbol: ts.Symbol | undefined, rhs: ts.Expression): void {
  if (symbol === undefined) return;
  const flows = paramFlowMap.get(symbol);
  if (flows === undefined) paramFlowMap.set(symbol, [rhs]);
  else flows.push(rhs);
}
