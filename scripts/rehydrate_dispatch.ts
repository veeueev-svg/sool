/**
 * scripts/rehydrate_dispatch.ts — برهانُ **موضعِ التوزيع** (المرحلة 39 · W-2026-040 · جولة 3)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: شجرةُ نحوِ ملفٍّ (`ts.SourceFile`) واسمُ صنفٍ
 * المخرجات: مواضعُ توزيعٍ مقيسةٌ بأشكالِها الثلاثة (`case` · `compare` · `handler`)
 * التبعيات: مُترجمُ TypeScript + أوّليّاتُ `scripts/rehydrate_proof.ts` — لا `grep` على الشفرة
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي حكمًا؛ غيابُ موضعِ توزيعٍ يعود قائمةً فارغةً ليحكم بها الحاجز
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذا التشديد: docs/test-reports/phase-39-W-2026-040-review-round-2.md
 *
 * **لِمَ فُصلت عن `rehydrate_proof.ts`**: تشديدُ تعريفِ «موضعِ التوزيع» بعد رفضِ الجولةِ
 * الثانيةِ رفع الملفَّ الأصلَ فوق سقفِ الوحدةِ المُعلَن (400 سطرًا في
 * `scripts/limits/module_limits.yaml`) — **والسقفُ لا يُرفع لأنّ ملفًّا كبُر**، فيُقسَم المنطق.
 *
 * ## العيبُ الذي أوجب هذا الملف
 *
 * الجولةُ الأولى رفضت البرهانَ المعجميَّ (`grep`)، فنُقل إلى النحوِ. والجولةُ الثانيةُ رفضته
 * ثانيًا **بالعِلّةِ نفسِها في لباسٍ نحويّ**: كان «موضعُ التوزيع» يُقبل بمجرّدِ أنّ لبندِ
 * `case` عبارةً واحدةً — و`break` عبارةٌ. فمن حذف منطقَ الإرجاعِ كلَّه وأبقى
 * `case 'tax_levy': break;` أخضرَ الحاجزَ وبوّابةَ الدمج، والقيدُ يُدوَّن ويُسقَط صمتًا
 * عند الإقلاع. وكذلك كانت مقارنةٌ في سطرِ سجلٍّ — بل مقارنةُ حرفَينِ لا صلةَ لهما
 * بالقيد (`'ignored' === 'tax_levy'`) — تُقبل موضعَ توزيع.
 *
 * فالتعريفُ هنا **يشترط الأثرَ لا الوجود**: للفرعِ عملٌ (`effectful`)، وللمقارنةِ طرفٌ
 * على حقلِ الصنف (`isKindBearing`) وحكمٌ على فرعٍ يعمل. **وحدُّه مُعلَنٌ كما كان**: بنيةٌ
 * لا سلوك — يشهد أنّ للصنفِ فرعَ توزيعٍ ذا أثرٍ في الشفرة، **ولا يشهد أنّ ما في الفرعِ
 * يُعيد الحالةَ صحيحةً**؛ ذاك يشهد به `tests/data/rehydrate_roundtrip.test.ts`.

 *
 * ## امتدادُ الجولةِ الرابعة — **ربطٌ بالتعريفِ ووصولٌ بالنداء**
 *
 * عيبا `HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME` و`HANDLER_MAP_DEAD_CALL_ACCEPTED`:
 * كان ربطُ الجدولِ المفتوحِ بجدولِ التعريفِ **اسمًا على مستوى الملفِّ** — فجدولانِ
 * باسمٍ واحدٍ: الحقيقيُّ لم يُفتح والفارغُ هو الذي نُودي — أخضرّا. وكان نداءُ القيمةِ
 * المنتقاةِ يُقبل حيثما وقع ولو كان تحت شرطٍ لا يصدُق أبدًا. فصار الجدولُ **تعريفًا بعينِه**
 * (حلُّ الاسمِ إلى تعريفِه في نطاقِه لا مطابقةُ النصِّ)، وصار النداءُ **قابلًا
 * للوصول** شرطًا — بحكمِ `scripts/rehydrate_reachability.ts`.
 */
import ts from 'typescript';
import { lineOf, literalsOf, unwrap, walk } from './rehydrate_proof';
import type { Site } from './rehydrate_proof';
import { guardsOf, resolveVariable } from './rehydrate_reachability';
import {
  constantFalsy, effectful, effectfulExpression, functionBodyEffectful,
} from './rehydrate_effect';

/** يُعاد تصديرُ حكمِ الأثرِ ليبقى مدخلٌ واحدٌ لمن يقيس مواضعَ التوزيع */
export {
  constantFalsy, constantTruthy, effectful, effectfulExpression, functionBodyEffectful,
} from './rehydrate_effect';

/** فرعٌ «غيرُ فارغ»: ليس بندًا بلا عبارات، ولا كتلةً فارغة، ولا عبارةً فارغة */
export function nonEmptyBranch(stmt: ts.Statement | undefined): boolean {
  if (stmt === undefined) return false;
  if (ts.isEmptyStatement(stmt)) return false;
  if (ts.isBlock(stmt)) return stmt.statements.length > 0;
  return true;
}

/**
 * تعبيرٌ **يحمل صنفَ القيد**: `x.kind` أو `x['kind']` أو مُعرّفٌ اسمُه `kind`.
 *
 * **لِمَ هذا الشرط**: مراجعةُ الجولةِ الثانيةِ أقامت الشاهدَ أنّ `'ignored' === 'tax_levy'`
 * — حرفانِ لا صلةَ لهما بالقيد — كانت تُعَدُّ موضعَ توزيع. فمقارنةٌ لا طرفَ لها على
 * حقلِ الصنفِ لا توزّع شيئًا (`DISPATCH_SITE_ACCEPTS_LOG_LINE_COMPARISON`).
 */
export function isKindBearing(node: ts.Node): boolean {
  const e = unwrap(node);
  if (ts.isPropertyAccessExpression(e)) return e.name.text === 'kind';
  if (ts.isElementAccessExpression(e)) {
    const a = e.argumentExpression;
    return (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && a.text === 'kind';
  }
  if (ts.isIdentifier(e)) return e.text === 'kind';
  return false;
}

/**
 * **حكمُ الأثرِ نُقل إلى `scripts/rehydrate_effect.ts`** بعد رفضِ الجولةِ الثالثة:
 * اتّفق المراجعانِ المستقلّانِ على أنّ `effectful` كان **قائمةَ نفيٍ** تنتهي بـ`return true`
 * (`EFFECTFUL_NOOP_GREENS_RC03` · `DISPATCH_EFFECT_ACCEPTS_FORMAL_NON_RESTORE`)، فنجا منها
 * `while (false) {}` و`record.kind;` و`[];` و`try {} finally {}` و`if (false) { … }`
 * و`function g() { … }` — إحدى عشرةَ صيغةً قِيست خضرتُها بالرقم. فصار **قائمةَ إثباتٍ**
 * بأربعةِ آثارٍ تُسمّى (إسنادٌ · نداءٌ · رميٌ · إنشاءٌ) لا تُوَرَّثُ عبرَ شرطٍ ثابتِ الكذب،
 * ونُقل إلى وحدةٍ بسلطتِه لأنّ التشديدَ رفع هذا الملفَّ فوق سقفِ الوحدةِ المُعلَن
 * — **والسقفُ لا يُرفع، بل يُقسَم المنطق** (`scripts/limits/module_limits.yaml`).
 */

/**
 * بندُ `case` يُقبل بشرطَينِ لا بشرط:
 *
 * 1) مُمَيّزُ الـ`switch` يحمل صنفَ القيد — فـ`switch (mode) { case 'tax_levy': … }` توزيعٌ
 *    على شيءٍ آخرَ يوافق الاسمَ لا توزيعٌ على الصنف.
 * 2) جسمُ البندِ (أو ما يسقط إليه إن كان فارغًا حقًّا) **يعمل** بمعنى `effectful`.
 *
 * وبندٌ له عباراتٌ لا تعمل **يقطع السلسلةَ ولا يُورَّث عملَ ما بعده**: `case 'k': break;`
 * لا يسقط إلى البندِ التالي في التنفيذ، فلا يرث عملَه في البرهان.
 */
export function caseReaches(clause: ts.CaseClause): boolean {
  const block = clause.parent;
  if (!ts.isCaseBlock(block)) return false;
  const sw = block.parent;
  if (!ts.isSwitchStatement(sw) || !isKindBearing(sw.expression)) return false;
  let seen = false;
  for (const c of block.clauses) {
    if (c === clause) seen = true;
    if (!seen) continue;
    if (c.statements.some((s) => effectful(s))) return true;
    // بندٌ له عباراتٌ لا تعمل (`break`، `return;`، سطرُ سجلٍّ) يقطع السقوط
    if (c.statements.length > 0) return false;
  }
  return false;
}

/** توابعُ المصفوفاتِ التي تأخذ مُسنِدًا — فالمقارنةُ في جسمِه توزيعٌ لا وصف */
const PREDICATE_METHODS: ReadonlySet<string> = new Set([
  'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'some', 'every',
  'flatMap', 'map', 'reduce', 'partition', 'count', 'groupBy',
]);

/** أقربُ دالّةٍ تحوي العقدة */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)
      || ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

/** هل هذه الدالّةُ مُمَرَّرةٌ مُسنِدًا لتابعٍ يوزّع به؟ */
function isPredicateArgument(fn: ts.Node): boolean {
  const p = fn.parent;
  if (p === undefined || !ts.isCallExpression(p)) return false;
  if (!p.arguments.some((a) => a === fn)) return false;
  const callee = unwrap(p.expression);
  return ts.isPropertyAccessExpression(callee) && PREDICATE_METHODS.has(callee.name.text);
}

/**
 * يصعد من المقارنةِ فيسأل: هل **تحكم فرعًا يعمل**، أو تُمرَّر مُسنِدًا لمُرشِّح؟
 *
 * **وما كان يُقبل فصار يُرفَض** بعد مراجعةِ الجولةِ الثانية: وسيطُ نداءٍ
 * (`console.log(rec.kind === 'k')`)، وتصريحُ متغيّرٍ لا يُقرأ (`const unused = …`)،
 * وإسنادُ خاصّيّةٍ، وسهمٌ لا يُمَرَّر لمُرشِّح، و`if` جسمُه `{ void 0; }`.
 */
export function comparisonReaches(node: ts.Node): boolean {
  let cur: ts.Node = node;
  for (let i = 0; i < 12 && cur.parent !== undefined; i += 1) {
    const p: ts.Node = cur.parent;
    if (ts.isIfStatement(p) && p.expression === cur) {
      return effectful(p.thenStatement) || effectful(p.elseStatement);
    }
    if ((ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === cur) {
      return effectful(p.statement);
    }
    if (ts.isForStatement(p) && p.condition === cur) return effectful(p.statement);
    if (ts.isConditionalExpression(p) && p.condition === cur) {
      return effectfulExpression(p.whenTrue) || effectfulExpression(p.whenFalse);
    }
    // **عيبُ الجولةِ الثالثة** `PREDICATE_CALLBACK_COUNTED_AS_CONSUMER`: كان تمريرُ المقارنةِ
    // مُسنِدًا لـ`filter`/`map` يُقبل توزيعًا وإن كان جسمُ المُسنِدِ مقارنةً لا أثرَ لها:
    // `recs.filter((r) => r.kind === 'tax_levy')` يُرشِّح مجموعةً ولا يُرجِع حالًا عند الإقلاع.
    // فلا يُقبل المُسنِدُ إلّا إن كان **في جسمِه أثرٌ** لا مجرّدَ حكمٍ.
    if (ts.isArrowFunction(p) || ts.isFunctionExpression(p)) {
      return isPredicateArgument(p) && functionBodyEffectful(p);
    }
    if (ts.isReturnStatement(p)) {
      const fn = enclosingFunction(p);
      return fn !== undefined && isPredicateArgument(fn) && functionBodyEffectful(fn);
    }
    // مرورٌ: الروابطُ المنطقيّةُ والنفيُ والأقواسُ لا تُغيّر كونَ المقارنةِ شرطًا
    if (ts.isBinaryExpression(p)
      && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { cur = p; continue; }
    if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) {
      cur = p; continue;
    }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p)) { cur = p; continue; }
    return false;
  }
  return false;
}

/**
 * **خريطةُ مُعالِجين**: `{ tax_levy: handler }` تُفتح بمفتاحٍ يحمل الصنفَ — توزيعٌ
 * صحيحٌ كان الحاجزُ يرفضه (`DISPATCH_GATE_REJECTS_OBJECT_MAP`). **وحاجزٌ يرفض الصحيحَ
 * يدفع إلى التزوير**: يُكتب `case` ليُرضَى ثمَّ يُفرَّغ جسمُه.
 *
 * **وعيبُ الجولةِ الثالثةِ هنا مُسمًّى بلفظَين** — `HANDLER_MAP_DECOY_ACCEPTED` (أ) و
 * `HANDLER_MAP_ACCEPTS_EMPTY_BODY` (ب): كانت الخريطةُ تُقبل بثلاثةِ تسامُحاتٍ مجتمعةً،
 * وكلُّ واحدٍ منها بابُ تزويرٍ وحدَه:
 *
 *   1) **الفتحُ عَلَمٌ على مستوى الملفِّ لا رابطةٌ بالجدول**: أيُّ فتحٍ بأيِّ كائنٍ يُجيز
 *      أيَّ جدولٍ آخرَ في الملفّ — فيُكتب جدولٌ خادعٌ ويُفتح جدولٌ آخر.
 *   2) **لا يُشترط أن تُستدعى القيمةُ المُنتقاة**: جدولٌ يُفتح ولا يُنادى معالِجُه
 *      لا يُرجِع شيئًا.
 *   3) **لا يُقرأ جسمُ المُعالِج**: `tax_levy: () => {}` كان يُقبل — وهو **تجاوزٌ لحكمِ
 *      الأثرِ كلِّه**، فأفرغَ من أفرغ جسمَ المعالجِ والحاجزُ أخضر.
 *
 * فصارت تُشترط الثلاثةُ مجتمعةً: الجدولُ المُعرَّفُ **هو** الجدولُ المفتوح باسمِه،
 * والقيمةُ المُنتقاةُ **تُنادى**، وجسمُ المُعالِجِ **ذو أثرٍ** بحكمِ `rehydrate_effect`.
 */

/** تعريفُ الكائنِ في `const NAME = { … }` — وبه تُربط الخريطةُ بفتحِها **عقدةً لا اسمًا** */
function boundDeclaration(obj: ts.ObjectLiteralExpression): ts.VariableDeclaration | null {
  let cur: ts.Node | undefined = obj.parent;
  for (let i = 0; i < 4 && cur !== undefined; i += 1) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur;
    if (ts.isPropertyAssignment(cur) || ts.isAsExpression(cur)
      || ts.isParenthesizedExpression(cur)) { cur = cur.parent; continue; }
    return null;
  }
  return null;
}

/** جذرُ التعبيرِ عُقدةً: `a.b[c]` ⇒ مُعرّفُ `a` — لحلِّ اسمِ جدولِ الفتحِ إلى تعريفِه في نطاقِه */
function rootIdentifier(node: ts.Node): ts.Identifier | null {
  let e = unwrap(node);
  for (let i = 0; i < 8; i += 1) {
    if (ts.isIdentifier(e)) return e;
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      e = unwrap(e.expression); continue;
    }
    if (ts.isCallExpression(e)) { e = unwrap(e.expression); continue; }
    return null;
  }
  return null;
}

/**
 * تعريفُو الجداولِ التي **تُفتح بمفتاحٍ يحمل الصنفَ ثمَّ تُنادى قيمتُها نداءً قابلًا للوصول**.
 *
 * والنداءُ يُقبل بصورتيه: نداءٌ مباشرٌ على الفتحِ (`map[e.kind](…)`)، أو انتقاءٌ إلى
 * مُتغيّرٍ ثمَّ نداؤه (`const h = map[e.kind]; if (h) h(…);`) — والثانيةُ هي الصورةُ
 * المُستعملةُ في الشفرةِ الحقيقيّة، فرفضُها يدفع إلى التزوير.
 *
 * **وعيبُ الجولةِ الرابعة**: كان الجدولُ **اسمًا** — فتعريفانِ باسمٍ واحدٍ في الملفِّ
 * يُربطانِ كأنّهما واحدٌ (`HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME`)، ونداءٌ تحت شرطٍ
 * لا يصدُق أبدًا كان يُحسَب نداءً (`HANDLER_MAP_DEAD_CALL_ACCEPTED`). فصار الجدولُ
 * **تعريفًا** يُحَلُّ الاسمُ إليه في نطاقِه (`resolveVariable`)، والنداءُ **قابلًا
 * للوصول** (`guardsOf`).
 */
function openedAndCalled(sf: ts.SourceFile): ReadonlySet<ts.VariableDeclaration> {
  // تعريفُ المُتغيّرِ المُنتقى ⇒ تعريفُ الجدولِ
  const openedInto = new Map<ts.VariableDeclaration, ts.VariableDeclaration>();
  const opened: { table: ts.VariableDeclaration | null; node: ts.Node }[] = [];
  walk(sf, (n) => {
    let root: ts.Identifier | null = null;
    if (ts.isElementAccessExpression(n) && isKindBearing(n.argumentExpression)) {
      root = rootIdentifier(n.expression);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(unwrap(n.expression))) {
      const callee = unwrap(n.expression) as ts.PropertyAccessExpression;
      const first = n.arguments[0];
      if (callee.name.text === 'get' && first !== undefined && isKindBearing(first)) {
        root = rootIdentifier(callee.expression);
      }
    }
    if (root === null) return;
    const table = resolveVariable(sf, root);
    opened.push({ table, node: n });
    const par = n.parent;
    if (par !== undefined && ts.isVariableDeclaration(par) && ts.isIdentifier(par.name)) {
      if (table !== null) openedInto.set(par, table);
    }
  });
  const called = new Set<ts.VariableDeclaration>();
  // (أ) نداءٌ مباشرٌ على موضعِ الفتحِ — إن كان قابلًا للوصول
  for (const o of opened) {
    const par = o.node.parent;
    if (par !== undefined && ts.isCallExpression(par) && unwrap(par.expression) === o.node
      && o.table !== null && !guardsOf(sf, par).unsatisfiable) {
      called.add(o.table);
    }
  }
  // (ب) نداءُ المُتغيّرِ الذي انتُقي إليه — حلًّا لاسمِه إلى تعريفِه لا مطابقةَ نصًّا
  walk(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const callee = unwrap(n.expression);
    if (!ts.isIdentifier(callee)) return;
    const picked = resolveVariable(sf, callee);
    if (picked === null) return;
    const table = openedInto.get(picked);
    if (table !== undefined && !guardsOf(sf, n).unsatisfiable) called.add(table);
  });
  return called;
}

export function handlerMapSites(sf: ts.SourceFile, kind: string): Site[] {
  const live = openedAndCalled(sf);
  if (live.size === 0) return [];
  const out: Site[] = [];
  walk(sf, (n) => {
    if (!ts.isPropertyAssignment(n)) return;
    const nm = n.name;
    const key = ts.isIdentifier(nm) || ts.isStringLiteral(nm) ? nm.text : null;
    if (key !== kind) return;
    const obj = n.parent;
    if (!ts.isObjectLiteralExpression(obj)) return;
    // (1) الجدولُ المُعرَّفُ هو الجدولُ المفتوحُ المُنادى — لا عَلَمٌ عامٌّ على الملفّ
    // (1) الجدولُ المُعرَّفُ هو الجدولُ المفتوحُ المُنادى — **تعريفًا بعينِه** لا
    // اسمًا على مستوى الملفِّ (عيبُ الجولةِ الرابعة `HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME`)
    const decl = boundDeclaration(obj);
    if (decl === null || !live.has(decl)) return;
    // (3) جسمُ المُعالِجِ ذو أثرٍ — والمُعرّفُ يُتبَّع إلى تعريفِه في الملفِّ نفسِه
    const v = unwrap(n.initializer);
    if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) {
      if (!functionBodyEffectful(v)) return;
    } else if (ts.isIdentifier(v)) {
      if (!namedFunctionEffectful(sf, v.text)) return;
    } else if (ts.isPropertyAccessExpression(v)) {
      if (!namedFunctionEffectful(sf, v.name.text)) return;
    } else {
      return;
    }
    out.push({ line: lineOf(sf, n), form: 'handler' });
  });
  return out;
}

/**
 * دالّةٌ مُسمّاةٌ في الملفِّ نفسِه جسمُها ذو أثر. **وما لا يُوجَد تعريفُه لا يُقبل**:
 * مُعالِجٌ يشير إلى ما لا يُقرأ في هذا الملفِّ دعوى لا برهان (الافتراضُ الرافض).
 */
function namedFunctionEffectful(sf: ts.SourceFile, name: string): boolean {
  let ok = false;
  walk(sf, (n) => {
    if (ok) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      ok = functionBodyEffectful(n); return;
    }
    if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      ok = functionBodyEffectful(n); return;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name
      && n.initializer !== undefined) {
      const init = unwrap(n.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        ok = functionBodyEffectful(init);
      }
    }
  });
  return ok;
}

/**
 * مواضعُ **التوزيع** على الصنفِ في ملفٍّ، بثلاثةِ أشكالٍ لا أكثر:
 *
 * - `case 'kind':` في `switch` على حقلِ الصنف، وجسمُه **يعمل**؛
 * - مقارنةُ `=== / !==` **أحدُ طرفَيها حقلُ الصنف**، تحكم فرعًا يعمل أو تُمرَّر مُرشِّحًا؛
 * - خريطةُ مُعالِجين تُفتح بمفتاحٍ يحمل الصنف.
 *
 * وما عدا ذلك — تعليقٌ، سطرُ سجلٍّ، ثابتٌ لا يُقرأ، بندٌ فارغٌ، `break` وحدَه،
 * مقارنةُ حرفَينِ لا صلةَ لهما بالقيد — **ليس برهانًا**. وهذا التعليقُ عقدٌ مع الشفرةِ
 * يحرسه `tests/data/rehydrate_census.test.ts` بتطفيرٍ لكلِّ شكلٍ من هذه — فمراجعةُ
 * الجولةِ الثانيةِ أقامت أنّ التعليقَ كان يقول ما لا تفعلُه الشفرة.
 */
export function dispatchSites(sf: ts.SourceFile, kind: string): Site[] {
  const out: Site[] = [];
  for (const lit of literalsOf(sf, kind)) {
    const p = lit.parent;
    if (p !== undefined && ts.isCaseClause(p) && p.expression === lit && caseReaches(p)) {
      out.push({ line: lineOf(sf, lit), form: 'case' });
      continue;
    }
    if (
      p !== undefined && ts.isBinaryExpression(p)
      && (p.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
        || p.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
      && isKindBearing(p.left === lit ? p.right : p.left)
      && comparisonReaches(p)
    ) {
      out.push({ line: lineOf(sf, lit), form: 'compare' });
    }
  }
  out.push(...handlerMapSites(sf, kind));
  return out;
}
