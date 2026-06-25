import { Component, OnInit, OnDestroy, signal, computed, ViewEncapsulation, effect, ElementRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { SafeResourceUrl, SafeHtml, DomSanitizer } from '@angular/platform-browser';
import { SpacesService, Space } from '../../core/api/spaces.service';
import { DocumentsService, FileNode } from '../../core/api/documents.service';
import { AnnotationsService, AnnotationPermission } from '../../core/api/annotations.service';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { AnnotationOverlayComponent } from '../../shared/components/annotation-overlay.component';
import { ShareLinkDialogComponent } from '../../shared/components/share-link-dialog.component';
import { ImageZoomHandler } from '../../shared/utils/image-zoom';
import { handleMarkdownClick } from '../../shared/utils/markdown-link-handler';
import { RenderMode, getRenderMode, getFileIcon, getExtension } from '../../shared/utils/file-utils';

@Component({
  selector: 'app-preview',
  standalone: true,
  imports: [CommonModule, AnnotationOverlayComponent, ShareLinkDialogComponent],
  template: `
    <div class="preview-shell">
      <!-- Hover zone: reveals the auto-hidden topbar when the cursor nears the top -->
      <div class="header-hover-zone" aria-hidden="true"></div>
      <!-- Header -->
      <header class="preview-header">
        <button class="header-icon-btn" (click)="sidebarOpen.set(!sidebarOpen())" title="Toggle file browser">
          <span class="material-icons">{{ sidebarOpen() ? 'menu_open' : 'menu' }}</span>
        </button>
        <button class="header-icon-btn" (click)="goBack()" title="Back to editor">
          <span class="material-icons">arrow_back</span>
        </button>
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
        @if (currentPath()) {
          <button class="header-icon-btn header-action-end" (click)="showShareDialog.set(true)" title="Share">
            <span class="material-icons">share</span>
          </button>
        }
      </header>

      <div class="preview-body">
        <!-- Collapsible sidebar -->
        <aside class="preview-sidebar" [class.open]="sidebarOpen()">
          <div class="sidebar-header">
            <span class="material-icons">folder_special</span>
            <span class="sidebar-title">{{ space()?.name }}</span>
          </div>
          <div class="folder-tree">
            @if (fileTree().length === 0 && !treeLoading()) {
              <div class="tree-empty">
                <span class="material-icons">folder_off</span>
                <p>No files</p>
              </div>
            } @else if (treeLoading()) {
              <div class="tree-empty">
                <svg class="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
            } @else {
              <ng-container *ngTemplateOutlet="treeTemplate; context: { nodes: fileTree(), level: 0 }"></ng-container>
            }
          </div>
        </aside>

        @if (sidebarOpen()) {
          <div class="sidebar-backdrop" (click)="sidebarOpen.set(false)"></div>
        }

        <!-- Content area -->
        <main class="preview-content">
          @if (loading()) {
            <div class="loading-state">
              <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p>Loading preview...</p>
            </div>
          } @else if (error()) {
            <div class="error-state">
              <span class="material-icons error-icon">error_outline</span>
              <h2>Preview Unavailable</h2>
              <p>{{ error() }}</p>
            </div>
          } @else if (!currentPath()) {
            <div class="folder-welcome">
              <span class="material-icons welcome-icon">folder_open</span>
              <h2>{{ space()?.name }}</h2>
              <p>Select a file from the sidebar to view its contents.</p>
            </div>
          } @else if (renderMode() === 'markdown') {
            <div class="markdown-container annotation-host" (click)="onMarkdownClick($event)">
              <article class="prose prose-lg max-w-none" [innerHTML]="renderedHtml()"></article>
              <app-annotation-overlay
                [spaceId]="spaceId"
                [filePath]="currentPath()!"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [currentUserId]="currentUserId()"
                [allowComment]="false"
              />
            </div>
          } @else if (renderMode() === 'html') {
            <div class="html-container annotation-host">
              <iframe [src]="safeRawUrl()" sandbox="allow-scripts allow-same-origin allow-popups" class="html-iframe"></iframe>
              <app-annotation-overlay
                [spaceId]="spaceId"
                [filePath]="currentPath()!"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [currentUserId]="currentUserId()"
                [allowComment]="false"
              />
            </div>
          } @else if (renderMode() === 'image') {
            <div class="image-container annotation-host" [class.dragging]="imgZoom.dragging()" (mousedown)="imgZoom.onDragStart($event)">
              <img [src]="rawUrl()" [alt]="currentFileName()" class="preview-image"
                [style.width]="imgZoom.zoom() === 1 ? null : (imgZoom.zoom() * 100) + '%'" />
              <app-annotation-overlay
                [spaceId]="spaceId"
                [filePath]="currentPath()!"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [currentUserId]="currentUserId()"
                [allowComment]="false"
              />
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="imgZoom.zoomOut()" [disabled]="imgZoom.zoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="imgZoom.reset()" title="Reset to 100%">{{ (imgZoom.zoom() * 100).toFixed(0) }}%</button>
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
                [spaceId]="spaceId"
                [filePath]="currentPath()!"
                [renderMode]="renderMode()!"
                [permission]="annotationPermission()"
                [currentUserId]="currentUserId()"
                [allowComment]="false"
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
      </div>
    </div>

    @if (showShareDialog() && currentPath()) {
      <app-share-link-dialog
        [spaceId]="spaceId"
        [filePath]="currentPath()!"
        (close)="showShareDialog.set(false)"
      />
    }

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
            [class.active]="currentPath() === node.path"
            (click)="navigateToFile(node)"
          >
            <img class="tree-icon file-icon-img" [src]="getFileIcon(node.name)" [alt]="node.name" />
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

    .preview-shell {
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: #f5f5f5;
    }

    .preview-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      background: white;
      border-bottom: 1px solid #e5e7eb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
      flex-shrink: 0;
      /* Auto-hide: lift the bar off-screen; it slides back in on hover (see .header-hover-zone). */
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 30;
      transform: translateY(-100%);
      transition: transform 0.25s ease;
    }

    /* Thin strip pinned to the top edge that catches the cursor and reveals the bar. */
    .header-hover-zone {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 16px;
      z-index: 29;
    }

    .header-hover-zone:hover ~ .preview-header,
    .preview-header:hover {
      transform: translateY(0);
    }

    .header-icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 8px;
      background: none;
      color: #6b7280;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }

    .header-icon-btn:hover {
      background: #f3f4f6;
      color: #374151;
    }

    .header-action-end {
      margin-left: auto;
    }

    .header-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #6fb3b8;
      font-weight: 600;
      font-size: 16px;
      flex-shrink: 0;
    }

    .brand-icon { font-size: 24px; }

    .header-breadcrumb {
      display: flex;
      align-items: center;
      gap: 4px;
      padding-left: 12px;
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

    .preview-body {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    .preview-sidebar {
      width: 280px;
      background: white;
      border-right: 1px solid #e5e7eb;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transform: translateX(-100%);
      margin-left: -280px;
      transition: transform 0.25s ease, margin-left 0.25s ease;
      z-index: 15;
      overflow: hidden;
    }

    .preview-sidebar.open {
      transform: translateX(0);
      margin-left: 0;
    }

    .sidebar-backdrop { display: none; }

    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid #e5e7eb;
      font-weight: 600;
      font-size: 14px;
      color: #374151;
      flex-shrink: 0;
    }

    .sidebar-header .material-icons {
      font-size: 20px;
      color: #6fb3b8;
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

    .tree-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      color: #9ca3af;
      gap: 8px;
    }

    .tree-empty .material-icons { font-size: 32px; }
    .tree-empty p { margin: 0; font-size: 13px; }

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

    .tree-folder:hover, .tree-file:hover { background: #f3f4f6; }

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

    .folder-icon { color: #6fb3b8; }
    .file-icon { color: #9ca3af; }

    .file-icon-img {
      width: 16px;
      height: 16px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .tree-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .preview-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      min-width: 0;
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

    .folder-welcome h2 { margin: 0 0 8px; color: #374151; font-size: 20px; }
    .folder-welcome p { margin: 0; font-size: 14px; }

    .loading-state, .error-state, .download-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 80px 24px;
      text-align: center;
      color: #6b7280;
      flex: 1;
    }

    .loading-state h2, .error-state h2, .download-state h2 { margin: 16px 0 8px; color: #374151; font-size: 20px; }
    .loading-state p, .error-state p, .download-state p { margin: 0; font-size: 14px; }

    .error-icon { font-size: 64px; color: #d1d5db; }
    .download-icon { font-size: 64px; color: #6fb3b8; }

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
    }

    .download-state .btn:hover { background: #5a9a9f; }

    .html-container, .pdf-container { flex: 1; display: flex; }

    .html-iframe, .pdf-iframe {
      flex: 1;
      border: none;
      width: 100%;
      min-height: 100%;
    }

    .image-container {
      overflow: auto;
      flex: 1;
      width: 100%;
      cursor: grab;
      user-select: none;
    }

    .image-container.dragging { cursor: grabbing; }

    .preview-image {
      width: 100%;
      max-width: none;
      height: auto;
      display: block;
      transition: width 0.15s ease;
    }

    @media (max-width: 768px) {
      .preview-sidebar {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        margin-left: 0;
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.15);
      }

      .preview-sidebar:not(.open) { transform: translateX(-100%); }

      .sidebar-backdrop {
        display: block;
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.3);
        z-index: 14;
      }
    }
  `]
})
export class PreviewComponent implements OnInit, OnDestroy {
  spaceId = '';
  private filePath = '';
  private destroy$ = new Subject<void>();

  space = signal<Space | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  renderMode = signal<RenderMode | null>(null);
  renderedHtml = signal<SafeHtml>('');
  rawUrl = signal('');
  safeRawUrl = signal<SafeResourceUrl>('');

  sidebarOpen = signal(false);
  showShareDialog = signal(false);
  fileTree = signal<FileNode[]>([]);
  treeLoading = signal(true);
  expandedFolders = signal<Set<string>>(new Set());
  currentPath = signal('');

  annotationPermission = signal<AnnotationPermission>('VIEW');
  currentUserId = signal<string | null>(null);

  readonly imgZoom = new ImageZoomHandler();
  readonly getFileIcon = getFileIcon;

  currentFileName = computed(() => {
    const path = this.currentPath();
    return path ? path.split('/').pop() || '' : '';
  });

  breadcrumbSegments = computed(() => {
    const space = this.space();
    if (!space) return [];
    const segments = [{ label: space.name }];
    const path = this.currentPath();
    if (path) {
      segments.push(...path.split('/').filter(p => p).map(p => ({ label: p })));
    }
    return segments;
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private spacesService: SpacesService,
    private documentsService: DocumentsService,
    private markdownService: MarkdownRenderService,
    private annotationsService: AnnotationsService,
    private sanitizer: DomSanitizer,
    private elementRef: ElementRef<HTMLElement>
  ) {
    // Render any ```mermaid blocks once Angular has flushed the new innerHTML.
    effect(() => {
      this.renderedHtml();
      setTimeout(() => {
        this.markdownService.runMermaid(this.elementRef.nativeElement);
        this.markdownService.runDrawio(this.elementRef.nativeElement);
        this.markdownService.runImageLightbox(this.elementRef.nativeElement);
      }, 0);
    });
  }

  ngOnInit(): void {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId') || '';
    if (!this.spaceId) {
      this.error.set('Invalid preview link.');
      return;
    }

    const url = this.router.url.split('?')[0].split('#')[0];
    const prefix = `/preview/${this.spaceId}`;
    if (url.length > prefix.length + 1) {
      this.filePath = decodeURIComponent(url.substring(prefix.length + 1));
    }

    forkJoin({
      space: this.spacesService.getSpace(this.spaceId),
      tree: this.documentsService.getFileTree(this.spaceId)
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: ({ space, tree }) => {
        this.space.set(space);
        this.fileTree.set(tree);
        this.treeLoading.set(false);

        // Fetch annotation permission
        this.annotationsService.getMyPermission(this.spaceId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (res) => {
              const level = res.level as AnnotationPermission;
              // Map EDIT/ADMIN to annotation permission levels
              this.annotationPermission.set(level === 'VIEW' ? 'VIEW' : level === 'EDIT' ? 'EDIT' : level === 'ADMIN' ? 'ADMIN' : 'VIEW');
            },
            error: () => {} // keep default VIEW
          });

        if (this.filePath) {
          this.currentPath.set(this.filePath);
          this.expandTreeToPath(this.filePath);
          this.loadFileContent(this.filePath);
        }
      },
      error: () => {
        this.error.set('Space not found or access denied.');
        this.treeLoading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.imgZoom.destroy();
  }

  goBack(): void {
    this.location.back();
  }

  // ── File tree ──

  navigateToFile(node: FileNode): void {
    if (node.isDirectory) return;
    this.currentPath.set(node.path);
    this.loadFileContent(node.path);
    this.location.replaceState(`/preview/${this.spaceId}/${node.path}`);
  }

  toggleFolder(path: string): void {
    const expanded = new Set(this.expandedFolders());
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
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

  // ── Content loading ──

  private loadFileContent(path: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.renderMode.set(null);
    this.imgZoom.reset();

    const ext = getExtension(path);
    const mode = getRenderMode(ext);
    this.rawUrl.set(`/api/spaces/${this.spaceId}/files/${path}`);
    this.safeRawUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/api/spaces/${this.spaceId}/files/${path}`));

    if (mode === 'markdown') {
      this.documentsService.getDocument(this.spaceId, path)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (doc) => {
            const docDir = path.substring(0, path.lastIndexOf('/') + 1);
            this.renderedHtml.set(this.markdownService.render(
              doc.content,
              docDir,
              `/api/spaces/${this.spaceId}/files`,
              `/preview/${this.spaceId}`
            ));
            this.renderMode.set('markdown');
            this.loading.set(false);
          },
          error: () => {
            this.error.set('Failed to load file content.');
            this.loading.set(false);
          }
        });
    } else {
      this.renderMode.set(mode);
      this.loading.set(false);
    }
  }

  onMarkdownClick(event: MouseEvent): void {
    handleMarkdownClick(
      event,
      `/preview/${this.spaceId}/`,
      (filePath) => {
        this.currentPath.set(filePath);
        this.expandTreeToPath(filePath);
        this.loadFileContent(filePath);
        this.location.replaceState(`/preview/${this.spaceId}/${filePath}`);
      }
    );
  }
}
