/**
 * scripts/rehydrate_reachability.ts — برهانُ **الوصول** (المرحلة 39 · W-2026-040 · جولة 4)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عُقدةُ تعبيرٍ أو عبارةٍ في شجرةِ نحوِ TypeScript
 * المخرجات: حكمُ ثباتِ الصدق/الكذب المركّب، وسلسلةُ الحراس، وربطُ الاسمِ بتعريفِه
 * التبعيات: مُترجمُ TypeScript و`rehydrate_constant` (لا يستوردُ شيئًا من إخوتِه — لا حلقةَ استيراد)
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
import { computedFalsy, computedLiteral, computedNotNullish, computedNullish, computedTruthy } from './rehydrate_constant';

/** فكُّ الأغلفةِ الشكليةِ: الأقواسُ والتأكيدُ النوعيُّ وعدمُ الإبطالِ — لا يغيّرون الصدق */
function strip(expr: ts.Expression): ts.Expression {
  let e = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)
      || ts.isSatisfiesExpression(e)
      || (ts.isTypeAssertionExpression !== undefined && ts.isTypeAssertionExpression(e))) {
      e = e.expression;
    } else {
      return e;
    }
  }
}

/**
 * استدعاءُ `BigInt(0)` **العالميّ**: قيمتُه `0n` — كاذبٌ قطعًا وغيرُ معدومٍ قطعًا. ولا
 * يُعتمدُ الاسمُ وحده: إن ربطَ المعرّفَ تعريفٌ محليٌّ (تظليلٌ) فلا حكمَ هنا.
 */
function isGlobalZeroBigIntCall(e: ts.Expression): boolean {
  if (!ts.isCallExpression(e)) return false;
  const callee = strip(e.expression);
  if (!ts.isIdentifier(callee) || callee.text !== 'BigInt') return false;
  const first = e.arguments[0];
  if (e.arguments.length !== 1 || first === undefined) return false;
  const arg = strip(first);
  if (!ts.isNumericLiteral(arg) || Number(arg.text) !== 0) return false;
  return resolveVariable(callee.getSourceFile(), callee) === null;
}

/**
 * تعبيرٌ **ثابتُ الكذب** — مركّبًا لا حرفيًّا: الروابطُ المنطقيّةُ تُقرأ بدلالةِ قصرِ
 * الدارة، فـ`false && true` و`false || false` و`x && false` كلُّها ثابتةُ الكذب، و`!A`
 * يُقلب. وما لا يُقطَع بكذبِه مجهول ⇒ ليس ثابتَ الكذب.
 *
 * **وعيبُ الجولةِ الخامسة** في العاملَينِ الجديدَينِ (تسميةُ المراجعِ الرافضِ في
 * `docs/work/council/W-2026-040-1-grok.md` §6):
 *   - **الفاصلةُ `(a, b)`**: قيمتُها الطرفُ الأيمنُ دومًا — فـ`(0, false)` كاذبٌ
 *     قطعًا، و`(0, x)` مجهولٌ كـx، ولا عبرةَ للطرفِ الأيسرِ في القيمةِ أصلًا.
 *   - **العدميُّ `A ?? B`**: إن كان A معدومًا حتمًا فالقيمةُ B؛ وإن كان A ثابتًا
 *     حرفيًّا غيرَ معدومٍ فالقيمةُ A نفسُه — فـ`null ?? false` كاذبٌ و`false ?? true`
 *     كاذبٌ و`'x' ?? y` صادقٌ. وما عداهما مجهولٌ لا يُقطَع.
 */
export function definitelyFalsy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) === 0;
  if (ts.isBigIntLiteral(e)) return e.text === '0n';
  if (ts.isStringLiteralLike(e)) return e.text === '';
  if (ts.isIdentifier(e)) return e.text === 'undefined' || e.text === 'NaN';
  if (ts.isVoidExpression(e)) return true;
  if (isGlobalZeroBigIntCall(e)) return true;
  if (ts.isPrefixUnaryExpression(e)) {
    if (e.operator === ts.SyntaxKind.ExclamationToken) return definitelyTruthy(e.operand);
    // **الجولةُ السادسة**: صفرٌ ببادئةٍ `-0`/`+0` — كاذبٌ قطعًا وقتَ التشغيلِ، والبادئةُ
    // لا تُغيّرُ القيمةَ العدديةَ (لا يُقطَعُ إلا على الحرفيِّ الصفريِّ).
    if ((e.operator === ts.SyntaxKind.MinusToken || e.operator === ts.SyntaxKind.PlusToken)
      && ts.isNumericLiteral(e.operand) && Number(e.operand.text) === 0) return true;
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
    // **الجولةُ الخامسة**: الفاصلةُ قيمتُها الطرفُ الأيمنُ — `(0, false)` كاذبٌ قطعًا
    if (k === ts.SyntaxKind.CommaToken) return definitelyFalsy(e.right);
    // **الجولةُ السادسة**: العدميُّ يُفصلُ معدومًا/غيرَ معدومٍ لا صادقًا/كاذبًا فقط —
    // ولا يُقطَعُ من اليسارِ إلا إذا ثبتَ عدمُ معدوميّتِه؛ فإن جهلت معدوميّتُه فالقيمةُ
    // «اليسارُ أو اليمينُ» ولا يُقطَعُ بحكمٍ واحدٍ (رفضٌ كاذبٌ كان: `(x && false) ?? true`
    // قيمتُها true إذا كان x معدومًا).
    if (k === ts.SyntaxKind.QuestionQuestionToken) {
      if (definitelyNullish(e.left)) return definitelyFalsy(e.right);
      if (definitelyNotNullish(e.left)) return definitelyFalsy(e.left);
      return false;
    }
  }
  return computedFalsy(e); // الجولةُ السابعة: ما لم تحكم به القواعدُ يُحسَبُ (rehydrate_constant)
}

/**
 * تعبيرٌ **معدومٌ حتمًا** — `null` أو `undefined` حرفيًّا. وله فصلٌ في العدمِ لا في
 * الكذب: `null ?? X` قيمتُه X، و`false ?? X` قيمتُه false — فجمعُهما في حكمٍ واحدٍ
 * يُضيّع الوجهينِ معًا (عيبُ الجولةِ الخامسة `RC07_NULLISH_CONJUNCT_DECOY_GREENS`).
 */
function definitelyNullish(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  return e.kind === ts.SyntaxKind.NullKeyword
    || (ts.isIdentifier(e) && e.text === 'undefined')
    // **الجولةُ السادسة**: `void X` قيمتُه `undefined` دومًا — فعدميّتُه قطعيةٌ، وعدُّه
    // كاذبًا في `(void 0) ?? Y` كان رفضًا كاذبًا لحيٍّ (قيمتُه Y).
    || ts.isVoidExpression(e)
    || computedNullish(e);
}

/**
 * تعبيرٌ **غيرُ معدومٍ حتمًا**: الحروفُ الثابتةُ (رقمٌ · سلسلةٌ · BigInt · صواب/كذبٌ)
 * قيمتُها نفسُها لا معدومةً أبدًا — فطرفُهُ الأيمنُ في `A ?? B` لا يُقيَّمُ أصلًا.
 * وما لا يُقطَعُ به فمجهولٌ (لا يُدّعى). `BigInt(0)` العالميُّ يُرَدُّ `0n` غيرَ معدومٍ.
 */
export function definitelyNotNullish(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  if (e.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isIdentifier(e) && e.text === 'undefined') return false;
  if (ts.isVoidExpression(e)) return false;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isNumericLiteral(e) || ts.isStringLiteralLike(e)) return true;
  if (ts.isBigIntLiteral(e)) return true;
  if (isGlobalZeroBigIntCall(e)) return true;
  return computedNotNullish(e);
}

/** تعبيرٌ **ثابتُ الصدق** — مركّبًا: `true || x` و`x || true` و`a && true` (إن صدق a فلا يُقطَع)… والقطعُ بالصدقِ لا يكونُ إلّا بثابت. */
export function definitelyTruthy(expr: ts.Expression | undefined): boolean {
  if (expr === undefined) return false;
  const e = strip(expr);
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isBigIntLiteral(e)) return e.text !== '0n';
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
    // **الجولةُ الخامسة**: الوجهُ الصادقُ للعاملَينِ الجديدَينِ — تقابلُ حكمِ الكذبِ أعلاه
    if (k === ts.SyntaxKind.CommaToken) return definitelyTruthy(e.right);
    if (k === ts.SyntaxKind.QuestionQuestionToken) {
      if (definitelyNullish(e.left)) return definitelyTruthy(e.right);
      if (definitelyNotNullish(e.left)) return definitelyTruthy(e.left);
      return false;
    }
  }
  return computedTruthy(e);
}

/** قيمةٌ حرفيّةٌ (رقمٌ أو سلسلة) لمقابلةِ مُميّزِ `switch` ببنودِه — أو null إن لم يكن حرفيًّا */
export function literalValue(expr: ts.Expression | undefined): string | number | null {
  if (expr === undefined) return null;
  const e = ts.isParenthesizedExpression(expr) ? expr.expression : expr;
  if (ts.isNumericLiteral(e)) return Number(e.text);
  if (ts.isStringLiteralLike(e)) return e.text;
  return computedLiteral(e);
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
/**
 * ذرّاتُ شرطِ حارسٍ واحد: تُفكّكُ الاقتراناتُ `&&` إلى طرفيها — فحارسٌ نصُّه
 * `journal && extra` يُخزَّن نصًّا واحدًا في `texts`، واحتواءُ النصِّ في النصِّ لا يعني
 * احتواءَ الشرطِ في الشرطِ (`journal` مُحتواةٌ في `journal && extra` دلالةً لا حرفًا).
 * **عيبُ الجولةِ الخامسة** في سيادةِ `[RC-07]`: كان القياسُ يحتوي الحارسَ نصًّا، فكان
 * حاجزٌ تحتَ `journal` وإرجاعٌ تحتَ `journal && extra` يُرى غيرَ محتوى وهو محتوى
 * دلالةً. والذرّاتُ للأحتواءِ الدلاليّ؛ والنفيُ يُحفظُ لكلِّ ذرّةٍ كما هو.
 */
function guardAtoms(expr: ts.Expression, negated: boolean, sf: ts.SourceFile, out: string[]): void {
  const e = strip(expr);
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) {
      guardAtoms(e.left, negated, sf, out);
      guardAtoms(e.right, negated, sf, out);
      return;
    }
    // **الجولةُ السادسة**: الفاصلةُ قيمتُها الطرفُ الأيمنُ — فذرّاتُها ذرّاتُه لا نصُّ
    // العاملِ كلِّه (رفضٌ كاذبٌ كان: `(0, journal)` يُرى حارسًا آخر غير `journal`).
    if (k === ts.SyntaxKind.CommaToken) {
      guardAtoms(e.right, negated, sf, out);
      return;
    }
    // **الجولةُ السادسة**: العدميُّ — يسارٌ معدومٌ حتمًا فالقيمةُ (والذرّاتُ) اليمينُ؛
    // يسارٌ غيرُ معدومٍ حتمًا فالقيمةُ اليسارُ. ومجهولُ المعدوميةِ يبقى نصًّا واحدًا
    // كاملًا (لا برهانَ على تكافؤِه فيُحتاطُ للفرعِ المقروءِ).
    if (k === ts.SyntaxKind.QuestionQuestionToken) {
      if (definitelyNullish(e.left)) {
        guardAtoms(e.right, negated, sf, out);
        return;
      }
      if (definitelyNotNullish(e.left)) {
        guardAtoms(e.left, negated, sf, out);
        return;
      }
    }
  }
  out.push((negated ? '!' : '') + e.getText(sf).replace(/\s+/g, ''));
}

export function guardsOf(sf: ts.SourceFile, node: ts.Node): {
  readonly texts: readonly string[]; readonly atoms: readonly string[];
  readonly unsatisfiable: boolean; readonly fn: ts.Node | null;
} {
  const texts: string[] = [];
  const atoms: string[] = [];
  let unsatisfiable = false;
  let cur: ts.Node = node;
  for (;;) {
    const p: ts.Node | undefined = cur.parent;
    if (p === undefined) return { texts: [...texts].sort(), atoms: [...atoms].sort(), unsatisfiable, fn: null };
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)
      || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) {
      return { texts: [...texts].sort(), atoms: [...atoms].sort(), unsatisfiable, fn: p };
    }
    if (ts.isIfStatement(p) && p.expression !== cur) {
      const negated = p.elseStatement === cur;
      texts.push((negated ? '!' : '') + p.expression.getText(sf).replace(/\s+/g, ''));
      guardAtoms(p.expression, negated, sf, atoms);
      if (negated ? definitelyTruthy(p.expression) : definitelyFalsy(p.expression)) {
        unsatisfiable = true;
      }
    }
    if (ts.isConditionalExpression(p) && p.condition !== cur) {
      const negated = p.whenFalse === cur;
      texts.push((negated ? '!' : '') + p.condition.getText(sf).replace(/\s+/g, ''));
      guardAtoms(p.condition, negated, sf, atoms);
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
        guardAtoms(cond, false, sf, atoms);
        if (!ts.isDoStatement(p) && definitelyFalsy(cond)) unsatisfiable = true;
      }
    }
    if (ts.isForOfStatement(p) && p.statement === cur) {
      texts.push(`for-of:${p.expression.getText(sf).replace(/\s+/g, '')}`);
      atoms.push(`for-of:${p.expression.getText(sf).replace(/\s+/g, '')}`);
      // **عيبُ الجولةِ الرابعة**: `for (const x of [])` — جسمٌ لا يدور؛ والمصفوفةُ
      // الفارغةُ حرفيًّا تُقطَع بها الدارةُ قطعًا، لا تُظنّ. **والجولةُ السادسة**: تُقشَرُ
      // الأغلفةُ أولًا — فقوسٌ أو `as const` كان يخفيها (`([])` · `[] as const`).
      const iter = strip(p.expression);
      if (ts.isArrayLiteralExpression(iter) && iter.elements.length === 0) {
        unsatisfiable = true;
      }
    }
    // **عيبُ الجولةِ الرابعة** `RC07_SHORT_CIRCUIT_CONDITION_ESCAPES_GUARDS`: نداءٌ في
    // الطرفِ الأيمنِ لرابطٍ منطقيٍّ لا يُنفَّذ إن قطعَ الطرفُ الأيسرُ الدارةَ قبله.
    // **والجولةُ السادسة**: العدميُّ رابطٌ قاصِرٌ كأخويه — يسارٌ غيرُ معدومٍ حتمًا
    // فاليمينُ لا يُقيَّمُ أبدًا (`false ?? census()` لا ينادي).
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      // **الجولةُ السابعة** (`RC07_*_SKIPS_CENSUS`): يسارُ القاصرِ حارسٌ ليمينِه كشرطِ `if` — ذرّةٌ
      // (منفيّةٌ في `||`، معدوميّةٌ في `??`)؛ فما لا يُحسَبُ لا يطابقُ حرّاسَ الإرجاعِ ولا يؤيّدُ السيادة.
      if (within(cur, p.right)) {
        const t = p.left.getText(sf).replace(/\s+/g, '');
        if (k === ts.SyntaxKind.AmpersandAmpersandToken && !definitelyTruthy(p.left)) {
          texts.push(t); guardAtoms(p.left, false, sf, atoms);
        } else if (k === ts.SyntaxKind.BarBarToken && !definitelyFalsy(p.left)) {
          texts.push(`!${t}`); guardAtoms(p.left, true, sf, atoms);
        } else if (k === ts.SyntaxKind.QuestionQuestionToken && !definitelyNullish(p.left)) {
          texts.push(`nullish:${t}`); atoms.push(`nullish:${t}`);
        }
      }
      if ((k === ts.SyntaxKind.AmpersandAmpersandToken
        && within(cur, p.right) && definitelyFalsy(p.left))
        || (k === ts.SyntaxKind.BarBarToken
          && within(cur, p.right) && definitelyTruthy(p.left))
        || (k === ts.SyntaxKind.QuestionQuestionToken
          && within(cur, p.right) && definitelyNotNullish(p.left))) {
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
