import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, filter, map, of } from 'rxjs';
import { EventStreamService, ServerEvent, StreamRejectedError } from './event-stream.service';

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
  private eventStream = inject(EventStreamService);

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
   * Sends a message and streams the answer. Unsubscribing stops reading; the
   * server still finishes and stores the answer.
   */
  sendTurn(request: TurnRequest): Observable<TurnEvent> {
    return this.eventStream.post('/api/ai/conversations/turns', request).pipe(
      map(toTurnEvent),
      filter((event): event is TurnEvent => event !== null),
      catchError(error => {
        if (error instanceof StreamRejectedError) {
          return of<TurnEvent>({
            type: 'error',
            message: error.body?.message || `The assistant could not be reached (${error.status}).`
          });
        }
        console.error('Assistant stream failed', error);
        return of<TurnEvent>({ type: 'error', message: 'The connection to the assistant was lost.' });
      })
    );
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

/** One event of the answer stream as the assistant view uses it; unknown names yield nothing. */
function toTurnEvent({ name, data: payload }: ServerEvent): TurnEvent | null {
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
