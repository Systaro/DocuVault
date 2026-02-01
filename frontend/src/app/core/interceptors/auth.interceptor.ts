import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Ensure cookies are sent with every request
  req = req.clone({ withCredentials: true });

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
