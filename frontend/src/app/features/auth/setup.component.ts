import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { BrandingService } from '../../core/branding/branding.service';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, BrandLogoComponent],
  template: `
    <div class="setup-container">
      <!-- Left Brand Panel -->
      <div class="setup-left">
        <div class="setup-brand">
          <app-brand-logo [onDark]="true" class="setup-brand-logo" />
          <p>Welcome — let's get your {{ branding.appName() }} instance set up. Create the first administrator account to continue.</p>
        </div>
      </div>

      <!-- Right Form Panel -->
      <div class="setup-right">
        <div class="setup-form">
          <h2>First-time setup</h2>
          <p class="subtitle">Create the administrator account for this instance</p>

          @if (error()) {
            <div class="error-message">
              <span translate="no" class="material-icons">error_outline</span>
              {{ error() }}
            </div>
          }

          <form (ngSubmit)="setup()">
            <div class="form-group">
              <label class="form-label">Your name</label>
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
                  placeholder="admin@example.com"
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

            <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Create administrator account">
              @if (loading()) {
                <span translate="no" class="material-icons animate-spin">sync</span>
                Creating administrator…
              } @else {
                <span translate="no" class="material-icons">admin_panel_settings</span>
                Create administrator
              }
            </button>
          </form>

          <p class="setup-note">
            This is a one-time step. Once the administrator is created, additional users
            are invited from the admin panel.
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .setup-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .setup-left {
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

    .setup-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .setup-brand-logo {
      --brand-logo-max-height: 64px;
      --brand-logo-max-width: 260px;
      --brand-text-size: 32px;
      margin-bottom: 24px;
    }

    .setup-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 320px;
      line-height: 1.6;
    }

    .setup-right {
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

    .setup-form {
      width: 100%;
      max-width: 380px;
    }

    .setup-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .setup-form .subtitle {
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

    .setup-note {
      text-align: center;
      margin-top: 32px;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
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
      .setup-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .setup-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .setup-brand-logo {
        --brand-mark-width: 120px;
        --brand-logo-max-height: 40px;
        --brand-text-size: 22px;
        margin-bottom: 0;
      }

      .setup-brand p {
        display: none;
      }

      .setup-right {
        padding: 24px 24px 32px;
      }

      .setup-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .setup-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }

      .setup-note {
        margin-top: 20px;
      }
    }
  `]
})
export class SetupComponent implements OnInit {
  protected branding = inject(BrandingService);
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

  ngOnInit(): void {
    // If setup is already complete, do not show the wizard.
    this.authService.getSetupStatus().subscribe(status => {
      if (!status.needsSetup) {
        this.router.navigate(['/login']);
      }
    });
  }

  setup(): void {
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

    this.authService.setupAdmin({
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
