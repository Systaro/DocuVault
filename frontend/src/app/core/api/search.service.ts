import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/** What a hit is, which decides both its icon and where clicking it goes. */
export type SearchResultKind = 'DOCUMENT' | 'SPACE' | 'GROUP';

export interface SearchResult {
  kind: SearchResultKind;
  /** Empty for SPACE and GROUP hits — those are opened by spaceFullPath. */
  documentPath: string;
  documentTitle: string;
  spaceId: string;
  /** For a container hit this is its parent group, not the container itself. */
  spaceName: string;
  spaceFullPath: string;
  snippet: string | null;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class SearchService {
  constructor(private http: HttpClient) {}

  search(query: string, limit = 20): Observable<SearchResult[]> {
    const params = new HttpParams().set('q', query).set('limit', limit.toString());
    return this.http.get<SearchResult[]>('/api/search', { params });
  }
}
