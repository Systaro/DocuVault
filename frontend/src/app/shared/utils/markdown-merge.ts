/**
 * Minimal-diff merge for WYSIWYG markdown saves.
 *
 * The TipTap round-trip (marked → editor → turndown) re-emits the whole file
 * in the serializer's canonical style, which reformats content the user never
 * touched and destroys git diffs for externally-authored files. This merge
 * keeps every block the user did NOT edit byte-identical to the original file
 * and only lets the serializer's formatting through for blocks that actually
 * changed:
 *
 *   original  — the file as loaded from git
 *   baseline  — the serializer's output for the UNTOUCHED document
 *               (captured right after the editor is initialised)
 *   edited    — the serializer's output at save time
 *
 * Blocks are compared baseline↔edited with exact equality (both are
 * serializer output, so an untouched block is byte-identical — a real user
 * edit can never be mistaken for round-trip noise). Untouched blocks are then
 * mapped back to their original counterpart with a loose, formatting-agnostic
 * comparison and emitted verbatim from the original.
 */

interface OriginalBlock {
  text: string;
  /** Blank-line separator that followed this block in the original. */
  separator: string;
}

/** Tracks fenced-code state across lines; a fence only closes on the same
 *  character with at least the opening length. */
function makeFenceTracker(): (line: string) => boolean {
  let fence: { char: string; len: number } | null = null;
  return (line: string): boolean => {
    const match = line.match(/^\s*(`{3,}|~{3,})/);
    if (match) {
      const char = match[1][0];
      const len = match[1].length;
      if (fence === null) {
        fence = { char, len };
      } else if (char === fence.char && len >= fence.len) {
        fence = null;
        return true; // the closing line itself is still inside the block
      }
    }
    return fence !== null;
  };
}

/** Split markdown into blank-line-separated blocks, keeping fenced code blocks intact. */
function splitBlocks(markdown: string): string[] {
  return splitBlocksWithSeparators(markdown).map(b => b.text);
}

/** Split into blocks, remembering the exact blank-line runs so untouched
 *  regions keep their original vertical spacing. */
function splitBlocksWithSeparators(markdown: string): OriginalBlock[] {
  const lines = markdown.split('\n');
  const blocks: OriginalBlock[] = [];
  let current: string[] = [];
  const inFence = makeFenceTracker();

  const flush = () => {
    if (current.length) {
      blocks.push({ text: current.join('\n'), separator: '' });
      current = [];
    }
  };

  for (const line of lines) {
    const insideFence = inFence(line);
    if (!insideFence && line.trim() === '') {
      flush();
      if (blocks.length) blocks[blocks.length - 1].separator += '\n';
      continue;
    }
    current.push(line);
  }
  flush();
  // Separators are stored as "number of blank lines"; render as newline runs
  // (one blank line between blocks = "\n\n" when joining text + separator).
  for (const block of blocks) {
    if (block.separator) block.separator = '\n' + block.separator;
  }
  return blocks;
}

/**
 * Formatting-agnostic comparison key: neutralises everything the
 * marked→TipTap→turndown round-trip changes on untouched content (escaping,
 * list markers, hard wraps, emphasis delimiters, spacing) while keeping the
 * actual text.
 */
function normalizeBlock(block: string): string {
  return block
    // strip backslash escapes turndown adds (\* \_ \[ \# \. …)
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
    // unify unordered list markers
    .replace(/^(\s*)[*+]\s+/gm, '$1- ')
    // unify ordered list "1)" vs "1."
    .replace(/^(\s*\d+)\)\s+/gm, '$1. ')
    // unify emphasis delimiters
    .replace(/__/g, '**')
    // setext headings → text only (ATX conversion changes the block shape)
    .replace(/^(=+|-{2,})\s*$/gm, '')
    // strip emphasis/code markers entirely — the exact-equality pass against
    // the baseline already guarantees user edits are never matched loosely
    .replace(/[*_`]/g, '')
    // collapse all whitespace (joins hard-wrapped lines)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Longest-common-subsequence pairing of two block arrays under a comparator. */
function lcsPairs(
  a: string[],
  b: string[],
  equals: (x: string, y: string) => boolean
): Map<number, number> {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = equals(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = new Map<number, number>();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (equals(a[i], b[j])) {
      pairs.set(i, j);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Merge the user's edits into the original file, preserving the original
 * bytes of every block the user did not touch.
 */
export function mergeMarkdownEdits(original: string, baseline: string, edited: string): string {
  if (baseline === edited) return original;

  const originalBlocks = splitBlocksWithSeparators(original);
  const baselineBlocks = splitBlocks(baseline);
  const editedBlocks = splitBlocks(edited);

  // Which edited blocks are untouched serializer output? (exact match)
  const editedToBaseline = lcsPairs(editedBlocks, baselineBlocks, (x, y) => x === y);

  // Map baseline blocks back to their original counterparts (loose match).
  const baselineToOriginal = lcsPairs(
    baselineBlocks,
    originalBlocks.map(b => b.text),
    (x, y) => normalizeBlock(x) === normalizeBlock(y)
  );

  const parts: string[] = [];
  editedBlocks.forEach((block, index) => {
    const baselineIndex = editedToBaseline.get(index);
    const originalIndex = baselineIndex !== undefined ? baselineToOriginal.get(baselineIndex) : undefined;
    if (originalIndex !== undefined) {
      const originalBlock = originalBlocks[originalIndex];
      parts.push(originalBlock.text + (index < editedBlocks.length - 1 ? (originalBlock.separator || '\n\n') : ''));
    } else {
      parts.push(block + (index < editedBlocks.length - 1 ? '\n\n' : ''));
    }
  });

  let merged = parts.join('');
  // Preserve the original file's trailing-newline convention.
  const trailing = original.match(/\n*$/)?.[0] ?? '';
  merged = merged.replace(/\n*$/, '') + trailing;
  return merged;
}
