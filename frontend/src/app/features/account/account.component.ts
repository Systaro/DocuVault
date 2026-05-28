import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { ApiTokensService, ApiToken } from '../../core/api/api-tokens.service';
import { UsersService } from '../../core/api/users.service';
import { LayoutComponent } from '../../shared/components/layout.component';
import { NotificationSettingsComponent } from './notification-settings.component';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, FormsModule, LayoutComponent, NotificationSettingsComponent],
  template: `
    <app-layout>
      <div class="account-page">
        <div class="account-header">
          <h1>Account</h1>
          <p class="subtitle">Manage your profile and API access tokens</p>
        </div>

        <!-- Profile Section -->
        <div class="card">
          <div class="card-header">
            <span class="material-icons card-icon">person</span>
            <div>
              <h2>Profile</h2>
              <p>Your account information</p>
            </div>
          </div>
          <div class="card-body">
            <div class="profile-grid">
              <div class="profile-field">
                <label>Name</label>
                <span>{{ authService.user()?.name }}</span>
              </div>
              <div class="profile-field">
                <label>Email</label>
                <span>{{ authService.user()?.email }}</span>
              </div>
              <div class="profile-field">
                <label>Role</label>
                <span class="role-badge">{{ authService.user()?.role?.replace('_', ' ') }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Change Password Section -->
        <div class="card">
          <div class="card-header">
            <span class="material-icons card-icon">lock</span>
            <div>
              <h2>Change Password</h2>
              <p>Update your account password</p>
            </div>
          </div>
          <div class="card-body">
            <form (ngSubmit)="changePassword()" class="password-form">
              <div class="form-group">
                <label for="currentPassword">Current Password</label>
                <div class="password-input-wrapper">
                  <input
                    [type]="showCurrentPassword() ? 'text' : 'password'"
                    id="currentPassword"
                    [(ngModel)]="currentPassword"
                    name="currentPassword"
                    class="form-input full-width"
                    placeholder="Enter current password"
                    [disabled]="changingPassword()"
                  />
                  <button type="button" class="btn btn-ghost password-toggle" (click)="showCurrentPassword.set(!showCurrentPassword())">
                    <span class="material-icons">{{ showCurrentPassword() ? 'visibility_off' : 'visibility' }}</span>
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label for="newPassword">New Password</label>
                <div class="password-input-wrapper">
                  <input
                    [type]="showNewPassword() ? 'text' : 'password'"
                    id="newPassword"
                    [(ngModel)]="newPassword"
                    name="newPassword"
                    class="form-input full-width"
                    placeholder="Enter new password"
                    [disabled]="changingPassword()"
                  />
                  <button type="button" class="btn btn-ghost password-toggle" (click)="showNewPassword.set(!showNewPassword())">
                    <span class="material-icons">{{ showNewPassword() ? 'visibility_off' : 'visibility' }}</span>
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label for="confirmPassword">Confirm New Password</label>
                <div class="password-input-wrapper">
                  <input
                    [type]="showNewPassword() ? 'text' : 'password'"
                    id="confirmPassword"
                    [(ngModel)]="confirmPassword"
                    name="confirmPassword"
                    class="form-input full-width"
                    placeholder="Confirm new password"
                    [disabled]="changingPassword()"
                  />
                </div>
              </div>
              <p class="password-hint">Min 8 characters, with uppercase, lowercase, digit, and special character (&#64;$!%*?&amp;-_#)</p>
              @if (passwordError()) {
                <div class="form-error">{{ passwordError() }}</div>
              }
              @if (passwordSuccess()) {
                <div class="form-success">
                  <span class="material-icons">check_circle</span>
                  {{ passwordSuccess() }}
                </div>
              }
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="!currentPassword || !newPassword || !confirmPassword || changingPassword()"
              >
                @if (changingPassword()) {
                  <span class="material-icons animate-spin">sync</span>
                }
                Change Password
              </button>
            </form>
          </div>
        </div>

        <!-- Notifications Section -->
        <app-notification-settings></app-notification-settings>

        <!-- API Tokens Section -->
        <div class="card">
          <div class="card-header">
            <span class="material-icons card-icon">key</span>
            <div>
              <h2>API Tokens</h2>
              <p>Create tokens for external integrations like the MCP server</p>
            </div>
          </div>
          <div class="card-body">
            <!-- Create Token Form -->
            <div class="create-token-form">
              <div class="form-row">
                <input
                  type="text"
                  [(ngModel)]="newTokenName"
                  placeholder="Token name (e.g., Claude Code)"
                  class="form-input"
                  [disabled]="creating()"
                />
                <select [(ngModel)]="newTokenExpiry" class="form-select">
                  <option [ngValue]="30">30 days</option>
                  <option [ngValue]="90">90 days</option>
                  <option [ngValue]="365">1 year</option>
                  <option [ngValue]="null">No expiry</option>
                </select>
                <button
                  class="btn btn-primary"
                  (click)="createToken()"
                  [disabled]="!newTokenName.trim() || creating()"
                >
                  @if (creating()) {
                    <span class="material-icons animate-spin">sync</span>
                  } @else {
                    <span class="material-icons">add</span>
                  }
                  Create Token
                </button>
              </div>
              @if (createError()) {
                <div class="form-error">{{ createError() }}</div>
              }
            </div>

            <!-- New Token Display -->
            @if (newToken()) {
              <div class="new-token-display">
                <div class="new-token-header">
                  <span class="material-icons">check_circle</span>
                  <strong>Token created! Copy it now — it won't be shown again.</strong>
                </div>
                <div class="token-copy-row">
                  <code class="token-value">{{ newToken() }}</code>
                  <button class="btn btn-ghost" (click)="copyToken()" [title]="copied() ? 'Copied!' : 'Copy'">
                    <span class="material-icons">{{ copied() ? 'check' : 'content_copy' }}</span>
                  </button>
                </div>
              </div>
            }

            <!-- Token List -->
            @if (loading()) {
              <div class="loading-state">
                <span class="material-icons animate-spin">sync</span>
                Loading tokens...
              </div>
            } @else if (tokens().length === 0) {
              <div class="empty-state">
                <span class="material-icons">vpn_key_off</span>
                <p>No API tokens yet. Create one to get started.</p>
              </div>
            } @else {
              <table class="token-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Token</th>
                    <th>Created</th>
                    <th>Last Used</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (token of tokens(); track token.id) {
                    <tr [class.revoked]="!token.isActive">
                      <td class="token-name">{{ token.name }}</td>
                      <td><code class="token-prefix">{{ token.prefix }}...</code></td>
                      <td>{{ formatDate(token.createdAt) }}</td>
                      <td>{{ token.lastUsedAt ? formatDate(token.lastUsedAt) : 'Never' }}</td>
                      <td>{{ token.expiresAt ? formatDate(token.expiresAt) : 'Never' }}</td>
                      <td>
                        <span class="status-badge" [class.active]="token.isActive" [class.inactive]="!token.isActive">
                          {{ token.isActive ? 'Active' : (token.revokedAt ? 'Revoked' : 'Expired') }}
                        </span>
                      </td>
                      <td>
                        @if (token.isActive) {
                          <button class="btn btn-ghost btn-sm btn-danger" (click)="revokeToken(token.id)">
                            Revoke
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </div>

        <!-- MCP Setup Instructions -->
        <div class="card">
          <div class="card-header">
            <span class="material-icons card-icon">terminal</span>
            <div>
              <h2>MCP Server Setup</h2>
              <p>Use DocuVault documentation directly in Claude Code</p>
            </div>
          </div>
          <div class="card-body">
            <div class="mcp-explainer">
              <p>
                The <strong>Model Context Protocol (MCP)</strong> lets AI assistants like Claude access your documentation directly.
                Once configured, Claude can search, read, and edit your docs without leaving the conversation.
              </p>

              <div class="mcp-capabilities">
                <div class="capability-group">
                  <h4><span class="material-icons">search</span> Read &amp; Search</h4>
                  <ul>
                    <li><strong>search_documentation</strong> &mdash; semantic search across all docs</li>
                    <li><strong>search_by_keyword</strong> &mdash; find docs by title or path</li>
                    <li><strong>read_document</strong> &mdash; read the full content of any page</li>
                    <li><strong>download_document</strong> &mdash; save a document to a local file for editing</li>
                    <li><strong>list_spaces</strong> / <strong>list_documents</strong> &mdash; browse the doc tree</li>
                  </ul>
                </div>
                <div class="capability-group">
                  <h4><span class="material-icons">edit_note</span> Write &amp; Edit</h4>
                  <ul>
                    <li><strong>create_document</strong> &mdash; create new pages (inline or from a local file)</li>
                    <li><strong>update_document</strong> &mdash; fully replace a document's content</li>
                    <li><strong>edit_document</strong> &mdash; surgical find-and-replace that preserves all formatting</li>
                    <li><strong>insert_in_document</strong> &mdash; add content at a specific location</li>
                    <li><strong>delete_document</strong> &mdash; remove a document from the space</li>
                  </ul>
                </div>
              </div>

              <div class="mcp-note">
                <span class="material-icons">info</span>
                <p>
                  Write tools require an API token with <strong>Editor</strong> or <strong>Admin</strong> permissions on the target space.
                  Edits use optimistic locking — if the document changes between reading and writing, the edit is safely rejected.
                </p>
              </div>
            </div>

            <h3 class="setup-heading">Configuration</h3>
            <p class="setup-intro">
              Add the following to your project's <code>.mcp.json</code> file to enable DocuVault tools in Claude Code:
            </p>
            <div class="code-block">
              <div class="code-header">
                <span>.mcp.json</span>
                <button class="btn btn-ghost btn-sm" (click)="copyMcpConfig()" [title]="mcpCopied() ? 'Copied!' : 'Copy'">
                  <span class="material-icons">{{ mcpCopied() ? 'check' : 'content_copy' }}</span>
                </button>
              </div>
              <pre>{{ mcpConfig }}</pre>
            </div>
            <p class="setup-note">
              Replace <code>&lt;paste-your-token-here&gt;</code> with your API token from above.
            </p>
          </div>
        </div>
      </div>
    </app-layout>
  `,
  styles: [`
    .account-page {
      max-width: 900px;
      margin: 0 auto;
      padding: var(--spacing-xl);
    }

    .account-header {
      margin-bottom: var(--spacing-xl);

      h1 {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0 0 var(--spacing-xs);
      }

      .subtitle {
        color: var(--text-secondary);
        font-size: 15px;
        margin: 0;
      }
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      margin-bottom: var(--spacing-lg);
      overflow: hidden;
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-lg) var(--spacing-xl);
      border-bottom: 1px solid var(--border);

      .card-icon {
        font-size: 24px;
        color: var(--primary);
      }

      h2 {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 2px;
      }

      p {
        font-size: 13px;
        color: var(--text-secondary);
        margin: 0;
      }
    }

    .card-body {
      padding: var(--spacing-xl);
    }

    .profile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-lg);
    }

    .profile-field {
      label {
        display: block;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin-bottom: var(--spacing-xs);
      }

      span {
        font-size: 15px;
        color: var(--text-primary);
      }
    }

    .role-badge {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(111, 179, 184, 0.15);
      color: var(--primary-dark);
      border-radius: var(--radius-sm);
      font-size: 13px !important;
      font-weight: 500;
      text-transform: capitalize;
    }

    .password-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      max-width: 420px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs);

      label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
      }
    }

    .password-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .full-width {
      width: 100%;
    }

    .password-toggle {
      position: absolute;
      right: 4px;
      padding: 4px;

      .material-icons {
        font-size: 20px;
      }
    }

    .password-hint {
      font-size: 12px;
      color: var(--text-secondary);
      margin: 0;
    }

    .form-success {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      color: #16a34a;
      font-size: 13px;

      .material-icons {
        font-size: 18px;
      }
    }

    .create-token-form {
      margin-bottom: var(--spacing-lg);
    }

    .form-row {
      display: flex;
      gap: var(--spacing-sm);
      align-items: center;
    }

    .form-input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-size: 14px;
      background: var(--background);
      color: var(--text-primary);
      outline: none;
      transition: border-color var(--transition);

      &:focus {
        border-color: var(--primary);
      }
    }

    .form-select {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-size: 14px;
      background: var(--background);
      color: var(--text-primary);
      outline: none;
      cursor: pointer;
    }

    .form-error {
      color: var(--danger);
      font-size: 13px;
      margin-top: var(--spacing-sm);
    }

    .new-token-display {
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: var(--radius-md);
      padding: var(--spacing-md);
      margin-bottom: var(--spacing-lg);
    }

    .new-token-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      color: #16a34a;
      margin-bottom: var(--spacing-sm);
      font-size: 14px;

      .material-icons {
        font-size: 20px;
      }
    }

    .token-copy-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--spacing-sm) var(--spacing-md);
    }

    .token-value {
      flex: 1;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 13px;
      color: var(--text-primary);
      word-break: break-all;
    }

    .loading-state, .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-xl);
      color: var(--text-secondary);
      font-size: 14px;
    }

    .empty-state {
      flex-direction: column;

      .material-icons {
        font-size: 40px;
        opacity: 0.4;
      }
    }

    .token-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;

      th {
        text-align: left;
        padding: var(--spacing-sm) var(--spacing-md);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        border-bottom: 1px solid var(--border);
      }

      td {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border);
        color: var(--text-primary);
      }

      tr.revoked td {
        opacity: 0.5;
      }

      .token-name {
        font-weight: 500;
      }

      .token-prefix {
        font-family: 'SF Mono', Monaco, Consolas, monospace;
        font-size: 13px;
        padding: 2px 6px;
        background: var(--background);
        border-radius: var(--radius-sm);
      }
    }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 600;

      &.active {
        background: rgba(34, 197, 94, 0.15);
        color: #16a34a;
      }

      &.inactive {
        background: rgba(239, 68, 68, 0.1);
        color: #dc2626;
      }
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: 8px 16px;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 500;
      border: none;
      cursor: pointer;
      transition: all var(--transition);
      white-space: nowrap;
    }

    .btn-primary {
      background: var(--primary);
      color: white;

      &:hover:not(:disabled) {
        background: var(--primary-dark);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .btn-ghost {
      background: none;
      color: var(--text-secondary);
      padding: 6px;

      &:hover {
        color: var(--text-primary);
        background: var(--background);
      }
    }

    .btn-sm {
      padding: 4px 10px;
      font-size: 13px;
    }

    .btn-danger {
      color: #dc2626;

      &:hover {
        background: rgba(239, 68, 68, 0.1);
      }
    }

    .mcp-explainer {
      margin-bottom: var(--spacing-xl);

      > p {
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.6;
        margin: 0 0 var(--spacing-lg);
      }
    }

    .mcp-capabilities {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-lg);

      .capability-group {
        background: var(--background);
        border: 1px solid var(--border);
        border-radius: var(--radius-md);
        padding: var(--spacing-md) var(--spacing-lg);

        h4 {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-sm);

          .material-icons {
            font-size: 18px;
            color: var(--primary);
          }
        }

        ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;

          li {
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.4;

            strong {
              font-family: 'SF Mono', Monaco, Consolas, monospace;
              font-size: 12px;
              font-weight: 500;
              color: var(--text-primary);
            }
          }
        }
      }
    }

    .mcp-note {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      background: rgba(111, 179, 184, 0.08);
      border: 1px solid rgba(111, 179, 184, 0.2);
      border-radius: var(--radius-md);

      > .material-icons {
        font-size: 20px;
        color: var(--primary);
        flex-shrink: 0;
        margin-top: 1px;
      }

      p {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
        margin: 0;
      }
    }

    .setup-heading {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 var(--spacing-sm);
    }

    .setup-intro {
      color: var(--text-secondary);
      font-size: 14px;
      margin: 0 0 var(--spacing-md);

      code {
        padding: 2px 6px;
        background: var(--background);
        border-radius: var(--radius-sm);
        font-size: 13px;
      }
    }

    .code-block {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
      margin-bottom: var(--spacing-md);
    }

    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--spacing-sm) var(--spacing-md);
      background: var(--background);
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .code-block pre {
      margin: 0;
      padding: var(--spacing-md);
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-primary);
      background: var(--surface);
      overflow-x: auto;
    }

    .setup-note {
      color: var(--text-secondary);
      font-size: 13px;
      margin: 0;

      code {
        padding: 2px 6px;
        background: var(--background);
        border-radius: var(--radius-sm);
        font-size: 12px;
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
      .account-page {
        padding: var(--spacing-md);
      }

      .form-row {
        flex-direction: column;
      }

      .form-input, .form-select {
        width: 100%;
      }

      .token-table {
        font-size: 12px;

        th, td {
          padding: var(--spacing-xs) var(--spacing-sm);
        }
      }
    }
  `]
})
export class AccountComponent implements OnInit {
  tokens = signal<ApiToken[]>([]);
  loading = signal(true);
  creating = signal(false);
  createError = signal<string | null>(null);
  newToken = signal<string | null>(null);
  copied = signal(false);
  mcpCopied = signal(false);

  changingPassword = signal(false);
  passwordError = signal<string | null>(null);
  passwordSuccess = signal<string | null>(null);
  showCurrentPassword = signal(false);
  showNewPassword = signal(false);
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  newTokenName = '';
  newTokenExpiry: number | null = 90;

  mcpConfig: string;

  constructor(
    public authService: AuthService,
    private apiTokensService: ApiTokensService,
    private usersService: UsersService
  ) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://docuvault.systaro.de';
    this.mcpConfig = JSON.stringify({
      mcpServers: {
        docuvault: {
          command: 'npx',
          args: ['-y', '@systaro/docuvault-mcp'],
          env: {
            DOCUVAULT_URL: origin,
            DOCUVAULT_TOKEN: '<paste-your-token-here>'
          }
        }
      }
    }, null, 2);
  }

  ngOnInit(): void {
    this.loadTokens();
  }

  loadTokens(): void {
    this.loading.set(true);
    this.apiTokensService.listTokens().subscribe({
      next: (tokens) => {
        this.tokens.set(tokens);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  createToken(): void {
    if (!this.newTokenName.trim()) return;

    this.creating.set(true);
    this.createError.set(null);
    this.newToken.set(null);

    this.apiTokensService.createToken({
      name: this.newTokenName.trim(),
      expiresInDays: this.newTokenExpiry ?? undefined
    }).subscribe({
      next: (response) => {
        if (response.error) {
          this.createError.set(response.error);
        } else if (response.token) {
          this.newToken.set(response.token);
          this.newTokenName = '';
          this.loadTokens();
        }
        this.creating.set(false);
      },
      error: (err) => {
        this.createError.set(err.error?.error || 'Failed to create token');
        this.creating.set(false);
      }
    });
  }

  revokeToken(id: string): void {
    this.apiTokensService.revokeToken(id).subscribe({
      next: () => this.loadTokens(),
      error: () => {}
    });
  }

  copyToken(): void {
    const token = this.newToken();
    if (token) {
      navigator.clipboard.writeText(token);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  changePassword(): void {
    this.passwordError.set(null);
    this.passwordSuccess.set(null);

    if (this.newPassword !== this.confirmPassword) {
      this.passwordError.set('Passwords do not match');
      return;
    }

    if (this.newPassword.length < 8) {
      this.passwordError.set('Password must be at least 8 characters');
      return;
    }

    this.changingPassword.set(true);

    this.usersService.changePassword(this.currentPassword, this.newPassword).subscribe({
      next: () => {
        this.passwordSuccess.set('Password changed successfully');
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
        this.changingPassword.set(false);
      },
      error: (err) => {
        const errors = err.error?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
          this.passwordError.set(errors.join(', '));
        } else {
          this.passwordError.set(err.error?.message || 'Failed to change password');
        }
        this.changingPassword.set(false);
      }
    });
  }

  copyMcpConfig(): void {
    navigator.clipboard.writeText(this.mcpConfig);
    this.mcpCopied.set(true);
    setTimeout(() => this.mcpCopied.set(false), 2000);
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
}
