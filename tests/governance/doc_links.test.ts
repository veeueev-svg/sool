/**
 * tests/governance/doc_links.test.ts — حارسُ الروابط النسبيّة في الوثائق (المرحلة 40، البند W-2026-064)
 * المالك: القيّم على المستودع
 * المدخلات: كلُّ ملفِّ Markdown متتبَّعٍ في git
 * المخرجات: تأكيدٌ أنّ كلَّ رابطٍ نسبيٍّ يصل إلى ملفٍّ موجود
 * التبعيات: `node:child_process` · `node:fs` · `node:path` · الصلاحيات (RULE-004): يقرأ ولا يكتب · السجلات: لا شيء
 * حالات الفشل المُغطّاة: ملفٌّ نُقل (`config/module_limits.yaml` ⇒ `scripts/limits/`) · جذرٌ غيرُ مجلدِ الملف · ملفٌّ لم يوجد قطّ
 * اختبار القبول: هذا الملف نفسه — `npm test`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * ثوابت هذا الملف:
 *
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
 * ماسحُ الشفرةِ المضمّنةِ (الجلسة 16 · CommonMark 0.31.2 §6.1): سطرًا سطرًا. خارجَ الشفرةِ `\\`
 * تأكلُ ما بعدها — فالعلامةُ المهرَّبةُ لا delimiterٌ؛ وداخلَها لا تُعالَجُ الشرطةُ.
 */
export function removeInlineCode(text: string): string {
  return text.split('\n').map(removeInlineCodeLine).join('\n');
}
function removeInlineCodeLine(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '\\') { out += line.slice(i, i + 2); i += 2; continue; } // تهريب
    if (line[i] === '`') {
      let j = i; while (line[j] === '`') j++;
      const run = line.slice(i, j);
      let k = j, close = -1;
      while (k < line.length) {
        if (line[k] === '`') {
          let m = k; while (line[m] === '`') m++;
          if (m - k === run.length) { close = k; k = m; break; }
          k = m;
        } else k++;
      }
      if (close >= 0) { i = k; continue; } // الشفرةُ تُسقَطُ
      out += run; i = j; continue; // بلا مقابلٍ ⇒ حرفيّةٌ
    }
    out += line[i]; i++;
  }
  return out;
}

/**
 * يُزيل الشفرةَ المسوّرةَ والمضمّنة: ما بين علامات الشفرة نصٌّ لا رابط (كما يعرضه GitHub).
 * (الجلسة 16 · DOC_LINK_GUARD_ESCAPED_BACKTICK_STRIP_BYPASS: backtick المهرَّب محرفٌ حرفيٌّ
 *  في CommonMark 0.31.2 §2.4/§6.1 لا حدَّ شفرة — يعالجُه الماسحُ `removeInlineCode` بالسياق:
 *  خارجَ الشفرةِ محرفٌ، وداخلَها delimiterٌ — لا باستبدالٍ عالميٍّ قبل معرفةِ السياق.)
 */
export function stripCode(text: string): string {
  return removeInlineCode(text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ''));
}

/**
 * شفرةُ العنوان كما يعرفُها CommonMark: "…" أو '…' أو (…) — بعد فراغٍ بعد الوجهة، والتهريبُ حرفٌ منه.
 * (الجلسة 2 · REFERENCE_STYLE_BYPASS · الجلسة 3 · TITLE_ESCAPE_BYPASS)
 */
const TITLE = String.raw`(?:\s+(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\((?:[^()\\]|\\[\s\S])*\)))?`;
/**
 * الروابطُ المباشرة: `](وجهة …)` — **ماسحٌ لا نمط** (الجلسة 6: الأنماطُ عَمِيت عن الأعمقِ والمهرَّب جلستين).
 * الوجهةُ تُقرأ حرفًا حرفًا بقواعد §6.3:
 *   - بعدها عنوانٌ اختياريٌّ (`TITLE`) ثمّ `)` — وإلّا فليس رابطًا.
 * والوجهةُ تُفكّ قبل قياسِ وجودِها كما يفكّها العارض: التهريبُ بالشرطة المائلة ثمّ مراجعُ المحارف
 * الرقميّةُ والخمسُ المسمّاةُ (`&amp;` `&lt;` `&gt;` `&quot;` `&apos;`) ثمّ ترميزُ النسبة.
 * **الحدُّ المعلن:** سائرُ المراجعِ المسمّاة (`&copy;` …) تُقاس كما كُتبت — فيُبلَّغ عنها إنذارٌ زائدٌ
 * يُرى، ولا تعمى إلّا إن وُجد ملفٌّ اسمُه المرجعُ نفسُه حرفًا.
 */
const MAX_PAREN_DEPTH = 32;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const TITLE_TAIL = new RegExp(String.raw`\s*` + TITLE + String.raw`\s*\)`, 'y');

/** يقرأ وجهةَ رابطٍ مباشرٍ يبدأ عند `start` (بعد `](`) — أو null إن لم يكن رابطًا في CommonMark. */
export function scanInlineDestination(text: string, start: number): string | null {
  let i = start;
  // فراغُ CommonMark كاملًا (CRLF قبل الوجهة لا يُعمي — الجلسة 10 · CRLF_DESTINATION_BYPASS)
  while (i < text.length && /[ \t\n\v\f\r]/.test(text[i]!)) i += 1;
  let dest: string;
  if (text[i] === '<') {
    let j = i + 1;
    for (; j < text.length; j += 1) {
      const c = text[j]!;
      if (c === '\\' && j + 1 < text.length && ASCII_PUNCT.test(text[j + 1]!)) { j += 1; continue; }
      if (c === '>' || c === '<' || c === '\n' || c === '\r') break;
    }
    if (text[j] !== '>') return null;
    dest = text.slice(i + 1, j);
    i = j + 1;
  } else {
    let j = i;
    let depth = 0;
    for (; j < text.length; j += 1) {
      const c = text[j]!;
      if (c === '\\' && j + 1 < text.length && ASCII_PUNCT.test(text[j + 1]!)) { j += 1; continue; }
      if (c.charCodeAt(0) <= 0x20 || c.charCodeAt(0) === 0x7f) break;
      if (c === '(') { depth += 1; if (depth > MAX_PAREN_DEPTH) return null; continue; }
      if (c === ')') { if (depth === 0) break; depth -= 1; }
    }
    if (depth !== 0) return null;
    dest = text.slice(i, j);
    i = j;
  }
  TITLE_TAIL.lastIndex = i;
  return TITLE_TAIL.test(text) ? dest : null;
}

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** فكُّ الوجهة كما يفكّها العارض: تهريبٌ ثمّ مراجعُ محارف (CommonMark §2.4 · §2.5) */
export function unescapeDestination(raw: string): string {
  return raw
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (m: string, dec?: string, hex?: string, name?: string) => {
      if (name !== undefined) return NAMED[name] ?? m;
      const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex ?? '', 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\uFFFD';
    });
}

/**
 * تعريفاتُ الروابط المرجعية: [وسم]: وجهة — في أوّل السطر أو بعد بادئةِ حاوية (اقتباسٍ أو قائمة).
 * (الجلسة 3 · CONTAINER_BYPASS · الجلسة 4 · BLOCKQUOTE_NOSPACE_BYPASS: `>` لا يلزمه فراغٌ بعده — §5.1.)
 */
const CONTAINER = String.raw`(?:[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$))[ \t]?)*[ \t]*`;
/**
 * الوسم: ينتهي عند أوّلِ `]` **غيرِ مهرَّب** — فالتهريبُ بالشرطة المائلة حرفٌ منه لا خاتمةٌ له.
 * (الجلسة 4 · DOC_LINK_GUARD_ESCAPED_LABEL_BYPASS: `[foo\]bar]:` كان يقف عند أوّلِ `]` فيفلت التعريف.)
 */
const LABEL = String.raw`\[(?:[^\]\\]|\\[\s\S])+\]`;
/** وجهةُ التعريفِ الزاويّة: التهريبُ حرفٌ منها (`\>` لا يُغلقها) — الجلسة 6 · DOC_LINK_GUARD_POINTY_ESCAPE_BYPASS */
const REFERENCE_DEF = new RegExp(String.raw`^` + CONTAINER + LABEL + String.raw`:\s*(?:<((?:[^<>\\\n]|\\[\s\S])*)>|(\S+))`, 'gm');

/** الروابطُ النسبيّةُ المكسورة في نصٍّ موضعُه `file` — بلا مخرجٍ إلّا المخطّطَ (URI) والمرساةَ الخالصة. */
export function brokenLinksIn(file: string, text: string, exists: (p: string) => boolean): string[] {
  const base = ROOT_RELATIVE.has(file) ? '' : dirname(file);
  const out: string[] = [];
  const consider = (raw: string): void => {
    const link = unescapeDestination(raw).split('#')[0] ?? '';
    if (link === '' || /^[a-z][a-z0-9+.-]*:/i.test(link)) return;
    let target = link;
    try { target = decodeURIComponent(link); } catch { /* يُقاس كما كُتب */ }
    // الحصرُ تحت جذر المستودع (الجلسة 10 · DOC_LINK_GUARD_PARENT_ESCAPE_BYPASS ·
    // DOC_LINK_GUARD_TRAVERSAL_HOST_EXISTS_BYPASS): الوجهةُ النسبيّةُ التي تخرجُ من الجذرِ
    // مكسورةٌ تُبلَّغ — ولا يُقاسُ وجودُها على المضيفِ فالعرضُ يُقاسُ داخلَ الشجرةِ وحدها.
    // والرابطُ الذي يبدأُ بـ`/` يُنسبُ إلى جذرِ المستودعِ كما يعرضُه GitHub
    // (الجلسة 10 · DOC_LINK_GUARD_ROOT_ABSOLUTE_FALSE_REJECT) لا إلى مجلدِ الملف.
    const rooted = target.startsWith('/');
    const p = rooted ? normalize(target) : normalize(join(base, target));
    if (!rooted && (p === '..' || p.startsWith('../') || isAbsolute(p))) {
      out.push(raw);
      return;
    }
    if (!exists(p)) out.push(raw);
  };
  const body = stripCode(text);
  for (let at = body.indexOf(']('); at >= 0; at = body.indexOf('](', at + 2)) {
    const dest = scanInlineDestination(body, at + 2);
    if (dest !== null) consider(dest);
  }
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
test('حارسُ الروابط: backtick المهرَّبُ محرفٌ لا حدَّ شفرة — والرابطُ معه يُقاس لا يُغفَل (الجلسة 16 · DOC_LINK_GUARD_ESCAPED_BACKTICK_STRIP_BYPASS)', () => {
  // مسبرُ الجلسة 16 بحرفه (gpt) + عائلتُه:
  assert.deepEqual(brokenLinksIn('docs/a.md', 'See \\` [x](missing.md) ` end', none), ['missing.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', 'a`[x](m.md)` b \\` [y](n.md) ` c', none), ['n.md']);
  // مسابيرُ CommonMark 0.31.2 (محرّكٌ مرجعيٌّ — القياسُ في التقرير): شرطةٌ واحدةٌ تهريبٌ؛ زوجيةٌ حرفيّة.
  assert.deepEqual(brokenLinksIn('docs/a.md', 'single \\` backtick before [l1](u1.md)', none), ['u1.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', 'double \\\\` backticks [l2](u2.md)', none), ['u2.md']);
  assert.deepEqual(brokenLinksIn('docs/a.md', 'text \\\\\\` [l5](u5.md) and `span` [l6](u6.md)', none), ['u5.md', 'u6.md']);
  // شرطةٌ داخلَ شفرةٍ محصَّنة (مِن روابطِ المُشغّلِ نفسِهِ): لا تُفتحُ ولا تُغلقُ شفرةً.
  assert.deepEqual(brokenLinksIn('docs/a.md', '``code with ` inside`` [l4](u4.md)', none), ['u4.md']);
  // (أ) شرطتان قبل علامةِ الفتحِ + إغلاقٌ لاحق ⇒ العلامةُ عاريةٌ تفتحُ شفرةً والرابطُ يُحجب.
  assert.deepEqual(brokenLinksIn('docs/a.md', 'See \\\\` [x](missing.md) ` end', none), []);
  // (ب) شرطةٌ واحدةٌ قبلَ علامةِ الإغلاقِ داخلَ شفرةٍ مضمّنة ⇒ delimiterٌ يغلقُها والرابطُ يُبلَّغ.
  assert.deepEqual(brokenLinksIn('docs/a.md', '`code \\` [x](missing.md) ` end', none), ['missing.md']);
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
  brokenLinksIn('docs/a.md', '[a](foo\\(bar\\).md) [b](<x\\> y.md>) [c](a&amp;b.md) [d](&#x6d;e.md)\n[r]: <p\\>q.md>', (p) => { seen.push(p); return true; });
  assert.deepEqual(seen, ['docs/foo(bar).md', 'docs/x> y.md', 'docs/a&b.md', 'docs/me.md', 'docs/p>q.md']);
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
