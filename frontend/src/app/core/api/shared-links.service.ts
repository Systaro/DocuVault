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
}

export interface SharedFileMetadata {
  fileName: string;
  extension: string;
  contentType: string;
}

export interface CreateShareLinkRequest {
  filePath: string;
  expiresInDays?: number | null;
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

  getSharedFileMetadata(token: string): Observable<SharedFileMetadata> {
    return this.http.get<SharedFileMetadata>(`/api/shared/${token}`);
  }

  getSharedFileContent(token: string): Observable<string> {
    return this.http.get(`/api/shared/${token}/content`, { responseType: 'text' });
  }
}
