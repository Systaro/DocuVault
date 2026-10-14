/** The thread card's own size, from annotation-thread.component. */
export const THREAD_WIDTH = 320;
export const THREAD_HEIGHT = 320;

/**
 * Where the thread card goes next to [passage], on whichever side has more room.
 *
 * A document is usually a column with margins either side, and which margin
 * is roomier depends on where the passage sits and how wide the window is —
 * so the side is measured rather than assumed. The card only falls back to
 * overlapping the text when neither margin can hold it.
 */
export function threadPositionBeside(passage: DOMRect, column: DOMRect | null): { x: number; y: number } {
  const gutter = 16;
  const roomLeft = passage.left;
  const roomRight = window.innerWidth - passage.right;
  const preferRight = roomRight >= roomLeft;

  // In the margin when the page has one to spare — there the card covers no
  // text at all, which is the whole point of putting it beside the passage.
  // A narrow window has no such margin, and then sitting next to the marked
  // words beats being pushed off to an edge far from them.
  const marginRight = column ? window.innerWidth - column.right : 0;
  const marginLeft = column ? column.left : 0;
  const fitsRightMargin = column && marginRight >= THREAD_WIDTH + gutter * 2;
  const fitsLeftMargin = column && marginLeft >= THREAD_WIDTH + gutter * 2;

  let x: number;
  if (preferRight && fitsRightMargin) x = column!.right + gutter;
  else if (!preferRight && fitsLeftMargin) x = column!.left - THREAD_WIDTH - gutter;
  else if (fitsRightMargin) x = column!.right + gutter;
  else if (fitsLeftMargin) x = column!.left - THREAD_WIDTH - gutter;
  else x = preferRight ? passage.right + gutter : passage.left - THREAD_WIDTH - gutter;

  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - THREAD_WIDTH - 8)),
    y: Math.min(Math.max(10, passage.top - 8), Math.max(10, window.innerHeight - THREAD_HEIGHT)),
  };
}
