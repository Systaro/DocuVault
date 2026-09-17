import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, computed, inject, output, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, debounceTime, distinctUntilChanged, of, switchMap, catchError } from 'rxjs';
import { AiService, ConversationSummary } from '../../core/api/ai.service';
import { SearchResult, SearchService } from '../../core/api/search.service';
import { Space, SpacesService } from '../../core/api/spaces.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { spaceRoute } from '../../shared/utils/route-utils';
import { rememberedSpaceId } from './ask-composer.component';

interface PaletteItem {
  icon: string;
  label: string;
  detail?: string;
  section: string;
  run: () => void;
}

/**
 * Cmd+K: one input that starts from wherever the user is. Typing offers to ask
 * the assistant, lists matching documents and spaces, and can turn the text
 * into a quick note. Empty, it shows the latest conversations.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="palette-overlay" (click)="closed.emit()">
      <div class="palette" role="dialog" aria-label="Command palette" (click)="$event.stopPropagation()">
        <div class="palette-input">
          <span translate="no" class="material-icons">{{ aiChat() ? 'auto_awesome' : 'search' }}</span>
          <input
            #field
            [ngModel]="text()"
            (ngModelChange)="onText($event)"
            (keydown)="onKeydown($event)"
            [placeholder]="aiChat() ? 'Ask a question, find a document, or jot a note' : 'Find a document or jot a note'"
            aria-label="Command"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
          />
          <kbd>esc</kbd>
        </div>
        <ul class="palette-results" id="palette-results" role="listbox">
          @for (item of items(); track $index; let i = $index) {
            @if (i === 0 || items()[i - 1].section !== item.section) {
              <li class="palette-section" role="presentation">{{ item.section }}</li>
            }
            <li
              class="palette-item"
              role="option"
              [class.selected]="i === selected()"
              [attr.aria-selected]="i === selected()"
              (mouseenter)="selected.set(i)"
              (click)="item.run()"
            >
              <span translate="no" class="material-icons">{{ item.icon }}</span>
              <span class="item-label">{{ item.label }}</span>
              @if (item.detail) {
                <span class="item-detail">{{ item.detail }}</span>
              }
            </li>
          }
          @if (!items().length) {
            <li class="palette-empty" role="presentation">Nothing found</li>
          }
        </ul>
      </div>
    </div>
  `,
  styles: [`
    .palette-overlay {
      position: fixed;
      inset: 0;
      z-index: 600;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 12vh var(--spacing-md) 0;
      background: rgba(26, 46, 48, 0.45);
    }

    .palette {
      width: 640px;
      max-width: 100%;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
      box-shadow: var(--shadow-xl);
    }

    .palette-input {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: 14px var(--spacing-md);
      border-bottom: 1px solid var(--border-light);

      .material-icons { color: var(--primary-dark); }

      input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 16px;
      }

      kbd {
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        color: var(--text-muted);
        font-size: 11px;
      }
    }

    .palette-results {
      max-height: 55vh;
      margin: 0;
      padding: 6px;
      overflow-y: auto;
      list-style: none;
    }

    .palette-section {
      padding: 10px 10px 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-radius: var(--radius-md);
      color: var(--text-primary);
      cursor: pointer;

      .material-icons { font-size: 19px; color: var(--text-secondary); }

      &.selected { background: var(--background-darker); }
    }

    .item-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .item-detail {
      flex-shrink: 0;
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      color: var(--text-muted);
    }

    .palette-empty {
      padding: var(--spacing-md);
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
    }
  `]
})
export class CommandPaletteComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('field') field?: ElementRef<HTMLInputElement>;

  private router = inject(Router);
  private ai = inject(AiService);
  private search = inject(SearchService);
  private spacesService = inject(SpacesService);
  private caps = inject(CapabilitiesService);

  closed = output<void>();
  /** The user wants the text as a quick note. */
  note = output<string>();

  aiChat = this.caps.aiChat;
  text = signal('');
  selected = signal(0);
  private results = signal<SearchResult[]>([]);
  private recent = signal<ConversationSummary[]>([]);
  private spaces = signal<Space[]>([]);
  private queries = new Subject<string>();
  private subscription = new Subscription();

  private askSpace = computed(() => {
    const spaces = this.spaces();
    const remembered = rememberedSpaceId();
    return spaces.find(s => s.id === remembered) ?? spaces.find(s => s.type === 'REPOSITORY') ?? null;
  });

  items = computed<PaletteItem[]>(() => {
    const text = this.text().trim();
    const items: PaletteItem[] = [];

    if (!text) {
      if (this.aiChat()) {
        items.push({ icon: 'add_comment', label: 'New conversation', section: 'Start', run: () => this.go(['/ask']) });
      }
      items.push({ icon: 'edit_note', label: 'Quick note', section: 'Start', run: () => this.note.emit('') });
      for (const c of this.recent()) {
        items.push({ icon: 'forum', label: c.title, detail: c.spaceName, section: 'Recent conversations', run: () => this.go(['/ask', c.id]) });
      }
      return items;
    }

    const space = this.askSpace();
    if (this.aiChat() && space) {
      items.push({
        icon: 'auto_awesome',
        label: `Ask: ${text}`,
        detail: space.name,
        section: 'Assistant',
        run: () => this.go(['/ask'], { space: space.id, q: text })
      });
    }
    for (const r of this.results()) {
      if (r.kind === 'DOCUMENT') {
        items.push({
          icon: 'description', label: r.documentTitle, detail: r.spaceName, section: 'Documents',
          run: () => this.go(spaceRoute(r.spaceFullPath, 'doc'), { path: r.documentPath })
        });
      } else {
        items.push({
          icon: r.kind === 'GROUP' ? 'folder' : 'menu_book', label: r.documentTitle, detail: r.spaceName, section: 'Spaces',
          run: () => this.go(spaceRoute(r.spaceFullPath))
        });
      }
    }
    items.push({ icon: 'edit_note', label: `Save as a quick note: ${text}`, section: 'Capture', run: () => this.note.emit(text) });
    return items;
  });

  ngOnInit(): void {
    if (this.aiChat()) {
      this.spacesService.getSpaces().subscribe({ next: spaces => this.spaces.set(spaces) });
      this.ai.listConversations().subscribe({ next: list => this.recent.set(list.slice(0, 5)) });
    }
    this.subscription.add(
      this.queries.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap(q => q.length < 2 ? of([]) : this.search.search(q, 8).pipe(catchError(() => of([]))))
      ).subscribe(results => this.results.set(results))
    );
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.field?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  onText(value: string): void {
    this.text.set(value);
    this.selected.set(0);
    this.queries.next(value.trim());
  }

  onKeydown(event: KeyboardEvent): void {
    const count = this.items().length;
    if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      this.selected.update(i => (i + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.selected.update(i => (i - 1 + count) % count);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      this.items()[this.selected()]?.run();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  private go(commands: string[], queryParams?: Record<string, string>): void {
    this.closed.emit();
    this.router.navigate(commands, { queryParams });
  }
}
