import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SearchResult {
  documentId: string;
  documentPath: string;
  documentTitle?: string;
  chunkIndex: number;
  content: string;
}

export interface ChatMessage {
  role: string;
  content: string;
  sources?: string[];
  timestamp: string;
}

export interface ChatHistory {
  id: string;
  spaceId?: string;
  spaceName?: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatResponse {
  chatHistoryId?: string;
  message: string;
  sources: string[];
}

export interface AiEditResult {
  path: string;
  content: string;
  previousContent: string;
}

@Injectable({ providedIn: 'root' })
export class AiService {
  constructor(private http: HttpClient) {}

  search(spaceId: string, query: string, limit?: number): Observable<SearchResult[]> {
    return this.http.post<SearchResult[]>('/api/ai/search', {
      spaceId,
      query,
      limit: limit ?? 5
    });
  }

  chat(spaceId: string, message: string, chatHistoryId?: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>('/api/ai/chat', {
      spaceId,
      message,
      chatHistoryId
    });
  }

  getChatHistory(spaceId?: string): Observable<ChatHistory[]> {
    const params = spaceId ? `?spaceId=${spaceId}` : '';
    return this.http.get<ChatHistory[]>(`/api/ai/chat/history${params}`);
  }

  getChatHistoryById(id: string): Observable<ChatHistory> {
    return this.http.get<ChatHistory>(`/api/ai/chat/history/${id}`);
  }

  deleteChatHistory(id: string): Observable<void> {
    return this.http.delete<void>(`/api/ai/chat/history/${id}`);
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
