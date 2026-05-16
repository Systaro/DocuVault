import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';
import mermaid from 'mermaid';
import { resolveRelativePath } from '../utils/file-utils';

@Injectable({ providedIn: 'root' })
export class MarkdownRenderService {
  private mermaidInitialised = false;
  private mermaidSeq = 0;

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
      const id = raw.toLowerCase()
        .replace(/<[^>]*>/g, '')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .trim();
      return `<h${level} id="${id}">${text}</h${level}>\n`;
    };
    // Mermaid: emit a placeholder that runMermaid() can find.
    // marked HTML-escapes code content, so the source survives intact in
    // the text node — mermaid reads textContent, which un-escapes for us.
    renderer.code = (code: string, lang: string | undefined) => {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        const escaped = code
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        return `<pre class="mermaid">${escaped}</pre>`;
      }
      // Fallback to marked's default code rendering.
      const langClass = lang ? ` class="language-${lang}"` : '';
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<pre><code${langClass}>${escaped}</code></pre>\n`;
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
    const renderer = new Renderer();
    renderer.code = (code: string, lang: string | undefined) => {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        return `<pre class="mermaid">${this.escape(code)}</pre>`;
      }
      const langClass = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${langClass}>${this.escape(code)}</code></pre>\n`;
    };
    const html = marked.parse(content, { renderer }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
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

  private attachExpandButton(host: HTMLElement, source: string): void {
    host.classList.add('dv-mermaid-wrap');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dv-mermaid-expand';
    btn.title = 'Expand (fullscreen with zoom & pan)';
    btn.innerHTML = '<span class="material-icons">open_in_full</span>';
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.openFullscreen(source);
    });
    host.appendChild(btn);
  }

  private async openFullscreen(source: string): Promise<void> {
    const overlay = document.createElement('div');
    overlay.className = 'dv-mermaid-overlay';

    const header = document.createElement('div');
    header.className = 'dv-mermaid-overlay-header';

    const stage = document.createElement('div');
    stage.className = 'dv-mermaid-overlay-stage';

    overlay.appendChild(header);
    overlay.appendChild(stage);
    document.body.appendChild(overlay);

    const id = `mermaid-fs-${++this.mermaidSeq}`;
    try {
      const { svg, bindFunctions } = await mermaid.render(id, source);
      stage.innerHTML = svg;
      bindFunctions?.(stage);
    } catch (err) {
      stage.innerHTML = `<div style="color:#fca5a5;font-family:monospace;">Render error: ${this.escape(String(err))}</div>`;
    }

    let scale = 1;
    let tx = 0;
    let ty = 0;
    const svgEl = stage.querySelector('svg') as SVGElement | null;
    const apply = () => {
      if (svgEl) svgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
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

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
