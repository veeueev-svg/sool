/**
 * tests/governance/doc_links.test.ts — حارسُ الروابط النسبيّة في الوثائق (المرحلة 40، البند W-2026-064)
 * المالك: القيّم على المستودع
 * المدخلات: كلُّ ملفِّ Markdown متتبَّعٍ في git
 * المخرجات: تأكيدٌ أنّ كلَّ رابطٍ نسبيٍّ يصل إلى ملفٍّ موجود
 * التبعيات: `node:child_process` · `node:fs` · `node:path` · `./markdown_blocks` (نقلُ commonmark.js 0.31.2 — بلا تبعيّة) · الصلاحيات (RULE-004): يقرأ ولا يكتب · السجلات: لا شيء
 * حالات الفشل المُغطّاة: ملفٌّ نُقل (`config/module_limits.yaml` ⇒ `scripts/limits/`) · جذرٌ غيرُ مجلدِ الملف · ملفٌّ لم يوجد قطّ
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 * ثوابت هذا الملف:
 * 1) **الرابطُ يُحسب من مجلدِ ملفِّه** كما يعرضه GitHub — إلّا `WORK_LOG.md` فروابطُه من الجذر
 *    (بعقدِ البوابة: `check_work.mjs` يتحقّق من تقريرِ كلِّ صفٍّ من الجذر — RULE-014).
 * 2) **قائمةُ الانتظار مغلقةٌ ومسمّاة** (RULE-011): ملفٌّ فيه رابطٌ مكسورٌ ونطاقُه محجوزٌ لبندٍ حيٍّ
 *    آخر يُسمّى هنا ببندِه؛ والقائمةُ تُفرَّغ ولا تُزاد.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { markdownLinks } from './markdown_blocks';

const ROOT = process.cwd();
const ROOT_RELATIVE = new Set(['docs/work/WORK_LOG.md']);
/** ملفٌّ ⇒ البندُ الحيُّ الذي يحجزه (يُفرَّغ بإصلاحه داخل بندِه). */
const PENDING: ReadonlyMap<string, string> = new Map<string, string>([]);
/**
 * التقاريرُ الخامُّ لأعضاء مجلس المراجعة تُحفظ حرفًا بحرف (ADR-0054 §4 · RULE-020) ولا تُعدَّل —
 * وفيها روابطُ مكسورةٌ عمدًا (مسابيرُ الطفرة). فتُستثنى **بنمطِ اسمٍ مغلق** لا بمجلد: المحاضرُ (`.json`)
 * و`README.md` في المجلد نفسِه تبقى محروسة.
 */
const VERBATIM = /^docs\/work\/council\/W-\d{4}-\d{3}(-\d+)?-[a-z0-9]+\.md$/;

/**
 * **الحارسُ يقرأ ما يقرؤه العارض** (الجلسة 112 تابع · علاجُ عيوب الجلسة 18 الستّة بجذرها): مواضعُ الروابط تُستخرج
 * بنقلٍ حرفيِّ الخوارزمية لـcommonmark.js 0.31.2 (`markdown_blocks.ts` · `markdown_inline.ts`) لا بأنماطٍ تحاكيه —
 * فالمحاكاةُ أسقطت البندَ في ثمانيَ عشرةَ جلسة، كلُّ جلسةٍ بعيبٍ جديدٍ من الصنف نفسه (الشفرةُ والسورُ وكتلُ HTML
 * والحاويات). وبلا تبعيّة (ADR-0001): المحرّكُ المرجعيُّ أداةُ قياسٍ خارجَ المستودع لا تبعيّةٌ فيه.
 */
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** فكُّ وجهةِ الرابط — **مسحةٌ واحدةٌ** (الجلسة 120 · علاجُ الجولة 25 · DOC_LINK_GUARD_ESCAPE_RECONSTITUTES_ENTITY):
 *  التهريبُ والكياناتُ يُعالجان في مسحةٍ واحدةٍ من اليسار — فالتهريبُ يُنتجُ محرفًا حرفيًّا لا يُعادُ مسحُه
 *  كيانًا (CommonMark 0.31.2 §2.4/§6.1: `\&` محرفٌ حرفيٌّ لا يبدأُ كيانًا): استهلاكُ التهريبِ `\&`
 *  يمنعُ قراءةَ ما بعده كيانًا — والمسحُ لا يعودُ على ما فكّه. */
export function unescapeDestination(raw: string): string {
  return raw.replace(/\\([!-/:-@[-`{-~])|&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g,
    (_m: string, esc?: string, dec?: string, hex?: string, name?: string) => {
      if (esc !== undefined) return esc; // تهريبٌ: المحرفُ حرفيٌّ — ولا يُعادُ مسحُه كيانًا
      if (name !== undefined) return NAMED[name] ?? _m;
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex ?? '', 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
    });
}

/** الروابطُ النسبيّةُ المكسورة في نصٍّ موضعُه `file` — بلا مخرجٍ إلّا المخطّطَ (URI) والمرساةَ الخالصة. */
export function brokenLinksIn(file: string, text: string, exists: (p: string) => boolean): string[] {
  const base = ROOT_RELATIVE.has(file) ? '' : dirname(file);
  const out: string[] = [];
  const consider = (raw: string): void => {
    const link = unescapeDestination(raw).split('#')[0] ?? '';
    if (link === '' || /^[a-z][a-z0-9+.-]*:/i.test(link)) return;
    let target = link;
    try { target = decodeURIComponent(link); } catch { /* يُقاس كما كُتب */ }
    // الحصرُ تحت جذر المستودع (الجلسة 10): الخروجُ يُبلَّغ ولا يُقاسُ وجودُه على المضيف، و`/` تُنسبُ إلى الجذرِ كما يعرضُه GitHub.
    const rooted = target.startsWith('/');
    const p = rooted ? normalize(target) : normalize(join(base, target));
    if (!rooted && (p === '..' || p.startsWith('../') || isAbsolute(p))) {
      out.push(raw);
      return;
    }
    if (!exists(p)) out.push(raw);
  };
  // المباشرةُ بترتيبها ثمّ كلُّ تعريفٍ مرجعيٍّ — مستعمَلًا أو لا (التعريفُ المكسورُ مكسورٌ وإن لم يُستعمل)
  const links = markdownLinks(text);
  for (const d of links.inline) consider(d);
  for (const d of links.definitions) consider(d);
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
test('حارسُ الروابط: backtick المهرَّبُ محرفٌ لا حدَّ شفرة — والرابطُ معه يُقاس لا يُغفَل (الجلسة 16 · DOC_LINK_GUARD_ESCAPED_BACKTICK_STRIP_BYPASS)', () => {
  const eq = (t: string, expected: string[]) => assert.deepEqual(brokenLinksIn('docs/a.md', t, none), expected, t);
  eq('See \\` [x](missing.md) ` end', ['missing.md']);
  eq('a`[x](m.md)` b \\` [y](n.md) ` c', ['n.md']);
  eq('single \\` backtick before [l1](u1.md)', ['u1.md']);
  eq('double \\\\` backticks [l2](u2.md)', ['u2.md']);
  eq('text \\\\\\` [l5](u5.md) and `span` [l6](u6.md)', ['u5.md', 'u6.md']);
  eq('``code with ` inside`` [l4](u4.md)', ['u4.md']);
  eq('See \\\\` [x](missing.md) ` end', []);
  eq('`code \\` [x](missing.md) ` end', ['missing.md']);
});
test('حارسُ الروابط: الشفرةُ المضمّنةُ العابرةُ للأسطرِ داخلَ الفقرةِ تُسقَطُ ولا يقترنُ ما بعدَ الفقرةِ بها (الجلسة 17 · SESSION17_INLINE_CODE_CROSSLINE_STATE_BYPASS)', () => {
  const cases = ['`\n` [x](missing.md) `', 'See `foo\nbar` [x](missing.md) `baz`', '`foo\r\n` [x](missing.md) `', '``foo\n`` [x](missing.md)``',
    'The helper `removeInlineCode\n` strips [inline code](missing.md) before `scan`.', 'odd ` tick\n\n[x](missing.md)', 'no closer ` here\n\n[x](missing.md)',
    '`open\n# [x](missing.md) `', '`open\n- [x](missing.md) `', '`open\n1. [x](missing.md) `', '`open\n> [x](missing.md) `', '`open\n---\n[x](missing.md) `', '`open\n===\n[x](missing.md) `',
    '`open\n<!-- c -->\n[x](missing.md) `', '# `open\n[x](missing.md) `'];
  for (const t of cases) assert.deepEqual(brokenLinksIn('docs/a.md', t, none), ['missing.md'], t);
});
test('حارسُ الروابط: التهريبُ لا يُعادُ تكوينُه كيانًا — وجهةُ `\&` تُقاس حرفيةً كما يحلّها commonmark@0.31.2 لا تُفكّ كيانًا ثانيا (الجلسة 120 · الجولة 25 · DOC_LINK_GUARD_ESCAPE_RECONSTITUTES_ENTITY)', () => {
  // مسابيرُ grok بحرفها: exists يرى README.md وحده موجودًا — فالوجهةُ الحرفيةُ READ&#77;E.md لا تُفتح
  const readmeOnly = (p: string): boolean => p === 'docs/README.md';
  const eq = (t: string, expected: string[], exists = readmeOnly) => assert.deepEqual(brokenLinksIn('docs/a.md', t, exists), expected, t);
  eq('[x](READ\\&#77;E.md)', ['READ\\&#77;E.md']);
  eq('[x](READ\\&#x4d;E.md)', ['READ\\&#x4d;E.md']);
  eq('[x](READ\\&ME.md)', ['READ\\&ME.md']);
  eq('[x](READ\\&#77;E.md)', [], (p) => p === 'docs/READ&'); // مسارُ الوجهةِ الحرفيةِ بعد قصّ المرساة (`#` يبدأ الجزءَ كمرساة URL) — موجود ⇒ لا بلاغ
  eq('[x](&#77;E.md)', ['&#77;E.md']); // بلا تهريبٍ يُفكُّ الكيانُ إلى ME.md — الضابطُ بلا تغيير
  eq('[x](&#x4d;E.md)', ['&#x4d;E.md']);
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
  // مسابيرُ grok في الجلسة 3 بحرفها (كانت كلُّها []) + حاوياتُ العائلة + سالبةُ الضبط (مربّعُ المهمّة ليس تعريفًا)
  for (const [t, e] of [['[x](missing.md "say \\"hi\\"")', ['missing.md']], ["[x](missing.md 'it\\'s gone')", ['missing.md']],
    ['[x](missing.md (title \\(with\\) parens))', ['missing.md']], ['[x](<my file.md> "say \\"hi\\"")', ['my file.md']],
    ['> [r]: missing.md\n>\n> [x][r]', ['missing.md']], ['   > [r]: missing.md', ['missing.md']],
    ['- item\n  - nested\n\n    [r]: missing.md', ['missing.md']], ['> > [r]: missing.md', ['missing.md']],
    ['- [r]: missing.md', ['missing.md']], ['1. [r]: missing.md\n2) [s]: gone.md', ['missing.md', 'gone.md']]] as [string, string[]][])
    assert.deepEqual(brokenLinksIn('docs/a.md', t, none), e, t);
  const all = (): boolean => true;
  assert.deepEqual(brokenLinksIn('docs/a.md', "[x](../README.md 't') [y](<../README.md>)", all), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: ../README.md', all), []);
  // وجهةٌ مخطّطةٌ أو مرساةٌ خالصةٌ تُتركان
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: https://x.y/z [c](#anchor)', none), []);
});

test('حارسُ الروابط: الاقتباسُ بلا فراغٍ والوسمُ المهرَّب يُقاسان — لا مخرجَ صامتًا (الجلسة 4 · DOC_LINK_GUARD_BLOCKQUOTE_NOSPACE_BYPASS · DOC_LINK_GUARD_ESCAPED_LABEL_BYPASS)', () => {
  const none = (): boolean => false;
  // مسابيرُ grok في الجلسة 4 بحرفها — كانت كلُّها []
  for (const [t, e] of [['>[r]: missing.md', ['missing.md']], [' >[r]: missing.md', ['missing.md']], ['   >[r]: missing.md', ['missing.md']],
    ['>> [r]: missing.md', ['missing.md']], ['>>[r]: missing.md', ['missing.md']], ['> >[r]: missing.md', ['missing.md']],
    ['>[r]: missing.md "title"', ['missing.md']], ['>[r]: <missing file.md>', ['missing file.md']], ['[foo\\]bar]: missing.md', ['missing.md']],
    ['> [foo\\]bar]: missing.md', ['missing.md']], ['[a\\]b]: gone.md', ['gone.md']], ['>[a\\]b]: gone.md', ['gone.md']]] as [string, string[]][])
    assert.deepEqual(brokenLinksIn('docs/a.md', t, none), e, t);

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

test('حارسُ الروابط: الوجهةُ تُمسح لا تُطابَق — أقواسٌ مهرَّبةٌ وتداخلٌ بلا سقفٍ ثابتٍ وزاويةٌ مهرَّبة (الجلسة 6 · DOC_LINK_GUARD_FOUR_LEVEL_PAREN_DESTINATION_BYPASS · DOC_LINK_GUARD_NESTING_ABOVE_THREE_BYPASS · DOC_LINK_GUARD_ESCAPED_PAREN_DESTINATION_BYPASS · DOC_LINK_GUARD_POINTY_ESCAPE_BYPASS)', () => {
  const none = (): boolean => false;
  // مسابيرُ الجلسة 6 بحرفها — كانت كلُّها []
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b(c(d(e)))).md)', none), ['a(b(c(d(e)))).md']); // gpt: أربعة
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b(c(d(e(f))))).md)', none), ['a(b(c(d(e(f))))).md']); // grok: خمسة
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo\\(bar\\).md)', none), ['foo\\(bar\\).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo\\(bar.md)', none), ['foo\\(bar.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo\\)bar.md)', none), ['foo\\)bar.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](<foo\\> bar.md>)', none), ['foo\\> bar.md']); // gemini
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: <foo\\> bar.md>', none), ['foo\\> bar.md']); // gemini: التعريف
  // أمثلةُ CommonMark 0.31.2 (495 · 498 · 500) وصورةٌ وعنوانٌ وسطرٌ مختلط
  assert.deepEqual(brokenLinksIn('docs/a.md', '[link](\\(foo\\))', none), ['\\(foo\\)']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[link](foo\\(and\\(bar\\))', none), ['foo\\(and\\(bar\\)']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[link](foo\\)\\:)', none), ['foo\\)\\:']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '![alt](missing\\(file\\).md "t")', none), ['missing\\(file\\).md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[a](ok.md) و[b](x(y(z(w))).md \'t\') و[c](<p\\>q.md>)', (p) => p === 'docs/ok.md'),
    ['x(y(z(w))).md', 'p\\>q.md']);
  // سقفُ cmark-gfm: 32 مستوى رابطٌ يُقاس، و33 ليس رابطًا في عارضِ GitHub
  const nest = (n: number): string => `${'('.repeat(n)}z${')'.repeat(n)}.md`;
  assert.deepEqual(brokenLinksIn('docs/a.md', `[x](${nest(32)})`, none), [nest(32)]);
  assert.deepEqual(brokenLinksIn('docs/a.md', `[x](${nest(33)})`, none), []);
  // الوجهةُ تُفكّ قبل قياسِ وجودها: التهريبُ ومراجعُ المحارف
  const seen: string[] = [];
  // (الجلسة 112 تابع: التعريفُ يُفصل بسطرٍ فارغ — التعريفُ لا يقطعُ فقرةً §4.7، وكان الحارسُ القديمُ يبلّغ عنه زيادةً؛ قِيس المرجعُ: refmap {})
  brokenLinksIn('docs/a.md', '[a](foo\\(bar\\).md) [b](<x\\> y.md>) [c](a&amp;b.md) [d](&#x6d;e.md)\n\n[r]: <p\\>q.md>', (p) => { seen.push(p); return true; });
  assert.deepEqual(seen, ['docs/foo(bar).md', 'docs/x> y.md', 'docs/a&b.md', 'docs/me.md', 'docs/p>q.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[a](ok.md)\n[r]: <p\\>q.md>', (p) => p === 'docs/ok.md'), []);
  // سالبةُ الضبط: ما ليس رابطًا في CommonMark لا يُبلَّغ — قوسٌ لا يتوازن · فراغٌ في وجهةٍ عارية · زاويةٌ لا تُغلق
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b.md) [y](foo bar.md) [z](<a.md)', none), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](a(b(c(d(e)))).md) [y](foo\\(bar\\).md)', () => true), []);
});

test('حارسُ الروابط: الوجهةُ تُحصر تحت جذر المستودع ولا يُقاسُ وجودُها على المضيف — والرابطُ من الجذرِ يُنسبُ إليه وكسرُ CRLF لا يُعمي (الجلسة 10 · DOC_LINK_GUARD_PARENT_ESCAPE_BYPASS · DOC_LINK_GUARD_TRAVERSAL_HOST_EXISTS_BYPASS · DOC_LINK_GUARD_ROOT_ABSOLUTE_FALSE_REJECT · DOC_LINK_GUARD_CRLF_DESTINATION_BYPASS)', () => {
  const none = (): boolean => false;
  // exists تقول «موجود» لكل مسار — فالحارسَ هنا هو الحصرُ تحت الجذر لا قرصُ المضيف
  const all = (): boolean => true;
  // الخروجُ من الجذر يُبلَّغ ولو وُجد الملفُ على المضيف (مسابير gpt وgrok بحرفها)
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](../../../../../../../../etc/passwd)', all), ['../../../../../../../../etc/passwd']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](%2e%2e/%2e%2e/etc/passwd)', all), ['%2e%2e/%2e%2e/etc/passwd']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](foo/../../../../../../../../etc/passwd)', all), ['foo/../../../../../../../../etc/passwd']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](../../W-2026-064-package.md)', all), ['../../W-2026-064-package.md']);
  assert.deepEqual(brokenLinksIn('README.md', '[x](../outside.md)', all), ['../outside.md']);
  // سالبةُ الضبط: السليمُ داخل الجذر لا يُبلَّغ
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](../README.md) [y](b.md)', all), []);
  // الرابطُ الذي يبدأُ بـ/ يُنسبُ إلى جذرِ المستودعِ كما يعرضُه GitHub — لا من مجلدِ الملف
  const rootOnly = (p: string): boolean => p === '/README.md' || p === 'README.md';
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](/README.md)', rootOnly), []);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](/missing.md)', rootOnly), ['/missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[r]: /README.md', rootOnly), []);
  // كسرُ السطر CRLF قبل الوجهةِ لا يُعمي الحارسَ (مسبار gemini بحرفه)
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](\r\nmissing.md)', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](\r\n<missing.md>)', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](\nmissing.md)', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](\rmissing.md)', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', '[x](\r\nmissing.md)', () => true), []);
});

test('حارسُ الروابط: مسابيرُ الجلسة 18 بحرفها — أسبقيّةُ الشفرةِ والزوايا وسورٌ معلوماتُه بعلامةِ شفرة وكتلُ script والعناوينُ والحاويات (الجلسة 112 تابع · العيوبُ الستّة)', () => {
  const eq = (t: string, expected: string[]): void => assert.deepEqual(brokenLinksIn('docs/a.md', t, none), expected, JSON.stringify(t));
  // تفويتاتٌ ثلاث (المرجعُ commonmark@0.31.2 يرى الرابط): الرابطُ التلقائيُّ وHTML الخامُّ بأسبقيّةِ الشفرة (§6.1)
  eq('<https://example.com/`x> [x](missing.md) `', ['missing.md']);
  eq('<a href="`"> [x](missing.md) `', ['missing.md']);
  eq('```js `not\n[x](missing.md)\n```', ['missing.md']); // علامةُ شفرةٍ في سطرِ المعلومات ⇒ ليس سورًا (§4.5)
  eq('<script></script>\n[x](missing.md)', ['missing.md']); // كتلةُ script تُغلق في سطرِ فتحها (§4.6)
  // بلاغاتٌ زائدةٌ (المرجعُ لا يرى رابطًا)
  eq('<script>\n\n[x](missing.md)\n</script>', []); // السطرُ الفارغُ لا يُنهي كتلةَ النوع 1
  eq('`open\n# `[x](missing.md)`', []); // العنوانُ كتلةٌ والشفرةُ فيه تامّة
  for (const t of ['- item\n`open\n===\n[x](missing.md) `', '- item\n`\n===\n[x](missing.md) `', '1. it\n`open\n===\n[x](missing.md) `',
    '1. it\n`\n===\n[x](missing.md) `', '> q\n`open\n> q\n[x](missing.md) `', '> q\n`open\n===\n[x](missing.md) `',
    '> q\n`\n> q\n[x](missing.md) `', '> q\n`\n===\n[x](missing.md) `']) eq(t, []); // الحاوياتُ الثماني: الاستمرارُ الكسولُ يُبقي الفقرةَ فتلتئمُ الشفرة
  // ضوابط: بلا حاويةٍ `===` عنوانٌ سطريٌّ يُنهي الفقرة · الشفرةُ المزاحةُ نصٌّ · لا رابطَ داخلَ رابطٍ والصورةُ تحتمله
  eq('`open\n===\n[x](missing.md) `', ['missing.md']);
  eq('    [x](missing.md)', []);
  eq('[[x](missing.md)](gone.md)', ['missing.md']);
  eq('![[x](missing.md)](gone.md)', ['missing.md', 'gone.md']);
});
