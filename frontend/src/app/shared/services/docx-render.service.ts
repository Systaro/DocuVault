import { Injectable } from '@angular/core';
import { loadVendorScript } from '../utils/vendor-script';

/** Link schemes a rendered Word document may keep; anything else loses its href. */
const SAFE_LINK = /^(https?:|mailto:|#)/i;

/**
 * Word writes list bullets as private-use code points of the Symbol and
 * Wingdings fonts (U+F0xx). Only Windows ships those fonts, so everywhere else
 * the markers render as empty boxes; these are the ones Word's bullet library uses.
 */
const SYMBOL_BULLETS: Record<string, string> = {
  '\uF0B7': '•', // Symbol: bullet
  '\uF0A7': '▪', // Wingdings: small square
  '\uF0D8': '➢', // Wingdings: arrowhead
  '\uF076': '❖', // Wingdings: diamond
  '\uF0FC': '✓', // Wingdings: check mark
  '\uF06E': '■', // Wingdings: square
  '\uF071': '❑', // Wingdings: shadowed square
  '\uF0A8': '◻', // Wingdings: hollow square
};
const SYMBOL_BULLET_CHARS = new RegExp(`[${Object.keys(SYMBOL_BULLETS).join('')}]`, 'g');

/**
 * OOXML lets a length carry its unit (`w:sz="4.3mm"`, `w:top="1in"`) instead of
 * the bare twips / half-points number. Teams transcripts are written that way,
 * and docx-preview reads only the number, so `4.3mm` came out as 2pt text and
 * `1in` page margins as one twip. Twips per unit:
 */
const TWIPS_PER_UNIT: Record<string, number> = {
  in: 1440, pt: 20, pc: 240, pi: 240, mm: 1440 / 25.4, cm: 1440 / 2.54,
};
/** Elements whose lengths are half-points; every other length is in twips. */
const HALF_POINT_ELEMENTS = new Set(['sz', 'szCs', 'kern', 'position']);
const UNIT_ATTRIBUTE = /(w:\w+)="(-?\d+(?:\.\d+)?)(in|pt|pc|pi|mm|cm)"/g;

/**
 * Renders a Word document (.docx) into a host element with docx-preview, page
 * by page, keeping fonts, tables, headers/footers and embedded images.
 *
 * docx-preview and its JSZip dependency are loaded on demand from `/vendor`
 * (see loadVendorScript) rather than bundled, the same as SheetJS for xlsx.
 * The UMD build of docx-preview reads JSZip from the global, so it loads first.
 */
@Injectable({ providedIn: 'root' })
export class DocxRenderService {
  private libs?: Promise<any>;

  async render(data: ArrayBuffer, host: HTMLElement): Promise<void> {
    const docx = await this.loadLibs();
    const normalized = await this.normalizeUnits(data);
    host.replaceChildren();
    // Styles go into the host too, so they leave with it when the viewer does.
    await docx.renderAsync(normalized, host, host, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      // Embedded HTML chunks would run as live markup in our page, and comments /
      // tracked changes have no counterpart in this read-only view.
      renderAltChunks: false,
      renderComments: false,
      renderChanges: false,
      experimental: false,
      useBase64URL: true,
    });
    this.sanitizeLinks(host);
    this.replaceSymbolBullets(host);
  }

  /** Rewrite unit-suffixed lengths in the document's XML parts as plain twips / half-points. */
  private async normalizeUnits(data: ArrayBuffer): Promise<ArrayBuffer> {
    const JSZip = (window as any).JSZip;
    const zip = await JSZip.loadAsync(data);
    let changed = false;
    const parts = Object.keys(zip.files).filter(name => /^word\/[^/]+\.xml$/.test(name));
    for (const name of parts) {
      const xml: string = await zip.file(name).async('string');
      const fixed = xml.replace(/<w:(\w+)\b[^>]*>/g, (tag, element: string) =>
        tag.replace(UNIT_ATTRIBUTE, (_m, attr: string, value: string, unit: string) => {
          const twips = parseFloat(value) * TWIPS_PER_UNIT[unit];
          const converted = HALF_POINT_ELEMENTS.has(element) ? twips / 10 : twips;
          return `${attr}="${Math.round(converted)}"`;
        })
      );
      if (fixed !== xml) {
        zip.file(name, fixed);
        changed = true;
      }
    }
    return changed ? zip.generateAsync({ type: 'arraybuffer' }) : data;
  }

  /** Swap Symbol/Wingdings bullets in the generated list styles for Unicode ones. */
  private replaceSymbolBullets(host: HTMLElement): void {
    host.querySelectorAll('style').forEach(style => {
      const css = style.textContent ?? '';
      const fixed = css.replace(SYMBOL_BULLET_CHARS, ch => SYMBOL_BULLETS[ch]);
      if (fixed !== css) {
        style.textContent = fixed.replace(/font-family:\s*(Symbol|Wingdings);/g, '');
      }
    });
  }

  /**
   * Hyperlink targets come straight from the file, so a `javascript:` URL in a
   * shared document would run in the viewer's session. Keep web, mail and
   * in-document links; open external ones in a new tab.
   */
  private sanitizeLinks(host: HTMLElement): void {
    host.querySelectorAll('a[href]').forEach(a => {
      const href = (a.getAttribute('href') ?? '').trim();
      if (!SAFE_LINK.test(href)) {
        a.removeAttribute('href');
      } else if (!href.startsWith('#')) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  private loadLibs(): Promise<any> {
    if (!this.libs) {
      this.libs = loadVendorScript('/vendor/jszip.min.js', 'JSZip')
        .then(() => loadVendorScript('/vendor/docx-preview.min.js', 'docx'))
        .catch(err => {
          this.libs = undefined;
          throw err;
        });
    }
    return this.libs;
  }
}
