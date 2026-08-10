import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpClient } from '@angular/common/http';
import { getExtension, getFileIcon, getRenderMode } from '../utils/file-utils';
import { MarkdownRenderService } from '../services/markdown-render.service';

type ThumbKind = 'image' | 'html' | 'markdown' | 'icon';

/**
 * Small square thumbnail for a file in a listing: a real preview for images,
 * HTML and markdown, a per-extension icon for everything else.
 *
 * Previews mount only once the row scrolls into view — a folder of full
 * presentations would otherwise boot every deck at once on load. Anything
 * rendered from file contents goes into an iframe sandboxed without
 * allow-same-origin (a thumbnail has no reason to reach the parent document,
 * and markdown may carry raw HTML, which DocuVault renders deliberately). The
 * frame takes no pointer events, so the row stays clickable through it.
 *
 * Markdown leads with the document's own first image where it has one — a
 * release note or design doc is recognisable by its screenshot, while its
 * prose is an indistinguishable grey block at this size.
 */
@Component({
  selector: 'app-file-thumb',
  standalone: true,
  host: {
    '[style.--thumb-size.px]': 'size()',
    '[style.--thumb-scale]': 'size() / 1280'
  },
  template: `
    <div class="file-thumb">
      @switch (kind()) {
        @case ('image') {
          <img
            class="file-thumb-image"
            [src]="url()"
            alt=""
            loading="lazy"
            (error)="previewFailed.set(true)"
          />
        }
        @case ('html') {
          @if (visible()) {
            <iframe
              class="file-thumb-frame"
              [src]="safeFileUrl()"
              sandbox="allow-scripts"
              scrolling="no"
              tabindex="-1"
              aria-hidden="true"
              loading="lazy"
            ></iframe>
          }
        }
        @case ('markdown') {
          @if (markdownImage(); as image) {
            <img
              class="file-thumb-image"
              [src]="image"
              alt=""
              loading="lazy"
              (error)="onMarkdownImageFailed()"
            />
          } @else {
            @if (markdownDoc(); as doc) {
              <iframe
                class="file-thumb-frame"
                [srcdoc]="doc"
                sandbox="allow-scripts"
                scrolling="no"
                tabindex="-1"
                aria-hidden="true"
              ></iframe>
            } @else {
              <img class="file-thumb-icon" [src]="iconUrl()" alt="" />
            }
          }
        }
        @default {
          <img class="file-thumb-icon" [src]="iconUrl()" alt="" />
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      flex-shrink: 0;
    }

    .file-thumb {
      position: relative;
      width: var(--thumb-size, 64px);
      height: var(--thumb-size, 64px);
      border-radius: 6px;
      overflow: hidden;
      background: var(--surface);
      border: 1px solid var(--border);
    }

    /* contain, not cover: in a file browser the job is to recognise the file,
       and a centre crop hides exactly the part that identifies it. */
    .file-thumb-image,
    .file-thumb-icon {
      width: 100%;
      height: 100%;
      object-fit: contain;
      display: block;
      box-sizing: border-box;
    }

    .file-thumb-image { padding: 2px; }
    .file-thumb-icon { padding: 6px; }

    /* Render the page at a real viewport size, then scale the whole frame down
       to the thumbnail box — laying out at 64px wide would collapse every page.
       The scale follows the box size so a larger tile preview stays in frame. */
    .file-thumb-frame {
      position: absolute;
      top: 0;
      left: 0;
      width: 1280px;
      height: 1280px;
      border: 0;
      transform: scale(var(--thumb-scale, 0.05));
      transform-origin: top left;
      pointer-events: none;
    }
  `]
})
export class FileThumbComponent implements OnInit, OnDestroy {
  /**
   * URL the file is served from. Left to the caller because the schemes differ —
   * `/api/spaces/{id}/files/…` when signed in, `/api/shared/{token}/raw/…` behind
   * a public share link.
   */
  url = input.required<string>();
  /** File name, used to pick the preview kind and the fallback icon. */
  name = input.required<string>();
  /** Edge length of the square preview box, in pixels. */
  size = input(64);

  /** A preview that failed to load falls back to the extension icon. */
  protected previewFailed = signal(false);
  /** HTML previews stay unmounted until the row is scrolled into view. */
  protected visible = signal(false);

  /** The document's own first image, preferred over rendering its prose. */
  protected markdownImage = signal<string | null>(null);
  /** Rendered markdown for the sandboxed frame, when there is no lead image. */
  protected markdownDoc = signal<SafeHtml | null>(null);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly http = inject(HttpClient);
  private readonly markdown = inject(MarkdownRenderService);
  private observer?: IntersectionObserver;
  private markdownHead: string | null = null;

  /** Enough markdown for a 64px thumbnail — no reason to fetch a whole book. */
  private static readonly PREVIEW_CHARS = 4000;

  protected kind = computed<ThumbKind>(() => {
    if (this.previewFailed()) return 'icon';
    const mode = getRenderMode(getExtension(this.name()));
    if (mode === 'image' || mode === 'html' || mode === 'markdown') return mode;
    return 'icon';
  });

  protected safeFileUrl = computed(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.url())
  );

  protected iconUrl = computed(() => getFileIcon(this.name()));

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
      return;
    }
    // Start a little before the row is on screen so the frame has painted by
    // the time it arrives.
    this.observer = new IntersectionObserver((entries) => {
      if (!entries.some(e => e.isIntersecting)) return;
      this.visible.set(true);
      if (this.kind() === 'markdown') this.loadMarkdown();
      this.observer?.disconnect();
      this.observer = undefined;
    }, { rootMargin: '200px' });
    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  /**
   * Markdown has no rendered form on the server, so the source is fetched and
   * rendered here. Only the head of the file is used — that is all that fits.
   */
  private loadMarkdown(): void {
    this.http.get(this.url(), { responseType: 'text' }).subscribe({
      next: (text) => {
        this.markdownHead = text.slice(0, FileThumbComponent.PREVIEW_CHARS);
        const image = this.firstImage(this.markdownHead);
        if (image) {
          this.markdownImage.set(image);
          return;
        }
        this.renderMarkdownHead();
      },
      error: () => this.previewFailed.set(true)
    });
  }

  /** Falls back to rendering the prose when the lead image itself won't load. */
  protected onMarkdownImageFailed(): void {
    this.markdownImage.set(null);
    this.renderMarkdownHead();
  }

  private renderMarkdownHead(): void {
    if (this.markdownHead === null) return;
    const body = this.markdown.renderToHtml(this.markdownHead);
    this.markdownDoc.set(this.sanitizer.bypassSecurityTrustHtml(this.previewDocument(body)));
  }

  /**
   * First image referenced in the markdown, as an absolute URL. Resolved
   * against the document's own URL, which is what both serving schemes expect
   * for a relative path.
   */
  private firstImage(markdown: string): string | null {
    const md = markdown.match(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/);
    const html = markdown.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = md?.[1] ?? html?.[1];
    if (!src) return null;
    if (/^data:image\//i.test(src)) return src;
    try {
      return new URL(src, new URL(this.url(), window.location.origin)).href;
    } catch {
      return null;
    }
  }

  /**
   * Standalone document for the frame. Rendered at a real page width and scaled
   * down by CSS, so the layout is a genuine miniature rather than a squeezed
   * one; the type is oversized because it is about to be shrunk 20x.
   */
  private previewDocument(body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:56px 64px;background:#fff;color:#1f2937;
        font-family:-apple-system,'Segoe UI',sans-serif;font-size:30px;line-height:1.55;
        overflow:hidden}
      h1{font-size:64px;margin:0 0 28px;line-height:1.15}
      h2{font-size:48px;margin:36px 0 20px}
      h3{font-size:38px;margin:30px 0 16px}
      p,li{margin:0 0 20px}
      ul,ol{padding-left:44px}
      img{max-width:100%;height:auto;border-radius:8px}
      pre{background:#f1f5f9;padding:22px;border-radius:10px;overflow:hidden;font-size:26px}
      code{background:#f1f5f9;padding:2px 8px;border-radius:6px}
      pre code{background:none;padding:0}
      table{border-collapse:collapse;width:100%}
      th,td{border:1px solid #e2e8f0;padding:12px 16px;text-align:left}
      blockquote{margin:0 0 20px;padding-left:24px;border-left:8px solid #6fb3b8;color:#475569}
      a{color:#388087}
    </style></head><body>${body}</body></html>`;
  }
}
