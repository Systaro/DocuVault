import { Component, OnInit, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, Document } from '../../core/api/documents.service';
import { GitService, GitOperationResult, UncommittedFilesResponse } from '../../core/api/git.service';
import { ToastService } from '../../shared/services/toast.service';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-space-overview',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    @if (isDragOver()) {
      <div class="drop-overlay">
        <div class="drop-overlay-inner">
          <svg class="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          <p class="text-lg font-semibold">Drop files to upload</p>
          <p class="text-sm opacity-75 mt-1">Files will be added to this space</p>
        </div>
      </div>
    }

    <div class="p-8">
      <div class="max-w-4xl mx-auto">
        <!-- Header -->
        <div class="flex justify-between items-start mb-8">
          <div>
            <h1 class="text-2xl font-bold overview-text-primary">{{ space()?.name }}</h1>
            <p class="overview-text-secondary mt-1">{{ space()?.description || 'No description' }}</p>
          </div>
          <div class="flex gap-2">
            @if (space()?.gitlabUrl) {
              <button
                (click)="syncRepository()"
                [disabled]="syncing()"
                class="btn btn-secondary"
              >
                @if (syncing()) {
                  <svg class="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Syncing...
                } @else {
                  <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                  </svg>
                  Sync from Git
                }
              </button>
            }
          </div>
        </div>

        <!-- Sync Error Alert -->
        @if (space()?.gitError) {
          <div class="sync-error-alert mb-6">
            <div class="sync-error-icon">
              <span class="material-icons">error_outline</span>
            </div>
            <div class="sync-error-content">
              <div class="sync-error-title">Sync Error</div>
              <div class="sync-error-message">{{ space()!.gitError }}</div>
            </div>
            <button (click)="syncRepository()" [disabled]="syncing()" class="btn btn-sm btn-secondary">
              Retry
            </button>
          </div>
        }

        <!-- Uncommitted Files Warning -->
        @if (uncommittedFiles().length > 0) {
          <div class="uncommitted-alert mb-6">
            <div class="uncommitted-icon">
              <span class="material-icons">warning_amber</span>
            </div>
            <div class="uncommitted-content">
              <div class="uncommitted-title">{{ uncommittedFiles().length }} uncommitted file{{ uncommittedFiles().length > 1 ? 's' : '' }}</div>
              @if (lastPushError()) {
                <div class="uncommitted-reason">{{ lastPushError() }}</div>
              }
              <div class="uncommitted-message">
                These files exist locally but haven't been pushed to Git:
                <span class="uncommitted-files">{{ uncommittedFiles().join(', ') }}</span>
              </div>
            </div>
            <button (click)="retryPush()" [disabled]="pushing()" class="btn btn-sm btn-secondary">
              @if (pushing()) {
                <svg class="animate-spin -ml-1 mr-1 h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Pushing...
              } @else {
                Retry push
              }
            </button>
          </div>
        }

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="card p-4">
            <div class="text-2xl font-bold overview-text-primary">{{ documents().length }}</div>
            <div class="text-sm overview-text-secondary">Documents</div>
          </div>
          <div class="card p-4">
            <div class="text-2xl font-bold overview-text-primary">{{ space()?.branch || 'N/A' }}</div>
            <div class="text-sm overview-text-secondary">Branch</div>
          </div>
          <div class="card p-4">
            <div class="text-2xl font-bold overview-text-primary">
              {{ space()?.lastSyncedAt ? formatDate(space()!.lastSyncedAt!) : 'Never' }}
            </div>
            <div class="text-sm overview-text-secondary">Last Synced</div>
          </div>
        </div>

        <!-- Recent Documents -->
        <div class="card">
          <div class="p-4 overview-section-header flex items-center justify-between">
            <h2 class="font-semibold overview-text-primary">Recent Documents</h2>
            <label class="upload-btn" title="Upload files">
              <input type="file" multiple (change)="onFileInputChange($event)" class="sr-only" />
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
              </svg>
              Upload
            </label>
          </div>
          @if (uploading()) {
            <div class="upload-progress-bar">
              <div class="upload-progress-fill"></div>
            </div>
          }

          @if (documents().length === 0) {
            <div class="p-8 text-center">
              <svg class="w-12 h-12 mx-auto overview-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              <p class="overview-text-secondary">No documents yet</p>
              <a
                [routerLink]="['/spaces', space()?.fullPath, 'doc']"
                class="btn btn-primary mt-4 inline-flex"
              >
                Create your first document
              </a>
            </div>
          } @else {
            <div class="overview-doc-list">
              @for (doc of documents().slice(0, 10); track doc.id) {
                <a
                  [routerLink]="['/spaces', space()?.fullPath, 'doc']"
                  [queryParams]="{ path: doc.path }"
                  class="overview-doc-item flex items-center justify-between gap-4 p-4"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <svg class="w-5 h-5 flex-shrink-0 overview-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <div class="min-w-0">
                      <div class="font-medium overview-text-primary truncate">{{ doc.title || doc.path }}</div>
                      <div class="text-sm overview-text-muted truncate">{{ doc.path }}</div>
                    </div>
                  </div>
                  @if (doc.lastSyncedAt) {
                    <div class="text-sm overview-text-muted flex-shrink-0">
                      {{ formatDate(doc.lastSyncedAt) }}
                    </div>
                  }
                </a>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .overview-text-primary {
      color: var(--text-primary);
    }

    .overview-text-secondary {
      color: var(--text-secondary);
    }

    .overview-text-muted {
      color: var(--text-muted);
    }

    .overview-section-header {
      border-bottom: 1px solid var(--border);
    }

    .overview-doc-list {
      & > * + * {
        border-top: 1px solid var(--border);
      }
    }

    .overview-doc-item {
      text-decoration: none;
      transition: background var(--transition-fast);

      &:hover {
        background: var(--background);
      }
    }

    .sync-error-alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(220, 53, 69, 0.08);
      border: 1px solid rgba(220, 53, 69, 0.2);
      border-radius: 8px;
      color: #dc3545;
    }

    .sync-error-icon .material-icons {
      font-size: 24px;
    }

    .sync-error-content {
      flex: 1;
    }

    .sync-error-title {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 2px;
    }

    .sync-error-message {
      font-size: 13px;
      opacity: 0.85;
    }

    .uncommitted-alert {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(255, 152, 0, 0.08);
      border: 1px solid rgba(255, 152, 0, 0.25);
      border-radius: 8px;
      color: #e65100;
    }

    .uncommitted-icon .material-icons {
      font-size: 24px;
    }

    .uncommitted-content {
      flex: 1;
    }

    .uncommitted-title {
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 2px;
    }

    .uncommitted-reason {
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .uncommitted-message {
      font-size: 13px;
      opacity: 0.85;
    }

    .uncommitted-files {
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 12px;
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 13px;
      white-space: nowrap;
    }

    .mb-6 {
      margin-bottom: 24px;
    }

    .drop-overlay {
      position: fixed;
      inset: 0;
      background: rgba(13, 148, 136, 0.12);
      border: 3px dashed var(--primary, #0d9488);
      border-radius: 12px;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      margin: 8px;
    }

    .drop-overlay-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      color: var(--primary, #0d9488);
      text-align: center;
    }

    .upload-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 7px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-secondary);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .upload-progress-bar {
      height: 2px;
      background: var(--border);
      overflow: hidden;
    }

    .upload-progress-fill {
      height: 100%;
      background: var(--primary, #0d9488);
      width: 100%;
      animation: progress-slide 1.2s ease-in-out infinite;
      transform-origin: left;
    }

    @keyframes progress-slide {
      0% { transform: scaleX(0) translateX(0); }
      50% { transform: scaleX(0.6) translateX(60%); }
      100% { transform: scaleX(0) translateX(200%); }
    }
  `]
})
export class SpaceOverviewComponent implements OnInit {
  space = signal<Space | null>(null);
  documents = signal<Document[]>([]);
  syncing = signal(false);
  isDragOver = signal(false);
  uploading = signal(false);
  uncommittedFiles = signal<string[]>([]);
  lastPushError = signal<string | null>(null);
  pushing = signal(false);

  private dragCounter = 0;

  @HostListener('dragenter', ['$event'])
  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    this.dragCounter++;
    if (event.dataTransfer?.types.includes('Files')) {
      this.isDragOver.set(true);
    }
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    this.dragCounter--;
    if (this.dragCounter === 0) {
      this.isDragOver.set(false);
    }
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    this.dragCounter = 0;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      this.uploadFiles(files);
    }
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private gitService: GitService,
    private toastService: ToastService,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.route.parent?.params.subscribe(params => {
      const parts: string[] = [];
      if (params['path1']) parts.push(params['path1']);
      if (params['path2']) parts.push(params['path2']);
      if (params['path3']) parts.push(params['path3']);
      const fullPath = parts.join('/');
      if (fullPath) {
        this.loadSpaceByPath(fullPath);
      }
    });
  }

  loadSpaceByPath(path: string): void {
    this.spacesService.getSpaceByPath(path).subscribe({
      next: (space) => {
        this.space.set(space);
        this.loadDocuments(space.id);
        if (space.gitlabUrl) {
          this.checkUncommitted(space.id);
        }
      }
    });
  }

  private checkUncommitted(spaceId: string): void {
    this.gitService.getUncommittedFiles(spaceId).subscribe({
      next: (response) => {
        this.uncommittedFiles.set(response.files);
        this.lastPushError.set(response.lastPushError ?? null);
      },
      error: () => {
        this.uncommittedFiles.set([]);
        this.lastPushError.set(null);
      }
    });
  }

  loadDocuments(spaceId: string): void {
    this.documentsService.getDocuments(spaceId).subscribe({
      next: (docs) => this.documents.set(docs)
    });
  }

  syncRepository(): void {
    const space = this.space();
    if (!space) return;

    this.syncing.set(true);
    this.gitService.pullChanges(space.id).subscribe({
      next: (result: GitOperationResult) => {
        this.syncing.set(false);

        if (result.success) {
          this.toastService.success(
            'Sync Complete',
            result.message || 'Successfully synced from Git repository.'
          );
          this.loadDocuments(space.id);
          this.loadSpaceByPath(space.fullPath); // Reload to clear error and update lastSyncedAt
        } else {
          this.handleSyncError(result);
        }
      },
      error: (error) => {
        this.syncing.set(false);
        this.toastService.error(
          'Sync Failed',
          'Unable to connect to the server. Please check your connection and try again.'
        );
      }
    });
  }

  retryPush(): void {
    const space = this.space();
    if (!space) return;

    const user = this.authService.user();
    if (!user) return;

    this.pushing.set(true);
    const fileCount = this.uncommittedFiles().length;
    this.gitService.pushChanges(
      space.id,
      `Sync ${fileCount} uncommitted file(s) to Git`,
      user.name,
      user.email
    ).subscribe({
      next: (result) => {
        this.pushing.set(false);
        if (result.success) {
          this.uncommittedFiles.set([]);
          this.lastPushError.set(null);
          this.toastService.success('Push Complete', 'All files have been committed and pushed to Git.');
        } else {
          this.lastPushError.set(result.userMessage || result.message || null);
          this.toastService.error('Push Failed', result.userMessage || result.message || 'Failed to push changes.');
        }
      },
      error: () => {
        this.pushing.set(false);
        this.toastService.error('Push Failed', 'Unable to connect to the server.');
      }
    });
  }

  private handleSyncError(result: GitOperationResult): void {
    const title = this.getErrorTitle(result.errorCode);
    const message = result.userMessage || result.message || 'An unexpected error occurred during sync.';

    if (result.requiresSetup && this.authService.isAdmin()) {
      // Show error with action button to go to Admin Settings
      this.toastService.error(title, message, {
        duration: 0, // Don't auto-dismiss setup errors
        action: {
          label: 'Go to Settings',
          handler: () => this.router.navigate(['/admin/settings'])
        }
      });
    } else if (result.requiresSetup) {
      // Non-admin user seeing setup error
      this.toastService.error(
        title,
        message + ' Please contact your administrator.'
      );
    } else {
      // Regular error
      this.toastService.error(title, message);
    }
  }

  private getErrorTitle(errorCode?: string): string {
    switch (errorCode) {
      case 'NOT_CONFIGURED':
        return 'Git Not Configured';
      case 'AUTH_FAILED':
      case 'TOKEN_EXPIRED':
        return 'Authentication Failed';
      case 'PERMISSION_DENIED':
        return 'Access Denied';
      case 'NETWORK_ERROR':
      case 'HOST_UNREACHABLE':
      case 'CONNECTION_TIMEOUT':
        return 'Connection Error';
      case 'REPO_NOT_FOUND':
      case 'BRANCH_NOT_FOUND':
        return 'Repository Error';
      case 'MERGE_CONFLICT':
        return 'Merge Conflict';
      case 'CLONE_FAILED':
      case 'PULL_FAILED':
        return 'Sync Failed';
      default:
        return 'Sync Error';
    }
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      this.uploadFiles(files);
    }
    input.value = '';
  }

  private uploadFiles(files: File[]): void {
    const space = this.space();
    if (!space) return;

    this.uploading.set(true);
    this.documentsService.uploadFiles(space.id, files).subscribe({
      next: (uploaded) => {
        this.uploading.set(false);
        const names = uploaded.map(f => f.name).join(', ');
        this.toastService.success(
          `${uploaded.length} file${uploaded.length > 1 ? 's' : ''} uploaded`,
          names
        );
        this.loadDocuments(space.id);
      },
      error: (error) => {
        this.uploading.set(false);
        this.toastService.error('Upload failed', error.error?.message || 'Could not upload files');
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
}
