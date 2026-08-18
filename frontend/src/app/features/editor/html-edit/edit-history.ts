/**
 * Undo/redo for the HTML editor's `contenteditable` surface.
 *
 * The browser keeps its own undo stack, but only for the edits it made itself:
 * anything we change through the DOM — inserting a table row, unwrapping a
 * link — is invisible to it, and undoing across such a change corrupts the
 * document. So the native stack is switched off (see `HtmlEditSession`) and
 * replaced by this one, which snapshots the whole body instead.
 *
 * Snapshots are coarse on purpose. Typing is coalesced into word- and
 * pause-sized steps so undo walks back the way people remember writing, while
 * every discrete command is its own step.
 */

/** Where the caret sat when a snapshot was taken, as a walk down from `<body>`. */
interface CaretPath {
  anchor: number[];
  anchorOffset: number;
  focus: number[];
  focusOffset: number;
}

interface Snapshot {
  html: string;
  caret: CaretPath | null;
}

/** Typing this long without a keystroke closes off the current undo step. */
const COALESCE_MS = 400;

/** How far back undo reaches. Snapshots are whole-body strings, so not forever. */
const MAX_ENTRIES = 200;

function pathTo(root: Node, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return current === root ? path : null;
}

function nodeAt(root: Node, path: number[]): Node | null {
  let node: Node = root;
  for (const index of path) {
    const next: Node | undefined = node.childNodes[index];
    if (!next) return null;
    node = next;
  }
  return node;
}

export class EditHistory {
  private entries: Snapshot[] = [];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param doc      the edited document — snapshots are of its `<body>`
   * @param onChange fired whenever undo/redo availability or content changed
   */
  constructor(
    private readonly doc: Document,
    private readonly onChange: () => void
  ) {
    this.entries = [this.snapshot()];
  }

  get canUndo(): boolean {
    return this.index > 0 || this.timer !== null;
  }

  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /**
   * A keystroke happened. `boundary` forces the step to close immediately —
   * used for whitespace and new paragraphs, which is where people expect one
   * undo to stop.
   */
  recordTyping(boundary: boolean): void {
    if (boundary) {
      this.record();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.push(this.snapshot());
    }, COALESCE_MS);
  }

  /**
   * Close off whatever is being typed *before* running a command, so the
   * command's effect never lands in the same undo step as the typing that
   * preceded it.
   */
  checkpoint(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.push(this.snapshot());
  }

  /** Record the result of a discrete change as its own step. */
  record(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.push(this.snapshot());
  }

  undo(): boolean {
    // Anything still being typed becomes its own step first, so that this undo
    // takes the document back to before the burst rather than into the middle
    // of it.
    this.checkpoint();
    if (this.index <= 0) return false;
    this.index--;
    this.apply(this.entries[this.index]);
    this.onChange();
    return true;
  }

  redo(): boolean {
    if (!this.canRedo) return false;
    this.index++;
    this.apply(this.entries[this.index]);
    this.onChange();
    return true;
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private push(snapshot: Snapshot): void {
    // A command that changed nothing (bold on an empty selection, a delete with
    // nothing selected) must not cost the user an undo step.
    if (snapshot.html === this.entries[this.index]?.html) return;

    this.entries.length = this.index + 1;
    this.entries.push(snapshot);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.index = this.entries.length - 1;
    this.onChange();
  }

  private snapshot(): Snapshot {
    return { html: this.doc.body.innerHTML, caret: this.caret() };
  }

  private apply(snapshot: Snapshot): void {
    this.doc.body.innerHTML = snapshot.html;
    this.restoreCaret(snapshot.caret);
  }

  private caret(): CaretPath | null {
    const selection = this.doc.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return null;
    const anchor = pathTo(this.doc.body, selection.anchorNode);
    const focus = pathTo(this.doc.body, selection.focusNode);
    if (!anchor || !focus) return null;
    return {
      anchor,
      anchorOffset: selection.anchorOffset,
      focus,
      focusOffset: selection.focusOffset
    };
  }

  /**
   * Puts the caret back where the snapshot had it. The document was rebuilt
   * from a string, so the nodes are new ones at the same positions — a path
   * that no longer resolves just means the caret is left alone.
   */
  private restoreCaret(caret: CaretPath | null): void {
    if (!caret) return;
    const anchor = nodeAt(this.doc.body, caret.anchor);
    const focus = nodeAt(this.doc.body, caret.focus);
    if (!anchor || !focus) return;

    const selection = this.doc.getSelection();
    if (!selection) return;
    try {
      const range = this.doc.createRange();
      range.setStart(anchor, Math.min(caret.anchorOffset, this.lengthOf(anchor)));
      range.setEnd(focus, Math.min(caret.focusOffset, this.lengthOf(focus)));
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // A path that resolved to a node of a different kind than it was taken
      // from: not worth failing an undo over.
    }
  }

  private lengthOf(node: Node): number {
    return node.nodeType === Node.TEXT_NODE
      ? (node as Text).length
      : node.childNodes.length;
  }
}
