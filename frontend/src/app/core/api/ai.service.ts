import { Injectable, NgZone, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiRequestService } from './api-request.service';

export interface SearchResult {
  documentId: string;
  documentPath: string;
  documentTitle?: string;
  chunkIndex: number;
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  documentPath?: string | null;
  updatedAt: string;
}

export interface MessageSource {
  spaceId: string;
  spaceFullPath?: string | null;
  path: string;
  title?: string | null;
}

export interface MessageToolCall {
  name: string;
  label: string;
  ok: boolean;
}

export type ProposalStatus = 'PENDING' | 'APPLIED' | 'DISCARDED' | 'FAILED';

export interface EditProposal {
  id: string;
  spaceId: string;
  spaceFullPath?: string | null;
  path: string;
  summary: string;
  oldText: string;
  newText: string;
  contextBefore: string;
  contextAfter: string;
  status: ProposalStatus;
  error?: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: MessageSource[];
  toolCalls: MessageToolCall[];
  createdDocuments: MessageSource[];
  proposals: EditProposal[];
  createdTasks: { id: string; spaceId: string; title: string }[];
  /** Files the user sent with this message. */
  attachments: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  contentType: string;
  kind: 'IMAGE' | 'PDF' | 'TEXT';
  sizeBytes: number;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ConversationMessage[];
}

export type DraftTemplate = 'STATUS_REPORT' | 'MEETING_PROTOCOL' | 'CUSTOM';

export interface TurnRequest {
  spaceId?: string;
  conversationId?: string;
  documentPath?: string;
  message: string;
  /** Starts a conversation that writes a draft from the space's recent material. */
  draftTemplate?: DraftTemplate;
  draftDays?: number;
  /** Uploaded through AttachmentsService; a message may be files alone. */
  attachmentIds?: string[];
}

/** What arrives while an answer is being written. */
export type TurnEvent =
  | { type: 'conversation'; conversation: ConversationSummary }
  | { type: 'status'; label: string }
  | { type: 'tool'; toolCall: MessageToolCall }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; message: ConversationMessage }
  | { type: 'error'; message: string };

export interface AiEditResult {
  path: string;
  content: string;
  previousContent: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  private zone = inject(NgZone);
  private apiRequest = inject(ApiRequestService);

  constructor(private http: HttpClient) {}

  search(spaceId: string, query: string, limit?: number): Observable<SearchResult[]> {
    return this.http.post<SearchResult[]>('/api/ai/search', {
      spaceId,
      query,
      limit: limit ?? 5
    });
  }

  listConversations(query?: string): Observable<ConversationSummary[]> {
    const params = query?.trim() ? new HttpParams().set('q', query.trim()) : undefined;
    return this.http.get<ConversationSummary[]>('/api/ai/conversations', { params });
  }

  getConversation(id: string): Observable<ConversationDetail> {
    return this.http.get<ConversationDetail>(`/api/ai/conversations/${id}`);
  }

  renameConversation(id: string, title: string): Observable<ConversationSummary> {
    return this.http.patch<ConversationSummary>(`/api/ai/conversations/${id}`, { title });
  }

  deleteConversation(id: string): Observable<void> {
    return this.http.delete<void>(`/api/ai/conversations/${id}`);
  }

  applyProposal(conversationId: string, messageId: string, proposalId: string): Observable<EditProposal> {
    return this.http.post<EditProposal>(
      `/api/ai/conversations/${conversationId}/messages/${messageId}/proposals/${proposalId}/apply`, {}
    );
  }

  discardProposal(conversationId: string, messageId: string, proposalId: string): Observable<EditProposal> {
    return this.http.post<EditProposal>(
      `/api/ai/conversations/${conversationId}/messages/${messageId}/proposals/${proposalId}/discard`, {}
    );
  }

  /**
   * Sends a message and streams the answer. HttpClient cannot hand out a body
   * while it is still arriving, so this reads the server-sent events with fetch.
   * Unsubscribing stops reading; the server still finishes and stores the answer.
   */
  sendTurn(request: TurnRequest): Observable<TurnEvent> {
    return new Observable<TurnEvent>(subscriber => {
      const abort = new AbortController();
      const emit = (event: TurnEvent) => this.zone.run(() => subscriber.next(event));

      (async () => {
        const response = await fetch(this.apiRequest.url('/api/ai/conversations/turns'), this.apiRequest.fetchInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(request),
          signal: abort.signal
        }));
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null);
          emit({ type: 'error', message: body?.message || `The assistant could not be reached (${response.status}).` });
          return;
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let boundary: number;
          while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
            const event = parseTurnEvent(block);
            if (event) emit(event);
          }
        }
      })()
        .then(() => this.zone.run(() => subscriber.complete()))
        .catch(error => {
          if (abort.signal.aborted) return;
          this.zone.run(() => {
            subscriber.next({ type: 'error', message: 'The connection to the assistant was lost.' });
            subscriber.complete();
          });
          console.error('Assistant stream failed', error);
        });

      return () => abort.abort();
    });
  }

  suggest(context: string, type: string, cursorPosition?: number): Observable<{ suggestion?: string }> {
    return this.http.post<{ suggestion?: string }>('/api/ai/suggest', {
      context,
      type,
      cursorPosition
    });
  }

  editDocument(spaceId: string, path: string, instruction: string): Observable<AiEditResult> {
    return this.http.post<AiEditResult>(`/api/spaces/${spaceId}/documents/ai-edit`, {
      path,
      instruction
    });
  }

  generate(prompt: string, documentContext?: string): Observable<{ content?: string }> {
    return this.http.post<{ content?: string }>('/api/ai/generate', {
      prompt,
      documentContext
    });
  }
}

/** One `event:` / `data:` block of the stream; comments (keep-alives) yield nothing. */
export function parseTurnEvent(block: string): TurnEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (!data.length) return null;
  const payload = JSON.parse(data.join('\n'));
  switch (name) {
    case 'conversation': return { type: 'conversation', conversation: payload };
    case 'status': return { type: 'status', label: payload.label };
    case 'tool': return { type: 'tool', toolCall: payload };
    case 'delta': return { type: 'delta', text: payload.text };
    case 'reset': return { type: 'reset' };
    case 'done': return { type: 'done', message: payload };
    case 'error': return { type: 'error', message: payload.message };
    default: return null;
  }
}
