import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type TaskStatus = 'SUGGESTED' | 'OPEN' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type TaskSourceType = 'DOCUMENT' | 'INBOX_NOTE' | 'MEETING' | 'CONVERSATION';

export interface TaskUser {
  id: string;
  name: string;
  email: string;
}

export interface TaskSource {
  type: TaskSourceType;
  id: string;
  label?: string | null;
}

export interface Task {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority?: TaskPriority | null;
  assignee?: TaskUser | null;
  dueDate?: string | null;
  createdBy?: TaskUser | null;
  source?: TaskSource | null;
  createdAt: string;
  updatedAt: string;
  doneAt?: string | null;
  canEdit: boolean;
}

export interface MyTasks {
  assigned: Task[];
  toConfirm: Task[];
}

export interface NewTaskRequest {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  dueDate?: string;
  sourceType?: TaskSourceType;
  sourceId?: string;
  sourceLabel?: string;
}

/** Absent fields stay as they are; the clear flags remove a value. */
export interface TaskChangesRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  clearPriority?: boolean;
  assigneeId?: string;
  clearAssignee?: boolean;
  dueDate?: string;
  clearDueDate?: boolean;
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  SUGGESTED: 'Suggested',
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done'
};

@Injectable({ providedIn: 'root' })
export class TasksService {
  private http = inject(HttpClient);

  mine(): Observable<MyTasks> {
    return this.http.get<MyTasks>('/api/tasks/mine');
  }

  forSpace(spaceId: string, status?: TaskStatus | null): Observable<Task[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<Task[]>(`/api/spaces/${spaceId}/tasks`, { params });
  }

  forSource(sourceType: TaskSourceType, sourceId: string): Observable<Task[]> {
    return this.http.get<Task[]>('/api/tasks', { params: new HttpParams().set('sourceType', sourceType).set('sourceId', sourceId) });
  }

  assignees(spaceId: string): Observable<TaskUser[]> {
    return this.http.get<TaskUser[]>(`/api/spaces/${spaceId}/tasks/assignees`);
  }

  create(spaceId: string, request: NewTaskRequest): Observable<Task> {
    return this.http.post<Task>(`/api/spaces/${spaceId}/tasks`, request);
  }

  update(taskId: string, changes: TaskChangesRequest): Observable<Task> {
    return this.http.patch<Task>(`/api/tasks/${taskId}`, changes);
  }

  delete(taskId: string): Observable<void> {
    return this.http.delete<void>(`/api/tasks/${taskId}`);
  }
}
