import { ScrollAnchor } from './scroll-anchor';

/**
 * Where the reader was in a document when the page went away, so a reload lands
 * them on the same passage instead of at the top. Kept per tab (sessionStorage):
 * another tab, or the same document opened tomorrow, starts at the top as before.
 */
const PREFIX = 'docuvault.readingPosition.';

export function rememberReadingPosition(key: string, anchor: ScrollAnchor | null): void {
  try {
    if (anchor) sessionStorage.setItem(PREFIX + key, JSON.stringify(anchor));
    else sessionStorage.removeItem(PREFIX + key);
  } catch {
    // Storage disabled (private mode): the reload simply starts at the top.
  }
}

/** The remembered place for [key], once: it is forgotten as it is handed out. */
export function takeReadingPosition(key: string): ScrollAnchor | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    sessionStorage.removeItem(PREFIX + key);
    const anchor = JSON.parse(raw) as ScrollAnchor;
    return typeof anchor?.ratio === 'number' ? anchor : null;
  } catch {
    return null;
  }
}
