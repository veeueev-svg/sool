/**
 * scripts/rehydrate_value_origin.ts — **أصلُ القيمة**: من أين جاءت هذه القيمة؟
 * (المرحلة 39 · W-2026-040 · المعالجةُ الخامسةَ عشرةَ — عيوبُ الجولةِ العاشرةِ الستَّ عشرةَ)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: تعبيرٌ في شجرةِ نحوِ ملفٍّ من `src/**` ومدقّقُ أنواعِ البرنامج
 * المخرجات: أصلُ قيمةِ التعبيرِ — بياناتٌ أو تنفيذٌ ديناميكيّ أو معتمٌ أو كائنٌ عالميّ
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
 * **حدٌّ معلَنٌ (ميراثُ الجولات):** التدفّقُ داخلَ ملفٍّ واحدٍ معَ عبورِ الاستيرادِ إلى
 * مُعرِّفِه (والسؤالُ عن تعبيرٍ في ملفٍّ آخرَ يُوجَّهُ إلى عرّافِهِ هو) · والمعاملُ الذي لا
 * يُرى موضعُ نداءٍ لدالتِهِ فحدُّهُ المعلَنُ باقٍ (دَينُ RC-07) · والإرجاعُ ينقلُ التنفيذَ
 * والعالميّةَ والبابَ ولا ينقلُ المعتمَ (اتحادُ الإرجاعِ).
 *
 * ## إلحاقٌ مؤرَّخٌ (2026-10-27 · المعالجةُ الخامسةَ عشرةَ · عيوبُ الجولةِ العاشرةِ الستَّ عشرةَ)
 *
 * حكمَ مجلسُ المراجعةِ في جولتِهِ العاشرةِ (محضرُ W-2026-040-10.json) أنّ جنسَ العيوبِ واحدٌ
 * — قيمةُ تنفيذٍ تصلُ إلى نداءٍ ينفّذُ نصًّا والحاجزُ أخضرُ — وأنّ العلاجَ السابقَ أغلقَ
 * الحرفَ لا الجنسَ. فصارَ الاستدلالُ **دلاليًّا لأصلِ القيمةِ عبرَ منظوراتِ المادةِ**
 * (`scripts/rehydrate_value_views.ts`): العضوُ يُقرأُ من مصدرِهِ المُجسَّدِ لا من شكلِ
 * أساسِهِ — الكائنُ الحرفيُّ والمصفوفةُ والدمجُ والصنفُ المُنشأُ ووحدةُ النطاقِ، والمعرّفُ
 * يُتْبَعُ إلى **كلِّ** تدفّقاتِ إسنادِهِ اتحادًا، وعنصرُ التفكيكِ يُسألُ من جذرِ إعلانِهِ
 * بمسارِ مفاتيحِهِ (متداخلًا · ذا قيمةٍ افتراضيةٍ · من دمجِ assign) وعنصرُ for-of من
 * عناصرِ منظوراتِ المصفوفةِ، والاشتقاقُ `at`/`map`/`filter` يصلُ إلى العناصرِ، وقيمةُ تعبيرِ
 * الإسنادِ طرفُهُ الأيمنُ وقناةُ `yield` في اتحادِ قيمةِ الدالّةِ المولِّدةِ، والاستيرادُ
 * يُتْبَعُ إلى دالّةٍ مُصدَّرةٍ وإرجاعِها المرئيِّ وإلى التصديرِ الافتراضيِّ وتعبيرِهِ.
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
  isAssignment,
  unwrapFlow,
} from "./rehydrate_origin_model";
import type { ValueOrigin } from "./rehydrate_origin_model";

export { unwrapFlow, effectiveCallArguments } from "./rehydrate_origin_model";
export type { OriginKind, ValueOrigin } from "./rehydrate_origin_model";
import { BindingFlows, paramFlowMap } from "./rehydrate_binding_flows";
import { arrayViewElements, bindingElementSources, dataBaseMemberOrigin, derivedArrayValue } from "./rehydrate_value_views";
import type { ViewContext } from "./rehydrate_value_views";

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
  private ctx?: ViewContext;

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
      // المعالجةُ الخامسةَ عشرةَ: قيمةُ تعبيرِ الإسنادِ طرفُهُ الأيمنُ — والإسنادُ المنطقيُّ (&&= · ||= · ??=) طرفاه معًا
      if (op === ts.SyntaxKind.EqualsToken) return this.originOf(u.right);
      if (isAssignment(op)) return EXEC_UNION(this.originOf(u.left), this.originOf(u.right));
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
    // المعالجةُ الخامسةَ عشرةَ: المفكَّكُ — مصادرُهُ من جذرِ إعلانِهِ بمسارِ مفاتيحِهِ اتحادًا
    // معَ تدفّقاتِهِ كما كانت (التفكيكُ المتداخلُ والقيمةُ الافتراضيةُ ودمجُ assign)
    if (d !== undefined && ts.isBindingElement(d)) {
      if (this.visiting.has(s)) return DATA; // إسنادٌ ذاتيّ — لا أصلَ يُتبع
      this.visiting.add(s);
      try {
        const flows = this.flows.varFlows.get(s);
        let acc = flows === undefined ? DATA : flows.reduce((a, f) => EXEC_UNION(a, this.originOf(f)), DATA);
        for (const src of bindingElementSources(d, this.viewCtx())) acc = EXEC_UNION(acc, this.originInFile(src));
        return acc;
      } finally {
        this.visiting.delete(s);
      }
    }
    if (d !== undefined && ts.isVariableDeclaration(d)) {
      if (this.visiting.has(s)) return DATA; // إسنادٌ ذاتيّ — لا أصلَ يُتبع
      this.visiting.add(s);
      try {
        const flows = this.flows.varFlows.get(s);
        if (flows === undefined) return DATA;
        // المعالجةُ الخامسةَ عشرةَ: عنصرُ for-of على متغيّرٍ — أصلُهُ عناصرُ منظوراتِ المصفوفةِ
        const forOf = ts.isVariableDeclarationList(d.parent) && ts.isForOfStatement(d.parent.parent);
        return flows.reduce((acc, f) => EXEC_UNION(acc, forOf ? this.forOfElementOrigin(f) : this.originOf(f)), DATA);
      } finally {
        this.visiting.delete(s);
      }
    }
    // المعالجةُ الخامسةَ عشرةَ: الاستيرادُ — مُسمًّى كانَ أو افتراضيًّا — يُتْبَعُ إلى رمزِهِ
    // المكنّى: متغيّرٌ فمُهيِّئُهُ · دالّةٌ مُصدَّرةٌ فإرجاعُها المرئيُّ · تصديرٌ افتراضيٌّ فتعبيرُهُ
    if ((d !== undefined && ts.isImportSpecifier(d)) || s.declarations?.some((x) => ts.isImportSpecifier(x)) === true) {
      const imported = this.importedValue(s);
      return imported ?? DATA;
    }
    if (d !== undefined && ts.isImportClause(d)) {
      const imported = this.importedValue(s);
      if (imported !== null) return imported;
    }
    // المعالجةُ الرابعةَ عشرةَ (عيب 4): دالّةٌ معرّفةٌ في البرنامج — قيمتُها إرجاعُها المرئيُّ
    const ret = this.functionReturnOrigin(s);
    if (ret !== null) return ret;
    // دالّةٌ أو صنفٌ معرّفٌ في البرنامج — جسمُه مرئيٌّ والنفيُ يقرؤه
    return DATA;
  }

  /** قيمةُ رمزٍ مستورَدٍ — `null` إن لم يُحَلَّ إلى شيءٍ يُسألُ */
  private importedValue(s: ts.Symbol): ValueOrigin | null {
    let target: ts.Symbol | undefined;
    try {
      target = this.checker.getAliasedSymbol(s);
    } catch {
      target = undefined;
    }
    const td = target?.valueDeclaration ?? target?.declarations?.[0];
    if (td === undefined) return null;
    if (ts.isVariableDeclaration(td) && td.initializer !== undefined) return this.originInFile(td.initializer);
    if ((ts.isFunctionDeclaration(td) || ts.isFunctionExpression(td) || ts.isArrowFunction(td)) && td.body !== undefined) return this.declaredFunctionValue(td);
    if (ts.isExportAssignment(td)) return this.originInFile(td.expression);
    return null;
  }

  /** عنصرُ for-of: عناصرُ منظوراتِ المصفوفةِ — أو حدُّ التعبيرِ كما كانَ إن لم تُجسَّدْ */
  private forOfElementOrigin(f: ts.Expression): ValueOrigin {
    const els = arrayViewElements(f, this.viewCtx());
    if (els.length === 0) return this.originOf(f);
    return els.reduce((acc, el) => RETURN_UNION(acc, this.originInFile(el)), DATA);
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

  /** قيمةُ دالّةٍ معرّفةٍ في البرنامجِ — عبرَ عرّافِ ملفِّها (عامٌّ للمنظوراتِ) */
  declaredFunctionValue(fn: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration): ValueOrigin {
    return valueOriginOracle(fn.getSourceFile(), this.checker).bodyReturnOrigin(fn);
  }

  /** أصلُ قيمةِ تعبيرٍ في ملفِّهِ — السؤالُ يُوجَّهُ إلى عرّافِ الملفِّ الذي فيهِ التعبيرُ */
  private originInFile(e: ts.Expression): ValueOrigin {
    return valueOriginOracle(e.getSourceFile(), this.checker).originOf(e);
  }

  /** قيمةُ إعلانٍ — متغيّرٌ فمُهيِّئُهُ · خصيصةُ صنفٍ فمُهيِّئُها · دالّةٌ فإرجاعُها */
  private declValueOrigin(d: ts.Declaration): ValueOrigin {
    if (d.getSourceFile().isDeclarationFile) return DATA;
    if (ts.isVariableDeclaration(d) && d.initializer !== undefined) return this.originInFile(d.initializer);
    if (ts.isPropertyDeclaration(d) && d.initializer !== undefined) return this.originInFile(d.initializer);
    if ((ts.isFunctionDeclaration(d) || ts.isFunctionExpression(d) || ts.isArrowFunction(d) || ts.isMethodDeclaration(d) || ts.isGetAccessorDeclaration(d)) && d.body !== undefined) {
      return this.declaredFunctionValue(d);
    }
    return DATA;
  }

  /** معاملٌ: نوعُه المحلولُ هو المتاحُ — `any`/`unknown` معتمٌ (لا برهانَ على براءةِ المصدر) */
  private paramOrigin(s: ts.Symbol, d: ts.ParameterDeclaration): ValueOrigin {
    const t = this.checker.getTypeOfSymbolAtLocation(s, d.name);
    if ((t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return OPAQUE("معاملٌ بلا نوعٍ مبرهَنٍ — مصدرُ قيمتِهِ مجهول");
    return DATA;
  }

  /** سياقُ التجسيدِ — تدفّقاتُ المعرّفِ تُقرأُ من عرّافِ ملفِّهِ (التوجيهُ العابرُ للملفاتِ) */
  private viewCtx(): ViewContext {
    if (this.ctx === undefined) {
      this.ctx = {
        checker: this.checker,
        flowsOf: (id) => valueOriginOracle(id.getSourceFile(), this.checker).flowsOfSymbol(id),
      };
    }
    return this.ctx;
  }

  /** تدفّقاتُ إسنادِ معرّفٍ في ملفِّ هذا العرّافِ — للمنظوراتِ */
  flowsOfSymbol(id: ts.Identifier): readonly ts.Expression[] {
    const s = this.checker.getSymbolAtLocation(id);
    return s === undefined ? [] : this.flows.varFlows.get(s) ?? [];
  }

  /** الوصولُ بالخاصّيّةِ أو الفهرسِ — أبوابُ الكائنِ العالميّ ومنظوراتُ المادةِ */
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
    if (key === "constructor" && baseOrigin.kind === "data") {
      // منشئُ قيمةٍ دالّيّةٍ هو `Function` نفسُهُ — بابُ منشئِ الدالّةِ من نصّ (قيمةُ القاعدةِ تُتبع)
      const baseT = this.checker.getTypeAtLocation(n.expression);
      if ((baseT.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) === 0 && (baseT.getCallSignatures().length > 0 || baseT.getConstructSignatures().length > 0)) {
        return EXEC("منشئُ قيمةٍ دالّيّةٍ هو Function — بابُ منشئِ الدالّةِ من نصّ");
      }
    }
    // المعالجةُ الخامسةَ عشرةَ: منظوراتُ المادةِ — أصلُ العضوِ من مصدرِهِ المُجسَّدِ لا من شكلِ أساسِهِ
    return dataBaseMemberOrigin(n, this.viewCtx(), {
      originInFile: (e) => this.originInFile(e),
      functionValue: (fn) => this.declaredFunctionValue(fn),
      declValue: (d) => this.declValueOrigin(d),
      propFlowsOf: (s, k) => this.flows.propFlowsOf(s, k),
      originOfFlow: (f) => this.originOf(f),
    });
  }

  /** نتيجةُ النداءِ: مستدعًى أصلهُ تنفيذٌ فالقيمةُ تنفيذٌ · وإلا فبياناتٌ */
  private callOrigin(n: ts.CallExpression): ValueOrigin {
    const callee = unwrapFlow(n.expression);
    // الترامبولين: العضوُ واجهةٌ والفاعلُ الأساسُ — القيمةُ المُسندةُ هي أصلُ النداءِ
    if (ts.isPropertyAccessExpression(callee) && TRAMPOLINE_KEYS.has(callee.name.text)) {
      return this.originOf(callee.expression);
    }
    // المعالجةُ الخامسةَ عشرةَ: اشتقاقُ المصفوفةِ — at/map/filter تصلُ إلى عناصرِ منظوراتِها
    const derived = derivedArrayValue(n, this.viewCtx(), {
      originInFile: (e) => this.originInFile(e),
      callbackValue: (fn) => this.declaredFunctionValue(fn),
    });
    if (derived !== null) return derived;
    const calleeOrigin = this.originOf(n.expression);
    if (calleeOrigin.kind === "exec") return calleeOrigin;
    if (calleeOrigin.kind === "opaque") return calleeOrigin;
    if (calleeOrigin.kind === "global" || calleeOrigin.kind === "door") return OPAQUE("نداءٌ على الكائنِ العالميّ أو بابِه — بلا برهانِ براءة");
    return DATA;
  }
}
