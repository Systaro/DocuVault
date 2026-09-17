import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TASK_STATUS_LABELS, Task } from '../../core/api/tasks.service';
import { spaceRoute } from '../../shared/utils/route-utils';

/**
 * Rows of tasks with the actions each one allows: tick it off, open it for
 * editing, or, for a suggestion, confirm or dismiss it. The parent owns the
 * list and applies what comes back, so every view stays in step.
 */
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <ul class="task-list">
      @for (task of tasks(); track task.id) {
        <li class="task-row" [class.done]="task.status === 'DONE'" [class.suggested]="task.status === 'SUGGESTED'">
          @if (task.status === 'SUGGESTED') {
            <span translate="no" class="material-icons suggested-icon" title="Suggested">lightbulb</span>
          } @else {
            <button
              type="button"
              class="task-check"
              role="checkbox"
              [attr.aria-checked]="task.status === 'DONE'"
              [attr.aria-label]="(task.status === 'DONE' ? 'Reopen ' : 'Mark done: ') + task.title"
              [disabled]="busyId() === task.id"
              (click)="toggleDone.emit(task)"
            >
              <span translate="no" class="material-icons">{{ task.status === 'DONE' ? 'check_circle' : 'radio_button_unchecked' }}</span>
            </button>
          }

          <button type="button" class="task-main" (click)="open.emit(task)" [attr.aria-label]="'Open task ' + task.title">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              @if (task.status === 'IN_PROGRESS') {
                <span class="pill progress">{{ statusLabels.IN_PROGRESS }}</span>
              }
              @if (task.priority === 'HIGH') {
                <span class="pill high">High</span>
              }
              @if (task.dueDate) {
                <span class="due" [class.overdue]="isOverdue(task)">
                  <span translate="no" class="material-icons">event</span>{{ task.dueDate | date:'mediumDate' }}
                </span>
              }
              @if (task.assignee) {
                <span class="assignee">
                  <span translate="no" class="material-icons">person</span>{{ task.assignee.name }}
                </span>
              }
              @if (showSpace()) {
                <span class="space">{{ task.spaceName }}</span>
              }
              @if (task.source?.label) {
                <span class="source">from {{ task.source!.label }}</span>
              }
            </span>
          </button>

          @if (task.status === 'SUGGESTED') {
            <div class="suggestion-actions">
              <button type="button" class="btn btn-ghost" [disabled]="busyId() === task.id" (click)="dismiss.emit(task)">Dismiss</button>
              <button type="button" class="btn btn-primary" [disabled]="busyId() === task.id" (click)="confirm.emit(task)">Confirm</button>
            </div>
          } @else if (showSpace()) {
            <a class="icon-btn open-space" [routerLink]="spaceLink(task)" [title]="'Open ' + task.spaceName">
              <span translate="no" class="material-icons">chevron_right</span>
            </a>
          }
        </li>
      }
    </ul>
  `,
  styles: [`
    .task-list {
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .task-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-light);

      &:last-child { border-bottom: 0; }
      &.done .task-title { color: var(--text-muted); text-decoration: line-through; }
      &.suggested { background: color-mix(in srgb, var(--warning) 6%, transparent); }
    }

    .task-check {
      display: inline-flex;
      padding: 2px;
      border: 0;
      background: none;
      color: var(--primary-dark);
      cursor: pointer;

      .material-icons { font-size: 22px; }
      &:disabled { opacity: 0.5; }
    }

    .suggested-icon {
      padding: 2px;
      font-size: 22px;
      color: var(--warning);
    }

    .task-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 2px 0;
      border: 0;
      background: none;
      text-align: left;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }

    .task-title {
      font-size: 14.5px;
      color: var(--text-primary);
      overflow-wrap: anywhere;
    }

    .task-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 10px;
      font-size: 12.5px;
      color: var(--text-muted);

      .material-icons { font-size: 14px; vertical-align: -2px; margin-right: 2px; }
    }

    .pill {
      padding: 0 7px;
      border-radius: var(--radius-full);
      font-weight: 600;

      &.progress { background: var(--primary-light); color: var(--text-primary); }
      &.high { background: color-mix(in srgb, var(--error) 15%, transparent); color: var(--error); }
    }

    .due.overdue { color: var(--error); font-weight: 600; }

    .space {
      padding: 0 7px;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      color: var(--text-secondary);
    }

    .suggestion-actions {
      display: flex;
      gap: 4px;

      .btn { padding: 4px 10px; font-size: 13px; }
    }
  `]
})
export class TaskListComponent {
  tasks = input.required<Task[]>();
  showSpace = input(false);
  busyId = input<string | null>(null);

  toggleDone = output<Task>();
  open = output<Task>();
  confirm = output<Task>();
  dismiss = output<Task>();

  readonly statusLabels = TASK_STATUS_LABELS;

  isOverdue(task: Task): boolean {
    if (!task.dueDate || task.status === 'DONE') return false;
    return task.dueDate < new Date().toISOString().slice(0, 10);
  }

  spaceLink(task: Task): string[] {
    return spaceRoute(task.spaceFullPath, 'tasks');
  }
}
