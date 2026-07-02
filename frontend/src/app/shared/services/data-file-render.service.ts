import { Injectable } from '@angular/core';
import hljs from 'highlight.js/lib/common';

/**
 * Renders structured data files (JSON, CSV/TSV/TAB, SQL, spreadsheet rows) into
 * readable HTML for the read-only viewer, instead of dumping them as one raw
 * blob through the markdown pipeline. JSON is pretty-printed and syntax
 * highlighted, delimited files become tables, SQL gets syntax highlighting.
 *
 * All output is designed to wrap rather than side-scroll — see the `.data-*`
 * rules in styles.scss.
 */
@Injectable({ providedIn: 'root' })
export class DataFileRenderService {
  /** Text-based data extensions handled through the normal (text) load path. */
  private static readonly TEXT_DATA_EXTENSIONS = new Set([
    'json', 'csv', 'tsv', 'tab', 'sql'
  ]);

  /** Whether a text-based data file should be rendered by {@link render}. */
  isDataFile(ext: string): boolean {
    return DataFileRenderService.TEXT_DATA_EXTENSIONS.has(ext.toLowerCase());
  }

  /** Render the raw text content of a data file to HTML. */
  render(content: string, ext: string): string {
    switch (ext.toLowerCase()) {
      case 'json': return this.renderJson(content);
      case 'sql': return this.renderSql(content);
      case 'csv': return this.renderDelimited(content, ',');
      case 'tsv':
      case 'tab': return this.renderDelimited(content, '\t');
      default: return this.renderCode(this.escape(content), '');
    }
  }

  private renderJson(content: string): string {
    let text = content;
    // Pretty-print when it parses; otherwise show the source as-is.
    try {
      text = JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      // leave `text` as the original content
    }
    return this.renderCode(this.highlight(text, 'json'), 'data-json', 'json');
  }

  private renderSql(content: string): string {
    return this.renderCode(this.highlight(content, 'sql'), 'data-sql', 'sql');
  }

  private highlight(code: string, language: string): string {
    if (hljs.getLanguage(language)) {
      try {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      } catch {
        // fall through to escaped plain text
      }
    }
    return this.escape(code);
  }

  private renderCode(highlighted: string, extraClass: string, language = ''): string {
    const langClass = language ? ` language-${language}` : '';
    return `<pre class="data-view ${extraClass}"><code class="hljs${langClass}">${highlighted}</code></pre>`;
  }

  private renderDelimited(content: string, delimiter: string): string {
    return this.renderTable(this.parse(content, delimiter));
  }

  /**
   * Build an HTML table from a matrix of already-parsed string cells. The first
   * row is treated as the header. Shared by CSV/TSV/TAB and the spreadsheet
   * (xlsx) path in the editor.
   */
  renderTable(rows: string[][]): string {
    if (!rows.length || (rows.length === 1 && rows[0].every(c => c === ''))) {
      return '<p class="data-empty">This file is empty.</p>';
    }
    const cols = rows.reduce((max, r) => Math.max(max, r.length), 0);
    const cell = (r: string[], i: number) => this.escape(i < r.length ? r[i] : '');

    const [header, ...body] = rows;
    const headHtml = Array.from({ length: cols }, (_, i) => `<th>${cell(header, i)}</th>`).join('');
    const bodyHtml = body.map(r =>
      `<tr>${Array.from({ length: cols }, (_, i) => `<td>${cell(r, i)}</td>`).join('')}</tr>`
    ).join('');

    return `<div class="data-table-wrap"><table class="data-table">` +
      `<thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  }

  /**
   * Parse delimited text into rows of cells. Handles RFC-4180 style quoting
   * (double-quoted fields, escaped `""`, embedded delimiters and newlines) so
   * quoted CSV cells containing commas or line breaks survive intact.
   */
  private parse(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const s = text.replace(/\r\n?/g, '\n');

    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Drop a trailing empty line (files usually end with a newline).
    return rows.filter(r => !(r.length === 1 && r[0] === ''));
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
