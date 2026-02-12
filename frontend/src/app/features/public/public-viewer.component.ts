import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SharedLinksService, SharedFileMetadata } from '../../core/api/shared-links.service';
import { marked } from 'marked';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-public-viewer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="public-viewer">
      <!-- Header -->
      <header class="viewer-header">
        <div class="header-brand">
          <span class="brand-icon material-icons">menu_book</span>
          <span class="brand-name">DocuVault</span>
        </div>
        @if (metadata()) {
          <div class="header-filename">{{ metadata()!.fileName }}</div>
        }
      </header>

      <!-- Content -->
      <main class="viewer-content">
        @if (loading()) {
          <div class="loading-state">
            <svg class="animate-spin h-8 w-8" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p>Loading shared file...</p>
          </div>
        } @else if (error()) {
          <div class="error-state">
            <span class="material-icons error-icon">link_off</span>
            <h2>Link Not Available</h2>
            <p>{{ error() }}</p>
          </div>
        } @else if (renderMode() === 'markdown') {
          <div class="markdown-container">
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
            <img [src]="rawUrl()" [alt]="metadata()?.fileName" class="preview-image" />
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
    </div>
  `,
  styles: [`
    .public-viewer {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: #f5f5f5;
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

    .header-filename {
      font-size: 14px;
      color: #6b7280;
      padding-left: 16px;
      border-left: 1px solid #e5e7eb;
    }

    .viewer-content {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

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
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      flex: 1;
    }

    .preview-image {
      max-width: 100%;
      max-height: calc(100vh - 120px);
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
  `]
})
export class PublicViewerComponent implements OnInit {
  token = '';
  metadata = signal<SharedFileMetadata | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  renderMode = signal<'markdown' | 'html' | 'image' | 'pdf' | 'download' | null>(null);
  renderedHtml = signal<SafeHtml>('');
  rawUrl = signal('');
  safeRawUrl = signal<SafeResourceUrl>('');

  constructor(
    private route: ActivatedRoute,
    private sharedLinksService: SharedLinksService,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    if (!this.token) {
      this.error.set('Invalid share link.');
      this.loading.set(false);
      return;
    }

    this.rawUrl.set(`/api/shared/${this.token}/raw`);
    this.safeRawUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/api/shared/${this.token}/raw`));

    this.sharedLinksService.getSharedFileMetadata(this.token).subscribe({
      next: (meta) => {
        this.metadata.set(meta);
        this.determineRenderMode(meta);
      },
      error: () => {
        this.error.set('This shared link is no longer available or has expired.');
        this.loading.set(false);
      }
    });
  }

  private determineRenderMode(meta: SharedFileMetadata): void {
    const ext = meta.extension.toLowerCase();

    if (ext === 'md') {
      this.renderMode.set('markdown');
      this.loadMarkdownContent();
    } else if (ext === 'html' || ext === 'htm') {
      this.renderMode.set('html');
      this.loading.set(false);
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) {
      this.renderMode.set('image');
      this.loading.set(false);
    } else if (ext === 'pdf') {
      this.renderMode.set('pdf');
      this.loading.set(false);
    } else {
      this.renderMode.set('download');
      this.loading.set(false);
    }
  }

  private loadMarkdownContent(): void {
    this.sharedLinksService.getSharedFileContent(this.token).subscribe({
      next: (content) => {
        let html = marked.parse(content) as string;
        // Rewrite relative image paths to use the shared files endpoint
        html = html.replace(
          /(<img\s[^>]*src=")(?!https?:\/\/|\/api\/)([^"]+)(")/g,
          `$1/api/shared/${this.token}/files/$2$3`
        );
        this.renderedHtml.set(this.sanitizer.bypassSecurityTrustHtml(html));
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load file content.');
        this.loading.set(false);
      }
    });
  }

}
