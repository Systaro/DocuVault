import { Component, output, signal, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { SearchService, SearchResult } from '../../core/api/search.service';
import { getFileIconGlyph } from '../utils/file-utils';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, takeUntil } from 'rxjs';

@Component({
  selector: 'app-global-search',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="search-overlay" (click)="close.emit()">
      <div class="search-dialog" (click)="$event.stopPropagation()">
        <!-- Search Input -->
        <div class="search-input-row">
          <span translate="no" class="material-icons search-icon">search</span>
          <input
            #searchInput
            type="text"
            placeholder="Search documents..."
            class="search-input"
            [value]="query()"
            (input)="onInput($event)"
            (keydown)="onKeydown($event)"
            autocomplete="off"
          />
          <kbd class="kbd">ESC</kbd>
        </div>

        <!-- Results -->
        <div class="search-results" *ngIf="query().length >= 2">
          @if (loading()) {
            <div class="search-status">
              <span translate="no" class="material-icons spin">sync</span>
              Searching...
            </div>
          } @else if (results().length === 0 && query().length >= 2) {
            <div class="search-status">
              <span translate="no" class="material-icons">search_off</span>
              No documents found
            </div>
          } @else {
            @for (result of results(); track result.documentPath + result.spaceId; let i = $index) {
              <button
                class="search-result"
                [class.active]="i === activeIndex()"
                (click)="navigateTo(result)"
                (mouseenter)="activeIndex.set(i)"
              >
                <div class="result-icon">
                  <span translate="no" class="material-icons">{{ getFileIcon(result.documentPath) }}</span>
                </div>
                <div class="result-body">
                  <div class="result-title">{{ result.documentTitle }}</div>
                  <div class="result-meta">
                    <span class="result-space">{{ result.spaceName }}</span>
                    <span class="result-path">{{ result.documentPath }}</span>
                  </div>
                  @if (result.snippet) {
                    <div class="result-snippet">{{ result.snippet }}</div>
                  }
                </div>
              </button>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .search-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      display: flex;
      justify-content: center;
      padding-top: 10vh;
    }

    .search-dialog {
      width: 100%;
      max-width: 640px;
      max-height: 70vh;
      background: var(--surface);
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      align-self: flex-start;
    }

    .search-input-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }

    .search-icon {
      color: var(--text-secondary);
      font-size: 22px;
    }

    .search-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 16px;
      background: transparent;
      color: var(--text-primary);

      &::placeholder {
        color: var(--text-secondary);
      }
    }

    .kbd {
      padding: 2px 8px;
      font-size: 11px;
      font-family: inherit;
      color: var(--text-secondary);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: 4px;
    }

    .search-results {
      overflow-y: auto;
      padding: 8px;
    }

    .search-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      color: var(--text-secondary);
      font-size: 14px;
    }

    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .search-result {
      display: flex;
      gap: 12px;
      padding: 10px 12px;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      cursor: pointer;
      border-radius: 8px;
      transition: background 0.1s;
      color: var(--text-primary);

      &:hover, &.active {
        background: var(--background);
      }
    }

    .result-icon {
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: rgba(111, 179, 184, 0.1);
      color: var(--primary);

      .material-icons {
        font-size: 20px;
      }
    }

    .result-body {
      flex: 1;
      min-width: 0;
    }

    .result-title {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-meta {
      display: flex;
      gap: 8px;
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    .result-space {
      font-weight: 500;
      color: var(--primary);
    }

    .result-path {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .result-snippet {
      margin-top: 4px;
      font-size: 12px;
      color: var(--text-secondary);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      line-height: 1.4;
    }
  `]
})
export class GlobalSearchComponent implements AfterViewInit, OnDestroy {
  close = output();

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  query = signal('');
  results = signal<SearchResult[]>([]);
  loading = signal(false);
  activeIndex = signal(0);

  private search$ = new Subject<string>();
  private destroy$ = new Subject<void>();

  constructor(
    private searchService: SearchService,
    private router: Router
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

  ngAfterViewInit(): void {
    setTimeout(() => this.searchInput.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  onInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.query.set(value);
    if (value.length >= 2) {
      this.loading.set(true);
    }
    this.search$.next(value);
  }

  onKeydown(event: KeyboardEvent): void {
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

  navigateTo(result: SearchResult): void {
    this.close.emit();
    this.router.navigate(
      ['/spaces', ...result.spaceFullPath.split('/'), 'doc'],
      { queryParams: { path: result.documentPath } }
    );
  }

  getFileIcon(path: string): string {
    return getFileIconGlyph(path);
  }
}
