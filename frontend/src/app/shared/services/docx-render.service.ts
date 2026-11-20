import { Injectable } from '@angular/core';
import { loadVendorScript } from '../utils/vendor-script';

/** Link schemes a rendered Word document may keep; anything else loses its href. */
const SAFE_LINK = /^(https?:|mailto:|#)/i;

/** Room left above a heading reached through an in-document link. */
const BOOKMARK_MARGIN_PX = 24;

/** The nearest ancestor of [el] that scrolls its content vertically. */
function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Word writes list bullets as private-use code points of the Symbol and
 * Wingdings fonts (U+F0xx). Only Windows ships those fonts, so everywhere else
 * the markers render as empty boxes; these are the ones Word's bullet library uses.
 */
const SYMBOL_BULLETS: Record<string, string> = {
  '\uF0B7': '•', // Symbol: bullet
  '\uF0A7': '▪', // Wingdings: small square
  '\uF0D8': '➢', // Wingdings: arrowhead
  '\uF076': '❖', // Wingdings: diamond
  '\uF0FC': '✓', // Wingdings: check mark
  '\uF06E': '■', // Wingdings: square
  '\uF071': '❑', // Wingdings: shadowed square
  '\uF0A8': '◻', // Wingdings: hollow square
};
const SYMBOL_BULLET_CHARS = new RegExp(`[${Object.keys(SYMBOL_BULLETS).join('')}]`, 'g');

/**
 * OOXML lets a length carry its unit (`w:sz="4.3mm"`, `w:top="1in"`) instead of
 * the bare twips / half-points number. Teams transcripts are written that way,
 * and docx-preview reads only the number, so `4.3mm` came out as 2pt text and
 * `1in` page margins as one twip. Twips per unit:
 */
const TWIPS_PER_UNIT: Record<string, number> = {
  in: 1440, pt: 20, pc: 240, pi: 240, mm: 1440 / 25.4, cm: 1440 / 2.54,
};
/** Elements whose lengths are half-points; every other length is in twips. */
const HALF_POINT_ELEMENTS = new Set(['sz', 'szCs', 'kern', 'position']);
const UNIT_ATTRIBUTE = /(w:\w+)="(-?\d+(?:\.\d+)?)(in|pt|pc|pi|mm|cm)"/g;

/**
 * docx-preview's own comment rendering is an inline emoji with a hover box, so
 * the comment ranges are handed to it as bookmarks instead: it renders each one
 * as an empty `<span id="…">`, which marks where the commented words start and end.
 */
const COMMENT_RANGE = /<w:commentRange(Start|End)\b[^>]*?\bw:id="([^"]*)"[^>]*\/>/g;
const COMMENT_MARK = 'dv-comment-';

/** One comment from a Word file, or a reply to one. */
export interface DocxCommentNote {
  id: string;
  author: string;
  /** ISO date-time; without an offset when the file only gives Word's local time. */
  date: string;
  text: string;
}

/** A comment thread from a Word file, with the passage it was written against. */
export interface DocxComment extends DocxCommentNote {
  resolved: boolean;
  replies: DocxCommentNote[];
  /** The commented words in the rendered document; null when they could not be found. */
  range: Range | null;
}

/** The class docx-preview puts on each page; style classes are `<class>_<style id>`. */
const DOCX_CLASS = 'docx';

/**
 * docx-preview writes a document's fonts without a generic family, so a font
 * the viewer lacks (Aptos, Calibri, Cambria outside Office) fell through to the
 * browser default, a serif. Each font list gets the generic family of the fonts
 * the document names: from Word's font table where it records one, else from
 * these name patterns, else sans-serif.
 */
const FONT_TABLE_FAMILY: Record<string, string> = { roman: 'serif', swiss: 'sans-serif', modern: 'monospace' };
const MONO_FONT = /\b(mono|code|courier|consolas|console|menlo|monaco|inconsolata)\b/i;
const SANS_FONT = /\bsans\b|gothic/i;
const SERIF_FONT = /\b(serif|times|cambria|georgia|garamond|palatino|antiqua|bookman|baskerville|bodoni|didot|caslon|schoolbook|constantia|minion|charter|perpetua|goudy|rockwell|sitka|mincho|batang|simsun|songti|mingliu)\b|明朝/i;
const GENERIC_FONT = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i;
/** A font-family declaration, or an @font-face block, whose single family must stay alone. */
const FONT_FAMILY_DECL = /@font-face\s*\{[^}]*\}|(font-family:\s*)([^;}]+)/g;
const THEME_FONT_VAR = /(--docx-\w+-font):\s*([^;}]+)/g;

const COMMENT_PARTS = ['comments', 'commentsExtended', 'commentsIds', 'commentsExtensible'] as const;
const RELATED_PARTS = [...COMMENT_PARTS, 'styles', 'fontTable'] as const;
type RelatedParts = Partial<Record<typeof RELATED_PARTS[number], Document>>;

interface ParsedComment extends DocxCommentNote {
  /** Word links replies and resolved state through the comment's last paragraph. */
  paraId: string | null;
}

/** OOXML elements and attributes by local name, since writers differ in their prefixes. */
function elements(parent: Document | Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', name));
}

function attr(el: Element, name: string): string | null {
  return Array.from(el.attributes).find(a => a.localName === name)?.value ?? null;
}

function runText(el: Element): string {
  switch (el.localName) {
    case 't': return el.textContent ?? '';
    case 'tab': return '\t';
    case 'br':
    case 'cr': return '\n';
    case 'noBreakHyphen': return '-';
    default: return '';
  }
}

/** A comment body as plain text, one line per paragraph. Deleted text (w:delText) stays out. */
function commentText(comment: Element): string {
  return elements(comment, 'p')
    .map(p => elements(p, 'r').map(r => Array.from(r.children).map(runText).join('')).join(''))
    .join('\n')
    .trim();
}

/**
 * Renders a Word document (.docx) into a host element with docx-preview, page
 * by page, keeping fonts, tables, headers/footers and embedded images.
 *
 * docx-preview and its JSZip dependency are loaded on demand from `/vendor`
 * (see loadVendorScript) rather than bundled, the same as SheetJS for xlsx.
 * The UMD build of docx-preview reads JSZip from the global, so it loads first.
 */
@Injectable({ providedIn: 'root' })
export class DocxRenderService {
  private libs?: Promise<any>;

  /** Render the document into [host] and return its comment threads in document order. */
  async render(data: ArrayBuffer, host: HTMLElement): Promise<DocxComment[]> {
    const docx = await this.loadLibs();
    const zip = await (window as any).JSZip.loadAsync(data);
    const normalized = await this.normalizeUnits(zip);
    const parts = await this.relatedParts(zip);
    const comments = this.readComments(parts);
    if (comments.length) await this.markCommentRanges(zip);
    const prepared = normalized || comments.length ? await zip.generateAsync({ type: 'arraybuffer' }) : data;
    host.replaceChildren();
    // Styles go into the host too, so they leave with it when the viewer does.
    await docx.renderAsync(prepared, host, host, {
      className: DOCX_CLASS,
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      // Embedded HTML chunks would run as live markup in our page, and tracked
      // changes have no counterpart in this read-only view. Comments are drawn
      // by DocxCommentsComponent from the ranges marked in markCommentRanges.
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
      experimental: false,
      useBase64URL: true,
    });
    this.sanitizeLinks(host);
    this.replaceSymbolBullets(host);
    this.applyDefaultParagraphStyle(host, parts.styles);
    this.addGenericFonts(host, parts.fontTable);
    return this.placeComments(comments, host);
  }

  /** Rewrite unit-suffixed lengths in the document's XML parts as plain twips / half-points. */
  private async normalizeUnits(zip: any): Promise<boolean> {
    let changed = false;
    const parts = Object.keys(zip.files).filter(name => /^word\/[^/]+\.xml$/.test(name));
    for (const name of parts) {
      const xml: string = await zip.file(name).async('string');
      const fixed = xml.replace(/<w:(\w+)\b[^>]*>/g, (tag, element: string) =>
        tag.replace(UNIT_ATTRIBUTE, (_m, attr: string, value: string, unit: string) => {
          const twips = parseFloat(value) * TWIPS_PER_UNIT[unit];
          const converted = HALF_POINT_ELEMENTS.has(element) ? twips / 10 : twips;
          return `${attr}="${Math.round(converted)}"`;
        })
      );
      if (fixed !== xml) {
        zip.file(name, fixed);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * The comment threads of the main document. Replies and the resolved flag
   * live in commentsExtended.xml, keyed by each comment's last paragraph.
   */
  private readComments(parts: RelatedParts): DocxComment[] {
    if (!parts.comments) return [];

    const durableIds = new Map<string, string>();
    if (parts.commentsIds) {
      for (const el of elements(parts.commentsIds, 'commentId')) {
        const paraId = attr(el, 'paraId');
        const durableId = attr(el, 'durableId');
        if (paraId && durableId) durableIds.set(paraId, durableId);
      }
    }
    const utcDates = new Map<string, string>();
    if (parts.commentsExtensible) {
      for (const el of elements(parts.commentsExtensible, 'commentExtensible')) {
        const durableId = attr(el, 'durableId');
        const dateUtc = attr(el, 'dateUtc');
        if (durableId && dateUtc) utcDates.set(durableId, dateUtc);
      }
    }

    const parsed: ParsedComment[] = elements(parts.comments, 'comment').map(el => {
      const paras = elements(el, 'p');
      const paraId = paras.length ? attr(paras[paras.length - 1], 'paraId') : null;
      // Word writes w:date in the author's local time with a "Z" it doesn't
      // mean; the true UTC time, when present, is in commentsExtensible.xml.
      const utc = paraId ? utcDates.get(durableIds.get(paraId) ?? '') : undefined;
      return {
        id: attr(el, 'id') ?? '',
        author: attr(el, 'author') || 'Unknown author',
        date: utc ?? (attr(el, 'date') ?? '').replace(/Z$/, ''),
        text: commentText(el),
        paraId,
      };
    });

    const parentOf = new Map<string, string>();
    const done = new Set<string>();
    if (parts.commentsExtended) {
      for (const el of elements(parts.commentsExtended, 'commentEx')) {
        const paraId = attr(el, 'paraId');
        if (!paraId) continue;
        const parent = attr(el, 'paraIdParent');
        if (parent) parentOf.set(paraId, parent);
        if (['1', 'true'].includes(attr(el, 'done') ?? '')) done.add(paraId);
      }
    }

    const byPara = new Map(parsed.filter(c => c.paraId).map(c => [c.paraId!, c]));
    const rootOf = (comment: ParsedComment): ParsedComment => {
      const seen = new Set<ParsedComment>();
      let current = comment;
      while (current.paraId && !seen.has(current)) {
        seen.add(current);
        const parent = byPara.get(parentOf.get(current.paraId) ?? '');
        if (!parent) break;
        current = parent;
      }
      return current;
    };

    const threads = new Map<ParsedComment, DocxComment>();
    const roots = parsed.map(c => [c, rootOf(c)] as const);
    for (const [comment, root] of roots) {
      if (comment !== root) continue;
      const { paraId, ...note } = comment;
      threads.set(comment, { ...note, resolved: !!paraId && done.has(paraId), replies: [], range: null });
    }
    for (const [comment, root] of roots) {
      if (comment === root) continue;
      const { paraId, ...note } = comment;
      threads.get(root)?.replies.push(note);
    }
    return [...threads.values()];
  }

  /** The XML of the comment, style and font table parts the main document links to, where present. */
  private async relatedParts(zip: any): Promise<RelatedParts> {
    const rels = zip.file('word/_rels/document.xml.rels');
    if (!rels) return {};
    const parser = new DOMParser();
    const parts: RelatedParts = {};
    const relDoc = parser.parseFromString(await rels.async('string'), 'application/xml');
    for (const rel of elements(relDoc, 'Relationship')) {
      const kind = RELATED_PARTS.find(name => (attr(rel, 'Type') ?? '').endsWith(`/${name}`));
      const target = attr(rel, 'Target') ?? '';
      if (!kind) continue;
      const file = zip.file(target.startsWith('/') ? target.slice(1) : `word/${target}`);
      if (!file) continue;
      const xml = parser.parseFromString(await file.async('string'), 'application/xml');
      if (!xml.getElementsByTagName('parsererror').length) parts[kind] = xml;
    }
    return parts;
  }

  /** Turn the comment range markers in the main document into bookmarks docx-preview renders. */
  private async markCommentRanges(zip: any): Promise<void> {
    const file = zip.file('word/document.xml');
    if (!file) return;
    const xml: string = await file.async('string');
    zip.file('word/document.xml', xml.replace(COMMENT_RANGE, (_m, edge: string, id: string) =>
      `<w:bookmarkStart w:id="0" w:name="${COMMENT_MARK}${edge.toLowerCase()}-${id}"/>`
    ));
  }

  /** Give each thread the range between its rendered markers, and sort the threads by it. */
  private placeComments(threads: DocxComment[], host: HTMLElement): DocxComment[] {
    const marks = new Map<string, Element>();
    host.querySelectorAll(`span[id^="${COMMENT_MARK}"]`).forEach(el => marks.set(el.id, el));
    for (const thread of threads) {
      const start = marks.get(`${COMMENT_MARK}start-${thread.id}`);
      const end = marks.get(`${COMMENT_MARK}end-${thread.id}`);
      if (start && end && start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const range = document.createRange();
        range.setStartAfter(start);
        range.setEndBefore(end);
        thread.range = range;
      }
    }
    // Comments whose words could not be found go last; they are still reachable from the others.
    return threads.sort((a, b) =>
      a.range && b.range ? a.range.compareBoundaryPoints(Range.START_TO_START, b.range)
        : a.range ? -1 : b.range ? 1 : 0
    );
  }

  /** Swap Symbol/Wingdings bullets in the generated list styles for Unicode ones. */
  private replaceSymbolBullets(host: HTMLElement): void {
    host.querySelectorAll('style').forEach(style => {
      const css = style.textContent ?? '';
      const fixed = css.replace(SYMBOL_BULLET_CHARS, ch => SYMBOL_BULLETS[ch]);
      if (fixed !== css) {
        style.textContent = fixed.replace(/font-family:\s*(Symbol|Wingdings);/g, '');
      }
    });
  }

  /**
   * docx-preview leaves a paragraph without a style unclassed, so its text takes
   * the document defaults (`.docx span`) instead of the default paragraph style
   * Word gives it, which often sets another font and size. Those paragraphs get
   * the default style's class.
   */
  private applyDefaultParagraphStyle(host: HTMLElement, styles?: Document): void {
    const style = styles && elements(styles, 'style').find(s =>
      attr(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(attr(s, 'default') ?? ''));
    const id = style && attr(style, 'styleId');
    if (!id) return;
    // docx-preview's own class name for a style id.
    const styleClass = `${DOCX_CLASS}_${id.replace(/[ .]+/g, '-').replace(/&+/g, 'and').toLowerCase()}`;
    host.querySelectorAll(`section.${DOCX_CLASS} p`).forEach(p => {
      if (!Array.from(p.classList).some(c => c.startsWith(`${DOCX_CLASS}_`))) p.classList.add(styleClass);
    });
  }

  /** Close every font list in the rendered document with a generic family (see FONT_TABLE_FAMILY). */
  private addGenericFonts(host: HTMLElement, fontTable?: Document): void {
    const known = new Map<string, string>();
    for (const font of fontTable ? elements(fontTable, 'font') : []) {
      const name = attr(font, 'name');
      const pitch = elements(font, 'pitch')[0];
      const family = elements(font, 'family')[0];
      const generic = pitch && attr(pitch, 'val') === 'fixed'
        ? 'monospace'
        : FONT_TABLE_FAMILY[(family && attr(family, 'val')) ?? ''];
      if (name && generic) known.set(name.toLowerCase(), generic);
    }

    const styles = Array.from(host.querySelectorAll('style'));
    // The theme's fonts, which docx-preview hands out as var(--docx-majorHAnsi-font) and the like.
    const themeFonts = new Map<string, string>();
    for (const style of styles) {
      for (const [, name, value] of (style.textContent ?? '').matchAll(THEME_FONT_VAR)) {
        themeFonts.set(name, value.trim());
      }
    }

    const genericOf = (font: string): string | undefined => {
      const name = font.replace(/^['"]|['"]$/g, '');
      return known.get(name.toLowerCase())
        ?? (MONO_FONT.test(name) ? 'monospace'
          : SANS_FONT.test(name) ? 'sans-serif'
          : SERIF_FONT.test(name) ? 'serif'
          : undefined);
    };
    const withGeneric = (list: string): string => {
      const fonts = list.split(',')
        .map(f => f.trim())
        .map(f => themeFonts.get(/^var\((--docx-\w+-font)\)$/.exec(f)?.[1] ?? '') ?? f);
      if (fonts.some(f => GENERIC_FONT.test(f))) return list;
      const generic = fonts.map(genericOf).find(g => g) ?? 'sans-serif';
      return `${list.trim()}, ${generic}`;
    };

    for (const style of styles) {
      const css = style.textContent ?? '';
      const fixed = css.replace(FONT_FAMILY_DECL, (decl, prop?: string, list?: string) =>
        prop && list ? prop + withGeneric(list) : decl);
      if (fixed !== css) style.textContent = fixed;
    }
    host.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach(el => {
      el.style.fontFamily = withGeneric(el.style.fontFamily);
    });
  }

  /**
   * Hyperlink targets come straight from the file, so a `javascript:` URL in a
   * shared document would run in the viewer's session. Keep web, mail and
   * in-document links; open external ones in a new tab.
   *
   * An in-document link (a table of contents entry) scrolls to its bookmark.
   * Left to the browser, `#_Toc…` resolves against the app's base URL and
   * navigates out of the document instead.
   */
  private sanitizeLinks(host: HTMLElement): void {
    host.querySelectorAll('a[href]').forEach(a => {
      const href = (a.getAttribute('href') ?? '').trim();
      if (!SAFE_LINK.test(href)) {
        a.removeAttribute('href');
      } else if (href.startsWith('#')) {
        a.addEventListener('click', event => {
          event.preventDefault();
          this.scrollToBookmark(host, href.slice(1));
        });
      } else {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  /**
   * Bring the bookmark [name] of the rendered document to the top of the view.
   * Only the pane the document scrolls in moves: scrollIntoView would also nudge
   * every scrollable ancestor, shifting the whole app layout by a few pixels.
   */
  private scrollToBookmark(host: HTMLElement, name: string): void {
    if (!name) return;
    let id = name;
    try {
      id = decodeURIComponent(name);
    } catch {
      // Not percent-encoded after all; look it up as written.
    }
    const target = host.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    // Where the page itself scrolls (a share link), the root is the pane.
    const root = document.scrollingElement as HTMLElement;
    const pane = scrollingAncestor(host) ?? root;
    const paneTop = pane === root ? 0 : pane.getBoundingClientRect().top;
    const top = target.getBoundingClientRect().top - paneTop + pane.scrollTop;
    pane.scrollTo({ top: Math.max(0, top - BOOKMARK_MARGIN_PX), behavior: 'smooth' });
  }

  private loadLibs(): Promise<any> {
    if (!this.libs) {
      this.libs = loadVendorScript('/vendor/jszip.min.js', 'JSZip')
        .then(() => loadVendorScript('/vendor/docx-preview.min.js', 'docx'))
        .catch(err => {
          this.libs = undefined;
          throw err;
        });
    }
    return this.libs;
  }
}
