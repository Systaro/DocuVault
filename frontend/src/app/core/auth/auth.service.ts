import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of, map } from 'rxjs';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface AuthResponse {
  user?: User;
  error?: string;
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

  private userSignal = signal<User | null>(this.getStoredUser());

  user = this.userSignal.asReadonly();
  isAuthenticated = computed(() => !!this.userSignal());
  isAdmin = computed(() => {
    const user = this.userSignal();
    return user?.role === 'SUPER_ADMIN' || user?.role === 'ORG_ADMIN';
  });

  constructor(
    private http: HttpClient,
    private router: Router
  ) {}

  login(credentials: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/login', credentials, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(error => of({ error: error.error?.error || 'Login failed' }))
    );
  }

  register(data: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/register', data, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(error => of({ error: error.error?.error || 'Registration failed' }))
    );
  }

  logout(): void {
    this.http.post('/api/auth/logout', {}, { withCredentials: true }).subscribe({
      complete: () => {},
      error: () => {}
    });
    localStorage.removeItem(this.USER_KEY);
    this.userSignal.set(null);
    this.router.navigate(['/login']);
  }

  refreshToken(): Observable<AuthResponse> {
    return this.http.post<AuthResponse>('/api/auth/refresh', {}, { withCredentials: true }).pipe(
      tap(response => this.handleAuthResponse(response)),
      catchError(() => {
        this.logout();
        return of({ error: 'Token refresh failed' });
      })
    );
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
      catchError(() => of(false))
    );
  }

  private handleAuthResponse(response: AuthResponse): void {
    if (response.user) {
      localStorage.setItem(this.USER_KEY, JSON.stringify(response.user));
      this.userSignal.set(response.user);
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
