import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * PDF export, two ways. With a renderer configured for the install (capability
 * `pdfRenderer`) the HTML goes up to the server and comes back as a file; the
 * HTML is sent rather than re-rendered there so the PDF matches the page the
 * reader is looking at. Without one, the document opens in a print window and
 * the browser's own "Save as PDF" does the rest.
 */
@Injectable({ providedIn: 'root' })
export class PdfExportService {
  private http = inject(HttpClient);

  render(html: string, title: string): Observable<Blob> {
    return this.http.post('/api/pdf/render', { html, title }, { responseType: 'blob' });
  }

  /** Hands the finished PDF to the browser as a download. */
  save(pdf: Blob, filename: string): void {
    const url = URL.createObjectURL(pdf);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking straight away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * The standalone HTML that becomes the PDF, whether it is rendered on the
   * server or run through the browser's print dialog. One source for both, so
   * a change to the styling cannot land in one output and miss the other.
   */
  printableDocument(title: string, bodyContent: string, forPrint = false): string {
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 1.8em; margin-bottom: 0.5em; }
  h2 { font-size: 1.4em; margin-top: 1.5em; }
  h3 { font-size: 1.2em; margin-top: 1.2em; }
  pre { background: #f5f5f5; padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 0.9em; }
  code { background: #f5f5f5; padding: 2px 4px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #555; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0; }
  ul[data-type="taskList"] li { display: flex; align-items: baseline; gap: 8px; }
  ul[data-type="taskList"] li::before { content: "☐"; }
  ul[data-type="taskList"] li[data-checked="true"]::before { content: "☑"; }
  a { color: #2563eb; }
  ${forPrint ? '@media print { body { padding: 0; } }' : '@page { margin: 18mm 16mm; } body { padding: 0; max-width: none; }'}
</style>
</head><body>${bodyContent}</body></html>`;
  }

  /**
   * Opens `bodyContent` as a printable document in a new window and starts the
   * print dialog. Returns false when the browser blocked the window.
   */
  print(title: string, bodyContent: string): boolean {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return false;

    printWindow.document.write(this.printableDocument(title, bodyContent, true));
    printWindow.document.close();
    this.printWhenLoaded(printWindow);
    return true;
  }

  /**
   * Prints a page that is already a complete document (a shared HTML file) as
   * it is, with its own styles. The URL must be same-origin, or the window
   * cannot be told to print. Returns false when the browser blocked the window.
   */
  printUrl(url: string): boolean {
    const printWindow = window.open(url, '_blank');
    if (!printWindow) return false;
    printWindow.addEventListener('load', () => this.printWhenLoaded(printWindow));
    return true;
  }

  private printWhenLoaded(printWindow: Window): void {
    // document.write() often finishes before this runs, so waiting for
    // `onload` alone can mean waiting forever. Check the state first, and give
    // images a chance to arrive — printing before they load prints gaps.
    const print = (): void => {
      const images = Array.from(printWindow.document.images);
      const pending = images.filter(img => !img.complete);
      let left = pending.length;
      const go = (): void => { printWindow.focus(); printWindow.print(); };
      if (!left) { go(); return; }
      const done = (): void => { if (--left === 0) go(); };
      pending.forEach(img => { img.addEventListener('load', done); img.addEventListener('error', done); });
      // A stuck image must not hold the export hostage.
      setTimeout(() => { if (left > 0) { left = 0; go(); } }, 3000);
    };
    if (printWindow.document.readyState === 'complete') print();
    else printWindow.addEventListener('load', print);
  }
}
