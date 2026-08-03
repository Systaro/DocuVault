import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of, map, from, switchMap } from 'rxjs';
import { PlatformService } from '../platform/platform.service';
import { NativeTokenStore } from './native-token.store';
import { TeamBadge } from '../api/teams.service';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  enabled?: boolean;
  impersonating?: boolean;
  originalAdminName?: string;
  /** Only sent where team context matters (admin listings, /users/me). */
  teams?: TeamBadge[];
  /** Newest release whose notes this user acknowledged; absent = never shown. */
  changelogSeenVersion?: string | null;
}

export interface AuthResponse {
  user?: User;
  error?: string;
  impersonating?: boolean;
  originalAdminName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly USER_KEY = 'docuvault_user';

  private platform = inject(PlatformService);
  private tokenStore = inject(NativeTokenStore);

  private userSignal = signal<User | null>(this.getStoredUser());

  user = this.userSignal.asReadonly();
  isAuthenticated = computed(() => !!this.userSignal());
  isAdmin = computed(() => {
    const user = this.userSignal();
    return user?.role === 'SUPER_ADMIN' || user?.role === 'ORG_ADMIN';
  });
  isImpersonating = computed(() => !!this.userSignal()?.impersonating);

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  login(credentials: LoginRequest): Observable<AuthResponse> {
    if (this.platform.isNative()) {
      return this.nativeLogin(credentials);
    }
    return this.http.post<AuthResponse>('/api/auth/login', credentials, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(error => of({ error: error.error?.error || 'Login failed' }))
    );
  }

  private nativeLogin(credentials: LoginRequest): Observable<AuthResponse> {
    return from(this.platform.deviceLabel()).pipe(
      switchMap(deviceName =>
        this.http.post<{ user?: User; token?: string; error?: string }>(
          '/api/auth/native-login',
          { ...credentials, deviceName }
        )
      ),
      switchMap(response => {
        if (response.error || !response.token || !response.user) {
          return of({ error: response.error || 'Login failed' } as AuthResponse);
        }
        return from(this.tokenStore.set(response.token)).pipe(
          map(() => {
            this.handleAuthResponse({ user: response.user });
            return { user: response.user } as AuthResponse;
          })
        );
      }),
      catchError(error => of({ error: error.error?.error || 'Login failed' } as AuthResponse))
    );
  }

  register(data: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/register', data, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(error => of({ error: error.error?.error || 'Registration failed' }))
    );
  }

  getSetupStatus(): Observable<{ needsSetup: boolean }> {
    return this.http.get<{ needsSetup: boolean }>('/api/auth/setup-status').pipe(
      catchError(() => of({ needsSetup: false }))
    );
  }

  setupAdmin(data: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/setup-admin', data, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(error => of({ error: error.error?.error || 'Setup failed' }))
    );
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/auth/forgot-password', { email }).pipe(
      catchError(error => of({ message: error.error?.error || 'Something went wrong. Please try again.' }))
    );
  }

  resetPassword(token: string, password: string): Observable<{ message?: string; error?: string }> {
    return this.http.post<{ message?: string; error?: string }>('/api/auth/reset-password', { token, password }).pipe(
      // The backend reports failures two ways: the controller returns
      // { error } for token problems, while bean-validation failures come
      // back from the global handler as { message, errors }. Surface
      // whichever is present instead of collapsing them all to a generic
      // "Something went wrong".
      catchError(error => of({
        error: error.error?.error
          || (Array.isArray(error.error?.errors) && error.error.errors.length
            ? error.error.errors.join(', ')
            : null)
          || error.error?.message
          || 'Something went wrong. Please try again.'
      }))
    );
  }

  logout(): void {
    if (this.platform.isNative()) {
      this.tokenStore.clear();
    } else {
      this.http.post('/api/auth/logout', {}, { withCredentials: true }).subscribe({
        complete: () => {},
        error: () => {}
      });
    }
    localStorage.removeItem(this.USER_KEY);
    this.userSignal.set(null);
    this.router.navigate(['/login']);
  }

  /**
   * Check if the user is authenticated by calling /auth/me.
   * Used by auth guard since we can't read httpOnly cookies.
   */
  checkAuth(): Observable<boolean> {
    return this.http.get<AuthResponse>('/api/auth/me', { withCredentials: true }).pipe(
      map(response => {
        if (response.user) {
          this.handleAuthResponse(response);
          return true;
        }
        return false;
      }),
      catchError(() => {
        localStorage.removeItem(this.USER_KEY);
        this.userSignal.set(null);
        return of(false);
      })
    );
  }

  stopImpersonation(): void {
    this.http.post<User>('/api/users/stop-impersonation', {}, { withCredentials: true }).subscribe({
      next: () => {
        this.checkAuth().subscribe(() => {
          this.router.navigate(['/admin']);
        });
      }
    });
  }

  /**
   * Merges server-side user state into the cached session, so a change made
   * through a dedicated endpoint does not need a full re-login to take effect.
   */
  patchUser(patch: Partial<User>): void {
    const current = this.userSignal();
    if (!current) return;
    const merged = { ...current, ...patch };
    localStorage.setItem(this.USER_KEY, JSON.stringify(merged));
    this.userSignal.set(merged);
  }

  private handleAuthResponse(response: AuthResponse): void {
    if (response.user) {
      const user: User = {
        ...response.user,
        impersonating: response.impersonating ?? undefined,
        originalAdminName: response.originalAdminName ?? undefined
      };
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
      this.userSignal.set(user);
    }
  }

  private getStoredUser(): User | null {
    const userJson = localStorage.getItem(this.USER_KEY);
    if (userJson) {
      try {
        return JSON.parse(userJson);
      } catch {
        return null;
      }
    }
    return null;
  }
}
