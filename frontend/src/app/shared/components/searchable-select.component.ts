import {
  Component, Input, forwardRef, signal, computed, ElementRef, ViewChild,
  HostListener, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

export interface SelectOption {
  value: unknown;
  label: string;
  /** Optional group header the option is listed under (e.g. parent workspace group). */
  group?: string;
  /** Optional secondary line shown under the label. */
  sublabel?: string;
  disabled?: boolean;
}

interface RenderGroup {
  name: string | null;
  options: SelectOption[];
}

/**
 * Styled replacement for native <select>: searchable, supports grouped
 * options, and drives [(ngModel)] via ControlValueAccessor. The panel is
 * position:fixed so it escapes any overflow/stacking context of its host
 * (modals, scrolled sidebars) instead of being clipped.
 */
@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule],
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => SearchableSelectComponent),
    multi: true
  }],
  template: `
    <button
      #trigger
      type="button"
      class="select-trigger"
      [class.open]="open()"
      [disabled]="disabled()"
      (click)="toggle()"
      (keydown)="onTriggerKeydown($event)"
    >
      <span class="trigger-label" [class.placeholder]="!selectedOption()">
        {{ selectedOption()?.label || placeholder }}
      </span>
      <span class="material-icons trigger-arrow">{{ open() ? 'expand_less' : 'expand_more' }}</span>
    </button>

    @if (open()) {
      <div class="select-panel" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" [style.width.px]="panelWidth()" [style.maxHeight.px]="panelMaxHeight()">
        @if (showSearch()) {
          <div class="panel-search">
            <span class="material-icons">search</span>
            <input
              #searchField
              type="text"
              [placeholder]="searchPlaceholder"
              [value]="filter()"
              (input)="onFilterInput($event)"
              (keydown)="onSearchKeydown($event)"
            />
          </div>
        }
        <div class="panel-options">
          @if (flatFiltered().length === 0) {
            <div class="panel-empty">No matches</div>
          }
          @for (group of filteredGroups(); track group.name) {
            @if (group.name) {
              <div class="panel-group-header">{{ group.name }}</div>
            }
            @for (option of group.options; track $index) {
              <button
                type="button"
                class="panel-option"
                [class.selected]="isSelected(option)"
                [class.active]="flatFiltered()[activeIndex()] === option"
                [disabled]="option.disabled"
                (click)="select(option)"
                (mouseenter)="activeIndex.set(flatFiltered().indexOf(option))"
              >
                <span class="option-main">
                  <span class="option-label">{{ option.label }}</span>
                  @if (option.sublabel) {
                    <span class="option-sublabel">{{ option.sublabel }}</span>
                  }
                </span>
                @if (isSelected(option)) {
                  <span class="material-icons option-check">check</span>
                }
              </button>
            }
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      position: relative;
    }

    .select-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 8px 10px 8px 12px;
      font-size: 13px;
      font-family: inherit;
      text-align: left;
      color: var(--text-primary);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: border-color var(--transition);

      &:hover:not(:disabled) { border-color: var(--primary-light); }
      &.open, &:focus-visible { border-color: var(--primary); outline: none; }
      &:disabled { opacity: 0.6; cursor: not-allowed; }
    }

    .trigger-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      &.placeholder { color: var(--text-secondary); }
    }

    .trigger-arrow {
      font-size: 18px;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    .select-panel {
      position: fixed;
      display: flex;
      flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      z-index: 1100;
      overflow: hidden;
    }

    .panel-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);

      .material-icons {
        font-size: 17px;
        color: var(--text-secondary);
      }

      input {
        flex: 1;
        border: none;
        outline: none;
        background: transparent;
        font-size: 13px;
        font-family: inherit;
        color: var(--text-primary);

        &::placeholder { color: var(--text-secondary); }
      }
    }

    .panel-options {
      overflow-y: auto;
      padding: 4px;
    }

    .panel-empty {
      padding: 14px;
      text-align: center;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .panel-group-header {
      padding: 8px 10px 3px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-secondary);
    }

    .panel-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      background: none;
      text-align: left;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-primary);
      cursor: pointer;
      border-radius: var(--radius-sm);

      &:hover:not(:disabled), &.active { background: var(--background); }
      &.selected { color: var(--primary-dark); font-weight: 600; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .option-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .option-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .option-sublabel {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .option-check {
      font-size: 16px;
      color: var(--primary);
      flex-shrink: 0;
    }
  `]
})
export class SearchableSelectComponent implements ControlValueAccessor, OnDestroy {
  @Input() set options(value: SelectOption[]) { this.optionsSignal.set(value ?? []); }
  @Input() placeholder = 'Select...';
  @Input() searchPlaceholder = 'Search...';
  /** Force the search field on/off; by default it appears from 8 options up. */
  @Input() searchable: boolean | 'auto' = 'auto';

  @ViewChild('trigger') trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('searchField') searchField?: ElementRef<HTMLInputElement>;

  optionsSignal = signal<SelectOption[]>([]);
  value = signal<unknown>(null);
  disabled = signal(false);
  open = signal(false);
  filter = signal('');
  activeIndex = signal(0);

  panelTop = signal(0);
  panelLeft = signal(0);
  panelWidth = signal(0);
  panelMaxHeight = signal(320);

  selectedOption = computed(() =>
    this.optionsSignal().find(o => o.value === this.value()) ?? null
  );

  showSearch = computed(() =>
    this.searchable === true || (this.searchable === 'auto' && this.optionsSignal().length >= 8)
  );

  filteredGroups = computed<RenderGroup[]>(() => {
    const term = this.filter().toLowerCase().trim();
    const matches = this.optionsSignal().filter(o =>
      !term ||
      o.label.toLowerCase().includes(term) ||
      o.sublabel?.toLowerCase().includes(term) ||
      o.group?.toLowerCase().includes(term)
    );
    const groups: RenderGroup[] = [];
    for (const option of matches) {
      const name = option.group ?? null;
      let group = groups.find(g => g.name === name);
      if (!group) {
        group = { name, options: [] };
        groups.push(group);
      }
      group.options.push(option);
    }
    return groups;
  });

  flatFiltered = computed(() => this.filteredGroups().flatMap(g => g.options));

  private onChange: (value: unknown) => void = () => {};
  private onTouched: () => void = () => {};
  private reposition = () => this.updatePanelPosition();

  constructor(private host: ElementRef<HTMLElement>) {}

  ngOnDestroy(): void {
    this.detachListeners();
  }

  // --- ControlValueAccessor ---

  writeValue(value: unknown): void {
    this.value.set(value);
  }

  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // --- Interaction ---

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.openPanel();
    }
  }

  private openPanel(): void {
    this.filter.set('');
    this.activeIndex.set(Math.max(0, this.flatFiltered().findIndex(o => this.isSelected(o))));
    this.open.set(true);
    this.updatePanelPosition();
    window.addEventListener('scroll', this.reposition, true);
    window.addEventListener('resize', this.reposition);
    setTimeout(() => this.searchField?.nativeElement.focus());
  }

  private close(): void {
    this.open.set(false);
    this.detachListeners();
    this.onTouched();
  }

  private detachListeners(): void {
    window.removeEventListener('scroll', this.reposition, true);
    window.removeEventListener('resize', this.reposition);
  }

  private updatePanelPosition(): void {
    const rect = this.trigger?.nativeElement.getBoundingClientRect();
    if (!rect) return;
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    const maxHeight = Math.min(360, openUp ? spaceAbove : spaceBelow);

    this.panelWidth.set(Math.max(rect.width, 240));
    this.panelLeft.set(Math.min(rect.left, window.innerWidth - this.panelWidth() - 8));
    this.panelMaxHeight.set(maxHeight);
    this.panelTop.set(openUp ? rect.top - maxHeight - 6 : rect.bottom + 6);
  }

  onFilterInput(event: Event): void {
    this.filter.set((event.target as HTMLInputElement).value);
    this.activeIndex.set(0);
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key) && !this.open()) {
      event.preventDefault();
      this.openPanel();
    } else if (event.key === 'Escape' && this.open()) {
      this.close();
    } else if (this.open()) {
      this.onSearchKeydown(event);
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    const options = this.flatFiltered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[this.activeIndex()];
      if (option && !option.disabled) this.select(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  isSelected(option: SelectOption): boolean {
    return option.value === this.value();
  }

  select(option: SelectOption): void {
    this.value.set(option.value);
    this.onChange(option.value);
    this.close();
    this.trigger.nativeElement.focus();
  }
}
