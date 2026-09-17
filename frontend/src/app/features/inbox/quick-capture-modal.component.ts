import { Component, OnInit, AfterViewInit, Input, Output, EventEmitter, ViewChild, ElementRef, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { InboxService } from '../../core/api/inbox.service';
import { ToastService } from '../../shared/services/toast.service';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';

@Component({
  selector: 'app-quick-capture-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="capture-overlay" (click)="closeIfOutside($event)">
      <div class="capture-modal" #modal>
        <!-- Header -->
        <div class="capture-header">
          <div class="capture-icon">
            <span translate="no" class="material-icons">add</span>
          </div>
          <h2>New Note</h2>
          <button class="icon-btn" (click)="close.emit()">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

        <!-- Space selector -->
        <div class="space-selector">
          <label>Space</label>
          <app-searchable-select
            [options]="spaceOptions()"
            [placeholder]="spaces().length === 0 ? 'Loading spaces...' : 'Select a space'"
            searchPlaceholder="Search spaces..."
            [(ngModel)]="selectedSpaceId"
            (ngModelChange)="onSpaceChange()"
          />
        </div>

        <!-- Mini toolbar -->
        <div class="capture-toolbar">
          <button class="t-btn" (click)="formatText('bold')" title="Bold">
            <span translate="no" class="material-icons">format_bold</span>
          </button>
          <button class="t-btn" (click)="formatText('italic')" title="Italic">
            <span translate="no" class="material-icons">format_italic</span>
          </button>
          <div class="t-divider"></div>
          <button class="t-btn" (click)="formatText('insertUnorderedList')" title="Bullet list">
            <span translate="no" class="material-icons">format_list_bulleted</span>
          </button>
          <button class="t-btn" (click)="formatText('insertOrderedList')" title="Numbered list">
            <span translate="no" class="material-icons">format_list_numbered</span>
          </button>
          <div class="t-divider"></div>
          <button class="t-btn" (click)="wrapInCode()" title="Inline code">
            <span translate="no" class="material-icons">code</span>
          </button>
        </div>

        <!-- Editor -->
        <div class="capture-editor">
          <div
            #editor
            class="editor-content"
            contenteditable="true"
            translate="no"
            [attr.data-placeholder]="'Start typing your note... (Shift+Enter for new line)'"
            (input)="onInput($event)"
            (keydown)="onKeydown($event)"
          ></div>
        </div>

        <!-- Footer -->
        <div class="capture-footer">
          <div class="capture-hint">
            <span translate="no" class="material-icons">auto_awesome</span>
            AI will suggest where to file this
          </div>
          <div class="capture-actions">
            <button class="btn btn-secondary" (click)="close.emit()">Cancel</button>
            <button
              class="btn btn-primary"
              [disabled]="!canSubmit() || submitting()"
              (click)="submit()"
            >
              <span translate="no" class="material-icons">send</span>
              {{ submitting() ? 'Adding...' : 'Add to Inbox' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .capture-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 80px;
      z-index: 200;
    }

    .capture-modal {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-xl, 12px);
      box-shadow: var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.3));
      width: 640px;
      max-width: 95vw;
      display: flex;
      flex-direction: column;
      animation: captureIn 0.2s ease;
      overflow: hidden;
    }

    @keyframes captureIn {
      from { opacity: 0; transform: translateY(-12px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }

    .capture-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px 18px 14px;
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary);
        flex: 1;
        margin: 0;
      }
    }

    .capture-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--primary-dark, #388087), var(--primary, #6FB3B8));
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      flex-shrink: 0;

      .material-icons { font-size: 16px; }
    }


    .space-selector {
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 10px;

      label {
        font-size: 12px;
        font-weight: 500;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      app-searchable-select {
        flex: 1;
      }
    }

    .capture-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.02);
    }

    .t-btn {
      width: 28px;
      height: 26px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition);

      &:hover { background: rgba(111,179,184,0.1); color: var(--text-primary); }
      .material-icons { font-size: 15px; }
    }

    .t-divider {
      width: 1px;
      height: 16px;
      background: var(--border);
      margin: 0 4px;
    }

    .capture-editor {
      padding: 0;
      flex: 1;
    }

    .editor-content {
      padding: 16px 18px;
      min-height: 180px;
      font-size: 14px;
      color: var(--text-primary);
      line-height: 1.7;
      outline: none;
      font-family: inherit;

      &:empty::before {
        content: attr(data-placeholder);
        color: var(--text-muted);
        pointer-events: none;
      }
    }

    .capture-footer {
      padding: 12px 18px;
      border-top: 1px solid var(--border);
      background: var(--background);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .capture-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-muted);

      .material-icons { font-size: 14px; color: var(--primary); }
    }

    .capture-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `]
})
export class QuickCaptureModalComponent implements OnInit, AfterViewInit {
  @ViewChild('editor') editorEl?: ElementRef<HTMLDivElement>;
  /** Text typed elsewhere (the command palette) that the note starts with. */
  @Input() initialText = '';
  @Output() close = new EventEmitter<void>();
  @Output() noteCreated = new EventEmitter<void>();

  spaces = signal<Space[]>([]);
  private allSpaces = signal<Space[]>([]);
  selectedSpaceId = '';
  content = '';
  submitting = signal(false);

  canSubmit = signal(false);

  /** Repositories grouped under their parent group's name chain for the picker. */
  spaceOptions = computed<SelectOption[]>(() => {
    const byId = new Map(this.allSpaces().map(s => [s.id, s]));
    return this.spaces().map(space => {
      const groupNames: string[] = [];
      let parent = space.parentId ? byId.get(space.parentId) : undefined;
      while (parent) {
        groupNames.unshift(parent.name);
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      return {
        value: space.id,
        label: space.name,
        group: groupNames.join(' / ') || undefined
      };
    });
  });

  constructor(
    private spacesService: SpacesService,
    private inboxService: InboxService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.spacesService.getSpaces().subscribe({
      next: (spaces) => {
        this.allSpaces.set(spaces);
        // Only show repositories (not groups) that can have inboxes
        const repos = spaces.filter(s => s.type === 'REPOSITORY');
        this.spaces.set(repos);
        if (repos.length > 0) {
          this.selectedSpaceId = repos[0].id;
          this.onSpaceChange();
        }
      }
    });
  }

  ngAfterViewInit(): void {
    const editor = this.editorEl?.nativeElement;
    if (!editor) return;
    if (this.initialText) {
      editor.innerText = this.initialText;
      this.content = editor.innerHTML;
      this.onSpaceChange();
    }
    editor.focus();
  }

  onSpaceChange(): void {
    this.canSubmit.set(this.stripHtml(this.content).trim().length > 0 && !!this.selectedSpaceId);
  }

  onInput(event: Event): void {
    const el = event.target as HTMLElement;
    this.content = el.innerHTML;
    this.canSubmit.set(el.innerText.trim().length > 0 && !!this.selectedSpaceId);
  }

  private stripHtml(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.innerText;
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close.emit();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (this.canSubmit()) this.submit();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  closeIfOutside(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('capture-overlay')) {
      this.close.emit();
    }
  }

  formatText(command: string): void {
    document.execCommand(command, false);
  }

  wrapInCode(): void {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const code = document.createElement('code');
      range.surroundContents(code);
    }
  }

  submit(): void {
    if (!this.content.trim() || !this.selectedSpaceId) return;
    this.submitting.set(true);

    this.inboxService.createNote(this.selectedSpaceId, this.content).subscribe({
      next: () => {
        this.toastService.success('Added to Inbox', 'Your note has been added to the space inbox.');
        this.submitting.set(false);
        this.noteCreated.emit();
        this.close.emit();
      },
      error: () => {
        this.toastService.error('Error', 'Failed to add note to inbox.');
        this.submitting.set(false);
      }
    });
  }
}
