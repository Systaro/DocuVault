import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="register-container">
      <!-- Left Brand Panel -->
      <div class="register-left">
        <div class="register-brand">
          <img src="assets/logo.png" alt="DocuVault" class="register-brand-logo" />
          <p>Join your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <!-- Right Form Panel -->
      <div class="register-right">
        <div class="register-form">
          <h2>Create account</h2>
          <p class="subtitle">Get started with your free account</p>

          @if (error()) {
            <div class="error-message">
              <span translate="no" class="material-icons">error_outline</span>
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="register()">
            <div class="form-group">
              <label class="form-label">Full name</label>
              <div class="input-icon">
                <span translate="no" class="material-icons">person</span>
                <input
                  type="text"
                  [(ngModel)]="name"
                  name="name"
                  class="input"
                  placeholder="Enter your name"
                  autocomplete="name"
                  enterkeyhint="next"
                  required
                />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Email address</label>
              <div class="input-icon">
                <span translate="no" class="material-icons">mail</span>
                <input
                  type="email"
                  [(ngModel)]="email"
                  name="email"
                  class="input"
                  placeholder="Enter your email"
                  autocomplete="email"
                  inputmode="email"
                  enterkeyhint="next"
                  required
                />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <div class="input-icon">
                <span translate="no" class="material-icons">lock</span>
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="password"
                  name="password"
                  class="input"
                  placeholder="At least 8 characters"
                  autocomplete="new-password"
                  enterkeyhint="next"
                  required
                  minlength="8"
                />
                <span translate="no" class="material-icons toggle-password" (click)="showPassword.set(!showPassword())">
                  {{ showPassword() ? 'visibility_off' : 'visibility' }}
                </span>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Confirm password</label>
              <div class="input-icon">
                <span translate="no" class="material-icons">lock</span>
                <input
                  [type]="showPassword() ? 'text' : 'password'"
                  [(ngModel)]="confirmPassword"
                  name="confirmPassword"
                  class="input"
                  placeholder="Repeat your password"
                  autocomplete="new-password"
                  enterkeyhint="go"
                  required
                />
                <span translate="no" class="material-icons toggle-password" (click)="showPassword.set(!showPassword())">
                  {{ showPassword() ? 'visibility_off' : 'visibility' }}
                </span>
              </div>
            </div>

            <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Create Account">
              @if (loading()) {
                <span translate="no" class="material-icons animate-spin">sync</span>
                Creating account...
              } @else {
                <span translate="no" class="material-icons">person_add</span>
                Create Account
              }
            </button>
          </form>

          <p class="signin-link">
            Already have an account? <a routerLink="/login" class="link">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .register-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .register-left {
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

    .register-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .register-brand-logo {
      max-width: 200px;
      height: auto;
      margin-bottom: 24px;
    }

    .register-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .register-right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 64px;
      background: var(--surface);
      overflow-y: auto;
    }

    .register-form {
      width: 100%;
      max-width: 380px;
    }

    .register-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .register-form .subtitle {
      color: var(--text-muted);
      margin-bottom: 32px;
    }

    .form-group {
      margin-bottom: 20px;
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
      margin-top: 8px;
    }

    .signin-link {
      text-align: center;
      margin-top: 32px;
      font-size: 13px;
      color: var(--text-muted);
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
      .register-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .register-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .register-brand-logo {
        max-width: 120px;
        margin-bottom: 0;
      }

      .register-brand p {
        display: none;
      }

      .register-right {
        padding: 24px 24px 32px;
      }

      .register-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .register-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .signin-link {
        margin-top: 20px;
      }
    }
  `]
})
export class RegisterComponent {
  name = '';
  email = '';
  password = '';
  confirmPassword = '';
  showPassword = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  register(): void {
    if (!this.name || !this.email || !this.password) return;

    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }

    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.authService.register({
      name: this.name,
      email: this.email,
      password: this.password
    }).subscribe({
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
}
