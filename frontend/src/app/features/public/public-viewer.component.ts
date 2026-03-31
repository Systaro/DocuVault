import { Component, OnInit, OnDestroy, signal, computed, ViewEncapsulation } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SharedLinksService, SharedFileMetadata, FileNode } from '../../core/api/shared-links.service';
import { marked, Renderer } from 'marked';
import { DomSanitizer, SafeResourceUrl, SafeHtml, Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-public-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="public-viewer" [class.folder-layout]="shareType() === 'FOLDER' && !requiresPassword() && !loading() && !error()">
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
            <div class="markdown-container" (click)="onMarkdownClick($event)">
              <article class="prose prose-lg max-w-none" [innerHTML]="renderedHtml()"></article>
            </div>
          } @else if (renderMode() === 'html') {
            <div class="html-container">
              <iframe
                [src]="safeRawUrl()"
                sandbox="allow-scripts allow-same-origin allow-popups"
                class="html-iframe"
              ></iframe>
            </div>
          } @else if (renderMode() === 'image') {
            <div class="image-container">
              <img
                [src]="rawUrl()"
                [alt]="currentFileName()"
                class="preview-image"
                [style.width]="imageZoom() === 1 ? null : (imageZoom() * 100) + '%'"
              />
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="zoomOut()" [disabled]="imageZoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="resetZoom()" title="Reset to 100%">
                {{ (imageZoom() * 100).toFixed(0) }}%
              </button>
              <button class="zoom-btn" (click)="zoomIn()" [disabled]="imageZoom() >= 4" title="Zoom in">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          } @else if (renderMode() === 'pdf') {
            <div class="pdf-container">
              <iframe [src]="safeRawUrl()" class="pdf-iframe"></iframe>
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
            <div class="markdown-container" (click)="onMarkdownClick($event)">
              <article class="prose prose-lg max-w-none" [innerHTML]="renderedHtml()"></article>
            </div>
          } @else if (renderMode() === 'html') {
            <div class="html-container">
              <iframe
                [src]="safeRawUrl()"
                sandbox="allow-scripts allow-same-origin allow-popups"
                class="html-iframe"
              ></iframe>
            </div>
          } @else if (renderMode() === 'image') {
            <div class="image-container">
              <img
                [src]="rawUrl()"
                [alt]="metadata()?.fileName"
                class="preview-image"
                [style.width]="imageZoom() === 1 ? null : (imageZoom() * 100) + '%'"
              />
            </div>
            <div class="zoom-toolbar">
              <button class="zoom-btn" (click)="zoomOut()" [disabled]="imageZoom() <= 0.25" title="Zoom out">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                </svg>
              </button>
              <button class="zoom-level" (click)="resetZoom()" title="Reset to 100%">
                {{ (imageZoom() * 100).toFixed(0) }}%
              </button>
              <button class="zoom-btn" (click)="zoomIn()" [disabled]="imageZoom() >= 4" title="Zoom in">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          } @else if (renderMode() === 'pdf') {
            <div class="pdf-container">
              <iframe [src]="safeRawUrl()" class="pdf-iframe"></iframe>
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
            <span class="material-icons tree-icon file-icon">{{ getTreeFileIcon(node.name) }}</span>
            <span class="tree-name">{{ node.name }}</span>
          </div>
        }
      }
    </ng-template>
  `,
  encapsulation: ViewEncapsulation.None,
  styles: [`
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

    .markdown-container {
      max-width: 800px;
      width: 100%;
      margin: 24px auto;
      padding: 48px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .folder-content .markdown-container {
      margin: 24px;
      max-width: none;
    }

    .markdown-container article {
      color: #1f2937;
      font-size: 16px;
      line-height: 1.75;
    }

    .markdown-container :is(h1, h2, h3, h4, h5, h6) {
      color: #111827;
      font-weight: 700;
      line-height: 1.3;
      margin-top: 2em;
      margin-bottom: 0.75em;
    }

    .markdown-container :is(h1, h2, h3, h4, h5, h6):first-child {
      margin-top: 0;
    }

    .markdown-container h1 {
      font-size: 2em;
      padding-bottom: 0.3em;
      border-bottom: 1px solid #e5e7eb;
    }

    .markdown-container h2 {
      font-size: 1.5em;
      padding-bottom: 0.25em;
      border-bottom: 1px solid #e5e7eb;
    }

    .markdown-container h3 { font-size: 1.25em; }
    .markdown-container h4 { font-size: 1em; }

    .markdown-container p { margin: 0 0 1em; }

    .markdown-container ul, .markdown-container ol {
      margin: 0 0 1em;
      padding-left: 2em;
    }

    .markdown-container ul { list-style-type: disc; }
    .markdown-container ol { list-style-type: decimal; }
    .markdown-container li { margin-bottom: 0.5em; }
    .markdown-container li > ul, .markdown-container li > ol { margin-top: 0.5em; margin-bottom: 0; }

    .markdown-container code {
      background: #f3f4f6;
      padding: 0.2em 0.4em;
      border-radius: 4px;
      font-size: 0.875em;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      color: #d6336c;
    }

    .markdown-container pre {
      background: #1f2937;
      color: #e5e7eb;
      padding: 16px 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 0 0 1em;
      line-height: 1.6;
    }

    .markdown-container pre code {
      background: none;
      padding: 0;
      border-radius: 0;
      font-size: 0.875em;
      color: inherit;
    }

    .markdown-container blockquote {
      border-left: 4px solid #6fb3b8;
      margin: 0 0 1em;
      padding: 0.5em 1em;
      color: #4b5563;
      background: #f9fafb;
      border-radius: 0 4px 4px 0;
    }

    .markdown-container blockquote p:last-child { margin-bottom: 0; }

    .markdown-container table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 1em;
      font-size: 0.9em;
    }

    .markdown-container th, .markdown-container td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }

    .markdown-container th {
      background: #f9fafb;
      font-weight: 600;
    }

    .markdown-container tr:nth-child(even) { background: #f9fafb; }

    .markdown-container a {
      color: #6fb3b8;
      text-decoration: none;
    }

    .markdown-container a:hover { text-decoration: underline; }

    .markdown-container strong {
      font-weight: 700;
      color: #111827;
    }

    .markdown-container em { font-style: italic; }

    .markdown-container hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 2em 0;
    }

    .markdown-container img {
      max-width: 100%;
      border-radius: 6px;
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
    }

    .preview-image {
      width: 100%;
      height: auto;
      display: block;
      transition: width 0.15s ease;
    }

    .zoom-toolbar {
      position: fixed;
      bottom: 20px;
      left: 20px;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 6px 8px;
      background: var(--surface, #fff);
      border: 1px solid var(--border, #e5e7eb);
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
      z-index: 200;
    }

    .zoom-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: none;
      color: var(--text-primary, #111);
      cursor: pointer;
      transition: background 0.15s;

      &:hover:not(:disabled) { background: var(--surface-hover, #f3f4f6); }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .zoom-level {
      min-width: 52px;
      height: 32px;
      border-radius: 6px;
      border: none;
      background: none;
      color: var(--text-primary, #111);
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;

      &:hover { background: var(--surface-hover, #f3f4f6); }
    }
  `]
})
export class PublicViewerComponent implements OnInit, OnDestroy {
  token = '';
  metadata = signal<SharedFileMetadata | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  renderMode = signal<'markdown' | 'html' | 'image' | 'pdf' | 'download' | null>(null);
  renderedHtml = signal<SafeHtml>('');
  rawUrl = signal('');
  safeRawUrl = signal<SafeResourceUrl>('');
  imageZoom = signal(1);

  zoomIn(): void { this.imageZoom.update(z => Math.min(z + 0.25, 4)); }
  zoomOut(): void { this.imageZoom.update(z => Math.max(z - 0.25, 0.25)); }
  resetZoom(): void { this.imageZoom.set(1); }
  onImageWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY < 0) this.zoomIn(); else this.zoomOut();
  }

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
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private sharedLinksService: SharedLinksService,
    private sanitizer: DomSanitizer,
    private titleService: Title,
    private metaService: Meta
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.error.set('Invalid share link.');
      this.loading.set(false);
      return;
    }

    // Extract subpath from the full URL
    const url = this.router.url.split('?')[0].split('#')[0];
    const prefix = `/share/${this.token}/`;
    if (url.startsWith(prefix) && url.length > prefix.length) {
      this.currentSubPath.set(decodeURIComponent(url.substring(prefix.length)));
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
      error: () => {
        this.error.set('This shared link is no longer available or has expired.');
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
    this.metaService.removeTag('name="twitter:card"');
    this.metaService.removeTag('name="twitter:title"');
    this.metaService.removeTag('name="twitter:description"');
    document.removeEventListener('mousemove', this.onResize);
    document.removeEventListener('mouseup', this.stopResize);
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
          this.renderMarkdown(content, subPath);
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

  getTreeFileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'md': return 'description';
      case 'pdf': return 'picture_as_pdf';
      case 'html': case 'htm': return 'code';
      case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': return 'image';
      default: return 'insert_drive_file';
    }
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
    const target = event.target as HTMLElement;
    const anchor = target.closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (href && href.startsWith('#')) {
      event.preventDefault();
      const id = href.slice(1);
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
      history.replaceState(null, '', window.location.pathname + href);
    }
  }

  private setPageMeta(meta: SharedFileMetadata): void {
    const pageTitle = `${meta.fileName} - ${meta.spaceName} | DocuVault`;
    const description = `${meta.fileName} - shared from ${meta.spaceName} on DocuVault`;
    const breadcrumb = meta.filePath.replace(/\//g, ' / ');
    const shareUrl = window.location.href;

    this.titleService.setTitle(pageTitle);
    this.metaService.updateTag({ name: 'description', content: description });
    this.metaService.updateTag({ property: 'og:title', content: `${meta.fileName} - ${meta.spaceName}` });
    this.metaService.updateTag({ property: 'og:description', content: breadcrumb });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });
    this.metaService.updateTag({ property: 'og:url', content: shareUrl });
    this.metaService.updateTag({ property: 'og:site_name', content: 'DocuVault' });
    this.metaService.updateTag({ name: 'twitter:card', content: 'summary' });
    this.metaService.updateTag({ name: 'twitter:title', content: `${meta.fileName} - ${meta.spaceName}` });
    this.metaService.updateTag({ name: 'twitter:description', content: breadcrumb });
  }

  private determineRenderMode(ext: string): void {
    const extension = ext.toLowerCase();
    if (extension === 'md') {
      this.renderMode.set('markdown');
      this.loadMarkdownContent();
    } else if (extension === 'html' || extension === 'htm') {
      this.renderMode.set('html');
      this.loading.set(false);
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(extension)) {
      this.renderMode.set('image');
      this.loading.set(false);
    } else if (extension === 'pdf') {
      this.renderMode.set('pdf');
      this.loading.set(false);
    } else {
      this.renderMode.set('download');
      this.loading.set(false);
    }
  }

  private determineRenderModeForFolder(ext: string): void {
    if (ext === 'html' || ext === 'htm') {
      this.renderMode.set('html');
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) {
      this.renderMode.set('image');
    } else if (ext === 'pdf') {
      this.renderMode.set('pdf');
    } else {
      this.renderMode.set('download');
    }
  }

  private loadMarkdownContent(): void {
    this.sharedLinksService.getSharedFileContent(this.token).subscribe({
      next: (content) => {
        const filePath = this.metadata()?.filePath || '';
        const docDir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
        this.renderMarkdown(content, filePath, docDir);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load file content.');
        this.loading.set(false);
      }
    });
  }

  private renderMarkdown(content: string, filePath: string, docDir?: string): void {
    const renderer = new Renderer();
    renderer.heading = (text: string, level: number, raw: string) => {
      const id = raw.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').trim();
      return `<h${level} id="${id}">${text}</h${level}>\n`;
    };
    let html = marked.parse(content, { renderer }) as string;

    // Determine the directory for resolving relative paths
    const dir = docDir ?? filePath.substring(0, filePath.lastIndexOf('/') + 1);

    // Rewrite relative image paths
    html = html.replace(
      /(<img\s[^>]*src=")(?!https?:\/\/|\/api\/)([^"]+)(")/g,
      (_match, pre, src, post) => {
        const resolved = this.resolveRelativePath(dir + src);
        return `${pre}/api/shared/${this.token}/files/${resolved}${post}`;
      }
    );
    this.renderedHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
  }

  private resolveRelativePath(path: string): string {
    const parts = path.split('/');
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        resolved.pop();
      } else if (part !== '.' && part !== '') {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  }
}
