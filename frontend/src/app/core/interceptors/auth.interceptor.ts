import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NativeTokenStore } from '../auth/native-token.store';
import { PlatformService } from '../platform/platform.service';
import { environment } from '../../../environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const platform = inject(PlatformService);
  const tokenStore = inject(NativeTokenStore);

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

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
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
