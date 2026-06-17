import { Component, OnInit, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, Document, FileNode } from '../../core/api/documents.service';
import { GitService, GitOperationResult, UncommittedFilesResponse, ConflictMrResponse } from '../../core/api/git.service';
import { ToastService } from '../../shared/services/toast.service';
import { AuthService } from '../../core/auth/auth.service';
import { DisplayPrefsService } from '../../shared/services/display-prefs.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';

@Component({
  selector: 'app-space-overview',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SpaceRoutePipe],
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
        <!-- Header with in-context breadcrumb above the title -->
        <div class="flex justify-between items-start mb-8">
          <div class="min-w-0 flex-1">
            <nav class="hero-breadcrumb" aria-label="Folder path">
              <a routerLink="/dashboard" class="hero-crumb">
                <span class="material-icons">home</span>
              </a>
              @for (group of groupCrumbs(); track group.path) {
                <span class="hero-crumb-sep">/</span>
                <a [routerLink]="group.path | spaceRoute" class="hero-crumb">
                  {{ prefs.prettify(group.name, true) }}
                </a>
              }
              <span class="hero-crumb-sep">/</span>
              <a
                [routerLink]="[]"
                [queryParams]="{ path: null }"
                queryParamsHandling="merge"
                class="hero-crumb"
                [class.hero-crumb-active]="!currentFolder()"
              >
                {{ space()?.name }}
              </a>
              @for (segment of breadcrumbSegments(); track segment.path; let last = $last) {
                <span class="hero-crumb-sep">/</span>
                <a
                  [routerLink]="[]"
                  [queryParams]="{ path: segment.path }"
                  queryParamsHandling="merge"
                  class="hero-crumb"
                  [class.hero-crumb-active]="last"
                >
                  {{ prefs.prettify(segment.name, true) }}
                </a>
              }
            </nav>
            <h1 class="text-2xl font-bold overview-text-primary truncate">{{ heroTitle() }}</h1>
            <p class="overview-text-secondary mt-1 truncate">{{ heroSubtitle() }}</p>
          </div>
          <div class="flex gap-2 flex-shrink-0 items-center">
            <!-- Hidden file input wired to "Upload file" menu item -->
            <input #fileInput type="file" multiple class="sr-only"
                   (change)="onFileInputChange($event); fileInput.value = ''" [disabled]="isInConflict()" />

            <div class="new-menu-wrapper" (click)="$event.stopPropagation()">
              <button
                class="btn btn-primary"
                [disabled]="isInConflict()"
                [title]="isInConflict() ? 'Editing disabled — space is in conflict' : 'Create new'"
                (click)="showNewMenu.set(!showNewMenu())"
              >
                <span class="material-icons" style="font-size:18px;margin-right:4px;">add</span>
                New
                <span class="material-icons" style="font-size:18px;margin-left:4px;">arrow_drop_down</span>
              </button>
              @if (showNewMenu()) {
                <div class="new-menu">
                  <button class="new-menu-item" (click)="startNewDocument(); showNewMenu.set(false)">
                    <span class="material-icons">description</span>
                    New document
                  </button>
                  <button class="new-menu-item" (click)="fileInput.click(); showNewMenu.set(false)">
                    <span class="material-icons">upload_file</span>
                    Upload file
                  </button>
                  <button class="new-menu-item" (click)="startNewFolder(); showNewMenu.set(false)">
                    <span class="material-icons">create_new_folder</span>
                    New folder
                  </button>
                </div>
              }
            </div>
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

        <!-- In-Conflict Banner -->
        @if (space()?.syncStatus === 'IN_CONFLICT') {
          <div class="sync-error-alert mb-6">
            <div class="sync-error-icon">
              <span class="material-icons">merge_type</span>
            </div>
            <div class="sync-error-content">
              <div class="sync-error-title">Sync paused — merge conflict</div>
              <div class="sync-error-message">
                DocuVault's local changes diverged from <code>{{ space()?.branch }}</code> and could not be merged automatically.
                Editing is disabled for this space until the conflict is resolved in GitLab.
              </div>
              @if (space()?.conflictMrUrl) {
                <div class="sync-error-message mt-1">
                  Waiting for
                  <a [href]="space()!.conflictMrUrl!" target="_blank" rel="noopener">merge request</a>
                  to be merged.
                </div>
              }
            </div>
            @if (space()?.conflictMrUrl) {
              <a [href]="space()!.conflictMrUrl!" target="_blank" rel="noopener" class="btn btn-sm btn-secondary">
                View MR
              </a>
            } @else {
              <button (click)="openConflictMr()" [disabled]="openingConflictMr()" class="btn btn-sm btn-secondary">
                @if (openingConflictMr()) {
                  Opening…
                } @else {
                  Open merge request
                }
              </button>
            }
          </div>
        } @else if (space()?.gitError) {
          <!-- Sync Error Alert -->
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

        <!-- Stats: only on space root, irrelevant inside subfolders -->
        @if (!currentFolder()) {
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
        }

        <!-- Folder browser -->
        <div class="card">
          @if (uploading()) {
            <div class="upload-progress-bar">
              <div class="upload-progress-fill"></div>
            </div>
          }

          @if (!creatingFolderInline() && subfolders().length === 0 && filesHere().length === 0) {
            @if (currentFolder()) {
              <div class="p-8 text-center">
                <p class="overview-text-secondary">This folder is empty.</p>
              </div>
            } @else {
              <div class="p-8 text-center">
                <svg class="w-12 h-12 mx-auto overview-text-muted mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
                <p class="overview-text-secondary">No documents yet</p>
                <a
                  [routerLink]="space()?.fullPath | spaceRoute:'doc'"
                  class="btn btn-primary mt-4 inline-flex"
                >
                  Create your first document
                </a>
              </div>
            }
          } @else {
            <div class="overview-doc-list">
              @if (creatingFolderInline()) {
                <div class="inline-new-folder flex items-center gap-3 p-4">
                  <span class="material-icons folder-icon">folder</span>
                  <input
                    type="text"
                    [(ngModel)]="newFolderName"
                    placeholder="Folder name"
                    class="inline-folder-input"
                    (keydown.enter)="submitNewFolder()"
                    (keydown.escape)="cancelNewFolder()"
                    (blur)="submitNewFolder()"
                  />
                </div>
              }
              @if (currentFolder()) {
                <a
                  [routerLink]="[]"
                  [queryParams]="{ path: parentFolderPath() || null }"
                  queryParamsHandling="merge"
                  class="overview-doc-item folder-up flex items-center gap-3 p-4"
                  title="Up one level"
                >
                  <span class="material-icons overview-text-muted">arrow_upward</span>
                  <span class="font-medium overview-text-secondary">{{ parentLabel() }}</span>
                </a>
              }
              @if (subfolders().length > 0) {
                <div class="list-group-label">Folders</div>
              }
              @for (folder of subfolders(); track folder) {
                <a
                  [routerLink]="[]"
                  [queryParams]="{ path: currentFolder() ? currentFolder() + '/' + folder : folder }"
                  queryParamsHandling="merge"
                  class="overview-doc-item flex items-center gap-3 p-4"
                >
                  <span class="material-icons folder-icon">folder</span>
                  <span class="font-medium overview-text-primary">{{ prefs.prettify(folder, true) }}</span>
                </a>
              }
              @if (filesHere().length > 0) {
                <div class="list-group-label">Files</div>
              }
              @for (doc of filesHere(); track doc.id) {
                <a
                  [routerLink]="space()?.fullPath | spaceRoute:'doc'"
                  [queryParams]="{ path: doc.path }"
                  class="overview-doc-item flex items-center justify-between gap-4 p-4"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <span class="material-icons overview-text-muted">description</span>
                    <div class="min-w-0">
                      <div class="font-medium overview-text-primary truncate">{{ doc.title || prefs.prettify(doc.path.split('/').pop() ?? '', false) }}</div>
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

    .folder-breadcrumbs {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 0;
      font-size: 14px;
    }

    .folder-crumb {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      padding: 3px 6px;
      border-radius: 4px;
      transition: background var(--transition-fast), color var(--transition-fast);

      .material-icons { font-size: 18px; color: var(--primary); }

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .folder-crumb-active {
      color: var(--text-primary);
      font-weight: 600;
    }

    .folder-sep {
      color: var(--text-muted);
      user-select: none;
    }

    .folder-icon {
      color: var(--primary);
    }

    .list-group-label {
      padding: 14px 16px 6px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      border-top: 1px solid var(--border);

      &:first-child {
        border-top: none;
      }
    }

    .folder-up {
      background: rgba(0, 0, 0, 0.015);
    }

    /* + New dropdown */
    .new-menu-wrapper {
      position: relative;
    }

    .new-menu {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      min-width: 200px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
      z-index: 30;
      padding: 4px;
      display: flex;
      flex-direction: column;
    }

    .new-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: none;
      border: none;
      cursor: pointer;
      text-align: left;
      font-size: 13px;
      color: var(--text-primary);
      border-radius: 6px;
      font-family: var(--font-body, inherit);

      .material-icons { font-size: 18px; color: var(--text-muted); }

      &:hover {
        background: var(--background);
        .material-icons { color: var(--primary); }
      }
    }

    .inline-new-folder {
      background: rgba(111, 179, 184, 0.06);
      border-top: 1px solid var(--border);

      &:first-child { border-top: none; }

      .folder-icon {
        font-size: 18px;
        color: var(--primary);
      }
    }

    .inline-folder-input {
      flex: 1;
      background: var(--surface);
      border: 1px solid var(--primary);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 13px;
      color: var(--text-primary);
      outline: none;
      font-family: var(--font-body, inherit);
    }

    .hero-breadcrumb {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .hero-crumb {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-secondary);
      text-decoration: none;
      padding: 2px 4px;
      border-radius: 4px;
      transition: background var(--transition-fast), color var(--transition-fast);

      .material-icons { font-size: 14px; color: var(--primary); }

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }
    }

    .hero-crumb-active {
      color: var(--text-primary);
      font-weight: 600;
    }

    .hero-crumb-sep {
      color: var(--text-muted);
      user-select: none;
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
  /** All directory paths in the repo (from the git file tree) — covers empty folders
   *  that hold only a .gitkeep and therefore have no Document rows under them. */
  allFolders = signal<string[]>([]);
  syncing = signal(false);
  isDragOver = signal(false);
  uploading = signal(false);
  uncommittedFiles = signal<string[]>([]);
  lastPushError = signal<string | null>(null);
  pushing = signal(false);
  openingConflictMr = signal(false);

  /** + New dropdown state — closed by default, toggled by the button. */
  showNewMenu = signal(false);
  /** Inline "new folder" input visible when the user picks New folder from the menu. */
  creatingFolderInline = signal(false);
  newFolderName = '';

  @HostListener('document:click')
  onDocClick(): void {
    this.showNewMenu.set(false);
  }

  /** Current folder path within the space — '' means the space root.
   *  Driven by the `path` query param, so any folder URL is shareable. */
  currentFolder = signal<string>('');

  /** Direct subfolders at the current level (one segment deeper). */
  subfolders = computed<string[]>(() => {
    const cur = this.currentFolder();
    const prefix = cur ? cur + '/' : '';
    const set = new Set<string>();
    // Folders inferred from document paths.
    for (const d of this.documents()) {
      if (cur && !d.path.startsWith(prefix)) continue;
      const rest = cur ? d.path.slice(prefix.length) : d.path;
      const slash = rest.indexOf('/');
      if (slash > 0) set.add(rest.slice(0, slash));
    }
    // Folders from the git tree — includes empty folders (only a .gitkeep) that have
    // no documents underneath and would otherwise be invisible.
    for (const f of this.allFolders()) {
      if (cur && !f.startsWith(prefix)) continue;
      const rest = cur ? f.slice(prefix.length) : f;
      if (!rest) continue;
      const slash = rest.indexOf('/');
      set.add(slash > 0 ? rest.slice(0, slash) : rest);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  /** Documents directly at this folder level (no further nesting). */
  filesHere = computed<Document[]>(() => {
    const cur = this.currentFolder();
    const prefix = cur ? cur + '/' : '';
    return this.documents()
      .filter((d) => {
        if (cur && !d.path.startsWith(prefix)) return false;
        const rest = cur ? d.path.slice(prefix.length) : d.path;
        return !rest.includes('/');
      })
      .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
  });

  /** Parent group crumbs (everything in the space path above the space itself). */
  groupCrumbs = computed<{ name: string; path: string }[]>(() => {
    const sp = this.space();
    if (!sp?.fullPath) return [];
    const parts = sp.fullPath.split('/');
    // Last segment is the space slug itself — drop it; the rest are ancestor groups.
    return parts.slice(0, -1).map((name, i) => ({
      name,
      path: parts.slice(0, i + 1).join('/'),
    }));
  });

  /** Breadcrumb segments above the listing — each entry links one level deeper. */
  breadcrumbSegments = computed<{ name: string; path: string }[]>(() => {
    const cur = this.currentFolder();
    if (!cur) return [];
    const parts = cur.split('/');
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  });

  parentFolderPath = computed<string>(() => {
    const cur = this.currentFolder();
    if (!cur) return '';
    const slash = cur.lastIndexOf('/');
    return slash === -1 ? '' : cur.slice(0, slash);
  });

  /** Hero title: current folder's leaf name (prettified), or space name at root. */
  heroTitle = computed<string>(() => {
    const cur = this.currentFolder();
    if (!cur) return this.space()?.name ?? '';
    return this.prefs.prettify(cur.split('/').pop() ?? cur, true);
  });

  /** Hero subtitle: space name when browsing a subfolder, description at root. */
  heroSubtitle = computed<string>(() => {
    if (this.currentFolder()) return this.space()?.name ?? '';
    return this.space()?.description || 'No description';
  });

  /** Up-one-level label: parent folder name (prettified), falling back to the space name at root level. */
  parentLabel = computed<string>(() => {
    const parent = this.parentFolderPath();
    if (!parent) return this.space()?.name ?? 'Back';
    return this.prefs.prettify(parent.split('/').pop() ?? parent, true);
  });

  isInConflict(): boolean {
    return this.space()?.syncStatus === 'IN_CONFLICT';
  }

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
    private authService: AuthService,
    protected prefs: DisplayPrefsService
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
    // Track ?path=… so subfolder URLs are bookmarkable and route changes reflow.
    this.route.queryParamMap.subscribe((q) => {
      this.currentFolder.set((q.get('path') ?? '').replace(/^\/+|\/+$/g, ''));
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
    this.documentsService.getFileTree(spaceId).subscribe({
      next: (tree) => this.allFolders.set(this.collectFolderPaths(tree)),
      error: () => this.allFolders.set([])
    });
  }

  /** Flatten the git file tree into a list of every directory path it contains. */
  private collectFolderPaths(nodes: FileNode[]): string[] {
    const paths: string[] = [];
    const walk = (list: FileNode[]): void => {
      for (const node of list) {
        if (node.isDirectory) {
          paths.push(node.path);
          if (node.children?.length) walk(node.children);
        }
      }
    };
    walk(nodes);
    return paths;
  }

  // --- "+ New" menu actions ---

  startNewDocument(): void {
    const space = this.space();
    if (!space) return;
    const folder = this.currentFolder();
    this.router.navigate(spaceRoute(space.fullPath, 'doc'), folder ? { queryParams: { folder } } : {});
  }

  startNewFolder(): void {
    this.newFolderName = '';
    this.creatingFolderInline.set(true);
    setTimeout(() => {
      (document.querySelector('.inline-new-folder input') as HTMLInputElement | null)?.focus();
    });
  }

  submitNewFolder(): void {
    const space = this.space();
    const name = this.newFolderName.trim();
    if (!space || !name) {
      this.cancelNewFolder();
      return;
    }
    const cur = this.currentFolder();
    const fullPath = cur ? `${cur}/${name}` : name;
    this.documentsService.createFolder(space.id, fullPath).subscribe({
      next: () => {
        this.toastService.success('Folder created', fullPath);
        this.creatingFolderInline.set(false);
        this.newFolderName = '';
        // Navigate into the new folder so the user sees it.
        this.router.navigate(spaceRoute(space.fullPath), { queryParams: { path: fullPath } });
        this.loadDocuments(space.id);
      },
      error: (err) => {
        this.toastService.error('Failed', err?.error?.message ?? 'Could not create folder.');
      }
    });
  }

  cancelNewFolder(): void {
    this.creatingFolderInline.set(false);
    this.newFolderName = '';
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

  openConflictMr(): void {
    const space = this.space();
    if (!space) return;

    this.openingConflictMr.set(true);
    this.gitService.createConflictMr(space.id).subscribe({
      next: (result: ConflictMrResponse) => {
        this.openingConflictMr.set(false);
        this.toastService.success(
          result.alreadyExisted ? 'Merge request already open' : 'Merge request opened',
          `Branch ${result.branch}`
        );
        this.loadSpaceByPath(space.fullPath);
      },
      error: (error) => {
        this.openingConflictMr.set(false);
        const message = error?.error?.message || error?.error?.userMessage || 'Could not open the merge request.';
        this.toastService.error('Failed to open MR', message);
      }
    });
  }

  private handleSyncError(result: GitOperationResult): void {
    // Merge conflict is a persistent state, not a transient error — reload the space
    // so the IN_CONFLICT banner renders instead of a dismissible toast.
    if (result.errorCode === 'MERGE_CONFLICT') {
      const space = this.space();
      if (space) this.loadSpaceByPath(space.fullPath);
      return;
    }

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
