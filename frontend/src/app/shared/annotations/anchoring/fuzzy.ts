/**
 * Approximate substring search, used when a comment's quote no longer occurs
 * verbatim — a typo was fixed, a clause reworded, a name changed.
 *
 * Deliberately not a full Myers bit-vector matcher: candidate positions are
 * generated from short probes taken out of the needle, and only those few
 * windows are scored properly. A rewrite that survives has almost always kept
 * *some* run of characters intact, and probing for those is both simpler to
 * reason about and fast enough to run on every render.
 */

export interface FuzzyMatch {
  start: number;
  end: number;
  /** 0…1, where 1 is character-identical. */
  similarity: number;
}

/**
 * Probe length. Long enough to be reasonably distinctive, short enough that an
 * edit somewhere in the quote still leaves whole probes intact. Twenty-four was
 * the first guess and it was too long: capitalising one word inside a
 * forty-character quote knocked out every probe and orphaned the comment.
 */
const PROBE = 12;
/** How many probes to take across the needle. More probes, more resilience. */
const PROBE_COUNT = 8;
/** Ceiling on windows scored per search, nearest the expected position first. */
const MAX_CANDIDATES = 200;

/**
 * Find `needle` in `haystack`, tolerating edits.
 *
 * `expected` biases both which candidates get scored and how ties break, so a
 * paragraph that merely shifted down the page is preferred over an identical
 * sentence somewhere else in the document.
 */
export function fuzzyFind(
  haystack: string,
  needle: string,
  expected: number,
  minSimilarity = 0.72
): FuzzyMatch | null {
  if (!needle || !haystack) return null;
  if (needle.length > haystack.length) return null;

  const candidates = collectCandidates(haystack, needle, expected);
  if (candidates.length === 0) return null;

  let best: FuzzyMatch | null = null;
  let bestScore = -Infinity;

  // An edit changes the passage's length as well as its wording, so a window of
  // exactly the old length would cut the match off mid-word. A few lengths
  // around it are tried and the best kept, which is also what makes the
  // resulting highlight land on whole words.
  const slack = Math.max(2, Math.ceil(needle.length * 0.2));
  const lengths = [needle.length, needle.length + slack, needle.length - slack]
    .filter(length => length > 0)
    .filter((length, i, all) => all.indexOf(length) === i);

  for (const start of candidates) {
    for (const length of lengths) {
      const window = haystack.substr(start, length);
      if (!window) continue;
      const similarity = similarityOf(needle, window);
      if (similarity < minSimilarity) continue;

      // Distance only ever breaks ties between comparable matches — at most it
      // can shade a match by 0.05, so a clearly better text match always wins.
      const drift = Math.abs(start - expected) / Math.max(haystack.length, 1);
      const score = similarity - drift * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = { start, end: start + window.length, similarity };
      }
    }
  }

  return best;
}

/**
 * Plausible starting offsets, from short probes spread evenly across the needle.
 *
 * Probing is case-insensitive on purpose. Case changes are among the most common
 * small edits ("postgres" → "Postgres") and are nearly free in edit distance, so
 * letting them eliminate a candidate before it is ever scored throws away
 * matches the scorer would have accepted comfortably.
 */
function collectCandidates(haystack: string, needle: string, expected: number): number[] {
  const probeLength = Math.min(PROBE, needle.length);
  const span = Math.max(0, needle.length - probeLength);
  const step = PROBE_COUNT > 1 ? span / (PROBE_COUNT - 1) : 0;

  const probeOffsets = Array.from({ length: PROBE_COUNT }, (_, i) => Math.round(i * step))
    .filter((offset, i, all) => all.indexOf(offset) === i);

  const hay = haystack.toLowerCase();
  const pin = needle.toLowerCase();

  const starts = new Set<number>();
  const limit = Math.max(0, haystack.length - needle.length);
  for (const offset of probeOffsets) {
    const probe = pin.substr(offset, probeLength);
    if (!probe.trim()) continue;
    let at = hay.indexOf(probe);
    while (at !== -1) {
      starts.add(Math.max(0, Math.min(at - offset, limit)));
      if (starts.size > MAX_CANDIDATES * 4) break;
      at = hay.indexOf(probe, at + 1);
    }
  }

  return Array.from(starts)
    .sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected))
    .slice(0, MAX_CANDIDATES);
}

/** 1 − normalised edit distance, computed with a bounded two-row Levenshtein. */
export function similarityOf(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const distance = levenshtein(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshtein(a: string, b: string): number {
  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    const charA = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (charA === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length];
}
