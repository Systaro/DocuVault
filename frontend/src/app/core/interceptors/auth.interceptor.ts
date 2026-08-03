import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NativeTokenStore } from '../auth/native-token.store';
import { PlatformService } from '../platform/platform.service';
import { BackendHealthService } from '../services/backend-health.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const platform = inject(PlatformService);
  const tokenStore = inject(NativeTokenStore);
  const health = inject(BackendHealthService);

  if (platform.isNative()) {
    let url = req.url;
    if (url.startsWith('/api/') && environment.apiUrl) {
      url = environment.apiUrl + url;
    }

    const token = tokenStore.get();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    req = req.clone({
      url,
      setHeaders: headers
    });
  } else {
    req = req.clone({ withCredentials: true });
  }

  // Only backend traffic says anything about backend health. Requests for bundled
  // assets are answered by the frontend's own nginx and would otherwise clear the
  // maintenance banner while the backend is actually down.
  const touchesBackend = req.url.includes('/api/');

  return next(req).pipe(
    tap(event => {
      // Any genuine response means the backend answered, so it is reachable.
      if (touchesBackend && event instanceof HttpResponse) {
        health.reportReachable();
      }
    }),
    catchError((error: HttpErrorResponse) => {
      if (touchesBackend) {
        // status 0 = no response (host/network down); 502/503/504 = nginx-proxy
        // could not reach the backend container. Treat both as "server is down".
        if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) {
          health.reportUnreachable();
        } else {
          // A real HTTP error still proves the backend is up.
          health.reportReachable();
        }
      }

      if (req.url.includes('/auth/')) {
        return throwError(() => error);
      }

      if (error.status === 401) {
        authService.logout();
        return throwError(() => error);
      }

      if (error.status === 403 && !authService.isAuthenticated()) {
        authService.logout();
        return throwError(() => error);
      }

      return throwError(() => error);
    })
  );
};
