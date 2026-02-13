import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface SearchResult {
  documentPath: string;
  documentTitle: string;
  spaceId: string;
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
