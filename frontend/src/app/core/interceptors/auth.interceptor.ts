import { HttpInterceptorFn, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, tap, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { ApiRequestService } from '../api/api-request.service';
import { BackendHealthService } from '../services/backend-health.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const apiRequest = inject(ApiRequestService);
  const health = inject(BackendHealthService);

  if (apiRequest.isNative()) {
    req = req.clone({
      url: apiRequest.url(req.url),
      setHeaders: apiRequest.authHeaders()
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
