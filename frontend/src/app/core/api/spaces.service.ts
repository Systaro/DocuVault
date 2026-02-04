import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type SpaceType = 'GROUP' | 'REPOSITORY';

export interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
  type: SpaceType;
  parentId?: string;
  parentSlug?: string;
  fullPath: string;
  gitlabProjectId?: number;
  gitlabUrl?: string;
  branch: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
  gitError?: string;
  documentCount?: number;
  childCount?: number;
  logoUrl?: string;
}

export interface CreateSpaceRequest {
  name: string;
  slug: string;
  description?: string;
  type?: SpaceType;
  parentId?: string;
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

  getTopLevelSpaces(): Observable<Space[]> {
    return this.http.get<Space[]>('/api/spaces', {
      params: new HttpParams().set('topLevel', 'true')
    });
  }

  getChildren(parentId: string): Observable<Space[]> {
    return this.http.get<Space[]>(`/api/spaces/children/${parentId}`);
  }

  getSpace(id: string): Observable<Space> {
    return this.http.get<Space>(`/api/spaces/${id}`);
  }

  getSpaceBySlug(slug: string): Observable<Space> {
    return this.http.get<Space>(`/api/spaces/slug/${slug}`);
  }

  getSpaceByPath(fullPath: string): Observable<Space> {
    return this.http.get<Space>(`/api/spaces/path/${fullPath}`);
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

  uploadLogo(spaceId: string, file: File): Observable<Space> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<Space>(`/api/spaces/${spaceId}/logo`, formData);
  }

  deleteLogo(spaceId: string): Observable<Space> {
    return this.http.delete<Space>(`/api/spaces/${spaceId}/logo`);
  }
}
