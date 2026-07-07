import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type NoteStatus = 'UNSORTED' | 'FILED' | 'DISMISSED';
export type RuleType = 'CATEGORY' | 'PATTERN';
export type RuleAction = 'APPEND_TO_DOCUMENT' | 'CREATE_DOCUMENT';

export interface InboxNote {
  id: string;
  spaceId: string;
  authorId: string;
  authorName: string;
  content: string;
  status: NoteStatus;
  aiSuggestion: string | null; // JSON string
  filedToDocumentPath: string | null;
  filedByName: string | null;
  autoFiled: boolean;
  appliedRuleId: string | null;
  createdAt: string;
  filedAt: string | null;
}

export interface AiSuggestion {
  action: 'APPEND_TO_DOCUMENT' | 'CREATE_DOCUMENT';
  documentPath?: string;
  newDocumentPath?: string;
  newDocumentTitle?: string;
  groupPath?: string;
  confidence: number;
  explanation: string;
  mergedContent: string;
  originalContent: string;
  error?: string;
}

export interface RoutingRule {
  id: string;
  spaceId: string;
  type: RuleType;
  condition: string;
  actionType: RuleAction;
  targetDocumentPath: string | null;
  targetGroupPath: string | null;
  autoFile: boolean;
  description: string | null;
  createdAt: string;
}

export interface CreateNoteRequest {
  content: string;
}

export interface SpaceUnsortedCount {
  spaceId: string;
  spaceFullPath: string;
  count: number;
}

export interface FileNoteRequest {
  documentPath: string;
  mergedContent: string;
  createNew?: boolean;
  newTitle?: string;
  saveAsRule?: boolean;
  ruleCondition?: string;
}

export interface CreateRuleRequest {
  type: RuleType;
  condition: string;
  actionType: RuleAction;
  targetDocumentPath?: string;
  targetGroupPath?: string;
  autoFile: boolean;
  description?: string;
}

export interface UpdateRuleRequest {
  condition?: string;
  actionType?: RuleAction;
  targetDocumentPath?: string;
  targetGroupPath?: string;
  autoFile?: boolean;
  description?: string;
}

@Injectable({ providedIn: 'root' })
export class InboxService {
  constructor(private http: HttpClient) {}

  getNotes(spaceId: string, status: NoteStatus = 'UNSORTED'): Observable<InboxNote[]> {
    const params = new HttpParams().set('status', status);
    return this.http.get<InboxNote[]>(`/api/spaces/${spaceId}/inbox/notes`, { params });
  }

  getNote(spaceId: string, noteId: string): Observable<InboxNote> {
    return this.http.get<InboxNote>(`/api/spaces/${spaceId}/inbox/notes/${noteId}`);
  }

  getUnsortedCount(spaceId: string): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`/api/spaces/${spaceId}/inbox/count`);
  }

  createNote(spaceId: string, content: string): Observable<InboxNote> {
    return this.http.post<InboxNote>(`/api/spaces/${spaceId}/inbox/notes`, { content } as CreateNoteRequest);
  }

  generateSuggestion(spaceId: string, noteId: string, hint?: string): Observable<InboxNote> {
    return this.http.post<InboxNote>(
      `/api/spaces/${spaceId}/inbox/notes/${noteId}/suggest`,
      { hint: hint?.trim() || null }
    );
  }

  /** Unsorted note counts for all spaces the user can access (dashboard badges). */
  getUnsortedCounts(): Observable<SpaceUnsortedCount[]> {
    return this.http.get<SpaceUnsortedCount[]>('/api/inbox/unsorted-counts');
  }

  fileNote(spaceId: string, noteId: string, request: FileNoteRequest): Observable<InboxNote> {
    return this.http.post<InboxNote>(`/api/spaces/${spaceId}/inbox/notes/${noteId}/file`, request);
  }

  dismissNote(spaceId: string, noteId: string): Observable<InboxNote> {
    return this.http.post<InboxNote>(`/api/spaces/${spaceId}/inbox/notes/${noteId}/dismiss`, {});
  }

  getRules(spaceId: string): Observable<RoutingRule[]> {
    return this.http.get<RoutingRule[]>(`/api/spaces/${spaceId}/inbox/rules`);
  }

  createRule(spaceId: string, request: CreateRuleRequest): Observable<RoutingRule> {
    return this.http.post<RoutingRule>(`/api/spaces/${spaceId}/inbox/rules`, request);
  }

  updateRule(spaceId: string, ruleId: string, request: UpdateRuleRequest): Observable<RoutingRule> {
    return this.http.put<RoutingRule>(`/api/spaces/${spaceId}/inbox/rules/${ruleId}`, request);
  }

  deleteRule(spaceId: string, ruleId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/inbox/rules/${ruleId}`);
  }

  parseSuggestion(note: InboxNote): AiSuggestion | null {
    if (!note.aiSuggestion) return null;
    try {
      return JSON.parse(note.aiSuggestion) as AiSuggestion;
    } catch {
      return null;
    }
  }
}
