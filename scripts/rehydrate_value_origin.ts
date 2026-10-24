/**
 * scripts/rehydrate_value_origin.ts — **أصلُ القيمة**: من أين جاءت هذه القيمة؟
 * (المرحلة 39 · W-2026-040 · المعالجةُ الثالثةَ عشرةَ — عيوبُ الجولةِ الثامنةِ الخمسةِ الباقية)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: تعبيرٌ في شجرةِ نحوِ ملفٍّ من `src/**` ومدقّقُ أنواعِ البرنامج
 * المخرجات: أصلُ قيمةِ التعبير — بياناتٌ أو تنفيذٌ ديناميكيّ أو معتمٌ أو كائنٌ عالميٌّ
 * التبعيات: مُترجمُ TypeScript وحدَه
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 *
 * ## الجولةُ الثامنةُ سمّتِ الجذرَ: الحاجزُ كان يقيسُ **موقعَ النداءِ** لا **مصدرَ القيمةِ**
 *
 * `eval` يعبرُ `f.call(…)` و`Reflect.apply(eval, …)` وربطًا نوعيًّا (`const run: (code) => unknown =
 * eval`) وتغسيلًا بـ`any` (`const evil: any = eval`) لأنّ الفحصَ يسألُ نوعَ المستدعى **عندَ
 * النداءِ** والتعبيرُ المستقبِلُ (الترامبولين) يخفيه. فصارَ القياسُ **تدفّقًا للأصلِ**: لكلِّ
 * تعبيرٍ جوابٌ عن سؤالٍ واحد — من أين جاءت قيمتُه؟ — والجوابُ يتبعُ الإسنادَ لا الاسمَ ولا
 * النوعَ المعلَنَ (التحويلُ `as` يمحو النوعَ لا القيمةَ، وفكُّ الأغلفةِ يتبعُ القيمةَ):
 *
 *   - **بياناتٌ (data):** قيمةٌ جذمها مرئيٌّ في البرنامج أو معجمٌ مغلقٌ بريء — دالّةٌ معرّفةٌ
 *     في الملف، حرفيّات، كائناتٌ محلية، معاملٌ نوعُه محدَّدٌ.
 *   - **تنفيذٌ (exec):** رموزُ التنفيذِ (`eval` · `Function` · `require` · `Reflect.get/apply/
 *     construct` · `Object.getOwnPropertyDescriptor` · `import()`) وقيمٌ **جرى** أصلُها إليها.
 *   - **معتمٌ (opaque):** ما لا يُبرهَنُ براءةُ أصلِه — معاملٌ `any`/`unknown`، فهرسةٌ غيرُ
 *     مطويةٍ على الكائنِ العالميّ، مفتاحٌ معادٌ إسنادُه.
 *   - **عالميٌّ (global):** الكائنُ العالميُّ نفسُه وقيمٌ جرى أصلُها إليه (بما فيه العبورُ بينَ
 *     الوحداتِ) — بابُهُ الخاصُّ يُقاسُ عندَ الوصولِ بالخاصّيّةِ.
 *   - **بابٌ (door):** كائناتُ الأبوابِ `Reflect` و`Object` — مفاتيحُها الانعكاسيّةُ تنفيذٌ.
 *
 * **حدٌّ معلَنٌ (ميراثُ الجولات):** التدفّقُ داخلَ ملفٍّ واحدٍ (الإسنادُ يُمسَكُ في ملفِّهِ
 * عبرَ مسحٍ كاملٍ قبلَ السؤال) مع عبورِ الاستيرادِ إلى مُعرِّفِه؛ أما تمريرُ القيمِ **بينَ
 * الدوالِّ عبرَ المعاملات** فتحليلٌ بينيٌّ خارجُ هذا البندِ (دَينُ RC-07 المفتوحِ) — الحارسُ
 * التشغيليُّ `assertExemptionsHold` عندَ قراءةِ اليوميّةِ يبقى الشاهدَ السلوكيَّ عليه.
 */
import ts from "typescript";

/** أصنافُ الأصلِ — معجمٌ مغلقٌ لا ثالثَ ولا خامسَ */
export type OriginKind = "data" | "exec" | "opaque" | "global" | "door";
export interface ValueOrigin {
  readonly kind: OriginKind;
  readonly why: string;
}

const DATA: ValueOrigin = { kind: "data", why: "" };
const EXEC = (why: string): ValueOrigin => ({ kind: "exec", why });
const OPAQUE = (why: string): ValueOrigin => ({ kind: "opaque", why });
const GLOBAL: ValueOrigin = { kind: "global", why: "الكائنُ العالميُّ" };
const DOOR = (why: string): ValueOrigin => ({ kind: "door", why });

/** أسماءُ رموزِ التنفيذِ العالميّةِ — وصولُها المباشرُ أو مرورُها قيمةً تنفيذٌ */
const EXEC_GLOBAL_NAMES = new Set(["eval", "Function", "FunctionConstructor", "require"]);
/** مفاتيحُ أبوابِ النصِّ على الكائنِ العالميّ — مطويةً أو بالاسمِ */
const GLOBAL_EXEC_KEYS = new Set(["eval", "Function", "constructor", "require"]);
/** مفاتيحُ البابِ الانعكاسيّةُ على كائناتِ الأبوابِ */
const REFLECT_DOOR_KEYS = new Set(["get", "apply", "construct"]);
const OBJECT_DOOR_KEYS = new Set(["getOwnPropertyDescriptor"]);
/** أعضاءُ الترامبولينِ — المستقبِلُ هو الفاعلُ لا العضوُ */
const TRAMPOLINE_KEYS = new Set(["call", "apply", "bind"]);

const EXEC_UNION = (a: ValueOrigin, b: ValueOrigin): ValueOrigin => {
  if (a.kind === "exec" || b.kind === "exec") return a.kind === "exec" ? a : b;
  if (a.kind === "opaque" || b.kind === "opaque") return a.kind === "opaque" ? a : b;
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

/** المفتاحُ المحسوبُ يُطوى من حرفيّاتٍ صريحةٍ (اقترانُ `+` وقالبٌ بلا فتحاتٍ) — لا يخمّن */
function foldKey(e: ts.Expression): string | null {
  const u = unwrapFlow(e);
  if (ts.isStringLiteral(u) || ts.isNoSubstitutionTemplateLiteral(u)) return u.text;
  if (ts.isBinaryExpression(u) && u.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldKey(u.left);
    const r = foldKey(u.right);
    return l === null || r === null ? null : l + r;
  }
  return null;
}

const oracleCache = new WeakMap<ts.SourceFile, ValueOriginOracle>();

/** عرّافُ الأصلِ لملفٍّ واحدٍ — يُبنى مرّةً (مسحُ الإسنادِ) ثم يُسألُ مرارًا */
export function valueOriginOracle(file: ts.SourceFile, checker: ts.TypeChecker): ValueOriginOracle {
  let o = oracleCache.get(file);
  if (o === undefined) {
    o = new ValueOriginOracle(file, checker);
    oracleCache.set(file, o);
  }
  return o;
}

export class ValueOriginOracle {
  /** رموزُ المتغيّراتِ ← تدفّقاتُ إسنادِها (المُهيِّئُ وكلُّ إسنادٍ لاحقٍ في الملفِّ) */
  private readonly varFlows = new Map<ts.Symbol, ts.Expression[]>();
  /** (رمزُ الأساسِ، المفتاحُ المطويُّ) ← تدفّقاتُ إعادةِ إسنادِ الخاصّيّةِ */
  private readonly propFlows = new Map<string, ts.Expression[]>();
  private readonly visiting = new Set<ts.Symbol>();
  private readonly checker: ts.TypeChecker;

  constructor(private readonly file: ts.SourceFile, checker: ts.TypeChecker) {
    this.checker = checker;
    this.scan();
  }

  /** مسحٌ واحدٌ للملفِّ كلِّهِ قبلَ أوّلِ سؤالٍ: الإسنادُ يُمسَكُ في ملفِّه */
  private scan(): void {
    const sym = (n: ts.Node): ts.Symbol | undefined => this.checker.getSymbolAtLocation(n);
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && n.initializer !== undefined) {
        const roots: ts.Identifier[] = [];
        if (ts.isIdentifier(n.name)) roots.push(n.name);
        else this.collectBindingNames(n.name, roots);
        for (const r of roots) this.addFlow(sym(r), n.initializer);
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
        for (const r of roots) this.addFlow(sym(r), n.expression);
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

  private propFlowsOf(symbol: ts.Symbol, key: string): readonly ts.Expression[] {
    return this.propFlows.get(`${symbolID(symbol)}\u0000${key}`) ?? [];
  }

  /** أصلُ قيمةِ التعبيرِ — السؤالُ الواحدُ: من أين جاءت؟ */
  originOf(e: ts.Expression): ValueOrigin {
    const u = unwrapFlow(e);
    if (ts.isIdentifier(u)) return this.identOrigin(u);
    if (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) return this.propOrigin(u);
    if (ts.isCallExpression(u)) return this.callOrigin(u);
    if (ts.isNewExpression(u)) {
      const callee = unwrapFlow(u.expression);
      return ts.isIdentifier(callee) && this.libGlobalName(callee) === "Function" ? EXEC("new Function(…) — منشئُ دالّةٍ من نصّ") : DATA;
    }
    if (ts.isFunctionExpression(u) || ts.isArrowFunction(u)) return DATA;
    if (ts.isConditionalExpression(u)) return EXEC_UNION(this.originOf(u.whenTrue), this.originOf(u.whenFalse));
    if (ts.isBinaryExpression(u)) {
      const op = u.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return EXEC_UNION(this.originOf(u.left), this.originOf(u.right));
      }
      return DATA;
    }
    return DATA;
  }

  private libGlobalName(id: ts.Identifier): string | null {
    const s = this.checker.getSymbolAtLocation(id);
    const d = s?.valueDeclaration;
    if (s !== undefined && d !== undefined && d.getSourceFile().isDeclarationFile && EXEC_GLOBAL_NAMES.has(s.name)) return s.name;
    if (s !== undefined && d !== undefined && d.getSourceFile().isDeclarationFile && (s.name === "Reflect" || s.name === "Object")) return s.name;
    return null;
  }

  private identOrigin(id: ts.Identifier): ValueOrigin {
    const s = this.checker.getSymbolAtLocation(id);
    // الرمزُ غيرُ المحلولِ لا يدخلُ برنامجًا مترجَمًا (فشلُ tsc «Cannot find name») فلا يكونُ وجهَ
    // إنتاجٍ قابلاً للحياةِ؛ وبقاءُ الحاجزِ أخضرَ عليه يحفظُ الوجهَ الحيَّ الخامسَ (جولةُ المجلسِ 5).
    if (s === undefined) return { kind: "data", why: "رمزٌ غيرُ محلولٍ — لا يدخلُ برنامجًا مترجَمًا" };
    const d = s.valueDeclaration;
    if (d !== undefined && d.getSourceFile().isDeclarationFile) {
      if (id.text === "globalThis") return GLOBAL;
      if (EXEC_GLOBAL_NAMES.has(s.name)) return EXEC(`«${s.name}» — رمزُ تنفيذٍ عالميّ`);
      if (s.name === "Reflect" || s.name === "Object") return DOOR(`«${s.name}» — كائنُ بابٍ انعكاسيّ`);
      return DATA;
    }
    if (id.text === "globalThis") return GLOBAL;
    if (d !== undefined && ts.isParameter(d)) return this.paramOrigin(s, d);
    if (d !== undefined && ts.isVariableDeclaration(d)) {
      if (this.visiting.has(s)) return DATA; // إسنادٌ ذاتيّ — لا أصلَ يُتبع
      this.visiting.add(s);
      try {
        const flows = this.varFlows.get(s);
        if (flows === undefined) return DATA;
        return flows.reduce((acc, f) => EXEC_UNION(acc, this.originOf(f)), DATA);
      } finally {
        this.visiting.delete(s);
      }
    }
    if (d !== undefined && ts.isImportSpecifier(d)) {
      const target = this.checker.getAliasedSymbol(s);
      const td = target?.valueDeclaration;
      if (target !== undefined && td !== undefined && ts.isVariableDeclaration(td) && td.initializer !== undefined) {
        return valueOriginOracle(td.getSourceFile(), this.checker).originOf(td.initializer);
      }
      return DATA;
    }
    // دالّةٌ أو صنفٌ معرّفٌ في البرنامج — جسمُه مرئيٌّ والنفيُ يقرؤه
    return DATA;
  }

  /** معاملٌ: نوعُه المحلولُ هو المتاحُ — `any`/`unknown` معتمٌ (لا برهانَ على براءةِ المصدر) */
  private paramOrigin(s: ts.Symbol, d: ts.ParameterDeclaration): ValueOrigin {
    const t = this.checker.getTypeOfSymbolAtLocation(s, d.name);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return OPAQUE("معاملٌ بلا نوعٍ مبرهَنٍ — مصدرُ قيمتِهِ مجهول");
    return DATA;
  }

  /** الوصولُ بالخاصّيّةِ أو الفهرسِ — أبوابُ الكائنِ العالميّ والأشياءِ الحرفيّةِ والأبوابِ الانعكاسيّةِ */
  private propOrigin(n: ts.PropertyAccessExpression | ts.ElementAccessExpression): ValueOrigin {
    const key = ts.isPropertyAccessExpression(n) ? n.name.text : foldKey(n.argumentExpression);
    const baseOrigin = this.originOf(n.expression);
    if (baseOrigin.kind === "global") return this.globalDoor(key, n);
    if (baseOrigin.kind === "exec") {
      // «require.main» فحصُ الوحدةِ الرئيسةِ بياناتٌ لا تنفيذٌ — استثناءٌ معلَنٌ لا تعميمٌ
      const baseU2 = unwrapFlow(n.expression);
      if (ts.isIdentifier(baseU2) && baseU2.text === "require" && key === "main") return DATA;
      return baseOrigin;
    }
    if (baseOrigin.kind === "opaque") return DATA; // خاصّيّةٌ على قيمةٍ غيرِ مبرهَنِ الأصلِ — حدُّ المعاملاتِ المعلَن
    if (baseOrigin.kind === "door") {
      const baseU = unwrapFlow(n.expression);
      const name = ts.isIdentifier(baseU) ? baseU.text : "";
      if (name === "Reflect" && key !== null && REFLECT_DOOR_KEYS.has(key)) return EXEC(`«Reflect.${key}» — بابٌ انعكاسيّ`);
      if (name === "Object" && key !== null && OBJECT_DOOR_KEYS.has(key)) return EXEC("«Object.getOwnPropertyDescriptor» — واصفٌ يبلغُ القيمةَ ديناميكيًّا");
      return DATA;
    }
    // أساسٌ بياناتٌ: كائنٌ حرفيٌّ — أصلُ الخاصّيّةِ مُهيِّئُها مدموجًا مع كلِّ إعادةِ إسنادٍ لها
    if (key === "constructor" && baseOrigin.kind === "data") {
      // منشئُ قيمةٍ دالّيّةٍ هو `Function` نفسُهُ — بابُ منشئِ الدالّةِ من نصّ (قيمةُ القاعدةِ تُتبع)
      const baseT = this.checker.getTypeAtLocation(n.expression);
      if ((baseT.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 && (baseT.getCallSignatures().length > 0 || baseT.getConstructSignatures().length > 0)) {
        return EXEC("منشئُ قيمةٍ دالّيّةٍ هو Function — بابُ منشئِ الدالّةِ من نصّ");
      }
    }
    if (key !== null) {
      const decl = this.literalRootOf(n.expression);
      if (decl !== undefined) {
        const flows = this.propFlowsOf(decl, key).map((f) => this.originOf(f));
        const own = this.literalMemberOrigin(decl, key);
        return flows.reduce((acc, f) => EXEC_UNION(acc, f), own);
      }
    }
    return DATA;
  }

  /** بابُ الكائنِ العالميّ: مفاتيحُ التنفيذِ تُرفَضُ · المعروفةُ النوعَ تُخضَرّ · غيرُ المطويةِ معتمةٌ */
  private globalDoor(key: string | null, n: ts.PropertyAccessExpression | ts.ElementAccessExpression): ValueOrigin {
    if (key !== null && GLOBAL_EXEC_KEYS.has(key)) return EXEC(`«globalThis['${key}']» — بابُ تنفيذٍ على الكائنِ العالميّ`);
    if (key === null) return OPAQUE("فهرسةٌ غيرُ مطويةٍ على الكائنِ العالميّ — لا يُبرهَنُ براءةُ المفتاح");
    const t = this.checker.getTypeAtLocation(n);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
      return OPAQUE(`«globalThis['${key}']» — مفتاحٌ لا يُحَلُّ إلى قيمةٍ معروفةِ النوع`);
    }
    // سلسلةُ الكائنِ العالميّ وكائناتُ الأبوابِ تحفظُ بابَها عبرَ الخاصّيّةِ
    if (this.checker.typeToString(t) === "typeof globalThis") return GLOBAL;
    const s = this.checker.getSymbolAtLocation(n);
    const sd = s?.valueDeclaration;
    if (s !== undefined && sd !== undefined && sd.getSourceFile().isDeclarationFile) {
      if (s.name === "Reflect" || s.name === "Object") return DOOR(`«${s.name}» — كائنُ بابٍ انعكاسيّ`);
      if (s.name === "globalThis") return GLOBAL;
    }
    return DATA;
  }

  /** إن كانَ الأساسُ متغيّرًا مُهيَّئُهُ كائنٌ حرفيٌّ فأصلُ أعضائِهِ يُقاسُ من المُهيِّئِ */
  private literalRootOf(base: ts.Expression): ts.Symbol | undefined {
    const u = unwrapFlow(base);
    if (!ts.isIdentifier(u)) return undefined;
    const s = this.checker.getSymbolAtLocation(u);
    const d = s?.valueDeclaration;
    if (s === undefined || d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
    return unwrapFlow(d.initializer).kind === ts.SyntaxKind.ObjectLiteralExpression ? s : undefined;
  }

  private literalMemberOrigin(objSymbol: ts.Symbol, key: string): ValueOrigin {
    const d = objSymbol.valueDeclaration;
    if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return DATA;
    const init = unwrapFlow(d.initializer);
    if (!ts.isObjectLiteralExpression(init)) return DATA;
    for (const p of init.properties) {
      if (ts.isPropertyAssignment(p) && p.name.getText(this.file) === key) return this.originOf(p.initializer);
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return this.identOrigin(p.name);
    }
    return DATA;
  }

  /** نتيجةُ النداءِ: مستدعًى أصلهُ تنفيذٌ فالقيمةُ تنفيذٌ · وإلا فبياناتٌ */
  private callOrigin(n: ts.CallExpression): ValueOrigin {
    const callee = unwrapFlow(n.expression);
    // الترامبولين: العضوُ واجهةٌ والفاعلُ الأساسُ — القيمةُ المُسندةُ هي أصلُ النداءِ
    if (ts.isPropertyAccessExpression(callee) && TRAMPOLINE_KEYS.has(callee.name.text)) {
      return this.originOf(callee.expression);
    }
    const calleeOrigin = this.originOf(n.expression);
    if (calleeOrigin.kind === "exec") return calleeOrigin;
    if (calleeOrigin.kind === "opaque") return calleeOrigin;
    if (calleeOrigin.kind === "global" || calleeOrigin.kind === "door") return OPAQUE("نداءٌ على الكائنِ العالميّ أو بابِه — بلا برهانِ براءة");
    return DATA;
  }
}

const symbolIDs = new WeakMap<ts.Symbol, number>();
let symbolSeq = 0;
function symbolID(s: ts.Symbol): number {
  const hit = symbolIDs.get(s);
  if (hit !== undefined) return hit;
  const id = ++symbolSeq;
  symbolIDs.set(s, id);
  return id;
}

function isAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** وسيطاتُ النداءِ الفعّالةُ بعدَ فكِّ الترامبولين — للبابِ الأولِ (تسرّبُ اليوميّةِ وسيطًا) */
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
