import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LayoutComponent } from '../../shared/components/layout.component';
import { ChatSidebarComponent } from '../ai/chat-sidebar.component';
import { LogoUploadComponent } from '../../shared/components/logo-upload.component';
import { SpacesService, Space, CreateSpaceRequest } from '../../core/api/spaces.service';
import { GitService, GitLabProject } from '../../core/api/git.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/services/toast.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, LayoutComponent, ChatSidebarComponent, LogoUploadComponent],
  template: `
    <app-layout>
      <div class="dashboard-content">
        <!-- Breadcrumb -->
        <div class="breadcrumb-bar">
          <div class="breadcrumb">
            <span class="breadcrumb-item">
              <span class="material-icons">home</span>
            </span>
            <span class="material-icons breadcrumb-sep">chevron_right</span>
            <span class="breadcrumb-item active">Workspaces</span>
          </div>
        </div>

        <div class="workspace-content">
          <div class="workspace-header">
            <div>
              <h1>Documentation Spaces</h1>
              <p class="subtitle">Manage your documentation workspaces connected to Git repositories</p>
            </div>
            @if (authService.isAdmin()) {
              <button (click)="showCreateModal.set(true)" class="btn btn-primary">
                <span class="material-icons">add</span>
                New Space
              </button>
            }
          </div>

          @if (loading()) {
            <div class="loading-state">
              <span class="material-icons animate-spin">sync</span>
              <p>Loading workspaces...</p>
            </div>
          } @else if (spaces().length === 0) {
            <div class="empty-state">
              <span class="material-icons">auto_stories</span>
              <h3>No documentation spaces yet</h3>
              <p>Get started by creating your first documentation space.</p>
              @if (authService.isAdmin()) {
                <button (click)="showCreateModal.set(true)" class="btn btn-primary">
                  <span class="material-icons">add</span>
                  Create your first space
                </button>
              }
            </div>
          } @else {
            <div class="workspace-grid">
              @for (space of spaces(); track space.id) {
                <a [routerLink]="['/spaces', space.slug]" class="workspace-card">
                  <div class="workspace-card-menu" (click)="$event.preventDefault(); $event.stopPropagation()">
                    <button class="icon-btn">
                      <span class="material-icons">more_vert</span>
                    </button>
                  </div>
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
                        <span class="material-icons">{{ space.gitlabUrl ? 'cloud_sync' : 'folder' }}</span>
                        {{ space.gitlabUrl ? 'Git Repository' : 'Local' }}
                      </span>
                    </div>
                  </div>
                  <div class="workspace-card-details">
                    <div class="workspace-detail-row">
                      <span class="material-icons">article</span>
                      <span>{{ space.documentCount ?? 0 }} {{ (space.documentCount ?? 0) === 1 ? 'document' : 'documents' }}</span>
                    </div>
                    @if (space.description) {
                      <div class="workspace-detail-row">
                        <span class="material-icons">description</span>
                        <span>{{ space.description }}</span>
                      </div>
                    }
                    @if (space.gitlabUrl) {
                      <div class="workspace-detail-row">
                        <span class="material-icons">link</span>
                        <span class="path">{{ extractRepoPath(space.gitlabUrl) }}</span>
                      </div>
                      <div class="workspace-detail-row">
                        <span class="material-icons">account_tree</span>
                        <span>{{ space.branch || 'main' }} branch</span>
                      </div>
                    }
                  </div>
                  @if (space.gitError) {
                    <div class="workspace-card-error">
                      <span class="material-icons">error_outline</span>
                      <span>{{ space.gitError }}</span>
                    </div>
                  }
                  <div class="workspace-card-footer">
                    <div class="workspace-sync-status" [class.synced]="space.syncEnabled && !space.gitError" [class.error]="space.gitError" [class.pending]="!space.syncEnabled && !space.gitError">
                      @if (space.gitError) {
                        <span class="material-icons">error</span>
                        Sync error
                      } @else if (space.syncEnabled) {
                        <span class="material-icons">check_circle</span>
                        {{ space.lastSyncedAt ? 'Synced ' + formatDate(space.lastSyncedAt) : 'Sync enabled' }}
                      } @else {
                        <span class="material-icons">sync_disabled</span>
                        Sync disabled
                      }
                    </div>
                  </div>
                </a>
              }

              <!-- Add New Workspace Card -->
              @if (authService.isAdmin()) {
                <div class="add-workspace-card" (click)="showCreateModal.set(true)">
                  <span class="material-icons">add_circle_outline</span>
                  <h3>Add Workspace</h3>
                  <p>Connect a Git repository</p>
                </div>
              }
            </div>
          }
        </div>

        <!-- Floating AI Button -->
        <button class="ai-fab" title="AI Assistant" (click)="onAiFabClick()">
          <span class="material-icons">auto_awesome</span>
        </button>

        @if (showSpacePicker()) {
          <div class="space-picker-overlay" (click)="showSpacePicker.set(false)">
            <div class="space-picker" (click)="$event.stopPropagation()">
              <div class="space-picker-header">
                <h3>Select a space to chat about</h3>
                <button class="icon-btn" (click)="showSpacePicker.set(false)">
                  <span class="material-icons">close</span>
                </button>
              </div>
              <div class="space-picker-list">
                @for (space of spaces(); track space.id) {
                  <button class="space-picker-item" (click)="selectSpaceForChat(space.id)">
                    @if (space.logoUrl) {
                      <img [src]="space.logoUrl" [alt]="space.name" class="space-picker-logo" />
                    } @else {
                      <div class="space-picker-icon">{{ space.name.charAt(0).toUpperCase() }}</div>
                    }
                    <div class="space-picker-info">
                      <div class="space-picker-name">{{ space.name }}</div>
                      <div class="space-picker-desc">{{ space.documentCount ?? 0 }} documents</div>
                    </div>
                  </button>
                }
              </div>
            </div>
          </div>
        }

        @if (showChat()) {
          <app-chat-sidebar [spaceId]="selectedSpaceId()!" (close)="showChat.set(false)"></app-chat-sidebar>
        }
      </div>

      <!-- Create Space Modal -->
      @if (showCreateModal()) {
        <div class="modal-overlay" (click)="closeModal()">
          <div class="modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>Create New Space</h2>
              <button class="icon-btn" (click)="closeModal()">
                <span class="material-icons">close</span>
              </button>
            </div>

            <form (ngSubmit)="createSpace()" class="modal-body">
              <div class="form-group">
                <label class="form-label">Logo</label>
                <app-logo-upload
                  (fileSelected)="pendingLogoFile = $event"
                  (logoRemoved)="pendingLogoFile = null"
                ></app-logo-upload>
              </div>

              <div class="form-group">
                <label class="form-label">Name</label>
                <div class="input-icon">
                  <span class="material-icons">edit</span>
                  <input
                    type="text"
                    [(ngModel)]="newSpace.name"
                    name="name"
                    class="input"
                    placeholder="My Documentation"
                    required
                  />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Slug</label>
                <div class="input-icon">
                  <span class="material-icons">link</span>
                  <input
                    type="text"
                    [(ngModel)]="newSpace.slug"
                    name="slug"
                    class="input"
                    placeholder="my-docs"
                    required
                  />
                </div>
                <span class="form-hint">URL-friendly identifier (lowercase, no spaces)</span>
              </div>

              <div class="form-group">
                <label class="form-label">Description</label>
                <div class="input-icon textarea-icon">
                  <span class="material-icons">description</span>
                  <textarea
                    [(ngModel)]="newSpace.description"
                    name="description"
                    class="input"
                    rows="2"
                    placeholder="Optional description"
                  ></textarea>
                </div>
              </div>

              @if (gitConnected()) {
                <div class="form-group">
                  <label class="form-label">GitLab Project</label>
                  <div class="input-icon">
                    <span class="material-icons">cloud_sync</span>
                    <select
                      [(ngModel)]="newSpace.gitlabProjectId"
                      name="gitlabProjectId"
                      class="input"
                    >
                      <option [ngValue]="undefined">-- Select a project --</option>
                      @for (project of gitlabProjects(); track project.id) {
                        <option [ngValue]="project.id">{{ project.path }}</option>
                      }
                    </select>
                  </div>
                </div>
              } @else {
                <div class="form-group">
                  <label class="form-label">Git Repository URL</label>
                  <div class="input-icon">
                    <span class="material-icons">link</span>
                    <input
                      type="url"
                      [(ngModel)]="newSpace.gitlabUrl"
                      name="gitlabUrl"
                      class="input"
                      placeholder="https://gitlab.com/org/repo.git"
                    />
                  </div>
                </div>
              }

              <label class="checkbox-label">
                <input
                  type="checkbox"
                  [(ngModel)]="newSpace.syncEnabled"
                  name="syncEnabled"
                  class="checkbox-input"
                />
                <span class="checkbox-custom">
                  <span class="material-icons">{{ newSpace.syncEnabled ? 'check_box' : 'check_box_outline_blank' }}</span>
                </span>
                <span class="checkbox-text">Enable automatic sync</span>
              </label>

              @if (createError()) {
                <div class="error-message">
                  <span class="material-icons">error_outline</span>
                  {{ createError() }}
                </div>
              }

              <div class="modal-footer">
                <button type="button" (click)="closeModal()" class="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" [disabled]="creating()" class="btn btn-primary">
                  @if (creating()) {
                    <span class="material-icons animate-spin">sync</span>
                    Creating...
                  } @else {
                    <span class="material-icons">add</span>
                    Create Space
                  }
                </button>
              </div>
            </form>
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
    }

    .workspace-card-menu {
      position: absolute;
      top: var(--spacing-md);
      right: var(--spacing-md);
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

    .ai-fab {
      position: fixed;
      bottom: var(--spacing-xl);
      right: var(--spacing-xl);
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      border: none;
      color: white;
      cursor: pointer;
      box-shadow: var(--shadow-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--transition);

      .material-icons {
        font-size: 24px;
      }

      &:hover {
        transform: scale(1.1);
        box-shadow: var(--shadow-xl);
      }
    }

    .space-picker-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: flex-end;
      justify-content: flex-end;
      z-index: 999;
      padding: var(--spacing-xl);
      padding-bottom: 100px;
      padding-right: var(--spacing-xl);
    }

    .space-picker {
      background: var(--surface);
      border-radius: var(--radius-lg);
      width: 320px;
      max-height: 400px;
      box-shadow: var(--shadow-xl);
      overflow: hidden;
    }

    .space-picker-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--spacing-md) var(--spacing-lg);
      border-bottom: 1px solid var(--border);

      h3 {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .space-picker-list {
      overflow-y: auto;
      max-height: 320px;
      padding: var(--spacing-sm);
    }

    .space-picker-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-md);
      border: none;
      background: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      text-align: left;
      transition: background var(--transition);

      &:hover {
        background: var(--bg-hover, rgba(0,0,0,0.05));
      }
    }

    .space-picker-logo {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      object-fit: cover;
      flex-shrink: 0;
    }

    .space-picker-icon {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      flex-shrink: 0;
    }

    .space-picker-info {
      min-width: 0;
    }

    .space-picker-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .space-picker-desc {
      font-size: 12px;
      color: var(--text-muted);
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

    .form-hint {
      display: block;
      font-size: 12px;
      color: var(--text-muted);
      margin-top: var(--spacing-xs);
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

      .ai-fab {
        bottom: var(--spacing-lg);
        right: var(--spacing-lg);
      }
    }
  `]
})
export class DashboardComponent implements OnInit {
  spaces = signal<Space[]>([]);
  loading = signal(true);
  showChat = signal(false);
  showSpacePicker = signal(false);
  selectedSpaceId = signal<string | null>(null);
  showCreateModal = signal(false);
  creating = signal(false);
  createError = signal<string | null>(null);
  gitConnected = signal(false);
  gitlabProjects = signal<GitLabProject[]>([]);

  pendingLogoFile: File | null = null;

  newSpace: CreateSpaceRequest = {
    name: '',
    slug: '',
    description: '',
    syncEnabled: true
  };

  constructor(
    private spacesService: SpacesService,
    private gitService: GitService,
    private toastService: ToastService,
    private router: Router,
    public authService: AuthService
  ) {}

  ngOnInit(): void {
    this.loadSpaces();
    this.checkGitConnection();
  }

  loadSpaces(): void {
    this.loading.set(true);
    this.spacesService.getSpaces().subscribe({
      next: (spaces) => {
        this.spaces.set(spaces);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  checkGitConnection(): void {
    this.gitService.getStatus().subscribe({
      next: (status) => {
        this.gitConnected.set(status.connected);
        if (status.connected) {
          this.loadGitLabProjects();
        }
      }
    });
  }

  loadGitLabProjects(): void {
    this.gitService.getProjects().subscribe({
      next: (projects) => this.gitlabProjects.set(projects)
    });
  }

  createSpace(): void {
    if (!this.newSpace.name || !this.newSpace.slug) return;

    this.creating.set(true);
    this.createError.set(null);

    this.spacesService.createSpace(this.newSpace).subscribe({
      next: (space) => {
        const finalize = () => {
          this.creating.set(false);
          this.closeModal();
          this.loadSpaces();
        };

        if (this.pendingLogoFile) {
          this.spacesService.uploadLogo(space.id, this.pendingLogoFile).subscribe({
            next: () => finalize(),
            error: () => finalize()
          });
        } else {
          finalize();
        }

        // Check if there was a Git clone error
        if (space.gitError) {
          this.toastService.warning(
            'Space Created with Warning',
            `The space was created, but the Git repository could not be cloned: ${space.gitError}`,
            {
              duration: 0, // Don't auto-dismiss
              action: {
                label: 'Go to Settings',
                handler: () => this.router.navigate(['/admin/settings'])
              }
            }
          );
        } else if (space.gitlabUrl) {
          this.toastService.success(
            'Space Created',
            `"${space.name}" has been created and synced from Git.`
          );
        } else {
          this.toastService.success(
            'Space Created',
            `"${space.name}" has been created successfully.`
          );
        }
      },
      error: (error) => {
        this.creating.set(false);
        const message = error.error?.message || 'Failed to create space';
        this.createError.set(message);
        this.toastService.error('Failed to Create Space', message);
      }
    });
  }

  onAiFabClick(): void {
    if (this.showChat()) {
      this.showChat.set(false);
      return;
    }
    const allSpaces = this.spaces();
    if (allSpaces.length === 0) return;
    if (allSpaces.length === 1) {
      this.selectSpaceForChat(allSpaces[0].id);
      return;
    }
    this.showSpacePicker.set(true);
  }

  selectSpaceForChat(spaceId: string): void {
    this.selectedSpaceId.set(spaceId);
    this.showSpacePicker.set(false);
    this.showChat.set(true);
  }

  closeModal(): void {
    this.showCreateModal.set(false);
    this.newSpace = { name: '', slug: '', description: '', syncEnabled: true };
    this.pendingLogoFile = null;
    this.createError.set(null);
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

  extractRepoPath(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.hostname + parsed.pathname.replace(/\.git$/, '');
    } catch {
      return url;
    }
  }
}
