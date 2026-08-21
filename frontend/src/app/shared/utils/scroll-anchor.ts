import { TextIndex } from '../annotations/anchoring/text-index';

/**
 * Keeping the reader's place when a document is re-rendered into a different
 * view — read mode to the editor and back.
 *
 * Pixel offsets don't survive the trip: the read view runs Markdown through
 * highlight.js, Mermaid and draw.io, while TipTap renders its own markup, so
 * the same document is a different height in each. Restoring `scrollTop` puts
 * you somewhere plausible but wrong, and the longer the document the further
 * wrong it gets.
 *
 * So the place is remembered as *text* — the words at the top of the viewport —
 * and found again by searching for them in the new rendering. Same idea as the
 * comment anchors, and the same {@link TextIndex} behind it.
 */

export interface ScrollAnchor {
  /** The words that were at the top of the viewport. */
  quote: string;
  /** How far below the container's top edge they sat, in pixels. */
  offsetFromTop: number;
  /** Fallback for when the text can't be found again. */
  ratio: number;
}

/** Enough words to be locatable, few enough to survive a re-render. */
const QUOTE_LENGTH = 80;

/**
 * Describe what the reader is currently looking at. Returns null when the
 * document is too short to have scrolled, or has no text to anchor to.
 */
export function captureScrollAnchor(container: HTMLElement, content: HTMLElement): ScrollAnchor | null {
  const ratio = container.scrollHeight > container.clientHeight
    ? container.scrollTop / (container.scrollHeight - container.clientHeight)
    : 0;

  // Nothing to preserve at the very top — and restoring there is the one case
  // the current behaviour already gets right.
  if (container.scrollTop < 4) return null;

  const index = TextIndex.build(content);
  if (!index.text.trim()) return null;

  const containerTop = container.getBoundingClientRect().top;
  const found = firstVisibleOffset(index, containerTop);
  if (found === null) return { quote: '', offsetFromTop: 0, ratio };

  return {
    quote: index.text.slice(found.offset, found.offset + QUOTE_LENGTH),
    offsetFromTop: found.offsetFromTop,
    ratio
  };
}

/**
 * Scroll the new rendering so the remembered words sit where they were. Falls
 * back to the proportional position when they can't be found — a heading that
 * only exists in one of the two renderings, say.
 */
export function restoreScrollAnchor(
  container: HTMLElement,
  content: HTMLElement,
  anchor: ScrollAnchor | null
): void {
  if (!anchor) return;

  const applyRatio = () => {
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = max * anchor.ratio;
  };

  if (!anchor.quote.trim()) {
    applyRatio();
    return;
  }

  const index = TextIndex.build(content);
  const at = index.text.indexOf(anchor.quote);
  if (at < 0) {
    // Try a shorter prefix before giving up — the tail of the quote may have
    // been re-wrapped or lost a soft hyphen between renderings.
    const shorter = anchor.quote.slice(0, 32).trim();
    const fallbackAt = shorter ? index.text.indexOf(shorter) : -1;
    if (fallbackAt < 0) {
      applyRatio();
      return;
    }
    scrollTo(container, index, fallbackAt, anchor.offsetFromTop) || applyRatio();
    return;
  }

  if (!scrollTo(container, index, at, anchor.offsetFromTop)) applyRatio();
}

function scrollTo(
  container: HTMLElement,
  index: TextIndex,
  offset: number,
  offsetFromTop: number
): boolean {
  const range = index.toRange(offset, offset + 1);
  if (!range) return false;
  const box = range.getBoundingClientRect();
  if (!box.height && !box.width) return false;

  const containerTop = container.getBoundingClientRect().top;
  container.scrollTop += box.top - containerTop - offsetFromTop;
  return true;
}

/**
 * The first character of the index that is painted at or below the container's
 * top edge — i.e. the first thing the reader can actually see. Binary search,
 * because measuring every character of a long document on every mode switch is
 * a lot of layout work for one number.
 */
function firstVisibleOffset(
  index: TextIndex,
  containerTop: number
): { offset: number; offsetFromTop: number } | null {
  const total = index.text.length;
  if (!total) return null;

  let low = 0;
  let high = total - 1;
  let best: { offset: number; offsetFromTop: number } | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = index.toRange(mid, mid + 1);
    const box = range?.getBoundingClientRect();
    if (!box || (!box.height && !box.width)) {
      // Unrenderable position (inside a collapsed node) — step past it.
      low = mid + 1;
      continue;
    }
    if (box.top >= containerTop) {
      best = { offset: mid, offsetFromTop: box.top - containerTop };
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return best;
}
