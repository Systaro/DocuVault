import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Title } from '@angular/platform-browser';
import { LayoutComponent } from '../../shared/components/layout.component';
import { ToastService } from '../../shared/services/toast.service';
import { Task, TasksService } from '../../core/api/tasks.service';
import { TaskListComponent } from './task-list.component';
import { TaskEditorDialogComponent } from './task-editor-dialog.component';
import { TaskListState } from './task-list-state';
import { AuthService } from '../../core/auth/auth.service';

/** Everything on the user's plate, across spaces: suggestions to confirm, then their open tasks. */
@Component({
  selector: 'app-my-tasks',
  standalone: true,
  imports: [CommonModule, LayoutComponent, TaskListComponent, TaskEditorDialogComponent],
  template: `
    <app-layout>
      <div class="tasks-page">
        <header class="tasks-header">
          <div>
            <h1>My tasks</h1>
            <p class="subtitle">Assigned to you in any space</p>
          </div>
          <button type="button" class="btn btn-primary" (click)="creating.set(true)">
            <span translate="no" class="material-icons">add</span>New task
          </button>
        </header>

        @if (state.loading()) {
          <p class="hint">Loading</p>
        } @else {
          @if (toConfirm.items().length) {
            <section class="card">
              <h2>To confirm <span class="count">{{ toConfirm.items().length }}</span></h2>
              <p class="section-hint">Suggested from meetings and notes. Nothing reaches anyone's list until you confirm it.</p>
              <app-task-list
                [tasks]="toConfirm.items()"
                [showSpace]="true"
                [busyId]="state.busyId()"
                (open)="editing.set($event)"
                (confirm)="state.confirm($event, [toConfirm, assigned])"
                (dismiss)="state.dismiss($event, [toConfirm])"
              />
            </section>
          }

          <section class="card">
            <h2>Open <span class="count">{{ assigned.items().length }}</span></h2>
            @if (assigned.items().length) {
              <app-task-list
                [tasks]="assigned.items()"
                [showSpace]="true"
                [busyId]="state.busyId()"
                (open)="editing.set($event)"
                (toggleDone)="state.toggleDone($event, [assigned], true)"
              />
            } @else {
              <p class="hint">Nothing assigned to you. Enjoy it.</p>
            }
          </section>
        }
      </div>

      @if (creating()) {
        <app-task-editor-dialog (saved)="onCreated($event)" (cancelled)="creating.set(false)" />
      }
      @if (editing(); as task) {
        <app-task-editor-dialog
          [task]="task"
          (saved)="onEdited($event)"
          (deleted)="onDeleted($event)"
          (cancelled)="editing.set(null)"
        />
      }
    </app-layout>
  `,
  styles: [`
    .tasks-page {
      max-width: 900px;
      margin: 0 auto;
      padding: var(--spacing-xl) var(--spacing-lg);
    }

    .tasks-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-lg);

      h1 { margin: 0; font-size: 26px; color: var(--text-primary); }
      .subtitle { margin: 4px 0 0; color: var(--text-muted); }
    }

    .card {
      margin-bottom: var(--spacing-lg);
      padding: var(--spacing-md);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--surface);

      h2 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 var(--spacing-sm);
        font-size: 16px;
        color: var(--text-primary);
      }
    }

    .count {
      padding: 0 8px;
      border-radius: var(--radius-full);
      background: var(--background-darker);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .section-hint, .hint { margin: 0 0 var(--spacing-sm); font-size: 13px; color: var(--text-muted); }

    @media (max-width: 640px) {
      .tasks-page { padding: var(--spacing-md); }
    }
  `]
})
export class MyTasksComponent implements OnInit {
  private tasksService = inject(TasksService);
  private toast = inject(ToastService);
  private title = inject(Title);

  state = new TaskListState(this.tasksService, this.toast, inject(AuthService));
  assigned = this.state.list();
  toConfirm = this.state.list();
  creating = signal(false);
  editing = signal<Task | null>(null);

  ngOnInit(): void {
    this.title.setTitle('My tasks – DocuVault');
    this.state.loading.set(true);
    this.tasksService.mine().subscribe({
      next: mine => {
        this.assigned.items.set(mine.assigned);
        this.toConfirm.items.set(mine.toConfirm);
        this.state.loading.set(false);
      },
      error: () => this.state.loading.set(false)
    });
  }

  onCreated(task: Task): void {
    this.creating.set(false);
    if (this.state.isMine(task)) this.assigned.upsert(task);
    this.toast.success('Task created', task.title);
  }

  onEdited(task: Task): void {
    this.editing.set(null);
    if (task.status === 'SUGGESTED') {
      this.toConfirm.replace(task);
      return;
    }
    // A task that is done or given to someone else leaves this page.
    if (this.state.isMine(task) && task.status !== 'DONE') this.assigned.upsert(task);
    else this.assigned.remove(task);
  }

  onDeleted(task: Task): void {
    this.editing.set(null);
    this.assigned.remove(task);
    this.toConfirm.remove(task);
  }
}
