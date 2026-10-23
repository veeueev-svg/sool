/**
 * scripts/rehydrate_barrier_binding.ts — **هويّةُ الحاجزِ رمزٌ محلولٌ لا نصُّ اسمٍ ولا لاحقةُ مسارٍ**
 * (المرحلة 39 · W-2026-040 · الجولةُ الحاديةَ عشرةَ — علاجُ عيوبِ الجولةِ السابعةِ 4.1/4.2/4.3)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 *
 * **السندُ (محضرُ الجولةِ السابعةِ):** هويةُ نداءِ الحاجزِ كانت تُقاسُ بنصِّ المعرّفِ
 * `assertRehydrateCensus` **وبلاحقةِ نصٍّ** `/data\/rehydrate_census$/` على محدِّدِ الاستيرادِ —
 * فخضَرَت كنيّةُ مصدَّرٍ لا يرمي (`notBarrier as assertRehydrateCensus` · عيبُ
 * `RC07_ALIASED_EXPORT_CHOKEPOINT_GREENS`) وخضَرَت وحدةٌ مزيفةٌ بلاحقةٍ مطابقةٍ
 * (`src/vendor/data/rehydrate_census.ts` · عيبُ `RC07_SPECIFIER_SUFFIX_NOT_RESOLVED_MODULE`)
 * ورُفضَ الاستيرادُ الحقيقيُّ المُسمّى باسمٍ أوضحَ (`as checkCensus` · عيبُ
 * `RC07_RENAME_OF_REAL_EXPORT_FALSE_REJECT`) ورُفضَ وصولُ النطاقِ `census.assertRehydrateCensus`.
 *
 * **العلاجُ — الآليةُ:** الحلُّ النهائيُّ للرمزِ عبرَ مدقّقِ الأنواعِ (يذوبُ فيه الاستيرادُ
 * المُسمّى والنطاقيُّ وكنيةُ التصديرِ والعبورُ بينَ الوحداتِ) ثمّ المطابقةُ **بعقدةِ التعريفِ
 * نفسِها**: فلا يُعَدُّ نداءُ حاجزٍ إلا ما حلَّ رمزُ مستدعاهُ إلى تعريفٍ في وحدةِ الحصرِ
 * (`src/data/rehydrate_census.ts`) **اسمُهُ الذاتيُّ هو اسمُ الحاجزِ** — فالكنيةُ تسقطُ باختلافِ
 * الاسمِ الذاتيِّ، والوحدةُ المزيفةُ تسقطُ بملكيّةِ الملفِّ، والتسميةُ الواضحةُ والنطاقُ
 * يخضرّانِ لأنّهما يصلانِ إلى التعريفِ نفسِهِ. ومعَ ذلك شاهدُ رميٍّ بنيويٌّ: حاجزٌ لا يملكُ
 * جسمُهُ رميًا ليس حاجزًا (والسلوكُ يشهدُ لهُ اختبارُ الوحدةِ بالحقنِ — الحقنُ شرطُ البرهانِ).
 */
import ts from "typescript";

/** فكُّ الأغلفةِ المسموحِ بها حولَ المُستدعى (أقواسٌ · `as` · `!` · فاصلةٌ يُؤخذُ يمينُها) */
export function unwrapCallee(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken) cur = cur.right;
    else return cur;
  }
}

/** شريعةُ الحاجزِ: رمزُ مدقّقِ الأنواعِ وتعريفاتُ الحواجزِ القانونيّةُ في وحدةِ الحصرِ */
export interface BarrierLaw {
  readonly checker: ts.TypeChecker;
  readonly censusFileName: string;
  /** الاسمُ الذاتيُّ للتعريفِ ⇒ تعريفاتُهُ القانونيّةُ (عقدةُ تعريفٍ في وحدةِ الحصرِ) */
  readonly lawful: ReadonlyMap<string, ReadonlySet<ts.Declaration>>;
}

/**
 * تُبنى من وحدةِ الحصرِ نفسِها: كلُّ تعريفٍ (دالّةٍ أو ربطِ متغيّرٍ أو صنفٍ) **اسمُهُ الذاتيُّ**
 * هو أحدَ أسماءِ الحواجزِ هو تعريفٌ قانونيٌّ. والتصديرُ بالكنيةِ (`export { X as name }`) لا يُنشئُ
 * تعريفًا قانونيًّا للاسمِ — الكنيةُ تُحَلُّ إلى تعريفِ X الذاتيِّ فتسقطُ بالمطابقةِ.
 */
export function barrierLaw(program: ts.Program, censusPath: string, names: readonly string[]): BarrierLaw | null {
  const censusSf = program.getSourceFile(censusPath);
  if (censusSf === undefined) return null;
  const lawful = new Map<string, Set<ts.Declaration>>();
  const want = new Set(names);
  const visit = (n: ts.Node): void => {
    const named = n as ts.Node & { name?: ts.Node };
    if ((ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n) || ts.isClassDeclaration(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && named.name !== undefined && ts.isIdentifier(named.name) && want.has(named.name.text)) {
      const set = lawful.get(named.name.text) ?? new Set<ts.Declaration>();
      set.add(n);
      lawful.set(named.name.text, set);
    }
    ts.forEachChild(n, visit);
  };
  visit(censusSf);
  return {
    checker: program.getTypeChecker(),
    censusFileName: censusSf.fileName,
    lawful,
  };
}

/** الحلُّ النهائيُّ للرمزِ: يذوبُ الاستيرادُ المُسمّى والنطاقيُّ وكنيةُ التصديرِ والعبورُ بينَ الوحداتِ — وتعذّرُ الحلِّ يُرجِعُ مجهولًا لا يُرمى */
export function resolvedSymbol(checker: ts.TypeChecker, e: ts.Expression): ts.Symbol | undefined {
  const cur = unwrapCallee(e);
  if (!ts.isIdentifier(cur) && !ts.isPropertyAccessExpression(cur) && !ts.isElementAccessExpression(cur)) {
    return undefined;
  }
  let s = checker.getSymbolAtLocation(cur);
  for (let i = 0; i < 8 && s !== undefined && (s.flags & ts.SymbolFlags.Alias) !== 0; i += 1) {
    try {
      s = checker.getAliasedSymbol(s);
    } catch {
      return undefined;
    }
  }
  return s;
}

/** تعريفُ الرمزِ النهائيِّ الذي يشهدُ بالهويّةِ (لا اسمُهُ النصّيُّ وحدَه) */
function declarationOf(sym: ts.Symbol | undefined): ts.Declaration | undefined {
  return sym?.valueDeclaration ?? sym?.getDeclarations()?.[0];
}

/** هل النداءُ حاجزٌ قانونيٌّ بالاسمِ المسماة؟ — المطابقةُ بعقدةِ التعريفِ لا بالنصِّ */
export function isLawfulBarrierCall(call: ts.CallExpression, law: BarrierLaw, name: string): boolean {
  const decl = declarationOf(resolvedSymbol(law.checker, call.expression));
  return decl !== undefined && (law.lawful.get(name) ?? new Set<ts.Declaration>()).has(decl);
}

/** اسمُ الرمزِ النهائيِّ الذي حلَّ إليهِ التعبيرُ — لتمييزِ المزوَّرِ بالاسمِ نفسِهِ */
export function resolvedTargetName(checker: ts.TypeChecker, e: ts.Expression): string | undefined {
  return resolvedSymbol(checker, e)?.getName();
}

/** شاهدُ الرميِّ البنيويُّ: هل في جسمِ هذا التعريفِ رميٌّ؟ حاجزٌ لا يملكُ رميًا ليس حاجزًا */
export function bodyThrows(decl: ts.Declaration): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isThrowStatement(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  ts.forEachChild(decl, visit);
  return found;
}

/**
 * موضعُ الاختناقِ في `src/data/persistence.ts`: دالّةٌ مسمّاةٌ (أو دالّةُ عضوٍ في صنفٍ مسمّى) —
 * يُطلَبُ منها احتواءُ نداءِ الحاجزِ القانونيِّ: `StateJournal.read` يحرسُ قبلَ أوّلِ إعادةِ
 * قيدٍ (`assertRehydrateCensus` و`assertExemptionsHold`)، و`rehydrateFromJournal` يُكذِّبُ الإعفاءَ
 * عندَ القراءةِ (`assertExemptionsHold`). وجودُ النداءِ في أيِّ موضعٍ آخرَ من الملفِّ لا يثبتُ
 * حراسةَ نقطةِ الاختناقِ.
 */
export function functionBodyOf(sf: ts.SourceFile, owner: string | null, fnName: string): ts.Node | null {
  let body: ts.Node | null = null;
  const visit = (n: ts.Node): void => {
    if (body !== null) return;
    if (ts.isMethodDeclaration(n) && n.name.getText(sf) === fnName && (owner === null || (ts.isClassDeclaration(n.parent) && n.parent.name?.getText(sf) === owner))) {
      body = n.body ?? null;
      return;
    }
    if (ts.isFunctionDeclaration(n) && n.name?.getText(sf) === fnName && owner === null) {
      body = n.body ?? null;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return body;
}

/** هل تحرسُ دالّةُ الاختناقِ نداءَ الحاجزِ القانونيّ؟ `null` إن غابت الدالّةُ أصلًا */
export function chokepointGuarded(sf: ts.SourceFile, law: BarrierLaw, owner: string | null, fn: string, barrier: string): boolean | null {
  const body = functionBodyOf(sf, owner, fn);
  if (body === null) return null;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && isLawfulBarrierCall(n, law, barrier)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

/** هل عقدةٌ داخلَ جسمِ دالّةٍ (أو عضوِ صنفٍ) بعقدةِ الجسمِ المعطاةِ؟ */
export function withinBody(n: ts.Node, body: ts.Node): boolean {
  return n.pos >= body.pos && n.end <= body.end;
}

/** النداءُ الذي يقفُ هذا الاسمُ في موضعِ مستدعاه (بعدَ فكِّ الأغلفةِ وصعودِ الوصولِ) — أو `null` */
export function calleeOf(n: ts.Node): ts.CallExpression | null {
  let cur: ts.Node = n;
  for (let depth = 0; depth < 12; depth += 1) {
    const p = cur.parent;
    if (p === undefined) return null;
    if (ts.isPropertyAccessExpression(p) && p.name === cur) {
      cur = p;
      continue;
    }
    if (ts.isElementAccessExpression(p) && p.argumentExpression === cur) {
      cur = p;
      continue;
    }
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p) || ts.isSatisfiesExpression(p) || ts.isTypeAssertionExpression(p)) {
      cur = p;
      continue;
    }
    return ts.isCallExpression(p) && p.expression === cur ? p : null;
  }
  return null;
}
