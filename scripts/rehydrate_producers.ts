/**
 * نفيُ المُنتِجِ بمدقّقِ الأنواع — W-2026-040 (معالجةُ مجلسِ المراجعةِ الثالثة · الجلسة 153 · §2-ط).
 *
 * **العيوبُ التي تُعالَجُ من جذرِها:** `COMPUTED_PRODUCER_BYPASSES_DECLARED_WITHOUT_PRODUCER`
 * (أجمعَ عليه الثلاثة) · `PRODUCER_ABSENCE_PROOF_IS_CLOSED_SYNTAX` · `LOCAL_ASSIGNMENT_LIMIT_FAILS_OPEN`
 * · `LOCAL_ASSIGNMENT_LIMIT_MISSTATED` (grok). كان نفيُ المنتِجِ (`producerSites`) يُثبتُ المنتِجَ
 * بصيغٍ مسمّاةٍ ثمّ يَعُدُّ ما لم يُثبَت **غيابًا** — فكلُّ صيغةٍ لم تُسمَّ (`['archive_snapshot'][0]!`
 * · `.call` · `.bind` · ثابتٌ مستورَد · قالب · عائدُ دالّة · كتابةٌ في دالّةٍ أخرى) تُخضِرُ الإعفاء.
 * وسياسةُ «المجهولُ قابلٌ للصدق» صحيحةٌ لإثباتِ المستهلك وخاطئةٌ لنفيِ المنتِج.
 *
 * **العلاجُ — القلبُ:** المجهولُ **لا يؤيّدُ** الإعفاء. ولا يُقرأُ الشكلُ؛ يُسألُ المترجم:
 * 1) نداءٌ مُستدعاه `X.record`/`X['record']` (بعدَ فكِّ الأغلفة) ومُستقبِلُه يمكنُ أن يكونَ يوميّةً
 *    — نوعُه `any`، أو `StateJournal`/`DurableSink` قابلٌ للإسنادِ إليه (`isTypeAssignableTo`) —
 *    هو نداءُ إنتاج. وصنفُه **نوعُ وسيطِه الأوّلِ** كما يراه المترجمُ (لا شكلُه): اتّحادٌ من حروفٍ
 *    نصّيّةٍ يُعرَفُ أعضاؤه؛ وما سواه (`string` · `any` · نشرٌ) مجهولٌ. والمتغيّرُ القابلُ للكتابةِ
 *    (`let`/`var`/وسيط) وخاصّيّةُ الكائنِ يُقرأُ **نوعُهما المُعلَن** لا المُضيَّقُ بالتدفّق — لأنّ
 *    كتابةً في دالّةٍ أخرى لا يراها التضييقُ (وهذا وجهُ `LOCAL_ASSIGNMENT_LIMIT_FAILS_OPEN` بعينِه).
 * 2) **المرجعُ الهاربُ**: `record` يوميّةٍ في غيرِ موضعِ المُستدعى (`.call` · `.bind` · إسنادٌ إلى
 *    اسم · تفكيكٌ · وسيطٌ) — منتِجٌ مجهولُ الصنف. وفهرسٌ محسوبُ المفتاحِ على مُستقبِلٍ يوميٍّ كذلك.
 *
 * **الحكمُ لكلِّ صنفٍ مُعفًى K:** `definite` إن كان نوعُ الوسيطِ الحرفَ K وحدَه (`[RC-04]`)، و
 * `possible` إن احتواه اتّحادٌ أو جُهِل (`[RC-14]` — «لا يُبرهَنُ الغياب»: لا يُدّعى أنّ ثمّ منتِجًا،
 * ويُرفَضُ الإعفاءُ لأنّ نفيَه لم يُبرهَن). وهذا يُزيلُ الرفضَ الكاذبَ في `LOCAL_ASSIGNMENT_LIMIT_MISSTATED`:
 * كتابةٌ ميتةٌ في دالّةٍ أخرى لا تُنتجُ `[RC-04]` («له منتِجٌ») بل `[RC-14]` («لم يُبرهَن غيابُه»).
 *
 * **القياسُ قبلَ الكتابة** (الشجرةُ `64a1f05`): 26 نداءَ إنتاجٍ في `src/**` كلُّها بنوعٍ حرفيٍّ
 * واحد — لا مرجعَ هاربًا ولا نوعَ مجهولًا، فلا رفضَ كاذبًا على الحيّ.
 *
 * **حدٌّ معلَن:** التحويلُ عبرَ `as unknown as {…}` يُفلِتُ من نظامِ الأنواعِ ساكنًا — فيُغلَقُ أثرُه
 * تشغيليًّا: `rehydrateFromJournal` يسقطُ (`PERSISTENCE_REHYDRATE_EXEMPTION_CONTRADICTED`) إن وجدَ
 * في اليوميّةِ قيدًا لصنفٍ يُدّعى أن لا منتِجَ له (`assertExemptionsHold` في `src/data/rehydrate_census.ts`).
 *
 * التبعيات: مُترجمُ TypeScript وحدَه.
 */
import { dirname, relative } from 'node:path';
import ts from 'typescript';

export interface ProducerVerdict {
  /** مواضعُ نوعُ وسيطِها الحرفُ المُعفى وحدَه — منتِجٌ قطعًا */
  readonly definite: readonly string[];
  /** مواضعُ لا يُبرهَنُ أنّها لا تُنتجُه — نوعٌ يحتويه أو مجهول، أو مرجعٌ هارب */
  readonly possible: readonly string[];
}

/**
 * أنواعُ Node تُحمَّلُ من مستودعِ الحاجزِ نفسِه لا من الجذرِ المفحوص — فيُرى `readFileSync` نوعًا
 * لا `any` في الشجرةِ الحقيقيّةِ وفي نسخِ الاختبارِ معًا (حكمٌ واحدٌ لا يتبدّلُ بالجذر).
 */
const NODE_TYPE_ROOT = dirname(dirname(require.resolve('@types/node/package.json')));

function unwrap(e: ts.Expression): ts.Expression {
  let cur = e;
  for (;;) {
    if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)
      || ts.isSatisfiesExpression(cur) || ts.isTypeAssertionExpression(cur)) cur = cur.expression;
    else if (ts.isBinaryExpression(cur) && cur.operatorToken.kind === ts.SyntaxKind.CommaToken) cur = cur.right;
    else return cur;
  }
}

/** الحروفُ النصّيّةُ لنوعٍ — أو `null` إن لم يكن اتّحادًا من حروفٍ نصّيّةٍ (مجهول) */
function literalsOf(t: ts.Type): string[] | null {
  const parts = t.isUnion() ? t.types : [t];
  const out: string[] = [];
  for (const p of parts) {
    if (!p.isStringLiteral()) return null;
    out.push(p.value);
  }
  return out;
}

/**
 * الأحكامُ لكلِّ صنفٍ مُعفًى. `files` مساراتُ `src/**`؛ والبرنامجُ يُبنى مرّةً واحدةً لكلِّ الأصناف.
 * إن غابَ تعريفُ اليوميّةِ (`src/data/persistence.ts`) فلا يُقاسُ شيءٌ — والمجهولُ لا يؤيّدُ الإعفاء.
 */
export function typedProducerVerdicts(
  root: string, files: readonly string[], exemptKinds: readonly string[],
): Map<string, ProducerVerdict> {
  const out = new Map<string, { definite: string[]; possible: string[] }>();
  for (const k of exemptKinds) out.set(k, { definite: [], possible: [] });
  if (exemptKinds.length === 0) return out;

  const program = ts.createProgram([...files], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, strict: true, noEmit: true,
    skipLibCheck: true, types: ['node'], typeRoots: [NODE_TYPE_ROOT],
  });
  const checker = program.getTypeChecker();
  const fileSet = new Set(files.map((f) => ts.sys.resolvePath(f)));
  const persistence = program.getSourceFiles().find((sf) => /[\\/]src[\\/]data[\\/]persistence\.ts$/.test(sf.fileName));

  const journalTypes: ts.Type[] = [];
  if (persistence !== undefined) {
    for (const st of persistence.statements) {
      if ((ts.isClassDeclaration(st) && st.name?.text === 'StateJournal')
        || (ts.isInterfaceDeclaration(st) && st.name.text === 'DurableSink')) {
        journalTypes.push(checker.getTypeAtLocation(st.name!));
      }
    }
  }
  const all = (site: string, mode: 'definite' | 'possible'): void => {
    for (const v of out.values()) v[mode].push(site);
  };
  if (journalTypes.length === 0) {
    all('src/data/persistence.ts (لا تعريفَ لـStateJournal/DurableSink — لا يُقاسُ النفي)', 'possible');
    return out;
  }

  /**
   * مُستقبِلٌ يمكنُ أن يكونَ يوميّة — **والجولةُ الثامنة** قلبت اتجاهَ السؤالِ (عيوبُ grok
   * `GENERIC_BIND_ESCAPES_TYPED_PRODUCER_NEGATION` · `GENERIC_DURABLEKIND_PARAM_UNSEEN` ·
   * `SUBCLASS_BIND_ESCAPES_TYPED_PRODUCER_NEGATION`): كان يُسألُ «هل تُسنَدُ يوميّةٌ إلى المُستقبِل؟»
   * فيسقطُ المعاملُ العامُّ `J extends StateJournal` والصنفُ الفرعيُّ — وهما يوميّةٌ قطعًا.
   * فالسؤالُ صار في الاتجاهينِ معًا: «هل يُسنَدُ المُستقبِلُ إلى يوميّةٍ أو يوميّةٌ إليه؟» —
   * فكلُّ تعلُّقٍ بالنوعِ يُرى. **وبنيويًّا** (عييبُ grok
   * `AS_UNKNOWN_AS_STRUCTURAL_RECORD_GREENS_STATIC_GATE`): مُستقبِلٌ نوعُهُ ذو خاصّيّةِ `record`
   * قابلةٍ للنداءِ — يُرى يوميًّا محتمَلًا؛ فالتحويلُ البنيويُّ لا يُبرّئ الإعفاءَ ساكنًا
   * (معيارُ العقدِ §4: الظهورُ في `src/**` مقيسًا على بوابةِ الدمجِ، لا صيغةُ التحويلِ).
   */
  const couldBeJournalType = (t: ts.Type): boolean => {
    if ((t.flags & ts.TypeFlags.Any) !== 0) return true;
    return journalTypes.some((j) => checker.isTypeAssignableTo(t, j) || checker.isTypeAssignableTo(j, t));
  };
  /**
   * **وتحوبُ التحويلِ** (عييبُ grok `AS_UNKNOWN_AS_STRUCTURAL_RECORD_GREENS_STATIC_GATE`):
   * التحويلُ البنيويُّ — `as unknown as { record: … }` سمّى هدفَهُ أو لم يُسمّهِ — طريقُ إخفاءِ
   * يوميّةٍ خلفَ نوعٍ آخر، والمترجمُ لا يُخبرُ عنهُ. فيُتتبّعُ المُستقبِلُ **تعبيرًا**: تحويلٌ
   * (`as` أو تأكيدٌ نوعيٌّ) هدفُهُ ذو خاصّيّةِ `record` قابلةٍ للنداءِ — يوميّةٌ محتملةٌ؛
   * والمعرّفُ يُتتبّعُ إلى إعلانِهِ في ملفِّهِ (متغيّرٌ محليٌّ بلا وسيطٍ) فتحويلُهُ يُقرأُ
   * كذلك. فالصنفُ المسمّى الأمينُ لا يُتّهم لصنفِهِ، والتحويلُ مهما سمّى هدفَهُ لا يُبرّئ.
   * **وحدُّ معلَن:** التعقّي يشملُ إعلاناتِ الملفِّ نفسِهِ؛ والمعرّفُ المستورَدُ والوسيطُ لا
   * إعلانَ محليًّا لهما — نوعُهُما هو المُسألُ عنهُ (اتجاهَي الإسنادِ أعلاه).
   */
  const hasCallableRecordType = (t: ts.Type): boolean => {
    if ((t.flags & ts.TypeFlags.Any) !== 0) return true;
    const record = t.getProperty('record');
    return record !== undefined && checker.getTypeOfSymbol(record).getCallSignatures().length > 0;
  };
  const localInitializer = (id: ts.Identifier): ts.Expression | null => {
    let out: ts.Expression | null = null;
    const visit = (n: ts.Node): void => {
      if (out === null && ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === id.text
        && n.initializer !== undefined && n.getSourceFile() === id.getSourceFile()) out = n.initializer;
      ts.forEachChild(n, visit);
    };
    visit(id.getSourceFile());
    return out;
  };
  const journalLike = (receiver: ts.Expression): boolean => {
    if (couldBeJournalType(checker.getTypeAtLocation(receiver))) return true;
    let cur: ts.Expression = receiver;
    for (let depth = 0; depth < 8; depth += 1) {
      if (ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
      if (ts.isAsExpression(cur) || ts.isTypeAssertionExpression(cur)) {
        if (hasCallableRecordType(checker.getTypeAtLocation(cur))) return true;
        cur = cur.expression;
        continue;
      }
      if (ts.isIdentifier(cur)) {
        const init = localInitializer(cur);
        if (init === null) return false;
        cur = init;
        continue;
      }
      return false;
    }
    return false;
  };
  /** النوعُ المُعلَنُ للمتغيّرِ القابلِ للكتابةِ وللخاصّيّة — لا المُضيَّقُ بالتدفّق */
  const declaredTypeOf = (arg: ts.Expression): ts.Type => {
    const e = unwrap(arg);
    const sym = ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) ? checker.getSymbolAtLocation(e) : undefined;
    const decl = sym?.valueDeclaration;
    if (sym !== undefined && decl !== undefined) {
      const isConst = ts.isVariableDeclaration(decl) && ts.isVariableDeclarationList(decl.parent)
        && (decl.parent.flags & ts.NodeFlags.Const) !== 0;
      if (!isConst) return checker.getTypeOfSymbol(sym);
    }
    return checker.getTypeAtLocation(arg);
  };
  const siteOf = (sf: ts.SourceFile, n: ts.Node): string =>
    `${relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;

  const calleeNodes = new Set<ts.Node>();
  const judgeCall = (sf: ts.SourceFile, call: ts.CallExpression): void => {
    const site = siteOf(sf, call);
    const arg = call.arguments[0];
    if (arg === undefined || ts.isSpreadElement(arg)) { all(`${site} (وسيطُ الصنفِ غائبٌ أو منشور)`, 'possible'); return; }
    const kinds = literalsOf(declaredTypeOf(arg));
    for (const [k, v] of out) {
      if (kinds === null) v.possible.push(`${site} (نوعُ الصنفِ غيرُ حرفيّ: ${checker.typeToString(declaredTypeOf(arg))})`);
      else if (kinds.length === 1 && kinds[0] === k) v.definite.push(site);
      else if (kinds.includes(k)) v.possible.push(`${site} (اتّحادٌ يحتوي ${k})`);
    }
  };

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !fileSet.has(ts.sys.resolvePath(sf.fileName))) continue;
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = unwrap(n.expression);
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'record') {
          calleeNodes.add(callee);
          if (journalLike(callee.expression)) judgeCall(sf, n);
        } else if (ts.isElementAccessExpression(callee)) {
          const key = unwrap(callee.argumentExpression);
          const literal = ts.isStringLiteralLike(key) ? key.text : null;
          if (literal === 'record' || literal === null) {
            calleeNodes.add(callee);
            if (journalLike(callee.expression)) {
              if (literal === null) all(`${siteOf(sf, n)} (فهرسٌ محسوبُ المفتاحِ على يوميّة)`, 'possible');
              else judgeCall(sf, n);
            }
          }
        }
      }
      // المرجعُ الهارب: `X.record`/`X['record']`/تفكيكُ `{ record }` في غيرِ موضعِ المُستدعى
      if (ts.isPropertyAccessExpression(n) && n.name.text === 'record' && !calleeNodes.has(n)
        && !isCalleeOf(n) && journalLike(n.expression)) {
        all(`${siteOf(sf, n)} (مرجعٌ هاربٌ إلى record: ${n.parent.getText(sf).slice(0, 60)})`, 'possible');
      }
      if (ts.isElementAccessExpression(n) && !calleeNodes.has(n) && !isCalleeOf(n)) {
        const key = unwrap(n.argumentExpression);
        const literal = ts.isStringLiteralLike(key) ? key.text : null;
        if ((literal === 'record' || literal === null) && journalLike(n.expression)
          && !ts.isNumericLiteral(key)) {
          all(`${siteOf(sf, n)} (مرجعٌ هاربٌ بفهرسٍ على يوميّة)`, 'possible');
        }
      }
      if (ts.isObjectBindingPattern(n)) {
        const hasRecord = n.elements.some((el) => (el.propertyName ?? el.name).getText(sf) === 'record'
          || el.dotDotDotToken !== undefined);
        if (hasRecord) {
          const t = checker.getTypeAtLocation(n);
          if (couldBeJournalType(t)) {
            all(`${siteOf(sf, n)} (تفكيكُ record من يوميّة)`, 'possible');
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

/** هل العقدةُ هي المُستدعى (بعدَ الأغلفة) لنداءٍ؟ */
function isCalleeOf(n: ts.Expression): boolean {
  let cur: ts.Node = n;
  while (cur.parent !== undefined && (ts.isParenthesizedExpression(cur.parent) || ts.isAsExpression(cur.parent)
    || ts.isNonNullExpression(cur.parent) || ts.isSatisfiesExpression(cur.parent)
    || (ts.isBinaryExpression(cur.parent) && cur.parent.operatorToken.kind === ts.SyntaxKind.CommaToken
      && cur.parent.right === cur))) cur = cur.parent;
  return cur.parent !== undefined && ts.isCallExpression(cur.parent) && cur.parent.expression === cur;
}
