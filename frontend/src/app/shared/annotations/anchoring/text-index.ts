/**
 * A flat, whitespace-normalised view of everything a rendered document says,
 * with a way back to the DOM positions it came from.
 *
 * Anchoring works on this rather than on the DOM directly because the DOM is
 * the volatile part: a re-render, a different Markdown parser version, a
 * restyle or a wholesale markup regeneration all rewrite the element tree while
 * leaving the words alone. Normalising whitespace on the way in means source
 * re-indentation doesn't register as a change either.
 */

/** One text node's contribution to the index. */
interface Segment {
  node: Text;
  /** Range this node occupies in {@link TextIndex.text}; end is exclusive. */
  start: number;
  end: number;
  /**
   * normalised offset within the segment → offset within `node.data`.
   * Null when the two are identical, which is the common case and saves
   * building an array for every unremarkable run of text.
   */
  offsets: Uint32Array | null;
}

/** Elements whose text is never part of the document's content. */
const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

/** Our own comment UI, which must not become anchorable text. */
const SKIPPED_SELECTOR =
  'app-annotation-overlay, app-annotation-marker, app-annotation-thread, ' +
  '.annotation-pin, .annotation-thread, .annotation-list, .annotation-fab, ' +
  '.new-annotation-popover, .dv-pin, [data-dv-ui]';

export class TextIndex {
  /** The whole document as one normalised string. */
  readonly text: string;
  private readonly segments: Segment[];

  private constructor(text: string, segments: Segment[]) {
    this.text = text;
    this.segments = segments;
  }

  static build(root: Node): TextIndex {
    const segments: Segment[] = [];
    const parts: string[] = [];
    let length = 0;
    // Whitespace collapses across node boundaries too, so whether the previous
    // emitted character was a space has to survive from one node to the next.
    let lastWasSpace = true;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (SKIPPED.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest(SKIPPED_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      const raw = text.data;
      if (!raw) continue;

      let emitted = '';
      // Only allocated once this node turns out to actually collapse something.
      let offsets: number[] | null = null;

      for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        const isSpace = char === ' ' || char === '\n' || char === '\t' || char === '\r' || char === '\f';
        if (isSpace) {
          if (lastWasSpace) {
            if (!offsets) offsets = Array.from(emitted, (_, k) => k);
            continue;
          }
          if (offsets) offsets.push(i);
          emitted += ' ';
          lastWasSpace = true;
          continue;
        }
        if (offsets) offsets.push(i);
        emitted += char;
        lastWasSpace = false;
      }

      if (!emitted) continue;

      segments.push({
        node: text,
        start: length,
        end: length + emitted.length,
        offsets: offsets ? Uint32Array.from(offsets) : null
      });
      parts.push(emitted);
      length += emitted.length;
    }

    return new TextIndex(parts.join(''), segments);
  }

  /** Where a DOM range sits in {@link text}, or null when it isn't in the index. */
  fromRange(range: Range): { start: number; end: number } | null {
    const start = this.fromPoint(range.startContainer, range.startOffset, false);
    const end = this.fromPoint(range.endContainer, range.endOffset, true);
    if (start === null || end === null) return null;
    return start <= end ? { start, end } : { start: end, end: start };
  }

  /**
   * The offset in {@link text} for a DOM position.
   *
   * Element containers need `atEnd` to disambiguate: `selectNodeContents(p)`
   * produces an end position of `(p, childCount)`, which points *past* the last
   * child rather than at any child. Reading that as the start of the element —
   * as the obvious implementation does — collapses every such range to zero
   * length, and the anchor silently resolves to nothing.
   */
  fromPoint(container: Node, offset: number, atEnd = false): number | null {
    if (container.nodeType === Node.TEXT_NODE) {
      const segment = this.segments.find(s => s.node === container);
      if (!segment) return null;
      return segment.start + this.rawToNormalised(segment, offset);
    }

    const children = container.childNodes;
    if (offset < children.length) {
      const target = children[offset];
      const segment = atEnd ? this.lastSegmentIn(target) : this.firstSegmentIn(target);
      if (segment) return atEnd ? segment.end : segment.start;
      // An empty or non-text child (an <img>, say): fall back to the boundary
      // of the container as a whole rather than giving up on the range.
    }

    const segment = atEnd ? this.lastSegmentIn(container) : this.firstSegmentIn(container);
    if (!segment) return null;
    return atEnd ? segment.end : segment.start;
  }

  private firstSegmentIn(node: Node): Segment | null {
    for (const segment of this.segments) {
      if (segment.node === node || node.contains(segment.node)) return segment;
    }
    return null;
  }

  private lastSegmentIn(node: Node): Segment | null {
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const segment = this.segments[i];
      if (segment.node === node || node.contains(segment.node)) return segment;
    }
    return null;
  }

  /** A DOM range covering `[start, end)` of {@link text}, or null if unmappable. */
  toRange(start: number, end: number): Range | null {
    const from = this.locate(start);
    // `end` is exclusive, so it is resolved from the last included character —
    // otherwise a range ending exactly on a segment boundary lands on the next
    // node and the highlight spills into the following paragraph.
    const to = this.locate(Math.max(start, end - 1));
    if (!from || !to) return null;

    const range = document.createRange();
    range.setStart(from.node, from.offset);
    const lastSegment = this.segmentAt(Math.max(start, end - 1));
    if (!lastSegment) return null;
    const endOffsetInSegment = Math.max(start, end) - lastSegment.start;
    range.setEnd(lastSegment.node, this.normalisedToRaw(lastSegment, endOffsetInSegment));
    return range;
  }

  /** The bounding box of `[start, end)`, or null when it isn't laid out. */
  boundsOf(start: number, end: number): DOMRect | null {
    const range = this.toRange(start, end);
    if (!range) return null;
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
    if (rects.length === 0) {
      const fallback = range.getBoundingClientRect();
      return fallback.width || fallback.height ? fallback : null;
    }
    return rects[0];
  }

  private segmentAt(offset: number): Segment | null {
    // The segments partition `text` in order, so this is a plain binary search.
    let low = 0;
    let high = this.segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const segment = this.segments[mid];
      if (offset < segment.start) high = mid - 1;
      else if (offset >= segment.end) low = mid + 1;
      else return segment;
    }
    // An offset at the very end of the document belongs to the last segment.
    const last = this.segments[this.segments.length - 1];
    return last && offset === last.end ? last : null;
  }

  private locate(offset: number): { node: Text; offset: number } | null {
    const segment = this.segmentAt(offset);
    if (!segment) return null;
    return { node: segment.node, offset: this.normalisedToRaw(segment, offset - segment.start) };
  }

  private normalisedToRaw(segment: Segment, offsetInSegment: number): number {
    if (!segment.offsets) return Math.min(offsetInSegment, segment.node.data.length);
    if (offsetInSegment >= segment.offsets.length) return segment.node.data.length;
    return segment.offsets[offsetInSegment];
  }

  private rawToNormalised(segment: Segment, rawOffset: number): number {
    if (!segment.offsets) return Math.min(rawOffset, segment.end - segment.start);
    // offsets is strictly increasing — find the first entry at or past rawOffset.
    let low = 0;
    let high = segment.offsets.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (segment.offsets[mid] < rawOffset) low = mid + 1;
      else high = mid;
    }
    return low;
  }
}
