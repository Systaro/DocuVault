import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, Document } from '../../core/api/documents.service';
import { GitService, GitOperationResult } from '../../core/api/git.service';
import { ToastService } from '../../shared/services/toast.service';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-space-overview',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="p-8">
      <div class="max-w-4xl mx-auto">
        <!-- Header -->
        <div class="flex justify-between items-start mb-8">
          <div>
            <h1 class="text-2xl font-bold text-gray-900">{{ space()?.name }}</h1>
            <p class="text-gray-600 mt-1">{{ space()?.description || 'No description' }}</p>
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

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="card p-4">
            <div class="text-2xl font-bold text-gray-900">{{ documents().length }}</div>
            <div class="text-sm text-gray-600">Documents</div>
          </div>
          <div class="card p-4">
            <div class="text-2xl font-bold text-gray-900">{{ space()?.branch || 'N/A' }}</div>
            <div class="text-sm text-gray-600">Branch</div>
          </div>
          <div class="card p-4">
            <div class="text-2xl font-bold text-gray-900">
              {{ space()?.lastSyncedAt ? formatDate(space()!.lastSyncedAt!) : 'Never' }}
            </div>
            <div class="text-sm text-gray-600">Last Synced</div>
          </div>
        </div>

        <!-- Recent Documents -->
        <div class="card">
          <div class="p-4 border-b border-gray-200">
            <h2 class="font-semibold text-gray-900">Recent Documents</h2>
          </div>
          @if (documents().length === 0) {
            <div class="p-8 text-center">
              <svg class="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              <p class="text-gray-600">No documents yet</p>
              <a
                [routerLink]="['/spaces', space()?.slug, 'doc']"
                class="btn btn-primary mt-4 inline-flex"
              >
                Create your first document
              </a>
            </div>
          } @else {
            <div class="divide-y divide-gray-200">
              @for (doc of documents().slice(0, 10); track doc.id) {
                <a
                  [routerLink]="['/spaces', space()?.slug, 'doc']"
                  [queryParams]="{ path: doc.path }"
                  class="flex items-center justify-between p-4 hover:bg-gray-50"
                >
                  <div class="flex items-center gap-3">
                    <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                    </svg>
                    <div>
                      <div class="font-medium text-gray-900">{{ doc.title || doc.path }}</div>
                      <div class="text-sm text-gray-500">{{ doc.path }}</div>
                    </div>
                  </div>
                  @if (doc.lastSyncedAt) {
                    <div class="text-sm text-gray-500">
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

    .btn-sm {
      padding: 6px 12px;
      font-size: 13px;
      white-space: nowrap;
    }

    .mb-6 {
      margin-bottom: 24px;
    }
  `]
})
export class SpaceOverviewComponent implements OnInit {
  space = signal<Space | null>(null);
  documents = signal<Document[]>([]);
  syncing = signal(false);

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
    this.route.parent?.paramMap.subscribe(params => {
      const slug = params.get('slug');
      if (slug) {
        this.loadSpace(slug);
      }
    });
  }

  loadSpace(slug: string): void {
    this.spacesService.getSpaceBySlug(slug).subscribe({
      next: (space) => {
        this.space.set(space);
        this.loadDocuments(space.id);
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
          this.loadSpace(space.slug); // Reload to clear error and update lastSyncedAt
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

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }
}
