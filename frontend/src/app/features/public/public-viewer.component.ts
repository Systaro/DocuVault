import { Component, OnInit, OnDestroy, signal, computed, ViewEncapsulation, effect, ElementRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SharedLinksService, SharedFileMetadata, FileNode } from '../../core/api/shared-links.service';
import { DomSanitizer, SafeResourceUrl, SafeHtml, Meta, Title } from '@angular/platform-browser';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { AnnotationOverlayComponent } from '../../shared/components/annotation-overlay.component';
import { AnnotationPermission } from '../../core/api/annotations.service';
import { ImageZoomHandler } from '../../shared/utils/image-zoom';
import { handleMarkdownClick } from '../../shared/utils/markdown-link-handler';
import { RenderMode, getRenderMode, getFileIcon, getExtension } from '../../shared/utils/file-utils';

@Component({
  selector: 'app-public-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, AnnotationOverlayComponent],
  template: `
    <div class="public-viewer" [class.folder-layout]="shareType() === 'FOLDER' && !requiresPassword() && !loading() && !error() && !maintenanceMode()">
      <!-- Header -->
      <header class="viewer-header">
        <div class="header-brand">
          <span class="brand-icon material-icons">menu_book</span>
          <span class="brand-name">DocuVault</span>
        </div>
        @if (breadcrumbSegments().length) {
          <nav class="header-breadcrumb" aria-label="File location">
            @for (segment of breadcrumbSegments(); track segment.label; let last = $last) {
              <span class="breadcrumb-segment" [class.breadcrumb-current]="last">{{ segment.label }}</span>
              @if (!last) {
                <span class="breadcrumb-separator material-icons">chevron_right</span>
              }
            }
          </nav>
        }
      </header>

      <!-- Password Gate -->
      @if (requiresPassword()) {
        <main class="viewer-content">
          <div class="password-gate">
            <div class="password-card">
              <span class="material-icons lock-icon">lock</span>
              <h2>This link is password protected</h2>
              <p>Enter the password to access this shared content.</p>
              <form (submit)="submitPassword($event)">
                <input
                  type="password"
                  class="password-field"
                  [(ngModel)]="passwordInput"
                  [ngModelOptions]="{standalone: true}"
                  placeholder="Enter password"
                  [class.error]="passwordError()"
                  autofocus
                />
                @if (passwordError()) {
                  <p class="error-text">{{ passwordError() }}</p>
                }
                <button type="submit" class="btn btn-unlock" [disabled]="verifyingPassword() || !passwordInput">
                  @if (verifyingPassword()) {
                    <span class="material-icons animate-spin">sync</span>
                    Verifying...
                  } @else {
                    <span class="material-icons">lock_open</span>
                    Unlock
                  }
                </button>
              </form>
            </div>
          </div>
        </main>
      } @else if (loading()) {
        <main class="viewer-content">
          <div class="loading-state">
            <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p>Loading shared content...</p>
          </div>
        </main>
      } @else if (maintenanceMode()) {
        <main class="viewer-content">
          <div class="error-state">
            <span class="material-icons error-icon">build_circle</span>
            <h2>Wartungsmodus</h2>
            <p>Die Seite befindet sich gerade im Wartungsmodus. Bitte versuche es in wenigen Minuten erneut.</p>
            <button type="button" class="btn btn-primary" (click)="retryLoad()">
              <span class="material-icons">refresh</span>
              Erneut versuchen
            </button>
          </div>
        </main>
      } @else if (error()) {
        <main class="viewer-content">
          <div class="error-state">
            <span class="material-icons error-icon">link_off</span>
            <h2>Link Not Available</h2>
            <p>{{ error() }}</p>
          </div>
        </main>
      } @else if (shareType() === 'FOLDER') {
        <!-- Folder browser layout -->
        <aside class="folder-sidebar" [style.width.px]="sidebarWidth()">
          <div class="sidebar-header">
            <span class="material-icons">folder_special</span>
            <span class="sidebar-title">{{ metadata()?.fileName || metadata()?.spaceName }}</span>
          </div>
          <div class="folder-tree">
            <ng-container *ngTemplateOutlet="treeTemplate; context: { nodes: fileTree(), level: 0 }"></ng-container>
          </div>
        </aside>
        <div class="resize-handle" (mousedown)="startResize($event)"></div>
        <main class="folder-content">
          @if (!currentSubPath()) {
            <div class="folder-welcome">
              <span class="material-icons welcome-icon">folder_open</span>
              <h2>{{ metadata()?.fileName || metadata()?.spaceName }}</h2>
              <p>Select a file from the navigation to view its contents.</p>
            </div>
          } @else if (subFileLoading()) {
            <div class="loading-state">
              <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p>Loading file...</p>
            </div>
          } @else if (renderMode() === 'markdown') {
            <div class="markdown-container annotation-host" (click)="onMarkdownClick($event)">
              <article class="prose prose-lg max-w-none" [innerHTML]="renderedHtml()"></article>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'html') {
            <div class="html-container annotation-host">
              <iframe
                [src]="safeRawUrl()"
                sandbox="allow-scripts allow-same-origin allow-popups"
                class="html-iframe"
              ></iframe>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'image') {
            <div class="image-container annotation-host" [class.dragging]="imgZoom.dragging()" (mousedown)="imgZoom.onDragStart($event)">
              <img
                [src]="rawUrl()"
                [alt]="currentFileName()"
                class="preview-image"
                [style.width]="imgZoom.zoom() === 1 ? null : (imgZoom.zoom() * 100) + '%'"
              />
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="imgZoom.zoomOut()" [disabled]="imgZoom.zoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="imgZoom.reset()" title="Reset to 100%">
                {{ (imgZoom.zoom() * 100).toFixed(0) }}%
              </button>
              <button class="zoom-btn" (click)="imgZoom.zoomIn()" [disabled]="imgZoom.zoom() >= 4" title="Zoom in">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          } @else if (renderMode() === 'pdf') {
            <div class="pdf-container annotation-host">
              <iframe [src]="safeRawUrl()" class="pdf-iframe"></iframe>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'download') {
            <div class="download-state">
              <span class="material-icons download-icon">insert_drive_file</span>
              <h2>{{ currentFileName() }}</h2>
              <a [href]="rawUrl()" download class="btn btn-primary">
                <span class="material-icons">download</span>
                Download File
              </a>
            </div>
          }
        </main>
      } @else {
        <!-- Single file view (original behavior) -->
        <main class="viewer-content">
          @if (renderMode() === 'markdown') {
            <div class="markdown-container annotation-host" (click)="onMarkdownClick($event)">
              <article class="prose prose-lg max-w-none" [innerHTML]="renderedHtml()"></article>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'html') {
            <div class="html-container annotation-host">
              <iframe
                [src]="safeRawUrl()"
                sandbox="allow-scripts allow-same-origin allow-popups"
                class="html-iframe"
              ></iframe>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'image') {
            <div class="image-container annotation-host" [class.dragging]="imgZoom.dragging()" (mousedown)="imgZoom.onDragStart($event)">
              <img
                [src]="rawUrl()"
                [alt]="metadata()?.fileName"
                class="preview-image"
                [style.width]="imgZoom.zoom() === 1 ? null : (imgZoom.zoom() * 100) + '%'"
              />
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="imgZoom.zoomOut()" [disabled]="imgZoom.zoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="imgZoom.reset()" title="Reset to 100%">
                {{ (imgZoom.zoom() * 100).toFixed(0) }}%
              </button>
              <button class="zoom-btn" (click)="imgZoom.zoomIn()" [disabled]="imgZoom.zoom() >= 4" title="Zoom in">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          } @else if (renderMode() === 'pdf') {
            <div class="pdf-container annotation-host">
              <iframe [src]="safeRawUrl()" class="pdf-iframe"></iframe>
              <app-annotation-overlay
                [filePath]="currentFilePath()"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [shareToken]="token"
              />
            </div>
          } @else if (renderMode() === 'download') {
            <div class="download-state">
              <span class="material-icons download-icon">insert_drive_file</span>
              <h2>{{ metadata()?.fileName }}</h2>
              <a [href]="rawUrl()" download class="btn btn-primary">
                <span class="material-icons">download</span>
                Download File
              </a>
            </div>
          }
        </main>
      }
    </div>

    <!-- Recursive tree template -->
    <ng-template #treeTemplate let-nodes="nodes" let-level="level">
      @for (node of nodes; track node.path) {
        @if (node.isDirectory) {
          <div class="tree-folder" [style.paddingLeft.px]="level * 16 + 12" (click)="toggleFolder(node.path)">
            <span class="material-icons tree-icon">{{ isExpanded(node.path) ? 'expand_more' : 'chevron_right' }}</span>
            <span class="material-icons tree-icon folder-icon">{{ isExpanded(node.path) ? 'folder_open' : 'folder' }}</span>
            <span class="tree-name">{{ node.name }}</span>
          </div>
          @if (isExpanded(node.path) && node.children) {
            <ng-container *ngTemplateOutlet="treeTemplate; context: { nodes: node.children, level: level + 1 }"></ng-container>
          }
        } @else {
          <div
            class="tree-file"
            [style.paddingLeft.px]="level * 16 + 12"
            [class.active]="currentSubPath() === node.path"
            (click)="navigateToFile(node)"
          >
            <span class="material-icons tree-icon file-icon">{{ getFileIcon(node.name) }}</span>
            <span class="tree-name">{{ node.name }}</span>
          </div>
        }
      }
    </ng-template>
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
    .annotation-host {
      position: relative;
    }

    .public-viewer {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: #f5f5f5;
    }

    .public-viewer.folder-layout {
      flex-direction: column;
    }

    .public-viewer.folder-layout > .folder-sidebar,
    .public-viewer.folder-layout > .resize-handle,
    .public-viewer.folder-layout > .folder-content {
      /* These are arranged horizontally below the header */
    }

    /* Make folder layout work: header on top, then sidebar + content side by side */
    .public-viewer.folder-layout {
      display: grid;
      grid-template-rows: auto 1fr;
      grid-template-columns: auto 4px 1fr;
      min-height: 100vh;
    }

    .public-viewer.folder-layout > .viewer-header {
      grid-column: 1 / -1;
      grid-row: 1;
    }

    .public-viewer.folder-layout > .folder-sidebar {
      grid-row: 2;
      grid-column: 1;
    }

    .public-viewer.folder-layout > .resize-handle {
      grid-row: 2;
      grid-column: 2;
    }

    .public-viewer.folder-layout > .folder-content {
      grid-row: 2;
      grid-column: 3;
    }

    .viewer-header {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 12px 24px;
      background: white;
      border-bottom: 1px solid #e5e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #6fb3b8;
      font-weight: 600;
      font-size: 16px;
    }

    .brand-icon {
      font-size: 24px;
    }

    .header-breadcrumb {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-left: 16px;
      border-left: 1px solid #e5e7eb;
      font-size: 14px;
      color: #6b7280;
      overflow: hidden;
      min-width: 0;
    }

    .breadcrumb-segment {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex-shrink: 1;
    }

    .breadcrumb-current {
      color: #374151;
      font-weight: 500;
      flex-shrink: 0;
    }

    .breadcrumb-separator {
      font-size: 18px;
      color: #d1d5db;
      flex-shrink: 0;
    }

    .viewer-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    /* Password Gate */
    .password-gate {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 24px;
    }

    .password-card {
      background: white;
      border-radius: 12px;
      padding: 48px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    }

    .password-card .lock-icon {
      font-size: 56px;
      color: #6fb3b8;
      margin-bottom: 16px;
    }

    .password-card h2 {
      font-size: 20px;
      font-weight: 600;
      color: #374151;
      margin: 0 0 8px;
    }

    .password-card p {
      font-size: 14px;
      color: #6b7280;
      margin: 0 0 24px;
    }

    .password-card form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .password-field {
      padding: 10px 14px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      font-size: 14px;
      width: 100%;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }

    .password-field:focus {
      border-color: #6fb3b8;
      box-shadow: 0 0 0 3px rgba(111, 179, 184, 0.15);
    }

    .password-field.error {
      border-color: #ef4444;
    }

    .error-text {
      color: #ef4444;
      font-size: 13px;
      margin: 0;
    }

    .btn-unlock {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 24px;
      background: #6fb3b8;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-unlock:hover:not(:disabled) {
      background: #5a9a9f;
    }

    .btn-unlock:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Folder Sidebar */
    .folder-sidebar {
      background: white;
      border-right: 1px solid #e5e7eb;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      min-width: 200px;
      max-width: 500px;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
      font-size: 14px;
      color: #374151;

      .material-icons {
        font-size: 20px;
        color: #6fb3b8;
      }
    }

    .sidebar-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .folder-tree {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .tree-folder, .tree-file {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      cursor: pointer;
      font-size: 13px;
      color: #374151;
      user-select: none;
    }

    .tree-folder:hover, .tree-file:hover {
      background: #f3f4f6;
    }

    .tree-file.active {
      background: #e0f2f1;
      color: #00796b;
      font-weight: 500;
    }

    .tree-icon {
      font-size: 18px;
      color: #9ca3af;
      flex-shrink: 0;
    }

    .folder-icon {
      color: #6fb3b8;
    }

    .file-icon {
      color: #9ca3af;
    }

    .tree-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .resize-handle {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
    }

    .resize-handle:hover {
      background: #6fb3b8;
    }

    /* Folder content area */
    .folder-content {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      background: #f5f5f5;
    }

    .folder-welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 80px 24px;
      text-align: center;
      color: #6b7280;
    }

    .welcome-icon {
      font-size: 64px;
      color: #d1d5db;
      margin-bottom: 16px;
    }

    .folder-welcome h2 {
      margin: 0 0 8px;
      color: #374151;
      font-size: 20px;
    }

    .folder-welcome p {
      margin: 0;
      font-size: 14px;
    }

    /* Shared states */
    .loading-state, .error-state, .download-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 24px;
      text-align: center;
      color: #6b7280;

      h2 {
        margin: 16px 0 8px;
        color: #374151;
        font-size: 20px;
      }

      p {
        margin: 0;
        font-size: 14px;
      }
    }

    .error-icon {
      font-size: 64px;
      color: #d1d5db;
    }

    .download-icon {
      font-size: 64px;
      color: #6fb3b8;
    }

    .download-state .btn {
      margin-top: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      background: #6fb3b8;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;

      &:hover {
        background: #5a9a9f;
      }
    }

    .folder-content .markdown-container {
      margin: 24px;
      max-width: none;
    }

    .html-container, .pdf-container {
      flex: 1;
      display: flex;
    }

    .html-iframe, .pdf-iframe {
      flex: 1;
      border: none;
      width: 100%;
      min-height: calc(100vh - 60px);
    }

    .image-container {
      overflow: auto;
      flex: 1;
      width: 100%;
      cursor: grab;
      user-select: none;

      &.dragging { cursor: grabbing; }
    }

    .preview-image {
      width: 100%;
      max-width: none;
      height: auto;
      display: block;
      transition: width 0.15s ease;
    }

  `]
})
export class PublicViewerComponent implements OnInit, OnDestroy {
  token = '';
  metadata = signal<SharedFileMetadata | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  maintenanceMode = signal(false);
  renderMode = signal<RenderMode | null>(null);
  renderedHtml = signal<SafeHtml>('');
  rawUrl = signal('');
  safeRawUrl = signal<SafeResourceUrl>('');

  readonly imgZoom = new ImageZoomHandler();
  readonly getFileIcon = getFileIcon;

  // Password protection
  requiresPassword = signal(false);
  passwordInput = '';
  passwordError = signal<string | null>(null);
  verifyingPassword = signal(false);

  // Folder share
  shareType = signal<'FILE' | 'FOLDER'>('FILE');
  fileTree = signal<FileNode[]>([]);
  expandedFolders = signal<Set<string>>(new Set());
  currentSubPath = signal('');
  subFileLoading = signal(false);
  sidebarWidth = signal(280);
  private resizing = false;

  // Annotations
  annotationPermission = computed<AnnotationPermission>(() => {
    const meta = this.metadata();
    if (!meta) return 'VIEW';
    return meta.accessLevel === 'COMMENT' ? 'COMMENT' : 'VIEW';
  });

  currentFilePath = computed(() => {
    const subPath = this.currentSubPath();
    if (subPath) return subPath;
    return this.metadata()?.filePath || '';
  });

  currentFileName = computed(() => {
    const subPath = this.currentSubPath();
    if (subPath) return subPath.split('/').pop() || '';
    return this.metadata()?.fileName || '';
  });

  breadcrumbSegments = computed(() => {
    const meta = this.metadata();
    if (!meta) return [];
    if (this.shareType() === 'FOLDER') {
      const segments = [{ label: meta.spaceName }];
      if (meta.filePath) {
        segments.push(...meta.filePath.split('/').filter(p => p).map(p => ({ label: p })));
      }
      const subPath = this.currentSubPath();
      if (subPath) {
        segments.push(...subPath.split('/').filter(p => p).map(p => ({ label: p })));
      }
      return segments;
    }
    const parts = meta.filePath.split('/').filter(p => p.length > 0);
    return [
      { label: meta.spaceName },
      ...parts.map(p => ({ label: p }))
    ];
  });

  constructor(
    private router: Router,
    private location: Location,
    private sharedLinksService: SharedLinksService,
    private sanitizer: DomSanitizer,
    private titleService: Title,
    private metaService: Meta,
    private markdownService: MarkdownRenderService,
    private elementRef: ElementRef<HTMLElement>
  ) {
    // Render any ```mermaid blocks once Angular has flushed the new innerHTML.
    effect(() => {
      this.renderedHtml();
      setTimeout(() => this.markdownService.runMermaid(this.elementRef.nativeElement), 0);
    });
  }

  ngOnInit(): void {
    const url = this.router.url.split('?')[0].split('#')[0];
    const match = url.match(/^\/share\/([^\/]+)(?:\/(.*))?$/);
    if (!match) {
      this.error.set('Invalid share link.');
      this.loading.set(false);
      return;
    }
    this.token = match[1];
    if (match[2]) {
      this.currentSubPath.set(decodeURIComponent(match[2]));
    }

    this.sharedLinksService.getSharedFileMetadata(this.token).subscribe({
      next: (meta) => {
        this.metadata.set(meta);
        this.shareType.set(meta.shareType);
        this.setPageMeta(meta);

        if (meta.requiresPassword) {
          this.requiresPassword.set(true);
          this.loading.set(false);
        } else {
          this.loadContent();
        }
      },
      error: (err: HttpErrorResponse) => {
        if (err.status === 0 || err.status >= 500) {
          this.maintenanceMode.set(true);
        } else {
          this.error.set('This shared link is no longer available or has expired.');
        }
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.titleService.setTitle('DocuVault');
    this.metaService.removeTag('name="description"');
    this.metaService.removeTag('property="og:title"');
    this.metaService.removeTag('property="og:description"');
    this.metaService.removeTag('property="og:type"');
    this.metaService.removeTag('property="og:url"');
    this.metaService.removeTag('property="og:site_name"');
    this.metaService.removeTag('property="og:image"');
    this.metaService.removeTag('name="twitter:card"');
    this.metaService.removeTag('name="twitter:title"');
    this.metaService.removeTag('name="twitter:description"');
    this.metaService.removeTag('name="twitter:image"');
    document.removeEventListener('mousemove', this.onResize);
    document.removeEventListener('mouseup', this.stopResize);
    this.imgZoom.destroy();
  }

  retryLoad(): void {
    this.maintenanceMode.set(false);
    this.loading.set(true);
    this.ngOnInit();
  }

  submitPassword(event: Event): void {
    event.preventDefault();
    if (!this.passwordInput) return;

    this.verifyingPassword.set(true);
    this.passwordError.set(null);

    this.sharedLinksService.verifySharePassword(this.token, this.passwordInput).subscribe({
      next: (result) => {
        if (result.valid) {
          this.requiresPassword.set(false);
          this.loadContent();
        } else {
          this.passwordError.set('Incorrect password');
        }
        this.verifyingPassword.set(false);
      },
      error: () => {
        this.passwordError.set('Incorrect password');
        this.verifyingPassword.set(false);
      }
    });
  }

  private loadContent(): void {
    if (this.shareType() === 'FOLDER') {
      this.loadFolderContent();
    } else {
      this.loadSingleFile();
    }
  }

  private loadSingleFile(): void {
    const meta = this.metadata();
    if (!meta) return;

    this.rawUrl.set(`/api/shared/${this.token}/raw`);
    this.safeRawUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/api/shared/${this.token}/raw`));
    this.determineRenderMode(meta.extension);
  }

  private loadFolderContent(): void {
    // Load the file tree
    this.sharedLinksService.getShareFileTree(this.token).subscribe({
      next: (tree) => {
        this.fileTree.set(tree);
        this.loading.set(false);

        // If there's a deep-linked subpath, navigate to it
        const subPath = this.currentSubPath();
        if (subPath) {
          this.expandTreeToPath(subPath);
          this.loadSubPathContent(subPath);
        }
      },
      error: () => {
        this.error.set('Failed to load folder contents.');
        this.loading.set(false);
      }
    });
  }

  navigateToFile(node: FileNode): void {
    if (node.isDirectory) return;
    this.currentSubPath.set(node.path);
    this.loadSubPathContent(node.path);
    const url = `/share/${this.token}/${node.path}`;
    this.location.replaceState(url);
  }

  private loadSubPathContent(subPath: string): void {
    this.subFileLoading.set(true);
    this.renderMode.set(null);

    const ext = subPath.split('.').pop()?.toLowerCase() || '';

    // Set raw URL for folder subpath
    this.rawUrl.set(`/api/shared/${this.token}/raw/${subPath}`);
    this.safeRawUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/api/shared/${this.token}/raw/${subPath}`));

    if (ext === 'md') {
      this.sharedLinksService.getSharedFolderContent(this.token, subPath).subscribe({
        next: (content) => {
          this.renderMarkdownForSubPath(content, subPath);
          this.renderMode.set('markdown');
          this.subFileLoading.set(false);
        },
        error: () => {
          this.error.set('Failed to load file content.');
          this.subFileLoading.set(false);
        }
      });
    } else {
      this.determineRenderModeForFolder(ext);
      this.subFileLoading.set(false);
    }
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

  isExpanded(path: string): boolean {
    return this.expandedFolders().has(path);
  }

  private expandTreeToPath(path: string): void {
    const parts = path.split('/');
    const expanded = new Set(this.expandedFolders());
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      expanded.add(current);
    }
    this.expandedFolders.set(expanded);
  }


  // Resize handling
  startResize(event: MouseEvent): void {
    this.resizing = true;
    event.preventDefault();
    document.addEventListener('mousemove', this.onResize);
    document.addEventListener('mouseup', this.stopResize);
  }

  private onResize = (event: MouseEvent): void => {
    if (!this.resizing) return;
    const newWidth = Math.min(500, Math.max(200, event.clientX));
    this.sidebarWidth.set(newWidth);
  };

  private stopResize = (): void => {
    this.resizing = false;
    document.removeEventListener('mousemove', this.onResize);
    document.removeEventListener('mouseup', this.stopResize);
  };

  onMarkdownClick(event: MouseEvent): void {
    if (this.shareType() !== 'FOLDER') {
      handleMarkdownClick(event, '', () => {});
      return;
    }
    handleMarkdownClick(
      event,
      `/share/${this.token}/`,
      (subPath) => {
        this.currentSubPath.set(subPath);
        this.expandTreeToPath(subPath);
        this.loadSubPathContent(subPath);
        this.location.replaceState(`/share/${this.token}/${subPath}`);
      }
    );
  }

  private setPageMeta(meta: SharedFileMetadata): void {
    const title = meta.ogTitle
      ? `${meta.ogTitle} — ${meta.spaceName}`
      : `${meta.fileName} - ${meta.spaceName} | DocuVault`;
    const description = meta.ogDescription
      || `${meta.fileName} - shared from ${meta.spaceName} on DocuVault`;
    const shareUrl = window.location.href;
    const twitterCard = meta.ogImageUrl ? 'summary_large_image' : 'summary';

    this.titleService.setTitle(title);
    this.metaService.updateTag({ name: 'description', content: description });
    this.metaService.updateTag({ property: 'og:title', content: title });
    this.metaService.updateTag({ property: 'og:description', content: description });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });
    this.metaService.updateTag({ property: 'og:url', content: shareUrl });
    this.metaService.updateTag({ property: 'og:site_name', content: 'DocuVault' });
    this.metaService.updateTag({ name: 'twitter:card', content: twitterCard });
    this.metaService.updateTag({ name: 'twitter:title', content: title });
    this.metaService.updateTag({ name: 'twitter:description', content: description });
    if (meta.ogImageUrl) {
      this.metaService.updateTag({ property: 'og:image', content: meta.ogImageUrl });
      this.metaService.updateTag({ name: 'twitter:image', content: meta.ogImageUrl });
    }
  }

  private determineRenderMode(ext: string): void {
    const mode = getRenderMode(ext);
    if (mode === 'markdown') {
      this.renderMode.set('markdown');
      this.loadMarkdownContent();
    } else {
      this.renderMode.set(mode);
      this.loading.set(false);
    }
  }

  private determineRenderModeForFolder(ext: string): void {
    this.renderMode.set(getRenderMode(ext));
  }

  private loadMarkdownContent(): void {
    this.sharedLinksService.getSharedFileContent(this.token).subscribe({
      next: (content) => {
        const filePath = this.metadata()?.filePath || '';
        const docDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
        const linkPrefix = this.shareType() === 'FOLDER' ? `/share/${this.token}` : null;
        this.renderedHtml.set(this.markdownService.render(
          content, docDir, `/api/shared/${this.token}/files`, linkPrefix
        ));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load file content.');
        this.loading.set(false);
      }
    });
  }

  private renderMarkdownForSubPath(content: string, subPath: string): void {
    const dir = subPath.substring(0, subPath.lastIndexOf('/') + 1);
    this.renderedHtml.set(this.markdownService.render(
      content, dir, `/api/shared/${this.token}/files`, `/share/${this.token}`
    ));
  }
}
