import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/** What the consent page shows for a validated authorization request. */
export interface OAuthConsent {
  nonce: string;
  clientName: string;
  /** Origin the browser is sent back to after the decision, e.g. http://localhost:63034 */
  redirectTarget: string;
  scope: string;
  userName: string;
  userEmail: string;
}

/** Exactly one of the two is set: either show the consent, or leave right away. */
export interface OAuthAuthorizeResponse {
  redirectUrl?: string;
  consent?: OAuthConsent;
}

/**
 * The OAuth authorization endpoint behind the MCP consent page. The machine
 * endpoints (register, token) are never called from the app.
 */
@Injectable({ providedIn: 'root' })
export class OAuthService {
  private http = inject(HttpClient);

  /** Validates the request the MCP client opened the browser with; parks it in the session. */
  describeAuthorization(query: Record<string, string>): Observable<OAuthAuthorizeResponse> {
    return this.http.get<OAuthAuthorizeResponse>('/api/oauth/authorize', {
      params: new HttpParams({ fromObject: query }),
      withCredentials: true
    });
  }

  decide(nonce: string, decision: 'approve' | 'deny'): Observable<OAuthAuthorizeResponse> {
    return this.http.post<OAuthAuthorizeResponse>('/api/oauth/authorize', { nonce, decision }, { withCredentials: true });
  }
}
