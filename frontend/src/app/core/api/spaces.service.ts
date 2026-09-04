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
  lastSyncFilesChanged?: number;
  syncStatus?: 'OK' | 'SYNC_ERROR' | 'PUSH_ERROR' | 'IN_CONFLICT';
  conflictMrUrl?: string;
  conflictBranch?: string;
  conflictDetectedAt?: string;
}

/** A destination candidate for moving or copying an item into. */
export interface WritableSpace {
  id: string;
  name: string;
  fullPath: string;
  inConflict: boolean;
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

/** Someone who can reach a space, and where their access comes from. */
export interface SpaceMember {
  userId: string;
  userName: string;
  userEmail: string;
  permissionLevel: 'VIEW' | 'EDIT' | 'ADMIN';
  /** Ancestor space the grant is inherited from; absent when set on this space. */
  inheritedFrom?: string;
  /** Team the grant came through, when it wasn't granted directly. */
  viaTeam?: string;
  /** Reaches the space by role rather than by any grant. */
  superAdmin: boolean;
}

/** Outcome of asking for access to a space. */
export interface AccessRequestResponse {
  status: 'SENT' | 'ALREADY_PENDING' | 'ALREADY_HAS_ACCESS' | 'NO_ONE_TO_NOTIFY';
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SpacesService {
  constructor(private http: HttpClient) {}

  getSpaces(): Observable<Space[]> {
    return this.http.get<Space[]>('/api/spaces');
  }

  /** Spaces this user can write documents into — the move/copy destinations. */
  getWritableSpaces(): Observable<WritableSpace[]> {
    return this.http.get<WritableSpace[]>('/api/spaces/writable');
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

  /**
   * Asks whoever can grant it to let the current user into a space.
   * Addressed by path because a 403 gives the caller no space id.
   */
  requestAccess(fullPath: string, message?: string): Observable<AccessRequestResponse> {
    return this.http.post<AccessRequestResponse>('/api/spaces/request-access', { fullPath, message });
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

  /** Everyone with effective access, including grants inherited from an ancestor. */
  getMembers(spaceId: string): Observable<SpaceMember[]> {
    return this.http.get<SpaceMember[]>(`/api/spaces/${spaceId}/members`);
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
