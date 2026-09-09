import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Server-side PDF rendering, when the install has a renderer configured
 * (capability `pdfRenderer`). The HTML is sent up rather than re-rendered on
 * the server so the PDF matches the page the reader is looking at.
 *
 * Without a renderer this is never called and the editor falls back to the
 * browser's print dialog.
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
}
