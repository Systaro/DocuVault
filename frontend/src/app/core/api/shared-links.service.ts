import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SharedLink {
  id: string;
  token: string;
  spaceId: string;
  filePath: string;
  expiresAt: string | null;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  hasPassword: boolean;
  shareType: 'FILE' | 'FOLDER';
}

export interface SharedFileMetadata {
  fileName: string;
  extension: string;
  contentType: string;
  spaceName: string;
  filePath: string;
  shareType: 'FILE' | 'FOLDER';
  requiresPassword: boolean;
}

export interface CreateShareLinkRequest {
  filePath: string;
  expiresInDays?: number | null;
  password?: string | null;
  shareType?: 'FILE' | 'FOLDER';
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

@Injectable({ providedIn: 'root' })
export class SharedLinksService {
  constructor(private http: HttpClient) {}

  createLink(spaceId: string, request: CreateShareLinkRequest): Observable<SharedLink> {
    return this.http.post<SharedLink>(`/api/spaces/${spaceId}/shares`, request);
  }

  getLinks(spaceId: string, filePath?: string): Observable<SharedLink[]> {
    if (filePath) {
      return this.http.get<SharedLink[]>(`/api/spaces/${spaceId}/shares`, { params: { filePath } });
    }
    return this.http.get<SharedLink[]>(`/api/spaces/${spaceId}/shares`);
  }

  revokeLink(spaceId: string, linkId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/shares/${linkId}`);
  }

  updateSharePassword(spaceId: string, linkId: string, password: string | null): Observable<void> {
    return this.http.patch<void>(`/api/spaces/${spaceId}/shares/${linkId}/password`, { password });
  }

  getSharedFileMetadata(token: string): Observable<SharedFileMetadata> {
    return this.http.get<SharedFileMetadata>(`/api/shared/${token}`, { withCredentials: true });
  }

  getSharedFileContent(token: string): Observable<string> {
    return this.http.get(`/api/shared/${token}/content`, { responseType: 'text', withCredentials: true });
  }

  verifySharePassword(token: string, password: string): Observable<{ valid: boolean }> {
    return this.http.post<{ valid: boolean }>(`/api/shared/${token}/verify`, { password }, { withCredentials: true });
  }

  getShareFileTree(token: string): Observable<FileNode[]> {
    return this.http.get<FileNode[]>(`/api/shared/${token}/tree`, { withCredentials: true });
  }

  getSharedFolderContent(token: string, subPath: string): Observable<string> {
    return this.http.get(`/api/shared/${token}/content/${subPath}`, { responseType: 'text', withCredentials: true });
  }
}
