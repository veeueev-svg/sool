/**
 * scripts/rehydrate_effect.ts — برهانُ **الأثرِ المُرجِع** (المرحلة 39 · W-2026-040 · جولة 4)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عُقدةُ عبارةٍ أو تعبيرٍ في شجرةِ نحوِ TypeScript
 * المخرجات: حكمٌ ثُنائيٌّ — هل للعبارةِ **أثرٌ من الأنواعِ الأربعةِ المُعلَنة**
 * التبعيات: مُترجمُ TypeScript + `unwrap` من `scripts/rehydrate_proof.ts`
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ ما لا يُعرَف أثرُه **يُرَدُّ لا أثرَ له** (الافتراضُ الرافض)
 * اختبار القبول: tests/data/rehydrate_census_mutations.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذا الملف: docs/test-reports/phase-39-W-2026-040-review-round-3.md
 *
 * ## العيبُ الذي أوجب هذا الملف — الصيغةُ الثالثة
 *
 * رُفض البرهانُ ثلاثَ جولاتٍ بعلّةٍ واحدةٍ في ثلاثةِ ألبسة: **معجميٍّ** (`grep` على الاسم)،
 * ثمّ **نحويٍّ** (بندُ `case` له عبارةٌ — و`break` عبارة)، ثمّ **الأثرِ الصوريّ**. وفي
 * الجولةِ الثالثةِ اتّفق المراجعانِ المستقلّانِ على الموضعِ نفسِه بلفظَين:
 * `EFFECTFUL_NOOP_GREENS_RC03` و`DISPATCH_EFFECT_ACCEPTS_FORMAL_NON_RESTORE`.
 *
 * والسببُ البنيويُّ أنّ `effectful` كان **قائمةَ نفيٍ** تنتهي بـ`return true`: فما لم
 * يُسَمَّ خامدًا صراحةً حُكم له بالأثر. فنجا من الحاجزِ — **وقِيس نجاتُه** في
 * `docs/test-reports/phase-39-W-2026-040-review-round-3-measurements.txt` — إحدى عشرةَ صيغةً،
 * منها: `while (false) {}` و`record.kind;` و`[];` و`try {} finally {}` و`if (false) { … }`
 * و`function g() { … }` و`lbl: break lbl;`.
 *
 * ## القاعدةُ المُصلِحة: **قائمةُ إثباتٍ لا قائمةُ نفي**
 *
 * لا أثرَ إلّا بأحدِ أربعةٍ تُسمّى، ومن عداها فلا أثرَ له:
 *
 *   1) **إسنادٌ** — `=` وما ركّبه (`+=` …) و`++`/`--` و`delete`؛
 *   2) **نداءٌ** لغيرِ أداةِ تسجيل — والتسجيلُ لا يُرجِع حالًا؛
 *   3) **رميٌ** — `throw`، فالرميُ نقيضُ الإسقاطِ الصامت؛
 *   4) **إنشاءٌ** — `new X()`، إذ يُبنى به المُرجَع.
 *
 * والتركيبُ لا يُوَرِّثُ أثرًا إلّا إن كان جسمُه **قابلًا للوصول**: فشرطٌ ثابتُ الكذبِ
 * (`if (false)`، `while (false)`) يُبطل ما تحته، وتصريحُ دالّةٍ أو صنفٍ **تصريحٌ لا تنفيذ**.
 *
 * ## حدُّ هذا البرهانِ — مُعلَنٌ لا مضمَر
 *
 * هذا حكمٌ **بنيويٌّ** لا سلوكيّ: يشهد أنّ في الفرعِ إسنادًا أو نداءً أو رميًا أو إنشاءً
 * قابلًا للوصول، **ولا يشهد أنّ ذلك يُعيد الحالةَ صحيحةً**. وإسنادٌ لا يُغيّر قيمةً
 * (`state.levySequence += 0`) أثرٌ بنيويًّا ولا يُرجِع شيئًا — **وهذا حدٌّ معلَنٌ يُقاس
 * لا يُنكَر**: يكشفه الوجهُ السلوكيُّ في `tests/data/rehydrate_roundtrip.test.ts` لأنّ
 * المُلاحَظَ لا يتبدّل، وقياسُه محفوظٌ بالرقمِ في تقريرِ الجولةِ الثالثة. فالحاجزانِ
 * عقدٌ واحدٌ بوجهَين: الساكنُ يمنع الحذف، والسلوكيُّ يمنع الإفراغ.
 */
import ts from 'typescript';
import { unwrap } from './rehydrate_proof';

/** أسماءُ أدواتِ التسجيلِ التي لا يُعدُّ نداءُها عملًا يُرجِع حالًا */
export const LOG_ROOTS: ReadonlySet<string> = new Set([
  'console', 'logger', 'log', 'debug', 'stdout', 'stderr',
]);

/** حدُّ الغوصِ — شجرةٌ أعمقُ منه تُرَدُّ لا أثرَ لها بدل أن تُستنفَد الذاكرة */
const MAX_DEPTH = 16;

/**
 * تعبيرٌ **ثابتُ الكذب** بالقراءةِ وحدَها: `false` · `0` · `''` · `null` · `undefined`
 * · `void …` · نفيُ ثابتِ الصدق. وما لا يُقطَع بكذبِه **يُعَدُّ قابلًا للصدق** —
 * فالافتراضُ هنا في جانبِ إبقاءِ الفرعِ مقروءًا لا إسقاطِه.
 *
 * **لِمَ هذا**: علّةُ `RC07_LOOP_GUARD_NOT_MODELED` و`if (false) { … }` كلتاهما
 * فرعٌ لا يُنفَّذ أبدًا يُحسَب أثرًا.
 */
export function constantFalsy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = unwrap(expr) as ts.Expression;
  if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) === 0;
  if (ts.isStringLiteralLike(e)) return e.text === '';
  if (ts.isIdentifier(e)) return e.text === 'undefined' || e.text === 'NaN';
  if (ts.isVoidExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    return constantTruthy(e.operand);
  }
  return false;
}

/** تعبيرٌ **ثابتُ الصدق**: `true` أو حرفٌ غيرُ خالٍ أو رقمٌ غيرُ صفر */
export function constantTruthy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = unwrap(expr) as ts.Expression;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isStringLiteralLike(e)) return e.text !== '';
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    return constantFalsy(e.operand);
  }
  return false;
}

/**
 * رمزُ إسنادٍ — يُقرأ مداه من ثوابتِ المُترجِم (`FirstAssignment…LastAssignment`)
 * لا من سردٍ مكتوبٍ باليد؛ فسردٌ يتقادم يفتح بابَ تجاوزٍ برمزٍ جديد.
 * (`ts.isAssignmentOperator` ليس من الواجهةِ المُعلَنةِ للمُترجِم، فلا يُعتمَد عليه.)
 */
function isAssignmentKind(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** نداءُ أداةِ تسجيل — `console.log(…)` وما جرى مجراه: لا يُرجِع حالًا */
function isLogCall(e: ts.Expression): boolean {
  if (!ts.isCallExpression(e)) return false;
  const callee = unwrap(e.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const root = unwrap(callee.expression);
  return ts.isIdentifier(root) && LOG_ROOTS.has(root.text);
}

/**
 * تعبيرٌ **ذو أثر** — بقائمةِ إثباتٍ لا نفي. الأنواعُ الأربعةُ المُعلَنة وحدَها،
 * وما مرّ عليه الأثرُ من أغلفةٍ (`await` · `yield` · الفاصلةُ · الشرطيُّ).
 */
export function effectfulExpression(expr: ts.Expression | undefined, depth = 0): boolean {
  if (expr === undefined || depth > MAX_DEPTH) return false;
  const e = unwrap(expr) as ts.Expression;

  // 1) إسنادٌ — `=` وما ركّبه (`+=` … `??=`)؛ والمدى من المُترجِم لا من سردٍ يتقادم
  if (ts.isBinaryExpression(e) && isAssignmentKind(e.operatorToken.kind)) return true;
  // 1-ب) زيادةٌ ونقصٌ وحذفٌ — تحويرٌ في موضعِه
  if (ts.isPostfixUnaryExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e)
    && (e.operator === ts.SyntaxKind.PlusPlusToken
      || e.operator === ts.SyntaxKind.MinusMinusToken)) return true;
  if (ts.isDeleteExpression(e)) return true;

  // 2) نداءٌ لغيرِ أداةِ تسجيل
  if (ts.isCallExpression(e) || ts.isTaggedTemplateExpression(e)) return !isLogCall(e);
  // 4) إنشاءٌ
  if (ts.isNewExpression(e)) return true;

  // أغلفةٌ يمرُّ الأثرُ عبرها
  if (ts.isAwaitExpression(e) || ts.isYieldExpression(e)) {
    return effectfulExpression(e.expression, depth + 1);
  }
  if (ts.isBinaryExpression(e)) {
    // الفاصلةُ والروابطُ المنطقيّةُ تُمرِّرُ أثرَ أحدِ طرفَيها
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.CommaToken || k === ts.SyntaxKind.AmpersandAmpersandToken
      || k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
      return effectfulExpression(e.left, depth + 1) || effectfulExpression(e.right, depth + 1);
    }
    return false;
  }
  if (ts.isConditionalExpression(e)) {
    if (constantFalsy(e.condition)) return effectfulExpression(e.whenFalse, depth + 1);
    if (constantTruthy(e.condition)) return effectfulExpression(e.whenTrue, depth + 1);
    return effectfulExpression(e.whenTrue, depth + 1)
      || effectfulExpression(e.whenFalse, depth + 1);
  }

  // ما عدا ذلك — مُعرّفٌ، وصولُ خاصّيّةٍ، حرفٌ، مصفوفةٌ، كائنٌ، مقارنةٌ — **لا أثرَ له**
  return false;
}

/**
 * عبارةٌ **ذاتُ أثر**: فيها إسنادٌ أو نداءٌ أو رميٌ أو إنشاءٌ **قابلٌ للوصول**.
 *
 * وما لا أثرَ له صراحةً: `break` · `continue` · `;` · `debugger` · `return;` بلا قيمةٍ
 * ذاتِ أثرٍ · كتلةٌ لا أثرَ فيها · **تصريحُ دالّةٍ أو صنفٍ** (تصريحٌ لا تنفيذ) ·
 * **وكلُّ تركيبٍ شرطُه ثابتُ الكذب**.
 */
export function effectful(stmt: ts.Statement | undefined, depth = 0): boolean {
  if (stmt === undefined || depth > MAX_DEPTH) return false;

  // 3) رميٌ — نقيضُ الإسقاطِ الصامت
  if (ts.isThrowStatement(stmt)) return true;

  if (ts.isExpressionStatement(stmt)) return effectfulExpression(stmt.expression, depth + 1);
  if (ts.isReturnStatement(stmt)) return effectfulExpression(stmt.expression, depth + 1);
  if (ts.isVariableStatement(stmt)) {
    return stmt.declarationList.declarations.some(
      (d) => effectfulExpression(d.initializer, depth + 1),
    );
  }
  if (ts.isBlock(stmt)) return stmt.statements.some((s) => effectful(s, depth + 1));
  if (ts.isIfStatement(stmt)) {
    const thenReachable = !constantFalsy(stmt.expression)
      && effectful(stmt.thenStatement, depth + 1);
    const elseReachable = !constantTruthy(stmt.expression)
      && effectful(stmt.elseStatement, depth + 1);
    return thenReachable || elseReachable;
  }
  if (ts.isWhileStatement(stmt) || ts.isDoStatement(stmt)) {
    // `do … while (false)` يُنفَّذ مرّةً؛ `while (false)` لا يُنفَّذ أبدًا
    if (ts.isWhileStatement(stmt) && constantFalsy(stmt.expression)) return false;
    return effectful(stmt.statement, depth + 1);
  }
  if (ts.isForStatement(stmt)) {
    if (constantFalsy(stmt.condition)) return false;
    return effectful(stmt.statement, depth + 1)
      || (stmt.initializer !== undefined && !ts.isVariableDeclarationList(stmt.initializer)
        && effectfulExpression(stmt.initializer, depth + 1));
  }
  if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt)) {
    return effectful(stmt.statement, depth + 1);
  }
  if (ts.isTryStatement(stmt)) {
    return effectful(stmt.tryBlock, depth + 1)
      || effectful(stmt.catchClause?.block, depth + 1)
      || effectful(stmt.finallyBlock, depth + 1);
  }
  if (ts.isSwitchStatement(stmt)) {
    return stmt.caseBlock.clauses.some(
      (c) => c.statements.some((s) => effectful(s, depth + 1)),
    );
  }
  if (ts.isLabeledStatement(stmt)) return effectful(stmt.statement, depth + 1);
  if (ts.isWithStatement(stmt)) return effectful(stmt.statement, depth + 1);

  // تصريحُ دالّةٍ أو صنفٍ أو واجهةٍ أو نوعٍ أو استيرادٍ — تصريحٌ لا تنفيذ
  return false;
}

/**
 * جسمُ دالّةٍ (سهمٍ أو تعبيرِ دالّةٍ) **ذو أثر** — للحكمِ على قيمةِ خريطةِ المُعالِجين
 * وعلى جسمِ المُسنِد. وسهمٌ جسمُه تعبيرٌ يُحكَم عليه بحكمِ التعبير.
 */
export function functionBodyEffectful(fn: ts.Node, depth = 0): boolean {
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)
    && !ts.isFunctionDeclaration(fn) && !ts.isMethodDeclaration(fn)) return false;
  const body = fn.body;
  if (body === undefined) return false;
  if (ts.isBlock(body)) return body.statements.some((s) => effectful(s, depth + 1));
  return effectfulExpression(body as ts.Expression, depth + 1);
}
