import { Component, signal, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SearchService, SearchResult } from '../../core/api/search.service';
import { getFileIconGlyph } from '../utils/file-utils';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, takeUntil } from 'rxjs';

/**
 * Always-visible search field in the app header with a typeahead results
 * dropdown. Complements the full-screen GlobalSearchComponent modal, which
 * remains the entry point on small screens.
 */
@Component({
  selector: 'app-header-search',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="header-search">
      <span class="material-icons search-icon">search</span>
      <input
        type="text"
        class="search-field"
        placeholder="Search documents..."
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKeydown($event)"
        (focus)="onFocus()"
        autocomplete="off"
      />
      @if (query()) {
        <button class="clear-btn" (click)="clear()" title="Clear">
          <span class="material-icons">close</span>
        </button>
      }

      @if (open() && query().length >= 2) {
        <div class="search-dropdown">
          @if (loading()) {
            <div class="dropdown-status">
              <span class="material-icons spin">sync</span>
              Searching...
            </div>
          } @else if (results().length === 0) {
            <div class="dropdown-status">
              <span class="material-icons">search_off</span>
              No documents found
            </div>
          } @else {
            @for (result of results(); track result.documentPath + result.spaceId; let i = $index) {
              <button
                class="dropdown-result"
                [class.active]="i === activeIndex()"
                (click)="navigateTo(result)"
                (mouseenter)="activeIndex.set(i)"
              >
                <span class="material-icons result-icon">{{ fileIcon(result.documentPath) }}</span>
                <span class="result-body">
                  <span class="result-title">{{ result.documentTitle }}</span>
                  <span class="result-meta">
                    <span class="result-space">{{ result.spaceName }}</span>
                    <span class="result-path">{{ result.documentPath }}</span>
                  </span>
                </span>
              </button>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .header-search {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 18px;
      color: var(--text-secondary);
      pointer-events: none;
    }

    .search-field {
      width: 220px;
      padding: 7px 30px 7px 34px;
      font-size: 13px;
      font-family: inherit;
      color: var(--text-primary);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      outline: none;
      transition: all var(--transition);

      &::placeholder { color: var(--text-secondary); }

      &:focus {
        width: 300px;
        border-color: var(--primary);
        background: var(--surface);
      }
    }

    .clear-btn {
      position: absolute;
      right: 6px;
      display: flex;
      align-items: center;
      padding: 2px;
      border: none;
      background: none;
      color: var(--text-secondary);
      cursor: pointer;
      border-radius: 50%;

      .material-icons { font-size: 16px; }

      &:hover { color: var(--text-primary); }
    }

    .search-dropdown {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      width: 420px;
      max-height: 60vh;
      overflow-y: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      padding: 6px;
      z-index: 200;
    }

    .dropdown-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 18px;
      color: var(--text-secondary);
      font-size: 13px;

      .material-icons { font-size: 18px; }
    }

    .spin { animation: spin 1s linear infinite; }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .dropdown-result {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      background: none;
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius-md);
      color: var(--text-primary);

      &:hover, &.active { background: var(--background); }
    }

    .result-icon {
      flex-shrink: 0;
      font-size: 18px;
      color: var(--primary);
    }

    .result-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .result-title {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-meta {
      display: flex;
      gap: 8px;
      font-size: 11px;
      color: var(--text-secondary);
      min-width: 0;
    }

    .result-space {
      font-weight: 500;
      color: var(--primary);
      flex-shrink: 0;
    }

    .result-path {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `]
})
export class HeaderSearchComponent implements OnDestroy {
  query = signal('');
  results = signal<SearchResult[]>([]);
  loading = signal(false);
  open = signal(false);
  activeIndex = signal(0);

  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(
    private searchService: SearchService,
    private router: Router,
    private host: ElementRef<HTMLElement>
  ) {
    this.search$.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      switchMap(q => {
        if (q.length < 2) {
          this.loading.set(false);
          return of([]);
        }
        return this.searchService.search(q);
      }),
      takeUntil(this.destroy$)
    ).subscribe(results => {
      this.results.set(results);
      this.activeIndex.set(0);
      this.loading.set(false);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  onFocus(): void {
    if (this.query().length >= 2) this.open.set(true);
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    this.open.set(true);
    if (value.length >= 2) this.loading.set(true);
    this.search$.next(value);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.open.set(false);
      (event.target as HTMLInputElement).blur();
      return;
    }
    const results = this.results();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.set(Math.min(this.activeIndex() + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.set(Math.max(this.activeIndex() - 1, 0));
    } else if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      this.navigateTo(results[this.activeIndex()]);
    }
  }

  clear(): void {
    this.query.set('');
    this.results.set([]);
    this.open.set(false);
  }

  navigateTo(result: SearchResult): void {
    this.open.set(false);
    this.router.navigate(
      ['/spaces', ...result.spaceFullPath.split('/'), 'doc'],
      { queryParams: { path: result.documentPath } }
    );
  }

  fileIcon(path: string): string {
    return getFileIconGlyph(path);
  }
}
