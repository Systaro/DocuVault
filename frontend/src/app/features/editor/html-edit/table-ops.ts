/**
 * Table editing for the HTML editor, done straight on the DOM.
 *
 * `contenteditable` has no table commands of its own, so rows and columns are
 * built and removed here. Everything works off the cell the caret is in, and
 * nothing is written that the file did not already use: no inline styles, no
 * classes, no wrapper elements — the page's own CSS keeps deciding what a table
 * looks like.
 *
 * Cells that span columns are respected when counting positions, so editing a
 * table that already has a `colspan` does not shear its rows apart. Merging and
 * splitting cells is deliberately not offered.
 */

type Cell = HTMLTableCellElement;

/** Element the caret sits in, or null when the selection is outside the body. */
function selectedElement(doc: Document): Element | null {
  const node = doc.getSelection()?.anchorNode ?? null;
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

/** The `<td>`/`<th>` the caret is in, if any. */
export function cellAt(doc: Document): Cell | null {
  return selectedElement(doc)?.closest('td, th') ?? null;
}

/** The table the caret is in, if any. */
export function tableAt(doc: Document): HTMLTableElement | null {
  return cellAt(doc)?.closest('table') ?? null;
}

/** Every row of the table in document order, `<thead>` and `<tfoot>` included. */
function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return Array.from(table.querySelectorAll('tr')).filter(
    (row) => row.closest('table') === table
  );
}

function cellsOf(row: HTMLTableRowElement): Cell[] {
  return Array.from(row.children).filter(
    (child): child is Cell => child.tagName === 'TD' || child.tagName === 'TH'
  );
}

/** Column the cell starts at, counting the width of everything before it. */
function columnOf(cell: Cell): number {
  let column = 0;
  for (const sibling of cellsOf(cell.parentElement as HTMLTableRowElement)) {
    if (sibling === cell) break;
    column += sibling.colSpan || 1;
  }
  return column;
}

/** The cell covering `column` in this row, plus where that cell starts. */
function cellCovering(
  row: HTMLTableRowElement,
  column: number
): { cell: Cell; start: number } | null {
  let start = 0;
  for (const cell of cellsOf(row)) {
    const width = cell.colSpan || 1;
    if (column < start + width) return { cell, start };
    start += width;
  }
  return null;
}

/** An empty cell needs a `<br>`, or the caret cannot be placed inside it. */
function emptyCell(doc: Document, tag: 'td' | 'th'): Cell {
  const cell = doc.createElement(tag) as Cell;
  cell.appendChild(doc.createElement('br'));
  return cell;
}

function placeCaret(doc: Document, cell: Cell): void {
  const selection = doc.getSelection();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Replaces a cell with the same cell under a different tag, contents intact. */
function retag(cell: Cell, tag: 'td' | 'th'): Cell {
  const replacement = cell.ownerDocument.createElement(tag) as Cell;
  for (const attribute of Array.from(cell.attributes)) {
    replacement.setAttribute(attribute.name, attribute.value);
  }
  while (cell.firstChild) replacement.appendChild(cell.firstChild);
  cell.replaceWith(replacement);
  return replacement;
}

/**
 * Inserts a table at the caret. `insertHTML` is used rather than a raw node
 * insert because it is the browser's own job to decide how a block lands in the
 * middle of a paragraph — splitting it where that is what the markup requires.
 */
export function insertTable(doc: Document, rows: number, columns: number): boolean {
  const marker = 'dv-inserted-table';
  const header = `<tr>${'<th><br></th>'.repeat(columns)}</tr>`;
  const body = `<tr>${'<td><br></td>'.repeat(columns)}</tr>`.repeat(Math.max(rows - 1, 1));
  const html = `<table id="${marker}"><thead>${header}</thead><tbody>${body}</tbody></table>`;

  if (!doc.execCommand('insertHTML', false, html)) return false;

  const table = doc.getElementById(marker) as HTMLTableElement | null;
  if (!table) return true;
  table.removeAttribute('id');
  const first = table.querySelector('th, td') as Cell | null;
  if (first) placeCaret(doc, first);
  return true;
}

export function addRow(doc: Document, where: 'before' | 'after'): boolean {
  const cell = cellAt(doc);
  const row = cell?.parentElement as HTMLTableRowElement | undefined;
  if (!cell || !row) return false;

  // A row inserted above the header row joins the header; anywhere else it is
  // body content, so a row added below the header row is `<td>` even though it
  // was cloned from `<th>` cells.
  const header = where === 'before' && cellsOf(row).every((cell) => cell.tagName === 'TH');

  const added = doc.createElement('tr');
  for (const reference of cellsOf(row)) {
    const copy = emptyCell(doc, header ? 'th' : 'td');
    if (reference.colSpan > 1) copy.colSpan = reference.colSpan;
    added.appendChild(copy);
  }

  // A row added below the header belongs to the body, not the `<thead>`.
  const table = cell.closest('table');
  const body = table?.querySelector('tbody');
  if (where === 'after' && row.parentElement?.tagName === 'THEAD' && body) {
    body.insertBefore(added, body.firstChild);
  } else {
    row.parentElement?.insertBefore(added, where === 'before' ? row : row.nextSibling);
  }

  const first = cellsOf(added)[0];
  if (first) placeCaret(doc, first);
  return true;
}

export function deleteRow(doc: Document): boolean {
  const cell = cellAt(doc);
  const row = cell?.parentElement as HTMLTableRowElement | undefined;
  const table = cell?.closest('table');
  if (!cell || !row || !table) return false;

  // The last row taking the table with it is the honest outcome — an empty
  // `<table>` renders as nothing and cannot be clicked back into.
  if (rowsOf(table).length <= 1) {
    table.remove();
    return true;
  }

  const section = row.parentElement;
  row.remove();
  if (section && section !== table && !section.querySelector('tr')) section.remove();

  const next = table.querySelector('td, th') as Cell | null;
  if (next) placeCaret(doc, next);
  return true;
}

export function addColumn(doc: Document, where: 'before' | 'after'): boolean {
  const cell = cellAt(doc);
  const table = cell?.closest('table');
  if (!cell || !table) return false;

  const column = where === 'before'
    ? columnOf(cell)
    : columnOf(cell) + (cell.colSpan || 1) - 1;

  let caretCell: Cell | null = null;
  for (const row of rowsOf(table)) {
    const covering = cellCovering(row, column);
    if (!covering) {
      // Short row: the new column simply extends it.
      const appended = emptyCell(doc, cellsOf(row).every((c) => c.tagName === 'TH') ? 'th' : 'td');
      row.appendChild(appended);
      continue;
    }

    const { cell: neighbour, start } = covering;
    const width = neighbour.colSpan || 1;
    // A cell that spans across the insertion point grows instead of being split
    // — splitting it would move content into a column it never occupied.
    if (width > 1 && (where === 'before' ? start < column : start + width - 1 > column)) {
      neighbour.colSpan = width + 1;
      continue;
    }

    const added = emptyCell(doc, neighbour.tagName === 'TH' ? 'th' : 'td');
    neighbour.parentElement?.insertBefore(
      added,
      where === 'before' ? neighbour : neighbour.nextSibling
    );
    if (!caretCell && row === cell.parentElement) caretCell = added;
  }

  if (caretCell) placeCaret(doc, caretCell);
  return true;
}

export function deleteColumn(doc: Document): boolean {
  const cell = cellAt(doc);
  const table = cell?.closest('table');
  if (!cell || !table) return false;

  const column = columnOf(cell);
  const rows = rowsOf(table);

  // Removing the only column removes the table: what would be left has no cells
  // to type into.
  const widest = Math.max(
    ...rows.map((row) => cellsOf(row).reduce((sum, c) => sum + (c.colSpan || 1), 0))
  );
  if (widest <= 1) {
    table.remove();
    return true;
  }

  for (const row of rows) {
    const covering = cellCovering(row, column);
    if (!covering) continue;
    const width = covering.cell.colSpan || 1;
    if (width > 1) {
      covering.cell.colSpan = width - 1;
    } else {
      covering.cell.remove();
    }
  }

  for (const row of rows) {
    if (!cellsOf(row).length) row.remove();
  }

  const next = table.querySelector('td, th') as Cell | null;
  if (next) placeCaret(doc, next);
  return true;
}

/**
 * Turns the first row into a header row and back. The `<thead>` follows the
 * cells, because a `<thead>` full of `<td>` is markup no one writes by hand.
 */
export function toggleHeaderRow(doc: Document): boolean {
  const table = tableAt(doc);
  if (!table) return false;

  const first = rowsOf(table)[0];
  if (!first) return false;

  const cells = cellsOf(first);
  const isHeader = cells.length > 0 && cells.every((cell) => cell.tagName === 'TH');

  // Retagging replaces the cells, which leaves the caret pointing at a node
  // that is no longer in the document — and every following table command
  // works off the caret. Remember where it was and put it back afterwards.
  const caretCell = cellAt(doc);
  const caretIndex = caretCell && caretCell.parentElement === first
    ? cells.indexOf(caretCell)
    : -1;

  if (isHeader) {
    cells.forEach((cell) => retag(cell, 'td'));
    const head = first.closest('thead');
    if (head) {
      const body = table.querySelector('tbody') ?? table;
      body.insertBefore(first, body.firstChild);
      if (!head.querySelector('tr')) head.remove();
    }
  } else {
    cells.forEach((cell) => retag(cell, 'th'));
    if (!first.closest('thead')) {
      const head = doc.createElement('thead');
      first.parentElement?.removeChild(first);
      head.appendChild(first);
      table.insertBefore(head, table.firstChild);
    }
  }

  if (caretIndex >= 0) {
    const restored = cellsOf(first)[caretIndex];
    if (restored) placeCaret(doc, restored);
  }
  return true;
}

export function deleteTable(doc: Document): boolean {
  const table = tableAt(doc);
  if (!table) return false;
  table.remove();
  return true;
}
