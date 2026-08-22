import { Component, Input, OnInit, OnChanges, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { LayoutComponent } from '../../shared/components/layout.component';
import { CreateSpaceModalComponent } from '../../shared/components/create-space-modal.component';
import { SpacesService, Space, SpaceType } from '../../core/api/spaces.service';
import { AuthService } from '../../core/auth/auth.service';
import { ToastService } from '../../shared/services/toast.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';

interface BreadcrumbItem {
  name: string;
  path: string;
}

@Component({
  selector: 'app-group',
  standalone: true,
  imports: [CommonModule, RouterLink, LayoutComponent, CreateSpaceModalComponent, SpaceRoutePipe],
  template: `
    <app-layout>
      <div class="group-content">
        <!-- Breadcrumb -->
        <div class="breadcrumb-bar">
          <div class="breadcrumb">
            <a routerLink="/dashboard" class="breadcrumb-item">
              <span translate="no" class="material-icons">home</span>
            </a>
            @for (crumb of breadcrumbs(); track crumb.path; let last = $last) {
              <span translate="no" class="material-icons breadcrumb-sep">chevron_right</span>
              @if (last) {
                <span class="breadcrumb-item active">{{ crumb.name }}</span>
              } @else {
                <a [routerLink]="crumb.path | spaceRoute" class="breadcrumb-item">{{ crumb.name }}</a>
              }
            }
          </div>
        </div>

        @if (loading()) {
          <div class="loading-state">
            <span translate="no" class="material-icons animate-spin">sync</span>
            <p>Loading group...</p>
          </div>
        } @else if (group()) {
          <div class="group-header">
            <div class="group-info">
              @if (group()!.logoUrl) {
                <div class="group-logo">
                  <img [src]="group()!.logoUrl" [alt]="group()!.name" />
                </div>
              } @else {
                <div class="group-icon">
                  <span translate="no" class="material-icons">folder</span>
                </div>
              }
              <div>
                <h1>{{ group()!.name }}</h1>
                <p class="subtitle">{{ group()!.description || 'Group workspace' }}</p>
              </div>
            </div>
            @if (authService.isAdmin()) {
              <div class="header-actions">
                <button (click)="openSettings()" class="btn btn-secondary">
                  <span translate="no" class="material-icons">settings</span>
                  Settings
                </button>
              </div>
            }
          </div>

          <div class="children-section">
            <div class="section-header">
              <h2>Contents</h2>
              @if (authService.isAdmin()) {
                <div class="section-actions">
                  @if (!group()!.parentId) {
                    <button class="btn btn-secondary btn-sm" (click)="createSubgroup()">
                      <span translate="no" class="material-icons">create_new_folder</span>
                      New Subgroup
                    </button>
                  }
                  <button class="btn btn-primary btn-sm" (click)="createRepository()">
                    <span translate="no" class="material-icons">source</span>
                    New Repository
                  </button>
                </div>
              }
            </div>

            @if (children().length === 0) {
              <div class="empty-state">
                <span translate="no" class="material-icons">inventory_2</span>
                <h3>No items yet</h3>
                <p>This group is empty. Add subgroups or repositories to organize your documentation.</p>
              </div>
            } @else {
              <div class="children-grid">
                @for (child of children(); track child.id) {
                  @if (child.type === 'GROUP') {
                    <a [routerLink]="child.fullPath | spaceRoute" class="child-card group-card">
                      <div class="child-icon group">
                        <span translate="no" class="material-icons">folder</span>
                      </div>
                      <div class="child-info">
                        <div class="child-name">{{ child.name }}</div>
                        <div class="child-meta">
                          <span translate="no" class="material-icons">inventory_2</span>
                          {{ child.childCount ?? 0 }} items
                        </div>
                      </div>
                      <span translate="no" class="material-icons child-arrow">chevron_right</span>
                    </a>
                  } @else {
                    <a [routerLink]="child.fullPath | spaceRoute" class="child-card repo-card">
                      @if (child.logoUrl || inheritedLogo(); as logo) {
                        <div class="child-logo">
                          <img [src]="logo" [alt]="child.name" />
                        </div>
                      } @else {
                        <div class="child-icon repo">
                          <span>{{ child.name.charAt(0).toUpperCase() }}</span>
                        </div>
                      }
                      <div class="child-info">
                        <div class="child-name">{{ child.name }}</div>
                        <div class="child-meta">
                          <span translate="no" class="material-icons">article</span>
                          {{ child.documentCount ?? 0 }} docs
                          @if (child.gitlabUrl) {
                            <span class="separator">•</span>
                            <span translate="no" class="material-icons">cloud_sync</span>
                            Git
                          }
                        </div>
                      </div>
                      <span translate="no" class="material-icons child-arrow">chevron_right</span>
                    </a>
                  }
                }
              </div>
            }
          </div>
        }

        @if (showCreateModal()) {
          <app-create-space-modal
            [type]="createType()"
            [parentId]="group()!.id"
            (close)="showCreateModal.set(false)"
            (created)="onSpaceCreated($event)"
          />
        }
      </div>
    </app-layout>
  `,
  styles: [`
    .group-content {
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
      text-decoration: none;
      color: var(--text-muted);

      .material-icons {
        font-size: 16px;
      }

      &:hover:not(.active) {
        color: var(--primary);
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

    .loading-state,
    .empty-state {
      text-align: center;
      padding: var(--spacing-xxl) var(--spacing-xl);
      background: var(--surface);
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
      margin: var(--spacing-xl);

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
      }
    }

    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: var(--spacing-xl);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }

    .group-info {
      display: flex;
      align-items: center;
      gap: var(--spacing-lg);

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

    .group-logo {
      width: 64px;
      height: 64px;
      border-radius: var(--radius-lg);
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .group-icon {
      width: 64px;
      height: 64px;
      border-radius: var(--radius-lg);
      background: linear-gradient(135deg, var(--accent-400, #f0ad4e) 0%, var(--accent-500, #ec971f) 100%);
      display: flex;
      align-items: center;
      justify-content: center;

      .material-icons {
        font-size: 32px;
        color: white;
      }
    }

    .header-actions {
      display: flex;
      gap: var(--spacing-sm);
    }

    .children-section {
      padding: var(--spacing-xl);
      max-width: 1200px;
      margin: 0 auto;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-lg);

      h2 {
        font-size: 18px;
        font-weight: 600;
        color: var(--text-primary);
      }
    }

    .section-actions {
      display: flex;
      gap: var(--spacing-sm);
    }

    .btn-sm {
      padding: var(--spacing-xs) var(--spacing-md);
      font-size: 13px;

      .material-icons {
        font-size: 16px;
      }
    }

    .children-grid {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
    }

    .child-card {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
      padding: var(--spacing-md) var(--spacing-lg);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      text-decoration: none;
      color: inherit;
      transition: all var(--transition);

      &:hover {
        border-color: var(--primary-light);
        box-shadow: var(--shadow-sm);
      }

      &.group-card {
        border-left: 3px solid var(--accent-400, #f0ad4e);
      }

      &.repo-card {
        border-left: 3px solid var(--primary);
      }
    }

    .child-icon {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      &.group {
        background: linear-gradient(135deg, var(--accent-400, #f0ad4e) 0%, var(--accent-500, #ec971f) 100%);

        .material-icons {
          font-size: 20px;
          color: white;
        }
      }

      &.repo {
        background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
        font-weight: 700;
        font-size: 16px;
        color: white;
      }
    }

    .child-logo {
      width: 40px;
      height: 40px;
      border-radius: var(--radius-md);
      overflow: hidden;
      flex-shrink: 0;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .child-info {
      flex: 1;
      min-width: 0;
    }

    .child-name {
      font-weight: 500;
      font-size: 15px;
      color: var(--text-primary);
      margin-bottom: 2px;
    }

    .child-meta {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--text-muted);

      .material-icons {
        font-size: 14px;
      }

      .separator {
        margin: 0 4px;
      }
    }

    .child-arrow {
      color: var(--text-muted);
      font-size: 20px;
    }

    @media (max-width: 768px) {
      .group-header {
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .section-header {
        flex-direction: column;
        gap: var(--spacing-md);
        align-items: stretch;
      }

      .section-actions {
        justify-content: stretch;

        .btn {
          flex: 1;
        }
      }
    }
  `]
})
export class GroupComponent implements OnInit, OnChanges {
  @Input() space!: Space;
  @Input() fullPath!: string;

  group = signal<Space | null>(null);
  children = signal<Space[]>([]);
  /** Logo shown on repo cards that have no logoUrl of their own — this
   *  group's logo, or the nearest ancestor group's. */
  inheritedLogo = signal<string | null>(null);
  breadcrumbs = signal<BreadcrumbItem[]>([]);
  loading = signal(false);
  showCreateModal = signal(false);
  createType = signal<SpaceType>('REPOSITORY');

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    public authService: AuthService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['space'] && this.space) {
      this.group.set(this.space);
      this.buildBreadcrumbs(this.space);
      this.loadChildren(this.space.id);
      this.inheritedLogo.set(this.space.logoUrl || null);
      if (!this.space.logoUrl && this.space.parentId) {
        this.resolveParentLogo(this.space.parentId);
      }
    }
  }

  /** Walks up the group chain until a logo is found (spaces don't carry their parent's logoUrl). */
  private resolveParentLogo(parentId: string): void {
    this.spacesService.getSpace(parentId).subscribe({
      next: parent => {
        if (parent.logoUrl) {
          this.inheritedLogo.set(parent.logoUrl);
        } else if (parent.parentId) {
          this.resolveParentLogo(parent.parentId);
        }
      },
      error: () => {}
    });
  }

  loadChildren(parentId: string): void {
    this.loading.set(true);
    this.spacesService.getChildren(parentId).subscribe({
      next: (children) => {
        this.children.set(children);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  buildBreadcrumbs(space: Space): void {
    const parts = space.fullPath.split('/');
    const crumbs: BreadcrumbItem[] = [];
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      crumbs.push({
        name: part === space.slug ? space.name : part,
        path: currentPath
      });
    }

    this.breadcrumbs.set(crumbs);
  }

  openSettings(): void {
    const group = this.group();
    if (group) {
      this.router.navigate(spaceRoute(group.fullPath, 'settings'));
    }
  }

  createSubgroup(): void {
    this.createType.set('GROUP');
    this.showCreateModal.set(true);
  }

  createRepository(): void {
    this.createType.set('REPOSITORY');
    this.showCreateModal.set(true);
  }

  onSpaceCreated(space: Space): void {
    this.showCreateModal.set(false);
    this.loadChildren(this.group()!.id);
  }
}
