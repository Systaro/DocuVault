import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
  gitlabProjectId?: number;
  gitlabUrl?: string;
  branch: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  gitError?: string;
}

export interface CreateSpaceRequest {
  name: string;
  slug: string;
  description?: string;
  gitlabProjectId?: number;
  gitlabUrl?: string;
  branch?: string;
  syncEnabled?: boolean;
}

export interface SpacePermission {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  permissionLevel: string;
}

@Injectable({ providedIn: 'root' })
export class SpacesService {
  constructor(private http: HttpClient) {}

  getSpaces(): Observable<Space[]> {
    return this.http.get<Space[]>('/api/spaces');
  }

  getSpace(id: string): Observable<Space> {
    return this.http.get<Space>(`/api/spaces/${id}`);
  }

  getSpaceBySlug(slug: string): Observable<Space> {
    return this.http.get<Space>(`/api/spaces/slug/${slug}`);
  }

  createSpace(data: CreateSpaceRequest): Observable<Space> {
    return this.http.post<Space>('/api/spaces', data);
  }

  updateSpace(id: string, data: Partial<Space>): Observable<Space> {
    return this.http.put<Space>(`/api/spaces/${id}`, data);
  }

  deleteSpace(id: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${id}`);
  }

  getPermissions(spaceId: string): Observable<SpacePermission[]> {
    return this.http.get<SpacePermission[]>(`/api/spaces/${spaceId}/permissions`);
  }

  addPermission(spaceId: string, userId: string, level: string): Observable<SpacePermission> {
    return this.http.post<SpacePermission>(`/api/spaces/${spaceId}/permissions`, {
      userId,
      permissionLevel: level
    });
  }

  removePermission(spaceId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/permissions/${userId}`);
  }
}
