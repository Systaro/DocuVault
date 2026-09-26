import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, AppSettings, TestResult } from '../../core/api/settings.service';
import { SearchableSelectComponent, SelectOption } from '../../shared/components/searchable-select.component';
import { AuthService } from '../../core/auth/auth.service';
import { BrandingAssetKind, BrandingService, DEFAULT_APP_NAME } from '../../core/branding/branding.service';
import { DEFAULT_PRIMARY, HEX_COLOR } from '../../core/branding/palette';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';
import { LogoUploadComponent } from '../../shared/components/logo-upload.component';
import { ToastService } from '../../shared/services/toast.service';

interface BrandingAssetSlot {
  kind: BrandingAssetKind;
  title: string;
  hint: string;
  label: string;
  types: string[];
  surface: 'light' | 'dark';
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent, BrandLogoComponent, LogoUploadComponent],
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <h1>Settings</h1>
        <p class="subtitle">Configure integrations and view application information</p>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <span translate="no" class="material-icons animate-spin">sync</span>
          Loading settings...
        </div>
      } @else if (error()) {
        <div class="error-state">
          <span translate="no" class="material-icons">error</span>
          {{ error() }}
        </div>
      } @else {
        @if (authService.isSuperAdmin()) {
          <!-- Branding -->
          <div class="settings-card" id="branding">
            <div class="settings-card-header">
              <div class="settings-card-icon git">
                <span translate="no" class="material-icons">palette</span>
              </div>
              <div>
                <h2>Branding</h2>
                <p>Name, colour and logos this instance shows everywhere, including the sign-in page and shared links</p>
              </div>
            </div>

            <div class="settings-card-body">
              <div class="form-group">
                <label for="brandName">App name</label>
                <input id="brandName" type="text" class="form-input" maxlength="60"
                       [ngModel]="brandName()" (ngModelChange)="brandName.set($event)"
                       [class.invalid]="!brandNameValid()" [placeholder]="defaultAppName" />
                @if (brandNameValid()) {
                  <p class="form-hint">Shown in the header, tab titles and emails. Leave empty for "{{ defaultAppName }}".</p>
                } @else {
                  <p class="form-hint invalid">Up to 60 characters, without &lt; or &gt;.</p>
                }
              </div>

              <div class="form-group">
                <label for="brandColor">Primary colour</label>
                <div class="color-row">
                  <input type="color" class="color-swatch" aria-label="Pick the primary colour"
                         [value]="brandColorValid() && brandColor() ? brandColor() : defaultPrimary"
                         (input)="setBrandColor($any($event.target).value)" />
                  <input id="brandColor" type="text" class="form-input hex-input" maxlength="7" placeholder="Default"
                         [ngModel]="brandColor()" (ngModelChange)="setBrandColor($event)"
                         [class.invalid]="!brandColorValid()" />
                  <button type="button" class="btn btn-secondary" (click)="setBrandColor('')" [disabled]="!brandColor()">
                    <span translate="no" class="material-icons">restart_alt</span>
                    Reset to default
                  </button>
                </div>
                @if (brandColorValid()) {
                  <p class="form-hint">Both themes derive their shades from this colour. A very light colour is darkened for buttons so their labels stay readable.</p>
                } @else {
                  <p class="form-hint invalid">Use the form #rrggbb.</p>
                }
              </div>

              <div class="brand-preview" aria-label="Preview">
                @for (theme of previewThemes; track theme) {
                  <div class="preview-bar" [attr.data-theme]="theme">
                    <app-brand-logo class="preview-logo" variant="wordmark" [onDark]="theme === 'dark'" />
                    <span class="preview-link">Link</span>
                    <span class="preview-button">Button</span>
                  </div>
                }
              </div>

              <div class="button-row">
                <button (click)="saveBranding()" [disabled]="savingBranding() || !brandingDirty() || !brandNameValid() || !brandColorValid()"
                        class="btn btn-primary">
                  @if (savingBranding()) {
                    <span translate="no" class="material-icons animate-spin">sync</span> Saving…
                  } @else {
                    <span translate="no" class="material-icons">save</span> Save branding
                  }
                </button>
              </div>

              <div class="asset-grid">
                @for (slot of assetSlots; track slot.kind) {
                  <div class="asset-slot">
                    <span class="asset-label">{{ slot.title }}</span>
                    <p class="form-hint">{{ slot.hint }}</p>
                    <app-logo-upload #upload
                      [currentLogoUrl]="assetUrl(slot.kind)"
                      [label]="slot.label"
                      [allowedTypes]="slot.types"
                      [maxBytes]="maxAssetBytes"
                      [surface]="slot.surface"
                      fit="contain"
                      (fileSelected)="uploadAsset(slot, $event, upload)"
                      (logoRemoved)="removeAsset(slot, upload)" />
                  </div>
                }
              </div>
            </div>
          </div>
        }

        <!-- GitLab Connection -->
        <div class="settings-card" id="git">
          <div class="settings-card-header">
            <div class="settings-card-icon git">
              <span translate="no" class="material-icons">cloud_sync</span>
            </div>
            <div>
              <h2>GitLab Connection</h2>
              <p>Connect to your GitLab instance for repository sync</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="form-group">
              <label for="gitlabUrl">GitLab URL</label>
              <input
                id="gitlabUrl"
                type="text"
                [(ngModel)]="gitlabUrl"
                placeholder="https://gitlab.com"
                class="form-input"
              />
              <span class="source-badge" [class.database]="settings()?.['gitlab.url']?.source === 'database'">
                {{ settings()?.['gitlab.url']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            <div class="form-group">
              <label for="gitlabToken">GitLab Token</label>
              <input
                id="gitlabToken"
                type="password"
                [(ngModel)]="gitlabToken"
                [placeholder]="settings()?.['gitlab.token']?.configured ? 'Current: ' + settings()!['gitlab.token'].value : 'Enter GitLab token'"
                class="form-input"
              />
              <span class="source-badge" [class.database]="settings()?.['gitlab.token']?.source === 'database'">
                @if (settings()?.['gitlab.token']?.configured) {
                  {{ settings()?.['gitlab.token']?.source === 'database' ? 'Configured (database)' : 'Configured (environment)' }}
                } @else {
                  Not configured
                }
              </span>
            </div>

            @if (gitlabTestResult()) {
              <div class="test-result" [class.success]="gitlabTestResult()?.success" [class.error]="!gitlabTestResult()?.success">
                <span translate="no" class="material-icons">{{ gitlabTestResult()?.success ? 'check_circle' : 'error' }}</span>
                {{ gitlabTestResult()?.message }}
              </div>
            }

            <div class="button-row">
              <button
                (click)="testGitlab()"
                [disabled]="testingGitlab()"
                class="btn btn-secondary"
              >
                @if (testingGitlab()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                  Testing...
                } @else {
                  <span translate="no" class="material-icons">wifi_tethering</span>
                  Test Connection
                }
              </button>
              <button
                (click)="saveGitlab()"
                [disabled]="savingGitlab()"
                class="btn btn-primary"
              >
                @if (savingGitlab()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                  Saving...
                } @else {
                  <span translate="no" class="material-icons">save</span>
                  Save GitLab Settings
                }
              </button>
            </div>
          </div>
        </div>

        <!-- OpenAI Configuration -->
        <div class="settings-card" id="ai">
          <div class="settings-card-header">
            <div class="settings-card-icon ai">
              <span translate="no" class="material-icons">auto_awesome</span>
            </div>
            <div>
              <h2>AI Features</h2>
              <p>Configure OpenAI for semantic search and AI-powered assistance</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="form-group">
              <label for="openaiApiKey">OpenAI API Key</label>
              <input
                id="openaiApiKey"
                type="password"
                [(ngModel)]="openaiApiKey"
                [placeholder]="settings()?.['openai.api-key']?.configured ? 'Current: ' + settings()!['openai.api-key'].value : 'Enter OpenAI API key'"
                class="form-input"
              />
              <span class="source-badge" [class.database]="settings()?.['openai.api-key']?.source === 'database'">
                @if (settings()?.['openai.api-key']?.configured) {
                  {{ settings()?.['openai.api-key']?.source === 'database' ? 'Configured (database)' : 'Configured (environment)' }}
                } @else {
                  Not configured
                }
              </span>
            </div>

            <div class="form-group">
              <label for="chatModel">Chat Model</label>
              <app-searchable-select
                id="chatModel"
                [options]="chatModelOptions"
                [(ngModel)]="chatModel"
              />
              <span class="source-badge" [class.database]="settings()?.['openai.chat-model']?.source === 'database'">
                {{ settings()?.['openai.chat-model']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            <div class="form-group">
              <label for="editModel">Document Edit Model</label>
              <app-searchable-select
                id="editModel"
                [options]="editModelOptions"
                [(ngModel)]="editModel"
              />
              <p class="form-hint">
                Used when the AI edits a document. Editing has to reproduce a file's
                structure exactly, which rewards a stronger model than chat does.
              </p>
              <span class="source-badge" [class.database]="settings()?.['openai.edit-model']?.source === 'database'">
                {{ settings()?.['openai.edit-model']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            <div class="form-group">
              <label for="embeddingModel">Embedding Model</label>
              <app-searchable-select
                id="embeddingModel"
                [options]="embeddingModelOptions"
                [(ngModel)]="embeddingModel"
                [searchable]="false"
              />
              <span class="source-badge" [class.database]="settings()?.['openai.embedding-model']?.source === 'database'">
                {{ settings()?.['openai.embedding-model']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            @if (openaiTestResult()) {
              <div class="test-result" [class.success]="openaiTestResult()?.success" [class.error]="!openaiTestResult()?.success">
                <span translate="no" class="material-icons">{{ openaiTestResult()?.success ? 'check_circle' : 'error' }}</span>
                {{ openaiTestResult()?.message }}
              </div>
            }

            <div class="button-row">
              <button
                (click)="testOpenai()"
                [disabled]="testingOpenai()"
                class="btn btn-secondary"
              >
                @if (testingOpenai()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                  Testing...
                } @else {
                  <span translate="no" class="material-icons">wifi_tethering</span>
                  Test Connection
                }
              </button>
              <button
                (click)="saveOpenai()"
                [disabled]="savingOpenai()"
                class="btn btn-primary"
              >
                @if (savingOpenai()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                  Saving...
                } @else {
                  <span translate="no" class="material-icons">save</span>
                  Save AI Settings
                }
              </button>
            </div>

            <div class="feature-list">
              <div class="feature-item">
                <span translate="no" class="material-icons">search</span>
                <div>
                  <strong>Semantic Search</strong>
                  <p>Find documents by meaning, not just keywords</p>
                </div>
              </div>
              <div class="feature-item">
                <span translate="no" class="material-icons">chat</span>
                <div>
                  <strong>AI Chat</strong>
                  <p>Ask questions about your documentation</p>
                </div>
              </div>
              <div class="feature-item">
                <span translate="no" class="material-icons">edit_note</span>
                <div>
                  <strong>Writing Assistant</strong>
                  <p>Get AI suggestions while writing</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Email / SMTP -->
        <div class="settings-card" id="email">
          <div class="settings-card-header">
            <div class="settings-card-icon">
              <span translate="no" class="material-icons">mail</span>
            </div>
            <div>
              <h2>Email (SMTP)</h2>
              <p>Outbound mail for invitations, password resets, and notifications</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="form-row">
              <div class="form-group">
                <label for="mailHost">SMTP host</label>
                <input id="mailHost" type="text" [(ngModel)]="mailHost"
                       placeholder="mail.example.com" class="form-input" />
                <span class="source-badge" [class.database]="settings()?.['mail.host']?.source === 'database'">
                  {{ settings()?.['mail.host']?.source === 'database' ? 'From database' : 'From environment' }}
                </span>
              </div>
              <div class="form-group">
                <label for="mailPort">Port</label>
                <input id="mailPort" type="number" [(ngModel)]="mailPort"
                       placeholder="25" class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label for="mailUsername">Username</label>
              <input id="mailUsername" type="text" [(ngModel)]="mailUsername"
                     autocomplete="off" class="form-input" />
            </div>

            <div class="form-group">
              <label for="mailPassword">Password</label>
              <input id="mailPassword" type="password" [(ngModel)]="mailPassword"
                     autocomplete="new-password"
                     [placeholder]="settings()?.['mail.password']?.configured ? 'Stored. Leave blank to keep.' : 'Enter SMTP password'"
                     class="form-input" />
              <span class="source-badge" [class.database]="settings()?.['mail.password']?.source === 'database'">
                @if (settings()?.['mail.password']?.configured) {
                  {{ settings()?.['mail.password']?.source === 'database' ? 'Configured (database)' : 'Configured (environment)' }}
                } @else {
                  Not configured
                }
              </span>
            </div>

            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" [(ngModel)]="mailStartTls" />
                Use STARTTLS
              </label>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="mailFromAddress">From address</label>
                <input id="mailFromAddress" type="email" [(ngModel)]="mailFromAddress"
                       placeholder="noreply@example.com" class="form-input" />
              </div>
              <div class="form-group">
                <label for="mailFromName">From name</label>
                <input id="mailFromName" type="text" [(ngModel)]="mailFromName"
                       [placeholder]="branding.appName()" class="form-input" />
              </div>
            </div>

            <div class="form-group">
              <label for="testEmailTo">Send test email to</label>
              <input id="testEmailTo" type="email" [(ngModel)]="testEmailTo"
                     placeholder="you@example.com" class="form-input" />
            </div>

            @if (emailTestResult()) {
              <div class="test-result" [class.success]="emailTestResult()?.success" [class.error]="!emailTestResult()?.success">
                <span translate="no" class="material-icons">{{ emailTestResult()?.success ? 'check_circle' : 'error' }}</span>
                {{ emailTestResult()?.message }}
              </div>
            }

            <div class="button-row">
              <button (click)="testEmail()" [disabled]="testingEmail() || !testEmailTo"
                      class="btn btn-secondary">
                @if (testingEmail()) {
                  <span translate="no" class="material-icons animate-spin">sync</span> Sending…
                } @else {
                  <span translate="no" class="material-icons">send</span> Send test email
                }
              </button>
              <button (click)="saveEmail()" [disabled]="savingEmail()"
                      class="btn btn-primary">
                @if (savingEmail()) {
                  <span translate="no" class="material-icons animate-spin">sync</span> Saving…
                } @else {
                  <span translate="no" class="material-icons">save</span> Save email settings
                }
              </button>
            </div>
          </div>
        </div>

        <!-- PDF export -->
        <div class="settings-card" id="pdf">
          <div class="settings-card-header">
            <div class="settings-card-icon">
              <span translate="no" class="material-icons">picture_as_pdf</span>
            </div>
            <div>
              <h2>PDF export</h2>
              <p>Optional. With a renderer, "Export as PDF" downloads a file; without one it opens the browser's print dialog</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="form-group">
              <label for="pdfRenderUrl">Renderer URL</label>
              <input id="pdfRenderUrl" type="text" [(ngModel)]="pdfRenderUrl"
                     placeholder="https://pdf.example.com/render" class="form-input" />
              <p class="form-hint">
                Receives <code>POST {{ '{' }} html, options {{ '}' }}</code> and answers with the PDF.
                Leave empty to keep using the print dialog.
              </p>
            </div>

            <div class="form-group">
              <label for="pdfApiKey">API key</label>
              <input id="pdfApiKey" type="password" [(ngModel)]="pdfApiKey"
                     [placeholder]="pdfKeyConfigured() ? 'Saved — type to replace' : 'Optional'"
                     class="form-input" autocomplete="off" />
              <p class="form-hint">
                Sent as <code>X-API-Key</code>. Stored encrypted and never handed to the browser —
                the rendering happens on the server for exactly that reason.
              </p>
            </div>

            @if (pdfSaveResult()) {
              <div class="test-result" [class.success]="pdfSaveResult()?.success" [class.error]="!pdfSaveResult()?.success">
                <span translate="no" class="material-icons">{{ pdfSaveResult()?.success ? 'check_circle' : 'error' }}</span>
                {{ pdfSaveResult()?.message }}
              </div>
            }

            <div class="button-row">
              <button (click)="savePdf()" [disabled]="savingPdf()" class="btn btn-primary">
                @if (savingPdf()) {
                  <span translate="no" class="material-icons animate-spin">sync</span> Saving…
                } @else {
                  <span translate="no" class="material-icons">save</span> Save PDF settings
                }
              </button>
            </div>
          </div>
        </div>

        <!-- Application Info -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon info">
              <span translate="no" class="material-icons">info</span>
            </div>
            <div>
              <h2>About DocuVault</h2>
              <p>Application version and technology stack</p>
            </div>
          </div>

          <div class="settings-card-body">
            <div class="info-grid">
              <div class="info-item">
                <span class="info-label">Version</span>
                <span class="info-value">0.1.0</span>
              </div>
              <div class="info-item">
                <span class="info-label">Frontend</span>
                <span class="info-value">Angular 18</span>
              </div>
              <div class="info-item">
                <span class="info-label">Backend</span>
                <span class="info-value">Spring Boot 3.2 + Kotlin</span>
              </div>
              <div class="info-item">
                <span class="info-label">Database</span>
                <span class="info-value">PostgreSQL 16 + pgvector</span>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .settings-page {
      max-width: 800px;
    }

    .settings-header {
      margin-bottom: var(--spacing-xl);

      h1 {
        font-size: 24px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .subtitle {
        color: var(--text-muted);
        font-size: 14px;
      }
    }

    .loading-state, .error-state {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-lg);
      background: var(--surface);
      border-radius: var(--radius-lg);
      color: var(--text-muted);
    }

    .error-state {
      color: var(--error);
    }

    .settings-card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      margin-bottom: var(--spacing-lg);
      overflow: hidden;
    }

    .settings-card-header {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-md);
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);
      background: var(--background);

      h2 {
        font-size: 17px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 4px;
      }

      p {
        font-size: 13px;
        color: var(--text-muted);
      }
    }

    .settings-card-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .material-icons {
        font-size: 22px;
        color: white;
      }

      &.git {
        background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      }

      &.ai {
        background: linear-gradient(135deg, #7c4dff 0%, #651fff 100%);
      }

      &.info {
        background: linear-gradient(135deg, var(--accent-400) 0%, var(--accent-500) 100%);
      }
    }

    .settings-card-body {
      padding: var(--spacing-lg);
    }

    .form-group {
      margin-bottom: var(--spacing-lg);

      label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }
    }

    .form-hint {
      margin: var(--spacing-xs) 0 0;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-muted);
    }

    .form-input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--background);
      color: var(--text-primary);
      font-size: 14px;
      transition: border-color 0.2s, box-shadow 0.2s;

      &:focus {
        outline: none;
        border-color: var(--primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 10%, transparent);
      }

      &::placeholder {
        color: var(--text-muted);
      }
    }

    .source-badge {
      display: inline-block;
      margin-top: var(--spacing-xs);
      font-size: 11px;
      color: var(--text-muted);
      padding: 2px 8px;
      background: var(--background);
      border-radius: var(--radius-sm);

      &.database {
        background: color-mix(in srgb, var(--primary) 10%, transparent);
        color: var(--primary-dark);
      }
    }

    .test-result {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-lg);
      font-size: 13px;
      line-height: 1.5;

      .material-icons {
        font-size: 18px;
        flex-shrink: 0;
      }

      &.success {
        background: rgba(76, 175, 80, 0.1);
        color: var(--success);
      }

      &.error {
        background: rgba(244, 67, 54, 0.1);
        color: var(--error);
      }
    }

    .button-row {
      display: flex;
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-lg);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      padding: 10px 16px;
      border: none;
      border-radius: var(--radius-md);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      .material-icons {
        font-size: 18px;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    .btn-primary {
      background: var(--primary);
      color: white;

      &:hover:not(:disabled) {
        background: var(--primary-dark);
      }
    }

    .btn-secondary {
      background: var(--background);
      color: var(--text-primary);
      border: 1px solid var(--border);

      &:hover:not(:disabled) {
        background: var(--surface);
        border-color: var(--primary);
      }
    }

    .feature-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      margin-top: var(--spacing-lg);
      padding-top: var(--spacing-lg);
      border-top: 1px solid var(--border);
    }

    .feature-item {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-md);
      padding: var(--spacing-md);
      background: var(--background);
      border-radius: var(--radius-md);

      .material-icons {
        font-size: 24px;
        color: var(--primary);
      }

      strong {
        display: block;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 2px;
      }

      p {
        font-size: 13px;
        color: var(--text-muted);
      }
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-md);
    }

    .info-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: var(--spacing-md);
      background: var(--background);
      border-radius: var(--radius-md);
    }

    .info-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .info-value {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .form-input.invalid {
      border-color: var(--error);
    }

    .form-hint.invalid {
      color: var(--error);
    }

    .color-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
    }

    .color-swatch {
      width: 44px;
      height: 40px;
      padding: 2px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--background);
      cursor: pointer;
      flex-shrink: 0;
    }

    .hex-input {
      width: 120px;
      font-family: Monaco, Menlo, monospace;
    }

    .brand-preview {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-lg);
    }

    .preview-bar {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      height: 64px;
      padding: 0 var(--spacing-md);
      background: var(--surface);
      color: var(--text-primary);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      overflow: hidden;
    }

    .preview-logo {
      flex: 1;
      min-width: 0;
      --brand-text-size: 17px;
    }

    .preview-link {
      font-size: 13px;
      font-weight: 500;
      color: var(--primary-dark);
    }

    .preview-button {
      padding: 6px 12px;
      border-radius: var(--radius-md);
      background: var(--primary);
      color: white;
      font-size: 13px;
      font-weight: 500;
    }

    .asset-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--spacing-lg);
      padding-top: var(--spacing-lg);
      border-top: 1px solid var(--border);

      .form-hint {
        margin: 0 0 var(--spacing-sm);
        min-height: 3em;
      }
    }

    .asset-label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }

    @media (max-width: 576px) {
      .info-grid,
      .brand-preview,
      .asset-grid {
        grid-template-columns: 1fr;
      }

      .color-row {
        flex-wrap: wrap;
      }

      .button-row {
        flex-direction: column;
      }
    }
  `]
})
export class SettingsComponent implements OnInit, OnDestroy {
  protected authService = inject(AuthService);
  protected branding = inject(BrandingService);
  private toast = inject(ToastService);

  // Branding form
  readonly defaultAppName = DEFAULT_APP_NAME;
  readonly defaultPrimary = DEFAULT_PRIMARY;
  readonly previewThemes = ['light', 'dark'] as const;
  readonly maxAssetBytes = 1024 * 1024;
  readonly assetSlots: BrandingAssetSlot[] = [
    { kind: 'logo', title: 'Logo', hint: 'For light backgrounds: the header in light mode and shared links.', label: 'logo', types: IMAGE_TYPES, surface: 'light' },
    { kind: 'logo-dark', title: 'Logo on dark', hint: 'For dark backgrounds: dark mode and the sign-in panel. Falls back to the logo.', label: 'logo', types: IMAGE_TYPES, surface: 'dark' },
    { kind: 'favicon', title: 'Favicon', hint: 'The browser tab icon. Square, at least 64 px.', label: 'icon', types: [...IMAGE_TYPES, 'image/x-icon', 'image/vnd.microsoft.icon'], surface: 'light' }
  ];
  brandName = signal('');
  brandColor = signal('');
  savingBranding = signal(false);
  brandNameValid = computed(() => this.brandName().trim().length <= 60 && !/[<>]/.test(this.brandName()));
  brandColorValid = computed(() => !this.brandColor() || HEX_COLOR.test(this.brandColor()));
  brandingDirty = computed(() => {
    const saved = this.branding.branding();
    const savedName = this.branding.customName() ? saved.appName : '';
    return this.brandName().trim() !== savedName || this.brandColor().toLowerCase() !== (saved.primaryColor ?? '').toLowerCase();
  });

  settings = signal<AppSettings | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);

  // GitLab form
  gitlabUrl = '';
  gitlabToken = '';
  testingGitlab = signal(false);
  savingGitlab = signal(false);
  gitlabTestResult = signal<TestResult | null>(null);

  // OpenAI form
  openaiApiKey = '';
  chatModel = 'gpt-5.5';
  editModel = '';
  embeddingModel = 'text-embedding-3-small';

  readonly chatModelOptions: SelectOption[] = [
    { value: 'gpt-5.5', label: 'GPT-5.5 (Recommended)' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano (Budget)' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'o4-mini', label: 'o4-mini (Reasoning)' },
    { value: 'o3', label: 'o3 (Reasoning)' }
  ];

  readonly editModelOptions: SelectOption[] = [
    { value: '', label: 'Same as chat model' },
    { value: 'gpt-5.5', label: 'GPT-5.5 (Recommended)' },
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.1', label: 'GPT-5.1' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-nano', label: 'GPT-5 Nano (Budget)' }
  ];

  readonly embeddingModelOptions: SelectOption[] = [
    { value: 'text-embedding-3-small', label: 'text-embedding-3-small (Recommended)' },
    { value: 'text-embedding-ada-002', label: 'text-embedding-ada-002 (Legacy)' }
  ];
  testingOpenai = signal(false);
  savingOpenai = signal(false);
  openaiTestResult = signal<TestResult | null>(null);

  // Email / SMTP form
  mailHost = '';
  mailPort = 25;
  mailUsername = '';
  mailPassword = '';
  mailStartTls = true;
  mailFromAddress = '';
  mailFromName = '';
  testEmailTo = '';
  testingEmail = signal(false);
  savingEmail = signal(false);

  // PDF export
  pdfRenderUrl = '';
  pdfApiKey = '';
  pdfKeyConfigured = signal(false);
  savingPdf = signal(false);
  pdfSaveResult = signal<TestResult | null>(null);
  emailTestResult = signal<TestResult | null>(null);

  constructor(private settingsService: SettingsService) {}

  ngOnInit(): void {
    this.resetBrandingForm();
    this.loadSettings();
  }

  ngOnDestroy(): void {
    this.branding.preview(undefined);
  }

  private resetBrandingForm(): void {
    this.brandName.set(this.branding.customName() ? this.branding.appName() : '');
    this.brandColor.set(this.branding.branding().primaryColor ?? '');
  }

  /** Applied app-wide straight away, so the whole page previews an unsaved colour. */
  setBrandColor(value: string): void {
    const color = value.trim();
    this.brandColor.set(color);
    if (!color) this.branding.preview(null);
    else if (HEX_COLOR.test(color)) this.branding.preview(color);
  }

  saveBranding(): void {
    this.savingBranding.set(true);
    this.branding.save({ appName: this.brandName().trim(), primaryColor: this.brandColor() }).subscribe({
      next: () => {
        this.branding.preview(undefined);
        this.resetBrandingForm();
        this.savingBranding.set(false);
        this.toast.success('Branding saved', 'The new name and colour are live for everyone.');
      },
      error: err => {
        this.savingBranding.set(false);
        this.toast.error('Could not save branding', this.errorMessage(err));
      }
    });
  }

  assetUrl(kind: BrandingAssetKind): string | null {
    const branding = this.branding.branding();
    return kind === 'logo' ? branding.logo : kind === 'logo-dark' ? branding.logoDark : branding.favicon;
  }

  uploadAsset(slot: BrandingAssetSlot, file: File, upload: LogoUploadComponent): void {
    upload.setUploading(true);
    this.branding.uploadAsset(slot.kind, file).subscribe({
      next: () => {
        upload.setUploading(false);
        upload.clearPreview();
        this.toast.success(`${slot.title} uploaded`, 'It is live for everyone.');
      },
      error: err => {
        upload.setUploading(false);
        upload.clearPreview();
        this.toast.error(`Could not upload the ${slot.title.toLowerCase()}`,
          err.status === 413 ? 'The file is larger than 1 MB.' : this.errorMessage(err));
      }
    });
  }

  removeAsset(slot: BrandingAssetSlot, upload: LogoUploadComponent): void {
    upload.setUploading(true);
    this.branding.deleteAsset(slot.kind).subscribe({
      next: () => {
        upload.setUploading(false);
        this.toast.success(`${slot.title} removed`, 'The default is shown again.');
      },
      error: err => {
        upload.setUploading(false);
        this.toast.error(`Could not remove the ${slot.title.toLowerCase()}`, this.errorMessage(err));
      }
    });
  }

  private errorMessage(err: { error?: { message?: string; error?: string } }): string {
    return err.error?.message || err.error?.error || 'Please try again.';
  }

  loadSettings(): void {
    this.loading.set(true);
    this.error.set(null);

    this.settingsService.getSettings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.gitlabUrl = settings['gitlab.url']?.value || '';
        this.chatModel = settings['openai.chat-model']?.value || 'gpt-5.5';
        this.editModel = settings['openai.edit-model']?.value || '';
        this.embeddingModel = settings['openai.embedding-model']?.value || 'text-embedding-3-small';
        this.mailHost = settings['mail.host']?.value || '';
        this.mailPort = parseInt(settings['mail.port']?.value || '25', 10) || 25;
        this.mailUsername = settings['mail.username']?.value || '';
        this.mailStartTls = (settings['mail.starttls']?.value || 'true') === 'true';
        this.mailFromAddress = settings['mail.from-address']?.value || '';
        this.mailFromName = settings['mail.from-name']?.value || '';
        this.pdfRenderUrl = settings['pdf.render-url']?.value || '';
        // The key comes back masked, so it is never put in the field — an empty
        // box with a "Saved" placeholder, and typing replaces it.
        this.pdfKeyConfigured.set(settings['pdf.api-key']?.configured === true);
        this.pdfApiKey = '';
        this.testEmailTo = '';
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('Failed to load settings. Make sure you have admin permissions.');
        this.loading.set(false);
      }
    });
  }

  testGitlab(): void {
    this.testingGitlab.set(true);
    this.gitlabTestResult.set(null);

    // Use provided values for testing, or undefined to test current saved values
    const url = this.gitlabUrl || undefined;
    const token = this.gitlabToken || undefined;

    this.settingsService.testGitlab(url, token).subscribe({
      next: (result) => {
        this.gitlabTestResult.set(result);
        this.testingGitlab.set(false);
      },
      error: () => {
        this.gitlabTestResult.set({ success: false, message: 'Failed to test connection' });
        this.testingGitlab.set(false);
      }
    });
  }

  saveGitlab(): void {
    this.savingGitlab.set(true);

    this.settingsService.updateSettings({
      gitlabUrl: this.gitlabUrl || undefined,
      gitlabToken: this.gitlabToken || undefined
    }).subscribe({
      next: () => {
        this.gitlabToken = ''; // Clear token field after save
        this.loadSettings(); // Reload to get updated source badges
        this.savingGitlab.set(false);
      },
      error: () => {
        this.gitlabTestResult.set({ success: false, message: 'Failed to save settings' });
        this.savingGitlab.set(false);
      }
    });
  }

  testOpenai(): void {
    this.testingOpenai.set(true);
    this.openaiTestResult.set(null);

    // Use provided API key for testing, or undefined to test current saved value
    const apiKey = this.openaiApiKey || undefined;

    this.settingsService.testOpenai(apiKey, this.chatModel).subscribe({
      next: (result) => {
        this.openaiTestResult.set(result);
        this.testingOpenai.set(false);
      },
      error: () => {
        this.openaiTestResult.set({ success: false, message: 'Failed to test connection' });
        this.testingOpenai.set(false);
      }
    });
  }

  saveOpenai(): void {
    this.savingOpenai.set(true);

    this.settingsService.updateSettings({
      openaiApiKey: this.openaiApiKey || undefined,
      openaiChatModel: this.chatModel,
      openaiEditModel: this.editModel,
      openaiEmbeddingModel: this.embeddingModel
    }).subscribe({
      next: () => {
        this.openaiApiKey = ''; // Clear API key field after save
        this.loadSettings(); // Reload to get updated source badges
        this.savingOpenai.set(false);
      },
      error: () => {
        this.openaiTestResult.set({ success: false, message: 'Failed to save settings' });
        this.savingOpenai.set(false);
      }
    });
  }

  savePdf(): void {
    this.savingPdf.set(true);
    this.pdfSaveResult.set(null);
    this.settingsService.updateSettings({
      pdfRenderUrl: this.pdfRenderUrl,
      // Sending an empty key would wipe a stored one; only a typed value is sent.
      pdfApiKey: this.pdfApiKey || undefined
    }).subscribe({
      next: () => {
        this.pdfApiKey = '';
        this.loadSettings();
        this.savingPdf.set(false);
        this.pdfSaveResult.set({ success: true, message: 'PDF settings saved' });
      },
      error: () => {
        this.savingPdf.set(false);
        this.pdfSaveResult.set({ success: false, message: 'Failed to save settings' });
      }
    });
  }

  saveEmail(): void {
    this.savingEmail.set(true);
    this.emailTestResult.set(null);

    this.settingsService.updateSettings({
      mailHost: this.mailHost || undefined,
      mailPort: this.mailPort || undefined,
      mailUsername: this.mailUsername || undefined,
      mailPassword: this.mailPassword || undefined,
      mailStartTls: this.mailStartTls,
      mailFromAddress: this.mailFromAddress || undefined,
      mailFromName: this.mailFromName || undefined
    }).subscribe({
      next: () => {
        this.mailPassword = '';
        this.loadSettings();
        this.savingEmail.set(false);
      },
      error: () => {
        this.emailTestResult.set({ success: false, message: 'Failed to save settings' });
        this.savingEmail.set(false);
      }
    });
  }

  testEmail(): void {
    if (!this.testEmailTo) return;
    this.testingEmail.set(true);
    this.emailTestResult.set(null);

    this.settingsService.testEmail(this.testEmailTo).subscribe({
      next: (result) => {
        this.emailTestResult.set(result);
        this.testingEmail.set(false);
      },
      error: () => {
        this.emailTestResult.set({ success: false, message: 'Failed to send test email' });
        this.testingEmail.set(false);
      }
    });
  }
}
