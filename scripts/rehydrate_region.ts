/**
 * scripts/rehydrate_region.ts — **منطقةُ التنفيذ**: ما يُنفَّذُ دائمًا وما يُنفَّذُ بشرطٍ (المرحلة 39 · W-2026-040 · الجولة 9)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: عقدةُ أبٍ في شجرةِ نحوِ TypeScript وعقدةُ الاستعمالِ داخلَها
 * المخرجات: ذرّةُ شرطٍ **معتمةٌ** إن كان دخولُ الاستعمالِ من الأبِ مشروطًا بما لا يُنمذَج، وحكمُ الموت
 * التبعيات: مُترجمُ TypeScript وحدَه (لا يستوردُ شيئًا من إخوتِه — لا حلقةَ استيراد؛ القيمةُ تُمرَّرُ حقنًا)
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي؛ بنيةٌ لم تُسمَّ هنا ⇒ **ذرّةٌ معتمة** (مشروطٌ) لا «حيٌّ بلا شرط»
 * اختبار القبول: tests/data/rehydrate_census_mutations_r9.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * ## لماذا وُلدت هذه الوحدة (الجولةُ التاسعة · محضر `docs/work/council/W-2026-040-5.json`)
 *
 * درسُ البندِ المتكرّرُ منذ الجولةِ الثانيةِ بلفظِ grok (`W-2026-040-5-grok.md` §5-ب): **قائمةُ
 * نفيٍ مغلقةٌ تُنجي ما لم يُذكر**. كان برهانُ الوصولِ يُعدِّدُ صيغَ الموتِ (`catch` لكتلةٍ لا ترمي ·
 * `break label` · `default` مطابق · `case` مخالف · `for-of []`) وما لم يُعدَّد **حيٌّ بلا شرط** —
 * فنجا `for (;;) { break; census() }` و`switch (0n) { … default: census() }` و
 * `try { console.log() } catch { census() }`، وثلاثةُ أوجهٍ قاسها المنفّذُ من العائلةِ نفسِها:
 * بندُ `switch` مجهولُ المميّز، و`break` مشروطٌ قبلَ الحاجزِ في حلقة، والحاجزُ داخلَ `try` يُبلَعُ رميُه.
 *
 * ## العقدُ هنا — الافتراضُ مقلوبٌ في جانبِ السيادة
 *
 * سيادةُ نداءِ الحصرِ (`[RC-07]`) دعوى **إيجابيّة**: «كلُّ مسلكٍ إلى الإرجاعِ مرَّ بالحاجز». فلا
 * تُثبَتُ بغيابِ صيغةِ موتٍ معروفة، بل بأن يكونَ كلُّ أبٍ بين النداءِ والدالّةِ **ممرًّا مُسمًّى**
 * يُنفِّذُ ما فيه كلّما نُفِّذ هو (قائمةُ إثباتٍ لا قائمةُ نفي). وما لم يُسمَّ ممرًّا أضافَ **ذرّةً معتمةً**
 * مفتاحُها موضعُ البنيةِ نفسِها — فنداءُ إرجاعٍ داخلَ البنيةِ نفسِها يحملُ الذرّةَ نفسَها (لا رفضَ
 * كاذبًا لمن يشاركُ الحاجزَ منطقتَه)، ونداءٌ خارجَها لا يحملُها فيسقطُ الاحتواء. والمجهولُ لا يؤيّدُ
 * السيادة (RULE-001).
 *
 * وكذلك **البياناتُ السابقةُ** في الكتلةِ نفسِها: بيانٌ يخرجُ حتمًا (`break`/`continue`/`return`/`throw`
 * مباشرٌ) يُميتُ ما بعدَه؛ وبيانٌ **قد** يخرجُ من الكتلة (فيه `break`/`continue`/`return` يعبرُ حدَّه)
 * يجعلُ ما بعدَه مشروطًا ⇒ ذرّةٌ معتمةٌ بموضعِه. والرميُ لا يُعَدُّ مخرجًا هنا: رميٌ قبلَ الحاجزِ يقطعُ
 * ما بعدَه من الإرجاعِ معه ما لم يُلتقَط — والالتقاطُ نفسُه بنيةٌ معتمةٌ أعلاه (`try`/`catch`).
 */
import ts from 'typescript';

/** هل العقدةُ `inner` داخلَ مدى `outer` (نطاقُ شجرةٍ مُعرَّفٌ بالمواضع) */
export function within(inner: ts.Node, outer: ts.Node): boolean {
  return inner.pos >= outer.pos && inner.end <= outer.end;
}

/** ما يُحقَنُ من برهانِ الوصول: قيمةُ المميّزِ وصدقُ الشرط — حقنٌ لا استيرادٌ فلا حلقة */
export interface RegionDeps {
  readonly literalValue: (expr: ts.Expression | undefined) => { readonly value: unknown } | null;
  readonly definitelyTruthy: (expr: ts.Expression | undefined) => boolean;
  readonly definitelyFalsy: (expr: ts.Expression | undefined) => boolean;
}

const isFunctionLike = (n: ts.Node): boolean => ts.isFunctionLike(n) || ts.isClassLike(n);
const isBreakTarget = (n: ts.Node): boolean => ts.isIterationStatement(n, false) || ts.isSwitchStatement(n);

/** بيانٌ **يخرجُ حتمًا** من الكتلةِ التي هو فيها — فما بعدَه فيها ميت */
export function mustExit(s: ts.Statement, deps: RegionDeps): boolean {
  if (ts.isReturnStatement(s) || ts.isThrowStatement(s) || ts.isBreakStatement(s) || ts.isContinueStatement(s)) return true;
  if (ts.isBlock(s)) return s.statements.some((x) => mustExit(x, deps));
  if (ts.isIfStatement(s)) {
    if (deps.definitelyTruthy(s.expression)) return mustExit(s.thenStatement, deps);
    if (deps.definitelyFalsy(s.expression)) return s.elseStatement !== undefined && mustExit(s.elseStatement, deps);
    return mustExit(s.thenStatement, deps) && s.elseStatement !== undefined && mustExit(s.elseStatement, deps);
  }
  return false; // ما سواه لا يُقطَعُ بخروجِه — ويُسألُ عنه «قد يخرج» أدناه
}

/**
 * بيانٌ **قد يخرجُ** من الكتلة: فيه `return`، أو `break`/`continue` هدفُه خارجَه (غيرُ مُسمًّى وليس
 * داخلَ حلقةٍ أو تبديلٍ في البيانِ نفسِه، أو مُسمًّى ووسمُه ليس في البيانِ نفسِه). ولا يُنزَلُ إلى دالّةٍ
 * أو صنفٍ متداخلٍ — خروجُهما خروجُهما.
 */
export function mayExit(s: ts.Statement): boolean {
  let found = false;
  const labels: string[] = [];
  const visit = (n: ts.Node, loopDepth: number): void => {
    if (found || isFunctionLike(n)) return;
    if (ts.isReturnStatement(n)) { found = true; return; }
    if (ts.isBreakStatement(n) || ts.isContinueStatement(n)) {
      if (n.label !== undefined ? !labels.includes(n.label.text) : loopDepth === 0) { found = true; return; }
    }
    if (ts.isLabeledStatement(n)) {
      labels.push(n.label.text);
      n.forEachChild((c) => visit(c, loopDepth));
      labels.pop();
      return;
    }
    const depth = isBreakTarget(n) ? loopDepth + 1 : loopDepth;
    n.forEachChild((c) => visit(c, depth));
  };
  visit(s, 0);
  return found;
}

/** موضعٌ مقروءٌ للذرّة المعتمة: نوعُ البنيةِ وسطرُها — مفتاحٌ يتشاركه من في المنطقةِ نفسِها */
const opaque = (tag: string, n: ts.Node): string => {
  const sf = n.getSourceFile();
  return `region:${tag}@${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}:${n.getStart(sf)}`;
};

/** بندُ التبديلِ **مدخولٌ حتمًا**: المميّزُ معلومٌ ولا بندَ قبلَه يوافقه، وهو يوافقُه (أو `default` ولا بندَ يوافق) */
function clauseCertainlyEntered(cl: ts.CaseOrDefaultClause, deps: RegionDeps): boolean {
  const sw = cl.parent.parent;
  const d = deps.literalValue(sw.expression);
  if (d === null) return false;
  const values = cl.parent.clauses.map((c) => (ts.isCaseClause(c) ? deps.literalValue(c.expression) : 'default'));
  if (values.some((v) => v === null)) return false; // بندٌ مجهولُ القيمة — لا يُقطَعُ أيُّها يُدخَل
  const firstMatch = values.findIndex((v) => v !== 'default' && (v as { value: unknown }).value === d.value);
  const idx = cl.parent.clauses.indexOf(cl);
  if (firstMatch >= 0) return idx >= firstMatch && !cl.parent.clauses.slice(firstMatch, idx).some((c) => c.statements.some((s) => mayExit(s) || mustExit(s, deps)));
  const def = values.indexOf('default');
  return def >= 0 && idx >= def && !cl.parent.clauses.slice(def, idx).some((c) => c.statements.some((s) => mayExit(s) || mustExit(s, deps)));
}

/**
 * حكمُ المنطقةِ لأبٍ `p` واستعمالٍ `cur` داخلَه. `atom` ذرّةٌ معتمةٌ إن لم يكن `p` ممرًّا مُسمًّى؛
 * و`dead` إن سبقَ الاستعمالَ في كتلتِه بيانٌ يخرجُ حتمًا. **قائمةُ الممرّاتِ** (لا ذرّةَ لها):
 * التعابيرُ كلُّها إلا ما يُنمذَجُ حارسًا في `guardsOf` (الشرطيُّ والقاصرُ)، وبيانُ التعبير، والإعلان،
 * والوسم، والإرجاعُ، و`if` (حارسُه في `guardsOf`)، وشرطُ الحلقةِ ومُبدِّعُها، وجسمُ `while`/`for` المحروسِ
 * بشرطه في `guardsOf`، وجسمُ `do`، ومُكرَّرُ `for-of`/`for-in`، ومميّزُ التبديل، والكتلةُ، و`finally`،
 * وبندُ تبديلٍ مدخولٌ حتمًا. وما سواها — `catch` · كتلةُ `try` · بندُ تبديلٍ غيرُ مقطوعٍ بدخولِه · زيادةُ
 * حلقةِ `for` · جسمُ `for-of`/`for-in` — ذرّةٌ معتمة.
 */
export function regionOf(p: ts.Node, cur: ts.Node, deps: RegionDeps): { readonly atom: string | null; readonly dead: boolean } {
  const atoms: string[] = [];
  let dead = false;
  const statements = ts.isBlock(p) || ts.isSourceFile(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)
    ? p.statements : null;
  if (statements !== null) {
    for (const s of statements) {
      if (s.pos >= cur.pos) break;
      if (mustExit(s, deps)) dead = true;
      else if (mayExit(s)) atoms.push(opaque('exit', s));
    }
  }
  if (ts.isCatchClause(p)) atoms.push(opaque('catch', p));
  if (ts.isTryStatement(p) && cur === p.tryBlock) atoms.push(opaque('try', p));
  // تعبيرُ البندِ نفسُه يُقيَّمُ بشرطِ عدمِ موافقةِ ما قبلَه — فهو مشروطٌ كجسمِه
  if ((ts.isCaseClause(p) || ts.isDefaultClause(p)) && !clauseCertainlyEntered(p, deps)) atoms.push(opaque('clause', p));
  if (ts.isForStatement(p) && p.incrementor !== undefined && within(cur, p.incrementor)) atoms.push(opaque('for-step', p));
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.statement === cur) atoms.push(opaque('for-each', p));
  return { atom: atoms.length > 0 ? atoms.join('&') : null, dead };
}
