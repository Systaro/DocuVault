import { Component, OnInit, signal, isDevMode } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="login-container">
      <!-- Left Brand Panel -->
      <div class="login-left">
        <div class="login-brand">
          <img src="assets/logo.png" alt="DocuVault" class="login-brand-logo" />
          <p>Your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <!-- Right Form Panel -->
      <div class="login-right">
        <div class="login-form">
          <h2>Welcome back</h2>
          <p class="subtitle">Sign in to your account to continue</p>

          @if (error()) {
            <div class="error-message">
              <span class="material-icons">error_outline</span>
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="login()">
            <div class="form-group">
              <label class="form-label">Email address</label>
              <div class="input-icon">
                <span class="material-icons">mail</span>
                <input
                  type="email"
                  [(ngModel)]="email"
                  name="email"
                  class="input"
                  placeholder="Enter your email"
                  autocomplete="username"
                  inputmode="email"
                  enterkeyhint="next"
                  required
                />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <div class="input-icon">
                <span class="material-icons">lock</span>
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="password"
                  name="password"
                  class="input"
                  placeholder="Enter your password"
                  autocomplete="current-password"
                  enterkeyhint="go"
                  required
                />
                <span class="material-icons toggle-password" (click)="showPassword.set(!showPassword())">
                  {{ showPassword() ? 'visibility_off' : 'visibility' }}
                </span>
              </div>
            </div>

            <div class="form-row">
              <label class="checkbox-label">
                <input type="checkbox" [(ngModel)]="rememberMe" name="rememberMe" />
                Remember me
              </label>
              <a routerLink="/forgot-password" class="link">Forgot password?</a>
            </div>

            <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Sign In">
              @if (loading()) {
                <span class="material-icons animate-spin">sync</span>
                Signing in...
              } @else {
                <span class="material-icons">login</span>
                Sign In
              }
            </button>
          </form>

          <p class="signup-link">
            Don't have an account? <a routerLink="/register" class="link">Sign up</a>
          </p>

          @if (isDevMode) {
            <div class="dev-login">
              <div class="divider">Development</div>
              <button type="button" (click)="devLogin()" class="btn btn-dev">
                <span class="material-icons">bolt</span>
                Quick Admin Login
              </button>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .login-left {
      flex: 1;
      min-width: 0;
      background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 50%, var(--primary-light) 100%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 48px;
      position: relative;
      overflow: hidden;

      &::before {
        content: '';
        position: absolute;
        width: 400px;
        height: 400px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 50%;
        top: -100px;
        right: -100px;
      }

      &::after {
        content: '';
        position: absolute;
        width: 300px;
        height: 300px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 50%;
        bottom: -50px;
        left: -50px;
      }
    }

    .login-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .login-brand-logo {
      display: inline-block;
      max-width: 200px;
      height: auto;
      margin-bottom: 24px;
      filter: brightness(0) invert(1);
    }

    .login-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .login-right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 64px;
      background: var(--surface);
    }

    .login-form {
      width: 100%;
      max-width: 380px;
    }

    .login-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .login-form .subtitle {
      color: var(--text-muted);
      margin-bottom: 32px;
    }

    .form-group {
      margin-bottom: 24px;
    }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .form-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;

      input {
        width: 18px;
        height: 18px;
        accent-color: var(--primary);
      }
    }

    .btn-full {
      width: 100%;
    }

    .signup-link {
      text-align: center;
      margin-top: 32px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .dev-login {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px dashed var(--border);
    }

    .divider {
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--warning);
      margin-bottom: 16px;
    }

    .btn-dev {
      width: 100%;
      background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: var(--radius-md);
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(255, 152, 0, 0.4);
      }

      .material-icons {
        font-size: 20px;
      }
    }

    .error-message {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(244, 67, 54, 0.1);
      border: 1px solid rgba(244, 67, 54, 0.2);
      border-radius: var(--radius-md);
      color: var(--error);
      font-size: 13px;
      margin-bottom: 24px;

      .material-icons {
        font-size: 20px;
      }
    }

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .login-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .login-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .login-brand-logo {
        max-width: 120px;
        margin-bottom: 0;
      }

      .login-brand p {
        display: none;
      }

      .login-right {
        padding: 24px 24px 32px;
      }

      .login-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .login-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .signup-link {
        margin-top: 20px;
      }
    }
  `]
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  rememberMe = false;
  showPassword = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  isDevMode = isDevMode();

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Redirect to dashboard if already logged in
    if (this.authService.isAuthenticated()) {
      this.router.navigate(['/dashboard']);
    }
  }

  login(): void {
    if (!this.email || !this.password) return;

    this.loading.set(true);
    this.error.set(null);

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.error) {
          this.error.set(response.error);
        } else {
          this.router.navigate(['/dashboard']);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('An error occurred. Please try again.');
      }
    });
  }

  devLogin(): void {
    this.email = 'admin@docuvault.local';
    this.password = 'password123';
    this.login();
  }
}
