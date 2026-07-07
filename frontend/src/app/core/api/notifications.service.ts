import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface NotificationFeedItem {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceFullPath: string;
  filePath: string;
  changeType: 'ADDED' | 'MODIFIED' | 'DELETED' | 'RENAMED';
  commitMessage: string | null;
  authorName: string | null;
  detectedAt: string;
  unseen: boolean;
}

export interface NotificationFeed {
  items: NotificationFeedItem[];
  unseenCount: number;
  seenAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  constructor(private http: HttpClient) {}

  getFeed(limit = 30): Observable<NotificationFeed> {
    const params = new HttpParams().set('limit', limit.toString());
    return this.http.get<NotificationFeed>('/api/notifications/feed', { params });
  }

  markSeen(): Observable<{ seenAt: string }> {
    return this.http.post<{ seenAt: string }>('/api/notifications/feed/seen', {});
  }
}
