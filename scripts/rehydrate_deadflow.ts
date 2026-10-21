/**
 * scripts/rehydrate_deadflow.ts — قواعدُ موتِ الفرعِ: ما لا يُنفَّذُ لا يُعَدُّ حيًّا (المرحلة 39 · W-2026-040 · الجولة 8)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عقدةُ أبٍ في شجرةِ نحوِ TypeScript وعقدةُ الاستعمالِ داخلَها
 * المخرجات: حكمُ «ما داخلَ هذا الأبِ غيرُ قابلٍ للوصول» — ذرّةٌ من برهانِ الوصولِ
 * التبعيات: مُترجمُ TypeScript وحدَه (لا يستوردُ شيئًا من إخوتِه — لا حلقةَ استيراد؛
 *   `literalValue` و`strip` تُمرَّرانِ معاملَينِ لا تُستوردانِ)
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ قاعدةٌ لا تنطبقُ ⇒ حكمُها «حيٌّ» (الافتراضُ في جانبِ قراءةِ الفرع)
 * اختبار القبول: tests/data/rehydrate_census_mutations_r8.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * ## لماذا وُلدت هذه الوحدة (الجولةُ الثامنة)
 *
 * رُفعَ سقفُ `scripts/rehydrate_reachability.ts` (400 سطرٍ) بقواعدِ الجولةِ الرابعةِ والثامنةِ،
 * ففُكِّكَ كما فُكِّكَت `rehydrate_constant.ts` قبلها (سابقةُ الجولةِ السابعةِ): برهانُ الوصولِ
 * بابانِ — **قيمةُ التعبيرِ** (ثابتُ الصدقِ/الكذبِ: `rehydrate_constant.ts`) و**موتُ الفرعِ**
 * (هذه الوحدة). والقواعدُ هنا كلُّها من عائلةٍ واحدةٍ مسمّاةً في خامِّ مجلسِ الجولةِ الرابعةِ:
 * «نداءٌ ميتٌ يُعَدُّ حيًّا» (grok §4) — `catch` لكتلةٍ لا ترمي · `break label` مباشرٌ يعبرُ
 * ما بعدَه · `default` يوافقُه بندُ مميّزٍ حرفيٌّ · بندُ `case` يخالفُ المميّزَ · جسمُ مرورٍ
 * على مصفوفةٍ فارغةٍ حرفيًّا. وحدُّ كلِّ قاعدةٍ معلَنٌ في تعليقِها: يُقطَعُ بالثابتِ المقيسِ
 * لا بالظنّ.
 */
import ts from 'typescript';

/** هل العقدةُ `inner` داخلَ مدى `outer` (نطاقُ شجرةٍ مُعرَّفٌ بالمواضع) */
function within(inner: ts.Node, outer: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/** المعاملاتُ المُمرَّرةُ من برهانِ الوصولِ — حقنٌ لا استيرادٌ فلا حلقةَ */
export interface DeadFlowDeps {
  readonly literalValue: (expr: ts.Expression | undefined) => string | number | null;
  readonly strip: (expr: ts.Expression) => ts.Expression;
}

/**
 * **الجولةُ الثامنة**: بيانٌ لا يمكن أن يرميَ — إعلانُ متغيِّرٍ بمُبدِّعٍ لا يرمي: حرفيٌّ
 * أو اسمٌ. النداءُ والوصولُ والرميُ والإنشاءُ لا يُقطَع بها.
 */
export function cannotThrowStatement(s: ts.Statement, strip: DeadFlowDeps['strip']): boolean {
  if (!ts.isVariableStatement(s)) return false;
  return s.declarationList.declarations.every((d) => {
    const init = d.initializer;
    if (init === undefined) return false;
    const e = strip(init);
    return ts.isNumericLiteral(e) || ts.isStringLiteralLike(e) || ts.isBigIntLiteral(e)
      || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword
      || e.kind === ts.SyntaxKind.NullKeyword || ts.isIdentifier(e);
  });
}

/**
 * حكمُ موتِ الفرعِ لعقدةِ أبٍ `p` وعقدةِ استعمالٍ `cur` داخلَها — قواعدُ الجولتينِ الرابعةِ
 * والثامنةِ في موضعٍ واحد. كلُّ قاعدةٍ معلَنةُ الحدِّ في مكانِها؛ وما لم تنطبقْ واحدةٌ
 * فالفرعُ حيٌّ (الافتراضُ في جانبِ القراءةِ).
 */
export function deadByControlFlow(p: ts.Node, cur: ts.Node, deps: DeadFlowDeps): boolean {
  // **عيبُ الجولةِ الرابعة** `RC07_SWITCH_GUARD_NOT_MODELED`: بندُ `case` لا يوافقُ
  // مُميّزَ الـ`switch` الحرفيَّ لا يُنفَّذ أبدًا — فما في جسمِه غيرُ قابلٍ للوصول.
  if (ts.isCaseClause(p)) {
    const sw = p.parent.parent;
    if (ts.isSwitchStatement(sw)) {
      const d = deps.literalValue(sw.expression);
      const c = deps.literalValue(p.expression);
      if (d !== null && c !== null && d !== c) return true;
    }
  }
  // **عيبُ الجولةِ الرابعة** `EFFECT_REACHABILITY_IS_SYNTAX_UNION`: `catch` لكتلةِ
  // `try` خاويةٍ لا يمكن أن ترميَ شيئًا — فلا يُنفَّذ ما في `catch` أبدًا. وحدُّنا
  // مُعلَن: الخواءُ وحدَه يُقطَع به؛ كتلةٌ فيها بيانٌ فالرميُ فيها ممكن.
  // **والجولةُ الثامنة** (نداءٌ ميتٌ يُعَدُّ حيًّا عندَ grok): الخواءُ ليس وحدَه ما لا
  // يرمي — فالإعلانُ المحضُ بلا نداءٍ ولا وصولٍ لا يرمي شيئًا. والحدُّ مُعلَن: يُقطَع
  // بالإعلانِ المحضِ وحده؛ ما فيه نداءٌ أو وصولٌ أو رميٌ فالرميُ فيها ممكن.
  if (ts.isCatchClause(p) && within(cur, p.block)) {
    const t = p.parent.tryBlock;
    if (t.statements.length === 0 || t.statements.every((s) => cannotThrowStatement(s, deps.strip))) return true;
  }
  // **الجولةُ الثامنة** (وجهُ grok `break skipCensus`): خروجٌ بلا شرطٍ من كتلةٍ مُسمّاةٍ
  // يَعبرُ ما بعدَه فيها — فبيانٌ لاحقٌ بعدَ `break label` مُباشرٍ غيرُ قابلٍ للوصول.
  // والحدُّ مُعلَن: البروزُ المُباشرُ غيرُ المشرطِ وحدَه؛ فـ`break` داخلَ شرطٍ قد لا يُنفَّذ.
  if (ts.isBlock(p) && ts.isLabeledStatement(p.parent)) {
    const label = p.parent.label.text;
    for (const s of p.statements) {
      if (s.pos >= cur.pos) break;
      if (ts.isBreakStatement(s) && s.label?.text === label) return true;
    }
  }
  // **الجولةُ الثامنة** (وجهُ grok `default` المطابق): مُميّزُ التبديلِ حرفيٌّ وبندٌ
  // يوافِقُه صريحًا — فالفرعُ `default` لا يُنفَّذ أبدًا. والحدُّ مُعلَن: يُقطَع به فقط
  // عندَ ثبوتِ حرفيّةِ المُميِّزِ ومطابقةِ بندٍ له؛ فمُميّزٌ مجهولٌ يُبقي كلَّ البنودِ مقروءةً.
  if (ts.isDefaultClause(p)) {
    const sw = p.parent.parent;
    if (ts.isSwitchStatement(sw)) {
      const d = deps.literalValue(sw.expression);
      if (d !== null && p.parent.clauses.some((c) => ts.isCaseClause(c) && deps.literalValue(c.expression) === d)) {
        return true;
      }
    }
  }
  // **عيبُ الجولةِ الرابعة**: `for (const x of [])` — جسمٌ لا يدور؛ والمصفوفةُ
  // الفارغةُ حرفيًّا تُقطَع بها الدارةُ قطعًا، لا تُظنّ (والجولةُ السادسة: تُقشَرُ الأغلفةُ).
  if (ts.isForOfStatement(p) && p.statement === cur) {
    const iter = deps.strip(p.expression);
    if (ts.isArrayLiteralExpression(iter) && iter.elements.length === 0) return true;
  }
  return false;
}
