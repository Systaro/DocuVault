import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DocumentSettings {
  [key: string]: unknown;
  contentWidthPx?: number;
}

@Injectable({ providedIn: 'root' })
export class DocumentSettingsService {
  constructor(private http: HttpClient) {}

  getSettings(spaceId: string, filePath: string): Observable<DocumentSettings> {
    return this.http.get<DocumentSettings>(
      `/api/spaces/${spaceId}/document-settings`,
      { params: new HttpParams().set('filePath', filePath) }
    );
  }

  updateSettings(
    spaceId: string,
    filePath: string,
    settings: DocumentSettings
  ): Observable<DocumentSettings> {
    return this.http.put<DocumentSettings>(
      `/api/spaces/${spaceId}/document-settings`,
      { settings },
      { params: new HttpParams().set('filePath', filePath) }
    );
  }
}
