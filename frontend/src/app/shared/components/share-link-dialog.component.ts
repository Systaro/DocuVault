import { Component, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedLinksService, SharedLink } from '../../core/api/shared-links.service';
import { ToastService } from '../services/toast.service';
import { SearchableSelectComponent, SelectOption } from './searchable-select.component';

@Component({
  selector: 'app-share-link-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="share-dialog" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="share-header">
          <h2>{{ isDirectory() ? 'Share Folder' : 'Share File' }}</h2>
          <button class="icon-btn" (click)="close.emit()">
            <span class="material-icons">close</span>
          </button>
        </div>

        <div class="share-body">
          <!-- File info -->
          <div class="file-info">
            <span class="material-icons file-icon">{{ getFileIcon() }}</span>
            <span class="file-name">{{ getFileName() }}</span>
          </div>

          <!-- Share type toggle (only for directories) -->
          @if (isDirectory()) {
            <div class="share-type-section">
              <label class="toggle-label">
                <input type="checkbox" [(ngModel)]="shareAsFolder" />
                <span class="material-icons toggle-icon">{{ shareAsFolder ? 'folder_shared' : 'insert_drive_file' }}</span>
                <span>{{ shareAsFolder ? 'Share entire folder with navigation' : 'Share as single file link' }}</span>
              </label>
            </div>
          }

          <!-- Create section -->
          <div class="create-section">
            <div class="section-label">Generate Public Link</div>
            <div class="create-row">
              <app-searchable-select
                class="expiry-select"
                [options]="expiryOptions"
                [(ngModel)]="selectedExpiry"
                [searchable]="false"
              />
              <button
                class="btn btn-primary btn-sm"
                [disabled]="creating() || (usePassword && !sharePassword)"
                (click)="createLink()"
              >
                @if (creating()) {
                  <span class="material-icons animate-spin">sync</span>
                } @else {
                  <span class="material-icons">link</span>
                }
                Generate Link
              </button>
            </div>

            <!-- Access level -->
            <div class="access-level-section">
              <div class="section-label">Access Level</div>
              <div class="access-level-options">
                <label class="access-option" [class.selected]="accessLevel === 'VIEW'">
                  <input type="radio" name="accessLevel" value="VIEW" [(ngModel)]="accessLevel" />
                  <span class="material-icons">visibility</span>
                  <div class="access-option-text">
                    <span class="access-option-title">View only</span>
                    <span class="access-option-desc">Can view content and annotations</span>
                  </div>
                </label>
                <label class="access-option" [class.selected]="accessLevel === 'COMMENT'">
                  <input type="radio" name="accessLevel" value="COMMENT" [(ngModel)]="accessLevel" />
                  <span class="material-icons">add_comment</span>
                  <div class="access-option-text">
                    <span class="access-option-title">Can comment</span>
                    <span class="access-option-desc">Can view and add annotations</span>
                  </div>
                </label>
              </div>
            </div>

            <!-- Password protection -->
            <div class="password-section">
              <label class="toggle-label">
                <input type="checkbox" [(ngModel)]="usePassword" />
                <span class="material-icons toggle-icon">lock</span>
                <span>Password protect</span>
              </label>
              @if (usePassword) {
                <input
                  type="password"
                  class="password-input"
                  [(ngModel)]="sharePassword"
                  placeholder="Enter password"
                />
              }
            </div>

            <!-- Writable scopes -->
            <div class="writable-section">
              <label class="toggle-label">
                <input type="checkbox" [(ngModel)]="enableWritableScopes" />
                <span class="material-icons toggle-icon">edit</span>
                <span>Allow state writes (for interactive HTML)</span>
              </label>
              @if (enableWritableScopes) {
                <div class="scopes-hint">JSON paths this link may write to, one per line.</div>
                <textarea
                  class="scopes-input"
                  [(ngModel)]="writableScopesText"
                  placeholder="e.g. projekt-management/pilot-verantwortlichkeiten.json"
                  rows="3"
                ></textarea>
              }
            </div>
          </div>

          <!-- Active links -->
          <div class="links-section">
            <div class="section-label">
              Active Links
              @if (loading()) {
                <span class="material-icons animate-spin loading-icon">sync</span>
              }
            </div>

            @if (!loading() && activeLinks().length === 0) {
              <div class="empty-links">
                <span class="material-icons">link_off</span>
                <p>No active share links</p>
              </div>
            } @else {
              @for (link of activeLinks(); track link.id) {
                <div class="link-row">
                  <div class="link-info">
                    <div class="link-token" [title]="getShareUrl(link.token)">
                      {{ getShareUrl(link.token) | slice:0:50 }}...
                    </div>
                    <div class="link-meta">
                      @if (link.hasPassword) {
                        <span class="meta-badge password-badge">
                          <span class="material-icons">lock</span> Password
                        </span>
                      }
                      <span class="meta-badge type-badge">{{ link.shareType === 'FOLDER' ? 'Folder' : 'File' }}</span>
                      @if (link.accessLevel === 'COMMENT') {
                        <span class="meta-badge comment-badge">
                          <span class="material-icons">add_comment</span> Comments
                        </span>
                      }
                      @if (link.writableScopes?.length) {
                        <span class="meta-badge writable-badge">
                          <span class="material-icons">edit</span> Writable
                        </span>
                      }
                      <span>{{ link.accessCount }} views</span>
                      @if (link.expiresAt) {
                        <span>Expires {{ formatDate(link.expiresAt) }}</span>
                      } @else {
                        <span>Never expires</span>
                      }
                    </div>
                  </div>
                  <div class="link-actions">
                    <button class="icon-btn" title="Copy link" (click)="copyLink(link.token)">
                      <span class="material-icons">content_copy</span>
                    </button>
                    <button class="icon-btn remove-btn" title="Revoke link" (click)="revokeLink(link.id)">
                      <span class="material-icons">delete</span>
                    </button>
                  </div>
                </div>
              }
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: var(--spacing-lg);
    }

    .share-dialog {
      background: var(--surface);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 520px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-xl);
    }

    .share-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0;
      }
    }

    .share-body {
      padding: var(--spacing-lg);
      overflow-y: auto;
      flex: 1;
    }

    .file-info {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-md);
      background: var(--background);
      border-radius: var(--radius-md);
      margin-bottom: var(--spacing-lg);
    }

    .file-icon {
      font-size: 20px;
      color: var(--primary);
    }

    .file-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .section-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: var(--spacing-sm);
    }

    .loading-icon {
      font-size: 14px;
    }

    .create-section {
      margin-bottom: var(--spacing-lg);
    }

    .create-row {
      display: flex;
      gap: var(--spacing-sm);
      align-items: center;
    }

    app-searchable-select.expiry-select {
      flex: 1;
    }

    .share-type-section {
      margin-bottom: var(--spacing-md);
    }

    .password-section {
      margin-top: var(--spacing-md);
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;

      input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
      }
    }

    .toggle-icon {
      font-size: 16px;
      color: var(--text-muted);
    }

    .password-input {
      display: block;
      width: 100%;
      margin-top: var(--spacing-xs);
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-size: 13px;
      background: var(--surface);
      color: var(--text-primary);
      box-sizing: border-box;
    }

    .links-section {
      border-top: 1px solid var(--border);
      padding-top: var(--spacing-lg);
    }

    .empty-links {
      text-align: center;
      padding: var(--spacing-lg);
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        margin-bottom: var(--spacing-xs);
      }

      p {
        font-size: 13px;
        margin: 0;
      }
    }

    .link-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) 0;

      &:not(:last-child) {
        border-bottom: 1px solid var(--border-light, var(--border));
      }
    }

    .link-info {
      flex: 1;
      min-width: 0;
    }

    .link-token {
      font-size: 13px;
      font-family: monospace;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .link-meta {
      display: flex;
      gap: var(--spacing-md);
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
      align-items: center;
      flex-wrap: wrap;
    }

    .meta-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;

      .material-icons {
        font-size: 11px;
      }
    }

    .password-badge {
      background: #fef3c7;
      color: #92400e;
    }

    .type-badge {
      background: #dbeafe;
      color: #1e40af;
    }

    .link-actions {
      display: flex;
      gap: var(--spacing-xs);
      flex-shrink: 0;
    }

    .icon-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;

      .material-icons {
        font-size: 18px;
      }

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .remove-btn:hover {
      color: var(--danger, #dc3545) !important;
    }

    .writable-section {
      margin-top: var(--spacing-md);
    }

    .scopes-hint {
      font-size: 11px;
      color: var(--text-muted);
      margin: var(--spacing-xs) 0 4px;
    }

    .scopes-input {
      display: block;
      width: 100%;
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-size: 12px;
      font-family: monospace;
      background: var(--surface);
      color: var(--text-primary);
      box-sizing: border-box;
      resize: vertical;
    }

    .writable-badge {
      background: #dcfce7;
      color: #166534;
    }

    .comment-badge {
      background: #fef3c7;
      color: #92400e;
    }

    .access-level-section {
      margin-top: 8px;
    }

    .access-level-options {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }

    .access-option {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--border, #d4e5e7);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      background: var(--surface, #fff);
    }

    .access-option input[type="radio"] { display: none; }

    .access-option .material-icons {
      font-size: 20px;
      color: var(--text-muted, #7a9a9d);
    }

    .access-option.selected {
      border-color: var(--primary, #6fb3b8);
      background: rgba(111, 179, 184, 0.06);
    }

    .access-option.selected .material-icons {
      color: var(--primary, #6fb3b8);
    }

    .access-option-text {
      display: flex;
      flex-direction: column;
    }

    .access-option-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary, #1a2e30);
    }

    .access-option-desc {
      font-size: 11px;
      color: var(--text-muted, #7a9a9d);
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;

      .material-icons {
        font-size: 16px;
      }
    }
  `]
})
export class ShareLinkDialogComponent implements OnInit {
  spaceId = input.required<string>();
  filePath = input.required<string>();
  isDirectory = input(false);
  close = output<void>();

  links = signal<SharedLink[]>([]);
  loading = signal(false);
  creating = signal(false);
  selectedExpiry: number | null = null;

  readonly expiryOptions: SelectOption[] = [
    { value: null, label: 'Never expires' },
    { value: 7, label: '7 days' },
    { value: 30, label: '30 days' },
    { value: 90, label: '90 days' }
  ];
  usePassword = false;
  sharePassword = '';
  shareAsFolder = false;
  enableWritableScopes = false;
  writableScopesText = '';
  accessLevel: 'VIEW' | 'COMMENT' = 'VIEW';

  constructor(
    private sharedLinksService: SharedLinksService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadLinks();
    if (this.isDirectory()) {
      this.shareAsFolder = true;
    }
  }

  loadLinks(): void {
    this.loading.set(true);
    this.sharedLinksService.getLinks(this.spaceId(), this.filePath()).subscribe({
      next: (links) => {
        this.links.set(links);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  activeLinks(): SharedLink[] {
    const now = new Date().toISOString();
    return this.links().filter(l => !l.revokedAt && (!l.expiresAt || l.expiresAt > now));
  }

  createLink(): void {
    this.creating.set(true);
    const writableScopes = this.enableWritableScopes
      ? this.writableScopesText.split('\n').map(s => s.trim()).filter(s => s.length > 0)
      : [];

    this.sharedLinksService.createLink(this.spaceId(), {
      filePath: this.filePath(),
      expiresInDays: this.selectedExpiry,
      password: this.usePassword ? this.sharePassword : null,
      shareType: this.shareAsFolder ? 'FOLDER' : 'FILE',
      writableScopes,
      accessLevel: this.accessLevel
    }).subscribe({
      next: (link) => {
        this.links.update(links => [link, ...links]);
        this.creating.set(false);
        this.copyLink(link.token);
        this.toastService.success('Link Created', 'Share link copied to clipboard.');
        this.usePassword = false;
        this.sharePassword = '';
        this.enableWritableScopes = false;
        this.writableScopesText = '';
      },
      error: () => {
        this.creating.set(false);
        this.toastService.error('Failed', 'Could not create share link.');
      }
    });
  }

  copyLink(token: string): void {
    const url = this.getShareUrl(token);
    navigator.clipboard.writeText(url).then(() => {
      this.toastService.success('Copied', 'Link copied to clipboard.');
    });
  }

  revokeLink(linkId: string): void {
    this.sharedLinksService.revokeLink(this.spaceId(), linkId).subscribe({
      next: () => {
        this.loadLinks();
        this.toastService.success('Revoked', 'Share link has been revoked.');
      },
      error: () => this.toastService.error('Failed', 'Could not revoke link.')
    });
  }

  getShareUrl(token: string): string {
    return `${window.location.origin}/share/${token}`;
  }

  getFileName(): string {
    return this.filePath().split('/').pop() || this.filePath();
  }

  getFileIcon(): string {
    if (this.isDirectory()) return 'folder';
    const ext = this.filePath().split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'md': return 'description';
      case 'pdf': return 'picture_as_pdf';
      case 'html': case 'htm': return 'code';
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image';
      default: return 'insert_drive_file';
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString();
  }
}
