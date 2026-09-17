import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { Space, SpacesService } from '../../core/api/spaces.service';
import { TASK_STATUS_LABELS, Task, TaskStatus, TasksService } from '../../core/api/tasks.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { TaskListComponent } from './task-list.component';
import { TaskEditorDialogComponent, TaskDraft } from './task-editor-dialog.component';
import { TaskListState } from './task-list-state';

type Filter = 'ACTIVE' | TaskStatus;

/** The tasks of one space (or, for a group, of every repository in it the user can read). */
@Component({
  selector: 'app-space-tasks',
  standalone: true,
  imports: [CommonModule, TaskListComponent, TaskEditorDialogComponent],
  template: `
    <div class="space-tasks">
      <header class="space-tasks-header">
        <div>
          <h1>Tasks</h1>
          <p class="subtitle">{{ space()?.name }}</p>
        </div>
        @if (space()?.type === 'REPOSITORY') {
          <button type="button" class="btn btn-primary" (click)="creating.set(true)">
            <span translate="no" class="material-icons">add</span>New task
          </button>
        }
      </header>

      <div class="filters" role="tablist" aria-label="Filter tasks">
        @for (f of filters; track f.value) {
          <button
            type="button"
            role="tab"
            class="filter"
            [class.active]="filter() === f.value"
            [attr.aria-selected]="filter() === f.value"
            (click)="filter.set(f.value)"
          >{{ f.label }} <span class="count">{{ countFor(f.value) }}</span></button>
        }
        <label class="mine-toggle">
          <input type="checkbox" [checked]="onlyMine()" (change)="onlyMine.set(!onlyMine())" />
          Only mine
        </label>
      </div>

      <section class="card">
        @if (state.loading()) {
          <p class="hint">Loading</p>
        } @else if (visible().length) {
          <app-task-list
            [tasks]="visible()"
            [showSpace]="space()?.type === 'GROUP'"
            [busyId]="state.busyId()"
            (open)="editing.set($event)"
            (toggleDone)="state.toggleDone($event, [tasks])"
          />
        } @else {
          <p class="hint">{{ filter() === 'DONE' ? 'Nothing finished yet.' : 'No tasks here.' }}</p>
        }
      </section>
    </div>

    @if (creating()) {
      <app-task-editor-dialog [draft]="draft()" (saved)="onSaved($event)" (cancelled)="creating.set(false)" />
    }
    @if (editing(); as task) {
      <app-task-editor-dialog [task]="task" (saved)="onSaved($event)" (deleted)="onDeleted($event)" (cancelled)="editing.set(null)" />
    }
  `,
  styles: [`
    .space-tasks {
      max-width: 960px;
      padding: var(--spacing-xl) var(--spacing-lg);
    }

    .space-tasks-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-md);

      h1 { margin: 0; font-size: 24px; color: var(--text-primary); }
      .subtitle { margin: 4px 0 0; color: var(--text-muted); }
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: var(--spacing-md);
    }

    .filter {
      padding: 5px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-full);
      background: var(--surface);
      color: var(--text-secondary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;

      &.active { border-color: var(--primary-dark); background: var(--primary-dark); color: #fff; }
      &.active .count { color: #fff; }
    }

    .count { margin-left: 2px; color: var(--text-muted); }

    .mine-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: auto;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .card {
      padding: var(--spacing-sm);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);
    }

    .hint { margin: var(--spacing-md); font-size: 14px; color: var(--text-muted); }

    @media (max-width: 640px) {
      .space-tasks { padding: var(--spacing-md); }
      .mine-toggle { margin-left: 0; }
    }
  `]
})
export class SpaceTasksComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private spacesService = inject(SpacesService);
  private tasksService = inject(TasksService);
  private title = inject(Title);

  state = new TaskListState(this.tasksService, inject(ToastService), inject(AuthService));
  tasks = this.state.list();
  space = signal<Space | null>(null);
  filter = signal<Filter>('ACTIVE');
  onlyMine = signal(false);
  creating = signal(false);
  editing = signal<Task | null>(null);

  readonly filters: { value: Filter; label: string }[] = [
    { value: 'ACTIVE', label: 'Not done' },
    { value: 'OPEN', label: TASK_STATUS_LABELS.OPEN },
    { value: 'IN_PROGRESS', label: TASK_STATUS_LABELS.IN_PROGRESS },
    { value: 'DONE', label: TASK_STATUS_LABELS.DONE }
  ];

  draft = computed<TaskDraft>(() => ({ spaceId: this.space()?.id }));

  visible = computed(() => this.tasks.items()
    .filter(t => t.status !== 'SUGGESTED')
    .filter(t => !this.onlyMine() || this.state.isMine(t))
    .filter(t => this.matches(t, this.filter())));

  private subscription?: Subscription;

  ngOnInit(): void {
    this.subscription = this.route.parent?.paramMap.subscribe(params => {
      const fullPath = [params.get('path1'), params.get('path2'), params.get('path3')].filter(Boolean).join('/');
      if (!fullPath) return;
      this.state.loading.set(true);
      this.spacesService.getSpaceByPath(fullPath).subscribe({
        next: space => {
          this.space.set(space);
          this.title.setTitle(`Tasks – ${space.name} – DocuVault`);
          this.tasksService.forSpace(space.id).subscribe({
            next: tasks => {
              this.tasks.items.set(tasks);
              this.state.loading.set(false);
            },
            error: () => this.state.loading.set(false)
          });
        },
        error: () => this.state.loading.set(false)
      });
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  countFor(filter: Filter): number {
    return this.tasks.items().filter(t => t.status !== 'SUGGESTED' && this.matches(t, filter)).length;
  }

  onSaved(task: Task): void {
    this.creating.set(false);
    this.editing.set(null);
    this.tasks.upsert(task);
  }

  onDeleted(task: Task): void {
    this.editing.set(null);
    this.tasks.remove(task);
  }

  private matches(task: Task, filter: Filter): boolean {
    return filter === 'ACTIVE' ? task.status !== 'DONE' : task.status === filter;
  }
}
