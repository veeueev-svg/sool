#!/usr/bin/env node
/**
 * scripts/doc_links_differential.mjs — القياسُ التفاضليُّ لحارس الروابط مقابل المحرّك المرجعي (المرحلة 40 · البند W-2026-064 · الجلسة 112 تابع)
 * المالك: القيّم على المستودع
 * المدخلات: `dist/tests/governance/markdown_blocks.js` (بعد `npm run build`) · commonmark@0.31.2 **مثبّتًا خارجَ المستودع**
 *   في مجلدٍ يُسمّى بـ`CM_DIR` (فيه `node_modules/commonmark` و`entities` و`mdurl` — تبعيّاتُه هو)
 * المخرجات: سطرُ JSON لكلِّ عائلة (الحالات · الفروق · الحالاتُ ذاتُ الروابط) وأوّلُ الفروق بحرفها؛ رمزُ خروجٍ 1 عند أيِّ فرق
 * التبعيات: `node:module` · `node:fs` · `node:path` · `node:url` · `node:child_process` — والمحرّكُ المرجعيُّ من `CM_DIR` وحدَه
 * الصلاحيات (RULE-004): يقرأ ولا يكتب · السجلات: لا شيء
 * حالات الفشل المُغطّاة: `CM_DIR` غائبٌ أو إصدارٌ غيرُ 0.31.2 ⇒ رمزٌ 2 (لا قياسَ على مرجعٍ غيرِ المعلن)
 * اختبار القبول: `npm run build && CM_DIR=<مجلد> node scripts/doc_links_differential.mjs` ⇒ كلُّ العائلات `diffs: 0`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * ثوابتُ هذه الأداة:
 * 1) **المرجعُ أداةُ قياسٍ لا تبعيّة** (ADR-0001): لا يدخل `package.json` ولا `npm test`؛ من شاء الإعادةَ ثبّته حيث شاء.
 * 2) **حتميّة:** مولّدٌ مبذورٌ (mulberry32) — البذرةُ نفسُها تُعيد الحالاتِ نفسَها حرفًا.
 * 3) **ما يُقارَن:** عددُ الروابطِ والصورِ إلى `missing.md` (مباشرةً أو بمرجعٍ مستعمَل) وعددُ التعريفاتِ إلى `def.md`؛
 *    وفي الوثائق الحقيقيّة: كلُّ وجهةٍ بلا مخطّط (ما يقيسه الحارس) بعد التطبيع نفسِه (فكُّ التهريبِ والمراجعِ ثمّ ترميزُ mdurl).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CM_DIR = process.env.CM_DIR;
if (!CM_DIR) { console.error('CM_DIR غائب: مجلدٌ ثُبّت فيه commonmark@0.31.2 (npm install commonmark@0.31.2)'); process.exit(2); }
const req = createRequire(join(CM_DIR, 'noop.js'));
const version = JSON.parse(readFileSync(join(dirname(req.resolve('commonmark')), '..', 'package.json'), 'utf8')).version;
if (version !== '0.31.2') { console.error(`المرجعُ المعلن commonmark@0.31.2 — والمثبَّت ${version}`); process.exit(2); }
const cm = req('commonmark');
const { decodeHTMLStrict } = await import(pathToFileURL(req.resolve('entities')).href);
const encode = (await import(pathToFileURL(join(dirname(req.resolve('mdurl')), 'encode.mjs')).href).catch(() => null))?.default
  ?? (await import(pathToFileURL(join(CM_DIR, 'node_modules', 'mdurl', 'encode.js')).href)).default;
const { markdownLinks } = createRequire(import.meta.url)(join(ROOT, 'dist', 'tests', 'governance', 'markdown_blocks.js'));

const reference = (t) => {
  const p = new cm.Parser(); const w = p.parse(t).walker(); const dests = []; let ev;
  while ((ev = w.next())) if (ev.entering && (ev.node.type === 'link' || ev.node.type === 'image')) dests.push(ev.node.destination);
  return { dests, defs: Object.values(p.refmap).map((r) => r.destination) };
};
const count = (xs, v) => xs.filter((x) => x === v).length;
const ESC = new RegExp("\\\\[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]|&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});", 'gi');
const norm = (s) => { const u = s.replace(ESC, (m) => (m[0] === '\\' ? m[1] : decodeHTMLStrict(m))); try { return encode(u); } catch { return u; } };

let seed = Number(process.env.SEED ?? 20261013) >>> 0;
const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const FAMILIES = {
  structured: ['`', '``', '```', '~~~', '\n', '\n', '\n\n', ' ', '  ', '    ', '\t', '[x](missing.md)', '![i](missing.md)', '[r]: def.md', '[r]', '[x][r]', '[', '](', ']', '(', ')',
    '<', '>', '#', '# ', '- ', '* ', '+ ', '1. ', '2) ', '> ', '>', '===', '---', '***', '___', '<script>', '</script>', '<pre>', '</pre>', '<!--', '-->', '<?', '?>', '<!X',
    '<![CDATA[', ']]>', '<div>', '</div>', '<a href="x">', '<span>', '\\', '\\`', 'a', '"t"', "'t'", '(t)', '<https://e.com/', '<missing.md>', '<a@b.c>', '&amp;', '*', '_',
    ':', '!', 'missing.md', 'def.md', 'missing.md)', '\r\n', '\r', '[x]: <def.md>', '  [r]:\n def.md'],
  mixed: ['[x](missing.md)', '](missing.md)', '](missing.md "t")', '](<missing.md>)', '[r]: def.md', '[r]:', '\n[r]: def.md\n', '[r]', '[x][r]', '[r][]', '`', '`', '[', ']',
    '(', ')', '<', '>', '!', '\\', ' ', ' ', '\n', '\n', '\t', '-', '*', '#', '=', '_', '~', ':', '"', "'", 'x', '1', '.', '/', '&', 'missing.md', 'def.md', 'script', 'pre', '!--', '?', 'a href'],
  containers: ['[x](missing.md)', '[r]: def.md', '[r]', '\n', '\n', '\n', '\t', ' ', '  ', '   ', '    ', '- ', '-', '* ', '1. ', '1)', '10. ', '> ', '>', '`', '```', '~~~', '===', '---',
    '# ', '<div>', '<script>', '</script>', '<!--', '-->', 'x', '[x]:\n  def.md', '"t"', '\\'],
};
const N = Number(process.env.CASES ?? 200000), L = Number(process.env.MAXLEN ?? 24);
let failed = false;
for (const [name, alphabet] of Object.entries(FAMILIES)) {
  let diffs = 0, withLinks = 0; const shown = [];
  for (let n = 0; n < N; n++) {
    let t = ''; for (let k = 1 + Math.floor(rnd() * L); k > 0; k--) t += pick(alphabet);
    const a = reference(t), m = markdownLinks(t);
    const ai = count(a.dests, 'missing.md'), bi = count(m.inline, 'missing.md') + count(m.resolved, 'missing.md');
    const ad = count(a.defs, 'def.md'), bd = count(m.definitions, 'def.md');
    if (ai) withLinks++;
    if (ai !== bi || ad !== bd) { diffs++; if (shown.length < 10) shown.push({ t, reference: [ai, ad], guard: [bi, bd] }); }
  }
  console.log(JSON.stringify({ family: name, cases: N, diffs, withLinks, shown }));
  failed ||= diffs > 0;
}
const files = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
let corpusDiffs = 0, links = 0; const shown = [];
for (const f of files) {
  const t = readFileSync(join(ROOT, f), 'utf8'); const a = reference(t), m = markdownLinks(t);
  // ما يقيسه الحارس: الوجهاتُ بلا مخطّط (الروابطُ التلقائيّةُ ذاتُ مخطّطٍ دائمًا فتخرج من الطرفين معًا)
  const rel = (xs) => JSON.stringify(xs.filter((d) => !SCHEME.test(d)).sort());
  const sa = rel(a.dests), sb = rel([...m.inline, ...m.resolved].map(norm));
  const da = rel(a.defs), db = rel(m.definitions.map(norm));
  links += a.dests.filter((d) => !SCHEME.test(d)).length;
  if (sa !== sb || da !== db) { corpusDiffs++; if (shown.length < 5) shown.push(f); }
}
console.log(JSON.stringify({ family: 'corpus', files: files.length, links, diffs: corpusDiffs, shown }));
process.exit(failed || corpusDiffs > 0 ? 1 : 0);
