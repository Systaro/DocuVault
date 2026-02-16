import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isActive: boolean;
}

export interface CreateTokenRequest {
  name: string;
  expiresInDays?: number;
}

export interface CreateTokenResponse {
  id?: string;
  name?: string;
  token?: string;
  prefix?: string;
  expiresAt?: string;
  createdAt?: string;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ApiTokensService {
  constructor(private http: HttpClient) {}

  listTokens(): Observable<ApiToken[]> {
    return this.http.get<ApiToken[]>('/api/tokens');
  }

  createToken(request: CreateTokenRequest): Observable<CreateTokenResponse> {
    return this.http.post<CreateTokenResponse>('/api/tokens', request);
  }

  revokeToken(id: string): Observable<void> {
    return this.http.delete<void>(`/api/tokens/${id}`);
  }
}
