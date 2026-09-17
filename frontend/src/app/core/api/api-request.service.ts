import { Injectable, inject } from '@angular/core';
import { NativeTokenStore } from '../auth/native-token.store';
import { PlatformService } from '../platform/platform.service';
import { environment } from '../../../environments/environment';

/**
 * How a request reaches the backend: the web app sends its session cookie to
 * the same origin, the native app a bearer token to the configured API host.
 * The HTTP interceptor applies this to HttpClient calls; streams that need
 * fetch() use it directly.
 */
@Injectable({ providedIn: 'root' })
export class ApiRequestService {
  private platform = inject(PlatformService);
  private tokenStore = inject(NativeTokenStore);

  isNative(): boolean {
    return this.platform.isNative();
  }

  url(url: string): string {
    return this.isNative() && url.startsWith('/api/') && environment.apiUrl ? environment.apiUrl + url : url;
  }

  authHeaders(): Record<string, string> {
    const token = this.isNative() ? this.tokenStore.get() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  fetchInit(init: RequestInit): RequestInit {
    return {
      ...init,
      credentials: this.isNative() ? 'omit' : 'include',
      headers: { ...(init.headers as Record<string, string> | undefined), ...this.authHeaders() }
    };
  }
}
