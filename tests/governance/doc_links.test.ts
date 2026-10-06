/**
 * tests/governance/doc_links.test.ts — حارسُ الروابط النسبيّة في الوثائق (المرحلة 40، البند W-2026-064)
 * المالك: القيّم على المستودع
 * المدخلات: كلُّ ملفِّ Markdown متتبَّعٍ في git
 * المخرجات: تأكيدٌ أنّ كلَّ رابطٍ نسبيٍّ يصل إلى ملفٍّ موجود
 * التبعيات: `node:child_process` (قائمةُ git) · `node:fs` · `node:path`
 * الصلاحيات (RULE-004): يقرأ ولا يكتب
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: رابطٌ إلى ملفٍّ نُقل (`config/module_limits.yaml` ⇒ `scripts/limits/`) ·
 *   رابطٌ يُحسب من جذرٍ غيرِ مجلدِ ملفِّه · رابطٌ إلى ملفٍّ لم يوجد قطّ
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * ثوابت هذا الملف:
 *
 * 1) **الرابطُ يُحسب من مجلدِ ملفِّه** كما يعرضه GitHub — إلّا `docs/work/WORK_LOG.md` فروابطُه
 *    من جذر المستودع **بعقدِ البوابة**: `scripts/check_work.mjs` يتحقّق من وجودِ تقريرِ كلِّ صفٍّ
 *    بالمسارِ نفسِه من الجذر (RULE-014)، والسجلُّ يُذيَّل ولا يُعدَّل — فيُقاس كما تقيسه البوابة.
 * 2) **قائمةُ الانتظار مغلقةٌ ومسمّاة**: ملفٌّ فيه رابطٌ مكسورٌ ونطاقُه محجوزٌ لبندٍ حيٍّ آخر لا
 *    يُصلَح من خارج بندِه (RULE-011)، فيُسمّى هنا ببندِه. والقائمةُ تُفرَّغ ولا تُزاد؛ وملفٌّ فيها
 *    صار سليمًا يُسقط الاختبارَ حتى يُحذف منها — فلا يبقى استثناءٌ بلا موجب.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const ROOT_RELATIVE = new Set(['docs/work/WORK_LOG.md']);
/** ملفٌّ ⇒ البندُ الحيُّ الذي يحجزه (يُفرَّغ بإصلاحه داخل بندِه). */
const PENDING: ReadonlyMap<string, string> = new Map<string, string>([]);

/**
 * التقاريرُ الخامُّ لأعضاء مجلس المراجعة تُحفظ حرفًا بحرف (ADR-0054 §4 · RULE-020) ولا تُعدَّل —
 * وفيها روابطُ مكسورةٌ عمدًا هي نصُّ مسابير الطفرة نفسِها. فتُستثنى **بنمطِ اسمٍ مغلق** لا بمجلد:
 * المحاضرُ (`.json`) و`README.md` في المجلد نفسِه تبقى محروسة.
 */
const VERBATIM = /^docs\/work\/council\/W-\d{4}-\d{3}(-\d+)?-[a-z0-9]+\.md$/;

/** يُزيل الشفرةَ المسوّرةَ والمضمّنة: ما بين علامات الشفرة نصٌّ لا رابط (كما يعرضه GitHub). */
export function stripCode(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/(`+)[^`\n]*?\1/g, '');
}

/**
 * شفرةُ العنوان كما يعرفُها CommonMark: "…" أو '…' أو (…) — بعد فراغٍ بعد الوجهة، وفي كلٍّ منها
 * **التهريبُ بالشرطة المائلة** (`\"` · `\'` · `\(` `\)`) حرفٌ من العنوان لا خاتمةٌ له.
 * (الجلسة 2 · DOC_LINK_GUARD_REFERENCE_STYLE_BYPASS: العنوانُ المفردُ والقوسيُّ كانا يعميانِ الحارس ·
 *  الجلسة 3 · DOC_LINK_GUARD_TITLE_ESCAPE_BYPASS: عنوانٌ فيه تهريبٌ كان يُفشل المطابقةَ كلَّها فتختفي الوجهة)
 */
const TITLE = String.raw`(?:\s+(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\((?:[^()\\]|\\[\s\S])*\)))?`;
/**
 * الروابطُ المباشرة: ](وجهة) أو ](<وجهة بفراغات>) — والوجهةُ العاريةُ قد تحملُ أقواسًا متوازنة.
 * CommonMark 0.31.2 يوجبُ دعمَ ثلاثةِ مستوياتٍ على الأقلّ من الأقواسِ المتوازنةِ غيرِ المهرَّبةِ في
 * الوجهةِ العارية (يحكمُ التنفيذُ فيما فوقها). النمطُ السابقُ (`[^()\s]*(?:\([^()]*\)[^()\s]*)*`)
 * كان مستوىً واحدًا، فعَمِيَ عن `[x](foo(bar(baz)).md)` — عيبُ الجلسة 5
 * (DOC_LINK_GUARD_NESTED_PAREN_DESTINATION_BYPASS). والحدُّ المعلنُ هنا ثلاثةٌ، وهو سقفٌ أدنى
 * يُوثَّقُ لا سقفٌ مطلق: ما فُتحَ قوسًا ولم يُغلَقْ ضمنَ الثلاثةِ لا يُعدُّ وجهةً — فلا يُبلَّغ ولا يُعمى.
 */
const PAREN = String.raw`\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S]|\((?:[^()\\]|\\[\s\S])*\))*\))*\)`;
const INLINE_LINK = new RegExp(String.raw`\]\(\s*(?:<([^<>]*)>|([^()\s]*(?:` + PAREN + String.raw`[^()\s]*)*))\s*` + TITLE + String.raw`\)`, 'g');
/**
 * تعريفاتُ الروابط المرجعية: [وسم]: وجهة أو <وجهة بفراغات> — في أوّل السطر **أو بعد بادئةِ حاوية**:
 * علاماتُ الاقتباس `>` (ولو متداخلةً أو مُزاحة) وعلاماتُ القائمة (`-` `*` `+` `1.` `1)`) وأيُّ إزاحةٍ
 * لقائمةٍ متداخلة. (الجلسة 3 · DOC_LINK_GUARD_CONTAINER_REFERENCE_BYPASS: التثبيتُ بـ`^ {0,3}\[` كان
 * يُعمي الحارسَ عن تعريفٍ داخل اقتباسٍ أو قائمة.) والحدُّ المعلن: إزاحةٌ بأربعةِ فراغاتٍ خارجَ قائمةٍ
 * شفرةٌ في CommonMark — فتعريفٌ فيها يُقاس هنا وقد لا يكون رابطًا: إنذارٌ زائدٌ يُرى لا عمًى صامت.
 * (الجلسة 4 · DOC_LINK_GUARD_BLOCKQUOTE_NOSPACE_BYPASS: علامةُ الاقتباس `>` **لا يلزمها فراغٌ بعدها**
 *  — CommonMark 0.31.2 §5.1 — فـ`>[r]:` و`>>[r]:` و`> >[r]:` تعريفاتٌ؛ والفراغُ شرطٌ لعلامةِ القائمة وحدها،
 *  فـ`-[r]:` ليس قائمةً ولا تعريفًا.)
 */
const CONTAINER = String.raw`(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?)*[ \t]*`;
/**
 * الوسم: ينتهي عند أوّلِ `]` **غيرِ مهرَّب** — فالتهريبُ بالشرطة المائلة حرفٌ منه لا خاتمةٌ له.
 * (الجلسة 4 · DOC_LINK_GUARD_ESCAPED_LABEL_BYPASS: `[foo\]bar]:` كان يقف عند أوّلِ `]` فيفلت التعريف.)
 */
const LABEL = String.raw`\[(?:[^\]\\]|\\[\s\S])+\]`;
const REFERENCE_DEF = new RegExp(String.raw`^` + CONTAINER + LABEL + String.raw`:\s*(?:<([^<>]*)>|(\S+))`, 'gm');

/** الروابطُ النسبيّةُ المكسورة في نصٍّ موضعُه `file` — بلا مخرجٍ إلّا المخطّطَ (URI) والمرساةَ الخالصة. */
export function brokenLinksIn(file: string, text: string, exists: (p: string) => boolean): string[] {
  const base = ROOT_RELATIVE.has(file) ? '' : dirname(file);
  const out: string[] = [];
  const consider = (raw: string): void => {
    const link = raw.split('#')[0] ?? '';
    if (link === '' || /^[a-z][a-z0-9+.-]*:/i.test(link)) return;
    let target = link;
    try { target = decodeURIComponent(link); } catch { /* يُقاس كما كُتب */ }
    if (!exists(normalize(join(base, target)))) out.push(raw);
  };
  const body = stripCode(text);
  for (const m of body.matchAll(INLINE_LINK)) consider(m[1] ?? m[2] ?? '');
  for (const m of body.matchAll(REFERENCE_DEF)) consider(m[1] ?? m[2] ?? '');
  return out;
}

function brokenLinks(file: string): string[] {
  return brokenLinksIn(file, readFileSync(join(ROOT, file), 'utf8'), (p) => existsSync(join(ROOT, p)));
}

test('حارسُ الروابط: كلُّ رابطٍ نسبيٍّ في الوثائق يصل إلى ملفٍّ موجود، والانتظارُ مسمًّى ببندِه', () => {
  const ls = spawnSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ls.status, 0, 'git ls-files');
  const files = ls.stdout.split('\n').filter((f) => f !== '');
  assert.ok(files.length > 100, `قائمةُ الوثائق أقصرُ من المتوقّع: ${files.length}`);
  const broken: string[] = [];
  const healedPending: string[] = [];
  for (const f of files) {
    if (VERBATIM.test(f)) continue;
    const b = brokenLinks(f);
    if (PENDING.has(f)) {
      if (b.length === 0) healedPending.push(f);
      continue;
    }
    for (const l of b) broken.push(`${f} -> ${l}`);
  }
  assert.deepEqual(broken, [], `روابطُ مكسورة:\n${broken.join('\n')}`);
  assert.deepEqual(healedPending, [], `ملفّاتٌ في قائمةِ الانتظار صارت سليمة — احذفها منها:\n${healedPending.join('\n')}`);
});

const none = (): boolean => false;
test('حارسُ الروابط: رابطٌ نسبيٌّ بلا حرفٍ لاتينيٍّ يُقاس ولا يُتخطّى (DOC_LINK_GUARD_ASCII_BYPASS)', () => {
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](وثيقة.md) [y](./١٢) [z](../وثائق/)', none), ['وثيقة.md', './١٢', '../وثائق/']);
  assert.deepEqual(brokenLinksIn('docs/a.md', "[q](it's.md)", none), ["it's.md"]);
});
test('حارسُ الروابط: المرساةُ تُنزع والملفُّ يُقاس · المرساةُ الخالصةُ والمخطّطُ يُتركان', () => {
  assert.deepEqual(brokenLinksIn('docs/a.md', '[a](missing.md#s) [b](#local) [c](https://x.y/z) [d](mailto:a@b)', none), ['missing.md#s']);
});
test('حارسُ الروابط: ما في الشفرة نصٌّ لا رابط · وما خارجها يُقاس', () => {
  const t = '`[a](nope.md)`\n```\n[b](nope2.md)\n```\n[c](nope3.md)';
  assert.deepEqual(brokenLinksIn('docs/a.md', t, none), ['nope3.md']);
});
test('حارسُ الروابط: الرابطُ يُحسب من مجلدِ ملفِّه، ومُرمَّزُ النسبة يُفكّ', () => {
  const seen: string[] = [];
  brokenLinksIn('docs/x/a.md', '[a](../b%20c.md)', (p) => { seen.push(p); return true; });
  assert.deepEqual(seen, ['docs/b c.md']);
});
test('حارسُ الروابط: الاستثناءُ نمطُ اسمٍ مغلقٌ للتقارير الخامّ وحدها لا للمجلد', () => {
  assert.ok(VERBATIM.test('docs/work/council/W-2026-064-grok.md'));
  assert.ok(VERBATIM.test('docs/work/council/W-2026-064-2-gpt.md'));
  assert.ok(!VERBATIM.test('docs/work/council/README.md'));
  assert.ok(!VERBATIM.test('docs/work/council/W-2026-064.json'));
  assert.ok(!VERBATIM.test('docs/work/REVIEW_COUNCIL.md'));
});

/** عددٌ يتبعه وصفُ ما يُعَدّ — صيغةُ الرقمِ المنقولِ الذي لا يقرؤه فحص، عربيّه وغربيّه (الجلسة 2: ٢٠٠ كان يعبر) */
const TRANSCRIBED_COUNT = /(?:\d[\d,٬]*|[٠-٩][٠-٩٬]*)\s*(ملف|سطر|اختبار)/u;
export function architectureHeader(text: string): string {
  const start = text.indexOf('**آخر تحديث:**');
  if (start < 0) return '';
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end < 0 ? undefined : end);
}
test('ترويسةُ ARCHITECTURE.md بلا عددٍ منقولٍ لملفّاتٍ أو أسطرٍ أو اختبارات (W-2026-064 · الجلسة 1)', () => {
  const h = architectureHeader(readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8'));
  assert.ok(h.length > 0, 'سطرُ «آخر تحديث» غائب');
  assert.equal(TRANSCRIBED_COUNT.exec(h)?.[0], undefined);
  assert.match('والمقيسُ يومَ صُحّح: 200 ملف · 36,913 سطرًا · 2366 اختبارًا', TRANSCRIBED_COUNT);
  assert.match('٢٠٠ ملف منقولةٌ بالعربيةِ لا تعبر', TRANSCRIBED_COUNT);
});

test('حارسُ الروابط: الصيغُ المرجعيةُ والعناوينُ البديلةُ ووجهاتُ الفراغِ تُقاس — لا مخرجَ صامتًا (DOC_LINK_GUARD_REFERENCE_STYLE_BYPASS)', () => {
  // روابطٌ مباشرةٌ بعناوينَ مفردةٍ أو قوسيّةٍ — كانت تمرّ صامتةً
  assert.deepEqual(brokenLinksIn('docs/a.md', "[x](missing.md 'عنوان')", none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](missing.md (عنوان))', none), ['missing.md']);
  // وجهةٌ ذاتُ فراغٍ داخل <> — صيغةُ GitHub لمسارٍ فيه فراغ
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](<my file.md>)', none), ['my file.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](<missing file.md> "عنوان")', none), ['missing file.md']);
  // وجهةٌ عاريةٌ بأقواسٍ متوازنة
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo(bar).md)', none), ['foo(bar).md']);
  // روابطٌ مرجعيةٌ: التعريفُ هو ما يُقاس — والاستعمالُ بلا تعريفٍ نصٌّ لا رابط
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x][r]\n\n[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: <broken ref.md>', none), ['broken ref.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: missing.md "عنوان"', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x][undefined]', none), []);
  // سالبةُ الضبط: صيغٌ سليمةٌ لا تُبلَّغ
  const all = (): boolean => true;
  assert.deepEqual(brokenLinksIn('docs/a.md', "[x](../README.md 't') [y](<../README.md>)", all), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: ../README.md', all), []);
  // وجهةٌ مخطّطةٌ أو مرساةٌ خالصةٌ تُتركان
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: https://x.y/z [c](#anchor)', none), []);
});

test('حارسُ الروابط: العنوانُ المُهرَّبُ وتعريفُ الحاوية يُقاسان — لا مخرجَ صامتًا (الجلسة 3 · DOC_LINK_GUARD_TITLE_ESCAPE_BYPASS · DOC_LINK_GUARD_CONTAINER_REFERENCE_BYPASS)', () => {
  // مسابيرُ grok في الجلسة 3 بحرفها — كانت كلُّها []
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](missing.md "say \\"hi\\"")', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', "[x](missing.md 'it\\'s gone')", none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](missing.md (title \\(with\\) parens))', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](<my file.md> "say \\"hi\\"")', none), ['my file.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '> [r]: missing.md\n>\n> [x][r]', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '   > [r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '- item\n  - nested\n\n    [r]: missing.md', none), ['missing.md']);
  // حاوياتٌ أخرى من العائلة نفسِها
  assert.deepEqual(brokenLinksIn('docs/a.md', '> > [r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '- [r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '1. [r]: missing.md\n2) [s]: gone.md', none), ['missing.md', 'gone.md']);
  // سالبةُ الضبط: الصيغُ نفسُها سليمةً لا تُبلَّغ، ومربّعُ المهمّة ليس تعريفًا
  const all = (): boolean => true;
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](../README.md "say \\"hi\\"") > [r]: ../README.md', all), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '- [ ] مهمّة\n- [x] منجزة', none), []);
});

test('حارسُ الروابط: الاقتباسُ بلا فراغٍ والوسمُ المهرَّب يُقاسان — لا مخرجَ صامتًا (الجلسة 4 · DOC_LINK_GUARD_BLOCKQUOTE_NOSPACE_BYPASS · DOC_LINK_GUARD_ESCAPED_LABEL_BYPASS)', () => {
  const none = (): boolean => false;
  // مسابيرُ grok في الجلسة 4 بحرفها — كانت كلُّها []
  assert.deepEqual(brokenLinksIn('docs/a.md', '>[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', ' >[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '   >[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '>> [r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '>>[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '> >[r]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '>[r]: missing.md "title"', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '>[r]: <missing file.md>', none), ['missing file.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[foo\\]bar]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '> [foo\\]bar]: missing.md', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[a\\]b]: gone.md', none), ['gone.md']);
  // العيبان معًا
  assert.deepEqual(brokenLinksIn('docs/a.md', '>[a\\]b]: gone.md', none), ['gone.md']);
  // سالبةُ الضبط: `-[r]:` ليس قائمةً (علامتُها يلزمها فراغ) ولا نصٌّ يسبقه حرفٌ قبل `>`؛ والسليمُ لا يُبلَّغ
  assert.deepEqual(brokenLinksIn('docs/a.md', '-[r]: missing.md', none), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', 'a > [r]: missing.md', none), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '- [ ] مهمّة\n- [x] منجزة', none), []);
  const all = (): boolean => true;
  assert.deepEqual(brokenLinksIn('docs/a.md', '>[r]: ../README.md\n[a\\]b]: ../README.md', all), []);
});

test('حارسُ الروابط: الوجهةُ العاريةُ بأقواسٍ متداخلةٍ تُقاس — لا مخرجَ صامتًا (الجلسة 5 · DOC_LINK_GUARD_NESTED_PAREN_DESTINATION_BYPASS)', () => {
  const none = (): boolean => false;
  // مسابيرُ grok في الجلسة 5 بحرفها — كانت كلُّها []
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo(bar(baz)).md)', none), ['foo(bar(baz)).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b(c(d))).md)', none), ['a(b(c(d))).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo(bar(baz)).md "title")', none), ['foo(bar(baz)).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', "[x](foo(bar(baz)).md 'title')", none), ['foo(bar(baz)).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo(bar(baz)).md (title))', none), ['foo(bar(baz)).md']);
  // المستوى الواحد لا يزال يُقاس
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo(bar).md)', none), ['foo(bar).md']);
  // صيغةُ الزوايا بأقواسٍ متداخلةٍ تُقاس (كانت تمرّ)
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](<foo(bar(baz)).md>)', none), ['foo(bar(baz)).md']);
  // سالبةُ الضبط: قوسٌ غيرُ متوازنٍ لا يُعدُّ وجهةً — فلا يُبلَّغ ولا يُعمى
  const all = (): boolean => true;
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](../README.md) [y](foo(bar(baz)).md)', all), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b(c).md)', none), []);
});
