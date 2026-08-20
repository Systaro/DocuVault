import { Injectable } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export interface Document {
  id: string;
  path: string;
  title?: string;
  lastSyncedAt?: string;
}

export interface DocumentContent {
  id?: string;
  path: string;
  title?: string;
  content: string;
  /** SHA-256 of the content as served — the API has always sent it. */
  contentHash?: string;
  lastSyncedAt?: string;
}

export interface CreateDocumentRequest {
  path: string;
  title?: string;
  content: string;
  autoCommit?: boolean;
  commitMessage?: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  content: string;
  autoCommit?: boolean;
  commitMessage?: string;
}

export interface DocumentTranslation {
  targetLanguage: string;
  content: string;
  cached: boolean;
}

export interface DocumentTranslations {
  path: string;
  languages: string[];
}

/** One file queued for upload, with its path relative to the destination folder.
 *  Loose files carry just their name; files picked up from a dropped directory
 *  carry the subpath that recreates the tree. */
export interface UploadItem {
  file: File;
  relativePath: string;
}

export interface UploadedFile {
  path: string;
  name: string;
}

export type TransferMode = 'MOVE' | 'COPY';

export interface TransferRequest {
  sourcePath: string;
  targetSpaceId: string;
  /** '' targets the destination space's root. */
  targetFolder: string;
  mode: TransferMode;
}

export interface TransferResult {
  targetSpaceId: string;
  targetSpaceFullPath: string;
  targetPath: string;
  /** True when the name was suffixed because the destination was taken. */
  renamed: boolean;
  fileCount: number;
}

/** A commit as the history APIs report it. */
export interface FileVersion {
  sha: string;
  shortSha: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  committedAt: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  constructor(private http: HttpClient) {}

  getFileTree(spaceId: string): Observable<FileNode[]> {
    return this.http.get<FileNode[]>(`/api/spaces/${spaceId}/documents/tree`);
  }

  getDocuments(spaceId: string): Observable<Document[]> {
    return this.http.get<Document[]>(`/api/spaces/${spaceId}/documents`);
  }

  /** Last commit per direct child of a folder, keyed by entry name. */
  getFolderHistory(spaceId: string, folder: string): Observable<Record<string, FileVersion>> {
    return this.http.get<Record<string, FileVersion>>(
      `/api/spaces/${spaceId}/documents/folder-history`,
      { params: { path: folder } }
    );
  }

  getDocument(spaceId: string, path: string): Observable<DocumentContent> {
    return this.http.get<DocumentContent>(`/api/spaces/${spaceId}/documents/${path}`);
  }

  createDocument(spaceId: string, data: CreateDocumentRequest): Observable<DocumentContent> {
    return this.http.post<DocumentContent>(`/api/spaces/${spaceId}/documents`, data);
  }

  updateDocument(spaceId: string, path: string, data: UpdateDocumentRequest): Observable<DocumentContent> {
    return this.http.put<DocumentContent>(`/api/spaces/${spaceId}/documents/${path}`, data);
  }

  deleteDocument(spaceId: string, path: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/documents/${path}`);
  }

  translate(spaceId: string, path: string, targetLanguage: string): Observable<DocumentTranslation> {
    return this.http.post<DocumentTranslation>(`/api/spaces/${spaceId}/documents/translate`, {
      path,
      targetLanguage
    });
  }

  /** Cached translation languages for the whole space (path → languages), or for a single document when path is given. */
  getTranslations(spaceId: string, path?: string): Observable<DocumentTranslations[]> {
    const options = path ? { params: { path } } : {};
    return this.http.get<DocumentTranslations[]>(`/api/spaces/${spaceId}/documents/translations`, options);
  }

  deleteTranslation(spaceId: string, path: string, targetLanguage: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/documents/translations`, {
      params: { path, targetLanguage }
    });
  }

  createFolder(spaceId: string, path: string): Observable<void> {
    return this.http.post<void>(`/api/spaces/${spaceId}/documents/folder`, { path });
  }

  rename(spaceId: string, oldPath: string, newPath: string): Observable<void> {
    return this.http.post<void>(`/api/spaces/${spaceId}/documents/rename`, { oldPath, newPath });
  }

  /**
   * Move or copy an item into `targetSpaceId` — which may be the space it is
   * already in. `spaceId` is always where it comes from.
   */
  transfer(spaceId: string, request: TransferRequest): Observable<TransferResult> {
    return this.http.post<TransferResult>(`/api/spaces/${spaceId}/documents/transfer`, request);
  }

  /**
   * Uploads one chunk of a batch. `relativePath` travels in its own index-aligned
   * field rather than as the part filename, because the backend deliberately
   * strips separators from filenames (Windows browsers send full local paths).
   *
   * Set `commit: false` on every chunk but the last so a folder upload becomes a
   * single commit. Emits raw HTTP events so callers can report upload progress.
   */
  uploadFiles(
    spaceId: string,
    items: UploadItem[],
    options: { folder?: string; commit?: boolean; commitMessage?: string } = {}
  ): Observable<HttpEvent<UploadedFile[]>> {
    const formData = new FormData();
    for (const item of items) {
      formData.append('files', item.file, item.file.name);
      formData.append('paths', item.relativePath);
    }
    if (options.folder) {
      formData.append('folder', options.folder);
    }
    if (options.commit === false) {
      formData.append('commit', 'false');
    }
    if (options.commitMessage) {
      formData.append('commitMessage', options.commitMessage);
    }
    return this.http.post<UploadedFile[]>(`/api/spaces/${spaceId}/documents/upload`, formData, {
      reportProgress: true,
      observe: 'events'
    });
  }
}
