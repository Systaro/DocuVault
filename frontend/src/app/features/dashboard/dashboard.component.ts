import { Component, HostListener, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LayoutComponent } from '../../shared/components/layout.component';
import { CreateSpaceModalComponent } from '../../shared/components/create-space-modal.component';
import { SpacesService, Space, SpaceType } from '../../core/api/spaces.service';
import { AuthService } from '../../core/auth/auth.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { ToastService } from '../../shared/services/toast.service';
import { QuickShareDialogComponent } from '../../shared/components/quick-share-dialog.component';
import { InboxService, SpaceUnsortedCount } from '../../core/api/inbox.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';
import { AskComposerComponent, AskSubmission } from '../ask/ask-composer.component';

interface BreadcrumbItem {
  id: string;
  name: string;
  slug: string;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, LayoutComponent, CreateSpaceModalComponent, QuickShareDialogComponent, SpaceRoutePipe, AskComposerComponent],
  template: `
    <app-layout>
      <div class="dashboard-content">
        <!-- Breadcrumb -->
        <div class="breadcrumb-bar">
          <div class="breadcrumb">
            <button class="breadcrumb-item" [class.active]="breadcrumbs().length === 0" (click)="navigateToRoot()">
              <span translate="no" class="material-icons">home</span>
            </button>
            <span translate="no" class="material-icons breadcrumb-sep">chevron_right</span>
            @if (breadcrumbs().length === 0) {
              <span class="breadcrumb-item active">Workspaces</span>
            } @else {
              <button class="breadcrumb-item" (click)="navigateToRoot()">Workspaces</button>
              @for (crumb of breadcrumbs(); track crumb.id; let last = $last) {
                <span translate="no" class="material-icons breadcrumb-sep">chevron_right</span>
                @if (last) {
                  <span class="breadcrumb-item active">{{ crumb.name }}</span>
                } @else {
                  <button class="breadcrumb-item" (click)="navigateToBreadcrumb(crumb)">{{ crumb.name }}</button>
                }
              }
            }
          </div>
        </div>

        <div class="workspace-content">
          @if (caps.aiChat()) {
            <section class="dashboard-ask" aria-label="Ask about your documentation">
              <app-ask-composer
                [spaces]="askSpaces()"
                placeholder="Ask a question about your documentation"
                (submitted)="ask($event)"
              />
              <a routerLink="/ask" class="dashboard-ask-history">
                <span translate="no" class="material-icons">forum</span>Your conversations
              </a>
            </section>
          }
          <div class="workspace-header">
            <div>
              @if (currentParent()) {
                <h1>{{ currentParent()!.name }}</h1>
                <p class="subtitle">{{ currentParent()!.description || 'Browse groups and repositories' }}</p>
              } @else {
                <h1>Documentation Spaces</h1>
                <p class="subtitle">Manage your documentation workspaces connected to Git repositories</p>
              }
            </div>
            @if (authService.isAdmin()) {
              <div class="header-actions">
                @if (currentParent()) {
                  <button (click)="openCreateModal('REPOSITORY')" class="btn btn-primary">
                    <span translate="no" class="material-icons">source</span>
                    New Repository
                  </button>
                  @if (currentParent()!.type === 'GROUP' && !currentParent()!.parentId) {
                    <button (click)="openCreateModal('GROUP')" class="btn btn-secondary">
                      <span translate="no" class="material-icons">folder</span>
                      New Subgroup
                    </button>
                  }
                } @else {
                  <button (click)="openCreateModal('GROUP')" class="btn btn-primary">
                    <span translate="no" class="material-icons">create_new_folder</span>
                    New Group
                  </button>
                }
              </div>
            }
          </div>

          @if (loading()) {
            <div class="loading-state">
              <span translate="no" class="material-icons animate-spin">sync</span>
              <p>Loading workspaces...</p>
            </div>
          } @else if (spaces().length === 0) {
            <div class="empty-state">
              <span translate="no" class="material-icons">auto_stories</span>
              <h3>No documentation spaces yet</h3>
              <p>Get started by creating your first documentation space.</p>
              @if (authService.isAdmin()) {
                <button (click)="showCreateModal.set(true)" class="btn btn-primary">
                  <span translate="no" class="material-icons">add</span>
                  Create your first space
                </button>
              }
            </div>
          } @else {
            <div class="workspace-grid">
              @for (space of spaces(); track space.id) {
                @if (space.type === 'GROUP') {
                  <!-- Group Card -->
                  <div class="workspace-card group-card" (click)="navigateToGroup(space)">
                    @if (authService.isAdmin()) {
                      <div class="workspace-card-menu" (click)="$event.stopPropagation()">
                        <button class="icon-btn" (click)="toggleMenu(space.id)">
                          <span translate="no" class="material-icons">more_vert</span>
                        </button>
                        @if (openMenuId() === space.id) {
                          <div class="dropdown-menu">
                            <button class="dropdown-item" (click)="openShareDialog(space)">
                              <span translate="no" class="material-icons">share</span>
                              Share
                            </button>
                            <button class="dropdown-item" (click)="goToSettings(space.fullPath)">
                              <span translate="no" class="material-icons">settings</span>
                              Settings
                            </button>
                            <button class="dropdown-item danger" (click)="confirmDelete(space)">
                              <span translate="no" class="material-icons">delete</span>
                              Delete
                            </button>
                          </div>
                        }
                      </div>
                    }
                    <div class="workspace-card-header">
                      @if (space.logoUrl) {
                        <div class="workspace-logo">
                          <img [src]="space.logoUrl" [alt]="space.name" />
                        </div>
                      } @else {
                        <div class="workspace-icon group-icon">
                          <span translate="no" class="material-icons">folder</span>
                        </div>
                      }
                      <div class="workspace-card-info">
                        <div class="workspace-card-name">{{ space.name }}</div>
                        <span class="workspace-card-type">
                          <span translate="no" class="material-icons">folder_open</span>
                          Group
                        </span>
                      </div>
                    </div>
                    <div class="workspace-card-details">
                      <div class="workspace-detail-row">
                        <span translate="no" class="material-icons">inventory_2</span>
                        <span>{{ space.childCount ?? 0 }} {{ (space.childCount ?? 0) === 1 ? 'item' : 'items' }}</span>
                      </div>
                      @if (space.description) {
                        <div class="workspace-detail-row">
                          <span translate="no" class="material-icons">description</span>
                          <span>{{ space.description }}</span>
                        </div>
                      }
                    </div>
                    <div class="workspace-card-footer">
                      <div class="workspace-type-badge group">
                        <span translate="no" class="material-icons">folder</span>
                        Group
                      </div>
                      @if (inboxCount(space) > 0) {
                        <div class="inbox-count-badge" title="Unsorted inbox notes">
                          <span translate="no" class="material-icons">move_to_inbox</span>
                          {{ inboxCount(space) }}
                        </div>
                      }
                    </div>
                  </div>
                } @else {
                  <!-- Repository Card -->
                  <a [routerLink]="space.fullPath | spaceRoute" class="workspace-card repo-card">
                    @if (authService.isAdmin()) {
                      <div class="workspace-card-menu" (click)="$event.preventDefault(); $event.stopPropagation()">
                        <button class="icon-btn" (click)="toggleMenu(space.id)">
                          <span translate="no" class="material-icons">more_vert</span>
                        </button>
                        @if (openMenuId() === space.id) {
                          <div class="dropdown-menu">
                            <button class="dropdown-item" (click)="openShareDialog(space)">
                              <span translate="no" class="material-icons">share</span>
                              Share
                            </button>
                            <button class="dropdown-item" (click)="goToSettings(space.fullPath)">
                              <span translate="no" class="material-icons">settings</span>
                              Settings
                            </button>
                            <button class="dropdown-item danger" (click)="confirmDelete(space)">
                              <span translate="no" class="material-icons">delete</span>
                              Delete
                            </button>
                          </div>
                        }
                      </div>
                    }
                    <div class="workspace-card-header">
                      @if (space.logoUrl) {
                        <div class="workspace-logo">
                          <img [src]="space.logoUrl" [alt]="space.name" />
                        </div>
                      } @else {
                        <div class="workspace-icon letter-avatar">
                          <span>{{ space.name.charAt(0).toUpperCase() }}</span>
                        </div>
                      }
                      <div class="workspace-card-info">
                        <div class="workspace-card-name">{{ space.name }}</div>
                        <span class="workspace-card-type">
                          <span translate="no" class="material-icons">{{ space.gitlabUrl ? 'cloud_sync' : 'source' }}</span>
                          {{ space.gitlabUrl ? 'Git Repository' : 'Repository' }}
                        </span>
                      </div>
                    </div>
                    <div class="workspace-card-details">
                      <div class="workspace-detail-row">
                        <span translate="no" class="material-icons">article</span>
                        <span>{{ space.documentCount ?? 0 }} {{ (space.documentCount ?? 0) === 1 ? 'document' : 'documents' }}</span>
                      </div>
                      @if (space.description) {
                        <div class="workspace-detail-row">
                          <span translate="no" class="material-icons">description</span>
                          <span>{{ space.description }}</span>
                        </div>
                      }
                      @if (space.gitlabUrl) {
                        <div class="workspace-detail-row">
                          <span translate="no" class="material-icons">link</span>
                          <span class="path">{{ extractRepoPath(space.gitlabUrl) }}</span>
                        </div>
                        <div class="workspace-detail-row">
                          <span translate="no" class="material-icons">account_tree</span>
                          <span>{{ space.branch || 'main' }} branch</span>
                        </div>
                      }
                    </div>
                    @if (space.gitError) {
                      <div class="workspace-card-error">
                        <span translate="no" class="material-icons">error_outline</span>
                        <span>{{ space.gitError }}</span>
                      </div>
                    }
                    <div class="workspace-card-footer">
                      <div class="workspace-sync-status" [class.synced]="space.syncEnabled && !space.gitError" [class.error]="space.gitError" [class.pending]="!space.syncEnabled && !space.gitError">
                        @if (space.gitError) {
                          <span translate="no" class="material-icons">error</span>
                          Sync error
                        } @else if (space.syncEnabled) {
                          <span translate="no" class="material-icons">check_circle</span>
                          @if (space.lastSyncedAt) {
                            Synced {{ formatDate(space.lastSyncedAt) }}
                            <span class="sync-details">
                              {{ formatTime(space.lastSyncedAt) }}
                              @if (space.lastSyncFilesChanged != null) {
                                · {{ space.lastSyncFilesChanged }} {{ space.lastSyncFilesChanged === 1 ? 'file' : 'files' }} changed
                              }
                            </span>
                          } @else {
                            Sync enabled
                          }
                        } @else {
                          <span translate="no" class="material-icons">sync_disabled</span>
                          Sync disabled
                        }
                      </div>
                      @if (inboxCount(space) > 0) {
                        <div class="inbox-count-badge" title="Unsorted inbox notes">
                          <span translate="no" class="material-icons">move_to_inbox</span>
                          {{ inboxCount(space) }}
                        </div>
                      }
                    </div>
                  </a>
                }
              }

              <!-- Add New Card (context-aware) -->
              @if (authService.isAdmin()) {
                @if (currentParent()) {
                  <div class="add-workspace-card" (click)="openCreateModal('REPOSITORY')">
                    <span translate="no" class="material-icons">source</span>
                    <h3>Add Repository</h3>
                    <p>Connect a Git repository</p>
                  </div>
                } @else {
                  <div class="add-workspace-card" (click)="openCreateModal('GROUP')">
                    <span translate="no" class="material-icons">create_new_folder</span>
                    <h3>Add Group</h3>
                    <p>Organize your workspaces</p>
                  </div>
                }
              }
            </div>
          }
        </div>


      </div>

      <!-- Create Space Modal -->
      @if (showCreateModal()) {
        <app-create-space-modal
          [type]="createType()"
          [parentId]="currentParent()?.id"
          (close)="closeModal()"
          (created)="onSpaceCreated($event)"
        />
      }

      <!-- Quick Share Dialog -->
      @if (showShareDialog()) {
        <app-quick-share-dialog
          [spaceId]="shareSpaceId()"
          [spaceName]="shareSpaceName()"
          (close)="showShareDialog.set(false)"
        />
      }

      <!-- Delete Confirmation Modal -->
      @if (showDeleteConfirm()) {
        <div class="modal-overlay" (click)="cancelDelete()">
          <div class="modal modal-sm" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>Delete Space</h2>
              <button class="icon-btn" (click)="cancelDelete()">
                <span translate="no" class="material-icons">close</span>
              </button>
            </div>
            <div class="modal-body">
              <p class="delete-warning">
                Are you sure you want to delete <strong>{{ spaceToDelete()?.name }}</strong>?
              </p>
              <p class="delete-hint">This will permanently delete all documents in this space. This action cannot be undone.</p>
            </div>
            <div class="modal-footer">
              <button type="button" (click)="cancelDelete()" class="btn btn-secondary">
                Cancel
              </button>
              <button type="button" (click)="deleteSpace()" [disabled]="deleting()" class="btn btn-danger">
                @if (deleting()) {
                  <span translate="no" class="material-icons animate-spin">sync</span>
                  Deleting...
                } @else {
                  <span translate="no" class="material-icons">delete</span>
                  Delete Space
                }
              </button>
            </div>
          </div>
        </div>
      }
    </app-layout>
  `,
  styles: [`
    .dashboard-content {
      position: relative;
      min-height: calc(100vh - 64px);
    }

    .breadcrumb-bar {
      padding: var(--spacing-md) var(--spacing-xl);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 13px;
      color: var(--text-muted);
    }

    .breadcrumb-item {
      display: flex;
      align-items: center;

      .material-icons {
        font-size: 16px;
      }

      &.active {
        color: var(--text-primary);
        font-weight: 500;
      }
    }

    .breadcrumb-sep {
      font-size: 16px;
      color: var(--text-muted);
    }

    .breadcrumb-item {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 13px;

      &:hover:not(.active) {
        color: var(--primary);
      }
    }

    .header-actions {
      display: flex;
      gap: var(--spacing-sm);
    }

    .workspace-content {
      padding: var(--spacing-xl);
      max-width: 1400px;
      margin: 0 auto;
    }

    .workspace-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-xl);

      h1 {
        font-size: 28px;
        font-weight: 700;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }

      .subtitle {
        color: var(--text-muted);
        font-size: 15px;
      }
    }

    .workspace-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: var(--spacing-lg);
    }

    .workspace-card {
      background: var(--surface);
      border-radius: var(--radius-lg);
      padding: var(--spacing-lg);
      border: 1px solid var(--border);
      text-decoration: none;
      color: inherit;
      position: relative;
      transition: all var(--transition);

      &:hover {
        border-color: var(--primary-light);
        box-shadow: var(--shadow);
        transform: translateY(-2px);
      }

      &.group-card {
        cursor: pointer;
        border-left: 3px solid var(--accent-400, #f0ad4e);
      }

      &.repo-card {
        border-left: 3px solid var(--primary);
      }
    }

    .workspace-icon.group-icon {
      background: linear-gradient(135deg, var(--accent-400, #f0ad4e) 0%, var(--accent-500, #ec971f) 100%);

      .material-icons {
        font-size: 24px;
        color: white;
      }
    }

    .workspace-type-badge {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 12px;
      padding: 4px 8px;
      border-radius: var(--radius-sm);

      .material-icons {
        font-size: 14px;
      }

      &.group {
        background: rgba(240, 173, 78, 0.1);
        color: var(--accent-500, #ec971f);
      }
    }

    .workspace-card-menu {
      position: absolute;
      top: var(--spacing-md);
      right: var(--spacing-md);
    }

    .inbox-count-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--primary-dark);
      background: rgba(111, 179, 184, 0.15);
      border-radius: var(--radius-sm);

      .material-icons { font-size: 14px; }
    }

    .dropdown-menu {
      position: absolute;
      top: 100%;
      right: 0;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-lg);
      min-width: 160px;
      padding: var(--spacing-xs);
      z-index: 100;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      border: none;
      background: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 14px;
      color: var(--text-primary);
      text-align: left;
      transition: background var(--transition);

      .material-icons {
        font-size: 18px;
        color: var(--text-muted);
      }

      &:hover {
        background: var(--bg-hover, rgba(0, 0, 0, 0.05));
      }

      &.danger {
        color: var(--danger, #dc3545);

        .material-icons {
          color: var(--danger, #dc3545);
        }

        &:hover {
          background: rgba(220, 53, 69, 0.1);
        }
      }
    }

    .workspace-card-header {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-md);
      margin-bottom: var(--spacing-md);
    }

    .workspace-logo {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-md);
      flex-shrink: 0;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .workspace-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      .material-icons {
        font-size: 24px;
        color: white;
      }

      &.letter-avatar {
        background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
        font-size: 20px;
        font-weight: 700;
        color: white;
      }

      &.git {
        background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      }

      &.local {
        background: linear-gradient(135deg, var(--accent-400) 0%, var(--accent-500) 100%);
      }
    }

    .workspace-card-info {
      flex: 1;
      min-width: 0;
    }

    .workspace-card-name {
      font-size: 17px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: var(--spacing-xs);
    }

    .workspace-card-type {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-muted);

      .material-icons {
        font-size: 14px;
      }
    }

    .workspace-card-details {
      margin-bottom: var(--spacing-md);
    }

    .workspace-detail-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: var(--spacing-xs);

      .material-icons {
        font-size: 16px;
        color: var(--text-muted);
      }

      .path {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .workspace-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: var(--spacing-md);
      border-top: 1px solid var(--border-light);
    }

    .workspace-sync-status {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      font-size: 12px;
      flex-wrap: wrap;

      .material-icons {
        font-size: 16px;
      }

      &.synced {
        color: var(--success);
      }

      &.pending {
        color: var(--text-muted);
      }

      &.error {
        color: var(--danger, #dc3545);
      }

      .sync-details {
        color: var(--text-muted);
        font-size: 11px;
        width: 100%;
        padding-left: 20px;
      }
    }

    .workspace-card-error {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      margin-bottom: var(--spacing-md);
      background: rgba(220, 53, 69, 0.08);
      border-radius: var(--radius-sm, 4px);
      font-size: 12px;
      color: var(--danger, #dc3545);
      line-height: 1.4;

      .material-icons {
        font-size: 16px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      span:last-child {
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
    }

    .add-workspace-card {
      background: var(--surface);
      border: 2px dashed var(--border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-xl);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      cursor: pointer;
      transition: all var(--transition);
      min-height: 220px;

      &:hover {
        border-color: var(--primary);
        background: rgba(111, 179, 184, 0.05);
      }

      .material-icons {
        font-size: 48px;
        color: var(--primary-light);
        margin-bottom: var(--spacing-md);
      }

      h3 {
        font-size: 17px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: var(--spacing-xs);
      }

      p {
        font-size: 13px;
        color: var(--text-muted);
      }
    }

    .loading-state,
    .empty-state {
      text-align: center;
      padding: var(--spacing-xxl) var(--spacing-xl);
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);

      > .material-icons {
        font-size: 64px;
        color: var(--primary-light);
        margin-bottom: var(--spacing-lg);
      }

      h3 {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: var(--spacing-sm);
      }

      p {
        color: var(--text-muted);
        margin-bottom: var(--spacing-lg);
      }
    }

    .dashboard-ask {
      margin-bottom: var(--spacing-xl);
    }

    .dashboard-ask-history {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: var(--spacing-sm);
      font-size: 13px;
      color: var(--text-secondary);
      text-decoration: none;

      .material-icons { font-size: 16px; }
      &:hover { color: var(--primary-dark); }
    }

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

    .modal {
      background: var(--surface);
      border-radius: var(--radius-lg);
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h2 {
        font-size: 20px;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .modal-body {
      padding: var(--spacing-lg);
    }

    .modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: var(--spacing-md);
      padding-top: var(--spacing-lg);
      margin-top: var(--spacing-md);
      border-top: 1px solid var(--border);
    }

    .modal-sm {
      max-width: 400px;
    }

    .delete-warning {
      font-size: 15px;
      color: var(--text-primary);
      margin-bottom: var(--spacing-sm);
    }

    .delete-hint {
      font-size: 13px;
      color: var(--text-muted);
    }

    .btn-danger {
      background: var(--danger, #dc3545);
      color: white;
      border: none;

      &:hover:not(:disabled) {
        background: #c82333;
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    }

    @media (max-width: 768px) {
      .workspace-content {
        padding: var(--spacing-md);
      }

      .workspace-header {
        flex-direction: column;
        gap: var(--spacing-md);

        .btn {
          width: 100%;
        }
      }

      .workspace-grid {
        grid-template-columns: 1fr;
      }

    }
  `]
})
export class DashboardComponent implements OnInit {
  spaces = signal<Space[]>([]);
  loading = signal(true);
  openMenuId = signal<string | null>(null);
  showDeleteConfirm = signal(false);
  spaceToDelete = signal<Space | null>(null);
  deleting = signal(false);
  /** Every space the user can reach, for the ask box; [spaces] only holds the current level. */
  askSpaces = signal<Space[]>([]);
  showCreateModal = signal(false);

  // Share dialog state
  showShareDialog = signal(false);
  shareSpaceId = signal('');
  shareSpaceName = signal('');

  // Hierarchy state
  currentParent = signal<Space | null>(null);
  breadcrumbs = signal<BreadcrumbItem[]>([]);
  createType = signal<SpaceType>('GROUP');

  /** Unsorted inbox notes per space full path — group cards sum their descendants. */
  unsortedCounts = signal<SpaceUnsortedCount[]>([]);

  constructor(
    private spacesService: SpacesService,
    private toastService: ToastService,
    private inboxService: InboxService,
    private router: Router,
    public authService: AuthService,
    protected caps: CapabilitiesService
  ) {}

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuId.set(null);
  }

  ngOnInit(): void {
    this.loadSpaces();
    if (this.caps.aiChat()) {
      this.spacesService.getSpaces().subscribe({ next: spaces => this.askSpaces.set(spaces) });
    }
    this.inboxService.getUnsortedCounts().subscribe({
      next: (counts) => this.unsortedCounts.set(counts),
      error: () => this.unsortedCounts.set([])
    });
  }

  /** Unsorted notes in this space, including everything below it for groups. */
  inboxCount(space: Space): number {
    return this.unsortedCounts()
      .filter(c => c.spaceFullPath === space.fullPath || c.spaceFullPath.startsWith(space.fullPath + '/'))
      .reduce((sum, c) => sum + c.count, 0);
  }

  loadSpaces(): void {
    this.loading.set(true);
    const parent = this.currentParent();

    const request$ = parent
      ? this.spacesService.getChildren(parent.id)
      : this.spacesService.getTopLevelSpaces();

    request$.subscribe({
      next: (spaces) => {
        this.spaces.set(spaces);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  navigateToGroup(group: Space): void {
    this.router.navigate(spaceRoute(group.fullPath));
  }

  navigateToRoot(): void {
    this.breadcrumbs.set([]);
    this.currentParent.set(null);
    this.loadSpaces();
  }

  navigateToBreadcrumb(crumb: BreadcrumbItem): void {
    const crumbs = this.breadcrumbs();
    const index = crumbs.findIndex(c => c.id === crumb.id);
    if (index >= 0) {
      this.breadcrumbs.set(crumbs.slice(0, index + 1));
      // Need to fetch the space to set as currentParent
      this.spacesService.getSpace(crumb.id).subscribe({
        next: (space) => {
          this.currentParent.set(space);
          this.loadSpaces();
        }
      });
    }
  }

  openCreateModal(type: SpaceType): void {
    this.createType.set(type);
    this.showCreateModal.set(true);
  }

  onSpaceCreated(space: Space): void {
    this.closeModal();
    this.loadSpaces();
  }

  ask(submission: AskSubmission): void {
    this.router.navigate(['/ask'], { queryParams: { space: submission.spaceId, q: submission.message } });
  }

  closeModal(): void {
    this.showCreateModal.set(false);
  }

  toggleMenu(spaceId: string): void {
    if (this.openMenuId() === spaceId) {
      this.openMenuId.set(null);
    } else {
      this.openMenuId.set(spaceId);
    }
  }

  openShareDialog(space: Space): void {
    this.openMenuId.set(null);
    this.shareSpaceId.set(space.id);
    this.shareSpaceName.set(space.name);
    this.showShareDialog.set(true);
  }

  goToSettings(slug: string): void {
    this.openMenuId.set(null);
    this.router.navigate(spaceRoute(slug, 'settings'));
  }

  confirmDelete(space: Space): void {
    this.openMenuId.set(null);
    this.spaceToDelete.set(space);
    this.showDeleteConfirm.set(true);
  }

  cancelDelete(): void {
    this.showDeleteConfirm.set(false);
    this.spaceToDelete.set(null);
  }

  deleteSpace(): void {
    const space = this.spaceToDelete();
    if (!space) return;

    this.deleting.set(true);
    this.spacesService.deleteSpace(space.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.showDeleteConfirm.set(false);
        this.spaceToDelete.set(null);
        this.loadSpaces();
        this.toastService.success('Space Deleted', `"${space.name}" has been deleted.`);
      },
      error: (error) => {
        this.deleting.set(false);
        this.toastService.error('Delete Failed', error.error?.message || 'Failed to delete space');
      }
    });
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  formatTime(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  extractRepoPath(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname.replace(/\.git$/, '');
    } catch {
      return url;
    }
  }
}
