/**
 * Helpers for editing a whole `.html` file in place: what gets rendered into the
 * editing iframe, and how the edited markup goes back into the original source
 * without touching anything outside `<body>`.
 */

/**
 * Marks a subtree the editor must leave alone and let run: its scripts stay
 * live while the rest of the page is being edited, and the caret cannot get
 * into it. A tab row, an accordion or a chart is a small program, not prose —
 * editing it in place means fighting the caret against the script, and saving
 * whatever state the script happened to be in.
 *
 * Authors write it into their own markup:
 * `<div class="tabs" data-dv-interactive> … </div>`
 */
export const INTERACTIVE_ATTRIBUTE = 'data-dv-interactive';

/**
 * Editing-time identifier for one interactive region, so the markup that was
 * on disk can be put back in place of whatever the region's scripts turned it
 * into. Injected into the frame document only — never into the file.
 */
const REGION_ATTRIBUTE = 'data-dv-region';

/**
 * How much of a region the editor puts back on save.
 *
 * `subtree` — the whole widget, markup and all. For a tab row or a chart:
 * nothing in it is prose, so nothing in it should be edited or re-saved.
 *
 * `state` — the element's own attributes only, with its children left as the
 * author edited them. For the panels a tab row switches between: the `active`
 * class belongs to the script, the paragraphs inside belong to the author.
 */
export type RegionMode = 'subtree' | 'state';

/** What one region looked like on disk. */
export interface Region {
  mode: RegionMode;
  /** `subtree`: the region's markup. `state`: its attributes, name to value. */
  markup?: string;
  attributes?: Record<string, string>;
}

/** A document prepared for the editing frame, with its regions as they are on disk. */
export interface PreparedSource {
  /** What the frame renders: regions tagged, and widgets locked against the caret. */
  source: string;
  /** What to put back per region id, keyed by the id written into the frame. */
  regions: Map<string, Region>;
}

/** True when [source] opts any part of itself out of editing. */
export function hasInteractiveRegions(source: string): boolean {
  return source.includes(INTERACTIVE_ATTRIBUTE);
}

/**
 * Prepares [source] for the editing frame: every interactive region is recorded
 * as it stands on disk, then tagged and made non-editable.
 *
 * Recording happens here, against the source text, rather than against the live
 * frame — by the time the frame has loaded, its scripts have already run and
 * the DOM no longer says what the file says.
 */
export function prepareInteractiveRegions(source: string): PreparedSource {
  if (!hasInteractiveRegions(source)) return { source, regions: new Map() };

  const doc = new DOMParser().parseFromString(source, 'text/html');
  const regions = new Map<string, Region>();

  Array.from(doc.querySelectorAll(`[${INTERACTIVE_ATTRIBUTE}]`))
    // A widget inside a widget is already covered by its ancestor; restoring
    // both would put the outer one back over the inner one. A `state` element
    // nested in a widget is likewise redundant.
    .filter((el) => !el.parentElement?.closest(`[${INTERACTIVE_ATTRIBUTE}]:not([${INTERACTIVE_ATTRIBUTE}="state"])`))
    .forEach((el, index) => {
      const id = String(index);
      const mode: RegionMode = el.getAttribute(INTERACTIVE_ATTRIBUTE) === 'state' ? 'state' : 'subtree';

      if (mode === 'state') {
        const attributes: Record<string, string> = {};
        Array.from(el.attributes).forEach((attr) => (attributes[attr.name] = attr.value));
        regions.set(id, { mode, attributes });
      } else {
        regions.set(id, { mode, markup: restoreBareAttribute(el.outerHTML) });
        // The caret stops at the widget's edge, so its content cannot be typed
        // over — which is honest, because anything typed there would be
        // discarded by the restore on save.
        el.setAttribute('contenteditable', 'false');
      }
      el.setAttribute(REGION_ATTRIBUTE, id);
    });

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '';
  return { source: doctype + doc.documentElement.outerHTML, regions };
}

/**
 * Writes the marker back the way authors write it. A valueless attribute
 * serialises as `data-dv-interactive=""`, and saving that would put a diff on
 * the one line the author had just got right.
 */
function restoreBareAttribute(markup: string): string {
  return markup.split(`${INTERACTIVE_ATTRIBUTE}=""`).join(INTERACTIVE_ATTRIBUTE);
}

/**
 * Puts the on-disk markup back in place of every interactive region before the
 * edited body is written to the file, so a page saves as its author wrote it
 * rather than as its scripts left it — the open tab, the toggled class, the
 * nodes a chart library injected.
 */
export function restoreInteractiveRegions(bodyHtml: string, regions: Map<string, Region>): string {
  if (regions.size === 0) return bodyHtml;

  const doc = new DOMParser().parseFromString(`<body>${bodyHtml}</body>`, 'text/html');
  doc.querySelectorAll(`[${REGION_ATTRIBUTE}]`).forEach((el) => {
    const region = regions.get(el.getAttribute(REGION_ATTRIBUTE) ?? '');
    // A region the editor no longer recognises is left as it is: the author
    // deleted the original, and inventing markup back into the file would be
    // worse than saving what is actually on screen.
    if (!region) {
      el.removeAttribute(REGION_ATTRIBUTE);
      return;
    }

    if (region.mode === 'subtree' && region.markup !== undefined) {
      el.outerHTML = region.markup;
      return;
    }

    // State only: the element's attributes go back to the file's, the children
    // stay as they were edited.
    const attributes = region.attributes ?? {};
    Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
    Object.entries(attributes).forEach(([name, value]) => el.setAttribute(name, value));
  });

  return restoreBareAttribute(doc.body.innerHTML);
}

/** Position right after the tag `re` matches, or null when it isn't there. */
function afterTag(source: string, re: RegExp): number | null {
  const match = source.match(re);
  return match?.index === undefined ? null : match.index + match[0].length;
}

/**
 * The document handed to the editing iframe: the file's own source plus a
 * `<base>` so its relative images and stylesheets keep resolving, and a minimum
 * height so an empty page still offers something to click into.
 *
 * The additions all live in `<head>`, which never travels back — only the `<body>`
 * markup is spliced into the saved file — so the file on disk stays untouched
 * by the editing chrome. A file that brings its own `<base>` keeps it.
 */
export function buildFrameDocument(source: string, baseHref: string): string {
  const head =
    (/<base\b/i.test(source) ? '' : `<base href="${baseHref.replace(/"/g, '%22')}">`) +
    // Only <body> is spliced back into the file on save, so a browser that
    // translated the page in the iframe would write the translation to disk.
    '<meta name="google" content="notranslate">' +
    `<style>
      body{min-height:100vh;}
      /* Editing affordances only, scoped to the editable state and dropped with
         the rest of <head> on save: a table whose page draws no borders is
         otherwise impossible to aim a caret at. Outline rather than border, so
         nothing in the page's own layout moves.

         The size floor is deliberately limited to cells that are still empty —
         a fresh table would otherwise collapse to a few invisible pixels — so
         a page that already styles its tables keeps rendering them its way.
         An "empty" cell holds a lone <br>: without it the caret has nowhere to
         go, so :empty alone would not catch them. */
      body[contenteditable="true"] td,
      body[contenteditable="true"] th{outline:1px dashed rgba(56,128,135,.4);outline-offset:-1px;}
      body[contenteditable="true"] td:empty,
      body[contenteditable="true"] th:empty,
      body[contenteditable="true"] td:has(>br:only-child),
      body[contenteditable="true"] th:has(>br:only-child){min-width:5rem;height:1.8em;}
      /* An interactive region is live rather than editable — the outline says
         the caret will not go in, and the cursor stays the page's own so its
         buttons still read as buttons. */
      body[contenteditable="true"] [data-dv-interactive]{
        outline:1px dashed rgba(56,128,135,.5);outline-offset:3px;
      }
    </style>`;

  const inHead = afterTag(source, /<head\b[^>]*>/i);
  if (inHead !== null) {
    return source.slice(0, inHead) + head + source.slice(inHead);
  }

  // No <head> of its own: the snippet needs its own wrapper, and it must land
  // after any doctype — content before the doctype would drop the whole page
  // into quirks mode and render it differently than the real preview does.
  const at = afterTag(source, /<html\b[^>]*>/i) ?? afterTag(source, /<!doctype[^>]*>/i) ?? 0;
  return source.slice(0, at) + `<head>${head}</head>` + source.slice(at);
}

/**
 * Put edited body markup back into the file, leaving everything outside
 * `<body>` — doctype, `<head>`, scripts, comments — byte-identical. Files
 * without a `<body>` are fragments: there the edited markup *is* the file.
 */
export function spliceBodyHtml(source: string, bodyHtml: string): string {
  const open = source.match(/<body\b[^>]*>/i);
  const closeAt = source.toLowerCase().lastIndexOf('</body>');
  if (open?.index === undefined || closeAt < 0 || closeAt < open.index) return bodyHtml;

  // Spliced verbatim, newlines and indentation included: the serialised markup
  // already carries the whitespace the browser parsed, so re-indenting here
  // would show up as a diff on every line the user never touched.
  //
  // Except at the very end: the parser moves whitespace that followed </body>
  // and </html> into the body, so serialising that back would push another
  // blank line in front of </body> on every save. The file's own trailing gap
  // is kept instead, which makes repeated saves idempotent.
  const start = open.index + open[0].length;
  const originalGap = source.slice(start, closeAt).match(/\s*$/)?.[0] ?? '';
  return source.slice(0, start) + bodyHtml.replace(/\s*$/, '') + originalGap + source.slice(closeAt);
}
