import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService, AppSettings, TestResult } from '../../core/api/settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="settings-page">
      <div class="settings-header">
        <h1>Settings</h1>
        <p class="subtitle">Configure integrations and view application information</p>
      </div>

      @if (loading()) {
        <div class="loading-state">
          <span class="material-icons animate-spin">sync</span>
          Loading settings...
        </div>
      } @else if (error()) {
        <div class="error-state">
          <span class="material-icons">error</span>
          {{ error() }}
        </div>
      } @else {
        <!-- GitLab Connection -->
        <div class="settings-card" id="git">
          <div class="settings-card-header">
            <div class="settings-card-icon git">
              <span class="material-icons">cloud_sync</span>
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
                <span class="material-icons">{{ gitlabTestResult()?.success ? 'check_circle' : 'error' }}</span>
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
                  <span class="material-icons animate-spin">sync</span>
                  Testing...
                } @else {
                  <span class="material-icons">wifi_tethering</span>
                  Test Connection
                }
              </button>
              <button
                (click)="saveGitlab()"
                [disabled]="savingGitlab()"
                class="btn btn-primary"
              >
                @if (savingGitlab()) {
                  <span class="material-icons animate-spin">sync</span>
                  Saving...
                } @else {
                  <span class="material-icons">save</span>
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
              <span class="material-icons">auto_awesome</span>
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
              <select
                id="chatModel"
                [(ngModel)]="chatModel"
                class="form-select"
              >
                <option value="gpt-5.1">GPT-5.1 (Recommended)</option>
                <option value="gpt-5">GPT-5</option>
                <option value="gpt-5-nano">GPT-5 Nano (Budget)</option>
                <option value="gpt-4.1">GPT-4.1</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4.1-nano">GPT-4.1 Nano</option>
                <option value="gpt-4o">GPT-4o</option>
                <option value="gpt-4o-mini">GPT-4o Mini</option>
                <option value="o4-mini">o4-mini (Reasoning)</option>
                <option value="o3">o3 (Reasoning)</option>
              </select>
              <span class="source-badge" [class.database]="settings()?.['openai.chat-model']?.source === 'database'">
                {{ settings()?.['openai.chat-model']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            <div class="form-group">
              <label for="embeddingModel">Embedding Model</label>
              <select
                id="embeddingModel"
                [(ngModel)]="embeddingModel"
                class="form-select"
              >
                <option value="text-embedding-3-small">text-embedding-3-small (Recommended)</option>
                <option value="text-embedding-3-large">text-embedding-3-large (Higher quality)</option>
                <option value="text-embedding-ada-002">text-embedding-ada-002 (Legacy)</option>
              </select>
              <span class="source-badge" [class.database]="settings()?.['openai.embedding-model']?.source === 'database'">
                {{ settings()?.['openai.embedding-model']?.source === 'database' ? 'From database' : 'From environment' }}
              </span>
            </div>

            @if (openaiTestResult()) {
              <div class="test-result" [class.success]="openaiTestResult()?.success" [class.error]="!openaiTestResult()?.success">
                <span class="material-icons">{{ openaiTestResult()?.success ? 'check_circle' : 'error' }}</span>
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
                  <span class="material-icons animate-spin">sync</span>
                  Testing...
                } @else {
                  <span class="material-icons">wifi_tethering</span>
                  Test Connection
                }
              </button>
              <button
                (click)="saveOpenai()"
                [disabled]="savingOpenai()"
                class="btn btn-primary"
              >
                @if (savingOpenai()) {
                  <span class="material-icons animate-spin">sync</span>
                  Saving...
                } @else {
                  <span class="material-icons">save</span>
                  Save AI Settings
                }
              </button>
            </div>

            <div class="feature-list">
              <div class="feature-item">
                <span class="material-icons">search</span>
                <div>
                  <strong>Semantic Search</strong>
                  <p>Find documents by meaning, not just keywords</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="material-icons">chat</span>
                <div>
                  <strong>AI Chat</strong>
                  <p>Ask questions about your documentation</p>
                </div>
              </div>
              <div class="feature-item">
                <span class="material-icons">edit_note</span>
                <div>
                  <strong>Writing Assistant</strong>
                  <p>Get AI suggestions while writing</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Application Info -->
        <div class="settings-card">
          <div class="settings-card-header">
            <div class="settings-card-icon info">
              <span class="material-icons">info</span>
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

    .form-input, .form-select {
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
        box-shadow: 0 0 0 3px rgba(111, 179, 184, 0.1);
      }

      &::placeholder {
        color: var(--text-muted);
      }
    }

    .form-select {
      cursor: pointer;
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
        background: rgba(111, 179, 184, 0.1);
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

    @media (max-width: 576px) {
      .info-grid {
        grid-template-columns: 1fr;
      }

      .button-row {
        flex-direction: column;
      }
    }
  `]
})
export class SettingsComponent implements OnInit {
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
  chatModel = 'gpt-4o';
  embeddingModel = 'text-embedding-3-small';
  testingOpenai = signal(false);
  savingOpenai = signal(false);
  openaiTestResult = signal<TestResult | null>(null);

  constructor(private settingsService: SettingsService) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  loadSettings(): void {
    this.loading.set(true);
    this.error.set(null);

    this.settingsService.getSettings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.gitlabUrl = settings['gitlab.url']?.value || '';
        this.chatModel = settings['openai.chat-model']?.value || 'gpt-4o';
        this.embeddingModel = settings['openai.embedding-model']?.value || 'text-embedding-3-small';
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
}
