import { Component, input, output, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedLinksService, SharedLink } from '../../core/api/shared-links.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-share-link-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="share-dialog" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="share-header">
          <h2>Share File</h2>
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

          <!-- Create section -->
          <div class="create-section">
            <div class="section-label">Generate Public Link</div>
            <div class="create-row">
              <select class="expiry-select" [(ngModel)]="selectedExpiry">
                <option [ngValue]="null">Never expires</option>
                <option [ngValue]="7">7 days</option>
                <option [ngValue]="30">30 days</option>
                <option [ngValue]="90">90 days</option>
              </select>
              <button
                class="btn btn-primary btn-sm"
                [disabled]="creating()"
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

    .expiry-select {
      padding: 6px 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-size: 13px;
      background: var(--surface);
      color: var(--text-primary);
      cursor: pointer;
      flex: 1;
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
  close = output<void>();

  links = signal<SharedLink[]>([]);
  loading = signal(false);
  creating = signal(false);
  selectedExpiry: number | null = null;

  constructor(
    private sharedLinksService: SharedLinksService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    this.loadLinks();
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
    this.sharedLinksService.createLink(this.spaceId(), {
      filePath: this.filePath(),
      expiresInDays: this.selectedExpiry
    }).subscribe({
      next: (link) => {
        this.links.update(links => [link, ...links]);
        this.creating.set(false);
        this.copyLink(link.token);
        this.toastService.success('Link Created', 'Share link copied to clipboard.');
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
