import { Component, OnInit, OnDestroy, signal, computed, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { SharedLinksService, SharedFileMetadata } from '../../core/api/shared-links.service';
import { marked } from 'marked';
import { DomSanitizer, SafeResourceUrl, SafeHtml, Meta, Title } from '@angular/platform-browser';

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
  encapsulation: ViewEncapsulation.None,
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

    .markdown-container h3 {
      font-size: 1.25em;
    }

    .markdown-container h4 {
      font-size: 1em;
    }

    .markdown-container p {
      margin: 0 0 1em;
    }

    .markdown-container ul,
    .markdown-container ol {
      margin: 0 0 1em;
      padding-left: 2em;
    }

    .markdown-container ul {
      list-style-type: disc;
    }

    .markdown-container ol {
      list-style-type: decimal;
    }

    .markdown-container li {
      margin-bottom: 0.5em;
    }

    .markdown-container li > ul,
    .markdown-container li > ol {
      margin-top: 0.5em;
      margin-bottom: 0;
    }

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

    .markdown-container blockquote p:last-child {
      margin-bottom: 0;
    }

    .markdown-container table {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 1em;
      font-size: 0.9em;
    }

    .markdown-container th,
    .markdown-container td {
      border: 1px solid #e5e7eb;
      padding: 8px 12px;
      text-align: left;
    }

    .markdown-container th {
      background: #f9fafb;
      font-weight: 600;
    }

    .markdown-container tr:nth-child(even) {
      background: #f9fafb;
    }

    .markdown-container a {
      color: #6fb3b8;
      text-decoration: none;
    }

    .markdown-container a:hover {
      text-decoration: underline;
    }

    .markdown-container strong {
      font-weight: 700;
      color: #111827;
    }

    .markdown-container em {
      font-style: italic;
    }

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
export class PublicViewerComponent implements OnInit, OnDestroy {
  token = '';
  metadata = signal<SharedFileMetadata | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  renderMode = signal<'markdown' | 'html' | 'image' | 'pdf' | 'download' | null>(null);
  renderedHtml = signal<SafeHtml>('');
  rawUrl = signal('');
  safeRawUrl = signal<SafeResourceUrl>('');

  breadcrumbSegments = computed(() => {
    const meta = this.metadata();
    if (!meta) return [];
    const parts = meta.filePath.split('/').filter(p => p.length > 0);
    return [
      { label: meta.spaceName },
      ...parts.map(p => ({ label: p }))
    ];
  });

  constructor(
    private route: ActivatedRoute,
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

    this.rawUrl.set(`/api/shared/${this.token}/raw`);
    this.safeRawUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(`/api/shared/${this.token}/raw`));

    this.sharedLinksService.getSharedFileMetadata(this.token).subscribe({
      next: (meta) => {
        this.metadata.set(meta);
        this.setPageMeta(meta);
        this.determineRenderMode(meta);
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
