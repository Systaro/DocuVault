import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type MeetingPlatform = 'DISCORD' | 'TEAMS';
export type MeetingInviteStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface MeetingInvite {
  id: string;
  spaceId: string;
  label: string;
  platform: MeetingPlatform;
  status: MeetingInviteStatus;
  tokenPrefix: string;
  /** Full token — only present in the response to invite creation. */
  token: string | null;
  meetingChannel: string | null;
  participants: string | null;
  noteCount: number;
  error: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class MeetingService {
  constructor(private http: HttpClient) {}

  listInvites(spaceId: string): Observable<MeetingInvite[]> {
    return this.http.get<MeetingInvite[]>(`/api/spaces/${spaceId}/meetings`);
  }

  createInvite(
    spaceId: string,
    label: string,
    platform: MeetingPlatform = 'DISCORD',
  ): Observable<MeetingInvite> {
    return this.http.post<MeetingInvite>(`/api/spaces/${spaceId}/meetings`, { label, platform });
  }

  cancelInvite(spaceId: string, inviteId: string): Observable<void> {
    return this.http.delete<void>(`/api/spaces/${spaceId}/meetings/${inviteId}`);
  }
}
