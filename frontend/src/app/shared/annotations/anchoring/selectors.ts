/**
 * The anchor record: several descriptions of one location, each of which fails
 * under different conditions, resolved in priority order.
 *
 * Shaped after the W3C Web Annotation Data Model rather than invented here, so
 * the JSON stays legible to anyone who has met that format — and so the tiers
 * mean what they mean everywhere else the model is used.
 */

export type SelectorType = 'Structural' | 'TextQuote' | 'TextPosition' | 'Geometric';

/** An `id` the author gave the element, plus a structural path as a weak backup. */
export interface StructuralSelector {
  type: 'Structural';
  elementId?: string;
  path?: string;
  tag?: string;
  classes?: string[];
}

/** The quoted text with enough context either side to disambiguate repeats. */
export interface TextQuoteSelector {
  type: 'TextQuote';
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** Character offsets into the document's normalised text. */
export interface TextPositionSelector {
  type: 'TextPosition';
  start: number;
  end: number;
}

/** Percentages of the rendered box — correct for images, last resort for text. */
export interface GeometricSelector {
  type: 'Geometric';
  xPercent: number;
  yPercent: number;
}

export type AnchorSelector =
  | StructuralSelector
  | TextQuoteSelector
  | TextPositionSelector
  | GeometricSelector;

/** The current anchor schema version. Version 0 is the legacy percentage-only anchor. */
export const ANCHOR_VERSION = 1;

export interface AnchorRecord {
  v: number;
  type: 'text' | 'image' | 'pdf';
  selectors: AnchorSelector[];
  docHash?: string;
}

/** How much of the surrounding text is kept for disambiguation. */
export const CONTEXT_LENGTH = 32;
/** Quotes longer than this are truncated — fuzzy scoring is O(length). */
export const MAX_QUOTE_LENGTH = 300;

export function findSelector<T extends AnchorSelector>(
  record: AnchorRecord | null | undefined,
  type: T['type']
): T | null {
  if (!record?.selectors) return null;
  return (record.selectors.find(s => s.type === type) as T) ?? null;
}

/**
 * Read a stored anchor of any vintage. Legacy rows hold a flat
 * `{type, xPercent, yPercent, …}` object rather than a selector list; they are
 * lifted into a v0 record so the resolver has one shape to deal with.
 */
export function toAnchorRecord(raw: unknown): AnchorRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;

  if (Array.isArray(value['selectors'])) {
    return {
      v: typeof value['v'] === 'number' ? value['v'] : ANCHOR_VERSION,
      type: (value['type'] as AnchorRecord['type']) ?? 'text',
      selectors: value['selectors'] as AnchorSelector[],
      docHash: typeof value['docHash'] === 'string' ? value['docHash'] : undefined
    };
  }

  const selectors: AnchorSelector[] = [];
  if (typeof value['elementId'] === 'string' || typeof value['selector'] === 'string') {
    selectors.push({
      type: 'Structural',
      elementId: value['elementId'] as string | undefined,
      path: value['selector'] as string | undefined
    });
  }
  // Legacy markdown anchors carried a snippet that was written and never read.
  // Promoting it to a quote selector is what upgrades those old pins in place.
  if (typeof value['snippet'] === 'string' && value['snippet'].trim()) {
    selectors.push({ type: 'TextQuote', exact: (value['snippet'] as string).trim() });
  }
  if (typeof value['xPercent'] === 'number' && typeof value['yPercent'] === 'number') {
    selectors.push({
      type: 'Geometric',
      xPercent: value['xPercent'] as number,
      yPercent: value['yPercent'] as number
    });
  }
  if (selectors.length === 0) return null;

  const legacyType = value['type'];
  const recordType: AnchorRecord['type'] =
    legacyType === 'image' ? 'image' : legacyType === 'pdf' ? 'pdf' : 'text';

  return { v: 0, type: recordType, selectors };
}

/**
 * The legacy flat shape, so a v1 anchor still means something to a client that
 * predates this rework — and to the HTML bridge, which reads the flat fields.
 */
export function toLegacyAnchor(
  record: AnchorRecord,
  renderMode: string
): Record<string, unknown> {
  const geometric = findSelector<GeometricSelector>(record, 'Geometric');
  const structural = findSelector<StructuralSelector>(record, 'Structural');
  const quote = findSelector<TextQuoteSelector>(record, 'TextQuote');

  // Spread first: the flat compatibility fields are the ones that must win, so
  // an older client reading `type` gets the render mode it understands rather
  // than the record's internal 'text'.
  return {
    ...record,
    type: renderMode,
    xPercent: geometric?.xPercent ?? 0,
    yPercent: geometric?.yPercent ?? 0,
    snippet: quote?.exact,
    elementId: structural?.elementId,
    selector: structural?.path
  };
}
