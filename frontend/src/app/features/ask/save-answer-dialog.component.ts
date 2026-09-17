import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { SpacesService, WritableSpace } from '../../core/api/spaces.service';
import { DocumentsService } from '../../core/api/documents.service';

export interface SavedAnswer {
  spaceFullPath: string;
  path: string;
}

/** Turns an answer into a versioned document: pick a space, name the file, commit. */
@Component({
  selector: 'app-save-answer-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="modal-overlay" (click)="cancelled.emit()">
      <form class="modal" role="dialog" aria-labelledby="save-answer-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <div class="modal-header">
          <h2 id="save-answer-title">
            <span translate="no" class="material-icons">note_add</span>Save as document
          </h2>
          <button type="button" class="icon-btn" (click)="cancelled.emit()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>
        <div class="modal-body">
          <label class="field">
            <span>Space</span>
            <app-searchable-select
              name="space"
              [options]="spaceOptions()"
              [ngModel]="spaceId()"
              (ngModelChange)="spaceId.set($event)"
              placeholder="Choose a space you can edit"
            />
          </label>
          @if (!loading() && !spaces().length) {
            <p class="modal-hint">You cannot edit any space, so the answer cannot be saved.</p>
          }
          <label class="field">
            <span>Title</span>
            <input class="input" name="title" [(ngModel)]="title" required />
          </label>
          <label class="field">
            <span>Path</span>
            <input class="input" name="path" [(ngModel)]="path" required placeholder="notes/answer.md" />
          </label>
          <label class="field">
            <span>Content</span>
            <textarea class="input content-input" name="body" rows="12" [(ngModel)]="body" translate="no"></textarea>
          </label>
          @if (error()) {
            <p class="field-error">{{ error() }}</p>
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || !canSave()">
            {{ saving() ? 'Saving' : 'Save and commit' }}
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: var(--spacing-md);

      > span { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
    }

    .field-error { margin: 0; font-size: 13px; color: var(--error); }

    .content-input {
      min-height: 180px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 13px;
      line-height: 1.5;
    }

    .modal { width: 640px; }
  `]
})
export class SaveAnswerDialogComponent implements OnInit {
  private spacesService = inject(SpacesService);
  private documentsService = inject(DocumentsService);

  content = input.required<string>();
  suggestedTitle = input('');
  preferredSpaceId = input<string | null>(null);

  saved = output<SavedAnswer>();
  cancelled = output<void>();

  spaces = signal<WritableSpace[]>([]);
  spaceId = signal<string | null>(null);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  title = '';
  path = '';
  body = '';

  spaceOptions = computed<SelectOption[]>(() =>
    this.spaces().filter(s => !s.inConflict).map(s => ({ value: s.id, label: s.name, sublabel: s.fullPath }))
  );

  ngOnInit(): void {
    // An answer that opens with a heading brings its own title; the heading is written back on save.
    const content = this.content().trim();
    const heading = content.match(/^#\s+(.+)\n?/);
    this.title = heading ? heading[1].trim() : this.suggestedTitle();
    this.body = heading ? content.slice(heading[0].length).trim() : content;
    this.path = `notes/${slugify(this.title) || 'answer'}.md`;
    this.spacesService.getWritableSpaces().subscribe({
      next: spaces => {
        this.spaces.set(spaces);
        const preferred = spaces.find(s => s.id === this.preferredSpaceId() && !s.inConflict);
        this.spaceId.set(preferred?.id ?? spaces.find(s => !s.inConflict)?.id ?? null);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  canSave(): boolean {
    return !!this.spaceId() && this.title.trim().length > 0 && this.path.trim().length > 0;
  }

  save(): void {
    const spaceId = this.spaceId();
    const space = this.spaces().find(s => s.id === spaceId);
    if (!space || !this.canSave()) return;
    const path = this.path.trim().replace(/^\/+/, '');
    const content = `# ${this.title.trim()}\n\n${this.body.trim()}\n`;

    this.saving.set(true);
    this.error.set(null);
    this.documentsService.getDocument(space.id, path).subscribe({
      next: () => {
        this.saving.set(false);
        this.error.set(`${path} already exists. Choose another path.`);
      },
      error: (lookup: HttpErrorResponse) => {
        if (lookup.status !== 404) {
          this.saving.set(false);
          this.error.set('Could not check whether the path is free. Try again.');
          return;
        }
        this.documentsService.createDocument(space.id, {
          path, title: this.title.trim(), content, autoCommit: true, commitMessage: `Add ${path} from an assistant answer`
        }).subscribe({
          next: doc => this.saved.emit({ spaceFullPath: space.fullPath, path: doc.path }),
          error: (e: HttpErrorResponse) => {
            this.saving.set(false);
            this.error.set(e.error?.message || 'The document could not be saved.');
          }
        });
      }
    });
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
