/**
 * **الجولةُ السادسةُ (gpt §3 · تصويبُ الجلسة 157 بعد ملاحظةِ المراجع):** الهويةُ ربطٌ لا نصٌّ.
 * فكُّ الأغلفةِ حولَ مستدعى نداءِ الحاجزِ وإثباتُ أنّ تعريفَهُ الفائزَ **محدِّدُ استيرادٍ من
 * وحدةِ الحصرِ نفسِها** — أُخرجَت هنا من `check_rehydrate_census.ts` ليبقى تحتَ سقفِ الوحدةِ
 * (400 سطرًا · سابقةُ تفكيكِ المساعداتِ في T-142) لا دَينًا يُعلَن.
 *
 * **لماذا عقدةُ التعريفِ لا أوسعيةُ النطاقِ:** نطاقُ الملفِّ يملكُهُ الاستيرادُ الحقيقيُّ
 * **وأيضًا** دالةٌ محليّةٌ بنفسِ الاسمِ أو استيرادٌ من وحدةٍ أخرى — والمرجعُ الهاربُ في
 * الحاجزِ يعفي الاستيراداتِ كافةً فلا ينفعُ وحدهُ. وحدَها عقدةُ التعريفِ الفائزةُ (أضيقُ
 * نطاقِ ربطٍ يحوي الاستعمالَ — كحلِّ اللغةِ نفسِهِ) تُثبتُ الهويةَ.
 */
import ts from 'typescript';
import { innermostBindingDeclaration } from './rehydrate_constant';

/** فكُّ الأغلفةِ المسموحِ بها حولَ المستدعى (أقواسٌ · `as` · `!` · فاصلةٌ يُؤخذُ يمينُها) */
export function unwrapCallee(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)
      || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken) cur = cur.right;
    else return cur;
  }
}

/**
 * وحدةُ الاستيرادِ التي يملكُها تعريفُ هذا المعرّفِ **إن كانَ تعريفُهُ الفائزُ محدِّدَ استيرادٍ**
 * — وإلا فلا شيء: فالدالةُ المحليّةُ والمعاملُ وتفكيكُ القوائمِ واستيرادُ الوحداتِ الأخرى
 * كلُّها ليست هويةَ الحاجزِ وإن تطابقَ النصُّ.
 */
export function importModuleOfWinner(id: ts.Identifier): string | undefined {
  const decl = innermostBindingDeclaration(id);
  if (decl === undefined || !ts.isImportSpecifier(decl)) return undefined;
  const owner = decl.parent.parent.parent; // محدد → مسميات → عبارة → إعلان الاستيراد
  if (owner === undefined || !ts.isImportDeclaration(owner) || !ts.isStringLiteralLike(owner.moduleSpecifier)) return undefined;
  return owner.moduleSpecifier.text;
}
