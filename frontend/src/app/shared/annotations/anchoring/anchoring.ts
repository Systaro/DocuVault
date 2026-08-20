import { TextIndex } from './text-index';
import { fuzzyFind, similarityOf } from './fuzzy';
import {
  AnchorRecord,
  AnchorSelector,
  ANCHOR_VERSION,
  CONTEXT_LENGTH,
  GeometricSelector,
  MAX_QUOTE_LENGTH,
  StructuralSelector,
  TextPositionSelector,
  TextQuoteSelector,
  findSelector
} from './selectors';

/**
 * How confidently a comment could be put back where it belongs.
 *
 * `ORPHANED` deliberately does not mean resolved. A comment whose paragraph was
 * rewritten is the one most likely to still matter — possibly *about* the
 * rewrite — so it is kept and shown, never quietly closed.
 */
export type AnchorState = 'ANCHORED' | 'SHIFTED' | 'ORPHANED';

export interface Anchored {
  state: AnchorState;
  /** Present unless orphaned. */
  range: Range | null;
  position: { start: number; end: number } | null;
  /** What the document says there now, when it differs from the stored quote. */
  currentText?: string;
}

/** Describe where a range sits, in every tier that applies to it. */
export function describeRange(root: Node, range: Range): AnchorRecord | null {
  const index = TextIndex.build(root);
  const position = index.fromRange(range);
  if (!position) return null;

  const exact = index.text.slice(position.start, position.end).slice(0, MAX_QUOTE_LENGTH);
  if (!exact.trim()) return null;

  const end = position.start + exact.length;
  const selectors: AnchorSelector[] = [
    {
      type: 'TextQuote',
      exact,
      prefix: index.text.slice(Math.max(0, position.start - CONTEXT_LENGTH), position.start),
      suffix: index.text.slice(end, end + CONTEXT_LENGTH)
    } as TextQuoteSelector,
    { type: 'TextPosition', start: position.start, end } as TextPositionSelector
  ];

  const structural = describeStructural(range.startContainer, root);
  if (structural) selectors.unshift(structural);

  const geometric = describeGeometric(root, range);
  if (geometric) selectors.push(geometric);

  return { v: ANCHOR_VERSION, type: 'text', selectors };
}

/**
 * Describe a point rather than a selection — a click that didn't land on text.
 * The nearest block element's own text becomes the quote, so even a click on
 * padding gets something durable rather than a bare coordinate.
 */
export function describePoint(root: Element, clientX: number, clientY: number): AnchorRecord | null {
  const element = blockUnder(root, clientX, clientY);
  if (element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const described = describeRange(root, range);
    if (described) {
      // A whole-block quote is a coarse anchor; the geometric selector keeps the
      // pin where it was actually put inside that block.
      const geometric = pointGeometric(root, clientX, clientY);
      if (geometric) {
        const existing = described.selectors.findIndex(s => s.type === 'Geometric');
        if (existing >= 0) described.selectors[existing] = geometric;
        else described.selectors.push(geometric);
      }
      return described;
    }
  }

  const geometric = pointGeometric(root, clientX, clientY);
  return geometric ? { v: ANCHOR_VERSION, type: 'text', selectors: [geometric] } : null;
}

/**
 * Put a stored anchor back onto the current document, trying each tier in turn.
 *
 * Order matters and is the whole design: an author-given id beats a quote,
 * a quote beats a character offset, and a coordinate is only ever the last
 * thing tried for text.
 */
export function anchorRecord(
  root: Element,
  record: AnchorRecord | null,
  prebuilt?: TextIndex
): Anchored {
  if (!record) return { state: 'ORPHANED', range: null, position: null };

  const index = prebuilt ?? TextIndex.build(root);
  const quote = findSelector<TextQuoteSelector>(record, 'TextQuote');
  const stored = findSelector<TextPositionSelector>(record, 'TextPosition');
  const structural = findSelector<StructuralSelector>(record, 'Structural');

  // Tier 1 — the element still carries the id the author gave it.
  if (structural?.elementId) {
    const element = root.querySelector(`#${cssEscape(structural.elementId)}`);
    if (element) {
      const hit = rangeOfElement(index, element);
      if (hit) return { state: 'ANCHORED', range: hit.range, position: hit.position };
    }
  }

  // Tier 2 — the words themselves.
  if (quote?.exact) {
    const hit = findQuote(index, quote, stored);
    if (hit) return hit;
  }

  // Tier 3 — a structural path, and only for records that carry no quote at all.
  //
  // This tier is deliberately fenced off. An `nth-of-type` path is an accident
  // of the document's shape, not a statement about meaning: every Markdown page
  // ever rendered has a `p:nth-of-type(1)`, so letting a path rescue an anchor
  // whose quote has already failed to match reattaches the comment to whatever
  // happens to sit in that slot now — with full confidence and no warning.
  // Silently pointing a comment at the wrong sentence is worse than admitting
  // the text is gone, so when a quote exists, the quote decides.
  //
  // Tier 1 is not fenced the same way because an id is an assertion by the
  // author about what an element *is*, which survives rewriting on purpose.
  if (structural?.path && !quote?.exact) {
    const element = safeQuery(root, structural.path);
    if (element) {
      const hit = rangeOfElement(index, element);
      if (hit) return { state: 'SHIFTED', range: hit.range, position: hit.position };
    }
  }

  // Tier 4 — offsets alone, only trustworthy when the document is unchanged.
  if (stored && !quote && stored.end <= index.text.length) {
    const range = index.toRange(stored.start, stored.end);
    if (range) return { state: 'SHIFTED', range, position: { start: stored.start, end: stored.end } };
  }

  return { state: 'ORPHANED', range: null, position: null };
}

/** Whether a record can be positioned by coordinates rather than by text. */
export function geometricOf(record: AnchorRecord | null): GeometricSelector | null {
  return findSelector<GeometricSelector>(record ?? null, 'Geometric');
}

function findQuote(
  index: TextIndex,
  quote: TextQuoteSelector,
  stored: TextPositionSelector | null
): Anchored | null {
  const { text } = index;
  const expected = stored?.start ?? 0;

  // Unchanged document: the stored offsets still hold exactly what they held.
  if (stored && text.substr(stored.start, quote.exact.length) === quote.exact) {
    const range = index.toRange(stored.start, stored.start + quote.exact.length);
    if (range) {
      return { state: 'ANCHORED', range, position: { start: stored.start, end: stored.start + quote.exact.length } };
    }
  }

  const occurrences = allOccurrences(text, quote.exact);
  if (occurrences.length > 0) {
    const start = bestOccurrence(text, occurrences, quote, expected);
    const range = index.toRange(start, start + quote.exact.length);
    if (range) {
      // The text is verbatim; only its position moved, which is not something
      // the reader needs to be warned about.
      return { state: 'ANCHORED', range, position: { start, end: start + quote.exact.length } };
    }
  }

  const fuzzy = fuzzyFind(text, quote.exact, expected);
  if (fuzzy) {
    const range = index.toRange(fuzzy.start, fuzzy.end);
    if (range) {
      return {
        state: 'SHIFTED',
        range,
        position: { start: fuzzy.start, end: fuzzy.end },
        currentText: text.slice(fuzzy.start, fuzzy.end)
      };
    }
  }

  return null;
}

function allOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1 && out.length < 500) {
    out.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return out;
}

/**
 * Of several identical passages, the one whose surroundings match best. Context
 * is what separates a repeated heading like "Overview" from the right one.
 */
function bestOccurrence(
  text: string,
  occurrences: number[],
  quote: TextQuoteSelector,
  expected: number
): number {
  if (occurrences.length === 1) return occurrences[0];

  let best = occurrences[0];
  let bestScore = -Infinity;
  for (const start of occurrences) {
    const end = start + quote.exact.length;
    const prefix = text.slice(Math.max(0, start - CONTEXT_LENGTH), start);
    const suffix = text.slice(end, end + CONTEXT_LENGTH);
    const context =
      (quote.prefix ? similarityOf(quote.prefix, prefix) : 0.5) +
      (quote.suffix ? similarityOf(quote.suffix, suffix) : 0.5);
    const drift = Math.abs(start - expected) / Math.max(text.length, 1);
    const score = context - drift * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  return best;
}

function rangeOfElement(
  index: TextIndex,
  element: Element
): { range: Range; position: { start: number; end: number } } | null {
  const contents = document.createRange();
  contents.selectNodeContents(element);
  const position = index.fromRange(contents);
  if (!position || position.end <= position.start) return null;
  const range = index.toRange(position.start, position.end);
  return range ? { range, position } : null;
}

/** The nearest block-level element under a point, ignoring our own overlay UI. */
function blockUnder(root: Element, clientX: number, clientY: number): Element | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const element of stack) {
    if (!root.contains(element)) continue;
    if (element.closest('app-annotation-overlay, .annotation-pin, .annotation-thread, .annotation-fab, .annotation-click-layer')) {
      continue;
    }
    const block = element.closest(
      'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, figcaption, dd, dt, section, article, div'
    );
    if (block && root.contains(block) && (block.textContent ?? '').trim()) return block;
  }
  return null;
}

function pointGeometric(root: Element, clientX: number, clientY: number): GeometricSelector | null {
  const box = root.getBoundingClientRect();
  const width = (root as HTMLElement).scrollWidth || box.width;
  const height = (root as HTMLElement).scrollHeight || box.height;
  if (!width || !height) return null;
  return {
    type: 'Geometric',
    xPercent: ((clientX - box.left + (root as HTMLElement).scrollLeft) / width) * 100,
    yPercent: ((clientY - box.top + (root as HTMLElement).scrollTop) / height) * 100
  };
}

function describeGeometric(root: Node, range: Range): GeometricSelector | null {
  if (!(root instanceof HTMLElement)) return null;
  const box = range.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  return pointGeometric(root, box.left, box.top);
}

function describeStructural(node: Node, root: Node): StructuralSelector | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
  if (!element || !root.contains(element)) return null;

  const identified = element.closest('[id]');
  const selector: StructuralSelector = {
    type: 'Structural',
    tag: element.tagName.toLowerCase(),
    path: pathTo(element, root)
  };
  if (identified && root.contains(identified)) selector.elementId = identified.id;
  if (element.classList.length) selector.classes = Array.from(element.classList).slice(0, 4);
  return selector;
}

function pathTo(element: Element, root: Node): string | undefined {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== root && parts.length < 12) {
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;
    }
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    current = current.parentElement;
  }
  return parts.length ? parts.join('>') : undefined;
}

function safeQuery(root: Element, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function cssEscape(value: string): string {
  const escape = (CSS as unknown as { escape?: (v: string) => string }).escape;
  return escape ? escape(value) : value.replace(/[^\w-]/g, '\\$&');
}
