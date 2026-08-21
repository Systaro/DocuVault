import { Component, OnInit, signal, computed, effect, ElementRef, HostListener, inject, DestroyRef, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, Document, FileNode, FileVersion } from '../../core/api/documents.service';
import { GitService, GitOperationResult, UncommittedFilesResponse, ConflictMrResponse } from '../../core/api/git.service';
import { ToastService } from '../../shared/services/toast.service';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { handleMarkdownClick } from '../../shared/utils/markdown-link-handler';
import { AuthService } from '../../core/auth/auth.service';
import { DisplayPrefsService } from '../../shared/services/display-prefs.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';
import { FileThumbComponent } from '../../shared/components/file-thumb.component';
import { spaceFileUrl, isHiddenName, getFileIcon } from '../../shared/utils/file-utils';
import { FileTreeSyncService } from '../../shared/services/file-tree-sync.service';
import { BulkUploadService, BulkUploadProgress, UploadSelection } from '../../shared/services/bulk-upload.service';
import { FileActionsService } from '../../shared/services/file-actions.service';
import { StateExportService } from '../../shared/services/state-export.service';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { ExportStateDialogComponent } from '../../shared/components/export-state-dialog.component';

/** A file shown in the folder listing — any type, optionally enriched with the
 *  markdown title + last-sync date when a Document row exists for it. */
interface FileEntry {
  path: string;
  name: string;
  title?: string;
  lastSyncedAt?: string;
}

/** One row of the folder listing — a subfolder or a file, with its last commit. */
interface ListingEntry extends FileEntry {
  isDirectory: boolean;
  commit?: FileVersion;
}

@Component({
  selector: 'app-space-overview',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink, SpaceRoutePipe, FileThumbComponent,
    ShareLinkDialogComponent, ExportStateDialogComponent
  ],
  template: `
    @if (isDragOver()) {
      <div class="drop-overlay">
        <div class="drop-overlay-inner">
          <svg class="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
          </svg>
          <p class="text-lg font-semibold">Drop files or folders to upload</p>
          <p class="text-sm opacity-75 mt-1">
            @if (currentFolder()) {
              Added to <strong>{{ prefs.prettify(currentFolder().split('/').pop() ?? '', true) }}</strong>, subfolders and all
            } @else {
              Added to this space, subfolders and all
            }
          </p>
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
                <span translate="no" class="material-icons">home</span>
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
            <!-- Hidden inputs wired to the two upload menu items. webkitdirectory
                 makes the second one pick a whole folder, subfolders included. -->
            <input #fileInput type="file" multiple class="sr-only"
                   (change)="onFileInputChange($event)" [disabled]="isInConflict()" />
            <input #folderInput type="file" multiple webkitdirectory class="sr-only"
                   (change)="onFileInputChange($event)" [disabled]="isInConflict()" />

            <div class="new-menu-wrapper" (click)="$event.stopPropagation()">
              <button
                class="btn btn-primary"
                [disabled]="isInConflict()"
                [title]="isInConflict() ? 'Editing disabled — space is in conflict' : 'Create new'"
                (click)="showNewMenu.set(!showNewMenu())"
              >
                <span translate="no" class="material-icons" style="font-size:18px;margin-right:4px;">add</span>
                New
                <span translate="no" class="material-icons" style="font-size:18px;margin-left:4px;">arrow_drop_down</span>
              </button>
              @if (showNewMenu()) {
                <div class="new-menu">
                  <button class="new-menu-item" (click)="startNewDocument(); showNewMenu.set(false)">
                    <span translate="no" class="material-icons">description</span>
                    New document
                  </button>
                  <button class="new-menu-item" (click)="fileInput.click(); showNewMenu.set(false)">
                    <span translate="no" class="material-icons">upload_file</span>
                    Upload files
                  </button>
                  <button class="new-menu-item" (click)="folderInput.click(); showNewMenu.set(false)">
                    <span translate="no" class="material-icons">drive_folder_upload</span>
                    Upload folder
                  </button>
                  <button class="new-menu-item" (click)="startNewFolder(); showNewMenu.set(false)">
                    <span translate="no" class="material-icons">create_new_folder</span>
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
              <span translate="no" class="material-icons">merge_type</span>
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
              <span translate="no" class="material-icons">error_outline</span>
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
              <span translate="no" class="material-icons">warning_amber</span>
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
          <div class="listing-toolbar">
            <div class="listing-toolbar-title">
              <span translate="no" class="material-icons">folder_open</span>
              <span>{{ heroTitle() }}</span>
              <span class="listing-count">{{ entryCountLabel() }}</span>
            </div>
            <div class="view-toggle" role="group" aria-label="Listing layout">
              <button
                type="button"
                [class.active]="prefs.viewMode() === 'list'"
                (click)="prefs.setViewMode('list')"
                title="List view"
              >
                <span translate="no" class="material-icons">view_list</span>
              </button>
              <button
                type="button"
                [class.active]="prefs.viewMode() === 'tiles'"
                (click)="prefs.setViewMode('tiles')"
                title="Tile view"
              >
                <span translate="no" class="material-icons">grid_view</span>
              </button>
            </div>
          </div>

          @if (uploading()) {
            <div class="upload-progress-bar">
              @if (uploadProgress(); as progress) {
                <div class="upload-progress-fill" [style.width.%]="progress.percent"></div>
              } @else {
                <div class="upload-progress-fill upload-progress-indeterminate"></div>
              }
            </div>
            @if (uploadProgress(); as progress) {
              <div class="upload-progress-label">
                Uploading {{ progress.totalFiles }} file{{ progress.totalFiles === 1 ? '' : 's' }}
                — {{ progress.uploadedFiles }} done, {{ progress.percent }}%
              </div>
            }
          }

          @if (!creatingFolderInline() && entries().length === 0) {
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
          } @else if (prefs.viewMode() === 'tiles') {
            <div class="tile-grid">
              @if (creatingFolderInline()) {
                <div class="tile tile-new-folder">
                  <span translate="no" class="material-icons folder-icon">folder</span>
                  <input
                    type="text"
                    [(ngModel)]="newFolderName"
                    placeholder="Folder name"
                    class="inline-folder-input"
                    [readonly]="creatingFolderBusy()"
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
                  class="tile tile-up"
                  title="Up one level"
                >
                  <span translate="no" class="material-icons">arrow_upward</span>
                  <span class="tile-name">{{ parentLabel() }}</span>
                </a>
              }
              @for (entry of entries(); track entry.path) {
                <div class="tile-wrap">
                  <a
                    class="tile"
                    [routerLink]="entry.isDirectory ? [] : (space()?.fullPath | spaceRoute:'doc')"
                    [queryParams]="{ path: entry.path }"
                    [queryParamsHandling]="entry.isDirectory ? 'merge' : ''"
                  >
                    <div class="tile-preview">
                      @if (entry.isDirectory) {
                        <span translate="no" class="material-icons folder-icon tile-folder-icon">folder</span>
                      } @else {
                        <app-file-thumb
                          [url]="spaceFileUrl(space()!.id, entry.path)"
                          [name]="entry.name"
                          [size]="160"
                        />
                      }
                    </div>
                    <div class="tile-meta">
                      @if (renamingPath() === entry.path) {
                        <input
                          class="inline-folder-input"
                          [(ngModel)]="renamingValue"
                          (click)="$event.stopPropagation(); $event.preventDefault()"
                          (keydown.enter)="submitRename(entry)"
                          (keydown.escape)="cancelRename()"
                          (blur)="cancelRename()"
                        />
                      } @else {
                        <div class="tile-name" [title]="entry.name">{{ displayName(entry) }}</div>
                        <div class="tile-sub">{{ changedAt(entry) }}</div>
                      }
                    </div>
                  </a>
                  <button class="row-menu-btn tile-menu-btn" title="Actions"
                          (click)="openRowMenu(entry, $event)">
                    <span translate="no" class="material-icons">more_vert</span>
                  </button>
                </div>
              }
            </div>
          } @else {
            <div class="overview-doc-list">
              <div class="listing-head">
                <span>Name</span>
                <span>Last change</span>
                <span>Commit</span>
                <span></span>
              </div>
              @if (creatingFolderInline()) {
                <div class="inline-new-folder flex items-center gap-3 p-4">
                  @if (creatingFolderBusy()) {
                    <svg class="animate-spin h-5 w-5 folder-spinner" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  } @else {
                    <span translate="no" class="material-icons folder-icon">folder</span>
                  }
                  <input
                    type="text"
                    [(ngModel)]="newFolderName"
                    placeholder="Folder name"
                    class="inline-folder-input"
                    [readonly]="creatingFolderBusy()"
                    (keydown.enter)="submitNewFolder()"
                    (keydown.escape)="cancelNewFolder()"
                    (blur)="submitNewFolder()"
                  />
                  @if (creatingFolderBusy()) {
                    <span class="inline-folder-status">Creating…</span>
                  }
                </div>
              }
              @if (currentFolder()) {
                <a
                  [routerLink]="[]"
                  [queryParams]="{ path: parentFolderPath() || null }"
                  queryParamsHandling="merge"
                  class="listing-row listing-up"
                  title="Up one level"
                >
                  <span class="listing-main">
                    <span translate="no" class="material-icons overview-text-muted">arrow_upward</span>
                    <span class="font-medium overview-text-secondary">{{ parentLabel() }}</span>
                  </span>
                </a>
              }
              @for (entry of entries(); track entry.path) {
                <div class="listing-row">
                  <a
                    class="listing-main"
                    [routerLink]="entry.isDirectory ? [] : (space()?.fullPath | spaceRoute:'doc')"
                    [queryParams]="{ path: entry.path }"
                    [queryParamsHandling]="entry.isDirectory ? 'merge' : ''"
                  >
                    @if (entry.isDirectory) {
                      <span translate="no" class="material-icons folder-icon">folder</span>
                    } @else {
                      <!-- The list stays scannable with a plain type icon; the
                           tile view is where content previews earn their space. -->
                      <img class="listing-icon" [src]="getFileIcon(entry.name)" alt="" />
                    }
                    @if (renamingPath() === entry.path) {
                      <input
                        class="inline-folder-input"
                        [(ngModel)]="renamingValue"
                        (click)="$event.stopPropagation(); $event.preventDefault()"
                        (keydown.enter)="submitRename(entry)"
                        (keydown.escape)="cancelRename()"
                        (blur)="cancelRename()"
                      />
                    } @else {
                      <span class="listing-name">{{ displayName(entry) }}</span>
                    }
                  </a>
                  <div class="listing-change">{{ changedAt(entry) }}</div>
                  <div class="listing-commit">
                    @if (entry.commit; as commit) {
                      <span class="commit-sha">{{ commit.shortSha }}</span>
                      <span class="commit-message" [title]="commit.message ?? ''">{{ commit.message }}</span>
                      <span class="commit-author">{{ commit.authorName }}</span>
                    }
                  </div>
                  <button class="row-menu-btn" title="Actions" (click)="openRowMenu(entry, $event)">
                    <span translate="no" class="material-icons">more_vert</span>
                  </button>
                </div>
              }
            </div>
          }
        </div>

        <!-- GitHub-style README render for the current folder -->
        @if (readmeHere(); as readme) {
          <div class="card readme-card">
            <div class="readme-card-header">
              <span translate="no" class="material-icons overview-text-muted">description</span>
              <a
                [routerLink]="space()?.fullPath | spaceRoute:'doc'"
                [queryParams]="{ path: readme.path }"
                class="readme-card-title"
              >{{ readme.name }}</a>
            </div>
            @if (readmeHtml()) {
              <div class="readme-card-body markdown-container" (click)="onReadmeClick($event)">
                <div class="markdown-readonly" [innerHTML]="readmeHtml()"></div>
              </div>
            } @else {
              <div class="p-6 flex justify-center">
                <svg class="animate-spin h-5 w-5 overview-text-muted" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Row actions. Rendered at the component root and positioned fixed, so the
         menu is never clipped by the listing card's own overflow. -->
    @if (rowMenu(); as menu) {
      <div class="row-menu-backdrop" (click)="closeRowMenu()"></div>
      <div class="row-menu" [style.left.px]="menu.x" [style.top.px]="menu.y">
        @if (menu.entry.isDirectory) {
          <button class="row-menu-item" (click)="uploadInto(menu.entry, 'files')">
            <span translate="no" class="material-icons">upload_file</span>
            Upload files
          </button>
          <button class="row-menu-item" (click)="uploadInto(menu.entry, 'folder')">
            <span translate="no" class="material-icons">drive_folder_upload</span>
            Upload folder
          </button>
        } @else {
          <button class="row-menu-item" (click)="openEntry(menu.entry)">
            <span translate="no" class="material-icons">open_in_new</span>
            Open
          </button>
        }
        <button class="row-menu-item" (click)="startRename(menu.entry)">
          <span translate="no" class="material-icons">drive_file_rename_outline</span>
          Rename
        </button>
        <button class="row-menu-item" (click)="startShare(menu.entry)">
          <span translate="no" class="material-icons">share</span>
          {{ menu.entry.isDirectory ? 'Share folder' : 'Share file' }}
        </button>
        <button class="row-menu-item" (click)="startDownload(menu.entry)">
          <span translate="no" class="material-icons">download</span>
          {{ menu.entry.isDirectory ? 'Download folder' : 'Download' }}
        </button>
        <button class="row-menu-item danger" (click)="startDelete(menu.entry)">
          <span translate="no" class="material-icons">delete</span>
          {{ menu.entry.isDirectory ? 'Delete folder' : 'Delete' }}
        </button>
      </div>
    }

    @if (deletingEntry(); as entry) {
      <div class="modal-overlay" (click)="cancelDelete()">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header"><h2>{{ entry.isDirectory ? 'Delete folder' : 'Delete file' }}</h2></div>
          <div class="modal-body">
            <p>Delete <strong>{{ entry.name }}</strong>? This removes it from the space and its Git repository.</p>
            @if (entry.isDirectory) {
              <p class="modal-warning">
                <span translate="no" class="material-icons">warning_amber</span>
                <span>
                  Everything inside is deleted with it{{ deleteFileCount() > 0 ? ' — ' + deleteFileCount() + ' file' + (deleteFileCount() === 1 ? '' : 's') + ', including any subfolders' : '' }}.
                </span>
              </p>
            }
            <p class="modal-hint">This action cannot be undone.</p>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" (click)="cancelDelete()" [disabled]="deleteBusy()">
              Cancel
            </button>
            <button type="button" class="btn btn-danger" (click)="confirmDelete()" [disabled]="deleteBusy()">
              @if (deleteBusy()) {
                <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Delete
            </button>
          </div>
        </div>
      </div>
    }

    @if (shareEntry(); as entry) {
      <app-share-link-dialog
        [spaceId]="space()!.id"
        [filePath]="entry.path"
        [isDirectory]="entry.isDirectory"
        (close)="shareEntry.set(null)"
      />
    }

    @if (exportStatePath(); as path) {
      <app-export-state-dialog
        [fileName]="path.split('/').pop() ?? path"
        (chosen)="onExportStateChosen($event)"
        (closed)="exportStatePath.set(null)"
      />
    }
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

    .readme-card {
      margin-top: 1.5rem;
    }

    .readme-card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.875rem 1.25rem;
      border-bottom: 1px solid var(--border);
    }

    .readme-card-title {
      font-weight: 600;
      font-size: 0.9375rem;
      color: var(--text-primary);

      &:hover {
        text-decoration: underline;
      }
    }

    .readme-card-body {
      padding: 1.25rem 1.5rem;
    }

    .overview-doc-list {
      & > * + * {
        border-top: 1px solid var(--border);
      }
    }

    /* --- Listing toolbar: folder label + list/tile switch --- */
    .listing-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .listing-toolbar-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-weight: 600;
      color: var(--text-primary);

      .material-icons {
        font-size: 20px;
        color: var(--primary);
      }

      span:nth-child(2) {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .listing-count {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .view-toggle {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      flex-shrink: 0;

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 30px;
        border: 0;
        background: var(--surface);
        color: var(--text-muted);
        cursor: pointer;
        transition: background var(--transition-fast), color var(--transition-fast);

        .material-icons { font-size: 18px; }

        &:hover { background: var(--background); color: var(--text-primary); }

        &.active {
          background: var(--primary);
          color: #fff;
        }
      }

      button + button {
        border-left: 1px solid var(--border);
      }
    }

    /* --- List view: a dense table of Name / Last change / Commit --- */
    .listing-head,
    .listing-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 110px minmax(0, 1.3fr) 36px;
      align-items: center;
      gap: 12px;
      padding: 0 16px;
    }

    .listing-head {
      padding-top: 10px;
      padding-bottom: 10px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-muted);
      background: var(--background);
    }

    .listing-row {
      min-height: 46px;
      transition: background var(--transition-fast);

      &:hover {
        background: var(--background);

        .row-menu-btn { opacity: 1; }
      }
    }

    .listing-up {
      text-decoration: none;
      background: rgba(0, 0, 0, 0.015);
    }

    .listing-main {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 8px 0;
      text-decoration: none;
      color: inherit;

      .folder-icon { font-size: 20px; }
    }

    .listing-icon {
      width: 22px;
      height: 22px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .listing-name {
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .listing-change {
      font-size: 13px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .listing-commit {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      font-size: 13px;
      color: var(--text-muted);
    }

    .commit-sha {
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 12px;
      color: var(--primary);
      flex-shrink: 0;
    }

    .commit-message {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .commit-author {
      flex-shrink: 0;
      opacity: 0.75;
    }

    /* Narrow viewports drop the columns that carry the least, rather than
       letting the row overflow the card. */
    @media (max-width: 900px) {
      .listing-head,
      .listing-row {
        grid-template-columns: minmax(0, 1fr) 100px 36px;
      }

      .listing-head span:nth-child(3),
      .listing-commit {
        display: none;
      }
    }

    @media (max-width: 600px) {
      .listing-head,
      .listing-row {
        grid-template-columns: minmax(0, 1fr) 36px;
      }

      .listing-head span:nth-child(2),
      .listing-change {
        display: none;
      }
    }

    .row-menu-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--transition-fast), background var(--transition-fast);

      .material-icons { font-size: 18px; }

      &:hover, &:focus-visible {
        opacity: 1;
        background: var(--border);
        color: var(--text-primary);
      }
    }

    /* --- Tile view --- */
    .tile-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      gap: 14px;
      padding: 16px;
    }

    .tile-wrap {
      position: relative;

      &:hover .row-menu-btn { opacity: 1; }
    }

    .tile {
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: 100%;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 10px);
      background: var(--surface);
      text-decoration: none;
      color: inherit;
      transition: border-color var(--transition-fast), background var(--transition-fast);

      &:hover {
        border-color: var(--primary);
        background: var(--background);
      }
    }

    .tile-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 160px;
      overflow: hidden;
      border-radius: 8px;
      background: var(--background);
    }

    .tile-folder-icon {
      font-size: 64px;
    }

    .tile-meta {
      min-width: 0;
    }

    .tile-name {
      font-weight: 500;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tile-sub {
      margin-top: 2px;
      font-size: 12px;
      color: var(--text-muted);
    }

    .tile-up,
    .tile-new-folder {
      align-items: center;
      justify-content: center;
      min-height: 120px;

      .material-icons { font-size: 32px; color: var(--text-muted); }
    }

    .tile-menu-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      background: var(--surface);
    }

    /* --- Row action menu (fixed, so the card's overflow can't clip it) --- */
    .row-menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 60;
    }

    .row-menu {
      position: fixed;
      z-index: 61;
      min-width: 190px;
      padding: 4px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 8px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
      display: flex;
      flex-direction: column;
    }

    .row-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-primary);
      font-size: 13px;
      text-align: left;
      cursor: pointer;

      .material-icons { font-size: 18px; color: var(--text-muted); }

      &:hover { background: var(--background); }

      &.danger {
        color: var(--danger, #dc2626);

        .material-icons { color: inherit; }
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

    .folder-spinner { color: var(--primary); flex-shrink: 0; }

    .inline-folder-status {
      font-size: 12px;
      color: var(--text-muted);
      flex-shrink: 0;
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
      width: 0;
      transition: width 0.15s linear;
      transform-origin: left;
    }

    /* Until the first progress event arrives there is nothing to measure. */
    .upload-progress-indeterminate {
      width: 100%;
      transition: none;
      animation: progress-slide 1.2s ease-in-out infinite;
    }

    .upload-progress-label {
      padding: 6px 16px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
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
  /** Every non-directory file path in the repo (from the git file tree). Covers
   *  non-markdown files (json/csv/images/pdf/…) that have no Document row and
   *  would otherwise be invisible in the folder listing. */
  allFiles = signal<{ path: string; name: string }[]>([]);
  syncing = signal(false);
  isDragOver = signal(false);
  uploading = signal(false);
  uploadProgress = signal<BulkUploadProgress | null>(null);
  /** Last commit per entry name in the current folder, for the listing columns. */
  folderHistory = signal<Record<string, FileVersion>>({});
  /** Open row menu with its viewport position, or null. */
  rowMenu = signal<{ entry: ListingEntry; x: number; y: number } | null>(null);
  renamingPath = signal<string | null>(null);
  renamingValue = '';
  deletingEntry = signal<ListingEntry | null>(null);
  deleteBusy = signal(false);
  shareEntry = signal<ListingEntry | null>(null);
  exportStatePath = signal<string | null>(null);
  uncommittedFiles = signal<string[]>([]);
  lastPushError = signal<string | null>(null);
  pushing = signal(false);
  openingConflictMr = signal(false);

  /** + New dropdown state — closed by default, toggled by the button. */
  showNewMenu = signal(false);
  /** Inline "new folder" input visible when the user picks New folder from the menu. */
  creatingFolderInline = signal(false);
  /** Folder-create request in flight — the row shows a spinner instead of
   *  looking idle while the server works. */
  creatingFolderBusy = signal(false);
  newFolderName = '';
  private readonly treeSync = inject(FileTreeSyncService);
  private readonly bulkUpload = inject(BulkUploadService);
  private readonly fileActions = inject(FileActionsService);
  private readonly stateExportService = inject(StateExportService);
  private readonly destroyRef = inject(DestroyRef);
  /** Folder the hidden pickers upload into — set just before one is opened. */
  private uploadTargetFolder = '';
  @ViewChild('fileInput') private filePicker?: ElementRef<HTMLInputElement>;
  @ViewChild('folderInput') private folderPicker?: ElementRef<HTMLInputElement>;

  @HostListener('document:click')
  onDocClick(): void {
    this.showNewMenu.set(false);
  }

  /** Current folder path within the space — '' means the space root.
   *  Driven by the `path` query param, so any folder URL is shareable. */
  currentFolder = signal<string>('');

  /**
   * Dot-entries are repository plumbing, so "Pretty names" hides them the same
   * way it hides extensions. Turning the toggle off shows the raw repository.
   */
  hideHidden = computed(() => this.prefs.prettyNames());

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
    return [...set]
      .filter(name => !this.hideHidden() || !isHiddenName(name))
      .sort((a, b) => a.localeCompare(b));
  });

  /** All files directly at this folder level (no further nesting) — markdown
   *  documents and every other file type (json/csv/images/pdf/…). Files come
   *  from the git tree; markdown Document rows enrich them with title + sync
   *  date. Union keyed by path so a file never appears twice. */
  filesHere = computed<FileEntry[]>(() => {
    const cur = this.currentFolder();
    const prefix = cur ? cur + '/' : '';
    const atLevel = (p: string): boolean => {
      if (cur && !p.startsWith(prefix)) return false;
      const rest = cur ? p.slice(prefix.length) : p;
      return rest.length > 0 && !rest.includes('/');
    };
    const byPath = new Map<string, FileEntry>();
    for (const f of this.allFiles()) {
      if (!atLevel(f.path)) continue;
      byPath.set(f.path, { path: f.path, name: f.name });
    }
    for (const d of this.documents()) {
      if (!atLevel(d.path)) continue;
      const existing = byPath.get(d.path);
      if (existing) {
        existing.title = d.title;
        existing.lastSyncedAt = d.lastSyncedAt;
      } else {
        byPath.set(d.path, {
          path: d.path,
          name: d.path.split('/').pop() ?? d.path,
          title: d.title,
          lastSyncedAt: d.lastSyncedAt,
        });
      }
    }
    return [...byPath.values()]
      .filter(f => !this.hideHidden() || !isHiddenName(f.name))
      .sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
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

  /** README file at the current folder level, if any — rendered GitHub-style
   *  below the file listing. */
  /** Folders first, then files — one row model for both the list and tile views. */
  entries = computed<ListingEntry[]>(() => {
    const cur = this.currentFolder();
    const history = this.folderHistory();
    const folders: ListingEntry[] = this.subfolders().map(name => ({
      name,
      path: cur ? `${cur}/${name}` : name,
      isDirectory: true,
      commit: history[name]
    }));
    const files: ListingEntry[] = this.filesHere().map(file => ({
      name: file.name,
      path: file.path,
      isDirectory: false,
      title: file.title,
      lastSyncedAt: file.lastSyncedAt,
      commit: history[file.name]
    }));
    return [...folders, ...files];
  });

  entryCountLabel = computed<string>(() => {
    const count = this.entries().length;
    return `${count} item${count === 1 ? '' : 's'}`;
  });

  /** Files that would go with the folder being deleted, counted across the whole subtree. */
  deleteFileCount = computed<number>(() => {
    const entry = this.deletingEntry();
    if (!entry?.isDirectory) return 0;
    const prefix = `${entry.path}/`;
    return this.allFiles().filter(file => file.path.startsWith(prefix)).length;
  });

  readmeHere = computed<FileEntry | null>(() =>
    this.filesHere().find(f => /^readme\.(md|markdown)$/i.test(f.name)) ?? null
  );
  readmeHtml = signal<SafeHtml | null>(null);
  /** Guards the fetch effect against re-running for an already-rendered README. */
  private renderedReadmeKey: string | null = null;

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
    // Collected synchronously — the dropped entries are gone once this returns.
    const folder = this.currentFolder();
    this.bulkUpload.collectFromDrop(event.dataTransfer)
      .then(selection => this.startUpload(selection, folder));
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private gitService: GitService,
    private toastService: ToastService,
    private authService: AuthService,
    private markdownService: MarkdownRenderService,
    private elementRef: ElementRef<HTMLElement>,
    protected prefs: DisplayPrefsService
  ) {
    // Fetch + render the folder's README whenever the folder (or space) changes.
    effect(() => {
      const space = this.space();
      const readme = this.readmeHere();
      if (!space || !readme) {
        this.renderedReadmeKey = null;
        this.readmeHtml.set(null);
        return;
      }
      const key = `${space.id}:${readme.path}`;
      if (this.renderedReadmeKey === key) return;
      this.renderedReadmeKey = key;
      this.readmeHtml.set(null);
      this.documentsService.getDocument(space.id, readme.path).subscribe({
        next: (doc) => {
          const docDir = readme.path.substring(0, readme.path.lastIndexOf('/') + 1);
          this.readmeHtml.set(this.markdownService.render(
            doc.content,
            docDir,
            `/api/spaces/${space.id}/files`,
            `/spaces/${space.fullPath}/doc`
          ));
        },
        error: () => this.readmeHtml.set(null)
      });
    }, { allowSignalWrites: true });

    // Render Mermaid / draw.io / image lightbox once the README HTML is in the DOM.
    effect(() => {
      this.readmeHtml();
      setTimeout(() => {
        this.markdownService.runMermaid(this.elementRef.nativeElement);
        this.markdownService.runDrawio(this.elementRef.nativeElement);
        this.markdownService.runImageLightbox(this.elementRef.nativeElement);
      }, 0);
    });
  }

  /** Route relative links inside the rendered README through the doc viewer. */
  onReadmeClick(event: MouseEvent): void {
    const space = this.space();
    if (!space) return;
    handleMarkdownClick(event, `/spaces/${space.fullPath}/doc/`, (filePath) => {
      this.router.navigate(spaceRoute(space.fullPath, 'doc'), { queryParams: { path: filePath } });
    });
  }

  ngOnInit(): void {
    // Keeps this pane current when the change came from the sidebar or editor.
    this.treeSync.changesFor(() => this.space()?.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(spaceId => this.loadDocuments(spaceId));

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
      const folder = (q.get('path') ?? '').replace(/^\/+|\/+$/g, '');
      this.currentFolder.set(folder);
      this.closeRowMenu();
      // Commit columns are per folder, so they follow the navigation.
      this.folderHistory.set({});
      const space = this.space();
      if (space) this.loadFolderHistory(space.id, folder);
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
    this.loadFolderHistory(spaceId, this.currentFolder());
    this.documentsService.getDocuments(spaceId).subscribe({
      next: (docs) => this.documents.set(docs)
    });
    this.documentsService.getFileTree(spaceId).subscribe({
      next: (tree) => {
        this.allFolders.set(this.collectFolderPaths(tree));
        this.allFiles.set(this.collectFiles(tree));
      },
      error: () => {
        this.allFolders.set([]);
        this.allFiles.set([]);
      }
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

  /** Flatten the git file tree into a list of every (non-directory) file. */
  private collectFiles(nodes: FileNode[]): { path: string; name: string }[] {
    const files: { path: string; name: string }[] = [];
    const walk = (list: FileNode[]): void => {
      for (const node of list) {
        if (node.isDirectory) {
          if (node.children?.length) walk(node.children);
        } else {
          // Hidden files are kept here and filtered in filesHere(), so the
          // "Pretty names" toggle takes effect without reloading the tree.
          files.push({ path: node.path, name: node.name });
        }
      }
    };
    walk(nodes);
    return files;
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
    // Enter also blurs the input, and both are wired to submit — without this
    // guard the folder gets created twice.
    if (this.creatingFolderBusy()) return;
    const space = this.space();
    const name = this.newFolderName.trim();
    if (!space || !name) {
      this.cancelNewFolder();
      return;
    }
    const cur = this.currentFolder();
    const fullPath = cur ? `${cur}/${name}` : name;
    this.creatingFolderBusy.set(true);
    this.documentsService.createFolder(space.id, fullPath).subscribe({
      next: () => {
        this.creatingFolderBusy.set(false);
        this.toastService.success('Folder created', fullPath);
        this.creatingFolderInline.set(false);
        this.newFolderName = '';
        // Navigate into the new folder so the user sees it.
        this.router.navigate(spaceRoute(space.fullPath), { queryParams: { path: fullPath } });
        this.treeSync.notify(space.id);
      },
      error: (err) => {
        this.creatingFolderBusy.set(false);
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
    const selection = this.bulkUpload.collectFromInput(input.files);
    input.value = '';
    // A row menu targets its own folder; the header menu targets the open one.
    const folder = this.uploadTargetFolder || this.currentFolder();
    this.uploadTargetFolder = '';
    this.startUpload(selection, folder);
  }

  private startUpload(selection: UploadSelection, folder = this.currentFolder()): void {
    const space = this.space();
    if (!space || !selection.items.length) return;

    this.uploading.set(true);
    this.uploadProgress.set(null);
    this.bulkUpload.uploadTo(space.id, selection, folder).subscribe({
      next: (progress) => {
        this.uploadProgress.set(progress);
        if (progress.done) this.uploading.set(false);
      },
      error: () => {
        this.uploading.set(false);
        this.uploadProgress.set(null);
      }
    });
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString();
  }

  /** Row label: the markdown title where there is one, else the prettified name. */
  displayName(entry: ListingEntry): string {
    if (entry.isDirectory) return this.prefs.prettify(entry.name, true);
    return entry.title || this.prefs.prettify(entry.name, false);
  }

  /**
   * "Last change" cell. Prefers the commit that touched the entry; falls back to
   * the document's last sync for entries Git has no commit for yet.
   */
  changedAt(entry: ListingEntry): string {
    const when = entry.commit?.committedAt ?? entry.lastSyncedAt;
    return when ? this.relativeTime(when) : '';
  }

  /** Short relative age — recent changes read better as "3h ago" than a date. */
  private relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.floor((Date.now() - then) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  private loadFolderHistory(spaceId: string, folder: string): void {
    this.documentsService.getFolderHistory(spaceId, folder).subscribe({
      next: (history) => this.folderHistory.set(history),
      error: () => this.folderHistory.set({})
    });
  }

  // --- Row actions ---

  openRowMenu(entry: ListingEntry, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    // Flip the menu above the trigger when it would run off the bottom.
    const estimatedHeight = 240;
    const openUpwards = rect.bottom + estimatedHeight > window.innerHeight;
    this.rowMenu.set({
      entry,
      x: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 200)),
      y: openUpwards ? Math.max(8, rect.top - estimatedHeight) : rect.bottom + 4
    });
  }

  closeRowMenu(): void {
    this.rowMenu.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeRowMenu();
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onViewportChanged(): void {
    // The menu is positioned against a row that just moved — close rather than drift.
    if (this.rowMenu()) this.closeRowMenu();
  }

  openEntry(entry: ListingEntry): void {
    const space = this.space();
    this.closeRowMenu();
    if (!space) return;
    this.router.navigate(spaceRoute(space.fullPath, 'doc'), { queryParams: { path: entry.path } });
  }

  uploadInto(entry: ListingEntry, kind: 'files' | 'folder'): void {
    this.closeRowMenu();
    this.uploadTargetFolder = entry.path;
    const picker = kind === 'folder' ? this.folderPicker : this.filePicker;
    picker?.nativeElement.click();
  }

  startRename(entry: ListingEntry): void {
    this.closeRowMenu();
    this.renamingValue = entry.name;
    this.renamingPath.set(entry.path);
  }

  submitRename(entry: ListingEntry): void {
    const space = this.space();
    const request = space ? this.fileActions.rename(space.id, entry, this.renamingValue) : null;
    this.cancelRename();
    request?.subscribe();
  }

  cancelRename(): void {
    this.renamingPath.set(null);
    this.renamingValue = '';
  }

  startShare(entry: ListingEntry): void {
    this.closeRowMenu();
    this.shareEntry.set(entry);
  }

  startDownload(entry: ListingEntry): void {
    const space = this.space();
    this.closeRowMenu();
    if (!space) return;

    if (entry.isDirectory) {
      this.fileActions.downloadFolder(space.id, entry);
      return;
    }
    // HTML files using the State Library get the "with or without state" chooser.
    this.stateExportService.checkFileUsesState(space.id, entry.path).subscribe({
      next: (usesState) => {
        if (usesState) {
          this.exportStatePath.set(entry.path);
        } else {
          this.stateExportService.download(space.id, entry.path, false);
        }
      },
      error: () => this.stateExportService.download(space.id, entry.path, false)
    });
  }

  onExportStateChosen(withState: boolean): void {
    const space = this.space();
    const path = this.exportStatePath();
    this.exportStatePath.set(null);
    if (!space || !path) return;
    this.stateExportService.download(space.id, path, withState);
  }

  startDelete(entry: ListingEntry): void {
    this.closeRowMenu();
    this.deletingEntry.set(entry);
  }

  cancelDelete(): void {
    // The request is in flight — closing now would only hide the outcome.
    if (this.deleteBusy()) return;
    this.deletingEntry.set(null);
  }

  confirmDelete(): void {
    const entry = this.deletingEntry();
    const space = this.space();
    if (!entry || !space) return;
    this.deleteBusy.set(true);
    this.fileActions.delete(space.id, entry).subscribe({
      next: () => {
        this.deleteBusy.set(false);
        this.deletingEntry.set(null);
      },
      error: () => {
        this.deleteBusy.set(false);
        this.deletingEntry.set(null);
      }
    });
  }

  readonly spaceFileUrl = spaceFileUrl;
  readonly getFileIcon = getFileIcon;
}
