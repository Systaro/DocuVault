import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AnnotationAnchor {
  type: 'markdown' | 'image' | 'html' | 'pdf';
  xPercent: number;
  yPercent: number;
  snippet?: string;
  page?: number;
  selector?: string;
  elementId?: string;
  offsetX?: number;
  offsetY?: number;
}

export interface Annotation {
  id: string;
  spaceId: string;
  filePath: string;
  userId: string | null;
  authorName: string;
  parentId: string | null;
  body: string;
  anchor: AnnotationAnchor | null;
  resolved: boolean;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: Annotation[];
}

export type AnnotationPermission = 'NONE' | 'VIEW' | 'COMMENT' | 'EDIT' | 'ADMIN';

export interface CreateAnnotationRequest {
  body: string;
  anchor?: AnnotationAnchor | null;
  parentId?: string | null;
  authorName?: string | null;
}

@Injectable({ providedIn: 'root' })
export class AnnotationsService {
  constructor(private http: HttpClient) {}

  // --- Internal (authenticated) endpoints ---

  getAnnotations(spaceId: string, filePath: string): Observable<Annotation[]> {
    return this.http.get<Annotation[]>(`/api/spaces/${spaceId}/annotations`, { params: { filePath } });
  }

  createAnnotation(spaceId: string, filePath: string, request: CreateAnnotationRequest): Observable<Annotation> {
    return this.http.post<Annotation>(`/api/spaces/${spaceId}/annotations`, request, { params: { filePath } });
  }

  updateAnnotation(spaceId: string, annotationId: string, body: string): Observable<Annotation> {
    return this.http.patch<Annotation>(`/api/spaces/${spaceId}/annotations/${annotationId}`, { body });
  }

  toggleResolve(spaceId: string, annotationId: string): Observable<Annotation> {
    return this.http.patch<Annotation>(`/api/spaces/${spaceId}/annotations/${annotationId}/resolve`, {});
  }

  deleteAnnotation(spaceId: string, annotationId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/annotations/${annotationId}`);
  }

  // --- Public (shared link) endpoints ---

  getPublicAnnotations(token: string, filePath: string): Observable<Annotation[]> {
    return this.http.get<Annotation[]>(`/api/shared/${token}/annotations`, {
      params: { filePath },
      withCredentials: true
    });
  }

  createPublicAnnotation(token: string, filePath: string, request: CreateAnnotationRequest): Observable<Annotation> {
    return this.http.post<Annotation>(`/api/shared/${token}/annotations`, request, {
      params: { filePath },
      withCredentials: true
    });
  }

  togglePublicResolve(token: string, annotationId: string): Observable<Annotation> {
    return this.http.patch<Annotation>(`/api/shared/${token}/annotations/${annotationId}/resolve`, {}, {
      withCredentials: true
    });
  }

  deletePublicAnnotation(token: string, annotationId: string): Observable<void> {
    return this.http.delete<void>(`/api/shared/${token}/annotations/${annotationId}`, {
      withCredentials: true
    });
  }

  // --- Permission ---

  getMyPermission(spaceId: string): Observable<{ level: string }> {
    return this.http.get<{ level: string }>(`/api/spaces/${spaceId}/my-permission`);
  }
}
