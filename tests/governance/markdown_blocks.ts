/**
 * tests/governance/markdown_blocks.ts — محلّلُ الكتلِ لحارس الروابط (المرحلة 40 · البند W-2026-064 · الجلسة 112 تابع)
 * المالك: القيّم على المستودع
 * المدخلات: نصُّ ملفِّ Markdown كاملًا
 * المخرجات: `markdownLinks` ⇒ وجهاتُ الروابطِ المباشرة (`inline`) ووجهاتُ التعريفاتِ المرجعية (`definitions`)
 *   كما كُتبت — بترتيبِ ظهورها، والتعريفُ الأوّلُ لكلِّ وسمٍ يغلب
 * التبعيات: `./markdown_inline` وحدَه — لا تبعيّةَ خارجيّة (ADR-0001) · الصلاحيات (RULE-004): لا يقرأ ولا يكتب
 * السجلات: لا شيء
 * حالات الفشل المُغطّاة: السورُ وعلامةُ الشفرةِ في سطرِ معلوماته (§4.5) · كتلُ HTML السبعُ وشروطُ إغلاقها (§4.6)
 *   · العنوانُ الإطاريُّ والسطريُّ (§4.2 · §4.3) · الشفرةُ المزاحة (§4.4) · الاقتباسُ والقائمةُ والاستمرارُ الكسول
 *   (§5.1–§5.3) · التبويبُ المستهلَكُ جزئيًّا (§2.2) · التعريفاتُ لا تقطع فقرة (§4.7)
 * اختبار القبول: `tests/governance/doc_links.test.ts`
 * الوثيقة المرتبطة: docs/test-reports/phase-40-W-2026-064.md
 *
 * **نقلٌ لا محاكاة:** نقلٌ حرفيُّ الخوارزمية لـ`lib/blocks.js` من commonmark.js 0.31.2 — وما لا يقرّر
 * موضعَ الرابط أُسقط: مواضعُ المصدر وضيقُ القوائم وسطرُ معلوماتِ السور ونصُّ الشفرة.
 * حقوقُ الخوارزمية الأصلية: Copyright (c) 2014, John MacFarlane — رخصة BSD-2-Clause (يُحفظ هذا الإشعار).
 */
import { CLOSETAG, InlineScanner, OPENTAG, type RefMap } from './markdown_inline';

type BlockType = 'document' | 'list' | 'block_quote' | 'item' | 'heading' | 'thematic_break' | 'code_block' | 'html_block' | 'paragraph';
interface ListData { type: 'bullet' | 'ordered'; bulletChar: string | null; delimiter: string | null; padding: number; markerOffset: number }
interface Block {
  type: BlockType; parent: Block | null; children: Block[]; open: boolean; content: string;
  list?: ListData; fenced?: boolean; fenceChar?: string; fenceLength?: number; fenceOffset?: number; htmlType?: number;
}

const reHtmlBlockOpen: readonly RegExp[] = [/./, /^<(?:script|pre|textarea|style)(?:\s|>|$)/i, /^<!--/, /^<[?]/, /^<![A-Za-z]/, /^<!\[CDATA\[/,
  /^<[/]?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|search|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|[/]?[>]|$)/i,
  new RegExp('^(?:' + OPENTAG + '|' + CLOSETAG + ')\\s*$', 'i')];
const reHtmlBlockClose: readonly RegExp[] = [/./, /<\/(?:script|pre|textarea|style)>/i, /-->/, /\?>/, />/, /\]\]>/];
const reThematicBreak = /^(?:\*[ \t]*){3,}$|^(?:_[ \t]*){3,}$|^(?:-[ \t]*){3,}$/;
const reMaybeSpecial = /^[#`~*+_=<>0-9-]/;
const reNonSpace = /[^ \t\f\v\r\n]/;
const reBulletListMarker = /^[*+-]/;
const reOrderedListMarker = /^(\d{1,9})([.)])/;
const reATXHeadingMarker = /^#{1,6}(?:[ \t]+|$)/;
const reCodeFence = /^`{3,}(?!.*`)|^~{3,}/;
const reClosingCodeFence = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;
const reSetextHeadingLine = /^(?:=+|-+)[ \t]*$/;
const CODE_INDENT = 4;
const ACCEPTS_LINES: ReadonlySet<BlockType> = new Set<BlockType>(['code_block', 'html_block', 'paragraph']);
const canContain = (parent: BlockType, child: BlockType): boolean =>
  parent === 'document' || parent === 'block_quote' || parent === 'item' ? child !== 'item' : parent === 'list' ? child === 'item' : false;
const isSpaceOrTab = (c: number): boolean => c === 32 || c === 9;
const peekAt = (ln: string, pos: number): number => (pos < ln.length ? ln.charCodeAt(pos) : -1);
const newBlock = (type: BlockType, parent: Block | null): Block => ({ type, parent, children: [], open: true, content: '' });

class BlockParser {
  readonly doc = newBlock('document', null);
  readonly refs: RefMap = new Map();
  readonly inline = new InlineScanner();
  private tip: Block = this.doc;
  private oldtip: Block = this.doc;
  private lastMatchedContainer: Block = this.doc;
  private line = '';
  private offset = 0;
  private column = 0;
  private nextNonspace = 0;
  private nextNonspaceColumn = 0;
  private indent = 0;
  private indented = false;
  private blank = false;
  private partiallyConsumedTab = false;
  private allClosed = true;

  private findNextNonspace(): void {
    let i = this.offset, cols = this.column, c = '';
    while ((c = this.line.charAt(i)) !== '') {
      if (c === ' ') { i++; cols++; } else if (c === '\t') { i++; cols += 4 - (cols % 4); } else break;
    }
    this.blank = c === '\n' || c === '\r' || c === '';
    this.nextNonspace = i;
    this.nextNonspaceColumn = cols;
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }
  private advanceOffset(count: number, columns: boolean): void {
    let c: string | undefined;
    while (count > 0 && (c = this.line[this.offset])) {
      if (c === '\t') {
        const charsToTab = 4 - (this.column % 4);
        if (columns) {
          this.partiallyConsumedTab = charsToTab > count;
          const charsToAdvance = charsToTab > count ? count : charsToTab;
          this.column += charsToAdvance;
          this.offset += this.partiallyConsumedTab ? 0 : 1;
          count -= charsToAdvance;
        } else { this.partiallyConsumedTab = false; this.column += charsToTab; this.offset += 1; count -= 1; }
      } else { this.partiallyConsumedTab = false; this.offset += 1; this.column += 1; count -= 1; }
    }
  }
  private advanceNextNonspace(): void { this.offset = this.nextNonspace; this.column = this.nextNonspaceColumn; this.partiallyConsumedTab = false; }
  private addLine(): void {
    if (this.partiallyConsumedTab) { this.offset += 1; this.tip.content += ' '.repeat(4 - (this.column % 4)); }
    this.tip.content += this.line.slice(this.offset) + '\n';
  }
  private addChild(type: BlockType): Block {
    while (!canContain(this.tip.type, type)) this.finalize(this.tip);
    const b = newBlock(type, this.tip);
    this.tip.children.push(b);
    this.tip = b;
    return b;
  }
  private closeUnmatchedBlocks(): void {
    if (this.allClosed) return;
    while (this.oldtip !== this.lastMatchedContainer) { const parent = this.oldtip.parent; this.finalize(this.oldtip); this.oldtip = parent ?? this.doc; }
    this.allClosed = true;
  }
  /** يستهلك التعريفاتِ من أوّل الفقرة (removeLinkReferenceDefinitions · بدءُ العنوان السطريّ). */
  private takeDefinitions(b: Block): boolean {
    let pos = 0, took = false;
    while (peekAt(b.content, 0) === 91 && (pos = this.inline.parseReference(b.content, this.refs)) > 0) { b.content = b.content.slice(pos); took = true; }
    return took;
  }
  finalize(b: Block): void {
    b.open = false;
    if (b.type === 'document') this.removeLinkReferenceDefinitions(b);
    this.tip = b.parent ?? this.doc;
  }
  /** يُغلق كلَّ كتلةٍ مفتوحةٍ حتى المستند (نهايةُ `parse` في commonmark.js). */
  finish(): void {
    for (;;) { const t = this.tip; this.finalize(t); if (t.type === 'document') return; }
  }
  private removeLinkReferenceDefinitions(b: Block): void {
    for (let i = 0; i < b.children.length; i++) {
      const c = b.children[i]!;
      if (c.type === 'paragraph') { if (this.takeDefinitions(c) && !reNonSpace.test(c.content)) { b.children.splice(i, 1); i--; } }
      else this.removeLinkReferenceDefinitions(c);
    }
  }

  private parseListMarker(container: Block): ListData | null {
    const rest = this.line.slice(this.nextNonspace);
    if (this.indent >= 4) return null;
    let m: RegExpMatchArray | null;
    let data: ListData;
    if ((m = rest.match(reBulletListMarker))) data = { type: 'bullet', bulletChar: m[0][0] ?? null, delimiter: null, padding: 0, markerOffset: this.indent };
    else if ((m = rest.match(reOrderedListMarker)) && (container.type !== 'paragraph' || Number(m[1]) === 1))
      data = { type: 'ordered', bulletChar: null, delimiter: m[2] ?? null, padding: 0, markerOffset: this.indent };
    else return null;
    const len = m[0].length;
    let nextc = peekAt(this.line, this.nextNonspace + len);
    if (!(nextc === -1 || nextc === 9 || nextc === 32)) return null;
    if (container.type === 'paragraph' && !reNonSpace.test(this.line.slice(this.nextNonspace + len))) return null;
    this.advanceNextNonspace();
    this.advanceOffset(len, true);
    const spacesStartCol = this.column, spacesStartOffset = this.offset;
    do { this.advanceOffset(1, true); nextc = peekAt(this.line, this.offset); } while (this.column - spacesStartCol < 5 && isSpaceOrTab(nextc));
    const blankItem = peekAt(this.line, this.offset) === -1;
    const spacesAfterMarker = this.column - spacesStartCol;
    if (spacesAfterMarker >= 5 || spacesAfterMarker < 1 || blankItem) {
      data.padding = len + 1;
      this.column = spacesStartCol;
      this.offset = spacesStartOffset;
      if (isSpaceOrTab(peekAt(this.line, this.offset))) this.advanceOffset(1, true);
    } else data.padding = len + spacesAfterMarker;
    return data;
  }

  /** `continue` لكلِّ نوع: 0 استمرّ · 1 لم يستمرّ · 2 استُهلك السطر. */
  private continues(c: Block): 0 | 1 | 2 {
    const ln = this.line;
    switch (c.type) {
      case 'document': case 'list': return 0;
      case 'block_quote':
        if (this.indented || peekAt(ln, this.nextNonspace) !== 62) return 1;
        this.advanceNextNonspace(); this.advanceOffset(1, false);
        if (isSpaceOrTab(peekAt(ln, this.offset))) this.advanceOffset(1, true);
        return 0;
      case 'item': {
        const d = c.list!;
        if (this.blank) { if (c.children.length === 0) return 1; this.advanceNextNonspace(); }
        else if (this.indent >= d.markerOffset + d.padding) this.advanceOffset(d.markerOffset + d.padding, true);
        else return 1;
        return 0;
      }
      case 'heading': case 'thematic_break': return 1;
      case 'code_block':
        if (c.fenced) {
          const m = this.indent <= 3 && ln.charAt(this.nextNonspace) === c.fenceChar ? ln.slice(this.nextNonspace).match(reClosingCodeFence) : null;
          if (m && m[0].length >= (c.fenceLength ?? 0)) { this.finalize(c); return 2; }
          let i = c.fenceOffset ?? 0;
          while (i > 0 && isSpaceOrTab(peekAt(ln, this.offset))) { this.advanceOffset(1, true); i--; }
        } else if (this.indent >= CODE_INDENT) this.advanceOffset(CODE_INDENT, true);
        else if (this.blank) this.advanceNextNonspace();
        else return 1;
        return 0;
      case 'html_block': return this.blank && (c.htmlType === 6 || c.htmlType === 7) ? 1 : 0;
      case 'paragraph': return this.blank ? 1 : 0;
    }
  }

  /** بداياتُ الكتل بترتيب commonmark.js: 0 لا · 1 حاويةٌ تابِع · 2 ورقةٌ قِف. */
  private tryStart(i: number, container: Block): 0 | 1 | 2 {
    const ln = this.line, rest = ln.slice(this.nextNonspace);
    let m: RegExpMatchArray | null;
    switch (i) {
      case 0:
        if (this.indented || peekAt(ln, this.nextNonspace) !== 62) return 0;
        this.advanceNextNonspace(); this.advanceOffset(1, false);
        if (isSpaceOrTab(peekAt(ln, this.offset))) this.advanceOffset(1, true);
        this.closeUnmatchedBlocks(); this.addChild('block_quote');
        return 1;
      case 1:
        if (this.indented || !(m = rest.match(reATXHeadingMarker))) return 0;
        this.advanceNextNonspace(); this.advanceOffset(m[0].length, false);
        this.closeUnmatchedBlocks();
        this.addChild('heading').content = ln.slice(this.offset).replace(/^[ \t]*#+[ \t]*$/, '').replace(/[ \t]+#+[ \t]*$/, '');
        this.advanceOffset(ln.length - this.offset, false);
        return 2;
      case 2: {
        if (this.indented || !(m = rest.match(reCodeFence))) return 0;
        this.closeUnmatchedBlocks();
        const b = this.addChild('code_block');
        b.fenced = true; b.fenceLength = m[0].length; b.fenceChar = m[0][0] ?? ''; b.fenceOffset = this.indent;
        this.advanceNextNonspace(); this.advanceOffset(m[0].length, false);
        return 2;
      }
      case 3:
        if (this.indented || peekAt(ln, this.nextNonspace) !== 60) return 0;
        for (let t = 1; t <= 7; t++) {
          if (reHtmlBlockOpen[t]!.test(rest) && (t < 7 || (container.type !== 'paragraph'
            && !(!this.allClosed && !this.blank && this.tip.type === 'paragraph')))) {
            this.closeUnmatchedBlocks();
            this.addChild('html_block').htmlType = t;
            return 2;
          }
        }
        return 0;
      case 4: {
        if (this.indented || container.type !== 'paragraph' || !(m = rest.match(reSetextHeadingLine))) return 0;
        this.closeUnmatchedBlocks();
        this.takeDefinitions(container);
        if (container.content.length === 0) return 0;
        const parent = container.parent!;
        const h: Block = { ...newBlock('heading', parent), content: container.content };
        parent.children[parent.children.indexOf(container)] = h;
        this.tip = h;
        this.advanceOffset(ln.length - this.offset, false);
        return 2;
      }
      case 5:
        if (this.indented || !reThematicBreak.test(rest)) return 0;
        this.closeUnmatchedBlocks(); this.addChild('thematic_break');
        this.advanceOffset(ln.length - this.offset, false);
        return 2;
      case 6: {
        let data: ListData | null;
        if (!((!this.indented || container.type === 'list') && (data = this.parseListMarker(container)))) return 0;
        this.closeUnmatchedBlocks();
        if (this.tip.type !== 'list' || !container.list || container.list.type !== data.type
          || container.list.delimiter !== data.delimiter || container.list.bulletChar !== data.bulletChar) this.addChild('list').list = data;
        this.addChild('item').list = data;
        return 1;
      }
      default:
        if (!(this.indented && this.tip.type !== 'paragraph' && !this.blank)) return 0;
        this.advanceOffset(CODE_INDENT, true);
        this.closeUnmatchedBlocks(); this.addChild('code_block');
        return 2;
    }
  }

  incorporateLine(input: string): void {
    let container: Block = this.doc;
    this.oldtip = this.tip;
    this.offset = 0; this.column = 0; this.blank = false; this.partiallyConsumedTab = false;
    this.line = input.includes('\u0000') ? input.replace(/\0/g, '\uFFFD') : input;
    let last: Block | undefined;
    while ((last = container.children[container.children.length - 1]) && last.open) {
      container = last;
      this.findNextNonspace();
      const r = this.continues(container);
      if (r === 2) return;
      if (r === 1) { container = container.parent ?? this.doc; break; }
    }
    this.allClosed = container === this.oldtip;
    this.lastMatchedContainer = container;
    let matchedLeaf = container.type !== 'paragraph' && ACCEPTS_LINES.has(container.type);
    while (!matchedLeaf) {
      this.findNextNonspace();
      if (!this.indented && !reMaybeSpecial.test(this.line.slice(this.nextNonspace))) { this.advanceNextNonspace(); break; }
      let i = 0;
      for (; i < 8; i++) {
        const res = this.tryStart(i, container);
        if (res === 1) { container = this.tip; break; }
        if (res === 2) { container = this.tip; matchedLeaf = true; break; }
      }
      if (i === 8) { this.advanceNextNonspace(); break; }
    }
    if (!this.allClosed && !this.blank && this.tip.type === 'paragraph') { this.addLine(); return; } // استمرارٌ كسول
    this.closeUnmatchedBlocks();
    if (ACCEPTS_LINES.has(container.type)) {
      this.addLine();
      const t = container.htmlType ?? 0;
      if (container.type === 'html_block' && t >= 1 && t <= 5 && reHtmlBlockClose[t]!.test(this.line.slice(this.offset))) this.finalize(container);
    } else if (this.offset < this.line.length && !this.blank) {
      this.addChild('paragraph');
      this.advanceNextNonspace();
      this.addLine();
    }
  }
}

/** `inline` و`definitions` ما يقيسه الحارس؛ و`resolved` وجهاتُ الروابطِ المرجعيّةِ المستعمَلة (تعريفاتٌ مقيسةٌ أصلًا) — للقياس التفاضليّ. */
export interface MarkdownLinks { inline: string[]; definitions: string[]; resolved: string[] }

/** وجهاتُ الروابط كما يراها commonmark.js 0.31.2: المباشرةُ في الفقرات والعناوين، وكلُّ تعريفٍ مرجعيٍّ (الأوّلُ يغلب). */
export function markdownLinks(input: string): MarkdownLinks {
  const p = new BlockParser();
  const lines = input.split(/\r\n|\n|\r/);
  const len = input.charCodeAt(input.length - 1) === 10 ? lines.length - 1 : lines.length;
  for (let i = 0; i < len; i++) p.incorporateLine(lines[i] ?? '');
  p.finish();
  const inline: string[] = [], resolved: string[] = [];
  const walk = (b: Block): void => {
    if (b.type === 'paragraph' || b.type === 'heading') p.inline.scan(b.content, p.refs, inline, resolved);
    else for (const c of b.children) walk(c);
  };
  walk(p.doc);
  return { inline, definitions: [...p.refs.values()], resolved };
}
