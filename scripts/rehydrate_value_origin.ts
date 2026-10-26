/**
 * scripts/rehydrate_value_origin.ts — **أصلُ القيمة**: من أين جاءت هذه القيمة؟
 * (المرحلة 39 · W-2026-040 · المعالجةُ الرابعةَ عشرةَ — عيوبُ الجولةِ التاسعةِ الستةِ)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: تعبيرٌ في شجرةِ نحوِ ملفٍّ من `src/**` ومدقّقُ أنواعِ البرنامج
 * المخرجات: أصلُ قيمةِ التعبيرِ — بياناتٌ أو تنفيذٌ ديناميكيّ أو معتمٌ أو كائنٌ عالميٌّ
 * التبعيات: مُترجمُ TypeScript وحدَه
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 *
 * ## الجولةُ الثامنةُ سمّتِ الجذرَ: الحاجزُ كان يقيسُ **موقعَ النداءِ** لا **مصدرَ القيمةِ**
 *
 * `eval` يعبرُ `f.call(…)` و`Reflect.apply(eval, …)` وربطًا نوعيًّا وتغسيلًا بـ`any` لأنّ
 * الفحصَ يسألُ نوعَ المستدعى **عندَ النداءِ** والتعبيرُ المستقبِلُ يخفيه. فصارَ القياسُ
 * **تدفّقًا للأصلِ**: لكلِّ تعبيرٍ جوابٌ عن سؤالٍ واحد — من أين جاءت قيمتُه؟ — والجوابُ
 * يتبعُ الإسنادَ لا الاسمَ ولا النوعَ المعلَنَ (`as` يمحو النوعَ لا القيمةَ، وفكُّ الأغلفةِ
 * يتبعُ القيمةَ): **بياناتٌ (data)** قيمةٌ جذمها مرئيٌّ · **تنفيذٌ (exec)** رموزُ التنفيذِ
 * (`eval` · `Function` · `require` · `Reflect.get/apply/construct` ·
 * `Object.getOwnPropertyDescriptor` · `import()`) وقيمٌ جرى أصلُها إليها · **معتمٌ (opaque)**
 * ما لا يُبرهَنُ براءةُ أصلِه (معاملٌ `any`/`unknown` · فهرسةٌ غيرُ مطويةٍ · مفتاحٌ معادٌ
 * إسنادُه) · **عالميٌّ (global)** الكائنُ العالميُّ وقيمٌ جرى أصلُها إليه · **بابٌ (door)**
 * كائناتُ الأبوابِ `Reflect` و`Object` — مفاتيحُها الانعكاسيّةُ تنفيذٌ.
 *
 * **حدٌّ معلَنٌ (ميراثُ الجولات):** التدفّقُ داخلَ ملفٍّ واحدٍ (الإسنادُ يُمسَكُ في ملفِّهِ
 * عبرَ مسحٍ كاملٍ قبلَ السؤال) مع عبورِ الاستيرادِ إلى مُعرِّفِه؛ وتمريرُ القيمِ بينَ الدوالِّ
 * عبرَ المعاملاتِ يُتعقَّبُ عندَ مواضعِ النداءِ المرئيّةِ (إلحاقُ المعالجةِ الرابعةَ عشرةَ)، أما
 * المعاملُ الذي لا يُرى موضعُ نداءٍ لدالتِهِ (تعريفٌ خارجَ الوحدةِ مثلًا) فحدُّهُ المعلَنُ باقٍ
 * (دَينُ RC-07) — الحارسُ التشغيليُّ `assertExemptionsHold` يبقى الشاهدَ السلوكيَّ عليه.
 * أمّا الإرجاعُ فينقلُ التنفيذَ والعالميّةَ والبابَ ولا ينقلُ المعتمَ (اتحادُ الإرجاعِ أدناه).
 *
 * **تفكيكُ سقفِ الوحدةِ (المعالجةُ الرابعةَ عشرةَ):** حدُّ القسمةِ **سلطةٌ لا حجم** — هذا
 * الملفُ يملكُ *السؤالَ عن الأصلِ*؛ أمّا معجمُ الأصنافِ وأدواتُ الشجرةِ الخالصةُ ففي
 * `rehydrate_origin_model.ts`، وجمعُ تدفّقاتِ الربطِ في `rehydrate_binding_flows.ts`.
 *
 * ## إلحاقٌ مؤرَّخٌ (2026-10-26 · المعالجةُ الرابعةَ عشرةَ · عيوبُ الجولةِ التاسعةِ الستةِ)
 *
 * حكمَ مجلسُ المراجعةِ في جولتِهِ التاسعةِ (محضرُ W-2026-040-9.json) أنّ جنسَ العيوبِ واحدٌ:
 * قيمةُ تنفيذٍ تصلُ إلى نداءٍ ينفّذُ نصًّا والحاجزُ يبقى أخضرَ — الحرفُ المغلقُ هو «المُهيِّئُ
 * `eval` نفسُهُ» و«الأساسُ معرّفٌ مهيّؤُهُ كائنٌ حرفيٌّ»، وما دونَ ذلكَ بابٌ. فعولجَ منَ الجذرِ:
 * **(1)** عضوُ استيرادِ النطاقِ (`ns.member`) يُحَلُّ إلى تصديرِ الوحدةِ المحلولةِ ويُسألُ
 * أصلُهُ هناك (عيبُ gpt) · **(2)** الحرفيُّ في التعبيرِ نفسِهِ: وصولٌ بأساسٍ كائنٌ حرفيٌّ أو
 * مصفوفةٌ حرفيّةٌ ينزلُ إلى العضوِ والمفتاحُ الرقميُّ يُطوى كالنصِّ (عيوبُ grok: `({ run:
 * eval }).run` · `[eval][0]` · `({ F: Function }).F`) · **(3)** `new` يسألُ العرّافَ عن أصلِ
 * المستدعى لا عن اسمِهِ المكتبيِّ وحده (`const C: any = Function; new C(…)`) · **(4)** قنواتُ
 * الربطِ تصلُ إلى العضوِ لا إلى المُهيِّئِ كاملًا: التفكيكُ وعنصرُ `for-of` والجالبُ والنشرُ
 * و`Object.assign` و`catch` وإرجاعُ الدالّةِ · **(5)** الاستيرادُ المُسمّى المستعيرُ بلا
 * `valueDeclaration` يُتبَعُ من `declarations` إلى الرمزِ المكنّى ومُهيّئِهِ (`import { evil as
 * x }`) · **(6)** المعاملُ المعلَنُ النوعِ يُسألُ عن أصلِهِ: مواضعُ نداءِ الدالّةِ تربطُ
 * المعاملَ بوسيطِهِ الفعليِّ (`f.apply`/`f.bind`/`go(eval, …)`) — والمعاملُ الذي لا يُرى
 * موضعُ نداءٍ لدالتِهِ فحدُّهُ المعلَنُ باقٍ (دَينُ RC-07) ولا يُخضَرُ كذبًا.
 */
import ts from "typescript";
import {
  DATA,
  DOOR,
  EXEC,
  EXEC_GLOBAL_NAMES,
  EXEC_UNION,
  GLOBAL,
  OBJECT_DOOR_KEYS,
  OPAQUE,
  REFLECT_DOOR_KEYS,
  RETURN_UNION,
  TRAMPOLINE_KEYS,
  collectReturns,
  foldKey,
  globalDoor,
  namespaceModuleOf,
  propertyNameText,
  unwrapFlow,
} from "./rehydrate_origin_model";
import type { ValueOrigin } from "./rehydrate_origin_model";

export { unwrapFlow, effectiveCallArguments } from "./rehydrate_origin_model";
export type { OriginKind, ValueOrigin } from "./rehydrate_origin_model";
import { BindingFlows, paramFlowMap } from "./rehydrate_binding_flows";

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
  private readonly flows: BindingFlows;
  private readonly visiting = new Set<ts.Symbol>();
  private readonly checker: ts.TypeChecker;
  private readonly returnOriginCache = new Map<ts.Symbol, ValueOrigin | null>();

  constructor(file: ts.SourceFile, checker: ts.TypeChecker) {
    this.checker = checker;
    this.flows = new BindingFlows(file, checker);
  }

  /** أصلُ قيمةِ التعبيرِ — السؤالُ الواحدُ: من أين جاءت؟ */
  originOf(e: ts.Expression): ValueOrigin {
    const u = unwrapFlow(e);
    if (ts.isIdentifier(u)) return this.identOrigin(u);
    if (ts.isPropertyAccessExpression(u) || ts.isElementAccessExpression(u)) return this.propOrigin(u);
    if (ts.isCallExpression(u)) return this.callOrigin(u);
    if (ts.isNewExpression(u)) {
      // المعالجةُ الرابعةَ عشرةَ (عيب 3): new يسألُ العرّافَ عن أصلِ المستدعى — الكنيةُ Function
      // تعبرُ الإسنادَ كما تعبرُهُ النداءاتُ (const C: any = Function; new C(…))
      const calleeOrigin = this.originOf(u.expression);
      if (calleeOrigin.kind === "exec") return calleeOrigin;
      const callee = unwrapFlow(u.expression);
      return ts.isIdentifier(callee) && this.libGlobalName(callee) === "Function" ? EXEC("new Function(…) — منشئُ دالّةٍ من نصّ") : DATA;
    }
    if (ts.isFunctionExpression(u) || ts.isArrowFunction(u)) {
      // المعالجةُ الرابعةَ عشرةَ (عيب 4): قيمةُ الدالّةِ الحرفيّةِ — إرجاعُها (جسمُها المرئيُّ)
      return this.bodyReturnOrigin(u);
    }
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
    if (d !== undefined && ts.isParameter(d)) {
      // المعالجةُ الرابعةَ عشرةَ (عيب 6): المعاملُ المعلَنُ النوعِ يُسألُ عن أصلِهِ — مواضعُ نداءِ
      // دالتِهِ ربطتْهُ بوسيطِهِ الفعليّ فأصلُهُ اتحادُها (معَ حدِّهِ المعلَنِ: any/unknown معتمٌ)
      const flows = paramFlowMap.get(s);
      if (flows !== undefined && flows.length > 0) {
        if (this.visiting.has(s)) return DATA; // ربطٌ دائريّ — لا أصلَ يُتبع
        this.visiting.add(s);
        try {
          return flows.reduce((acc, f) => EXEC_UNION(acc, this.originOf(f)), this.paramOrigin(s, d));
        } finally {
          this.visiting.delete(s);
        }
      }
      return this.paramOrigin(s, d);
    }
    // المعالجةُ الرابعةَ عشرةَ (عيب 4): المفكَّكُ من نمطِ ربطٍ إعلانُهُ BindingElement لا
    // VariableDeclaration — وتدفّقُهُ في varFlows كما هو (التفكيكُ يربطُ كلَّ عنصرٍ بمعرّفِهِ)
    if (d !== undefined && (ts.isVariableDeclaration(d) || ts.isBindingElement(d))) {
      if (this.visiting.has(s)) return DATA; // إسنادٌ ذاتيّ — لا أصلَ يُتبع
      this.visiting.add(s);
      try {
        const flows = this.flows.varFlows.get(s);
        if (flows === undefined) return DATA;
        return flows.reduce((acc, f) => EXEC_UNION(acc, this.originOf(f)), DATA);
      } finally {
        this.visiting.delete(s);
      }
    }
    if (d !== undefined && ts.isImportSpecifier(d) || s.declarations?.some((x) => ts.isImportSpecifier(x)) === true) {
      // المعالجةُ الرابعةَ عشرةَ (عيب 5): الاستيرادُ المستعيرُ بلا valueDeclaration — يُتْبَعُ من
      // declarations إلى الرمزِ المكنّى ومُهيّئِهِ في وحدتِهِ (import { evil as x } من ملفٍ آخر)
      const target = this.checker.getAliasedSymbol(s);
      const td = target?.valueDeclaration;
      if (target !== undefined && td !== undefined && ts.isVariableDeclaration(td) && td.initializer !== undefined) {
        return valueOriginOracle(td.getSourceFile(), this.checker).originOf(td.initializer);
      }
      return DATA;
    }
    // المعالجةُ الرابعةَ عشرةَ (عيب 4): دالّةٌ معرّفةٌ في البرنامج — قيمتُها إرجاعُها المرئيُّ
    const ret = this.functionReturnOrigin(s);
    if (ret !== null) return ret;
    // دالّةٌ أو صنفٌ معرّفٌ في البرنامج — جسمُه مرئيٌّ والنفيُ يقرؤه
    return DATA;
  }

  /** قيمةُ دالّةٍ معرّفةٍ: اتحادُ تعبيراتِ الإرجاعِ في جسمِها — `null` إن لم تكن دالّةً ذاتَ جسمٍ */
  private functionReturnOrigin(s: ts.Symbol): ValueOrigin | null {
    const hit = this.returnOriginCache.get(s);
    if (hit !== undefined) return hit;
    const decls = s.declarations ?? [];
    const fn = decls.find((x): x is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration =>
      (ts.isFunctionDeclaration(x) || ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isMethodDeclaration(x)) && x.body !== undefined);
    if (fn === undefined) {
      this.returnOriginCache.set(s, null);
      return null;
    }
    if (this.visiting.has(s)) return null; // استدعاءٌ دائريّ — لا يُتبع
    this.visiting.add(s);
    try {
      const o = this.bodyReturnOrigin(fn);
      this.returnOriginCache.set(s, o);
      return o;
    } finally {
      this.visiting.delete(s);
    }
  }

  /** إرجاعُ دالّةٍ ذاتِ جسمٍ: اتحادُ تعبيراتِ `return` — وجسمُ التعبيرِ قيمتُهُ */
  private bodyReturnOrigin(fn: ts.FunctionExpression | ts.ArrowFunction | ts.FunctionDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration): ValueOrigin {
    if (fn.body === undefined) return DATA;
    if (!ts.isBlock(fn.body)) {
      const o = this.originOf(fn.body);
      return o.kind === "opaque" ? DATA : o; // المعتمُ لا يعبرُ حدودَ الدوالِّ (دَينُ RC-07)
    }
    const rets: ts.Expression[] = [];
    collectReturns(fn.body, rets);
    return rets.reduce((acc, r) => RETURN_UNION(acc, this.originOf(r)), DATA);
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
    if (baseOrigin.kind === "global") return globalDoor(this.checker, key, n);
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
        const flows = this.flows.propFlowsOf(decl, key).map((f) => this.originOf(f));
        const own = this.literalMemberOrigin(decl, key) ?? DATA;
        return flows.reduce((acc, f) => EXEC_UNION(acc, f), own);
      }
    }
    // المعالجةُ الرابعةَ عشرةَ (عيب 2): الحرفيُّ في التعبيرِ نفسِهِ — الوصولُ ينزلُ إلى العضوِ
    // لا يسقطُ إلى `data` (المفتاحُ الرقميُّ يُطوى فيُدرَكُ فهرسُ المصفوفةِ)
    {
      const baseU = unwrapFlow(n.expression);
      if (ts.isObjectLiteralExpression(baseU) && key !== null) {
        const o = this.objectLiteralMemberOrigin(baseU, key);
        if (o !== undefined) return o;
      }
      if (ts.isArrayLiteralExpression(baseU) && key !== null && /^\d+$/.test(key)) {
        const el = baseU.elements[Number(key)];
        if (el !== undefined && !ts.isOmittedExpression(el) && !ts.isSpreadElement(el)) return this.originOf(el);
      }
      // المعالجةُ الرابعةَ عشرةَ (عيب 1): عضوُ استيرادِ النطاقِ — يُحَلُّ إلى تصديرِ الوحدةِ المحلولةِ
      const ns = namespaceModuleOf(this.checker, n.expression);
      if (ns !== undefined && key !== null) {
        const o = this.moduleExportOrigin(ns, key);
        if (o !== undefined) return o;
      }
    }
    return DATA;
  }

  /** إن كانَ الأساسُ متغيّرًا مُهيَّئُهُ كائنٌ حرفيٌّ (أو دمجُ Object.assign الحرفيّ — المعالجةُ الرابعةَ عشرةَ) فأصلُ أعضائِهِ يُقاسُ من المُهيِّئِ */
  private literalRootOf(base: ts.Expression): ts.Symbol | undefined {
    const u = unwrapFlow(base);
    if (!ts.isIdentifier(u)) return undefined;
    const s = this.checker.getSymbolAtLocation(u);
    const d = s?.valueDeclaration;
    if (s === undefined || d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
    const initU = unwrapFlow(d.initializer);
    return ts.isObjectLiteralExpression(initU) || this.isObjectAssignCall(initU) ? s : undefined;
  }

  /** `Object.assign(…)` الحرفيُّ — دمجٌ يُقرأُ أعضاؤُهُ من وسيطاتِهِ الكائنيّةِ الحرفيّةِ */
  private isObjectAssignCall(e: ts.Expression): e is ts.CallExpression {
    if (!ts.isCallExpression(e)) return false;
    const c = unwrapFlow(e.expression);
    return ts.isPropertyAccessExpression(c) && c.name.text === "assign" && ts.isIdentifier(c.expression) && c.expression.text === "Object";
  }

  /** أصلُ تصديرٍ من وحدةٍ — `undefined` إن لم يوجدِ التصديرُ */
  private moduleExportOrigin(moduleSym: ts.Symbol, key: string): ValueOrigin | undefined {
    let exports: readonly ts.Symbol[];
    try {
      exports = this.checker.getExportsOfModule(moduleSym);
    } catch {
      return undefined;
    }
    const exp = exports.find((e) => e.name === key);
    if (exp === undefined) return undefined;
    const d = exp.valueDeclaration ?? exp.declarations?.[0];
    if (d === undefined) return undefined;
    if (ts.isVariableDeclaration(d) && d.initializer !== undefined) {
      return valueOriginOracle(d.getSourceFile(), this.checker).originOf(d.initializer);
    }
    if (d.getSourceFile().isDeclarationFile && EXEC_GLOBAL_NAMES.has(exp.name)) {
      return EXEC(`«${exp.name}» — تصديرُ تنفيذٍ من مكتبة`);
    }
    return DATA; // دالّةٌ أو صنفٌ معرّفٌ — جسمُهُ مرئيٌ
  }

  /** أصلُ عضوِ كائنٍ حرفيٍّ — `undefined` إن غابَ العضوُ (الجالبُ والنشرُ ودمجُ assign — المعالجةُ الرابعةَ عشرةَ) */
  private objectLiteralMemberOrigin(obj: ts.ObjectLiteralExpression, key: string): ValueOrigin | undefined {
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && propertyNameText(p.name) === key) return this.originOf(p.initializer);
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === key) return this.identOrigin(p.name);
      if (ts.isGetAccessorDeclaration(p) && propertyNameText(p.name) === key) {
        // الجالبُ: قيمتُهُ إرجاعُهُ (قناةُ الربطِ لا المُهيّئِ كاملًا)
        return this.bodyReturnOrigin(p);
      }
      if (ts.isSpreadAssignment(p)) {
        const u = unwrapFlow(p.expression);
        if (ts.isObjectLiteralExpression(u)) {
          const o = this.objectLiteralMemberOrigin(u, key);
          if (o !== undefined) return o;
        } else if (ts.isIdentifier(u)) {
          const root = this.literalRootOf(u);
          if (root !== undefined) {
            const o = this.literalMemberOrigin(root, key);
            if (o !== undefined) return o;
          }
        }
      }
    }
    return undefined;
  }

  /** أصلُ عضوِ متغيّرٍ جذرُهُ كائنٌ حرفيٌّ أو دمجُ assign — `undefined` إن غابَ العضوُ */
  private literalMemberOrigin(objSymbol: ts.Symbol, key: string): ValueOrigin | undefined {
    const d = objSymbol.valueDeclaration;
    if (d === undefined || !ts.isVariableDeclaration(d) || d.initializer === undefined) return undefined;
    const init = unwrapFlow(d.initializer);
    // المعالجةُ الرابعةَ عشرةَ (عيب 4): دمجُ Object.assign — الأعضاءُ من كلِّ الحرفيّاتِ المعطاة
    if (this.isObjectAssignCall(init)) {
      let acc: ValueOrigin | undefined;
      for (const a of init.arguments) {
        const au = unwrapFlow(a);
        if (ts.isObjectLiteralExpression(au)) {
          const o = this.objectLiteralMemberOrigin(au, key);
          if (o !== undefined) acc = acc === undefined ? o : EXEC_UNION(acc, o);
        }
      }
      return acc;
    }
    if (!ts.isObjectLiteralExpression(init)) return undefined;
    return this.objectLiteralMemberOrigin(init, key);
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
