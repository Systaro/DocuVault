import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { OAuthConsent, OAuthService } from '../../core/api/oauth.service';
import { BrandingService } from '../../core/branding/branding.service';
import { PageTitleService } from '../../core/branding/page-title.service';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';

/**
 * The one page a person sees when connecting an MCP client (Claude Code,
 * Cursor, ...) to DocuVault. The client opens /oauth/authorize?... in the
 * browser; the auth guard sends an anonymous visitor through the normal login
 * first and back here. Approve hands the browser to the client's local
 * callback with a one-time code.
 */
@Component({
  selector: 'app-oauth-consent',
  standalone: true,
  imports: [CommonModule, RouterLink, BrandLogoComponent],
  template: `
    <div class="consent-container">
      <div class="consent-left">
        <div class="consent-brand">
          <app-brand-logo [onDark]="true" class="consent-brand-logo" />
          <p>Your team's collaborative documentation workspace with Git-powered version control</p>
        </div>
      </div>

      <div class="consent-right">
        <div class="consent-form">
          @if (loading()) {
            <div class="state">
              <span translate="no" class="material-icons animate-spin state-icon">sync</span>
              <p>Checking the request...</p>
            </div>
          } @else if (fatalError()) {
            <div class="state">
              <span translate="no" class="material-icons state-icon error-icon">link_off</span>
              <h2>Cannot authorize this request</h2>
              <p>{{ fatalError() }}</p>
              <p class="hint">Start the connection again from your MCP client. If it keeps failing, the client's configuration points at the wrong {{ branding.appName() }} URL.</p>
              <a routerLink="/dashboard" class="btn btn-secondary btn-full">Back to {{ branding.appName() }}</a>
            </div>
          } @else if (redirecting()) {
            <div class="state">
              <span translate="no" class="material-icons state-icon success-icon">check_circle</span>
              <h2>{{ redirecting() === 'approve' ? 'Access granted' : 'Access denied' }}</h2>
              <p>Sending you back to <strong>{{ consent()?.redirectTarget }}</strong>. You can close this tab once the client has picked it up.</p>
            </div>
          } @else {
            @if (consent(); as c) {
            <h2>Authorize {{ c.clientName }}</h2>
            <p class="subtitle">An application wants to use {{ branding.appName() }} on your behalf.</p>

            <div class="consent-facts">
              <div class="fact">
                <span translate="no" class="material-icons">person</span>
                <div>
                  <span class="fact-label">Signed in as</span>
                  <span class="fact-value">{{ c.userName }} <span class="fact-muted">({{ c.userEmail }})</span></span>
                </div>
              </div>
              <div class="fact">
                <span translate="no" class="material-icons">menu_book</span>
                <div>
                  <span class="fact-label">It will be able to</span>
                  <span class="fact-value">Search, read, create, edit and share documents in every space you have access to, with your permissions.</span>
                </div>
              </div>
              <div class="fact">
                <span translate="no" class="material-icons">undo</span>
                <div>
                  <span class="fact-label">After approving</span>
                  <span class="fact-value">Your browser returns to <strong>{{ c.redirectTarget }}</strong>, where the application is waiting.</span>
                </div>
              </div>
            </div>

            <div class="consent-note">
              <span translate="no" class="material-icons">info</span>
              <p>The application registered itself under the name "{{ c.clientName }}". {{ branding.appName() }} cannot verify who operates it, so only approve if you started this from a tool you trust.</p>
            </div>

            @if (error()) {
              <div class="error-message">
                <span translate="no" class="material-icons">error_outline</span>
                {{ error() }}
              </div>
            }

            <div class="consent-actions">
              <button type="button" class="btn btn-secondary" (click)="decide('deny')" [disabled]="submitting()">Deny</button>
              <button type="button" class="btn btn-primary" (click)="decide('approve')" [disabled]="submitting()">
                @if (submitting()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                } @else {
                  <span translate="no" class="material-icons">check</span>
                }
                Authorize
              </button>
            </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .consent-container {
      display: flex;
      height: 100vh;
      width: 100%;
    }

    .consent-left {
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

    .consent-brand {
      position: relative;
      z-index: 1;
      text-align: center;
      color: white;
    }

    .consent-brand-logo {
      --brand-logo-max-height: 64px;
      --brand-logo-max-width: 260px;
      --brand-text-size: 32px;
      margin-bottom: 24px;
    }

    .consent-brand p {
      font-size: 17px;
      opacity: 0.9;
      max-width: 300px;
      line-height: 1.6;
    }

    .consent-right {
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

    .consent-form {
      width: 100%;
      max-width: 440px;
    }

    .consent-form h2 {
      font-size: 26px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 8px;
      overflow-wrap: anywhere;
    }

    .consent-form .subtitle {
      color: var(--text-muted);
      margin-bottom: 28px;
    }

    .consent-facts {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 20px;
    }

    .fact {
      display: flex;
      gap: 14px;
      align-items: flex-start;

      > .material-icons {
        color: var(--primary);
        font-size: 22px;
        margin-top: 2px;
        flex-shrink: 0;
      }

      > div {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
    }

    .fact-label {
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
    }

    .fact-value {
      font-size: 14px;
      color: var(--text-primary);
      line-height: 1.5;
      overflow-wrap: anywhere;
    }

    .fact-muted {
      color: var(--text-muted);
    }

    .consent-note {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 12px 14px;
      background: var(--surface-secondary, rgba(0, 0, 0, 0.04));
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: 24px;

      .material-icons {
        color: var(--text-muted);
        font-size: 20px;
        flex-shrink: 0;
      }

      p {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
      }
    }

    .consent-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;

      .btn {
        min-width: 120px;
        justify-content: center;
      }
    }

    .btn-full {
      width: 100%;
      justify-content: center;
    }

    .state {
      text-align: center;

      h2 {
        font-size: 24px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 8px;
      }

      p {
        color: var(--text-muted);
        margin-bottom: 20px;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }
    }

    .state-icon {
      font-size: 56px;
      margin-bottom: 16px;
      color: var(--primary);
    }

    .error-icon {
      color: var(--error);
    }

    .success-icon {
      color: #4caf50;
    }

    .hint {
      font-size: 13px;
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
      margin-bottom: 20px;

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
      .consent-container {
        flex-direction: column;
        height: auto;
        min-height: 100vh;
      }

      .consent-left {
        padding: 16px 24px;
        min-height: 0;
        flex: 0 0 auto;
      }

      .consent-brand-logo {
        --brand-mark-width: 120px;
        --brand-logo-max-height: 40px;
        --brand-text-size: 22px;
        margin-bottom: 0;
      }

      .consent-brand p {
        display: none;
      }

      .consent-right {
        padding: 24px 24px 32px;
      }

      .consent-form h2 {
        font-size: 22px;
      }

      .consent-actions {
        flex-direction: column-reverse;

        .btn {
          width: 100%;
        }
      }
    }
  `]
})
export class OAuthConsentComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private oauth = inject(OAuthService);
  private pageTitle = inject(PageTitleService);
  protected branding = inject(BrandingService);

  loading = signal(true);
  submitting = signal(false);
  consent = signal<OAuthConsent | null>(null);
  fatalError = signal<string | null>(null);
  error = signal<string | null>(null);
  redirecting = signal<'approve' | 'deny' | null>(null);

  ngOnInit(): void {
    this.pageTitle.set('Authorize application');
    const query: Record<string, string> = {};
    this.route.snapshot.queryParamMap.keys.forEach(key => {
      const value = this.route.snapshot.queryParamMap.get(key);
      if (value !== null) query[key] = value;
    });

    this.oauth.describeAuthorization(query).subscribe({
      next: response => {
        if (response.redirectUrl) {
          // The request was malformed in a way the client should hear about.
          window.location.href = response.redirectUrl;
          return;
        }
        if (response.consent) {
          this.consent.set(response.consent);
          this.pageTitle.set(`Authorize ${response.consent.clientName}`);
        } else {
          this.fatalError.set('The authorization request is incomplete.');
        }
        this.loading.set(false);
      },
      error: err => {
        this.fatalError.set(err.error?.error_description || err.error?.message || 'The authorization request is invalid.');
        this.loading.set(false);
      }
    });
  }

  decide(decision: 'approve' | 'deny'): void {
    const c = this.consent();
    if (!c || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.oauth.decide(c.nonce, decision).subscribe({
      next: response => {
        if (!response.redirectUrl) {
          this.submitting.set(false);
          this.error.set(`${this.branding.appName()} did not return a redirect target. Start again from your MCP client.`);
          return;
        }
        this.redirecting.set(decision);
        window.location.href = response.redirectUrl;
      },
      error: err => {
        this.submitting.set(false);
        this.error.set(err.error?.error_description || err.error?.message || 'Something went wrong. Start again from your MCP client.');
      }
    });
  }
}
