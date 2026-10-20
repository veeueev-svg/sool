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
 * محلِّلُ قيمةٍ واحدٌ للمُنتِج: يفكُّ الأغلفةَ (`as const` · الأقواس · `satisfies` ·
 * `!`)، ويتبعُ سلسلةَ المُعرّفِ إلى تعريفِه في نطاقِه (`resolveVariable`) بلا سقفِ
 * مستوياتَ اعتباطيّ — فالمراجعُ رفضَ الحلَّ ذا المستوى الواحدِ لأنّ العقدَ لا يستثني
 * المستوى الثاني، ونقلُ البابِ إلى سقفٍ خامسٍ يعيدُ العيبَ نفسَه بعينِه. والوقايةُ من
 * الدورانِ (`const a = b; const b = a;`) تتبّعُ التعاريفِ المزارةِ لا عدّادٍ يُستنفد.
 * ويقرأُ وصولَ الخاصّيّةِ (`row.kind`): يُحَلُّ الجذرُ إلى تعريفِه فإن كان كائنًا
 * حرفيًّا قُرئت خاصّيّةٌ تحملُ اسمَ الوصولِ — واختصارُ الكائنِ (`{ kind }`) سكرٌ نحويّ
 * لذاتِ القراءةِ.
 *
 * **تسميةُ عيوبِ الجولةِ الخامسةِ التي أوجبت هذا المحلِّل** (`docs/work/council/`
 * `W-2026-040-1-grok.md` §6): `RC04_AS_CAST_ALIAS_UNSEEN` (القشرةُ لا تُفكُّ `as`) ·
 * `RC04_ALIAS_CHAIN_UNSEEN` (المستوى الثاني) · `RC04_PROPERTY_ACCESS_PRODUCER_UNSEEN`
 * (`row.kind`) · `RC04_OBJECT_ARG_ALIAS_UNSEEN` (`record({ kind })`).
 */
function resolvesToKind(
  sf: ts.SourceFile, node: ts.Node, kind: string, visited: ReadonlySet<ts.VariableDeclaration>,
): boolean {
  const e = unwrap(node);
  if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && e.text === kind) {
    return true;
  }
  if (ts.isIdentifier(e)) {
    const d = resolveVariable(sf, e);
    if (d === null || d.initializer === undefined || visited.has(d)) return false;
    return resolvesToKind(sf, d.initializer, kind, new Set(visited).add(d));
  }
  if (ts.isPropertyAccessExpression(e)) {
    const base = unwrap(e.expression);
    if (!ts.isIdentifier(base)) return false;
    const d = resolveVariable(sf, base);
    if (d === null || d.initializer === undefined || visited.has(d)) return false;
    const init = unwrap(d.initializer);
    if (!ts.isObjectLiteralExpression(init)) return false;
    for (const prop of init.properties) {
      const nm = ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)
        ? prop.name : null;
      if (nm === null || !(ts.isIdentifier(nm) || ts.isStringLiteral(nm)) || nm.text !== e.name.text) {
        continue;
      }
      if (ts.isPropertyAssignment(prop)) {
        return resolvesToKind(sf, prop.initializer, kind, new Set(visited).add(d));
      }
      if (ts.isShorthandPropertyAssignment(prop)) {
        return resolvesToKind(sf, prop.name, kind, new Set(visited).add(d));
      }
      continue;
    }
    return false;
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
export function producerSites(root: string, files: readonly string[], kind: string): string[] {
  const out: string[] = [];
  for (const file of files) {
    const sf = parseFile(file);
    walk(sf, (n) => {
      if (!ts.isCallExpression(n)) return;
      const callee = n.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : (ts.isIdentifier(callee) ? callee.text : '');
      if (name !== 'record') return;
      const first = n.arguments[0];
      // **الجولةُ الخامسة**: المحلِّلُ الواحدُ — حرفٌ مباشرٌ، أو مُعرَّفٌ (وسلسلتُه
      // وأغلفتُه)، أو وصولُ خاصّيّةٍ `row.kind` — كلُّها مُنتِجٌ قائمٌ بالموجبِ.
      if (first !== undefined && resolvesToKind(sf, first, kind, new Set())) {
        out.push(`${relative(root, file)}:${lineOf(sf, n)}`);
        return;
      }
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
