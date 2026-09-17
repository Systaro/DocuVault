import { Component, ElementRef, ViewChild, computed, effect, input, output, signal, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { Space } from '../../core/api/spaces.service';

export interface AskSubmission {
  message: string;
  spaceId: string;
  documentPath: string | null;
}

const LAST_SPACE_KEY = 'docuvault.ask.lastSpace';

/** The space a new question goes to when nothing else says: the one used last time. */
export function rememberedSpaceId(): string | null {
  try {
    return localStorage.getItem(LAST_SPACE_KEY);
  } catch {
    return null;
  }
}

function rememberSpace(spaceId: string): void {
  try {
    localStorage.setItem(LAST_SPACE_KEY, spaceId);
  } catch {
    // Private mode or blocked storage: the picker just won't remember.
  }
}

/**
 * The ask box: pick a space, optionally keep a document in scope, type a
 * question. A conversation that already exists shows its space instead of
 * the picker, since its space cannot change.
 */
@Component({
  selector: 'app-ask-composer',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <form class="ask-composer" [class.busy]="busy()" (ngSubmit)="send()">
      <div class="composer-scope">
        @if (fixedSpaceName(); as name) {
          <span class="scope-chip" [title]="'This conversation is about ' + name">
            <span translate="no" class="material-icons">menu_book</span>{{ name }}
          </span>
        } @else {
          <app-searchable-select
            class="scope-select"
            name="space"
            [options]="spaceOptions()"
            [ngModel]="selectedSpaceId()"
            (ngModelChange)="selectSpace($event)"
            placeholder="Choose a space"
            searchPlaceholder="Find a space"
          />
        }
        @if (documentPath(); as doc) {
          <span class="scope-chip doc" [title]="'Answers focus on ' + doc">
            <span translate="no" class="material-icons">description</span>
            <span class="chip-text">{{ doc }}</span>
            @if (!fixedSpaceName()) {
              <button type="button" class="chip-remove" (click)="clearDocument.emit()" title="Ask about the whole space instead">
                <span translate="no" class="material-icons">close</span>
              </button>
            }
          </span>
        }
      </div>
      <div class="composer-input">
        <textarea
          #field
          name="message"
          rows="1"
          [placeholder]="placeholder()"
          [(ngModel)]="text"
          (input)="autoGrow()"
          (keydown)="onKeydown($event)"
          [disabled]="busy()"
          aria-label="Your question"
        ></textarea>
        <button type="submit" class="send-btn" [disabled]="!canSend()" title="Send (Enter)">
          <span translate="no" class="material-icons">{{ busy() ? 'hourglass_top' : 'arrow_upward' }}</span>
        </button>
      </div>
    </form>
  `,
  styles: [`
    .ask-composer {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) var(--spacing-md);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-sm);
      transition: border-color var(--transition-fast), box-shadow var(--transition-fast);

      &:focus-within {
        border-color: var(--primary);
        box-shadow: var(--shadow-md);
      }
    }

    .composer-scope {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--spacing-sm);
      padding-top: var(--spacing-xs);
    }

    .scope-select {
      min-width: 200px;
      max-width: 320px;
    }

    .scope-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      max-width: 100%;
      padding: 4px 10px;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      color: var(--text-secondary);
      font-size: 13px;

      .material-icons { font-size: 16px; }

      &.doc { background: var(--primary-light); color: var(--text-primary); }
    }

    .chip-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chip-remove {
      display: inline-flex;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;

      .material-icons { font-size: 15px; }
    }

    .composer-input {
      display: flex;
      align-items: flex-end;
      gap: var(--spacing-sm);

      textarea {
        flex: 1;
        min-height: 40px;
        max-height: 220px;
        padding: 8px 0;
        border: 0;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--text-primary);
        font: inherit;
        font-size: 15px;
        line-height: 1.5;
      }
    }

    .send-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border: 0;
      border-radius: var(--radius-full);
      background: var(--primary-dark);
      color: #fff;
      cursor: pointer;

      &:disabled { opacity: 0.4; cursor: default; }
    }
  `]
})
export class AskComposerComponent implements AfterViewInit {
  @ViewChild('field') field?: ElementRef<HTMLTextAreaElement>;

  spaces = input<Space[]>([]);
  /** Set for an existing conversation: its space is shown, not chosen. */
  fixedSpaceName = input<string | null>(null);
  initialSpaceId = input<string | null>(null);
  documentPath = input<string | null>(null);
  busy = input(false);
  autofocus = input(false);
  placeholder = input('Ask about your documentation');

  submitted = output<AskSubmission>();
  clearDocument = output<void>();

  text = '';
  selectedSpaceId = signal<string | null>(null);

  spaceOptions = computed<SelectOption[]>(() => {
    const byId = new Map(this.spaces().map(s => [s.id, s]));
    return [...this.spaces()]
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      .map(space => ({
        value: space.id,
        label: space.name,
        group: space.parentId ? byId.get(space.parentId)?.name : undefined,
        sublabel: space.type === 'GROUP' ? 'All spaces in this group' : undefined
      }));
  });

  constructor() {
    // Pick a sensible space once the list arrives: the one asked for, else the last used, else the first repository.
    effect(() => {
      const spaces = this.spaces();
      if (this.fixedSpaceName()) return;
      const current = this.selectedSpaceId();
      // A space handed in by the page (from the editor, the space menu) counts before the list has loaded,
      // or a question typed quickly would have nowhere to go.
      if (!spaces.length) {
        if (!current && this.initialSpaceId()) this.selectedSpaceId.set(this.initialSpaceId());
        return;
      }
      if (current && spaces.some(s => s.id === current)) return;
      const wanted = [this.initialSpaceId(), rememberedSpaceId()].find(id => id && spaces.some(s => s.id === id));
      this.selectedSpaceId.set(wanted ?? spaces.find(s => s.type === 'REPOSITORY')?.id ?? spaces[0].id);
    }, { allowSignalWrites: true });
  }

  ngAfterViewInit(): void {
    if (this.autofocus()) setTimeout(() => this.focus());
  }

  focus(): void {
    this.field?.nativeElement.focus();
  }

  selectSpace(spaceId: string): void {
    this.selectedSpaceId.set(spaceId);
    rememberSpace(spaceId);
  }

  canSend(): boolean {
    return !this.busy() && this.text.trim().length > 0 && (!!this.fixedSpaceName() || !!this.selectedSpaceId());
  }

  send(): void {
    if (!this.canSend()) return;
    const spaceId = this.selectedSpaceId() ?? '';
    if (spaceId) rememberSpace(spaceId);
    this.submitted.emit({ message: this.text.trim(), spaceId, documentPath: this.documentPath() });
    this.text = '';
    setTimeout(() => this.autoGrow());
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  autoGrow(): void {
    const el = this.field?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }
}
