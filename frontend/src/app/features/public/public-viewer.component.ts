import { Component, OnInit, OnDestroy, signal, computed, ViewEncapsulation, effect, ElementRef, NgZone, HostListener, viewChild, afterNextRender } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { SharedLinksService, SharedFileMetadata, FileNode } from '../../core/api/shared-links.service';
import { DomSanitizer, SafeResourceUrl, SafeHtml, Meta } from '@angular/platform-browser';
import { MarkdownRenderService } from '../../shared/services/markdown-render.service';
import { AnnotationOverlayComponent } from '../../shared/components/annotation-overlay.component';
import { AnnotationPermission } from '../../core/api/annotations.service';
import { ImageZoomHandler } from '../../shared/utils/image-zoom';
import { handleMarkdownClick } from '../../shared/utils/markdown-link-handler';
import { RenderMode, getRenderMode, getFileIcon, getExtension, sharedFileUrl } from '../../shared/utils/file-utils';
import { FileThumbComponent } from '../../shared/components/file-thumb.component';
import { DocxViewComponent } from '../../shared/components/docx-view.component';
import { BrandLogoComponent } from '../../shared/components/brand-logo.component';
import { BrandingService } from '../../core/branding/branding.service';
import { PageTitleService } from '../../core/branding/page-title.service';
import { PdfExportService } from '../../core/api/pdf-export.service';
import { ToastService } from '../../shared/services/toast.service';

/** Near the top of a document the bar always shows. */
const HEADER_REVEAL_ZONE_PX = 40;
/** Smaller movements (a touch settling, rubber-banding) leave the bar as it is. */
const SCROLL_JITTER_PX = 4;
/** Prefix of the per-share key that remembers a viewer put the bar away. */
const HEADER_HIDDEN_KEY_PREFIX = 'docuvault.share.headerHidden.';

function readHeaderHidden(token: string): boolean {
  try {
    return localStorage.getItem(HEADER_HIDDEN_KEY_PREFIX + token) === '1';
  } catch {
    return false;
  }
}

function rememberHeaderHidden(token: string, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HEADER_HIDDEN_KEY_PREFIX + token, '1');
    else localStorage.removeItem(HEADER_HIDDEN_KEY_PREFIX + token);
  } catch {
    // Private mode or blocked storage: the choice lasts until the page is left.
  }
}

@Component({
  selector: 'app-public-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, AnnotationOverlayComponent, FileThumbComponent, BrandLogoComponent, DocxViewComponent],
  template: `
    <div class="public-viewer" [class.folder-layout]="folderLayout()">
      <!-- Header -->
      <header
        #viewerHeader
        class="viewer-header"
        [class.tucked]="headerHidden()"
        [style.margin-top.px]="headerMarginTop()"
        [attr.inert]="headerHiddenByViewer() ? '' : null"
      >
        @if (folderLayout()) {
          <button
            type="button"
            class="icon-btn folder-drawer-btn"
            [attr.aria-expanded]="folderDrawerOpen()"
            aria-label="Show files"
            title="Show files"
            (click)="folderDrawerOpen.set(true)"
          >
            <span translate="no" class="material-icons">menu</span>
          </button>
        }
        <app-brand-logo class="header-brand" />
        @if (breadcrumbSegments().length) {
          <nav class="header-breadcrumb" aria-label="File location">
            @for (segment of breadcrumbSegments(); track segment.label; let last = $last) {
              <span class="breadcrumb-segment" [class.breadcrumb-current]="last">{{ segment.label }}</span>
              @if (!last) {
                <span translate="no" class="breadcrumb-separator material-icons">chevron_right</span>
              }
            }
          </nav>
        }
        <div class="header-actions">
          @if (fileActionsVisible()) {
            @if (canExportPdf()) {
              <button type="button" class="header-action" (click)="exportAsPdf()" title="Export as PDF" aria-label="Export as PDF">
                <span translate="no" class="material-icons">picture_as_pdf</span>
                <span class="header-action-label">Export as PDF</span>
              </button>
            }
            <a class="header-action" [href]="downloadUrl()" download title="Download file" aria-label="Download file">
              <span translate="no" class="material-icons">download</span>
              <span class="header-action-label">Download</span>
            </a>
          }
          <button
            #headerHideBtn
            type="button"
            class="icon-btn header-hide-btn"
            title="Hide toolbar"
            aria-label="Hide toolbar"
            (click)="hideHeader()"
          >
            <span translate="no" class="material-icons">expand_less</span>
          </button>
        </div>
      </header>
      @if (headerHiddenByViewer()) {
        <button
          #headerRevealBtn
          type="button"
          class="header-reveal"
          title="Show toolbar"
          aria-label="Show toolbar"
          (click)="showHeader()"
        >
          <span translate="no" class="material-icons">expand_more</span>
        </button>
      }

      <!-- Password Gate -->
      @if (requiresPassword()) {
        <main class="viewer-content">
          <div class="password-gate">
            <div class="password-card">
              <span translate="no" class="material-icons lock-icon">lock</span>
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
                    <span translate="no" class="material-icons animate-spin">sync</span>
                    Verifying...
                  } @else {
                    <span translate="no" class="material-icons">lock_open</span>
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
            <span translate="no" class="material-icons error-icon">build_circle</span>
            <h2>Wartungsmodus</h2>
            <p>Die Seite befindet sich gerade im Wartungsmodus. Bitte versuche es in wenigen Minuten erneut.</p>
            <button type="button" class="btn btn-primary" (click)="retryLoad()">
              <span translate="no" class="material-icons">refresh</span>
              Erneut versuchen
            </button>
          </div>
        </main>
      } @else if (error()) {
        <main class="viewer-content">
          <div class="error-state">
            <span translate="no" class="material-icons error-icon">link_off</span>
            <h2>Link Not Available</h2>
            <p>{{ error() }}</p>
          </div>
        </main>
      } @else if (shareType() === 'FOLDER') {
        <!-- Folder browser layout -->
        @if (folderDrawerOpen()) {
          <div class="folder-drawer-backdrop" (click)="folderDrawerOpen.set(false)"></div>
        }
        <aside class="folder-sidebar" [class.drawer-open]="folderDrawerOpen()" [style.--sidebar-width.px]="sidebarWidth()">
          <div class="sidebar-header">
            <span translate="no" class="material-icons">folder_special</span>
            <span class="sidebar-title">{{ metadata()?.fileName || metadata()?.spaceName }}</span>
            <button type="button" class="icon-btn folder-drawer-close" aria-label="Close files" title="Close files" (click)="folderDrawerOpen.set(false)">
              <span translate="no" class="material-icons">close</span>
            </button>
          </div>
          <div class="folder-tree">
            <ng-container *ngTemplateOutlet="treeTemplate; context: { nodes: fileTree(), level: 0 }"></ng-container>
          </div>
        </aside>
        <div class="resize-handle" (mousedown)="startResize($event)"></div>
        <main class="folder-content">
          @if (!currentSubPath()) {
            <div class="folder-browser">
              @if (currentFolderPath()) {
                <nav class="folder-browser-crumbs">
                  <a (click)="setCurrentFolder('')" class="folder-browser-crumb">{{ metadata()?.fileName || metadata()?.spaceName }}</a>
                  @for (seg of folderBrowserCrumbs(); track seg.path; let last = $last) {
                    <span class="folder-browser-crumb-sep">/</span>
                    @if (last) {
                      <span class="folder-browser-crumb folder-browser-crumb--active">{{ seg.name }}</span>
                    } @else {
                      <a (click)="setCurrentFolder(seg.path)" class="folder-browser-crumb">{{ seg.name }}</a>
                    }
                  }
                </nav>
              }
              <h2 class="folder-browser-title">
                <span translate="no" class="material-icons">folder_open</span>
                {{ folderBrowserTitle() }}
              </h2>
              <div class="folder-browser-listing">
                @if (currentFolderPath()) {
                  <a class="folder-browser-row folder-browser-row--up" (click)="setCurrentFolder(parentFolderPath())">
                    <span translate="no" class="material-icons">arrow_upward</span>
                    <span class="folder-browser-name">Up to {{ parentFolderLabel() }}</span>
                  </a>
                }
                @if (currentFolderItems().length === 0) {
                  <div class="folder-browser-empty">This folder is empty.</div>
                }
                @for (item of currentFolderItems(); track item.path) {
                  @if (item.isDirectory) {
                    <a class="folder-browser-row folder-browser-row--folder" (click)="setCurrentFolder(item.path)">
                      <span translate="no" class="material-icons folder-icon">folder</span>
                      <span class="folder-browser-name">{{ item.name }}</span>
                    </a>
                  } @else {
                    <a class="folder-browser-row folder-browser-row--file" (click)="navigateToFile(item)">
                      <app-file-thumb [url]="sharedFileUrl(token, item.path)" [name]="item.name" />
                      <span class="folder-browser-name">{{ item.name }}</span>
                    </a>
                  }
                }
              </div>
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
                (load)="followFrameScroll($event)"
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
          } @else if (renderMode() === 'docx') {
            <app-docx-view class="docx-container" [url]="rawUrl()" />
          } @else if (renderMode() === 'download' || isMediaMode()) {
            <div class="download-state">
              <span translate="no" class="material-icons download-icon">insert_drive_file</span>
              <h2>{{ currentFileName() }}</h2>
              <a [href]="rawUrl()" download class="btn btn-primary">
                <span translate="no" class="material-icons">download</span>
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
                (load)="followFrameScroll($event)"
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
          } @else if (renderMode() === 'docx') {
            <app-docx-view class="docx-container" [url]="rawUrl()" />
          } @else if (renderMode() === 'download' || isMediaMode()) {
            <div class="download-state">
              <span translate="no" class="material-icons download-icon">insert_drive_file</span>
              <h2>{{ metadata()?.fileName }}</h2>
              <a [href]="rawUrl()" download class="btn btn-primary">
                <span translate="no" class="material-icons">download</span>
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
            <span translate="no" class="material-icons tree-icon">{{ isExpanded(node.path) ? 'expand_more' : 'chevron_right' }}</span>
            <span translate="no" class="material-icons tree-icon folder-icon">{{ isExpanded(node.path) ? 'folder_open' : 'folder' }}</span>
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
      transition: margin-top 0.25s ease;
    }

    /* Slid up out of view while an HTML document is scrolled down; the shadow
       would otherwise still show as a line along the top edge. */
    .viewer-header.tucked {
      box-shadow: none;
      border-bottom-color: transparent;
    }

    @media (prefers-reduced-motion: reduce) {
      .viewer-header { transition: none; }
    }

    .header-brand {
      --brand-text-size: 16px;
      --brand-logo-max-height: 28px;
      --brand-logo-max-width: 180px;
      color: var(--primary);
      flex-shrink: 0;
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

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .header-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: white;
      color: #374151;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      text-decoration: none;
      cursor: pointer;
      transition: border-color 0.15s ease, color 0.15s ease;

      .material-icons { font-size: 18px; }

      &:hover {
        border-color: var(--primary);
        color: var(--primary);
      }
    }

    /* On a phone the labels would push the breadcrumb out entirely; the icons
       keep their titles for a long press or a screen reader. What is left of
       the breadcrumb goes to the file name alone. */
    @media (max-width: 640px) {
      .header-action { padding: 6px 8px; }
      .header-action-label { display: none; }
      .breadcrumb-segment:not(.breadcrumb-current),
      .breadcrumb-separator { display: none; }
      .breadcrumb-current { flex-shrink: 1; }
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
      color: var(--primary);
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
      border-color: var(--primary);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 15%, transparent);
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
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .btn-unlock:hover:not(:disabled) {
      background: color-mix(in srgb, var(--primary) 85%, black);
    }

    .btn-unlock:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Folder Sidebar */
    .folder-sidebar {
      width: var(--sidebar-width, 280px);
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
        color: var(--primary);
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
      background: color-mix(in srgb, var(--primary) 14%, white);
      color: color-mix(in srgb, var(--primary) 55%, black);
      font-weight: 500;
    }

    .tree-icon {
      font-size: 18px;
      color: #9ca3af;
      flex-shrink: 0;
    }

    .folder-icon {
      color: var(--primary);
    }

    .file-icon {
      color: #9ca3af;
    }

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

    .resize-handle {
      width: 4px;
      cursor: col-resize;
      background: transparent;
      transition: background 0.15s;
    }

    .resize-handle:hover {
      background: var(--primary);
    }

    .public-viewer .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      width: 36px;
      height: 36px;
      padding: 0;
      border: none;
      border-radius: 8px;
      background: none;
      color: #374151;
      cursor: pointer;

      &:hover { background: #f3f4f6; }
      .material-icons { font-size: 22px; color: inherit; }
    }

    .public-viewer .folder-drawer-btn,
    .public-viewer .folder-drawer-close {
      display: none;
    }

    .public-viewer .folder-drawer-close {
      margin-left: auto;
    }

    /* No taller than the action buttons: the HTML and PDF frames below reckon
       with a 60px bar, and one pixel more gives the page a scrollbar. */
    .public-viewer .header-hide-btn {
      width: 32px;
      height: 32px;
      color: #6b7280;
    }

    /* The way back once the viewer has put the bar away: a small tab hanging
       from the top edge, faint until pointed at so it does not sit on top of a
       presentation, and above the document but below comment popups. It drops
       in only after the bar has slid out. */
    .public-viewer .header-reveal {
      position: fixed;
      top: 0;
      left: 50%;
      z-index: 150;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      width: 52px;
      height: 22px;
      padding: 0;
      border: 1px solid #e5e7eb;
      border-top: none;
      border-radius: 0 0 10px 10px;
      background: rgba(255, 255, 255, 0.9);
      color: #374151;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      opacity: 0.6;
      transform: translateX(-50%);
      transition: opacity 0.15s ease, height 0.15s ease;
      animation: header-reveal-in 0.2s ease 0.25s both;

      .material-icons { font-size: 20px; line-height: 20px; }

      &:hover, &:focus-visible {
        opacity: 1;
        height: 28px;
        color: var(--primary);
      }
    }

    /* A finger needs more than the 22px a mouse pointer gets along with. */
    @media (pointer: coarse) {
      .public-viewer .header-reveal { width: 64px; height: 32px; }
    }

    @keyframes header-reveal-in {
      from { transform: translate(-50%, -100%); }
      to { transform: translate(-50%, 0); }
    }

    @media (prefers-reduced-motion: reduce) {
      .public-viewer .header-reveal { animation: none; transition: none; }
    }

    /* A phone cannot spare 280px for the tree next to the file: the content was
       left with about 110px. The tree becomes a drawer that the menu button in
       the header slides in, and choosing a file slides it out again. */
    @media (max-width: 768px) {
      .public-viewer.folder-layout {
        grid-template-columns: minmax(0, 1fr);
      }

      .public-viewer.folder-layout > .folder-content {
        grid-column: 1;
        min-width: 0;
      }

      .public-viewer.folder-layout > .resize-handle {
        display: none;
      }

      .public-viewer.folder-layout > .folder-sidebar {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        z-index: 210;
        width: min(85vw, 320px);
        min-width: 0;
        max-width: none;
        transform: translateX(-100%);
        visibility: hidden;
        transition: transform 0.25s ease, visibility 0s linear 0.25s;
      }

      .public-viewer.folder-layout > .folder-sidebar.drawer-open {
        transform: none;
        visibility: visible;
        box-shadow: 0 0 24px rgba(0, 0, 0, 0.25);
        transition: transform 0.25s ease;
      }

      .public-viewer .folder-drawer-btn,
      .public-viewer .folder-drawer-close {
        display: flex;
      }

      .public-viewer .folder-drawer-backdrop {
        position: fixed;
        inset: 0;
        z-index: 209;
        background: rgba(0, 0, 0, 0.4);
      }

      /* Full width already, so a card is only odd corners: it becomes the page. */
      .public-viewer .folder-browser {
        margin: 0;
        padding: 20px 16px;
        border-radius: 0;
        box-shadow: none;
      }

      .public-viewer .folder-content .markdown-container {
        margin: 0;
      }
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

    /* Folder browser (shown when no file is selected in a folder share) */
    .folder-browser {
      max-width: 960px;
      width: 100%;
      margin: 24px auto;
      padding: 32px 40px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    .folder-browser-crumbs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 8px;
    }

    .folder-browser-crumb {
      color: var(--primary);
      text-decoration: none;
      cursor: pointer;

      &:hover { text-decoration: underline; }
    }

    .folder-browser-crumb--active {
      color: #111827;
      cursor: default;

      &:hover { text-decoration: none; }
    }

    .folder-browser-crumb-sep { color: #d1d5db; }

    .folder-browser-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 22px;
      font-weight: 600;
      color: #111827;
      margin: 0 0 20px;

      .material-icons {
        color: var(--primary);
        font-size: 28px;
      }
    }

    .folder-browser-listing {
      display: flex;
      flex-direction: column;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }

    .folder-browser-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      cursor: pointer;
      color: #1f2937;
      text-decoration: none;
      border-bottom: 1px solid #f3f4f6;
      transition: background 0.12s;

      &:last-child { border-bottom: none; }
      &:hover { background: #f9fafb; }

      .material-icons {
        font-size: 20px;
        flex-shrink: 0;
      }

      .folder-icon { color: #f9a825; }
    }

    .folder-browser-row--up {
      color: #6b7280;
      font-size: 13px;
      background: #f9fafb;

      .material-icons { color: #9ca3af; font-size: 18px; }
    }

    .folder-browser-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .folder-browser-empty {
      padding: 24px;
      text-align: center;
      color: #9ca3af;
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
      color: var(--primary);
    }

    .download-state .btn {
      margin-top: 24px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      background: var(--primary);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      cursor: pointer;

      &:hover {
        background: color-mix(in srgb, var(--primary) 85%, black);
      }
    }

    /* Keeps the reading column of a shared document, so text does not run the
       full width of a wide monitor. Inherits the 960px cap from
       .markdown-container rather than restating it. */
    .folder-content .markdown-container {
      margin: 24px auto;
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
  /**
   * Video and audio are offered as a download: the share endpoint answers
   * without range requests, which Safari needs to play media at all.
   */
  isMediaMode = computed(() => this.renderMode() === 'video' || this.renderMode() === 'audio');

  readonly imgZoom = new ImageZoomHandler();
  readonly getFileIcon = getFileIcon;
  readonly sharedFileUrl = sharedFileUrl;

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
  /** Path of the folder currently shown in the main pane when no file is open. '' = share root. */
  currentFolderPath = signal('');
  subFileLoading = signal(false);
  sidebarWidth = signal(280);
  /** Phone only: the file tree is a drawer there. */
  folderDrawerOpen = signal(false);
  private resizing = false;

  /** A folder share past the password gate: tree and content side by side. */
  folderLayout = computed(() =>
    this.shareType() === 'FOLDER' && !this.requiresPassword() && !this.loading() && !this.error() && !this.maintenanceMode()
  );

  /** Slid away while an HTML document is scrolled down; scrolling back up returns it. */
  private headerScrolledAway = signal(false);
  /** Put away by the viewer; stays away, scrolling or not, until they bring it back. */
  headerHiddenByViewer = signal(false);
  headerHidden = computed(() => this.headerHiddenByViewer() || this.headerScrolledAway());
  /** Kept current by an observer, so a bar that wraps differently after a resize still goes all the way. */
  private headerHeight = signal(0);
  /** Pulls the content up over the bar's place while it is hidden. */
  headerMarginTop = computed(() => this.headerHidden() && this.headerHeight() ? -this.headerHeight() : null);
  private headerResizeObserver?: ResizeObserver;
  private readonly headerEl = viewChild.required<ElementRef<HTMLElement>>('viewerHeader');
  private readonly headerHideBtn = viewChild<ElementRef<HTMLButtonElement>>('headerHideBtn');
  private readonly headerRevealBtn = viewChild<ElementRef<HTMLButtonElement>>('headerRevealBtn');

  /** FileNode list at currentFolderPath() inside fileTree(). Empty if not found. */
  currentFolderItems = computed<FileNode[]>(() => {
    const path = this.currentFolderPath();
    if (!path) return this.fileTree();
    const segments = path.split('/').filter(Boolean);
    let nodes: FileNode[] = this.fileTree();
    for (const seg of segments) {
      const next: FileNode | undefined = nodes.find((n) => n.isDirectory && n.name === seg);
      if (!next || !next.children) return [];
      nodes = next.children;
    }
    return nodes;
  });

  folderBrowserCrumbs = computed<{ name: string; path: string }[]>(() => {
    const cur = this.currentFolderPath();
    if (!cur) return [];
    const parts = cur.split('/').filter(Boolean);
    return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }));
  });

  parentFolderPath(): string {
    const cur = this.currentFolderPath();
    if (!cur) return '';
    const slash = cur.lastIndexOf('/');
    return slash === -1 ? '' : cur.slice(0, slash);
  }

  setCurrentFolder(path: string): void {
    this.currentFolderPath.set(path);
  }

  folderBrowserTitle = computed<string>(() => {
    const cur = this.currentFolderPath();
    if (!cur) return this.metadata()?.fileName || this.metadata()?.spaceName || '';
    return cur.split('/').pop() || cur;
  });

  parentFolderLabel = computed<string>(() => {
    const parent = this.parentFolderPath();
    if (!parent) return this.metadata()?.fileName || this.metadata()?.spaceName || 'back';
    return parent.split('/').pop() || parent;
  });

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

  /** Download and export apply to the file on screen, so only once one is. */
  fileActionsVisible = computed(() =>
    !this.requiresPassword() && !this.loading() && !this.error() && !this.maintenanceMode()
    && !this.subFileLoading() && this.renderMode() !== null
    && (this.shareType() === 'FILE' || !!this.currentSubPath())
  );

  /** A PDF, an image or a video already is the file; only documents are worth printing. */
  canExportPdf = computed(() => this.renderMode() === 'markdown' || this.renderMode() === 'html');

  downloadUrl = computed(() => {
    const subPath = this.currentSubPath();
    const base = this.shareType() === 'FOLDER' && subPath
      ? sharedFileUrl(this.token, subPath)
      : `/api/shared/${this.token}/raw`;
    return `${base}?download=true`;
  });

  constructor(
    private router: Router,
    private location: Location,
    private sharedLinksService: SharedLinksService,
    private sanitizer: DomSanitizer,
    private pageTitle: PageTitleService,
    private branding: BrandingService,
    private metaService: Meta,
    private markdownService: MarkdownRenderService,
    private elementRef: ElementRef<HTMLElement>,
    private zone: NgZone,
    private pdfExportService: PdfExportService,
    private toastService: ToastService
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

    afterNextRender(() => {
      const header = this.headerEl().nativeElement;
      this.headerResizeObserver = new ResizeObserver(() =>
        this.zone.run(() => this.headerHeight.set(header.offsetHeight))
      );
      this.headerResizeObserver.observe(header);
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
    this.headerHiddenByViewer.set(readHeaderHidden(this.token));
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

  /**
   * An HTML document scrolls inside its iframe, so the DocuVault bar above it
   * would stay put and take a slice of a phone's screen for good. Scrolling the
   * document down slides the bar away; scrolling up, or getting back near the
   * top, brings it back, the way a mobile browser's address bar behaves.
   *
   * The iframe is same-origin (its sandbox allows it), so its scrolling can be
   * watched directly. Listening in the capture phase also catches pages that
   * scroll an inner element instead of the window. Each new document starts
   * with the bar showing.
   */
  followFrameScroll(event: Event): void {
    this.setHeaderScrolledAway(false);
    let doc: Document | null = null;
    try {
      doc = (event.target as HTMLIFrameElement).contentDocument;
    } catch {
      return;
    }
    if (!doc) return;

    const frameDoc = doc;
    const lastTop = new WeakMap<Element, number>();
    frameDoc.addEventListener('scroll', (e) => {
      // Nodes of the iframe belong to its own realm, so no instanceof checks here.
      const node = e.target as Node;
      const scroller = node.nodeType === Node.DOCUMENT_NODE ? frameDoc.scrollingElement : node as Element;
      if (!scroller) return;
      const top = scroller.scrollTop;
      const delta = top - (lastTop.get(scroller) ?? 0);
      lastTop.set(scroller, top);
      // A sideways scroll (a carousel, a wide table) says nothing about reading on.
      if (delta === 0) return;
      if (top <= HEADER_REVEAL_ZONE_PX) this.setHeaderScrolledAway(false);
      else if (Math.abs(delta) >= SCROLL_JITTER_PX) this.setHeaderScrolledAway(delta > 0);
    }, { capture: true, passive: true });
  }

  private setHeaderScrolledAway(away: boolean): void {
    if (away === this.headerScrolledAway()) return;
    // The iframe's events run outside Angular's zone.
    this.zone.run(() => this.headerScrolledAway.set(away));
  }

  /**
   * A presentation or a page with its own navigation does not scroll, so the
   * bar never slides away by itself; the viewer can put it away instead. The
   * choice is remembered per share, and focus follows to the control that is
   * left on screen, so a keyboard user is not stranded on a hidden button.
   */
  hideHeader(): void {
    this.setHeaderHiddenByViewer(true);
    setTimeout(() => this.headerRevealBtn()?.nativeElement.focus());
  }

  showHeader(): void {
    // Otherwise a document scrolled down meanwhile would keep the bar away.
    this.headerScrolledAway.set(false);
    this.setHeaderHiddenByViewer(false);
    setTimeout(() => this.headerHideBtn()?.nativeElement.focus());
  }

  private setHeaderHiddenByViewer(hidden: boolean): void {
    this.headerHiddenByViewer.set(hidden);
    rememberHeaderHidden(this.token, hidden);
  }

  ngOnDestroy(): void {
    this.pageTitle.set();
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
    this.headerResizeObserver?.disconnect();
    this.imgZoom.destroy();
  }

  /**
   * An HTML page prints as it is, with its own styles. A Markdown document goes
   * through the same printable layout the editor uses, from the rendered
   * article, so drawn diagrams and resolved images come along.
   */
  exportAsPdf(): void {
    const fileName = this.currentFileName();
    let opened: boolean;
    if (this.renderMode() === 'html') {
      opened = this.pdfExportService.printUrl(this.rawUrl());
    } else {
      const article = this.elementRef.nativeElement.querySelector<HTMLElement>('.markdown-container article');
      if (!article?.innerHTML.trim()) {
        this.toastService.error('Export failed', 'There is nothing to export yet.');
        return;
      }
      const title = article.querySelector('h1')?.textContent?.trim() || fileName.replace(/\.[^.]+$/, '');
      opened = this.pdfExportService.print(title, this.markdownService.exportableHtml(article));
    }
    if (!opened) {
      this.toastService.error('Export failed', 'The browser blocked the print window.');
    }
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
    this.folderDrawerOpen.set(false);
    this.currentSubPath.set(node.path);
    this.loadSubPathContent(node.path);
    const url = `/share/${this.token}/${node.path}`;
    this.location.replaceState(url);
  }

  @HostListener('document:keydown.escape')
  closeFolderDrawer(): void {
    this.folderDrawerOpen.set(false);
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
    this.pageTitle.set(meta.ogTitle || meta.fileName, meta.spaceName);
    const title = this.pageTitle.title();
    const appName = this.branding.appName();
    const description = meta.ogDescription
      || `${meta.fileName} - shared from ${meta.spaceName} on ${appName}`;
    const shareUrl = window.location.href;
    const twitterCard = meta.ogImageUrl ? 'summary_large_image' : 'summary';

    this.metaService.updateTag({ name: 'description', content: description });
    this.metaService.updateTag({ property: 'og:title', content: title });
    this.metaService.updateTag({ property: 'og:description', content: description });
    this.metaService.updateTag({ property: 'og:type', content: 'article' });
    this.metaService.updateTag({ property: 'og:url', content: shareUrl });
    this.metaService.updateTag({ property: 'og:site_name', content: appName });
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
        // Asset URLs are space-absolute (that is the only way an image one
        // folder up can be addressed at all), so the document's own directory
        // inside the space is what its relative paths hang off.
        const linkPrefix = this.shareType() === 'FOLDER' ? `/share/${this.token}` : null;
        this.renderedHtml.set(this.markdownService.render(
          content, '', `/api/shared/${this.token}/files`, linkPrefix, this.assetRoot()
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
    // Links stay relative to the shared folder — that is what `/share/<token>/…`
    // addresses — while assets are addressed from the space root.
    const dir = subPath.substring(0, subPath.lastIndexOf('/') + 1);
    this.renderedHtml.set(this.markdownService.render(
      content, dir, `/api/shared/${this.token}/files`, `/share/${this.token}`, this.assetRoot()
    ));
  }

  /**
   * The shared item's own directory inside the space, as a prefix: the folder
   * itself for a folder share, the file's parent for a file share.
   */
  private assetRoot(): string {
    const filePath = this.metadata()?.filePath ?? '';
    if (!filePath) return '';
    const dir = this.shareType() === 'FOLDER'
      ? filePath
      : filePath.substring(0, filePath.lastIndexOf('/'));
    return dir ? `${dir}/` : '';
  }
}
