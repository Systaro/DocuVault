import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { SpacesService, WritableSpace } from '../../core/api/spaces.service';
import {
  NewTaskRequest, TASK_STATUS_LABELS, Task, TaskPriority, TaskSourceType, TaskStatus, TaskUser, TasksService
} from '../../core/api/tasks.service';

/** Where a new task starts from, when it is not a blank one. */
export interface TaskDraft {
  spaceId?: string | null;
  title?: string;
  description?: string;
  sourceType?: TaskSourceType;
  sourceId?: string;
  sourceLabel?: string;
}

/**
 * Creates a task or edits one. Someone who may only move their own task
 * along (the assignee without edit access) sees the fields but can change
 * just the status.
 */
@Component({
  selector: 'app-task-editor-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="modal-overlay" (click)="cancelled.emit()">
      <form class="modal task-modal" role="dialog" aria-labelledby="task-dialog-title" (click)="$event.stopPropagation()" (ngSubmit)="save()">
        <div class="modal-header">
          <h2 id="task-dialog-title">
            <span translate="no" class="material-icons">task_alt</span>{{ task() ? 'Task' : 'New task' }}
          </h2>
          <button type="button" class="icon-btn" (click)="cancelled.emit()" title="Close">
            <span translate="no" class="material-icons">close</span>
          </button>
        </div>

        <div class="modal-body">
          @if (!task()) {
            <label class="field">
              <span>Space</span>
              <app-searchable-select
                name="space"
                [options]="spaceOptions()"
                [ngModel]="spaceId()"
                (ngModelChange)="selectSpace($event)"
                placeholder="Choose a space you can edit"
              />
            </label>
          } @else {
            <p class="task-space">{{ task()!.spaceName }}@if (task()!.source?.label) { · from {{ task()!.source!.label }} }</p>
          }

          <label class="field">
            <span>Title</span>
            <input class="input" name="title" [(ngModel)]="title" [disabled]="!canEdit()" required maxlength="500" />
          </label>

          <label class="field">
            <span>Details</span>
            <textarea class="input" name="description" rows="3" [(ngModel)]="description" [disabled]="!canEdit()"></textarea>
          </label>

          <div class="field-row">
            <label class="field">
              <span>Assignee</span>
              <app-searchable-select
                name="assignee"
                [options]="assigneeOptions()"
                [ngModel]="assigneeId()"
                (ngModelChange)="assigneeId.set($event)"
                [disabled]="!canEdit() || !spaceId()"
                placeholder="Unassigned"
              />
            </label>
            <label class="field">
              <span>Due</span>
              <input class="input" type="date" name="dueDate" [(ngModel)]="dueDate" [disabled]="!canEdit()" />
            </label>
          </div>

          <div class="field-row">
            <label class="field">
              <span>Priority</span>
              <app-searchable-select
                name="priority"
                [options]="priorityOptions"
                [ngModel]="priority()"
                (ngModelChange)="priority.set($event)"
                [disabled]="!canEdit()"
                [searchable]="false"
              />
            </label>
            @if (task() && task()!.status !== 'SUGGESTED') {
              <label class="field">
                <span>Status</span>
                <app-searchable-select
                  name="status"
                  [options]="statusOptions"
                  [ngModel]="status()"
                  (ngModelChange)="status.set($event)"
                  [searchable]="false"
                />
              </label>
            }
          </div>

          @if (error()) {
            <p class="field-error">{{ error() }}</p>
          }
        </div>

        <div class="modal-footer">
          @if (task() && canEdit()) {
            @if (confirmingDelete()) {
              <span class="delete-question">Delete this task?</span>
              <button type="button" class="btn btn-danger" [disabled]="saving()" (click)="remove()">Delete</button>
            } @else {
              <button type="button" class="btn btn-ghost delete-btn" (click)="confirmingDelete.set(true)">Delete</button>
            }
          }
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="saving() || !canSave()">{{ task() ? 'Save' : 'Create task' }}</button>
        </div>
      </form>
    </div>
  `,
  styles: [`
    .task-modal { width: 560px; }

    .task-space { margin: 0 0 var(--spacing-md); font-size: 13px; color: var(--text-muted); }

    .field {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      margin-bottom: var(--spacing-md);

      > span { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
      textarea { resize: vertical; font: inherit; }
    }

    .field-row {
      display: flex;
      gap: var(--spacing-md);

      @media (max-width: 520px) { flex-direction: column; gap: 0; }
    }

    .field-error { margin: 0; font-size: 13px; color: var(--error); }

    .spacer { flex: 1; }

    .delete-question { font-size: 13px; color: var(--text-secondary); }

    .delete-btn { color: var(--error); }
  `]
})
export class TaskEditorDialogComponent implements OnInit {
  private tasksService = inject(TasksService);
  private spacesService = inject(SpacesService);

  /** The task to edit; absent for a new one. */
  task = input<Task | null>(null);
  draft = input<TaskDraft | null>(null);

  saved = output<Task>();
  deleted = output<Task>();
  cancelled = output<void>();

  writableSpaces = signal<WritableSpace[]>([]);
  assignees = signal<TaskUser[]>([]);
  spaceId = signal<string | null>(null);
  assigneeId = signal<string | null>(null);
  priority = signal<TaskPriority | ''>('');
  status = signal<TaskStatus>('OPEN');
  saving = signal(false);
  confirmingDelete = signal(false);
  error = signal<string | null>(null);
  title = '';
  description = '';
  dueDate = '';

  readonly priorityOptions: SelectOption[] = [
    { value: '', label: 'None' },
    { value: 'LOW', label: 'Low' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'HIGH', label: 'High' }
  ];

  readonly statusOptions: SelectOption[] = (['OPEN', 'IN_PROGRESS', 'DONE'] as TaskStatus[])
    .map(value => ({ value, label: TASK_STATUS_LABELS[value] }));

  spaceOptions = computed<SelectOption[]>(() =>
    this.writableSpaces().filter(s => !s.inConflict).map(s => ({ value: s.id, label: s.name, sublabel: s.fullPath }))
  );

  assigneeOptions = computed<SelectOption[]>(() => [
    { value: null, label: 'Unassigned' },
    ...this.assignees().map(a => ({ value: a.id, label: a.name, sublabel: a.email }))
  ]);

  canEdit = computed(() => this.task()?.canEdit ?? true);

  ngOnInit(): void {
    const task = this.task();
    if (task) {
      this.title = task.title;
      this.description = task.description ?? '';
      this.dueDate = task.dueDate ?? '';
      this.assigneeId.set(task.assignee?.id ?? null);
      this.priority.set(task.priority ?? '');
      this.status.set(task.status);
      this.spaceId.set(task.spaceId);
      if (task.canEdit) this.loadAssignees(task.spaceId);
      else if (task.assignee) this.assignees.set([task.assignee]);
      return;
    }

    const draft = this.draft();
    this.title = draft?.title ?? '';
    this.description = draft?.description ?? '';
    this.spacesService.getWritableSpaces().subscribe({
      next: spaces => {
        this.writableSpaces.set(spaces);
        const preferred = spaces.find(s => s.id === draft?.spaceId && !s.inConflict) ?? spaces.find(s => !s.inConflict);
        if (preferred) this.selectSpace(preferred.id);
      }
    });
  }

  selectSpace(spaceId: string): void {
    this.spaceId.set(spaceId);
    this.assigneeId.set(null);
    this.loadAssignees(spaceId);
  }

  private loadAssignees(spaceId: string): void {
    this.tasksService.assignees(spaceId).subscribe({ next: list => this.assignees.set(list) });
  }

  canSave(): boolean {
    return this.title.trim().length > 0 && !!this.spaceId();
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.error.set(null);
    const task = this.task();
    const call = task ? this.tasksService.update(task.id, this.changesFor(task)) : this.tasksService.create(this.spaceId()!, this.newTask());
    call.subscribe({
      next: result => this.saved.emit(result),
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(e.error?.message || 'The task could not be saved.');
      }
    });
  }

  remove(): void {
    const task = this.task();
    if (!task) return;
    this.saving.set(true);
    this.tasksService.delete(task.id).subscribe({
      next: () => this.deleted.emit(task),
      error: (e: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(e.error?.message || 'The task could not be deleted.');
      }
    });
  }

  private newTask(): NewTaskRequest {
    const draft = this.draft();
    return {
      title: this.title.trim(),
      description: this.description.trim() || undefined,
      assigneeId: this.assigneeId() ?? undefined,
      dueDate: this.dueDate || undefined,
      priority: this.priority() || undefined,
      sourceType: draft?.sourceType,
      sourceId: draft?.sourceId,
      sourceLabel: draft?.sourceLabel
    };
  }

  /** Only what changed, so an assignee without edit access can still save a status change. */
  private changesFor(task: Task) {
    if (!task.canEdit) return { status: this.status() };
    return {
      title: this.title.trim() !== task.title ? this.title.trim() : undefined,
      description: this.description.trim() !== (task.description ?? '') ? this.description.trim() : undefined,
      status: this.status() !== task.status ? this.status() : undefined,
      assigneeId: this.assigneeId() && this.assigneeId() !== task.assignee?.id ? this.assigneeId()! : undefined,
      clearAssignee: !this.assigneeId() && !!task.assignee,
      dueDate: this.dueDate && this.dueDate !== task.dueDate ? this.dueDate : undefined,
      clearDueDate: !this.dueDate && !!task.dueDate,
      priority: this.priority() && this.priority() !== task.priority ? (this.priority() as TaskPriority) : undefined,
      clearPriority: !this.priority() && !!task.priority
    };
  }
}
