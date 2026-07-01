import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="forgot-container">
      <div class="forgot-left">
        <div class="forgot-brand">
          <img src="assets/logo.png" alt="DocuVault" class="forgot-brand-logo" />
          <p>Your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <div class="forgot-right">
        <div class="forgot-form">
          @if (submitted()) {
            <div class="success-state">
              <span class="material-icons success-icon">mark_email_read</span>
              <h2>Check Your Email</h2>
              <p>If an account with that email exists, we've sent a password reset link. Please check your inbox.</p>
              <a routerLink="/login" class="btn btn-primary btn-full">
                <span class="material-icons">arrow_back</span>
                Back to Sign In
              </a>
            </div>
          } @else {
            <h2>Forgot Password</h2>
            <p class="subtitle">Enter your email and we'll send you a reset link</p>

            @if (error()) {
              <div class="error-message">
                <span class="material-icons">error_outline</span>
                {{ error() }}
              </div>
            }

            <form (ngSubmit)="submit()">
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
                    autocomplete="email"
                    inputmode="email"
                    enterkeyhint="go"
                    required
                  />
                </div>
              </div>

              <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Send Reset Link">
                @if (loading()) {
                  <span class="material-icons animate-spin">sync</span>
                  Sending...
                } @else {
                  <span class="material-icons">send</span>
                  Send Reset Link
                }
              </button>
            </form>

            <p class="login-link">
              Remember your password? <a routerLink="/login" class="link">Sign in</a>
            </p>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .forgot-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .forgot-left {
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

    .forgot-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .forgot-brand-logo {
      display: inline-block;
      max-width: 200px;
      height: auto;
      margin-bottom: 24px;
    }

    .forgot-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .forgot-right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 64px;
      background: var(--surface);
    }

    .forgot-form {
      width: 100%;
      max-width: 380px;
    }

    .forgot-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .forgot-form .subtitle {
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

    .btn-full {
      width: 100%;
    }

    .login-link {
      text-align: center;
      margin-top: 32px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .success-state {
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

    .animate-spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @media (max-width: 768px) {
      .forgot-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .forgot-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .forgot-brand-logo {
        max-width: 120px;
        margin-bottom: 0;
      }

      .forgot-brand p {
        display: none;
      }

      .forgot-right {
        padding: 24px 24px 32px;
      }

      .forgot-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .forgot-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .login-link {
        margin-top: 20px;
      }
    }
  `]
})
export class ForgotPasswordComponent {
  email = '';
  loading = signal(false);
  error = signal<string | null>(null);
  submitted = signal(false);

  constructor(private authService: AuthService) {}

  submit(): void {
    if (!this.email) return;

    this.loading.set(true);
    this.error.set(null);

    this.authService.forgotPassword(this.email).subscribe({
      next: () => {
        this.loading.set(false);
        this.submitted.set(true);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('Something went wrong. Please try again.');
      }
    });
  }
}
