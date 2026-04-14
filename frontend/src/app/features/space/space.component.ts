import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { LayoutComponent } from '../../shared/components/layout.component';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, FileNode } from '../../core/api/documents.service';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { SharedLinksService, SharedLink } from '../../core/api/shared-links.service';
import { InboxService } from '../../core/api/inbox.service';
import { AnnotationsService } from '../../core/api/annotations.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';

@Component({
  selector: 'app-space',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet, LayoutComponent, ShareLinkDialogComponent, SpaceRoutePipe],
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
                <a [routerLink]="crumb.path | spaceRoute" class="breadcrumb-item">{{ crumb.name }}</a>
              }
              <span class="material-icons breadcrumb-sep">chevron_right</span>
              <a [routerLink]="spaceSignal()?.fullPath | spaceRoute" class="breadcrumb-item" [class.active]="!currentDocPath()">
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

          <div class="browser-main" [style.--sidebar-width]="sidebarWidth() + 'px'">
            <!-- Sidebar -->
            <aside class="sidebar" [style.width.px]="sidebarWidth()">
              <div class="sidebar-header">
                <span class="material-icons">folder_special</span>
                Project Files
                @if (sharedFilePaths().has('')) {
                  <span class="material-icons shared-indicator" title="Repository is publicly shared">lock_open</span>
                }
                <button
                  class="sidebar-action-btn"
                  title="New root folder"
                  (click)="startCreateFolder('')"
                >
                  <span class="material-icons">create_new_folder</span>
                </button>
                <button
                  class="sidebar-share-btn"
                  title="Share entire repository"
                  (click)="openShareDialog('', true)"
                >
                  <span class="material-icons">share</span>
                </button>
              </div>
              @if (creatingFolderUnder() === '') {
                <div class="tree-new-folder-row" [style.padding-left.px]="12">
                  <span class="material-icons folder-icon">folder</span>
                  <input
                    class="new-folder-input"
                    [(ngModel)]="newFolderName"
                    placeholder="Folder name"
                    (keydown.enter)="submitCreateFolder()"
                    (keydown.escape)="cancelCreateFolder()"
                    (blur)="cancelCreateFolder()"
                  />
                </div>
              }

              <!-- Navigation -->
              <nav class="sidebar-nav">
                <a
                  [routerLink]="spaceSignal()?.fullPath | spaceRoute"
                  [routerLinkActiveOptions]="{ exact: true }"
                  routerLinkActive="active"
                  class="nav-item"
                >
                  <span class="material-icons">home</span>
                  Overview
                </a>
                <a
                  [routerLink]="spaceSignal()?.fullPath | spaceRoute:'chat'"
                  routerLinkActive="active"
                  class="nav-item"
                >
                  <span class="material-icons">auto_awesome</span>
                  AI Chat
                </a>
                <a
                  [routerLink]="spaceSignal()?.fullPath | spaceRoute:'inbox'"
                  routerLinkActive="active"
                  class="nav-item"
                >
                  <span class="material-icons">move_to_inbox</span>
                  Inbox
                  @if (unsortedCount() > 0) {
                    <span class="inbox-badge">{{ unsortedCount() }}</span>
                  }
                </a>
                <a
                  [routerLink]="spaceSignal()?.fullPath | spaceRoute:'settings'"
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

            <!-- Resize Handle -->
            <div
              class="resize-handle"
              (mousedown)="onResizeStart($event)"
              (dblclick)="resetSidebarWidth()"
            ></div>

            <!-- Main Content -->
            <main class="content-area">
              @if (isResizing()) {
                <div class="resize-overlay"></div>
              }
              <router-outlet></router-outlet>
            </main>
          </div>
        </div>

        @if (shareFilePath() !== null && spaceSignal()) {
          <app-share-link-dialog
            [spaceId]="spaceSignal()!.id"
            [filePath]="shareFilePath()!"
            [isDirectory]="shareIsDirectory()"
            (close)="onShareDialogClose()"
          />
        }
      }

      <!-- File Tree Template -->
      <ng-template #fileTreeTemplate let-nodes="nodes" let-level="level">
        @for (node of nodes; track node.path) {
          <div class="tree-node">
            @if (node.isDirectory) {
              <div class="tree-folder-row">
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
                  @if (renamingPath() === node.path) {
                    <input
                      class="rename-input"
                      [(ngModel)]="renamingValue"
                      (keydown.enter)="submitRename(node); $event.stopPropagation()"
                      (keydown.escape)="cancelRename(); $event.stopPropagation()"
                      (blur)="cancelRename()"
                      (click)="$event.stopPropagation()"
                    />
                  } @else {
                    <span class="tree-name">{{ node.name }}</span>
                    @if (sharedFilePaths().has(node.path)) {
                      <span class="material-icons shared-indicator" title="Publicly shared">lock_open</span>
                    }
                  }
                </button>
                <div class="tree-row-menu" (click)="$event.stopPropagation()">
                  <button
                    class="tree-menu-btn"
                    (click)="toggleTreeMenu(node.path)"
                  >
                    <span class="material-icons">more_vert</span>
                  </button>
                  @if (openMenuPath() === node.path) {
                    <div class="tree-dropdown">
                      <button class="tree-dropdown-item" (click)="startCreateFolder(node.path); openMenuPath.set(null)">
                        <span class="material-icons">create_new_folder</span>
                        New subfolder
                      </button>
                      <button class="tree-dropdown-item" (click)="startRename(node.path, node.name); openMenuPath.set(null)">
                        <span class="material-icons">drive_file_rename_outline</span>
                        Rename
                      </button>
                      <button class="tree-dropdown-item" (click)="openShareDialog(node.path, true)">
                        <span class="material-icons">share</span>
                        Share folder
                      </button>
                    </div>
                  }
                </div>
              </div>
              @if (expandedFolders().has(node.path) && node.children) {
                <div class="tree-children">
                  @if (creatingFolderUnder() === node.path) {
                    <div class="tree-new-folder-row" [style.padding-left.px]="12 + (level + 1) * 16">
                      <span class="material-icons folder-icon">folder</span>
                      <input
                        class="new-folder-input"
                        [(ngModel)]="newFolderName"
                        placeholder="Folder name"
                        (keydown.enter)="submitCreateFolder()"
                        (keydown.escape)="cancelCreateFolder()"
                        (blur)="cancelCreateFolder()"
                      />
                    </div>
                  }
                  <ng-container *ngTemplateOutlet="fileTreeTemplate; context: { nodes: node.children, level: level + 1 }"></ng-container>
                </div>
              }
            } @else {
              <div class="tree-file-row">
                <a
                  [routerLink]="spaceSignal()?.fullPath | spaceRoute:'doc'"
                  [queryParams]="{ path: node.path }"
                  class="tree-item file"
                  [class.active]="currentDocPath() === node.path"
                  [style.padding-left.px]="40 + level * 16"
                >
                  <span class="material-icons file-icon">description</span>
                  @if (renamingPath() === node.path) {
                    <input
                      class="rename-input"
                      [(ngModel)]="renamingValue"
                      (keydown.enter)="submitRename(node); $event.stopPropagation()"
                      (keydown.escape)="cancelRename(); $event.stopPropagation()"
                      (blur)="cancelRename()"
                      (click)="$event.stopPropagation()"
                    />
                  } @else {
                    <span class="tree-name">{{ node.name }}</span>
                    @if (sharedFilePaths().has(node.path)) {
                      <span class="material-icons shared-indicator" title="Publicly shared">lock_open</span>
                    }
                    @if (annotationCounts()[node.path]) {
                      <span class="annotation-badge" [title]="annotationCounts()[node.path] + ' open comment' + (annotationCounts()[node.path] > 1 ? 's' : '')">
                        <span class="material-icons">chat_bubble</span>{{ annotationCounts()[node.path] }}
                      </span>
                    }
                  }
                </a>
                <div class="tree-row-menu" (click)="$event.stopPropagation(); $event.preventDefault()">
                  <button
                    class="tree-menu-btn"
                    (click)="toggleTreeMenu(node.path)"
                  >
                    <span class="material-icons">more_vert</span>
                  </button>
                  @if (openMenuPath() === node.path) {
                    <div class="tree-dropdown">
                      <button class="tree-dropdown-item" (click)="openFullscreenPreview(node.path); openMenuPath.set(null)">
                        <span class="material-icons">fullscreen</span>
                        Fullscreen preview
                      </button>
                      <button class="tree-dropdown-item" (click)="startRename(node.path, node.name); openMenuPath.set(null)">
                        <span class="material-icons">drive_file_rename_outline</span>
                        Rename
                      </button>
                      <button class="tree-dropdown-item" (click)="openShareDialog(node.path, false)">
                        <span class="material-icons">share</span>
                        Share file
                      </button>
                    </div>
                  }
                </div>
              </div>
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
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      min-width: 200px;
      max-width: 500px;
    }

    .resize-handle {
      width: 4px;
      cursor: col-resize;
      flex-shrink: 0;
      position: relative;
      z-index: 10;
      transition: background var(--transition);

      &:hover,
      &.resizing {
        background: var(--primary);
      }
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

    .sidebar-action-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity var(--transition), color var(--transition);

      .material-icons { font-size: 18px; }
      &:hover { color: var(--primary); }
    }

    .sidebar-header:hover .sidebar-action-btn { opacity: 1; }

    .sidebar-share-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      opacity: 0;
      transition: opacity var(--transition), color var(--transition);

      .material-icons {
        font-size: 16px;
        color: var(--text-muted);
      }

      &:hover .material-icons {
        color: var(--primary);
      }
    }

    .sidebar-header:hover .sidebar-share-btn {
      opacity: 1;
    }

    .sidebar-header:hover .shared-indicator {
      display: none;
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

    .inbox-badge {
      margin-left: auto;
      background: var(--primary);
      color: white;
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.6;
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
        background: #65aaaf36;
        color: #4a9097;
        font-weight: 500;

        .file-icon {
          color: #4a9097;
        }
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

    .tree-row-menu {
      position: relative;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity var(--transition);
    }

    .tree-menu-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      border-radius: var(--radius-sm);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      transition: color var(--transition);

      .material-icons { font-size: 18px; }
      &:hover { color: var(--primary); }
    }

    .tree-dropdown {
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

    .tree-dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      width: 100%;
      padding: var(--spacing-xs) var(--spacing-sm);
      border: none;
      background: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: 13px;
      color: var(--text-primary);
      text-align: left;
      white-space: nowrap;
      transition: background var(--transition);

      .material-icons {
        font-size: 16px;
        color: var(--text-muted);
      }

      &:hover {
        background: var(--bg-hover, rgba(0, 0, 0, 0.05));
      }
    }

    .rename-input {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      background: var(--surface);
      border: 1px solid var(--primary);
      border-radius: 4px;
      padding: 1px 4px;
      color: var(--text-primary);
      outline: none;
    }

    .tree-new-folder-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px;

      .folder-icon { font-size: 16px; color: var(--text-muted); }

      .new-folder-input {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        background: var(--surface);
        border: 1px solid var(--primary);
        border-radius: 4px;
        padding: 1px 4px;
        color: var(--text-primary);
        outline: none;
      }
    }

    .tree-folder-row {
      position: relative;
      display: flex;
      align-items: center;

      .tree-item {
        flex: 1;
        min-width: 0;
      }

      &:hover .tree-row-menu {
        opacity: 1;
      }

      &:hover .shared-indicator {
        display: none;
      }
    }

    .tree-file-row {
      position: relative;
      display: flex;
      align-items: center;

      .tree-item {
        flex: 1;
        min-width: 0;
      }

      &:hover .tree-row-menu {
        opacity: 1;
      }

      &:hover .shared-indicator {
        display: none;
      }
    }

    .shared-indicator {
      font-size: 14px;
      color: var(--primary);
      flex-shrink: 0;
      margin-left: auto;
    }

    .annotation-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px;
      border-radius: 10px;
      background: #f59e0b;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
      margin-left: 4px;
      line-height: 1;

      .material-icons {
        font-size: 12px;
        color: #fff;
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
      position: relative;
    }

    .resize-overlay {
      position: absolute;
      inset: 0;
      z-index: 1000;
      cursor: col-resize;
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
export class SpaceComponent implements OnInit, OnChanges, OnDestroy {
  private static readonly SIDEBAR_WIDTH_KEY = 'docuvault-sidebar-width';
  private static readonly DEFAULT_WIDTH = 280;
  private static readonly MIN_WIDTH = 200;
  private static readonly MAX_WIDTH = 500;
  @Input() space!: Space;
  @Input() fullPath!: string;

  spaceSignal = signal<Space | null>(null);
  fileTree = signal<FileNode[]>([]);
  unsortedCount = signal(0);
  loading = signal(false);
  expandedFolders = signal<Set<string>>(new Set());
  currentDocPath = signal<string | null>(null);
  renamingPath = signal<string | null>(null);
  renamingValue = '';
  creatingFolderUnder = signal<string | null>(null);
  newFolderName = '';
  breadcrumbSegments = signal<{ label: string; path: string; isFile: boolean }[]>([]);
  pathBreadcrumbs = signal<{ name: string; path: string }[]>([]);
  shareFilePath = signal<string | null>(null);
  shareIsDirectory = signal(false);
  sharedFilePaths = signal<Set<string>>(new Set());
  annotationCounts = signal<Record<string, number>>({});
  annotationTotal = signal(0);
  openMenuPath = signal<string | null>(null);
  sidebarWidth = signal(
    parseInt(localStorage.getItem(SpaceComponent.SIDEBAR_WIDTH_KEY) || '', 10) || SpaceComponent.DEFAULT_WIDTH
  );
  isResizing = signal(false);
  private resizing = false;
  private boundOnMouseMove = this.onResizeMove.bind(this);
  private boundOnMouseUp = this.onResizeEnd.bind(this);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private sharedLinksService: SharedLinksService,
    private inboxService: InboxService,
    private annotationsService: AnnotationsService
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
      this.loadSharedLinks(this.space.id);
      this.loadAnnotationCounts(this.space.id);
      this.buildPathBreadcrumbs();
      this.loadInboxCount(this.space.id);
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

  loadInboxCount(spaceId: string): void {
    this.inboxService.getUnsortedCount(spaceId).subscribe({
      next: (res) => this.unsortedCount.set(res.count),
      error: () => this.unsortedCount.set(0)
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
    this.router.navigate(spaceRoute(this.fullPath, 'doc'));
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.openMenuPath.set(null);
  }

  toggleTreeMenu(path: string): void {
    this.openMenuPath.set(this.openMenuPath() === path ? null : path);
  }

  openFullscreenPreview(filePath: string): void {
    const space = this.spaceSignal();
    if (!space) return;
    this.router.navigate(['/preview', space.id, filePath]);
  }

  openShareDialog(filePath: string, isDirectory = false): void {
    this.openMenuPath.set(null);
    this.shareFilePath.set(filePath);
    this.shareIsDirectory.set(isDirectory);
  }

  onShareDialogClose(): void {
    this.shareFilePath.set(null);
    const space = this.spaceSignal();
    if (space) {
      this.loadSharedLinks(space.id);
    }
  }

  loadAnnotationCounts(spaceId: string): void {
    this.annotationsService.getAnnotationCounts(spaceId).subscribe({
      next: (data) => {
        this.annotationCounts.set(data.perFile);
        this.annotationTotal.set(data.total);
      }
    });
  }

  loadSharedLinks(spaceId: string): void {
    this.sharedLinksService.getLinks(spaceId).subscribe({
      next: (links) => {
        const now = new Date().toISOString();
        const activePaths = new Set(
          links
            .filter(l => !l.revokedAt && (!l.expiresAt || l.expiresAt > now))
            .map(l => l.filePath)
        );
        this.sharedFilePaths.set(activePaths);
      }
    });
  }

  onResizeStart(event: MouseEvent): void {
    event.preventDefault();
    this.resizing = true;
    this.isResizing.set(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', this.boundOnMouseMove);
    document.addEventListener('mouseup', this.boundOnMouseUp);
  }

  private onResizeMove(event: MouseEvent): void {
    if (!this.resizing) return;
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    if (!sidebar) return;
    const newWidth = Math.min(
      SpaceComponent.MAX_WIDTH,
      Math.max(SpaceComponent.MIN_WIDTH, event.clientX - sidebar.getBoundingClientRect().left)
    );
    this.sidebarWidth.set(newWidth);
  }

  private onResizeEnd(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.isResizing.set(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', this.boundOnMouseMove);
    document.removeEventListener('mouseup', this.boundOnMouseUp);
    localStorage.setItem(SpaceComponent.SIDEBAR_WIDTH_KEY, String(this.sidebarWidth()));
  }

  resetSidebarWidth(): void {
    this.sidebarWidth.set(SpaceComponent.DEFAULT_WIDTH);
    localStorage.removeItem(SpaceComponent.SIDEBAR_WIDTH_KEY);
  }

  startRename(path: string, name: string): void {
    this.renamingPath.set(path);
    this.renamingValue = name;
    this.creatingFolderUnder.set(null);
  }

  submitRename(node: FileNode): void {
    let newName = this.renamingValue.trim();
    if (!newName || newName === node.name) { this.cancelRename(); return; }
    const space = this.spaceSignal();
    if (!space) return;

    if (!node.isDirectory) {
      const dot = node.name.lastIndexOf('.');
      const oldExt = dot > 0 ? node.name.substring(dot) : '';
      if (oldExt && !newName.toLowerCase().endsWith(oldExt.toLowerCase())) {
        newName += oldExt;
      }
    }

    const parentPrefix = node.path.includes('/')
      ? node.path.substring(0, node.path.lastIndexOf('/') + 1)
      : '';
    const newPath = parentPrefix + newName;

    this.documentsService.rename(space.id, node.path, newPath).subscribe({
      next: () => { this.cancelRename(); this.loadFileTree(space.id); },
      error: () => this.cancelRename()
    });
  }

  cancelRename(): void {
    this.renamingPath.set(null);
    this.renamingValue = '';
  }

  startCreateFolder(parentPath: string): void {
    this.creatingFolderUnder.set(parentPath);
    this.newFolderName = '';
    this.renamingPath.set(null);
    // Expand the parent folder so the inline input is visible
    if (parentPath) {
      const expanded = new Set(this.expandedFolders());
      expanded.add(parentPath);
      this.expandedFolders.set(expanded);
    }
    // Focus input after render
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.new-folder-input');
      input?.focus();
    }, 50);
  }

  submitCreateFolder(): void {
    const name = this.newFolderName.trim();
    const parent = this.creatingFolderUnder();
    if (!name || parent === null) { this.cancelCreateFolder(); return; }
    const space = this.spaceSignal();
    if (!space) return;

    const fullPath = parent ? `${parent}/${name}` : name;
    this.documentsService.createFolder(space.id, fullPath).subscribe({
      next: () => { this.cancelCreateFolder(); this.loadFileTree(space.id); },
      error: () => this.cancelCreateFolder()
    });
  }

  cancelCreateFolder(): void {
    this.creatingFolderUnder.set(null);
    this.newFolderName = '';
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundOnMouseMove);
    document.removeEventListener('mouseup', this.boundOnMouseUp);
  }
}
