import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';

/**
 * Handles exporting files that use the DocuVault State Library
 * (assets/docuvault-state.js): detects state usage in HTML content and
 * triggers plain or frozen-state downloads.
 */
@Injectable({ providedIn: 'root' })
export class StateExportService {
  private static readonly INIT_PATTERN = /DocuVaultState\s*\.\s*init\s*\(/;

  constructor(private http: HttpClient) {}

  /** True if the given HTML content initializes the DocuVault State Library. */
  htmlUsesState(html: string): boolean {
    return StateExportService.INIT_PATTERN.test(html);
  }

  /** True if the file is an HTML file (the only type that can carry state). */
  isHtmlFile(path: string): boolean {
    return /\.html?$/i.test(path);
  }

  /**
   * Checks whether the file at the given path uses DocuVault state.
   * Resolves to false for non-HTML files without fetching anything.
   */
  checkFileUsesState(spaceId: string, path: string): Observable<boolean> {
    if (!this.isHtmlFile(path)) return of(false);
    return this.http
      .get(this.fileUrl(spaceId, path, { download: true }), { responseType: 'text' })
      .pipe(map((html) => this.htmlUsesState(html)));
  }

  /** Triggers a browser download of the file, optionally with frozen state embedded. */
  download(spaceId: string, path: string, withState: boolean): void {
    const url = this.fileUrl(spaceId, path, { download: true, includeState: withState });
    const a = document.createElement('a');
    a.href = url;
    a.download = path.split('/').pop() || 'document';
    a.click();
  }

  private fileUrl(spaceId: string, path: string, params: { download?: boolean; includeState?: boolean }): string {
    const query = new URLSearchParams();
    if (params.download) query.set('download', 'true');
    if (params.includeState) query.set('includeState', 'true');
    return `/api/spaces/${spaceId}/files/${path}?${query.toString()}`;
  }
}
