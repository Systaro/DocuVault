import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component, HostListener, computed, effect, input, signal } from '@angular/core';
import { HtmlEditSession } from './html-edit-session';

/** Rejects addresses that would turn a link into a script the moment it is clicked. */
const UNSAFE_SCHEME = /^\s*(javascript|vbscript|data):/i;
/** Anything already carrying a scheme, or pointing inside the space. */
const ADDRESSED = /^([a-z][a-z0-9+.-]*:|\/|#|\.{1,2}\/)/i;

/**
 * Formatting toolbar for the HTML editor.
 *
 * Every button acts on the selection inside the edited page and is disabled or
 * highlighted from `HtmlEditSession.formats()`, so the bar always shows what
 * the caret is actually sitting in.
 */
@Component({
  selector: 'app-html-edit-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="format-bar">
      <button
        type="button" class="format-btn" [disabled]="!session().canUndo()"
        (click)="session().undo()" title="Undo (⌘Z)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
        </svg>
      </button>
      <button
        type="button" class="format-btn" [disabled]="!session().canRedo()"
        (click)="session().redo()" title="Redo (⇧⌘Z)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6"/>
        </svg>
      </button>

      <div class="format-divider"></div>

      <button type="button" class="format-btn" [class.active]="f().bold" (click)="session().toggleInline('bold')" title="Bold (⌘B)"><b>B</b></button>
      <button type="button" class="format-btn" [class.active]="f().italic" (click)="session().toggleInline('italic')" title="Italic (⌘I)"><i>I</i></button>
      <button type="button" class="format-btn" [class.active]="f().underline" (click)="session().toggleInline('underline')" title="Underline (⌘U)"><u>U</u></button>
      <button type="button" class="format-btn" [class.active]="f().strike" (click)="session().toggleInline('strikeThrough')" title="Strikethrough"><s>S</s></button>
      <button type="button" class="format-btn" [class.active]="f().code" (click)="session().toggleCode()" title="Inline code">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg>
      </button>

      <div class="format-divider"></div>

      <button type="button" class="format-btn" [class.active]="f().block === 'h1'" (click)="session().setBlock('h1')" title="Heading 1">H1</button>
      <button type="button" class="format-btn" [class.active]="f().block === 'h2'" (click)="session().setBlock('h2')" title="Heading 2">H2</button>
      <button type="button" class="format-btn" [class.active]="f().block === 'h3'" (click)="session().setBlock('h3')" title="Heading 3">H3</button>
      <button type="button" class="format-btn" [class.active]="f().block === 'p'" (click)="session().setBlock('p')" title="Paragraph">¶</button>

      <div class="format-divider"></div>

      <button type="button" class="format-btn" [class.active]="f().bulletList" (click)="session().toggleList('bullet')" title="Bullet list">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
      <button type="button" class="format-btn" [class.active]="f().orderedList" (click)="session().toggleList('ordered')" title="Numbered list">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
      </button>
      <button type="button" class="format-btn" [class.active]="f().block === 'blockquote'" (click)="session().setBlock('blockquote')" title="Blockquote">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10.5H6a2 2 0 01-2-2v-1a2 2 0 012-2h2m6 0h2a2 2 0 012 2v1a2 2 0 01-2 2h-2m-6 5h6"/></svg>
      </button>
      <button type="button" class="format-btn" [class.active]="f().block === 'pre'" (click)="session().setBlock('pre')" title="Code block">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM8 10l-2 2 2 2m8-4l2 2-2 2"/></svg>
      </button>

      <div class="format-divider"></div>

      <div class="format-anchor">
        <button type="button" class="format-btn" [class.active]="f().link" (click)="openLink($event)" title="Link">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5m4.5-4.5l1.5-1.5a4 4 0 115.656 5.656l-3 3a4 4 0 01-5.656 0"/></svg>
        </button>
        @if (showLink()) {
          <div class="format-popover" (click)="$event.stopPropagation()">
            <label class="format-popover-label" for="html-edit-link">Link address</label>
            <input
              id="html-edit-link"
              type="text"
              class="format-popover-input"
              placeholder="https://example.com or ./page.html"
              [(ngModel)]="linkUrl"
              (keydown.enter)="applyLink()"
              (keydown.escape)="closeMenus()"
            />
            @if (linkError()) {
              <p class="format-popover-error">{{ linkError() }}</p>
            }
            <div class="format-popover-actions">
              @if (f().link) {
                <button type="button" class="format-popover-btn" (click)="removeLink()">Remove</button>
              }
              <button type="button" class="format-popover-btn format-popover-btn--primary" (click)="applyLink()">Apply</button>
            </div>
          </div>
        }
      </div>

      <div class="format-anchor">
        <button type="button" class="format-btn" [class.active]="f().table" (click)="openTable($event)" title="Table">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h18M3 12h18M3 19h18M9 5v14M15 5v14M4 5a1 1 0 00-1 1v12a1 1 0 001 1h16a1 1 0 001-1V6a1 1 0 00-1-1H4z"/>
          </svg>
        </button>
        @if (showTable()) {
          <div class="format-menu" (click)="$event.stopPropagation()">
            <button type="button" class="format-menu-item" (click)="run(insertTable)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM4 10h16M10 5v14"/></svg>
              Insert table
            </button>
            <div class="format-menu-divider"></div>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(addColumnBefore)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 9h4M7 7v4"/></svg>
              Add column left
            </button>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(addColumnAfter)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M15 9h4M17 7v4"/></svg>
              Add column right
            </button>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(addRowBefore)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 7h6M12 5v4"/></svg>
              Add row above
            </button>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(addRowAfter)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 17h6M12 15v4"/></svg>
              Add row below
            </button>
            <div class="format-menu-divider"></div>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(toggleHeaderRow)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5h16v14H4zM4 9h16"/></svg>
              Toggle header row
            </button>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(deleteColumn)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14M5 9l4 4M9 9l-4 4"/></svg>
              Delete column
            </button>
            <button type="button" class="format-menu-item" [disabled]="!f().table" (click)="run(deleteRow)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M9 9l4 4M13 9l-4 4"/></svg>
              Delete row
            </button>
            <div class="format-menu-divider"></div>
            <button type="button" class="format-menu-item format-menu-item--danger" [disabled]="!f().table" (click)="run(deleteTable)">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-1 12a2 2 0 01-2 2H8a2 2 0 01-2-2L5 7m5 4v6m4-6v6M4 7h16M10 4h4"/></svg>
              Delete table
            </button>
          </div>
        }
      </div>

      <div class="format-divider"></div>

      <button type="button" class="format-btn" (click)="session().clearFormatting()" title="Clear formatting">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7V5h12v2M9 5v12m-3 0h6m4-1l4 4m0-4l-4 4"/></svg>
      </button>
    </div>
  `,
  styles: [`
    .format-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 2px;
      padding: 6px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }

    .format-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      padding: 6px 8px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--text-secondary);
      font-size: 0.8125rem;
      font-weight: 600;
      line-height: 1;
      cursor: pointer;

      &:hover:not(:disabled) { background: var(--background); }
      &.active { background: var(--background); color: var(--primary); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .format-divider {
      width: 1px;
      height: 20px;
      margin: 0 4px;
      background: var(--border);
    }

    .format-anchor {
      position: relative;
      display: flex;
    }

    .format-menu {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      min-width: 200px;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow-lg);
      z-index: 60;
    }

    .format-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: none;
      border-radius: 6px;
      background: none;
      color: var(--text-primary);
      font-size: 0.875rem;
      white-space: nowrap;
      text-align: left;
      cursor: pointer;

      &:hover:not(:disabled) { background: var(--background); }
      &:disabled { opacity: 0.4; cursor: default; }
      &--danger { color: var(--danger, #dc2626); }
    }

    .format-menu-divider {
      height: 1px;
      margin: 4px 0;
      background: var(--border);
    }

    .format-popover {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      width: 280px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow-lg);
      z-index: 60;
    }

    .format-popover-label {
      display: block;
      margin-bottom: 6px;
      color: var(--text-secondary);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .format-popover-input {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--background);
      color: var(--text-primary);
      font-size: 0.8125rem;

      &:focus { outline: none; border-color: var(--primary); }
    }

    .format-popover-error {
      margin-top: 6px;
      color: var(--danger, #dc2626);
      font-size: 0.75rem;
    }

    .format-popover-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 10px;
    }

    .format-popover-btn {
      padding: 5px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 0.75rem;
      cursor: pointer;

      &:hover { background: var(--background); color: var(--text-primary); }

      &--primary {
        border-color: transparent;
        background: var(--primary);
        color: white;
        font-weight: 600;

        &:hover { background: var(--primary-dark); color: white; }
      }
    }
  `]
})
export class HtmlEditToolbarComponent {
  readonly session = input.required<HtmlEditSession>();

  showTable = signal(false);
  showLink = signal(false);
  linkUrl = '';
  linkError = signal('');

  /** Selection as it was before focus moved into the link field. */
  private savedRange: Range | null = null;

  constructor() {
    // Clicking into the page happens inside the iframe, where a document-level
    // click listener out here never fires — so the session reports it instead.
    effect(() => {
      this.session().interaction();
      this.closeMenus();
    }, { allowSignalWrites: true });
  }

  /** Shorthand the template uses a lot. */
  readonly f = computed(() => this.session().formats());

  @HostListener('document:click')
  closeMenus(): void {
    this.showTable.set(false);
    this.showLink.set(false);
    this.linkError.set('');
  }

  openTable(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.showTable();
    this.closeMenus();
    this.showTable.set(open);
  }

  openLink(event: MouseEvent): void {
    event.stopPropagation();
    const open = !this.showLink();
    this.savedRange = this.session().capture();
    this.linkUrl = this.session().currentLink();
    this.closeMenus();
    this.showLink.set(open);
  }

  applyLink(): void {
    const href = this.normalise(this.linkUrl);
    if (!href) return;
    this.session().setLink(href, this.savedRange);
    this.closeMenus();
  }

  removeLink(): void {
    this.session().removeLink(this.savedRange);
    this.closeMenus();
  }

  /** Runs a table command and closes the menu. */
  run(command: () => void): void {
    command();
    this.closeMenus();
  }

  // Bound so they survive being passed to `run()` from the template.
  insertTable = () => this.session().insertTable();
  addRowBefore = () => this.session().addRow('before');
  addRowAfter = () => this.session().addRow('after');
  addColumnBefore = () => this.session().addColumn('before');
  addColumnAfter = () => this.session().addColumn('after');
  deleteRow = () => this.session().deleteRow();
  deleteColumn = () => this.session().deleteColumn();
  toggleHeaderRow = () => this.session().toggleHeaderRow();
  deleteTable = () => this.session().deleteTable();

  /**
   * The saved page is served to readers, so an address that would run as script
   * when clicked never makes it into the file.
   */
  private normalise(input: string): string | null {
    const value = input.trim();
    if (!value) {
      this.linkError.set('Enter an address first.');
      return null;
    }
    if (UNSAFE_SCHEME.test(value)) {
      this.linkError.set('That kind of address is not allowed in a link.');
      return null;
    }
    return ADDRESSED.test(value) ? value : `https://${value}`;
  }
}
