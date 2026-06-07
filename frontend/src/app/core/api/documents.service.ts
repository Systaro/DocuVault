import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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

@Injectable({ providedIn: 'root' })
export class DocumentsService {
  constructor(private http: HttpClient) {}

  getFileTree(spaceId: string): Observable<FileNode[]> {
    return this.http.get<FileNode[]>(`/api/spaces/${spaceId}/documents/tree`);
  }

  getDocuments(spaceId: string): Observable<Document[]> {
    return this.http.get<Document[]>(`/api/spaces/${spaceId}/documents`);
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

  createFolder(spaceId: string, path: string): Observable<void> {
    return this.http.post<void>(`/api/spaces/${spaceId}/documents/folder`, { path });
  }

  rename(spaceId: string, oldPath: string, newPath: string): Observable<void> {
    return this.http.post<void>(`/api/spaces/${spaceId}/documents/rename`, { oldPath, newPath });
  }

  uploadFiles(spaceId: string, files: File[], folder?: string): Observable<{ path: string; name: string }[]> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }
    if (folder) {
      formData.append('folder', folder);
    }
    return this.http.post<{ path: string; name: string }[]>(`/api/spaces/${spaceId}/documents/upload`, formData);
  }
}
