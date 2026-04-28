import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { UsersService } from '../../core/api/users.service';

@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="invitation-container">
      <div class="invitation-left">
        <div class="invitation-brand">
          <img src="assets/logo.png" alt="DocuVault" class="invitation-brand-logo" />
          <p>Your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <div class="invitation-right">
        <div class="invitation-form">
          @if (invalidToken()) {
            <div class="error-state">
              <span class="material-icons error-icon">link_off</span>
              <h2>Invalid Invitation</h2>
              <p>This invitation link is invalid or has expired.</p>
              <a routerLink="/login" class="btn btn-primary btn-full">
                <span class="material-icons">login</span>
                Go to Login
              </a>
            </div>
          } @else if (success()) {
            <div class="success-state">
              <span class="material-icons success-icon">check_circle</span>
              <h2>Account Created</h2>
              <p>Your account has been set up. You can now sign in.</p>
              <a routerLink="/login" class="btn btn-primary btn-full">
                <span class="material-icons">login</span>
                Sign In
              </a>
            </div>
          } @else {
            <h2>Set Up Your Account</h2>
            <p class="subtitle">Complete your registration to get started</p>

            @if (error()) {
              <div class="error-message">
                <span class="material-icons">error_outline</span>
                <div class="error-text">
                  @for (line of errorLines(); track line) {
                    <span>{{ line }}</span>
                  }
                </div>
              </div>
            }

            <form (ngSubmit)="submit()">
              <div class="form-group">
                <label class="form-label">Full name</label>
                <div class="input-icon">
                  <span class="material-icons">person</span>
                  <input
                    type="text"
                    [(ngModel)]="name"
                    name="name"
                    class="input"
                    placeholder="Enter your full name"
                    autocomplete="name"
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
                    placeholder="Choose a password"
                    autocomplete="new-password"
                    enterkeyhint="next"
                    required
                    minlength="8"
                  />
                  <span class="material-icons toggle-password" (click)="showPassword.set(!showPassword())">
                    {{ showPassword() ? 'visibility_off' : 'visibility' }}
                  </span>
                </div>
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
                    placeholder="Confirm your password"
                    autocomplete="new-password"
                    enterkeyhint="go"
                    required
                  />
                </div>
              </div>

              <button type="submit" [disabled]="loading()" class="btn btn-primary btn-full" aria-label="Create Account">
                @if (loading()) {
                  <span class="material-icons animate-spin">sync</span>
                  Creating account...
                } @else {
                  <span class="material-icons">how_to_reg</span>
                  Create Account
                }
              </button>
            </form>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .invitation-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .invitation-left {
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

    .invitation-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .invitation-brand-logo {
      display: inline-block;
      max-width: 200px;
      height: auto;
      margin-bottom: 24px;
      filter: brightness(0) invert(1);
    }

    .invitation-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .invitation-right {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 64px;
      background: var(--surface);
    }

    .invitation-form {
      width: 100%;
      max-width: 380px;
    }

    .invitation-form h2 {
      font-size: 28px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
    }

    .invitation-form .subtitle {
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
      align-items: flex-start;
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
        margin-top: 1px;
      }

      .error-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
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
      .invitation-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .invitation-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .invitation-brand-logo {
        max-width: 120px;
        margin-bottom: 0;
      }

      .invitation-brand p {
        display: none;
      }

      .invitation-right {
        padding: 24px 24px 32px;
      }

      .invitation-form h2 {
        font-size: 22px;
        margin-bottom: 4px;
      }

      .invitation-form .subtitle {
        font-size: 14px;
        margin-bottom: 20px;
      }

      .form-group {
        margin-bottom: 16px;
      }
    }
  `]
})
export class AcceptInvitationComponent implements OnInit {
  token = '';
  name = '';
  password = '';
  confirmPassword = '';
  showPassword = signal(false);
  loading = signal(false);
  error = signal<string | null>(null);
  errorLines = computed(() => this.error()?.split('\n') ?? []);
  invalidToken = signal(false);
  success = signal(false);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private usersService: UsersService
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.invalidToken.set(true);
    }
  }

  submit(): void {
    if (!this.name || !this.password || !this.confirmPassword) return;

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

    this.usersService.acceptInvitation(this.token, this.name, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        if (err.status === 404 || err.status === 410) {
          this.invalidToken.set(true);
        } else if (err.status === 409) {
          this.error.set('An account with this email already exists.');
        } else if (err.status === 400 && err.error?.errors?.length) {
          this.error.set(err.error.errors.map((e: string) => e.replace(/^\w+:\s*/, '')).join('\n'));
        } else if (err.error?.message) {
          this.error.set(err.error.message);
        } else {
          this.error.set('Something went wrong. Please try again.');
        }
      }
    });
  }
}
