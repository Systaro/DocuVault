import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="reset-container">
      <div class="reset-left">
        <div class="reset-brand">
          <img src="assets/logo.png" alt="DocuVault" class="reset-brand-logo" />
          <p>Your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <div class="reset-right">
        <div class="reset-form">
          @if (invalidToken()) {
            <div class="error-state">
              <span class="material-icons error-icon">link_off</span>
              <h2>Invalid Reset Link</h2>
              <p>This password reset link is invalid or has expired.</p>
              <a routerLink="/forgot-password" class="btn btn-primary btn-full">
                <span class="material-icons">refresh</span>
                Request New Link
              </a>
            </div>
          } @else if (success()) {
            <div class="success-state">
              <span class="material-icons success-icon">check_circle</span>
              <h2>Password Reset</h2>
              <p>Your password has been updated successfully. You can now sign in.</p>
              <a routerLink="/login" class="btn btn-primary btn-full">
                <span class="material-icons">login</span>
                Sign In
              </a>
            </div>
          } @else {
            <h2>Set New Password</h2>
            <p class="subtitle">Choose a strong password for your account</p>

            @if (error()) {
              <div class="error-message">
                <span class="material-icons">error_outline</span>
                {{ error() }}
              </div>
            }

            <form (ngSubmit)="submit()">
              <div class="form-group">
                <label class="form-label">New password</label>
                <div class="input-icon">
                  <span class="material-icons">lock</span>
                  <input
                    [type]="showPassword() ? 'text' : 'password'"
                    [(ngModel)]="password"
                    name="password"
                    class="input"
                    placeholder="Enter new password"
                    autocomplete="new-password"
                    enterkeyhint="next"
                    required
                  />
                  <span class="material-icons toggle-password" (click)="showPassword.set(!showPassword())">
                    {{ showPassword() ? 'visibility_off' : 'visibility' }}
                  </span>
                </div>
                <p class="hint">Min 8 characters with uppercase, lowercase, number, and special character</p>
              </div>

              <div class="form-group">
                <label class="form-label">Confirm password</label>
                <div class="input-icon">
                  <span class="material-icons">lock</span>
                  <input
                    [type]="showPassword() ? 'text' : 'password'"
                    [(ngModel)]="confirmPassword"
                    name="confirmPassword"
                    class="input"
                    placeholder="Confirm new password"
                    autocomplete="new-password"
                    enterkeyhint="go"
                    required
                  />
                </div>
              </div>

              <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Reset Password">
                @if (loading()) {
                  <span class="material-icons animate-spin">sync</span>
                  Resetting...
                } @else {
                  <span class="material-icons">lock_reset</span>
                  Reset Password
                }
              </button>
            </form>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .reset-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .reset-left {
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

    .reset-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .reset-brand-logo {
      display: inline-block;
      max-width: 200px;
      height: auto;
      margin-bottom: 24px;
      filter: brightness(0) invert(1);
    }

    .reset-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .reset-right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 64px;
      background: var(--surface);
    }

    .reset-form {
      width: 100%;
      max-width: 380px;
    }

    .reset-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .reset-form .subtitle {
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

    .hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 6px;
    }

    .btn-full {
      width: 100%;
    }

    .error-state, .success-state {
      text-align: center;

      h2 {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 8px;
      }

      p {
        color: var(--text-muted);
        margin-bottom: 32px;
        line-height: 1.6;
      }
    }

    .error-icon {
      font-size: 56px;
      color: var(--error);
      margin-bottom: 16px;
    }

    .success-icon {
      font-size: 56px;
      color: #4caf50;
      margin-bottom: 16px;
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

    .toggle-password {
      position: absolute;
      right: 12px;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 20px;
      user-select: none;

      &:hover {
        color: var(--text-secondary);
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
      .reset-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .reset-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .reset-brand-logo {
        max-width: 120px;
        margin-bottom: 0;
      }

      .reset-brand p {
        display: none;
      }

      .reset-right {
        padding: 24px 24px 32px;
      }

      .reset-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .reset-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }
    }
  `]
})
export class ResetPasswordComponent implements OnInit {
  token = '';
  password = '';
  confirmPassword = '';
  showPassword = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  invalidToken = signal(false);
  success = signal(false);

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.invalidToken.set(true);
    }
  }

  submit(): void {
    if (!this.password || !this.confirmPassword) return;

    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match.');
      return;
    }

    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.authService.resetPassword(this.token, this.password).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.error) {
          if (response.error.includes('expired') || response.error.includes('Invalid') || response.error.includes('already been used')) {
            this.invalidToken.set(true);
          } else {
            this.error.set(response.error);
          }
        } else {
          this.success.set(true);
        }
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Something went wrong. Please try again.');
      }
    });
  }
}
