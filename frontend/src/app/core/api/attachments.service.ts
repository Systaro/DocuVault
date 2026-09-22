import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpEvent } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiRequestService } from './api-request.service';

export type AttachmentKind = 'IMAGE' | 'PDF' | 'TEXT';

/** A file handed to the assistant: stored privately until it is sent with a question or read into a note. */
export interface Attachment {
  id: string;
  fileName: string;
  contentType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  pageCount?: number | null;
}

/** What the file picker and drop zones accept; the server checks the bytes again. */
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf,.txt,.md,.markdown,.csv,.tsv';
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class AttachmentsService {
  private http = inject(HttpClient);
  private apiRequest = inject(ApiRequestService);

  /** One file per request, so each one reports its own progress. */
  upload(file: Blob, name: string): Observable<HttpEvent<Attachment[]>> {
    const form = new FormData();
    form.append('files', file, name);
    return this.http.post<Attachment[]>('/api/ai/attachments', form, { reportProgress: true, observe: 'events' });
  }

  /** Reads photos and files into the text of a quick note. */
  read(ids: string[]): Observable<{ text: string }> {
    return this.http.post<{ text: string }>('/api/ai/attachments/read', { attachmentIds: ids });
  }

  contentUrl(id: string): string {
    return this.apiRequest.url(`/api/ai/attachments/${encodeURIComponent(id)}/content`);
  }
}
