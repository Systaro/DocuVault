import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DocumentContent } from './documents.service';

export interface DocumentVersion {
  sha: string;
  shortSha: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  committedAt: string;
}

export interface VersionContent {
  path: string;
  sha: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentHistoryService {
  constructor(private http: HttpClient) {}

  /** All versions (commits) of a document, newest first. */
  getHistory(spaceId: string, path: string): Observable<DocumentVersion[]> {
    return this.http.get<DocumentVersion[]>(`/api/spaces/${spaceId}/document-history`, {
      params: { path }
    });
  }

  /** Document content as it existed at the given version. */
  getVersionContent(spaceId: string, path: string, sha: string): Observable<VersionContent> {
    return this.http.get<VersionContent>(`/api/spaces/${spaceId}/document-history/content`, {
      params: { path, sha }
    });
  }

  /** Restores an old version by writing it as a new version on top of the history. */
  restoreVersion(spaceId: string, path: string, sha: string): Observable<DocumentContent> {
    return this.http.post<DocumentContent>(`/api/spaces/${spaceId}/document-history/restore`, {
      path,
      sha
    });
  }
}
