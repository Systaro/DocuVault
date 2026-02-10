import { Component, Input, OnInit, OnChanges, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { LayoutComponent } from '../../shared/components/layout.component';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, FileNode } from '../../core/api/documents.service';
import { ChatSidebarComponent } from '../ai/chat-sidebar.component';

@Component({
  selector: 'app-space',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet, LayoutComponent, ChatSidebarComponent],
  template: `
    <app-layout>
      @if (spaceSignal()) {
        <div class="space-container">
          <!-- Breadcrumb -->
          <div class="breadcrumb-bar">
            <div class="breadcrumb">
              <a routerLink="/dashboard" class="breadcrumb-item">
                <span class="material-icons">home</span>
              </a>
              @for (crumb of pathBreadcrumbs(); track crumb.path) {
                <span class="material-icons breadcrumb-sep">chevron_right</span>
                <a [routerLink]="['/spaces', crumb.path]" class="breadcrumb-item">{{ crumb.name }}</a>
              }
              <span class="material-icons breadcrumb-sep">chevron_right</span>
              <a [routerLink]="['/spaces', spaceSignal()?.fullPath]" class="breadcrumb-item" [class.active]="!currentDocPath()">
                {{ spaceSignal()?.name }}
              </a>
              @for (segment of breadcrumbSegments(); track segment.path; let last = $last) {
                <span class="material-icons breadcrumb-sep">chevron_right</span>
                @if (last) {
                  <span class="breadcrumb-item active">
                    <span class="material-icons breadcrumb-file-icon">{{ segment.isFile ? 'description' : 'folder' }}</span>
                    {{ segment.label }}
                  </span>
                } @else {
                  <span class="breadcrumb-item">
                    <span class="material-icons breadcrumb-file-icon">folder</span>
                    {{ segment.label }}
                  </span>
                }
              }
            </div>
            <div class="breadcrumb-actions">
              <div class="search-box">
                <span class="material-icons">search</span>
                <input type="text" placeholder="Search files..." />
              </div>
              <button class="btn btn-primary btn-sm" (click)="createNewDocument()">
                <span class="material-icons">add</span>
                New
              </button>
            </div>
          </div>

          <div class="browser-main">
            <!-- Sidebar -->
            <aside class="sidebar">
              <div class="sidebar-header">
                <span class="material-icons">folder_special</span>
                Project Files
              </div>

              <!-- Navigation -->
              <nav class="sidebar-nav">
                <a
                  [routerLink]="['/spaces', spaceSignal()?.fullPath]"
                  [routerLinkActiveOptions]="{ exact: true }"
                  routerLinkActive="active"
                  class="nav-item"
                >
                  <span class="material-icons">home</span>
                  Overview
                </a>
                <button
                  (click)="showChat.set(!showChat())"
                  class="nav-item"
                  [class.active]="showChat()"
                >
                  <span class="material-icons">auto_awesome</span>
                  AI Chat
                </button>
                <a
                  [routerLink]="['/spaces', spaceSignal()?.fullPath, 'settings']"
                  routerLinkActive="active"
                  class="nav-item"
                >
                  <span class="material-icons">settings</span>
                  Settings
                </a>
              </nav>

              <!-- File Tree -->
              <div class="folder-tree">
                @if (fileTree().length === 0) {
                  <div class="tree-empty">
                    <span class="material-icons">folder_off</span>
                    <p>No files yet</p>
                  </div>
                } @else {
                  <ng-container *ngTemplateOutlet="fileTreeTemplate; context: { nodes: fileTree(), level: 0 }"></ng-container>
                }
              </div>

              <!-- New Document Button -->
              <div class="sidebar-footer">
                <button (click)="createNewDocument()" class="btn btn-secondary btn-full">
                  <span class="material-icons">note_add</span>
                  New Document
                </button>
              </div>
            </aside>

            <!-- Main Content -->
            <main class="content-area">
              <router-outlet></router-outlet>
            </main>
          </div>
        </div>

        @if (showChat()) {
          <app-chat-sidebar [spaceId]="spaceSignal()!.id" (close)="showChat.set(false)"></app-chat-sidebar>
        }
      }

      <!-- File Tree Template -->
      <ng-template #fileTreeTemplate let-nodes="nodes" let-level="level">
        @for (node of nodes; track node.path) {
          <div class="tree-node">
            @if (node.isDirectory) {
              <button
                (click)="toggleFolder(node.path)"
                class="tree-item"
                [class.expanded]="expandedFolders().has(node.path)"
                [style.padding-left.px]="12 + level * 16"
              >
                <span class="material-icons expand-icon">chevron_right</span>
                <span class="material-icons folder-icon">
                  {{ expandedFolders().has(node.path) ? 'folder_open' : 'folder' }}
                </span>
                <span class="tree-name">{{ node.name }}</span>
              </button>
              @if (expandedFolders().has(node.path) && node.children) {
                <div class="tree-children">
                  <ng-container *ngTemplateOutlet="fileTreeTemplate; context: { nodes: node.children, level: level + 1 }"></ng-container>
                </div>
              }
            } @else {
              <a
                [routerLink]="['/spaces', spaceSignal()?.fullPath, 'doc']"
                [queryParams]="{ path: node.path }"
                class="tree-item file"
                [style.padding-left.px]="32 + level * 16"
              >
                <span class="material-icons file-icon">description</span>
                <span class="tree-name">{{ node.name }}</span>
              </a>
            }
          </div>
        }
      </ng-template>
    </app-layout>
  `,
  styles: [`
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: calc(100vh - 64px);
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        color: var(--primary);
        margin-bottom: var(--spacing-md);
      }
    }

    .space-container {
      height: calc(100vh - 64px);
      display: flex;
      flex-direction: column;
    }

    .breadcrumb-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
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
      color: inherit;

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

    .breadcrumb-file-icon {
      font-size: 15px;
      margin-right: 2px;
    }

    .breadcrumb-actions {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }

    .search-box {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      background: var(--background);
      border-radius: var(--radius-md);
      border: 1px solid var(--border);

      .material-icons {
        font-size: 18px;
        color: var(--text-muted);
      }

      input {
        border: none;
        background: transparent;
        outline: none;
        font-size: 13px;
        color: var(--text-primary);
        width: 180px;

        &::placeholder {
          color: var(--text-muted);
        }
      }
    }

    .btn-sm {
      padding: var(--spacing-sm) var(--spacing-md);
      font-size: 13px;
    }

    .browser-main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    .sidebar {
      width: 280px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-md) var(--spacing-lg);
      font-size: 13px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);

      .material-icons {
        font-size: 18px;
        color: var(--primary);
      }
    }

    .sidebar-nav {
      padding: var(--spacing-sm);
      border-bottom: 1px solid var(--border);
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm) var(--spacing-md);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      border-radius: var(--radius-md);
      transition: all var(--transition);
      margin-bottom: 2px;

      .material-icons {
        font-size: 20px;
      }

      &:hover {
        color: var(--text-primary);
        background: var(--background);
      }

      &.active {
        color: var(--primary);
        background: rgba(111, 179, 184, 0.1);
      }
    }

    .folder-tree {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-sm);
    }

    .tree-empty {
      text-align: center;
      padding: var(--spacing-xl);
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        margin-bottom: var(--spacing-sm);
        opacity: 0.5;
      }

      p {
        font-size: 13px;
      }
    }

    .tree-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
      width: 100%;
      padding: var(--spacing-xs) var(--spacing-sm);
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: all var(--transition);
      text-decoration: none;

      &:hover {
        background: var(--background);
        color: var(--text-primary);
      }

      &.active {
        background: rgba(111, 179, 184, 0.1);
        color: var(--primary);
      }

      .expand-icon {
        font-size: 16px;
        transition: transform var(--transition);
      }

      &.expanded .expand-icon {
        transform: rotate(90deg);
      }

      .folder-icon {
        font-size: 18px;
        color: #f9a825;
      }

      .file-icon {
        font-size: 18px;
        color: var(--text-muted);
      }

      .tree-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &.file {
        padding-left: 12px;
      }
    }

    .sidebar-footer {
      padding: var(--spacing-md);
      border-top: 1px solid var(--border);
    }

    .btn-full {
      width: 100%;
    }

    .content-area {
      flex: 1;
      overflow-y: auto;
      background: var(--background-darker);
    }

    @media (max-width: 768px) {
      .sidebar {
        display: none;
      }

      .breadcrumb-actions {
        .search-box {
          display: none;
        }
      }
    }
  `]
})
export class SpaceComponent implements OnInit, OnChanges {
  @Input() space!: Space;
  @Input() fullPath!: string;

  spaceSignal = signal<Space | null>(null);
  fileTree = signal<FileNode[]>([]);
  loading = signal(false);
  showChat = signal(false);
  expandedFolders = signal<Set<string>>(new Set());
  currentDocPath = signal<string | null>(null);
  breadcrumbSegments = signal<{ label: string; path: string; isFile: boolean }[]>([]);
  pathBreadcrumbs = signal<{ name: string; path: string }[]>([]);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService
  ) {}

  ngOnInit(): void {
    // Track current document path from child route query params
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.updateBreadcrumb();
      }
    });
    // Initial check
    this.updateBreadcrumb();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['space'] && this.space) {
      this.spaceSignal.set(this.space);
      this.loadFileTree(this.space.id);
      this.buildPathBreadcrumbs();
    }
  }

  private buildPathBreadcrumbs(): void {
    if (!this.space.parentId) {
      this.pathBreadcrumbs.set([]);
      return;
    }

    const parts = this.space.fullPath.split('/');
    const crumbs: { name: string; path: string }[] = [];
    let currentPath = '';

    // Add all parts except the last one (which is the current space)
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      crumbs.push({
        name: parts[i],
        path: currentPath
      });
    }

    this.pathBreadcrumbs.set(crumbs);
  }

  private updateBreadcrumb(): void {
    // Get query params from the current child route
    const childRoute = this.route.firstChild;
    const path = childRoute?.snapshot.queryParamMap.get('path') || null;
    this.currentDocPath.set(path);

    if (path) {
      const parts = path.split('/');
      const segments = parts.map((part, i) => ({
        label: i === parts.length - 1 ? part.replace(/\.md$/, '') : part,
        path: parts.slice(0, i + 1).join('/'),
        isFile: i === parts.length - 1
      }));
      this.breadcrumbSegments.set(segments);
    } else {
      this.breadcrumbSegments.set([]);
    }
  }

  loadFileTree(spaceId: string): void {
    this.documentsService.getFileTree(spaceId).subscribe({
      next: (tree) => this.fileTree.set(tree)
    });
  }

  toggleFolder(path: string): void {
    const expanded = new Set(this.expandedFolders());
    if (expanded.has(path)) {
      expanded.delete(path);
    } else {
      expanded.add(path);
    }
    this.expandedFolders.set(expanded);
  }

  createNewDocument(): void {
    // Will navigate to editor with empty path for new document
  }
}
