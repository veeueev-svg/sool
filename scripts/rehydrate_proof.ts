/**
 * scripts/rehydrate_proof.ts — أدواتُ البرهانِ النحويِّ لحاجزِ حصرِ الإرجاع (المرحلة 39 · W-2026-040)
 * المالك: وزارة البيانات
 * القاعدة الحاكمة RULE-000: أي تعديل هنا يُوثَّق في PROGRESS.md مع تقرير اختبار
 * المدخلات: مساراتُ ملفّاتِ `.ts` تُقرأ نصًّا وتُحلَّل شجرةَ نحو
 * المخرجات: مواضعُ توزيعٍ · مواضعُ إنتاجٍ · صفوفُ جدولِ الدعاوى · التعدادُ المغلق · مُعجمُ الإعفاء
 * التبعيات: مُترجمُ TypeScript فقط — لا `grep` على الشفرة ولا استيرادَ للحزمةِ المبنيّة
 * الصلاحيات (RULE-004): تقرأ وتُقيس؛ لا تُصلح ملفًّا ولا تكتب واحدًا
 * السجلات: لا تكتب شيئًا — الحكمُ لمن يستدعيها
 * حالات الفشل: لا ترمي حكمًا؛ غيابُ موضعِ توزيعٍ يعود قائمةً فارغةً ليحكم بها الحاجز
 * اختبار القبول: tests/data/rehydrate_census.test.ts
 * الوثيقة المرتبطة: docs/decisions/ADR-0048-rehydrate-census.md
 *
 * **لِمَ فُصلت عن الحاجز**: البرهانُ النحويُّ منطقٌ يُختبر وحدَه، والحاجزُ حكمٌ يُرتّبه. وجمعُهما
 * في ملفٍّ واحدٍ تجاوز سقفَ الوحدةِ المُعلَن (400 سطرًا) — والسقفُ لا يُرفع لأنّ ملفًّا كبُر.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { resolveVariable } from './rehydrate_reachability';

/** موضعُ توزيعٍ مقيس: سطرُه وشكلُه */
export type Site = { readonly line: number; readonly form: string };

/** يفتح ملفًّا ويُحلّله شجرةَ نحو — لا `grep`، فالتعليقاتُ ليست عُقَدًا فلا تُرى */
export function parseFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true);
}

export function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((c) => walk(c, visit));
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** كلُّ سلاسلِ النصِّ في الملفِّ التي متنُها الصنفُ المطلوب — عُقَدٌ لا مطابقاتُ نصّ */
export function literalsOf(sf: ts.SourceFile, kind: string): ts.StringLiteralLike[] {
  const out: ts.StringLiteralLike[] = [];
  walk(sf, (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === kind) {
      out.push(n);
    }
  });
  return out;
}

/** يقشر `as const` والأقواسَ عن عقدةٍ لتُقرأ سلسلتُها إن كانت سلسلة */
export function unwrap(node: ts.Node): ts.Node {
  let cur = node;
  while (ts.isAsExpression(cur) || ts.isParenthesizedExpression(cur)
    || ts.isSatisfiesExpression(cur) || ts.isNonNullExpression(cur)) cur = cur.expression;
  return cur;
}

/**
 * مواضعُ **بناءِ** قيدٍ لهذا الصنف: خاصّيّةُ `kind` في كائنٍ حرفيٍّ قيمتُها الصنف. وهي عقدةٌ
 * في الشجرة لا سطرُ نصّ، فلا يُنتجها تعليقٌ — ويُقشَر عنها `as const`.
 */
export function constructionSites(sf: ts.SourceFile, kind: string): Site[] {
  const out: Site[] = [];
  walk(sf, (n) => {
    if (!ts.isPropertyAssignment(n)) return;
    const nm = n.name;
    if (!(ts.isIdentifier(nm) || ts.isStringLiteral(nm)) || nm.text !== 'kind') return;
    const v = unwrap(n.initializer);
    if ((ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) && v.text === kind) {
      out.push({ line: lineOf(sf, n), form: 'construct' });
    }
  });
  return out;
}

/**
 * مواضعُ تمريرِ الصنفِ **وسيطًا لنداء** — استعمالٌ يقرأ الصنفَ (مثل `covers('kind')`).
 * أضعفُ من التوزيع فلا يُقبل برهانَ استهلاك، ويُقبل شاهدًا على استعمالٍ لا على منطق.
 */
export function argumentSites(sf: ts.SourceFile, kind: string): Site[] {
  const out: Site[] = [];
  for (const lit of literalsOf(sf, kind)) {
    const p = lit.parent;
    if (p !== undefined && ts.isCallExpression(p) && p.arguments.some((a) => a === lit)) {
      out.push({ line: lineOf(sf, lit), form: 'argument' });
    }
  }
  return out;
}

/** كلُّ ملفّات `src/**` بلاحقة `.ts` */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * اسمُ خاصّيّةِ عنصرِ كائنٍ حرفيّ: معرّفٌ أو حرفٌ أو **مفتاحٌ محسوبٌ بحرفٍ** (الجولةُ
 * السادسة: `['kind']: 'x'` — حرفٌ في قوسٍ لا يُرى فكُانت خاصّيّةً خفيّة).
 */
function propertyNameOf(prop: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) return null;
  const nm = prop.name;
  if (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) return nm.text;
  if (ts.isComputedPropertyName(nm)) {
    const k = unwrap(nm.expression);
    if (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)) return k.text;
  }
  return null;
}

/**
 * قيمةُ خاصّيّةٍ بالاسمِ في كائنٍ حرفيّ: **آخرُ مطابقةٍ تفوزُ** (ترتيبُ الاستبدالِ
 * معتبرٌ)، والنشرُ `…{ kind }` يسهمُ بخصائصِ كائنِه في موضعِه (الجولةُ السادسة).
 */
function propertyInitializerOf(
  sf: ts.SourceFile, obj: ts.ObjectLiteralExpression, name: string,
  visited: ReadonlySet<ts.VariableDeclaration>,
): ts.Expression | null {
  let found: ts.Expression | null = null;
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      const spreadObj = resolveToObject(sf, prop.expression, visited);
      if (spreadObj !== null) {
        const inner = propertyInitializerOf(sf, spreadObj, name, visited);
        if (inner !== null) found = inner;
      }
      continue;
    }
    const nm = propertyNameOf(prop);
    if (nm !== name) continue;
    if (ts.isPropertyAssignment(prop)) found = prop.initializer;
    else if (ts.isShorthandPropertyAssignment(prop)) found = prop.name;
  }
  return found;
}

/** يحلُّ تعبيرًا إلى **كائنٍ حرفيّ**: مُعرّفٌ إلى تعريفِه، ووصولُ خاصّيّةٍ إلى
 * خاصّيّتِه في كائنِه (بأيّ عمقٍ — `row.meta` كائنٌ داخلَ كائنٍ)، وفهرسًا بحرفٍ إلى
 * كذاك. وكلُّ حلٍّ يمرّ بمجموعةِ التعاريفِ المزارةِ فلا دورانَ. */
function resolveToObject(
  sf: ts.SourceFile, expr: ts.Node, visited: ReadonlySet<ts.VariableDeclaration>,
): ts.ObjectLiteralExpression | null {
  const e = unwrap(expr);
  if (ts.isObjectLiteralExpression(e)) return e;
  if (ts.isIdentifier(e)) {
    const d = resolveVariable(sf, e);
    if (d === null || d.initializer === undefined || visited.has(d)) return null;
    return resolveToObject(sf, d.initializer, new Set(visited).add(d));
  }
  if (ts.isPropertyAccessExpression(e)) {
    const obj = resolveToObject(sf, e.expression, visited);
    if (obj === null) return null;
    const init = propertyInitializerOf(sf, obj, e.name.text, visited);
    return init === null ? null : resolveToObject(sf, init, visited);
  }
  if (ts.isElementAccessExpression(e)) {
    const arg = unwrap(e.argumentExpression);
    if (!(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return null;
    const obj = resolveToObject(sf, e.expression, visited);
    if (obj === null) return null;
    const init = propertyInitializerOf(sf, obj, arg.text, visited);
    return init === null ? null : resolveToObject(sf, init, visited);
  }
  return null;
}

/**
 * كتاباتُ مُعرّفٍ **المربوطةِ بتعريفِه**: الابتداءُ أولُ كتابةٍ، وكلُّ `name = value`
 * يُربطُ يسارُه بالتعريفِ نفسِه (لا بالاسمِ — فالمظلّلُ غيرُه) كتابةٌ بعده. آخِرُ
 * كتابةٍ قبلَ الاستعمالِ هي قيمتُه هناك؛ وإن كانت في فرعٍ (شرطٍ أو حلقةٍ أو try)
 * فالقيمةُ غيرُ محسومةٍ لا تُدّعى. (الجولةُ السادسة: `let kind; kind = 'x';` كان
 * لا يُرى لأنّ الحلَّ تابعَ الابتداءَ وحده.)
 */
function writesOf(
  sf: ts.SourceFile, usage: ts.Identifier, decl: ts.VariableDeclaration,
): ReadonlyArray<{ at: number; value: ts.Expression; node: ts.Node | null }> {
  const writes: Array<{ at: number; value: ts.Expression; node: ts.Node | null }> = [];
  if (decl.initializer !== undefined) writes.push({ at: decl.pos, value: decl.initializer, node: null });
  walk(sf, (n) => {
    if (!ts.isBinaryExpression(n) || n.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    if (!ts.isIdentifier(n.left) || n.left.text !== usage.text) return;
    if (resolveVariable(sf, n.left) !== decl) return;
    writes.push({ at: n.pos, value: n.right, node: n });
  });
  return writes;
}

/** كتابةٌ داخلَ بنيةِ تفريعٍ (شرطٍ · حلقةٍ · try · switch)؟ فقيمتُها غيرُ محسومةٍ هناك */
function writeIsBranched(node: ts.Node): boolean {
  for (let cur: ts.Node | undefined = node.parent; cur !== undefined; cur = cur.parent) {
    if (ts.isIfStatement(cur) || ts.isConditionalExpression(cur) || ts.isSwitchStatement(cur)
      || ts.isTryStatement(cur) || ts.isWhileStatement(cur) || ts.isForStatement(cur)
      || ts.isDoStatement(cur) || ts.isForOfStatement(cur) || ts.isForInStatement(cur)) return true;
  }
  return false;
}

/**
 * محلِّلُ قيمةٍ واحدٌ للمُنتِج: يفكُّ الأغلفةَ (`as const` · الأقواس · `satisfies` ·
 * `!`)، ويتبعُ سلسلةَ المُعرّفِ إلى تعريفِه في نطاقِه (`resolveVariable`) بلا سقفِ
 * مستوياتَ اعتباطيّ — فالمراجعُ رفضَ الحلَّ ذا المستوى الواحدِ لأنّ العقدَ لا يستثني
 * المستوى الثاني، ونقلُ البابِ إلى سقفٍ خامسٍ يعيدُ العيبَ نفسَه بعينِه. والوقايةُ من
 * الدورانِ (`const a = b; const b = a;`) تتبّعُ التعاريفِ المزارةِ لا عدّادٍ يُستنفد.
 * ويقرأُ وصولَ الخاصّيّةِ (`row.kind`) و**الفهرسَ بالحرفِ** (`row['kind']`) وخصائصَ
 * الكائنِ المتداخلةَ (`row.meta.kind`) والمفتاحَ المحسوبَ والنشرَ، واختصارُ الكائنِ
 * (`{ kind }`) سكرٌ نحويٌّ لذاتِ القراءةِ.
 *
 * **والجولةُ السادسة**: الكتابةُ اللاحقةُ للإعلانِ (`let kind; kind = 'x'; j.record(kind)`)
 * تُربطُ بالتعريفِ نفسِه وتُتبعُ — آخِرُ كتابةٍ قبلَ الاستعمالِ هي القيمةُ، وما كان في
 * فرعٍ فغيرُ محسومٍ لا يُدّعى.
 *
 * **تسميةُ عيوبِ الجولةِ الخامسةِ التي أوجبت هذا المحلِّل** (`docs/work/council/`
 * `W-2026-040-1-grok.md` §6): `RC04_AS_CAST_ALIAS_UNSEEN` (القشرةُ لا تُفكُّ `as`) ·
 * `RC04_ALIAS_CHAIN_UNSEEN` (المستوى الثاني) · `RC04_PROPERTY_ACCESS_PRODUCER_UNSEEN`
 * (`row.kind`) · `RC04_OBJECT_ARG_ALIAS_UNSEEN` (`record({ kind })`).
 */
const enclosingFn = (n: ts.Node): ts.Node | undefined => ts.findAncestor(n.parent, ts.isFunctionLike);
// **الجولةُ السابعة** (`LOCAL_ASSIGNMENT_LIMIT_MISSTATED` · `…_FAILS_OPEN`): «آخِرُ كتابةٍ» موضعيّةٌ في دالّةِ
// الاستعمالِ كما يُعلَن؛ وكتابةٌ للصنفِ في دالّةٍ أخرى تُرفَعُ في `foreign` («لا يُبرهَن» RC-14 لا «له منتِج»).
function resolvesToKind(
  sf: ts.SourceFile, node: ts.Node, kind: string, visited: ReadonlySet<ts.VariableDeclaration>,
  foreign?: { hit: boolean },
): boolean {
  const e = unwrap(node);
  if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text === kind) {
    return true;
  }
  if (ts.isIdentifier(e)) {
    const d = resolveVariable(sf, e);
    if (d === null || visited.has(d)) return false;
    // آخِرُ كتابةٍ قبلَ الاستعمالِ — ابتداءً أو إسنادًا لاحقًا مربوطًا بالتعريفِ نفسِه
    const fnU = enclosingFn(e);
    const all = writesOf(sf, e, d);
    const seen = new Set(visited).add(d);
    for (const w of all) {
      if (w.node !== null && enclosingFn(w.node) !== fnU && foreign !== undefined
        && resolvesToKind(sf, w.value, kind, seen, foreign)) foreign.hit = true;
    }
    const writes = all.filter((w) => (w.node === null || enclosingFn(w.node) === fnU) && w.at < e.pos);
    let last: { at: number; value: ts.Expression; node: ts.Node | null } | null = null;
    for (const w of writes) if (last === null || w.at > last.at) last = w;
    if (last === null) return false;
    if (last.node !== null && writeIsBranched(last.node)) return false;
    return resolvesToKind(sf, last.value, kind, seen, foreign);
  }
  if (ts.isPropertyAccessExpression(e)) {
    const obj = resolveToObject(sf, e.expression, visited);
    if (obj === null) return false;
    const init = propertyInitializerOf(sf, obj, e.name.text, visited);
    return init !== null && resolvesToKind(sf, init, kind, visited);
  }
  // **الجولةُ السادسة**: الفهرسُ بالحرفِ قراءةٌ ثانيةٌ لذاتِ الخاصّيّةِ — `row['kind']`
  if (ts.isElementAccessExpression(e)) {
    const arg = unwrap(e.argumentExpression);
    if (!(ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) return false;
    const obj = resolveToObject(sf, e.expression, visited);
    if (obj === null) return false;
    const init = propertyInitializerOf(sf, obj, arg.text, visited);
    return init !== null && resolvesToKind(sf, init, kind, visited);
  }
  return false;
}

/**
 * مُنتِجو الصنف: نداءُ `x.record('kind', …)` **عقدةَ نداءٍ** لا نصًّا، ومعه شكلُ
 * `record({ kind: 'kind', … })` — فالتعليقُ لا يُعَدُّ مُنتِجًا، والاقتباسُ المزدوجُ يُرى
 * كالمفرد لأنّ المقارنةَ على متنِ العقدةِ لا على بايتِ السطر.
 * **وامتدادُ الجولةِ الرابعة** `RC04_PRODUCER_ALIAS_UNSEEN`: كان المنتِجُ يُقبل الصنفَ حرفًا مباشرًا فقط، فنُزِع
 * المنتِجُ الحقيقيُّ وأُبقي مُعرَّفًا يحمل الصنفَ ثمّ يمرِّطُ المُعرَّفَ — ومُدَّ الحدُّ القديمُ إعلانُه عند رفضِ الجولةِ. فصار المُعرَّفُ يُحَلُّ
 * إلى تعريفِه في نطاقِه (`resolveVariable`) — فأن كان ابتداؤُه حرفًا يوافقُ الصنفَ فهو منتِجٌ قائمٌ بالموجبِ.
 * **وامتدادُ الجولةِ الخامسة**: صار الحلُّ محلِّلًا واحدًا بلا سقفِ مستوياتَ (`resolvesToKind`)
 * يفكُّ الأغلفةَ ويتبعُ السلاسلَ ويقرأُ وصولَ الخاصّيّةِ واختصارَ الكائنِ — فالإعفاءُ
 * «لا مُنتِجَ له» لا يبقى قائمَ الموجبِ ما دام للصنفِ مُنتِجٌ في `src/**` بأيِّ صيغةٍ من هذه.
 */
export function producerSites(
  root: string, files: readonly string[], kind: string, possible: string[] = [],
): string[] {
  const out: string[] = [];
  for (const file of files) {
    const sf = parseFile(file);
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      // **الجولةُ السادسة**: الفهرسُ بالحرفِ — `j['record'](...)` و`j?.['record'](...)`
      // نداءٌ لذاتِ المسمّى (وجهُ `isLogCall` مع `console['log']` من الجولةِ الرابعة).
      const bracketArg = ts.isElementAccessExpression(callee) ? unwrap(callee.argumentExpression) : null;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isIdentifier(callee) ? callee.text
          : (bracketArg !== null
            && (ts.isStringLiteral(bracketArg) || ts.isNoSubstitutionTemplateLiteral(bracketArg))
            ? bracketArg.text : '');
      if (name !== 'record') return;
      const first = n.arguments[0];
      // **الجولةُ الخامسة**: المحلِّلُ الواحدُ — حرفٌ مباشرٌ، أو مُعرَّفٌ (وسلسلتُه
      // وأغلفتُه)، أو وصولُ خاصّيّةٍ `row.kind` — كلُّها مُنتِجٌ قائمٌ بالموجبِ.
      const foreign = { hit: false };
      if (first !== undefined && resolvesToKind(sf, first, kind, new Set(), foreign)) {
        out.push(`${relative(root, file)}:${lineOf(sf, n)}`);
        return;
      }
      if (foreign.hit) possible.push(`${relative(root, file)}:${lineOf(sf, n)} (كتابةٌ للصنفِ في دالّةٍ أخرى)`);
      for (const arg of n.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          // **الجولةُ الخامسة** `RC04_OBJECT_ARG_ALIAS_UNSEEN`: اختصارُ الخاصّيّةِ
          // `record({ kind })` سكرٌ نحويٌّ لذاتِ القراءةِ — يُحَلُّ المُعرَّفُ لا يُشترطُ الحرفُ.
          if (ts.isShorthandPropertyAssignment(prop)) {
            if (prop.name.text === 'kind' && resolvesToKind(sf, prop.name, kind, new Set())) {
              out.push(`${relative(root, file)}:${lineOf(sf, n)}`);
            }
            continue;
          }
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = prop.name;
          const keyText = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : '';
          if (keyText === 'kind' && resolvesToKind(sf, prop.initializer, kind, new Set())) {
            out.push(`${relative(root, file)}:${lineOf(sf, n)}`);
          }
        }
      }
    });
  }
  return [...new Set(out)].sort();
}

/** صفوفُ جدولِ الدعاوى تُستخرج من شجرةِ النحو لا بنمطٍ نصّيّ */
/** صفُّ دعوى كما يُقرأ من الشجرة — لا من نمطٍ نصّيّ */
export type Claim = {
  readonly kind: string; readonly consumer: string | null;
  readonly exemption: string | null; readonly line: number;
};

export function readClaims(sf: ts.SourceFile): Claim[] {
  const out: Claim[] = [];
  walk(sf, (n) => {
    if (!ts.isVariableDeclaration(n)) return;
    if (!ts.isIdentifier(n.name) || n.name.text !== 'REHYDRATE_CLAIMS') return;
    walk(n, (m) => {
      if (!ts.isObjectLiteralExpression(m)) return;
      const get = (key: string): string | null | undefined => {
        for (const prop of m.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const nm = prop.name;
          if (!(ts.isIdentifier(nm) || ts.isStringLiteral(nm)) || nm.text !== key) continue;
          const v = prop.initializer;
          if (v.kind === ts.SyntaxKind.NullKeyword) return null;
          if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) return v.text;
          return undefined;
        }
        return undefined;
      };
      const kind = get('kind');
      if (typeof kind !== 'string') return;
      out.push({
        kind,
        consumer: get('consumer') ?? null,
        exemption: get('exemption') ?? null,
        line: lineOf(sf, m),
      });
    });
  });
  return out;
}

/**
 * أعضاءُ مصفوفةِ سلاسلَ مُسمَّاةٍ كما تُقرأ من الشجرة — لا بنمطٍ نصّيٍّ ولا بالاستيراد.
 * ويُقشَر `Object.freeze([…])` و`as const` لأنّ `walk` ينزل إلى كلِّ مصفوفةٍ داخلَ التصريح.
 */
export function readStringArray(sf: ts.SourceFile, name: string): string[] {
  const out: string[] = [];
  walk(sf, (n) => {
    if (!ts.isVariableDeclaration(n)) return;
    if (!ts.isIdentifier(n.name) || n.name.text !== name) return;
    walk(n, (m) => {
      if (ts.isArrayLiteralExpression(m)) {
        for (const e of m.elements) if (ts.isStringLiteral(e)) out.push(e.text);
      }
    });
  });
  return out;
}

/** التعدادُ المغلقُ يُقرأ من مصفوفةِ `DURABLE_KINDS` في الشجرة */
export function readDeclared(sf: ts.SourceFile): string[] {
  return [...new Set(readStringArray(sf, 'DURABLE_KINDS'))];
}

/** مُعجمُ أسبابِ الإعفاءِ المغلقُ يُقرأ من الشجرةِ كذلك — لا يُكتب هنا ثانيًا */
export function readReasons(sf: ts.SourceFile): string[] {
  return readStringArray(sf, 'REHYDRATE_EXEMPTION_REASONS');
}
