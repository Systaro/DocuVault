import { Component, ElementRef, OnDestroy, OnInit, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { getExtension, getFileIcon, getRenderMode } from '../utils/file-utils';

type ThumbKind = 'image' | 'html' | 'icon';

/**
 * Small square thumbnail for a file in a listing: a real preview for images and
 * HTML, a per-extension icon for everything else.
 *
 * HTML previews render the actual page in a scaled-down iframe. They mount only
 * once the row scrolls into view — a folder of full presentations would
 * otherwise boot every deck at once on load. The frame is sandboxed without
 * allow-same-origin (a thumbnail has no reason to reach the parent document)
 * and takes no pointer events, so the row stays clickable through it.
 */
@Component({
  selector: 'app-file-thumb',
  standalone: true,
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
      width: 64px;
      height: 64px;
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
       to the thumbnail box — laying out at 64px wide would collapse every page. */
    .file-thumb-frame {
      position: absolute;
      top: 0;
      left: 0;
      width: 1280px;
      height: 1280px;
      border: 0;
      transform: scale(0.05);
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

  /** A preview that failed to load falls back to the extension icon. */
  protected previewFailed = signal(false);
  /** HTML previews stay unmounted until the row is scrolled into view. */
  protected visible = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly sanitizer = inject(DomSanitizer);
  private observer?: IntersectionObserver;

  protected kind = computed<ThumbKind>(() => {
    if (this.previewFailed()) return 'icon';
    const mode = getRenderMode(getExtension(this.name()));
    return mode === 'image' || mode === 'html' ? mode : 'icon';
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
      this.observer?.disconnect();
      this.observer = undefined;
    }, { rootMargin: '200px' });
    this.observer.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }
}
