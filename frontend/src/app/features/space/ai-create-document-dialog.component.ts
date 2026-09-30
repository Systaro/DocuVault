import { Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService, DocumentLayout } from '../../core/api/ai.service';
import { DocumentContent } from '../../core/api/documents.service';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { VoiceInputButtonComponent } from '../../shared/components/voice-input-button.component';

type LayoutChoice = DocumentLayout | 'EXAMPLE';

/** Files whose text can show the AI a layout. Mirrors AI_CREATE_EXAMPLE_EXTENSIONS in the backend. */
const EXAMPLE_EXTENSIONS = ['md', 'markdown', 'html', 'htm', 'txt'];

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * "New document with AI": the user pastes or dictates a transcript, an email
 * or notes, picks a layout, and the backend writes, names and commits the
 * document into the folder the user is in.
 */
@Component({
  selector: 'app-ai-create-document-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent, VoiceInputButtonComponent],
  template: `
    <div class="modal-overlay" (click)="close()">
      <form class="modal ai-create-modal" role="dialog" aria-labelledby="ai-create-title" (click)="$event.stopPropagation()" (ngSubmit)="submit()">
        <div class="modal-header">
          <h2 id="ai-create-title"><span translate="no" class="material-icons">auto_awesome</span>New document with AI</h2>
          <button type="button" class="icon-btn" (click)="close()" [disabled]="busy()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

        <div class="modal-body">
          @if (busy()) {
            <div class="ai-create-progress" role="status">
              <svg class="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p>Writing the document…</p>
              <p class="modal-hint">A long transcript can take a minute or two.</p>
            </div>
          } @else {
            <p class="modal-hint intro">
              The AI writes the document, names it and saves it in <strong>{{ folderLabel() }}</strong>.
              You can edit or rename it afterwards.
            </p>

            <div class="modal-field">
              <div class="material-label-row">
                <span class="modal-field-label">What should it be written from?</span>
                <app-voice-input-button (transcribed)="appendSpoken($event)" />
              </div>
              <textarea class="input" name="material" rows="10" [ngModel]="material()" (ngModelChange)="material.set($event)"
                placeholder="Paste a meeting transcript, an email or your notes. Add what you want, e.g. &quot;Summarise the call, action items first&quot;."></textarea>
            </div>

            <div class="modal-field">
              <span class="modal-field-label">Layout</span>
              <div class="choice-cards" role="radiogroup" aria-label="Layout">
                @for (option of layouts; track option.value) {
                  <label class="choice-card" [class.selected]="layout() === option.value">
                    <input type="radio" name="layout" [value]="option.value" [checked]="layout() === option.value" (change)="layout.set(option.value)" />
                    <span translate="no" class="material-icons">{{ option.icon }}</span>
                    <span class="choice-card-text">
                      <span class="choice-card-title">{{ option.label }}</span>
                      <span class="choice-card-sub">{{ option.hint }}</span>
                    </span>
                  </label>
                }
              </div>
            </div>

            @if (layout() === 'EXAMPLE') {
              <label class="modal-field">
                <span class="modal-field-label">Document to copy the layout from</span>
                @if (exampleOptions().length) {
                  <app-searchable-select name="example" [options]="exampleOptions()" [ngModel]="selectedExample()"
                    (ngModelChange)="examplePath.set($event)" placeholder="Choose a document" />
                } @else {
                  <span class="modal-hint">This space has no Markdown or HTML documents yet.</span>
                }
              </label>
            }

            @if (error()) {
              <p class="ai-create-error" role="alert">{{ error() }}</p>
            }
          }
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" (click)="close()" [disabled]="busy()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="!canSubmit()">
            <span translate="no" class="material-icons">auto_awesome</span>Create document
          </button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .ai-create-modal { width: 640px; }

    .intro { margin: 0 0 var(--spacing-md); }

    .material-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-sm);
    }

    .ai-create-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--spacing-xs);
      padding: var(--spacing-xl) 0;
      text-align: center;
      color: var(--text-primary);

      svg { color: var(--primary-dark); }
    }

    .ai-create-error {
      margin: 0;
      color: var(--danger, #dc2626);
      font-size: 13px;
    }
  `]
})
export class AiCreateDocumentDialogComponent {
  private readonly aiService = inject(AiService);

  spaceId = input.required<string>();
  /** The folder the document goes into, '' for the space root. */
  folder = input<string>('');
  /** Every file of the space, for picking a document to copy the layout from. */
  files = input<{ path: string; name: string }[]>([]);

  created = output<DocumentContent>();
  cancelled = output<void>();

  material = signal('');
  layout = signal<LayoutChoice>('AUTO');
  examplePath = signal<string | null>(null);
  busy = signal(false);
  error = signal<string | null>(null);

  readonly layouts: { value: LayoutChoice; label: string; hint: string; icon: string }[] = [
    { value: 'AUTO', label: 'Let AI decide', hint: 'Fits the material', icon: 'auto_awesome' },
    { value: 'MEETING_NOTES', label: 'Meeting notes', hint: 'Decisions, action items', icon: 'groups' },
    { value: 'SUMMARY', label: 'Summary', hint: 'Key points, next steps', icon: 'summarize' },
    { value: 'HOW_TO', label: 'How-to guide', hint: 'Numbered steps', icon: 'format_list_numbered' },
    { value: 'EXAMPLE', label: 'Like an existing document', hint: 'Same headings and fields', icon: 'content_copy' }
  ];

  folderLabel = computed(() => this.folder() || 'the top level of the space');

  private exampleFiles = computed(() =>
    this.files().filter(f => EXAMPLE_EXTENSIONS.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
  );

  exampleOptions = computed<SelectOption[]>(() =>
    [...this.exampleFiles()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(f => ({ value: f.path, label: f.name, group: parentOf(f.path) || 'Top level' }))
  );

  /**
   * Until the user picks one, the most likely model: a document in this
   * folder, else one in a neighbouring folder (the profile of another partner
   * next to the one being filled), else none.
   */
  private suggestedExample = computed<string | null>(() => {
    const folder = this.folder();
    const files = this.exampleFiles();
    const here = files.find(f => parentOf(f.path) === folder);
    if (here) return here.path;
    const parent = parentOf(folder);
    const neighbour = files.find(f => folder && parentOf(parentOf(f.path)) === parent && parentOf(f.path) !== folder);
    return neighbour?.path ?? null;
  });

  selectedExample = computed(() => this.examplePath() ?? this.suggestedExample());

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  appendSpoken(text: string): void {
    this.material.update(existing => existing.trim() ? `${existing.trimEnd()}\n${text}` : text);
  }

  canSubmit(): boolean {
    if (this.busy() || !this.material().trim()) return false;
    return this.layout() !== 'EXAMPLE' || !!this.selectedExample();
  }

  close(): void {
    if (!this.busy()) this.cancelled.emit();
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const choice = this.layout();
    this.busy.set(true);
    this.error.set(null);
    this.aiService.createDocument(this.spaceId(), {
      folder: this.folder(),
      material: this.material().trim(),
      layout: choice === 'EXAMPLE' ? 'AUTO' : choice,
      examplePath: choice === 'EXAMPLE' ? this.selectedExample() ?? undefined : undefined
    }).subscribe({
      next: doc => {
        this.busy.set(false);
        this.created.emit(doc);
      },
      error: err => {
        this.busy.set(false);
        this.error.set(err.error?.error || err.error?.message || 'The document could not be created. Please try again.');
      }
    });
  }
}
