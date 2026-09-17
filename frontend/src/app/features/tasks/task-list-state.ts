import { signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { Task, TasksService } from '../../core/api/tasks.service';
import { ToastService } from '../../shared/services/toast.service';

/** One list of tasks on screen. Changes are applied to it from the server's answer, never by reloading. */
export class TaskList {
  items = signal<Task[]>([]);

  /** Replaces the task where it is, or puts it first. */
  upsert(task: Task): void {
    this.items.update(list => list.some(t => t.id === task.id) ? list.map(t => t.id === task.id ? task : t) : [task, ...list]);
  }

  /** Replaces the task only if this list shows it. */
  replace(task: Task): void {
    this.items.update(list => list.map(t => t.id === task.id ? task : t));
  }

  remove(task: Task): void {
    this.items.update(list => list.filter(t => t.id !== task.id));
  }
}

/** The actions every task list offers, shared by My tasks, a space's tasks, the dashboard and the inbox. */
export class TaskListState {
  loading = signal(false);
  busyId = signal<string | null>(null);

  constructor(private tasks: TasksService, private toast: ToastService, private auth: AuthService) {}

  list(): TaskList {
    return new TaskList();
  }

  isMine(task: Task): boolean {
    return !!task.assignee && task.assignee.email === this.auth.user()?.email;
  }

  /** Ticks a task off or reopens it. With [dropWhenDone] a finished task leaves the lists, with Undo to bring it back. */
  toggleDone(task: Task, lists: TaskList[], dropWhenDone = false): void {
    const status = task.status === 'DONE' ? 'OPEN' : 'DONE';
    this.busyId.set(task.id);
    this.tasks.update(task.id, { status }).subscribe({
      next: updated => {
        this.busyId.set(null);
        lists.forEach(list => dropWhenDone && updated.status === 'DONE' ? list.remove(updated) : list.replace(updated));
        if (updated.status === 'DONE') {
          this.toast.success('Done', updated.title, {
            action: { label: 'Undo', handler: () => this.reopen(updated, lists) }
          });
        }
      },
      error: () => {
        this.busyId.set(null);
        this.toast.error('Could not update the task', 'Please try again.');
      }
    });
  }

  /**
   * Turns a suggestion into a real task. With a separate [open] list the task
   * moves there when it is the user's; without one it stays where it is.
   */
  confirm(task: Task, [suggestions, open]: TaskList[]): void {
    this.busyId.set(task.id);
    this.tasks.update(task.id, { status: 'OPEN' }).subscribe({
      next: updated => {
        this.busyId.set(null);
        if (!open) {
          suggestions.replace(updated);
        } else {
          suggestions.remove(updated);
          if (this.isMine(updated)) open.upsert(updated);
        }
        this.toast.success('Task confirmed', updated.assignee ? `${updated.title}, for ${updated.assignee.name}` : updated.title);
      },
      error: () => {
        this.busyId.set(null);
        this.toast.error('Could not confirm the task', 'Please try again.');
      }
    });
  }

  dismiss(task: Task, lists: TaskList[]): void {
    this.busyId.set(task.id);
    this.tasks.delete(task.id).subscribe({
      next: () => {
        this.busyId.set(null);
        lists.forEach(list => list.remove(task));
      },
      error: () => {
        this.busyId.set(null);
        this.toast.error('Could not dismiss the suggestion', 'Please try again.');
      }
    });
  }

  private reopen(task: Task, lists: TaskList[]): void {
    this.tasks.update(task.id, { status: 'OPEN' }).subscribe({
      next: updated => lists.forEach(list => list.upsert(updated))
    });
  }
}
