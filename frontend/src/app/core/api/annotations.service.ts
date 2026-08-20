import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * The stored anchor. Legacy rows carry only the flat percentage fields; v1 rows
 * add the `selectors` list, which is what actually gets resolved. Both shapes
 * travel in the same field, so this type is the union of the two.
 */
export interface AnnotationAnchor {
  type: 'markdown' | 'image' | 'html' | 'pdf' | 'text';
  xPercent?: number;
  yPercent?: number;
  snippet?: string;
  page?: number;
  selector?: string;
  elementId?: string;
  offsetX?: number;
  offsetY?: number;
  /** Anchor schema version; absent or 0 means the legacy percentage-only anchor. */
  v?: number;
  selectors?: unknown[];
  docHash?: string;
}

/** How confidently the comment could be put back on the document. */
export type AnchorState = 'ANCHORED' | 'SHIFTED' | 'ORPHANED';

export interface Annotation {
  id: string;
  spaceId: string;
  filePath: string;
  userId: string | null;
  authorName: string;
  parentId: string | null;
  body: string;
  /** Where the comment was originally put. Never rewritten. */
  anchor: AnnotationAnchor | null;
  /** Where it last resolved to; falls back to `anchor` when never re-anchored. */
  anchorCurrent: AnnotationAnchor | null;
  anchorState: AnchorState;
  anchorDocHash: string | null;
  anchorVersion: number;
  resolved: boolean;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  replies: Annotation[];
}

export type AnnotationPermission = 'NONE' | 'VIEW' | 'COMMENT' | 'EDIT' | 'ADMIN';

export interface AnnotationCounts {
  total: number;
  perFile: Record<string, number>;
  /** Open comments whose text no longer exists — not the same as resolved. */
  unanchored: number;
}

export interface CreateAnnotationRequest {
  body: string;
  anchor?: AnnotationAnchor | null;
  parentId?: string | null;
  authorName?: string | null;
  docHash?: string | null;
}

/** A cache write recording where a comment currently lands — not content. */
export interface UpdateAnchorRequest {
  anchorCurrent?: AnnotationAnchor | null;
  anchorState: AnchorState;
  docHash?: string | null;
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

  updateAnchor(spaceId: string, annotationId: string, request: UpdateAnchorRequest): Observable<Annotation> {
    return this.http.patch<Annotation>(`/api/spaces/${spaceId}/annotations/${annotationId}/anchor`, request);
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

  updatePublicAnchor(token: string, annotationId: string, request: UpdateAnchorRequest): Observable<Annotation> {
    return this.http.patch<Annotation>(`/api/shared/${token}/annotations/${annotationId}/anchor`, request, {
      withCredentials: true
    });
  }

  // --- Counts ---

  getAnnotationCounts(spaceId: string): Observable<AnnotationCounts> {
    return this.http.get<AnnotationCounts>(`/api/spaces/${spaceId}/annotations/counts`);
  }

  // --- Permission ---

  getMyPermission(spaceId: string): Observable<{ level: string }> {
    return this.http.get<{ level: string }>(`/api/spaces/${spaceId}/my-permission`);
  }
}
