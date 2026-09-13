/**
 * scripts/rehydrate_reachability.ts — برهانُ **الوصول** (المرحلة 39 · W-2026-040 · جولة 4)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عُقدةُ تعبيرٍ أو عبارةٍ في شجرةِ نحوِ TypeScript
 * المخرجات: حكمُ ثباتِ الصدق/الكذب المركّب، وسلسلةُ الحراس، وربطُ الاسمِ بتعريفِه
 * التبعيات: مُترجمُ TypeScript وحدَه — لا تستوردُ من إخوتِها شيئًا (لا حلقةَ استيراد)
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ ما لا يُقطَع بكذبِه **يُعَدُّ قابلًا للصدق** — فالافتراضُ في جانبِ
 *   إبقاءِ الفرعِ مقروءًا لا إسقاطِه، وحاجزٌ يرفضُ الصحيحَ يدفعُ إلى التزوير.
 * اختبار القبول: tests/data/rehydrate_census_mutations_r4.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *   · سجلُّ المراجعةِ التي أوجبت هذا الملف: docs/test-reports/phase-39-W-2026-040-review-round-4.md
 *
 * ## العيبُ الذي أوجب هذا الملف — الصيغةُ الرابعة
 *
 * رُفض البرهانُ أربعَ جولاتٍ بعلّةٍ واحدةٍ تُبدّل ثوبَها، والجولةُ الرابعةُ كشفتِ الوجهَ
 * الذي لم يُنظر فيه قبلًا: **الوصول**. فالحاجزُ بعد الجولةِ الثالثةِ يُحسنُ **التصنيف**
 * (ما يُعَدّ أثرًا — قائمةُ إثباتٍ مغلقةٌ) لكنّه لا يُثبت **قابليةَ التنفيذ** ولا **رابطةَ
 * التعريف**: الآلةُ تجمعُ وجودَ عُقدٍ وصيغٍ مناسبة. فنجا منها — كلُّه مقيسٌ في
 * `docs/test-reports/phase-39-W-2026-040-review-round-4-measurements.txt`:
 *
 *   - `EFFECT_CROSSES_COMPOUND_CONSTANT_FALSY`: `if (false && true) { … }` و`false && (…+= 1);`
 *     — ثابتُ الكذبِ كان حرفيًّا لا يغوصُ في الروابط.
 *   - `RC07_SHORT_CIRCUIT_CONDITION_ESCAPES_GUARDS`: نداءُ الحاجزِ داخلَ `(false && (…, true))`
 *     في **شرطِ** الحارسِ نفسِه — والجامعُ يسجّلُ الفرعَ لا ما داخلَ الشرط.
 *   - `RC07_SWITCH_GUARD_NOT_MODELED` و`for (const x of [])`: حارسانِ لا يُقرآنِ أصلًا.
 *   - `HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME`: ربطُ الجدولِ **اسمٌ على مستوى الملفِّ** —
 *     جدولانِ باسمٍ واحد: الحقيقيُّ لم يُفتح والفارغُ هو الذي نودي.
 *   - وأخطرُها شاهدًا: **إقلاعٌ حقيقيٌّ بدعوى محذوفةٍ مضى بلا رمز** — فغيابُ حكمِ الوصولِ
 *     ليس تجميلًا ناقصًا بل نقضٌ لجوهرِ البند.
 *
 * ## العقدُ هنا
 *
 * حكمُ الوصولِ **جزءٌ من عقدِ الحاجزِ لا تعليقٌ عليه**، وهو وجهٌ لحكمِ الأثرِ لا بابٌ
 * آخر: «فرعٌ ذو أثرٍ قابلٍ للوصول» عقدٌ واحد. وكلُّ حكمٍ هنا **ثلاثيُّ القيمة**
 * (ثابتُ الصدق · ثابتُ الكذب · مجهول) والمجهولُ **يُعامَل قابلًا للصدق** — فالرفضُ
 * لا يكونُ إلّا بثابتٍ مقيسٍ لا بظنّ.
 */
import ts from 'typescript';

/** فكُّ الأغلفةِ الشكليةِ: الأقواسُ والتأكيدُ النوعيُّ وعدمُ الإبطالِ — لا يغيّرون الصدق */
function strip(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
      || (ts.isTypeAssertionExpression !== undefined && ts.isTypeAssertionExpression(e))) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

/**
 * تعبيرٌ **ثابتُ الكذب** — مركّبًا لا حرفيًّا: الروابطُ المنطقيّةُ تُقرأ بدلالةِ قصرِ
 * الدارة، فـ`false && true` و`false || false` و`x && false` كلُّها ثابتةُ الكذب، و`!A`
 * يُقلب. وما لا يُقطَع بكذبِه مجهول ⇒ ليس ثابتَ الكذب.
 */
export function definitelyFalsy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) === 0;
  if (ts.isStringLiteralLike(e)) return e.text === '';
  if (ts.isIdentifier(e)) return e.text === 'undefined' || e.text === 'NaN';
  if (ts.isVoidExpression(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) {
    if (e.operator === ts.SyntaxKind.ExclamationToken) return definitelyTruthy(e.operand);
    return false;
  }
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) {
      // A && B كاذبٌ إن كان أحدُ الطرفَينِ كاذبًا — أيُّ طرفٍ يكفي
      return definitelyFalsy(e.left) || definitelyFalsy(e.right);
    }
    if (k === ts.SyntaxKind.BarBarToken) {
      // A || B كاذبٌ إن كذبَ الطرفانِ معًا
      return definitelyFalsy(e.left) && definitelyFalsy(e.right);
    }
  }
  return false;
}

/** تعبيرٌ **ثابتُ الصدق** — مركّبًا: `true || x` و`x || true` و`a && true` (إن صدق a فلا يُقطَع)… والقطعُ بالصدقِ لا يكونُ إلّا بثابت. */
export function definitelyTruthy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isStringLiteralLike(e)) return e.text !== '';
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) {
    return definitelyFalsy(e.operand);
  }
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) {
      return definitelyTruthy(e.left) && definitelyTruthy(e.right);
    }
    if (k === ts.SyntaxKind.BarBarToken) {
      return definitelyTruthy(e.left) || definitelyTruthy(e.right);
    }
  }
  return false;
}

/** قيمةٌ حرفيّةٌ (رقمٌ أو سلسلة) لمقابلةِ مُميّزِ `switch` ببنودِه — أو null إن لم يكن حرفيًّا */
export function literalValue(expr: ts.Expression | undefined): string | number | null {
  if (expr === undefined) return null;
  const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isStringLiteralLike(e)) return e.text;
  return null;
}

/** هل العقدةُ `inner` داخلَ مدى `outer` (نطاقُ شجرةٍ مُعرَّفةٍ بالمواضع) */
function within(inner: ts.Node, outer: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/**
 * سلسلةُ الشروطِ الحاكمةِ على عقدةٍ حتّى أقربِ دالّةٍ تحويها — مع النفيِ إن كانت في الفرعِ الآخر.
 *
 * **وامتدادُ الجولةِ الرابعة**: كان الجامعُ يسجّلُ حراسَ الفرعِ (`if`/شرطي/حلقة) ولا يرى
 * ما **داخلَ التعابير**: قصرَ الدارةِ (`A && (B, true)` حيث A ثابتُ الكذب — الطرفُ الأيمنُ
 * لا يُنفَّذ)، وبندَ `switch` الذي لا يوافقُ مُميّزَه الحرفيَّ، وجسمَ `for-of` على مصفوفةٍ
 * فارغةٍ حرفيًّا، و`catch` لكتلةِ `try` خاويةٍ — كلُّها مواضعُ لا يُنفَّذُ ما فيها، وكلُّها
 * صارت تُسقِط الحكمَ إسقاطًا.
 */
export function guardsOf(sf: ts.SourceFile, node: ts.Node): {
  readonly texts: readonly string[]; readonly unsatisfiable: boolean; readonly fn: ts.Node | null;
} {
  const texts: string[] = [];
  let unsatisfiable = false;
  let cur: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = cur.parent;
    if (p === undefined) return { texts: [...texts].sort(), unsatisfiable, fn: null };
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)
      || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) {
      return { texts: [...texts].sort(), unsatisfiable, fn: p };
    }
    if (ts.isIfStatement(p) && p.expression !== cur) {
      const negated = p.elseStatement === cur;
      texts.push((negated ? '!' : '') + p.expression.getText(sf).replace(/\s+/g, ''));
      if (negated ? definitelyTruthy(p.expression) : definitelyFalsy(p.expression)) {
        unsatisfiable = true;
      }
    }
    if (ts.isConditionalExpression(p) && p.condition !== cur) {
      const negated = p.whenFalse === cur;
      texts.push((negated ? '!' : '') + p.condition.getText(sf).replace(/\s+/g, ''));
      if (negated ? definitelyTruthy(p.condition) : definitelyFalsy(p.condition)) {
        unsatisfiable = true;
      }
    }
    // حارسُ الحلقةِ شرطٌ كشرطِ `if`، وثابتُ الكذبِ منه يُبطِل النداء — إلا `do … while`
    // فإنّه يُنفَّذ مرّةً قبل الشرط.
    if ((ts.isWhileStatement(p) || ts.isForStatement(p) || ts.isDoStatement(p))
      && p.statement === cur) {
      const cond = ts.isForStatement(p) ? p.condition : p.expression;
      if (cond !== undefined) {
        texts.push(cond.getText(sf).replace(/\s+/g, ''));
        if (!ts.isDoStatement(p) && definitelyFalsy(cond)) unsatisfiable = true;
      }
    }
    if (ts.isForOfStatement(p) && p.statement === cur) {
      texts.push(`for-of:${p.expression.getText(sf).replace(/\s+/g, '')}`);
      // **عيبُ الجولةِ الرابعة**: `for (const x of [])` — جسمٌ لا يدور؛ والمصفوفةُ
      // الفارغةُ حرفيًّا تُقطَع بها الدارةُ قطعًا، لا تُظنّ.
      if (ts.isArrayLiteralExpression(p.expression) && p.expression.elements.length === 0) {
        unsatisfiable = true;
      }
    }
    // **عيبُ الجولةِ الرابعة** `RC07_SHORT_CIRCUIT_CONDITION_ESCAPES_GUARDS`: نداءٌ في
    // الطرفِ الأيمنِ لرابطٍ منطقيٍّ لا يُنفَّذ إن قطعَ الطرفُ الأيسرُ الدارةَ قبله.
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if ((k === ts.SyntaxKind.AmpersandAmpersandToken
        && within(cur, p.right) && definitelyFalsy(p.left))
        || (k === ts.SyntaxKind.BarBarToken
          && within(cur, p.right) && definitelyTruthy(p.left))) {
        unsatisfiable = true;
      }
    }
    // **عيبُ الجولةِ الرابعة** `RC07_SWITCH_GUARD_NOT_MODELED`: بندُ `case` لا يوافقُ
    // مُميّزَ الـ`switch` الحرفيَّ لا يُنفَّذ أبدًا — فما في جسمِه غيرُ قابلٍ للوصول.
    if (ts.isCaseClause(p)) {
      const sw = p.parent.parent;
      if (ts.isSwitchStatement(sw)) {
        const d = literalValue(sw.expression);
        const c = literalValue(p.expression);
        if (d !== null && c !== null && d !== c) unsatisfiable = true;
      }
    }
    // **عيبُ الجولةِ الرابعة** `EFFECT_REACHABILITY_IS_SYNTAX_UNION`: `catch` لكتلةِ
    // `try` خاويةٍ لا يمكن أن ترميَ شيئًا — فلا يُنفَّذ ما في `catch` أبدًا. وحدُّنا
    // مُعلَن: الخواءُ وحدَه يُقطَع به؛ كتلةٌ فيها بيانٌ فالرميُ فيها ممكن.
    if (ts.isCatchClause(p) && within(cur, p.block)) {
      const t = p.parent.tryBlock;
      if (t.statements.length === 0) unsatisfiable = true;
    }
    cur = p;
  }
}

/** نطاقُ التعريف: أقربُ كتلةٍ أو ملفٍّ يحوي التعريف — لحسابِ «أيُّ تعريفٍ يرى الاستعمالَ» */
function declarationScope(d: ts.VariableDeclaration): ts.Node {
  let cur: ts.Node = d;
  while (cur.parent !== undefined) {
    const p = cur.parent;
    if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseBlock(p) || ts.isModuleBlock(p)) return p;
    cur = p;
  }
  return cur;
}

/**
 * ربطُ الاسمِ **بتعريفِه** لا بوجودِه: أقربُ تعريفٍ لمتغيّرٍ بهذا الاسمِ نطاقُه يحوي
 * الاستعمال. **وعيبُ الجولةِ الرابعة** `HANDLER_MAP_BINDING_IS_FILE_GLOBAL_NAME`: كان
 * الربطُ اسمًا على مستوى الملفِّ كلِّه، فجدولانِ باسمٍ واحدٍ في كتلتَين — الحقيقيُّ لم
 * يُفتح والفارغُ هو الذي فُتح ونودي — أخضرّا. فصار الجدولُ المفتوحُ **تعريفًا بعينِه**
 * لا كلَّ اسمٍ يوافقُه.
 */
export function resolveVariable(sf: ts.SourceFile, usage: ts.Identifier): ts.VariableDeclaration | null {
  const candidates: ts.VariableDeclaration[] = [];
  walkAll(sf, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === usage.text) {
      candidates.push(n);
    }
  });
  let best: ts.VariableDeclaration | null = null;
  for (const d of candidates) {
    const scope = declarationScope(d);
    if (!within(usage, scope)) continue;
    // الأعمقُ نطاقًا يفوز (نطاقُه يبدأ أبعدَ)؛ وعند التعادل يفوزُ الأحدثُ تعريفًا
    if (best === null || scope.pos >= declarationScope(best).pos
      || (scope.pos === declarationScope(best).pos && d.pos > best.pos)) {
      best = d;
    }
  }
  return best;
}

/** مشيٌ بسيطٌ على الشجرة — محليٌّ هنا كي لا تستوردَ هذه الوحدةُ شيئًا (لا حلقةَ استيراد) */
function walkAll(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walkAll(child, visit));
}
