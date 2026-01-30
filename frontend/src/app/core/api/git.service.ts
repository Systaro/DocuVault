import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface GitStatus {
  configured: boolean;
  connected: boolean;
}

export interface GitLabProject {
  id: number;
  name: string;
  path: string;
  description?: string;
  httpUrlToRepo: string;
  defaultBranch: string;
  visibility: string;
}

export interface GitOperationResult {
  success: boolean;
  message?: string;
  errorCode?: string;
  userMessage?: string;
  requiresSetup?: boolean;
}

export type GitErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_URL'
  | 'AUTH_FAILED'
  | 'TOKEN_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NETWORK_ERROR'
  | 'HOST_UNREACHABLE'
  | 'CONNECTION_TIMEOUT'
  | 'REPO_NOT_FOUND'
  | 'BRANCH_NOT_FOUND'
  | 'CLONE_FAILED'
  | 'PULL_FAILED'
  | 'PUSH_FAILED'
  | 'MERGE_CONFLICT'
  | 'DISK_FULL'
  | 'PATH_ERROR'
  | 'UNKNOWN_ERROR';

@Injectable({ providedIn: 'root' })
export class GitService {
  constructor(private http: HttpClient) {}

  getStatus(): Observable<GitStatus> {
    return this.http.get<GitStatus>('/api/git/status');
  }

  getProjects(): Observable<GitLabProject[]> {
    return this.http.get<GitLabProject[]>('/api/git/projects');
  }

  getProject(projectId: number): Observable<GitLabProject> {
    return this.http.get<GitLabProject>(`/api/git/projects/${projectId}`);
  }

  getProjectBranches(projectId: number): Observable<string[]> {
    return this.http.get<string[]>(`/api/git/projects/${projectId}/branches`);
  }

  pullChanges(spaceId: string): Observable<GitOperationResult> {
    return this.http.post<GitOperationResult>(`/api/git/spaces/${spaceId}/pull`, {});
  }

  pushChanges(spaceId: string, message: string, authorName: string, authorEmail: string): Observable<GitOperationResult> {
    return this.http.post<GitOperationResult>(`/api/git/spaces/${spaceId}/push`, {
      message,
      authorName,
      authorEmail
    });
  }
}
