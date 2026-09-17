import {
  Component, OnInit, AfterViewInit, Input, Output, EventEmitter, ViewChild, ElementRef, signal, computed, HostListener, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { forkJoin, of } from 'rxjs';
import { SpacesService, WritableSpace } from '../../core/api/spaces.service';
import { CaptureSuggestion, CaptureTask, InboxService } from '../../core/api/inbox.service';
import { TasksService } from '../../core/api/tasks.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { ToastService } from '../../shared/services/toast.service';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { VoiceInputButtonComponent } from '../../shared/components/voice-input-button.component';
import { spaceRoute } from '../../shared/utils/route-utils';

/**
 * Quick note: write or speak first, decide where it goes after. With AI the
 * note gets a suggested space and the tasks found in it, and nothing is saved
 * until the user confirms. Without AI the space is picked by hand.
 */
@Component({
  selector: 'app-quick-capture-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent, VoiceInputButtonComponent],
  template: `
    <div class="capture-overlay" (click)="closeIfOutside($event)">
      <div class="capture-modal" role="dialog" aria-labelledby="capture-title">
        <div class="capture-header">
          <div class="capture-icon">
            <span translate="no" class="material-icons">edit_note</span>
          </div>
          <h2 id="capture-title">Quick note</h2>
          <button class="icon-btn" (click)="close.emit()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

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
          <span class="toolbar-spacer"></span>
          <app-voice-input-button (transcribed)="insertSpoken($event)" />
        </div>

        <div class="capture-editor">
          <div
            #editor
            class="editor-content"
            contenteditable="true"
            translate="no"
            [attr.data-placeholder]="'Write or speak a note. Where it goes is decided after.'"
            (input)="onInput($event)"
            (keydown)="onKeydown($event)"
          ></div>
        </div>

        @if (suggesting()) {
          <div class="capture-destination loading">
            <span translate="no" class="material-icons spin">auto_awesome</span>Finding the right place
          </div>
        } @else if (suggestion() || !aiInbox) {
          <div class="capture-destination">
            <div class="destination-row">
              <label for="capture-space">Save to the inbox of</label>
              <app-searchable-select
                id="capture-space"
                [options]="spaceOptions()"
                [placeholder]="spaces().length === 0 ? 'Loading spaces' : 'Choose a space'"
                searchPlaceholder="Find a space"
                [ngModel]="spaceId()"
                (ngModelChange)="spaceId.set($event)"
              />
            </div>
            @if (suggestion()?.reason) {
              <p class="destination-reason">
                <span translate="no" class="material-icons">auto_awesome</span>{{ suggestion()!.reason }}
              </p>
            }
            @if (suggestion()?.tasks?.length) {
              <fieldset class="capture-tasks">
                <legend>Tasks in this note</legend>
                @for (task of suggestion()!.tasks; track $index; let i = $index) {
                  <label class="capture-task">
                    <input type="checkbox" [checked]="chosenTasks().has(i)" (change)="toggleTask(i)" />
                    <span class="task-text">{{ task.title }}</span>
                    <span class="task-extra">
                      @if (task.dueDate) { <span>{{ task.dueDate | date:'mediumDate' }}</span> }
                      @if (task.assigneeName) { <span>{{ task.assigneeName }}@if (!task.assigneeId) { (not a member) }</span> }
                    </span>
                  </label>
                }
              </fieldset>
            }
          </div>
        }

        <div class="capture-footer">
          <div class="capture-hint">
            @if (stale()) {
              <button type="button" class="link-btn" (click)="suggest()">
                <span translate="no" class="material-icons">refresh</span>The note changed. Suggest again
              </button>
            } @else {
              <span translate="no" class="material-icons">keyboard_command_key</span>Cmd+Enter
            }
          </div>
          <div class="capture-actions">
            <button class="btn btn-secondary" (click)="close.emit()">Cancel</button>
            @if (needsSuggestion()) {
              <button class="btn btn-primary" [disabled]="!hasText() || suggesting()" (click)="suggest()">
                <span translate="no" class="material-icons">auto_awesome</span>Find a place
              </button>
            } @else {
              <button class="btn btn-primary" [disabled]="!hasText() || !spaceId() || submitting()" (click)="submit()">
                <span translate="no" class="material-icons">inbox</span>{{ submitting() ? 'Saving' : 'Save to inbox' }}
              </button>
            }
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
      max-height: calc(100vh - 120px);
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

    .capture-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.02);
    }

    .toolbar-spacer { flex: 1; }

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
      flex: 1;
      overflow-y: auto;
    }

    .editor-content {
      padding: 16px 18px;
      min-height: 160px;
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

    .capture-destination {
      padding: 12px 18px;
      border-top: 1px solid var(--border);

      &.loading {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: var(--text-secondary);

        .material-icons { font-size: 18px; color: var(--primary); }
      }
    }

    .spin { animation: capture-pulse 1.2s ease-in-out infinite; }

    @keyframes capture-pulse { 50% { opacity: 0.35; } }

    .destination-row {
      display: flex;
      align-items: center;
      gap: 10px;

      label { font-size: 13px; color: var(--text-secondary); flex-shrink: 0; }
      app-searchable-select { flex: 1; min-width: 0; }
    }

    .destination-reason {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--text-muted);

      .material-icons { font-size: 15px; color: var(--primary); margin-top: 2px; }
    }

    .capture-tasks {
      margin: 12px 0 0;
      padding: 0;
      border: 0;

      legend { margin-bottom: 4px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    }

    .capture-task {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 4px 8px;
      padding: 4px 0;
      font-size: 14px;
      color: var(--text-primary);
      cursor: pointer;

      input { align-self: center; }
    }

    .task-extra {
      display: inline-flex;
      gap: 8px;
      font-size: 12px;
      color: var(--text-muted);
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

      .material-icons { font-size: 14px; }
    }

    .link-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--primary-dark);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
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

  private spacesService = inject(SpacesService);
  private inboxService = inject(InboxService);
  private tasksService = inject(TasksService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  readonly aiInbox = inject(CapabilitiesService).aiInbox();

  spaces = signal<WritableSpace[]>([]);
  spaceId = signal<string | null>(null);
  suggestion = signal<CaptureSuggestion | null>(null);
  chosenTasks = signal<Set<number>>(new Set());
  suggesting = signal(false);
  submitting = signal(false);
  hasText = signal(false);
  stale = signal(false);
  content = '';

  spaceOptions = computed<SelectOption[]>(() =>
    this.spaces().filter(s => !s.inConflict).map(s => ({ value: s.id, label: s.name, sublabel: s.fullPath }))
  );

  /** With AI the note is placed first; the save button appears once a place is suggested. */
  needsSuggestion = computed(() => this.aiInbox && !this.suggestion());

  ngOnInit(): void {
    this.spacesService.getWritableSpaces().subscribe({
      next: spaces => {
        this.spaces.set(spaces);
        if (!this.aiInbox && !this.spaceId()) this.spaceId.set(spaces.find(s => !s.inConflict)?.id ?? null);
      }
    });
  }

  ngAfterViewInit(): void {
    const editor = this.editorEl?.nativeElement;
    if (!editor) return;
    if (this.initialText) {
      editor.innerText = this.initialText;
      this.syncContent(editor);
    }
    editor.focus();
  }

  onInput(event: Event): void {
    this.syncContent(event.target as HTMLElement);
    if (this.suggestion()) this.stale.set(true);
  }

  insertSpoken(text: string): void {
    const editor = this.editorEl?.nativeElement;
    if (!editor) return;
    const existing = editor.innerText.trim();
    editor.innerText = existing ? `${existing}\n${text}` : text;
    this.syncContent(editor);
    if (this.suggestion()) this.stale.set(true);
  }

  private syncContent(editor: HTMLElement): void {
    this.content = editor.innerHTML;
    this.hasText.set(editor.innerText.trim().length > 0);
  }

  suggest(): void {
    if (!this.hasText() || this.suggesting()) return;
    this.suggesting.set(true);
    this.inboxService.suggestPlace(this.content).subscribe({
      next: suggestion => {
        this.suggesting.set(false);
        this.stale.set(false);
        this.suggestion.set(suggestion);
        this.spaceId.set(suggestion.space?.id ?? this.spaceId());
        this.chosenTasks.set(new Set(suggestion.tasks.map((_, i) => i)));
      },
      error: (e: HttpErrorResponse) => {
        this.suggesting.set(false);
        // Without a suggestion the note can still be filed by hand.
        this.suggestion.set({ space: null, reason: null, tasks: [], aiUsed: false });
        this.spaceId.set(this.spaces().find(s => !s.inConflict)?.id ?? null);
        this.toastService.warning('No suggestion', e.error?.message || 'Pick the space yourself.');
      }
    });
  }

  toggleTask(index: number): void {
    this.chosenTasks.update(set => {
      const next = new Set(set);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.close.emit();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (this.needsSuggestion()) this.suggest(); else this.submit();
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
    const spaceId = this.spaceId();
    const space = this.spaces().find(s => s.id === spaceId);
    if (!this.hasText() || !space || this.submitting()) return;
    this.submitting.set(true);

    const tasks = (this.suggestion()?.tasks ?? []).filter((_, i) => this.chosenTasks().has(i));
    this.inboxService.createNote(space.id, this.content).subscribe({
      next: note => {
        const creations = tasks.map(task => this.tasksService.create(space.id, this.taskRequest(task, note.id)));
        (creations.length ? forkJoin(creations) : of([])).subscribe({
          next: created => this.finish(space, created.length),
          error: () => {
            this.finish(space, 0);
            this.toastService.error('Tasks not created', 'The note was saved, but its tasks could not be created.');
          }
        });
      },
      error: () => {
        this.toastService.error('Error', 'Failed to add note to inbox.');
        this.submitting.set(false);
      }
    });
  }

  private taskRequest(task: CaptureTask, noteId: string) {
    return {
      title: task.title,
      dueDate: task.dueDate ?? undefined,
      assigneeId: task.assigneeId ?? undefined,
      sourceType: 'INBOX_NOTE' as const,
      sourceId: noteId,
      sourceLabel: 'Quick note'
    };
  }

  private finish(space: WritableSpace, taskCount: number): void {
    this.submitting.set(false);
    const tasks = taskCount ? ` with ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}` : '';
    this.toastService.success('Note saved', `In the inbox of ${space.name}${tasks}.`, {
      action: { label: 'Open inbox', handler: () => this.router.navigate(spaceRoute(space.fullPath, 'inbox')) }
    });
    this.noteCreated.emit();
    this.close.emit();
  }
}
