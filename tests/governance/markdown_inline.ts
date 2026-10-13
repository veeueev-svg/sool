/**
 * tests/governance/markdown_inline.ts — ماسحُ الروابطِ المضمّنةِ لحارس الروابط (المرحلة 40 · البند W-2026-064 · الجلسة 112 تابع)
 * المالك: القيّم على المستودع
 * المدخلات: نصُّ كتلةٍ ورقيّة (فقرةٍ أو عنوان) بعد تحليل الكتل · خريطةُ التعريفات المرجعية
 * المخرجات: وجهاتُ الروابطِ والصورِ المكتوبةِ مباشرةً `](…)` كما كُتبت (قبل الفكّ)، وتعريفاتُ المراجع
 * التبعيات: لا شيء (ADR-0001) · الصلاحيات (RULE-004): لا يقرأ ولا يكتب · السجلات: لا شيء
 * حالات الفشل المُغطّاة: الشفرةُ المضمّنة والروابطُ التلقائيّة وHTML الخامّ بأسبقيّةٍ واحدة (§6.1 · §6.5 · §6.6)
 *   · لا رابطَ داخلَ رابط (§6.3) · الوسمُ المرجعيُّ الكامل والمطويُّ والمختصر (§6.3 · §4.7)
 * اختبار القبول: `tests/governance/doc_links.test.ts`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * **نقلٌ لا محاكاة:** هذا الملفُّ نقلٌ حرفيُّ الخوارزمية لـ`lib/inlines.js` من commonmark.js 0.31.2
 * (المحرّكُ المرجعيُّ الذي قاس به مجلسُ المراجعة الجلساتِ 16–18) — مقصورٌ على ما يقرّر وجودَ الرابط:
 * علاماتُ الشفرة والتهريبُ والزوايا والأقواسُ المربّعة. والتوكيدُ (`*` `_`) لا يُقرّر رابطًا ولا يمنعه
 * (يُعالَج بعد الأقواس داخلَ نصِّ الرابط) فأُسقط. والانحرافُ المعلنُ الوحيد: سقفُ تداخلِ الأقواس 32 في
 * الوجهة العارية كما في cmark-gfm (عارضُ GitHub) — commonmark.js بلا سقف.
 * حقوقُ الخوارزمية الأصلية: Copyright (c) 2014, John MacFarlane — رخصة BSD-2-Clause (يُحفظ هذا الإشعار).
 */

const ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";
const ESCAPED_CHAR = '\\\\' + ESCAPABLE;
const TAGNAME = '[A-Za-z][A-Za-z0-9-]*';
const ATTRIBUTENAME = '[a-zA-Z_:][a-zA-Z0-9:._-]*';
const UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
const ATTRIBUTEVALUE = '(?:' + UNQUOTEDVALUE + "|'[^']*'" + '|"[^"]*"' + ')';
const ATTRIBUTEVALUESPEC = '(?:\\s*=\\s*' + ATTRIBUTEVALUE + ')';
const ATTRIBUTE = '(?:\\s+' + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + '?)';
export const OPENTAG = '<' + TAGNAME + ATTRIBUTE + '*\\s*/?>';
export const CLOSETAG = '</' + TAGNAME + '\\s*[>]';
const HTMLTAG = '(?:' + OPENTAG + '|' + CLOSETAG + '|<!-->|<!--->|<!--[\\s\\S]*?-->' + '|[<][?][\\s\\S]*?[?][>]'
  + '|<![A-Za-z]+[^>]*>' + '|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>' + ')';
const reHtmlTag = new RegExp('^' + HTMLTAG);
const reLinkTitle = new RegExp('^(?:"(' + ESCAPED_CHAR + '|\\\\[^\\\\]' + '|[^\\\\"\\x00])*"' + '|' + "'(" + ESCAPED_CHAR
  + '|\\\\[^\\\\]' + "|[^\\\\'\\x00])*'" + '|' + '\\((' + ESCAPED_CHAR + '|\\\\[^\\\\]' + '|[^\\\\()\\x00])*\\))');
const reLinkDestinationBraces = /^(?:<(?:[^<>\n\\\x00]|\\.)*>)/;
const reEscapable = new RegExp('^' + ESCAPABLE);
const reTicks = /`+/;
const reTicksHere = /^`+/;
const reEmailAutolink = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/;
const reAutolink = /^<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>\x00-\x20]*>/i;
const reSpnl = /^ *(?:\n *)?/;
const reWhitespaceChar = /^[ \t\n\x0b\x0c\x0d]/;
const reInitialSpace = /^ */;
const reSpaceAtEndOfLine = /^ *(?:\n|$)/;
const reLinkLabel = /^\[(?:[^\\[\]]|\\.){0,1000}\]/s;
/** سقفُ cmark-gfm لتداخل الأقواس في الوجهة العارية (الانحرافُ المعلنُ الوحيد عن commonmark.js). */
const MAX_PAREN_DEPTH = 32;

/** تطبيعُ الوسم كما في commonmark.js: نزعُ الأقواس · قصٌّ · طيُّ الفراغ · طيُّ الحالة. */
export function normalizeReference(label: string): string {
  return label.slice(1, label.length - 1).trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase().toUpperCase();
}

/** تعريفاتُ المراجع: الوسمُ المطبَّع ⇒ الوجهةُ كما كُتبت. الأوّلُ يغلب (§4.7). */
export type RefMap = Map<string, string>;

interface Bracket { index: number; image: boolean; active: boolean; bracketAfter: boolean; previous: Bracket | null }

export class InlineScanner {
  private subject = '';
  private pos = 0;
  private brackets: Bracket | null = null;

  private match(re: RegExp): string | null {
    const m = re.exec(this.subject.slice(this.pos));
    if (m === null) return null;
    this.pos += m.index + m[0].length;
    return m[0];
  }
  private peek(): number { return this.pos < this.subject.length ? this.subject.charCodeAt(this.pos) : -1; }
  private spnl(): true { this.match(reSpnl); return true; }

  /** يقرأ الوجهةَ ويُعيدها **كما كُتبت** (بلا زوايا) — أو null إن لم تكن وجهة. */
  private parseLinkDestination(): string | null {
    const res = this.match(reLinkDestinationBraces);
    if (res !== null) return res.slice(1, -1);
    if (this.peek() === 60) return null;
    const savepos = this.pos;
    let openparens = 0;
    let c = -1;
    while ((c = this.peek()) !== -1) {
      if (c === 92 && reEscapable.test(this.subject.charAt(this.pos + 1))) {
        this.pos += 1;
        if (this.peek() !== -1) this.pos += 1;
      } else if (c === 40) {
        this.pos += 1;
        openparens += 1;
        if (openparens > MAX_PAREN_DEPTH) return null;
      } else if (c === 41) {
        if (openparens < 1) break;
        this.pos += 1;
        openparens -= 1;
      } else if (reWhitespaceChar.exec(String.fromCodePoint(c)) !== null) {
        break;
      } else {
        this.pos += 1;
      }
    }
    if (this.pos === savepos && c !== 41) return null;
    if (openparens !== 0) return null;
    return this.subject.slice(savepos, this.pos);
  }
  private parseLinkTitle(): string | null { return this.match(reLinkTitle); }
  private parseLinkLabel(): number {
    const m = this.match(reLinkLabel);
    return m === null || m.length > 1001 ? 0 : m.length;
  }
  private addBracket(index: number, image: boolean): void {
    if (this.brackets !== null) this.brackets.bracketAfter = true;
    this.brackets = { index, image, active: true, bracketAfter: false, previous: this.brackets };
  }
  private removeBracket(): void { this.brackets = this.brackets?.previous ?? null; }

  private parseBackticks(): void {
    const ticks = this.match(reTicksHere);
    if (ticks === null) return;
    const afterOpenTicks = this.pos;
    let matched: string | null;
    while ((matched = this.match(reTicks)) !== null) if (matched === ticks) return; // شفرةٌ تُسقَط
    this.pos = afterOpenTicks; // بلا مقابلٍ ⇒ حرفيّة
  }
  private parseCloseBracket(refs: RefMap, out: string[], resolved: string[]): void {
    this.pos += 1;
    const startpos = this.pos;
    let opener = this.brackets;
    if (opener === null) return;
    if (!opener.active) { this.removeBracket(); return; }
    const isImage = opener.image;
    const savepos = this.pos;
    let matched = false;
    if (this.peek() === 40) {
      this.pos += 1;
      let dest: string | null = null;
      if (this.spnl() && (dest = this.parseLinkDestination()) !== null && this.spnl()
        && ((reWhitespaceChar.test(this.subject.charAt(this.pos - 1)) && this.parseLinkTitle() !== null) || true)
        && this.spnl() && this.peek() === 41) {
        this.pos += 1;
        matched = true;
        out.push(dest);
      } else {
        this.pos = savepos;
      }
    }
    if (!matched) {
      const beforelabel = this.pos;
      const n = this.parseLinkLabel();
      let reflabel: string | undefined;
      if (n > 2) reflabel = this.subject.slice(beforelabel, beforelabel + n);
      else if (!opener.bracketAfter) reflabel = this.subject.slice(opener.index, startpos);
      if (n === 0) this.pos = savepos;
      // التعريفُ المستعمَلُ يُقاس مرّةً واحدةً من خريطة التعريفات؛ ويُسجَّل استعمالُه للقياس التفاضليّ وحدَه
      const target = reflabel ? refs.get(normalizeReference(reflabel)) : undefined;
      if (target !== undefined) { matched = true; resolved.push(target); }
    }
    if (matched) {
      this.removeBracket();
      if (!isImage) for (opener = this.brackets; opener !== null; opener = opener.previous) if (!opener.image) opener.active = false;
    } else {
      this.removeBracket();
      this.pos = startpos;
    }
  }

  /** وجهاتُ الروابطِ المباشرةِ في نصِّ كتلةٍ ورقيّة (`parseInlines` في commonmark.js). */
  scan(content: string, refs: RefMap, out: string[], resolved: string[]): void {
    this.subject = content.trim();
    this.pos = 0;
    this.brackets = null;
    while (this.pos < this.subject.length) {
      const c = this.subject.charCodeAt(this.pos);
      if (c === 10) { this.pos += 1; this.match(reInitialSpace); }
      else if (c === 92) {
        this.pos += 1;
        if (this.peek() === 10 || reEscapable.test(this.subject.charAt(this.pos))) this.pos += 1;
      } else if (c === 96) this.parseBackticks();
      else if (c === 91) { this.addBracket(this.pos, false); this.pos += 1; }
      else if (c === 33) {
        this.pos += 1;
        if (this.peek() === 91) { this.addBracket(this.pos, true); this.pos += 1; }
      } else if (c === 93) this.parseCloseBracket(refs, out, resolved);
      else if (c === 60) {
        if (this.match(reEmailAutolink) === null && this.match(reAutolink) === null && this.match(reHtmlTag) === null) this.pos += 1;
      } else this.pos += 1;
    }
  }

  /** تعريفٌ مرجعيٌّ في أوّل `s` (`parseReference` في commonmark.js): طولُ ما استُهلك أو 0. */
  parseReference(s: string, refs: RefMap): number {
    this.subject = s;
    this.pos = 0;
    const startpos = 0;
    const matchChars = this.parseLinkLabel();
    if (matchChars === 0) return 0;
    const rawlabel = this.subject.slice(0, matchChars);
    if (this.peek() === 58) this.pos += 1;
    else { this.pos = startpos; return 0; }
    this.spnl();
    const dest = this.parseLinkDestination();
    if (dest === null) { this.pos = startpos; return 0; }
    const beforetitle = this.pos;
    this.spnl();
    let title: string | null | undefined;
    if (this.pos !== beforetitle) title = this.parseLinkTitle();
    if (title === null) this.pos = beforetitle;
    let atLineEnd = true;
    if (this.match(reSpaceAtEndOfLine) === null) {
      if (title === null) atLineEnd = false;
      else {
        title = null;
        this.pos = beforetitle;
        atLineEnd = this.match(reSpaceAtEndOfLine) !== null;
      }
    }
    if (!atLineEnd) { this.pos = startpos; return 0; }
    const normlabel = normalizeReference(rawlabel);
    if (normlabel === '') { this.pos = startpos; return 0; }
    if (!refs.has(normlabel)) refs.set(normlabel, dest);
    return this.pos - startpos;
  }
}
