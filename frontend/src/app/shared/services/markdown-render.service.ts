import { Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked, Renderer } from 'marked';
import { resolveRelativePath } from '../utils/file-utils';

@Injectable({ providedIn: 'root' })
export class MarkdownRenderService {
  constructor(private sanitizer: DomSanitizer) {}

  /**
   * Render markdown to sanitized HTML, rewriting relative image/link paths.
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
}
