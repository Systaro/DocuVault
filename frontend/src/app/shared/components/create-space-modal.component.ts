import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { LogoUploadComponent } from './logo-upload.component';
import { SpacesService, Space, CreateSpaceRequest, SpaceType } from '../../core/api/spaces.service';
import { GitService, GitLabProject } from '../../core/api/git.service';
import { ToastService } from '../services/toast.service';

@Component({
  selector: 'app-create-space-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, LogoUploadComponent],
  template: `
    <div class="modal-overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>Create New {{ type === 'GROUP' ? 'Group' : 'Repository' }}</h2>
          <button class="icon-btn" (click)="close.emit()">
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
                (ngModelChange)="onNameChange($event)"
                name="name"
                class="input"
                [placeholder]="type === 'GROUP' ? 'My Group' : 'My Documentation'"
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
                (ngModelChange)="slugManuallyEdited = true"
                name="slug"
                class="input"
                [placeholder]="type === 'GROUP' ? 'my-group' : 'my-docs'"
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

          @if (type === 'REPOSITORY') {
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
          }

          @if (createError()) {
            <div class="error-message">
              <span class="material-icons">error_outline</span>
              {{ createError() }}
            </div>
          }

          <div class="modal-footer">
            <button type="button" (click)="close.emit()" class="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" [disabled]="creating()" class="btn btn-primary">
              @if (creating()) {
                <span class="material-icons animate-spin">sync</span>
                Creating...
              } @else {
                <span class="material-icons">{{ type === 'GROUP' ? 'create_new_folder' : 'add' }}</span>
                Create {{ type === 'GROUP' ? 'Group' : 'Repository' }}
              }
            </button>
          </div>
        </form>
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
  `]
})
export class CreateSpaceModalComponent implements OnInit {
  @Input() type: SpaceType = 'REPOSITORY';
  @Input() parentId?: string;
  @Output() close = new EventEmitter<void>();
  @Output() created = new EventEmitter<Space>();

  creating = signal(false);
  createError = signal<string | null>(null);
  gitConnected = signal(false);
  gitlabProjects = signal<GitLabProject[]>([]);

  pendingLogoFile: File | null = null;
  slugManuallyEdited = false;

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
    private router: Router
  ) {}

  ngOnInit(): void {
    this.newSpace = {
      name: '',
      slug: '',
      description: '',
      type: this.type,
      parentId: this.parentId,
      syncEnabled: this.type === 'REPOSITORY'
    };

    if (this.type === 'REPOSITORY') {
      this.checkGitConnection();
    }
  }

  onNameChange(name: string): void {
    if (!this.slugManuallyEdited) {
      this.newSpace.slug = this.generateSlug(name);
    }
  }

  createSpace(): void {
    if (!this.newSpace.name || !this.newSpace.slug) return;

    this.creating.set(true);
    this.createError.set(null);

    this.spacesService.createSpace(this.newSpace).subscribe({
      next: (space) => {
        const finalize = () => {
          this.creating.set(false);
          this.created.emit(space);
        };

        if (this.pendingLogoFile) {
          this.spacesService.uploadLogo(space.id, this.pendingLogoFile).subscribe({
            next: () => finalize(),
            error: () => finalize()
          });
        } else {
          finalize();
        }

        if (space.gitError) {
          this.toastService.warning(
            'Space Created with Warning',
            `The space was created, but the Git repository could not be cloned: ${space.gitError}`,
            {
              duration: 0,
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

  private checkGitConnection(): void {
    this.gitService.getStatus().subscribe({
      next: (status) => {
        this.gitConnected.set(status.connected);
        if (status.connected) {
          this.gitService.getProjects().subscribe({
            next: (projects) => this.gitlabProjects.set(projects)
          });
        }
      }
    });
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
