import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';
import mermaid from 'mermaid';
import hljs from 'highlight.js/lib/common';
import { resolveRelativePath } from '../utils/file-utils';

@Injectable({ providedIn: 'root' })
export class MarkdownRenderService {
  private mermaidInitialised = false;
  private mermaidSeq = 0;
  private drawioLoader: Promise<void> | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  /**
   * Render markdown to sanitized HTML, rewriting relative image/link paths
   * and converting ```mermaid code blocks into nodes that
   * {@link runMermaid} can later turn into diagrams.
   *
   * @param content    Raw markdown string
   * @param docDir     Directory of the current document (for resolving relative paths)
   * @param fileUrlPrefix   URL prefix for raw file access (e.g. `/api/spaces/xyz/files`)
   * @param linkPrefix      URL prefix for internal navigation (e.g. `/preview/xyz` or `/share/token`).
   *                        Pass null to skip link rewriting.
   */
  render(
    content: string,
    docDir: string,
    fileUrlPrefix: string,
    linkPrefix: string | null
  ): SafeHtml {
    const renderer = new Renderer();
    renderer.heading = (text: string, level: number, raw: string) => {
      return `<h${level} id="${this.headingId(raw)}">${text}</h${level}>\n`;
    };
    // Mermaid: emit a placeholder that runMermaid() can find.
    // marked HTML-escapes code content, so the source survives intact in
    // the text node — mermaid reads textContent, which un-escapes for us.
    renderer.code = (code: string, lang: string | undefined) => {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        return `<pre class="mermaid">${this.escape(code)}</pre>`;
      }
      return this.renderCodeBlock(code, lang);
    };

    let html = marked.parse(content, { renderer }) as string;

    // Rewrite relative image src
    html = html.replace(
      /(<img\s[^>]*src=")(?!https?:\/\/|\/api\/)([^"]+)(")/g,
      (_match, pre, src, post) => {
        const resolved = resolveRelativePath(docDir + src);
        return `${pre}${fileUrlPrefix}/${resolved}${post}`;
      }
    );

    // draw.io: a `.drawio` file referenced as an image (![](diagram.drawio))
    // can't render as an <img>. Convert it into a placeholder that
    // runDrawio() hydrates with the vendored viewer. src is already
    // absolute here (relative paths were rewritten just above).
    html = html.replace(
      /<img\b[^>]*?\bsrc="([^"]+\.drawio)"[^>]*>/gi,
      (_match, src) => `<div class="drawio" data-drawio-src="${src}"></div>`
    );

    // Rewrite relative href links
    if (linkPrefix) {
      html = html.replace(
        /(<a\s[^>]*href=")(?!https?:\/\/|\/|#)([^"]+)(")/g,
        (_match, pre, href, post) => {
          const [linkPath, fragment] = href.split('#');
          if (!linkPath) return `${pre}#${fragment}${post}`;
          const resolved = resolveRelativePath(docDir + linkPath);
          const fragmentSuffix = fragment ? `#${fragment}` : '';
          return `${pre}${linkPrefix}/${resolved}${fragmentSuffix}${post}`;
        }
      );
    }

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /**
   * Render markdown without path rewriting (for AI chat responses etc.).
   * Still mermaid-aware — `<pre class="mermaid">` nodes are produced so
   * {@link runMermaid} can turn them into SVG.
   */
  renderInline(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.renderToHtml(content));
  }

  /**
   * Same rendering as [renderInline] but returns the raw HTML string, for
   * callers that need the markup itself rather than a binding — the file
   * thumbnail puts it inside a sandboxed iframe's srcdoc.
   */
  renderToHtml(content: string): string {
    const renderer = new Renderer();
    renderer.code = (code: string, lang: string | undefined) => {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        return `<pre class="mermaid">${this.escape(code)}</pre>`;
      }
      return this.renderCodeBlock(code, lang);
    };
    return marked.parse(content, { renderer }) as string;
  }

  /**
   * Render every `<pre class="mermaid">` inside `host` into an SVG diagram.
   * Idempotent — nodes already processed are skipped. Call after Angular has
   * flushed the innerHTML update (e.g. inside afterNextRender or a microtask).
   */
  async runMermaid(host: HTMLElement | null | undefined): Promise<void> {
    if (!host) return;
    const nodes = host.querySelectorAll<HTMLElement>('pre.mermaid:not([data-mermaid-rendered])');
    if (nodes.length === 0) return;

    if (!this.mermaidInitialised) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });
      this.mermaidInitialised = true;
    }

    for (const node of Array.from(nodes)) {
      const source = node.textContent ?? '';
      const id = `mermaid-${++this.mermaidSeq}`;
      try {
        const { svg, bindFunctions } = await mermaid.render(id, source);
        node.innerHTML = svg;
        node.setAttribute('data-mermaid-rendered', 'true');
        bindFunctions?.(node);
        this.attachExpandButton(node, source);
      } catch (err) {
        node.setAttribute('data-mermaid-rendered', 'error');
        const message = err instanceof Error ? err.message : String(err);
        node.innerHTML = `<div class="mermaid-error" style="color:#b91c1c;font-family:monospace;white-space:pre-wrap;">Mermaid error: ${this.escape(message)}</div>`;
      }
    }
  }

  /**
   * Lazy-load the self-hosted draw.io viewer (~3.8 MB) on first use.
   * Vendored under assets/ so it renders fully offline — no calls out to
   * viewer.diagrams.net (see SECURITY.md). Idempotent: concurrent callers
   * share one in-flight script load.
   */
  private ensureDrawio(): Promise<void> {
    if ((window as any).GraphViewer) return Promise.resolve();
    if (this.drawioLoader) return this.drawioLoader;
    this.drawioLoader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'assets/drawio/viewer-static.min.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.drawioLoader = null;
        reject(new Error('Failed to load draw.io viewer'));
      };
      document.head.appendChild(script);
    });
    return this.drawioLoader;
  }

  /**
   * Hydrate every `<div class="drawio" data-drawio-src>` inside `host` by
   * fetching its `.drawio` XML and rendering it with the vendored viewer.
   * Idempotent — nodes already processed are skipped. Mirrors runMermaid():
   * call after Angular has flushed the innerHTML update.
   */
  async runDrawio(host: HTMLElement | null | undefined): Promise<void> {
    if (!host) return;
    const nodes = host.querySelectorAll<HTMLElement>(
      'div.drawio[data-drawio-src]:not([data-drawio-rendered])'
    );
    if (nodes.length === 0) return;

    try {
      await this.ensureDrawio();
    } catch {
      for (const node of Array.from(nodes)) {
        node.setAttribute('data-drawio-rendered', 'error');
        node.innerHTML = `<div class="mermaid-error" style="color:#b91c1c;font-family:monospace;">draw.io viewer failed to load</div>`;
      }
      return;
    }

    const GraphViewer = (window as any).GraphViewer;
    for (const node of Array.from(nodes)) {
      // Claim the node before the await so a re-entrant call can't double-process it.
      node.setAttribute('data-drawio-rendered', 'true');
      const src = node.getAttribute('data-drawio-src') ?? '';
      try {
        const resp = await fetch(src, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const raw = await resp.text();
        // GraphViewer's <mxfile>/<diagram> path mis-detects uncompressed XML as
        // base64-deflate and throws on atob(). Feed it the bare <mxGraphModel>,
        // which renders with no decompression. For genuinely compressed files
        // (no inline model) fall back to the full XML so GraphViewer inflates it.
        const model = raw.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/);
        const xml = model ? model[0] : raw;
        node.setAttribute('data-mxgraph', JSON.stringify({
          xml,
          toolbar: null,
          'auto-fit': true,
          resize: true,
          border: 8,
        }));
        GraphViewer.createViewerForElement(node, () => {
          node.classList.add('dv-mermaid-wrap');
          this.attachSvgExpandButton(node);
        });
      } catch (err) {
        node.setAttribute('data-drawio-rendered', 'error');
        const message = err instanceof Error ? err.message : String(err);
        node.innerHTML = `<div class="mermaid-error" style="color:#b91c1c;font-family:monospace;white-space:pre-wrap;">draw.io error: ${this.escape(message)}</div>`;
      }
    }
  }

  private attachExpandButton(host: HTMLElement, source: string): void {
    host.classList.add('dv-mermaid-wrap');
    host.appendChild(this.makeExpandButton(() => this.openFullscreen(source)));
  }

  /**
   * Expand button for already-rendered SVG diagrams (draw.io). Unlike the
   * mermaid variant it doesn't re-render from source — it clones the live
   * `<svg>` out of `host` into the fullscreen overlay.
   */
  private attachSvgExpandButton(host: HTMLElement): void {
    host.appendChild(this.makeExpandButton(() => {
      const svg = host.querySelector('svg');
      if (svg) this.openSvgFullscreen(svg as SVGElement);
    }));
  }

  private makeExpandButton(onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dv-mermaid-expand';
    btn.title = 'Expand (fullscreen with zoom & pan)';
    btn.innerHTML = '<span class="material-icons">open_in_full</span>';
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick();
    });
    return btn;
  }

  /**
   * Make every content `<img>` inside `host` open in a zoom/pan lightbox on
   * click. Idempotent — images already wired are skipped. Linked images keep
   * their navigation; diagrams render as inline SVG (not `<img>`) so they're
   * untouched. Mirrors runMermaid()/runDrawio(): call after Angular flushes
   * the innerHTML update.
   */
  runImageLightbox(host: HTMLElement | null | undefined): void {
    if (!host) return;
    const imgs = host.querySelectorAll<HTMLImageElement>('img:not([data-lightbox-bound])');
    imgs.forEach((img) => {
      if (img.closest('a')) return;
      img.setAttribute('data-lightbox-bound', 'true');
      img.classList.add('dv-lightbox-img');
      img.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.openImageFullscreen(img.currentSrc || img.src, img.alt);
      });
    });
  }

  private openImageFullscreen(src: string, alt: string): void {
    const { header, stage } = this.buildOverlay('dv-lightbox-overlay');
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.className = 'dv-lightbox-image';
    img.draggable = false;
    stage.appendChild(img);
    this.installZoomPan(header, stage);
  }

  /** Create the fullscreen overlay shell (header + stage) attached to body. */
  private buildOverlay(extraClass?: string): { header: HTMLElement; stage: HTMLElement } {
    const overlay = document.createElement('div');
    overlay.className = 'dv-mermaid-overlay';
    if (extraClass) overlay.classList.add(extraClass);

    const header = document.createElement('div');
    header.className = 'dv-mermaid-overlay-header';

    const stage = document.createElement('div');
    stage.className = 'dv-mermaid-overlay-stage';

    overlay.appendChild(header);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);
    return { header, stage };
  }

  private async openFullscreen(source: string): Promise<void> {
    const { header, stage } = this.buildOverlay();
    const id = `mermaid-fs-${++this.mermaidSeq}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, source);
      stage.innerHTML = svg;
      bindFunctions?.(stage);
    } catch (err) {
      stage.innerHTML = `<div style="color:#fca5a5;font-family:monospace;">Render error: ${this.escape(String(err))}</div>`;
    }
    this.installZoomPan(header, stage);
  }

  /** Open an already-rendered SVG (cloned) in the zoom/pan overlay. */
  private openSvgFullscreen(svg: SVGElement): void {
    const { header, stage } = this.buildOverlay();
    stage.appendChild(svg.cloneNode(true));
    this.installZoomPan(header, stage);
  }

  /** Wire zoom/pan/close controls onto an overlay whose stage holds an <svg>. */
  private installZoomPan(header: HTMLElement, stage: HTMLElement): void {
    const overlay = stage.parentElement as HTMLElement;
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const target = stage.querySelector('svg, img') as (SVGElement | HTMLElement | null);
    const apply = () => {
      if (target) target.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    };

    const zoomOut = document.createElement('button');
    zoomOut.title = 'Zoom out';
    zoomOut.innerHTML = '<span class="material-icons">remove</span>';
    zoomOut.addEventListener('click', () => { scale = Math.max(0.25, scale - 0.25); apply(); });

    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'dv-mermaid-zoom-level';
    zoomLabel.textContent = '100%';

    const zoomIn = document.createElement('button');
    zoomIn.title = 'Zoom in';
    zoomIn.innerHTML = '<span class="material-icons">add</span>';
    zoomIn.addEventListener('click', () => { scale = Math.min(8, scale + 0.25); apply(); });

    const reset = document.createElement('button');
    reset.title = 'Reset';
    reset.innerHTML = '<span class="material-icons">filter_center_focus</span>';
    reset.addEventListener('click', () => { scale = 1; tx = 0; ty = 0; apply(); });

    const close = document.createElement('button');
    close.title = 'Close (Esc)';
    close.innerHTML = '<span class="material-icons">close</span>';
    const teardown = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    close.addEventListener('click', teardown);

    header.append(zoomOut, zoomLabel, zoomIn, reset, close);

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      scale = Math.min(8, Math.max(0.25, scale + delta));
      apply();
    }, { passive: false });

    let dragStart: { x: number; y: number; tx: number; ty: number } | null = null;
    stage.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragStart = { x: e.clientX, y: e.clientY, tx, ty };
      stage.classList.add('dragging');
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragStart) return;
      tx = dragStart.tx + (e.clientX - dragStart.x);
      ty = dragStart.ty + (e.clientY - dragStart.y);
      apply();
    });
    document.addEventListener('mouseup', () => {
      dragStart = null;
      stage.classList.remove('dragging');
    });

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') teardown(); };
    document.addEventListener('keydown', onKey);

    apply();
  }

  /**
   * Heading text → anchor id. Umlauts are transliterated before the non-word
   * strip, which would otherwise drop them without trace ("Die fünf Tore" →
   * "die-fnf-tore"), leaving hand-written `[…](#die-fünf-tore)` links dead.
   * Remaining accents are decomposed and their marks removed (é → e).
   */
  private headingId(raw: string): string {
    return raw.toLowerCase()
      .replace(/<[^>]*>/g, '')
      // NFC first, so a decomposed "u + ̈" still matches the pairs below.
      .normalize('NFC')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .trim();
  }

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private renderCodeBlock(code: string, lang: string | undefined): string {
    const language = (lang ?? '').trim();
    if (language && hljs.getLanguage(language)) {
      try {
        const { value } = hljs.highlight(code, { language, ignoreIllegals: true });
        return `<pre><code class="hljs language-${language}">${value}</code></pre>\n`;
      } catch {
        // fall through to auto / plain
      }
    }
    if (language) {
      return `<pre><code class="hljs language-${language}">${this.escape(code)}</code></pre>\n`;
    }
    // No explicit language — try to auto-detect, but only commit if the
    // highlighter is reasonably confident, to avoid mangling tree-shaped
    // ASCII art and other prose-y blocks.
    const auto = hljs.highlightAuto(code);
    if (auto.relevance >= 5 && auto.language) {
      return `<pre><code class="hljs language-${auto.language}">${auto.value}</code></pre>\n`;
    }
    return `<pre><code class="hljs">${this.escape(code)}</code></pre>\n`;
  }
}
