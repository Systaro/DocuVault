import { Component, ElementRef, ViewChild, computed, input, output, signal } from '@angular/core';
import { ConnectedPosition, OverlayModule } from '@angular/cdk/overlay';
import { Space } from '../../core/api/spaces.service';
import { SpaceAvatarComponent } from '../../shared/components/space-avatar.component';

/** The picker value for a question asked across every space the user can read. */
export const EVERYWHERE = 'everywhere';

interface PickerRow {
  /** Null for the "Everywhere" row. */
  space: Space | null;
  /** A repository shown under its group. */
  nested: boolean;
}

/**
 * Where a question goes: a chip with the space's logo and name, opening a
 * searchable list of spaces with their logos. The list is attached to the
 * page body, so no container can clip it.
 */
@Component({
  selector: 'app-space-picker',
  standalone: true,
  imports: [OverlayModule, SpaceAvatarComponent],
  template: `
    <button
      #trigger
      type="button"
      class="space-trigger"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      [class.open]="open()"
      [disabled]="!spaces().length"
      [title]="triggerTitle()"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
    >
      @if (selected(); as space) {
        <app-space-avatar [space]="space" size="sm" />
        <span class="trigger-name">{{ space.name }}</span>
      } @else if (value() === EVERYWHERE) {
        <span translate="no" class="material-icons everywhere-icon sm">public</span>
        <span class="trigger-name">Everywhere</span>
      } @else {
        <span translate="no" class="material-icons placeholder-icon">workspaces</span>
        <span class="trigger-name placeholder">Choose a space</span>
      }
      <span translate="no" class="material-icons chevron">expand_more</span>
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayHasBackdrop]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      (backdropClick)="close()"
      (detach)="close()"
      (overlayKeydown)="onPanelKeydown($event)"
    >
      <div class="space-panel" role="listbox" aria-label="Spaces">
        <div class="panel-search">
          <span translate="no" class="material-icons">search</span>
          <input
            #search
            type="text"
            placeholder="Find a space"
            [value]="filter()"
            (input)="onFilter($event)"
            aria-label="Find a space"
          />
        </div>
        <div class="panel-rows">
          @for (row of rows(); track rowValue(row); let i = $index) {
            <button
              type="button"
              class="panel-row"
              role="option"
              [class.nested]="row.nested"
              [class.active]="i === activeIndex()"
              [class.selected]="rowValue(row) === value()"
              [attr.aria-selected]="rowValue(row) === value()"
              (mouseenter)="activeIndex.set(i)"
              (click)="pick(row)"
            >
              @if (row.space; as space) {
                <app-space-avatar [space]="space" [size]="row.nested ? 'sm' : 'md'" />
                <span class="row-text">
                  <span class="row-name">{{ space.name }}</span>
                  @if (space.type === 'GROUP') {
                    <span class="row-sub">All spaces in this group</span>
                  }
                </span>
              } @else {
                <span translate="no" class="material-icons everywhere-icon">public</span>
                <span class="row-text">
                  <span class="row-name">Everywhere</span>
                  <span class="row-sub">All spaces you can read</span>
                </span>
              }
              @if (rowValue(row) === value()) {
                <span translate="no" class="material-icons check">check</span>
              }
            </button>
          } @empty {
            <p class="panel-empty">No space matches "{{ filter() }}"</p>
          }
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; min-width: 0; }

    .space-trigger {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      max-width: 220px;
      height: 34px;
      padding: 0 6px 0 5px;
      border: 1px solid transparent;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      color: var(--text-primary);
      font: inherit;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background var(--transition-fast), border-color var(--transition-fast);

      &:hover:not(:disabled), &.open { background: var(--primary-light); border-color: color-mix(in srgb, var(--primary) 45%, transparent); }
      &:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
      &:disabled { cursor: default; opacity: 0.6; }
    }

    .trigger-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &.placeholder { color: var(--text-muted); font-weight: 500; }
    }

    .placeholder-icon { font-size: 18px; color: var(--text-muted); }

    .everywhere-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      /* Sized like app-space-avatar (md 24px, sm 20px) so the row lines up with the spaces below. */
      width: 24px;
      height: 24px;
      border-radius: 7px;
      background: var(--primary-light);
      color: var(--primary-dark);
      font-size: 17px;

      &.sm { width: 20px; height: 20px; border-radius: 6px; font-size: 15px; }
    }

    .chevron {
      font-size: 18px;
      color: var(--text-muted);
      transition: transform var(--transition-fast);
    }
    .open .chevron { transform: rotate(180deg); }

    .space-panel {
      display: flex;
      flex-direction: column;
      width: 320px;
      max-width: calc(100vw - 24px);
      max-height: min(400px, 60vh);
      margin: 6px 0;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: 0 18px 50px rgba(15, 40, 45, 0.18), 0 2px 8px rgba(15, 40, 45, 0.08);
    }

    .panel-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);

      .material-icons { font-size: 18px; color: var(--text-muted); }
      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 14px;
      }
    }

    .panel-rows {
      overflow-y: auto;
      padding: 6px;
    }

    .panel-row {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 7px 8px;
      border: 0;
      border-radius: var(--radius-md);
      background: none;
      color: var(--text-primary);
      font: inherit;
      text-align: left;
      cursor: pointer;

      &.nested { padding-left: 26px; }
      &.active { background: var(--background-darker); }
      &.selected .row-name { color: var(--primary-dark); }
    }

    .row-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .row-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-sub { font-size: 12px; color: var(--text-muted); }
    .check { font-size: 18px; color: var(--primary-dark); }

    .panel-empty { margin: 0; padding: 14px 10px; color: var(--text-muted); font-size: 13px; }

    /* In a narrow ask box the logo alone says which space; the name would squeeze the question. */
    @container (max-width: 520px) {
      .trigger-name { display: none; }
      .space-trigger { padding: 0 2px 0 5px; }
    }
  `]
})
export class SpacePickerComponent {
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('search') search?: ElementRef<HTMLInputElement>;

  spaces = input<Space[]>([]);
  value = input<string | null>(null);
  changed = output<string>();

  open = signal(false);
  filter = signal('');
  activeIndex = signal(0);

  readonly EVERYWHERE = EVERYWHERE;

  readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' }
  ];

  selected = computed(() => this.spaces().find(s => s.id === this.value()) ?? null);

  triggerTitle = computed(() => {
    const name = this.selected()?.name ?? (this.value() === EVERYWHERE ? 'all spaces' : null);
    return name ? `Asking in ${name}. Click to change.` : 'Choose a space';
  });

  /** "Everywhere" first, then groups first-level with their repositories under them; a search flattens the list. */
  rows = computed<PickerRow[]>(() => {
    const spaces = [...this.spaces()].sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    const needle = this.filter().trim().toLowerCase();
    if (needle) {
      const everywhere: PickerRow[] = 'everywhere'.includes(needle) ? [{ space: null, nested: false }] : [];
      return [...everywhere, ...spaces.filter(s => s.name.toLowerCase().includes(needle) || s.fullPath.toLowerCase().includes(needle))
        .map(space => ({ space, nested: false }))];
    }
    const ids = new Set(spaces.map(s => s.id));
    const rows: PickerRow[] = [{ space: null, nested: false }];
    for (const space of spaces.filter(s => !s.parentId || !ids.has(s.parentId))) {
      rows.push({ space, nested: false });
      spaces.filter(child => child.parentId === space.id).forEach(child => rows.push({ space: child, nested: true }));
    }
    return rows;
  });

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.filter.set('');
    this.activeIndex.set(Math.max(0, this.rows().findIndex(r => this.rowValue(r) === this.value())));
    this.open.set(true);
    setTimeout(() => this.search?.nativeElement.focus());
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.trigger?.nativeElement.focus();
  }

  rowValue(row: PickerRow): string {
    return row.space?.id ?? EVERYWHERE;
  }

  pick(row: PickerRow): void {
    this.changed.emit(this.rowValue(row));
    this.close();
  }

  onFilter(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !this.open()) {
      event.preventDefault();
      this.toggle();
    }
  }

  onPanelKeydown(event: KeyboardEvent): void {
    const count = this.rows().length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, count - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = this.rows()[this.activeIndex()];
      if (row) this.pick(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }
}
