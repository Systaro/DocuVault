import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet, NavigationEnd } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { LayoutComponent } from '../../shared/components/layout.component';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, FileNode, Document } from '../../core/api/documents.service';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { SharedLinksService, SharedLink } from '../../core/api/shared-links.service';
import { InboxService } from '../../core/api/inbox.service';
import { AnnotationsService } from '../../core/api/annotations.service';
import { CapabilitiesService } from '../../core/capabilities/capabilities.service';
import { DisplayPrefsService } from '../../shared/services/display-prefs.service';
import { ToastService } from '../../shared/services/toast.service';
import { SpaceRoutePipe } from '../../shared/pipes/space-route.pipe';
import { spaceRoute } from '../../shared/utils/route-utils';
import { getFileIcon } from '../../shared/utils/file-utils';

@Component({
  selector: 'app-space',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, RouterOutlet, LayoutComponent, ShareLinkDialogComponent, SpaceRoutePipe],
  template: `
    <app-layout>
      @if (spaceSignal()) {
        <div class="space-container">
          <div class="browser-main" [style.--sidebar-width]="sidebarWidth() + 'px'">
            @if (mobileSidebarOpen()) {
              <div class="sidebar-backdrop" (click)="mobileSidebarOpen.set(false)"></div>
            }
            <!-- Sidebar -->
            <aside class="sidebar" [class.mobile-open]="mobileSidebarOpen()">
              <div class="sidebar-header">
                <button
                  type="button"
                  class="menu-toggle-btn-inline"
                  [attr.aria-label]="mobileSidebarOpen() ? 'Close menu' : 'Open menu'"
                  (click)="toggleMobileSidebar($event)"
                >
                  <span class="material-icons">{{ mobileSidebarOpen() ? 'close' : 'menu' }}</span>
                </button>
                @if (headerLogo(); as logo) {
                  <img class="space-context-logo" [src]="logo" [alt]="spaceSignal()?.name" />
                } @else {
                  <span class="material-icons">folder_special</span>
                }
                <div class="space-context">
                  @if (groupPath(); as gPath) {
                    <a class="space-context-group" [routerLink]="gPath | spaceRoute" [title]="groupLabel()">{{ groupLabel() }}</a>
                  }
                  <span class="space-context-name" [title]="spaceSignal()?.name">{{ spaceSignal()?.name }}</span>
                </div>
                @if (sharedFilePaths().has('')) {
                  <span class="material-icons shared-indicator" title="Repository is publicly shared">lock_open</span>
                }
                <button
                  class="sidebar-share-btn"
                  title="Share entire repository"
                  (click)="openShareDialog('', true)"
                >
                  <span class="material-icons">share</span>
                </button>
              </div>
              <div class="sidebar-search">
                <span class="material-icons">search</span>
                <input
                  type="text"
                  placeholder="Search files…"
                  [(ngModel)]="fileTreeFilter"
                  (ngModelChange)="fileTreeFilterQuery.set($event)"
                />
                @if (fileTreeFilterQuery()) {
                  <button class="search-clear" (click)="clearFileTreeFilter()" title="Clear">
                    <span class="material-icons">close</span>
                  </button>
                }
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
                @if (caps.aiChat()) {
                  <a
                    [routerLink]="spaceSignal()?.fullPath | spaceRoute:'chat'"
                    routerLinkActive="active"
                    class="nav-item"
                  >
                    <span class="material-icons">auto_awesome</span>
                    AI Chat
                  </a>
                }
                @if (caps.aiInbox()) {
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
                }
                @if (canManageSpace()) {
                  <a
                    [routerLink]="spaceSignal()?.fullPath | spaceRoute:'settings'"
                    routerLinkActive="active"
                    class="nav-item"
                  >
                    <span class="material-icons">settings</span>
                    Settings
                  </a>
                }
              </nav>

              <!-- File Tree -->
              <div class="folder-tree"
                   [class.drop-target-root]="rootDropActive()"
                   (dragover)="onTreeDragOver($event)"
                   (dragleave)="onTreeDragLeave($event)"
                   (drop)="onTreeDrop($event)">
                @if (fileTree().length === 0) {
                  <div class="tree-empty">
                    <span class="material-icons">folder_off</span>
                    <p>No files yet</p>
                  </div>
                } @else if (visibleFileTree().length === 0) {
                  <div class="tree-empty">
                    <span class="material-icons">search_off</span>
                    <p>No files match "{{ fileTreeFilterQuery() }}"</p>
                  </div>
                } @else {
                  <ng-container *ngTemplateOutlet="fileTreeTemplate; context: { nodes: visibleFileTree(), level: 0 }"></ng-container>
                }
              </div>

              <!-- Pretty names toggle -->
              <div class="sidebar-footer">
                <label class="pretty-toggle">
                  <span class="material-icons">{{ prefs.prettyNames() ? 'auto_fix_high' : 'text_fields' }}</span>
                  <span class="pretty-toggle-label">Pretty names</span>
                  <input type="checkbox" [checked]="prefs.prettyNames()" (change)="prefs.toggle()" />
                  <span class="pretty-toggle-switch" [class.on]="prefs.prettyNames()">
                    <span class="pretty-toggle-knob"></span>
                  </span>
                </label>
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

        @if (deletingNode(); as node) {
          <div class="modal-overlay" (click)="cancelDeleteFile()">
            <div class="modal" (click)="$event.stopPropagation()">
              <div class="modal-header"><h2>Delete file</h2></div>
              <div class="modal-body">
                <p>Are you sure you want to delete <strong>{{ node.name }}</strong>?</p>
                <p class="modal-hint">This action cannot be undone.</p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn-secondary" (click)="cancelDeleteFile()">Cancel</button>
                <button type="button" class="btn-danger" (click)="confirmDeleteFile()" [disabled]="deleteBusy()">Delete</button>
              </div>
            </div>
          </div>
        }

        @if (movingNode(); as node) {
          <div class="modal-overlay" (click)="cancelMoveFile()">
            <div class="modal" (click)="$event.stopPropagation()">
              <div class="modal-header"><h2>Move file</h2></div>
              <div class="modal-body">
                <p>Move <strong>{{ node.name }}</strong> to:</p>
                <div class="move-search-wrap">
                  <span class="material-icons move-search-icon">search</span>
                  <input
                    class="move-search"
                    type="text"
                    autofocus
                    placeholder="Search folders…"
                    [ngModel]="moveSearch()"
                    (ngModelChange)="moveSearch.set($event)"
                  />
                </div>
                <ul class="move-folder-list">
                  @for (folder of filteredFolderOptions(); track folder) {
                    <li>
                      <button
                        type="button"
                        class="move-folder-option"
                        [class.selected]="folder === moveTargetFolder"
                        (click)="moveTargetFolder = folder"
                      >
                        <span class="material-icons opt-icon">{{ folder ? 'folder' : 'home' }}</span>
                        <span class="move-folder-label">{{ folder || '(space root)' }}</span>
                        @if (folder === moveTargetFolder) {
                          <span class="material-icons opt-check">check</span>
                        }
                      </button>
                    </li>
                  } @empty {
                    <li class="move-folder-empty">No matching folders</li>
                  }
                </ul>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn-secondary" (click)="cancelMoveFile()">Cancel</button>
                <button type="button" class="btn-primary" (click)="confirmMoveFile()" [disabled]="moveBusy()">Move</button>
              </div>
            </div>
          </div>
        }
      }

      <!-- File Tree Template -->
      <ng-template #fileTreeTemplate let-nodes="nodes" let-level="level">
        @for (node of nodes; track node.path) {
          <div class="tree-node">
            @if (node.isDirectory) {
              <div class="tree-folder-row"
                   [class.drop-target]="dropTargetPath() === node.path"
                   (dragenter)="onFolderDragEnter(node.path, $event)"
                   (dragover)="onFolderDragOver(node.path, $event)"
                   (dragleave)="onFolderDragLeave(node.path, $event)"
                   (drop)="onFolderDrop(node.path, $event)">
                <button
                  (click)="openFolder(node.path)"
                  class="tree-item"
                  [class.expanded]="isTreeExpanded(node.path)"
                  [class.active]="currentFolderPath() === node.path"
                  [class.dragging]="draggingNode()?.path === node.path"
                  [draggable]="renamingPath() !== node.path"
                  (dragstart)="onNodeDragStart(node, $event); $event.stopPropagation()"
                  (dragend)="onNodeDragEnd()"
                  [style.padding-left.px]="12 + level * 16"
                >
                  <span class="material-icons expand-icon">chevron_right</span>
                  <span class="material-icons folder-icon">
                    {{ isTreeExpanded(node.path) ? 'folder_open' : 'folder' }}
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
                    <span class="tree-name">{{ prefs.prettify(node.name, true) }}</span>
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
                      <button class="tree-dropdown-item" (click)="downloadFolder(node); openMenuPath.set(null)">
                        <span class="material-icons">download</span>
                        Download folder
                      </button>
                    </div>
                  }
                </div>
              </div>
              @if (isTreeExpanded(node.path) && node.children) {
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
                  [class.dragging]="draggingNode()?.path === node.path"
                  [draggable]="renamingPath() !== node.path"
                  (dragstart)="onNodeDragStart(node, $event); $event.stopPropagation()"
                  (dragend)="onNodeDragEnd()"
                  [style.padding-left.px]="32 + level * 16"
                >
                  <img class="file-icon-img" draggable="false" [src]="getFileIcon(node.name)" [alt]="node.name" />
                  @if (renamingPath() === node.path) {
                    <input
                      class="rename-input"
                      [(ngModel)]="renamingValue"
                      (keydown.enter)="submitRename(node); $event.stopPropagation(); $event.preventDefault()"
                      (keydown.escape)="cancelRename(); $event.stopPropagation()"
                      (blur)="cancelRename()"
                      (click)="$event.stopPropagation(); $event.preventDefault()"
                      (mousedown)="$event.stopPropagation()"
                    />
                    <button
                      type="button"
                      class="rename-confirm-btn"
                      title="Confirm rename"
                      (mousedown)="$event.preventDefault(); $event.stopPropagation()"
                      (click)="submitRename(node); $event.stopPropagation(); $event.preventDefault()"
                    >
                      <span class="material-icons">check</span>
                    </button>
                  } @else {
                    <span class="tree-name">{{ displayName(node) }}</span>
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
                      <button class="tree-dropdown-item" (click)="startMoveFile(node)">
                        <span class="material-icons">drive_file_move</span>
                        Move
                      </button>
                      <button class="tree-dropdown-item" (click)="openShareDialog(node.path, false)">
                        <span class="material-icons">share</span>
                        Share file
                      </button>
                      <button class="tree-dropdown-item danger" (click)="startDeleteFile(node)">
                        <span class="material-icons">delete</span>
                        Delete
                      </button>
                    </div>
                  }
                </div>
              </div>
              @if (fileTranslations(node.path); as langs) {
                @for (code of langs; track code) {
                  <div class="tree-file-row tree-translation-row">
                    <a
                      [routerLink]="spaceSignal()?.fullPath | spaceRoute:'doc'"
                      [queryParams]="{ path: node.path, lang: code }"
                      class="tree-item file translation"
                      [class.active]="currentDocPath() === node.path && currentLang() === code"
                      [style.padding-left.px]="48 + level * 16"
                    >
                      <span class="material-icons translation-icon">translate</span>
                      <span class="tree-name">{{ languageLabel(code) }}</span>
                    </a>
                    <div class="tree-row-menu">
                      <button
                        type="button"
                        class="tree-menu-btn"
                        [title]="'Remove ' + languageLabel(code) + ' translation'"
                        (click)="removeTreeTranslation(node.path, code); $event.stopPropagation(); $event.preventDefault()"
                      >
                        <span class="material-icons">close</span>
                      </button>
                    </div>
                  </div>
                }
              }
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
      height: calc(100dvh - 64px);
      color: var(--text-muted);

      .material-icons {
        font-size: 32px;
        color: var(--primary);
        margin-bottom: var(--spacing-md);
      }
    }

    .space-container {
      height: calc(100dvh - 64px);
      display: flex;
      flex-direction: column;
    }

    .menu-toggle-btn {
      display: none;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      padding: 0;
      margin-right: var(--spacing-sm);
      background: none;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      cursor: pointer;
      flex-shrink: 0;

      .material-icons { font-size: 22px; }
      &:hover { background: var(--background); }
    }

    .sidebar-backdrop {
      display: none;
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
      width: var(--sidebar-width);
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
      border-bottom: 1px solid var(--border);

      .material-icons {
        font-size: 18px;
        color: var(--primary);
      }
    }

    .space-context-logo {
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      object-fit: contain;
      flex-shrink: 0;
    }

    .space-context {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }

    .space-context-group {
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      text-decoration: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      &:hover {
        color: var(--primary);
        text-decoration: underline;
      }
    }

    .space-context-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .sidebar-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      margin: 0 var(--spacing-sm) var(--spacing-sm);
      background: var(--background);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-muted);

      .material-icons { font-size: 16px; }

      input {
        flex: 1;
        background: transparent;
        border: none;
        outline: none;
        font-size: 13px;
        color: var(--text-primary);
        font-family: var(--font-body, inherit);

        &::placeholder {
          color: var(--text-muted);
        }
      }

      .search-clear {
        display: flex;
        align-items: center;
        padding: 0;
        border: none;
        background: none;
        color: var(--text-muted);
        cursor: pointer;

        &:hover { color: var(--text-primary); }
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

    // The tree node currently being dragged to reorganise it.
    .tree-item.dragging {
      opacity: 0.45;
    }

    .folder-tree {
      flex: 1;
      overflow-y: auto;
      padding: var(--spacing-sm);

      // Highlighted while something is dragged over empty space (→ space root).
      &.drop-target-root {
        outline: 2px dashed var(--primary);
        outline-offset: -4px;
        border-radius: var(--radius-md);
        background: var(--background-darker);
      }
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

      .file-icon-img {
        width: 16px;
        height: 16px;
        object-fit: contain;
        flex-shrink: 0;
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

    .tree-item.translation {
      font-size: 12px;
      color: var(--text-muted);

      .translation-icon {
        font-size: 15px;
        color: var(--primary);
        flex-shrink: 0;
      }

      &.active {
        background: #65aaaf36;
        color: #4a9097;
        font-weight: 500;
      }
    }

    .tree-translation-row .tree-menu-btn:hover {
      color: var(--danger, #dc2626);
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

      &.danger {
        color: var(--danger, #dc2626);

        .material-icons {
          color: var(--danger, #dc2626);
        }

        &:hover {
          background: var(--danger-bg, rgba(220, 38, 38, 0.08));
        }
      }
    }

    .modal-hint {
      margin-top: var(--spacing-xs);
      font-size: 13px;
      color: var(--text-muted);
    }

    .move-search-wrap {
      position: relative;
      margin-top: var(--spacing-sm);
    }

    .move-search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .move-search {
      width: 100%;
      padding: var(--spacing-sm) var(--spacing-sm) var(--spacing-sm) 34px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
      color: var(--text-primary);
      font-size: 14px;

      &:focus {
        outline: none;
        border-color: var(--primary);
      }
    }

    .move-folder-list {
      list-style: none;
      margin: var(--spacing-sm) 0 0;
      padding: 4px;
      max-height: 260px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--surface);
    }

    .move-folder-option {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border: none;
      border-radius: var(--radius-sm);
      background: none;
      color: var(--text-primary);
      font-size: 13.5px;
      text-align: left;
      cursor: pointer;

      .opt-icon {
        font-size: 18px;
        color: var(--text-muted);
        flex-shrink: 0;
      }

      .move-folder-label {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .opt-check {
        font-size: 18px;
        color: var(--primary);
        flex-shrink: 0;
      }

      &:hover {
        background: var(--background);
      }

      &.selected {
        background: var(--background-darker);
        font-weight: 600;

        .opt-icon { color: var(--primary); }
      }
    }

    .move-folder-empty {
      padding: 12px 10px;
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
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

    .rename-confirm-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      margin-left: 4px;
      padding: 0;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;

      .material-icons { font-size: 16px; }

      &:hover { filter: brightness(1.1); }
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

      // Highlighted while OS files are dragged over it (drop-to-upload target).
      &.drop-target {
        outline: 2px dashed var(--primary);
        outline-offset: -2px;
        border-radius: var(--radius-sm);
        background: var(--background-darker);
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

    .pretty-toggle {
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      user-select: none;
      color: var(--text-secondary);
      font-size: 13px;

      .material-icons { font-size: 18px; color: var(--text-muted); }
      .pretty-toggle-label { flex: 1; }

      input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
    }

    .pretty-toggle-switch {
      position: relative;
      width: 32px;
      height: 18px;
      background: var(--border);
      border-radius: 999px;
      transition: background var(--transition);

      .pretty-toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        background: #fff;
        border-radius: 50%;
        transition: left var(--transition);
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }

      &.on {
        background: var(--primary);
        .pretty-toggle-knob { left: 16px; }
      }
    }

    .menu-toggle-btn-inline {
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 0;
      margin-right: 4px;
      align-items: center;

      .material-icons { font-size: 20px; }
    }

    @media (max-width: 768px) {
      .menu-toggle-btn-inline {
        display: inline-flex;
      }
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
      .menu-toggle-btn {
        display: inline-flex;
      }

      .breadcrumb-bar {
        padding: var(--spacing-sm) var(--spacing-md);
        gap: var(--spacing-sm);
      }

      .breadcrumb {
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }
      .breadcrumb::-webkit-scrollbar { display: none; }

      .breadcrumb-item {
        flex-shrink: 0;
      }

      .breadcrumb-actions .search-box {
        display: none;
      }

      .browser-main {
        position: relative;
      }

      .sidebar {
        position: fixed;
        top: 64px;
        bottom: 0;
        left: 0;
        width: min(85vw, 320px);
        min-width: 0;
        max-width: none;
        z-index: 200;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        box-shadow: 0 0 24px rgba(0, 0, 0, 0.25);
      }

      .sidebar.mobile-open {
        transform: translateX(0);
      }

      .resize-handle {
        display: none;
      }

      .sidebar-backdrop {
        display: block;
        position: fixed;
        top: 64px;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        z-index: 199;
        animation: sidebar-fade-in 0.18s ease;
      }

      @keyframes sidebar-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    }
  `]
})
export class SpaceComponent implements OnInit, OnChanges, OnDestroy {
  readonly getFileIcon = getFileIcon;
  private static readonly SIDEBAR_WIDTH_KEY = 'docuvault-sidebar-width';
  private static readonly DEFAULT_WIDTH = 280;
  private static readonly MIN_WIDTH = 200;
  private static readonly MAX_WIDTH = 500;
  @Input() space!: Space;
  @Input() fullPath!: string;

  spaceSignal = signal<Space | null>(null);
  fileTree = signal<FileNode[]>([]);
  /** path → first-H1 title, used to label sidebar tree rows the same way the
   *  folder-overview pane does. Falls back to the prettified filename when a
   *  title isn't available for that path. */
  documentTitles = signal<Map<string, string>>(new Map());
  unsortedCount = signal(0);
  /** True when the current user has ADMIN on this space (or is super admin) —
   *  gates the Settings nav item; the backend enforces the same rule. */
  canManageSpace = signal(false);
  loading = signal(false);
  expandedFolders = signal<Set<string>>(new Set());

  /** Display label for a tree node. Titles/prettified names are a "pretty names"
   *  feature: with the toggle ON we show Document.title when known, otherwise the
   *  prettified filename (same fallback the overview pane uses). With the toggle
   *  OFF we show the raw filename — extension and all. */
  displayName(node: FileNode): string {
    if (!this.prefs.prettyNames()) return node.name;
    const title = this.documentTitles().get(node.path);
    if (title) return title;
    return this.prefs.prettify(node.name, node.isDirectory);
  }

  /** Path of the folder currently shown in the overview's middle pane, or
   *  null when not browsing a folder (doc editor, inbox, root etc.). */
  currentFolderPath = signal<string | null>(null);

  /** Sidebar file-tree filter: live-filters the tree, keeping folders whose
   *  descendants match and auto-expanding while a query is active. */
  fileTreeFilter = '';
  fileTreeFilterQuery = signal('');

  visibleFileTree = computed<FileNode[]>(() => {
    const query = this.fileTreeFilterQuery().toLowerCase().trim();
    if (!query) return this.fileTree();

    const titles = this.documentTitles();
    const matches = (node: FileNode): boolean =>
      node.name.toLowerCase().includes(query) ||
      (titles.get(node.path)?.toLowerCase().includes(query) ?? false) ||
      this.prefs.prettify(node.name, node.isDirectory).toLowerCase().includes(query);

    const filterNodes = (nodes: FileNode[]): FileNode[] =>
      nodes.flatMap(node => {
        if (node.isDirectory) {
          const children = filterNodes(node.children ?? []);
          if (children.length > 0 || matches(node)) {
            return [{ ...node, children: children.length > 0 ? children : node.children }];
          }
          return [];
        }
        return matches(node) ? [node] : [];
      });

    return filterNodes(this.fileTree());
  });

  /** Folders render expanded while a filter query is active. */
  isTreeExpanded(path: string): boolean {
    return this.expandedFolders().has(path) || !!this.fileTreeFilterQuery();
  }

  clearFileTreeFilter(): void {
    this.fileTreeFilter = '';
    this.fileTreeFilterQuery.set('');
  }
  currentDocPath = signal<string | null>(null);
  /** Active translation language (?lang=) for the currently-open document, or null. */
  currentLang = signal<string | null>(null);
  /** Cached translation languages per document path — drives the indented tree entries. */
  translationsByPath = signal<Record<string, string[]>>({});
  private readonly translationLanguageLabels: Record<string, string> = {
    en: 'English', de: 'Deutsch', fr: 'Français', es: 'Español', it: 'Italiano'
  };
  renamingPath = signal<string | null>(null);
  renamingValue = '';
  creatingFolderUnder = signal<string | null>(null);
  newFolderName = '';
  breadcrumbSegments = signal<{ label: string; path: string; isFile: boolean }[]>([]);
  pathBreadcrumbs = signal<{ name: string; path: string }[]>([]);
  /** Full path of the parent group (everything before the last segment), or null for top-level spaces. */
  groupPath = computed(() => {
    const space = this.spaceSignal();
    if (!space?.parentId) return null;
    const idx = space.fullPath.lastIndexOf('/');
    return idx > 0 ? space.fullPath.slice(0, idx) : null;
  });
  groupLabel = computed(() => this.groupPath()?.split('/').join(' / ') ?? '');
  /** Logo inherited from the nearest ancestor group when the space has none of its own. */
  parentLogoUrl = signal<string | null>(null);
  headerLogo = computed(() => this.spaceSignal()?.logoUrl || this.parentLogoUrl());
  shareFilePath = signal<string | null>(null);
  shareIsDirectory = signal(false);
  sharedFilePaths = signal<Set<string>>(new Set());
  annotationCounts = signal<Record<string, number>>({});
  annotationTotal = signal(0);
  openMenuPath = signal<string | null>(null);
  /** File pending deletion — drives the delete-confirmation modal. */
  deletingNode = signal<FileNode | null>(null);
  deleteBusy = signal(false);
  /** File being moved — drives the move modal. */
  movingNode = signal<FileNode | null>(null);
  moveBusy = signal(false);
  /** Destination folder selected in the move modal ('' = space root). */
  moveTargetFolder = '';
  /** Search query in the move modal's folder picker. */
  moveSearch = signal('');

  /** All folder paths in the tree, for the move modal's destination picker. */
  folderOptions = computed<string[]>(() => {
    const out: string[] = [];
    const walk = (nodes: FileNode[]): void => {
      for (const n of nodes) {
        if (n.isDirectory) {
          out.push(n.path);
          if (n.children) walk(n.children);
        }
      }
    };
    walk(this.fileTree());
    return out.sort((a, b) => a.localeCompare(b));
  });

  /** Folder options filtered by the move-modal search box. '' (space root) is
   *  always offered first, and hidden only when it doesn't match the query. */
  filteredFolderOptions = computed<string[]>(() => {
    const q = this.moveSearch().toLowerCase().trim();
    const all = ['', ...this.folderOptions()];
    if (!q) return all;
    return all.filter(f => (f || 'space root').toLowerCase().includes(q));
  });

  sidebarWidth = signal(
    parseInt(localStorage.getItem(SpaceComponent.SIDEBAR_WIDTH_KEY) || '', 10) || SpaceComponent.DEFAULT_WIDTH
  );
  isResizing = signal(false);
  mobileSidebarOpen = signal(false);
  private resizing = false;
  private boundOnMouseMove = this.onResizeMove.bind(this);
  private boundOnMouseUp = this.onResizeEnd.bind(this);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private titleService: Title,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private sharedLinksService: SharedLinksService,
    private inboxService: InboxService,
    private annotationsService: AnnotationsService,
    protected caps: CapabilitiesService,
    protected prefs: DisplayPrefsService,
    private toastService: ToastService
  ) {}

  ngOnInit(): void {
    // Track current document path from child route query params
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.updateBreadcrumb();
        this.mobileSidebarOpen.set(false);
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
      this.loadMyPermission(this.space.id);
      this.loadContextLogo(this.space);
      this.updateTitle();
    }
  }

  private loadMyPermission(spaceId: string): void {
    this.canManageSpace.set(false);
    this.annotationsService.getMyPermission(spaceId).subscribe({
      next: (res) => this.canManageSpace.set(res.level === 'ADMIN'),
      error: () => this.canManageSpace.set(false)
    });
  }

  private loadContextLogo(space: Space): void {
    this.parentLogoUrl.set(null);
    if (!space.logoUrl && space.parentId) {
      this.resolveParentLogo(space.parentId);
    }
  }

  /** Walks up the group chain until a logo is found (spaces don't carry their parent's logoUrl). */
  private resolveParentLogo(parentId: string): void {
    this.spacesService.getSpace(parentId).subscribe({
      next: parent => {
        if (parent.logoUrl) {
          this.parentLogoUrl.set(parent.logoUrl);
        } else if (parent.parentId) {
          this.resolveParentLogo(parent.parentId);
        }
      },
      error: () => {}
    });
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
    // Get query params from the current child route.
    const childRoute = this.route.firstChild;
    const path = childRoute?.snapshot.queryParamMap.get('path') || null;
    // The `path` query param is shared by two routes: /doc (file path) and
    // the space overview itself (folder path). Distinguish via the URL.
    const isDoc = this.router.url.includes('/doc');
    const lang = childRoute?.snapshot.queryParamMap.get('lang') || null;

    this.currentDocPath.set(isDoc ? path : null);
    this.currentLang.set(isDoc ? lang : null);
    this.currentFolderPath.set(!isDoc ? path : null);

    if (path) {
      // For a doc path, drop the file segment so the topbar breadcrumb doesn't
      // duplicate the editor's own filename header. Folder paths show in full.
      const allParts = path.split('/');
      const parts = isDoc ? allParts.slice(0, -1) : allParts;
      const segments = parts.map((part, i) => ({
        label: part,
        path: parts.slice(0, i + 1).join('/'),
        isFile: false
      }));
      this.breadcrumbSegments.set(segments);
    } else {
      this.breadcrumbSegments.set([]);
    }

    this.updateTitle();
    this.expandToCurrentPath(path, isDoc);
  }

  /**
   * Sets the browser tab title to "<file> · <space> — DocuVault" so the open
   * document and space are visible before the app name.
   */
  private updateTitle(): void {
    const parts: string[] = [];
    const docPath = this.currentDocPath();
    if (docPath) {
      parts.push(docPath.split('/').pop()?.replace(/\.md$/, '') || docPath);
    }
    const space = this.spaceSignal();
    if (space) {
      parts.push(space.name);
    }
    const prefix = parts.length ? `${parts.join(' · ')} — ` : '';
    this.titleService.setTitle(`${prefix}DocuVault`);
  }

  /**
   * Expands every folder along the current path so the sidebar reveals it.
   * For a doc path we stop one segment short (the last segment is the file);
   * for a folder path we expand the whole chain including the last segment.
   */
  private expandToCurrentPath(path: string | null, isDoc: boolean): void {
    if (!path) return;
    const parts = path.split('/');
    if (isDoc && parts.length < 2) return;
    const stopAt = isDoc ? parts.length - 1 : parts.length;
    const expanded = new Set(this.expandedFolders());
    let prefix = '';
    for (let i = 0; i < stopAt; i++) {
      prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
      expanded.add(prefix);
    }
    this.expandedFolders.set(expanded);
  }

  loadFileTree(spaceId: string): void {
    this.documentsService.getFileTree(spaceId).subscribe({
      next: (tree) => this.fileTree.set(tree)
    });
    this.loadTranslations(spaceId);
    this.documentsService.getDocuments(spaceId).subscribe({
      next: (docs: Document[]) => {
        const map = new Map<string, string>();
        for (const d of docs) {
          if (d.title) map.set(d.path, d.title);
        }
        this.documentTitles.set(map);
      },
      error: () => this.documentTitles.set(new Map())
    });
  }

  private loadTranslations(spaceId: string): void {
    this.documentsService.getTranslations(spaceId).subscribe({
      next: (entries) => {
        const map: Record<string, string[]> = {};
        for (const e of entries) map[e.path] = e.languages;
        this.translationsByPath.set(map);
      },
      error: () => this.translationsByPath.set({})
    });
  }

  fileTranslations(path: string): string[] | undefined {
    const langs = this.translationsByPath()[path];
    return langs && langs.length ? langs : undefined;
  }

  languageLabel(code: string): string {
    return this.translationLanguageLabels[code] ?? code;
  }

  removeTreeTranslation(path: string, code: string): void {
    const space = this.spaceSignal();
    if (!space) return;
    this.documentsService.deleteTranslation(space.id, path, code).subscribe({
      next: () => {
        this.translationsByPath.update(m => {
          const langs = (m[path] ?? []).filter(c => c !== code);
          const next = { ...m };
          if (langs.length) next[path] = langs; else delete next[path];
          return next;
        });
        // If that exact translation is the one open in the editor, revert it to the original.
        if (this.currentDocPath() === path && this.currentLang() === code) {
          this.router.navigate(spaceRoute(space.fullPath, 'doc'), { queryParams: { path } });
        }
        this.toastService.success('Translation removed', `The ${this.languageLabel(code)} translation was removed.`);
      },
      error: () => this.toastService.error('Could not remove translation', 'Please try again.')
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

  /**
   * Sidebar click on a folder: toggles its expand state AND navigates the
   * middle pane (space overview) to browse that folder. The overview reads
   * the `?path=` query param on the space root route. Re-expansion after
   * navigation is handled by updateBreadcrumb, so the currently-browsed
   * folder always stays expanded.
   */
  openFolder(path: string): void {
    this.toggleFolder(path);
    const space = this.spaceSignal();
    if (!space) return;
    this.router.navigate(spaceRoute(space.fullPath), { queryParams: { path } });
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

  toggleMobileSidebar(event: Event): void {
    event.stopPropagation();
    this.mobileSidebarOpen.set(!this.mobileSidebarOpen());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileSidebarOpen()) {
      this.mobileSidebarOpen.set(false);
    }
  }

  openFullscreenPreview(filePath: string): void {
    const space = this.spaceSignal();
    if (!space) return;
    this.router.navigate(['/preview', space.id, filePath]);
  }

  downloadFolder(node: FileNode): void {
    const space = this.spaceSignal();
    if (!space) return;
    const a = document.createElement('a');
    a.href = `/api/spaces/${space.id}/files/${node.path}?download=true`;
    a.download = `${node.name}.zip`;
    a.click();
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

  private parentFolderOf(path: string): string {
    return path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
  }

  startDeleteFile(node: FileNode): void {
    this.deletingNode.set(node);
    this.openMenuPath.set(null);
  }

  confirmDeleteFile(): void {
    const node = this.deletingNode();
    const space = this.spaceSignal();
    if (!node || !space) return;
    this.deleteBusy.set(true);
    const wasActive = this.currentDocPath() === node.path;
    this.documentsService.deleteDocument(space.id, node.path).subscribe({
      next: () => {
        this.deleteBusy.set(false);
        this.deletingNode.set(null);
        this.toastService.success('Deleted', `"${node.name}" has been deleted.`);
        this.loadFileTree(space.id);
        if (wasActive) {
          this.router.navigate(spaceRoute(space.fullPath));
        }
      },
      error: (err) => {
        this.deleteBusy.set(false);
        this.toastService.error('Delete failed', err?.error?.message ?? 'Could not delete the file.');
      }
    });
  }

  cancelDeleteFile(): void {
    this.deletingNode.set(null);
  }

  /** Folder path currently under a drag, for the drop highlight. */
  dropTargetPath = signal<string | null>(null);
  /** True while a drag is over empty sidebar space (→ space root). */
  rootDropActive = signal(false);
  /** The tree node being dragged to reorganise it (internal move), or null. */
  draggingNode = signal<FileNode | null>(null);

  private hasFiles(event: DragEvent): boolean {
    return !!event.dataTransfer && Array.from(event.dataTransfer.types).includes('Files');
  }

  /** Either an OS-file drag (upload) or an internal node drag (reorganise). */
  private isAcceptableDrag(event: DragEvent): boolean {
    return this.hasFiles(event) || !!this.draggingNode();
  }

  private dropEffectFor(event: DragEvent): 'copy' | 'move' {
    return this.hasFiles(event) ? 'copy' : 'move';
  }

  // --- Dragging a tree node to reorganise (internal move) ---

  onNodeDragStart(node: FileNode, event: DragEvent): void {
    this.draggingNode.set(node);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // text/plain keeps Firefox from cancelling the drag; the node itself is
      // tracked via the draggingNode signal (same app instance).
      event.dataTransfer.setData('text/plain', node.path);
    }
  }

  onNodeDragEnd(): void {
    this.draggingNode.set(null);
    this.dropTargetPath.set(null);
    this.rootDropActive.set(false);
  }

  // --- Folder rows: accept OS files (upload) or a dragged node (move) ---

  onFolderDragEnter(path: string, event: DragEvent): void {
    if (!this.isAcceptableDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.rootDropActive.set(false);
    this.dropTargetPath.set(path);
  }

  onFolderDragOver(path: string, event: DragEvent): void {
    if (!this.isAcceptableDrag(event)) return;
    // Prevent default so the browser accepts the drop (otherwise it navigates
    // to the dropped file). stopPropagation keeps parent folder rows — and the
    // root dropzone — from also claiming the highlight.
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.dropEffectFor(event);
    this.rootDropActive.set(false);
    this.dropTargetPath.set(path);
  }

  onFolderDragLeave(path: string, event: DragEvent): void {
    // Only clear when the pointer actually left the row, not when moving onto a
    // child element inside it.
    const current = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (related && current.contains(related)) return;
    if (this.dropTargetPath() === path) this.dropTargetPath.set(null);
  }

  onFolderDrop(path: string, event: DragEvent): void {
    if (!this.isAcceptableDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    this.dropTargetPath.set(null);
    if (this.hasFiles(event)) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) this.uploadFilesToFolder(files, path);
      return;
    }
    const node = this.draggingNode();
    this.draggingNode.set(null);
    if (node) this.moveNodeToFolder(node, path);
  }

  // --- Empty sidebar space: drop into the space root ---

  onTreeDragOver(event: DragEvent): void {
    if (!this.isAcceptableDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.dropEffectFor(event);
    this.rootDropActive.set(true);
  }

  onTreeDragLeave(event: DragEvent): void {
    const current = event.currentTarget as HTMLElement;
    const related = event.relatedTarget as Node | null;
    if (related && current.contains(related)) return;
    this.rootDropActive.set(false);
  }

  onTreeDrop(event: DragEvent): void {
    if (!this.isAcceptableDrag(event)) return;
    event.preventDefault();
    this.rootDropActive.set(false);
    if (this.hasFiles(event)) {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) this.uploadFilesToFolder(files, '');
      return;
    }
    const node = this.draggingNode();
    this.draggingNode.set(null);
    if (node) this.moveNodeToFolder(node, '');
  }

  private uploadFilesToFolder(files: File[], folder: string): void {
    const space = this.spaceSignal();
    if (!space) return;
    this.documentsService.uploadFiles(space.id, files, folder).subscribe({
      next: (uploaded) => {
        this.toastService.success(
          `${uploaded.length} file${uploaded.length > 1 ? 's' : ''} uploaded`,
          `${uploaded.map(f => f.name).join(', ')} → ${folder || 'space root'}`
        );
        // Reveal the destination and refresh so the new files appear.
        if (folder) this.expandedFolders.update(set => new Set(set).add(folder));
        this.loadFileTree(space.id);
      },
      error: (err) => {
        this.toastService.error('Upload failed', err?.error?.message ?? 'Could not upload files.');
      }
    });
  }

  /** Move a dragged tree node (file or folder) into a destination folder. */
  private moveNodeToFolder(node: FileNode, targetFolder: string): void {
    const space = this.spaceSignal();
    if (!space) return;
    const newPath = targetFolder ? `${targetFolder}/${node.name}` : node.name;
    // Already there — dropping on the current parent is a no-op.
    if (newPath === node.path) return;
    // A folder can't be moved into itself or one of its own descendants.
    if (node.isDirectory && (targetFolder === node.path || targetFolder.startsWith(node.path + '/'))) {
      this.toastService.error('Move failed', "Can't move a folder into itself.");
      return;
    }
    const wasActive = this.currentDocPath() === node.path;
    this.documentsService.rename(space.id, node.path, newPath).subscribe({
      next: () => {
        this.toastService.success('Moved', `"${node.name}" → ${targetFolder || 'space root'}`);
        if (targetFolder) this.expandedFolders.update(set => new Set(set).add(targetFolder));
        this.loadFileTree(space.id);
        if (wasActive) {
          this.router.navigate(spaceRoute(space.fullPath, 'doc'), { queryParams: { path: newPath } });
        }
      },
      error: (err) => {
        this.toastService.error('Move failed', err?.error?.message ?? 'Could not move the item.');
      }
    });
  }

  startMoveFile(node: FileNode): void {
    this.movingNode.set(node);
    this.moveTargetFolder = this.parentFolderOf(node.path);
    this.moveSearch.set('');
    this.openMenuPath.set(null);
  }

  confirmMoveFile(): void {
    const node = this.movingNode();
    const space = this.spaceSignal();
    if (!node || !space) return;
    const target = this.moveTargetFolder;
    const newPath = target ? `${target}/${node.name}` : node.name;
    if (newPath === node.path) { this.cancelMoveFile(); return; }
    this.moveBusy.set(true);
    const wasActive = this.currentDocPath() === node.path;
    this.documentsService.rename(space.id, node.path, newPath).subscribe({
      next: () => {
        this.moveBusy.set(false);
        this.movingNode.set(null);
        this.toastService.success('Moved', `"${node.name}" → ${target || 'space root'}`);
        this.loadFileTree(space.id);
        if (wasActive) {
          this.router.navigate(spaceRoute(space.fullPath, 'doc'), { queryParams: { path: newPath } });
        }
      },
      error: (err) => {
        this.moveBusy.set(false);
        this.toastService.error('Move failed', err?.error?.message ?? 'Could not move the file.');
      }
    });
  }

  cancelMoveFile(): void {
    this.movingNode.set(null);
    this.moveTargetFolder = '';
    this.moveSearch.set('');
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundOnMouseMove);
    document.removeEventListener('mouseup', this.boundOnMouseUp);
    this.titleService.setTitle('DocuVault');
  }
}
