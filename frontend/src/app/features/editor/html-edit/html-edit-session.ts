import { NgZone, signal } from '@angular/core';
import { EditHistory } from './edit-history';
import * as tables from './table-ops';

/** Which formatting the caret currently sits in — drives the toolbar's state. */
export interface ActiveFormats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  link: boolean;
  bulletList: boolean;
  orderedList: boolean;
  /** Lower-case tag of the block the caret is in (`h1`, `p`, `blockquote`, …). */
  block: string;
  table: boolean;
}

export type InlineFormat = 'bold' | 'italic' | 'underline' | 'strikeThrough';
export type BlockFormat = 'h1' | 'h2' | 'h3' | 'p' | 'blockquote' | 'pre';

const NO_FORMATS: ActiveFormats = {
  bold: false, italic: false, underline: false, strike: false, code: false,
  link: false, bulletList: false, orderedList: false, block: '', table: false
};

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'DIV', 'TD', 'TH'
]);

/**
 * The editing layer over one `contenteditable` document.
 *
 * Formatting goes through `execCommand`. It is deprecated and will not come
 * back, but it is also the only API that edits a live selection in every
 * browser we ship to, and — unlike a rewrite through an editor framework's own
 * document model — it leaves every element, attribute and comment it did not
 * touch exactly as the file had it. That is the whole point of editing an HTML
 * page in place: what comes out is the file that went in, plus the change.
 *
 * Undo is ours (see `EditHistory`), because table edits happen straight on the
 * DOM and the browser's own stack cannot see them.
 */
export class HtmlEditSession {
  /** Formatting under the caret, recomputed as the selection moves. */
  readonly formats = signal<ActiveFormats>(NO_FORMATS);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  /** Bumped whenever the user interacts inside the page — closes open menus. */
  readonly interaction = signal(0);

  private readonly history: EditHistory;
  private applying = false;

  /**
   * @param doc      the document being edited
   * @param zone     the iframe has its own window, so nothing in it is patched
   * @param onChange `true` once a change is a finished undo step
   */
  constructor(
    private readonly doc: Document,
    private readonly zone: NgZone,
    private readonly onChange: (committed: boolean) => void
  ) {
    // `<strong>`/`<em>` rather than `<span style="…">`: the file keeps using
    // the elements it already used, instead of collecting inline styles.
    try {
      doc.execCommand('styleWithCSS', false, 'false');
    } catch {
      // Not supported everywhere, and only affects which markup is produced.
    }

    this.history = new EditHistory(doc, () => this.afterHistoryChange());
    doc.addEventListener('beforeinput', this.onBeforeInput);
    doc.addEventListener('input', this.onInput);
    doc.addEventListener('keydown', this.onKeydown);
    doc.addEventListener('selectionchange', this.onSelectionChange);
    doc.addEventListener('pointerdown', this.onPointerDown);
    this.refreshFormats();
  }

  destroy(): void {
    this.history.destroy();
    this.doc.removeEventListener('beforeinput', this.onBeforeInput);
    this.doc.removeEventListener('input', this.onInput);
    this.doc.removeEventListener('keydown', this.onKeydown);
    this.doc.removeEventListener('selectionchange', this.onSelectionChange);
    this.doc.removeEventListener('pointerdown', this.onPointerDown);
  }

  /** The edited markup, as it stands right now. */
  html(): string {
    return this.doc.body.innerHTML;
  }

  // --- Events -------------------------------------------------------------

  /**
   * The browser's own undo would replay only the edits it made itself, skipping
   * every table and link change done through the DOM — so it is taken out of
   * the loop here and answered from our stack instead.
   */
  private onBeforeInput = (event: InputEvent): void => {
    if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
    event.preventDefault();
    this.zone.run(() => (event.inputType === 'historyUndo' ? this.undo() : this.redo()));
  };

  private onInput = (event: Event): void => {
    if (this.applying) return;
    const input = event as InputEvent;
    // Whitespace and new blocks end an undo step: that is where people expect
    // one press of undo to stop.
    const boundary =
      input.inputType?.startsWith('insertParagraph') ||
      input.inputType === 'insertLineBreak' ||
      input.inputType === 'insertFromPaste' ||
      input.inputType === 'insertFromDrop' ||
      /\s/.test(input.data ?? '');
    this.zone.run(() => {
      this.history.recordTyping(!!boundary);
      this.onChange(false);
    });
  };

  private onKeydown = (event: KeyboardEvent): void => {
    const accel = event.metaKey || event.ctrlKey;
    if (!accel) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      this.zone.run(() => (event.shiftKey ? this.redo() : this.undo()));
    } else if (key === 'y') {
      event.preventDefault();
      this.zone.run(() => this.redo());
    }
  };

  private onSelectionChange = (): void => {
    this.zone.run(() => this.refreshFormats());
  };

  private onPointerDown = (): void => {
    this.zone.run(() => this.interaction.update((n) => n + 1));
  };

  // --- Undo / redo --------------------------------------------------------

  undo(): void {
    this.run(() => this.history.undo());
  }

  redo(): void {
    this.run(() => this.history.redo());
  }

  private afterHistoryChange(): void {
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
  }

  /**
   * Rebuilding the body from a snapshot triggers no `input` event, so the
   * guard is only about commands that do — but it keeps the two paths from
   * ever recording each other.
   */
  private run(apply: () => boolean): void {
    this.applying = true;
    try {
      if (!apply()) return;
    } finally {
      this.applying = false;
    }
    this.refreshFormats();
    this.onChange(true);
  }

  // --- Commands -----------------------------------------------------------

  /** Runs a command as one undo step, whatever it does to the DOM. */
  private command(apply: () => boolean): void {
    this.doc.body.focus();
    this.history.checkpoint();
    this.applying = true;
    let changed = false;
    try {
      changed = apply();
    } finally {
      this.applying = false;
    }
    if (!changed) return;
    this.history.record();
    this.refreshFormats();
    this.onChange(true);
  }

  toggleInline(format: InlineFormat): void {
    this.command(() => this.doc.execCommand(format));
  }

  setBlock(block: BlockFormat): void {
    this.command(() => this.doc.execCommand('formatBlock', false, `<${block}>`));
  }

  toggleList(kind: 'bullet' | 'ordered'): void {
    this.command(() =>
      this.doc.execCommand(kind === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList')
    );
  }

  clearFormatting(): void {
    this.command(() => {
      const removed = this.doc.execCommand('removeFormat');
      // `removeFormat` leaves links alone, which is not what "clear formatting"
      // means to anyone using it.
      return this.doc.execCommand('unlink') || removed;
    });
  }

  /** Wraps the selection in `<code>`, or unwraps it when it already is. */
  toggleCode(): void {
    this.command(() => {
      const existing = this.elementAt()?.closest('code');
      if (existing) {
        const parent = existing.parentNode;
        if (!parent) return false;
        while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
        existing.remove();
        return true;
      }

      const range = this.doc.getSelection()?.getRangeAt(0);
      if (!range || range.collapsed) return false;
      const code = this.doc.createElement('code');
      try {
        range.surroundContents(code);
      } catch {
        // The selection crosses element boundaries, so it cannot be wrapped as
        // one piece — extracting it first is lossless here because the contents
        // go back in unchanged.
        code.appendChild(range.extractContents());
        range.insertNode(code);
      }
      return true;
    });
  }

  /** The link under the caret, so its address can be shown for editing. */
  currentLink(): string {
    return this.elementAt()?.closest('a')?.getAttribute('href') ?? '';
  }

  setLink(href: string, saved: Range | null): void {
    this.command(() => {
      this.restore(saved);
      const existing = this.elementAt()?.closest('a');
      if (existing) {
        existing.setAttribute('href', href);
        return true;
      }
      return this.doc.execCommand('createLink', false, href);
    });
  }

  removeLink(saved: Range | null): void {
    this.command(() => {
      this.restore(saved);
      return this.doc.execCommand('unlink');
    });
  }

  // --- Tables -------------------------------------------------------------

  insertTable(): void {
    this.command(() => tables.insertTable(this.doc, 3, 3));
  }

  addRow(where: 'before' | 'after'): void {
    this.command(() => tables.addRow(this.doc, where));
  }

  deleteRow(): void {
    this.command(() => tables.deleteRow(this.doc));
  }

  addColumn(where: 'before' | 'after'): void {
    this.command(() => tables.addColumn(this.doc, where));
  }

  deleteColumn(): void {
    this.command(() => tables.deleteColumn(this.doc));
  }

  toggleHeaderRow(): void {
    this.command(() => tables.toggleHeaderRow(this.doc));
  }

  deleteTable(): void {
    this.command(() => tables.deleteTable(this.doc));
  }

  // --- Selection ----------------------------------------------------------

  /**
   * Keeps hold of the selection before focus moves to a toolbar field. The
   * document keeps its own selection while unfocused, but a click that lands in
   * the page first would move it.
   */
  capture(): Range | null {
    const selection = this.doc.getSelection();
    return selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  }

  private restore(range: Range | null): void {
    if (!range) return;
    const selection = this.doc.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private elementAt(): Element | null {
    const node = this.doc.getSelection()?.anchorNode ?? null;
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  }

  private state(command: string): boolean {
    try {
      return this.doc.queryCommandState(command);
    } catch {
      return false;
    }
  }

  private refreshFormats(): void {
    const element = this.elementAt();
    if (!element || !this.doc.body.contains(element)) {
      this.formats.set(NO_FORMATS);
      return;
    }

    let block = '';
    for (let node: Element | null = element; node && node !== this.doc.body; node = node.parentElement) {
      if (BLOCK_TAGS.has(node.tagName)) {
        block = node.tagName.toLowerCase();
        break;
      }
    }

    this.formats.set({
      bold: this.state('bold'),
      italic: this.state('italic'),
      underline: this.state('underline'),
      strike: this.state('strikeThrough'),
      code: !!element.closest('code'),
      link: !!element.closest('a'),
      bulletList: !!element.closest('ul'),
      orderedList: !!element.closest('ol'),
      block,
      table: !!element.closest('table')
    });
  }
}
