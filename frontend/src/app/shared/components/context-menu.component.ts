import {
  Component, ElementRef, HostListener, OnDestroy, OnInit,
  ViewEncapsulation, input, output, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface ContextMenuItem {
  id: string;
  label: string;
  /** Material icon ligature. */
  icon?: string;
  /** Greyed out and unclickable, with the reason as a tooltip. */
  disabled?: boolean;
  disabledReason?: string;
  /** Renders in the danger colour and sits below a divider. */
  danger?: boolean;
  /** Short right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
}

/**
 * A right-click menu, positioned at the pointer and attached to `<body>`.
 *
 * The host element is moved to the body on init rather than left where it was
 * declared: every surface this opens over is inside a scrolling, clipped
 * container, and a menu that renders in place gets cut off at the container's
 * edge or trapped behind a sibling's stacking context. Being a direct child of
 * the body is what lets it sit over everything and spill past the fold.
 */
@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="context-menu"
      role="menu"
      [style.left.px]="left()"
      [style.top.px]="top()"
      (contextmenu)="$event.preventDefault()"
    >
      @for (item of items(); track item.id) {
        @if (item.danger && !$first) {
          <div class="context-menu-divider"></div>
        }
        <button
          type="button"
          role="menuitem"
          class="context-menu-item"
          [class.danger]="item.danger"
          [disabled]="item.disabled"
          [title]="item.disabled ? (item.disabledReason ?? '') : ''"
          (click)="choose(item)"
        >
          @if (item.icon) {
            <span translate="no" class="material-icons context-menu-icon">{{ item.icon }}</span>
          }
          <span class="context-menu-label">{{ item.label }}</span>
          @if (item.hint) {
            <span class="context-menu-hint">{{ item.hint }}</span>
          }
        </button>
      }
    </div>
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    app-context-menu { position: static; }

    .context-menu {
      position: fixed;
      min-width: 210px;
      max-width: 300px;
      padding: 4px;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: var(--radius-md, 8px);
      background: var(--surface, #fff);
      box-shadow: var(--shadow-xl, 0 12px 32px rgba(0, 0, 0, 0.18));
      /* Above the annotation layer (max 400) and dialogs (500); below toasts. */
      z-index: 600;
      animation: context-menu-in 0.09s ease-out;
    }

    @keyframes context-menu-in {
      from { opacity: 0; transform: translateY(-2px); }
      to { opacity: 1; transform: none; }
    }

    @media (prefers-reduced-motion: reduce) {
      .context-menu { animation: none; }
    }

    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: var(--radius-sm, 6px);
      background: none;
      color: var(--text-primary, #12262a);
      font-size: 13.5px;
      text-align: left;
      cursor: pointer;
    }

    .context-menu-item:hover:not(:disabled) { background: var(--background, #f6f6f2); }

    .context-menu-item:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .context-menu-item.danger { color: var(--danger, #a94b3c); }
    .context-menu-item.danger:hover:not(:disabled) { background: rgba(169, 75, 60, 0.08); }

    .context-menu-icon {
      font-size: 18px;
      flex-shrink: 0;
      color: var(--text-muted, #7a9a9d);
    }

    .context-menu-item.danger .context-menu-icon { color: inherit; }

    /* The label names the action, so it is the last thing that may be cut.
       Giving it flex:1 with a shrinkable hint beside it did the opposite:
       a long hint held its width and truncated "Comment on selection" down
       to "Comment o…", which is the one part of the row nobody can guess. */
    .context-menu-label {
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .context-menu-hint {
      flex: 0 1 auto;
      min-width: 0;
      margin-left: auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 11.5px;
      color: var(--text-muted, #7a9a9d);
    }

    .context-menu-divider {
      height: 1px;
      margin: 4px 6px;
      background: var(--border, #d4e5e7);
    }
  `]
})
export class ContextMenuComponent implements OnInit, OnDestroy {
  items = input.required<ContextMenuItem[]>();
  /** Where the pointer was, in viewport coordinates. */
  x = input.required<number>();
  y = input.required<number>();

  readonly select = output<ContextMenuItem>();
  readonly dismiss = output<void>();

  left = signal(0);
  top = signal(0);

  /**
   * When this menu appeared, on the same clock as `event.timeStamp`.
   *
   * Right-click reaches `contextmenu` from a different event depending on the
   * platform: after the mouse button is released on macOS and Windows, but
   * from within the press itself on Linux. On Linux the press that opened the
   * menu was therefore still travelling through the document when the
   * dismiss-on-outside-click listener below was attached — so the menu closed
   * itself in the same gesture that opened it, and right-click looked dead.
   *
   * A press that started before the menu existed cannot be a press at the
   * menu, whichever platform it came from.
   */
  private openedAt = 0;

  constructor(private elRef: ElementRef<HTMLElement>) {}

  ngOnInit(): void {
    this.openedAt = performance.now();
    document.body.appendChild(this.elRef.nativeElement);
    this.left.set(this.x());
    this.top.set(this.y());
    // Flip against whichever edge it would overflow, once it has a size.
    requestAnimationFrame(() => this.keepOnScreen());
  }

  ngOnDestroy(): void {
    this.elRef.nativeElement.remove();
  }

  private keepOnScreen(): void {
    const menu = this.elRef.nativeElement.querySelector('.context-menu') as HTMLElement | null;
    if (!menu) return;
    const box = menu.getBoundingClientRect();
    const margin = 8;

    let left = this.x();
    let top = this.y();
    if (left + box.width + margin > window.innerWidth) left = Math.max(margin, left - box.width);
    if (top + box.height + margin > window.innerHeight) top = Math.max(margin, top - box.height);
    this.left.set(left);
    this.top.set(top);
  }

  choose(item: ContextMenuItem): void {
    if (item.disabled) return;
    this.select.emit(item);
  }

  // Any click, scroll or Escape closes it — the usual expectations of a
  // right-click menu, and cheaper than a backdrop that would swallow the click.
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (event.timeStamp < this.openedAt) return;
    // A right-click is never a dismissal: it raises `contextmenu`, and whoever
    // opened this menu answers that by opening one at the new spot. Ignoring
    // the press here also covers the platforms that raise `contextmenu` from
    // inside the press rather than after it.
    if (event.button === 2) return;
    if (this.elRef.nativeElement.contains(event.target as Node)) return;
    this.dismiss.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss.emit();
  }

  @HostListener('window:blur')
  onBlur(): void {
    this.dismiss.emit();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.dismiss.emit();
  }
}
