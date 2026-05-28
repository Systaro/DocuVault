import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, share } from 'rxjs';

export type MeetingPlatform = 'DISCORD' | 'TEAMS';
export type MeetingInviteStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type MeetingPhase = 'RECORDING' | 'PROCESSING' | 'TRANSCRIBING' | 'SUMMARIZING';

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
  /** Live sub-stage while ACTIVE; null otherwise. */
  phase: MeetingPhase | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  progressMessage: string | null;
  error: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** German status line for a live meeting invite — shared by every surface that
 *  shows transcription progress so the wording stays in one place. */
export function meetingPhaseLabel(invite: MeetingInvite): string {
  if (invite.progressMessage) return invite.progressMessage;
  switch (invite.phase) {
    case 'RECORDING': return 'Aufnahme läuft';
    case 'PROCESSING': return 'Verarbeite Aufnahme…';
    case 'TRANSCRIBING': return 'Transkribiere…';
    case 'SUMMARIZING': return 'Erstelle Protokoll…';
    default: return 'Läuft';
  }
}

@Injectable({ providedIn: 'root' })
export class MeetingService {
  /** One shared SSE connection per space, multicast to all subscribers. */
  private streams = new Map<string, Observable<MeetingInvite>>();

  constructor(private http: HttpClient, private zone: NgZone) {}

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

  /**
   * Live stream of invite updates for a space over Server-Sent Events. The
   * connection is shared across subscribers and torn down when the last one
   * unsubscribes; EventSource itself reconnects automatically on transient drops.
   */
  streamInvites(spaceId: string): Observable<MeetingInvite> {
    let stream = this.streams.get(spaceId);
    if (!stream) {
      stream = new Observable<MeetingInvite>((subscriber) => {
        const source = new EventSource(`/api/spaces/${spaceId}/meetings/stream`, {
          withCredentials: true,
        });
        source.addEventListener('invite', (event) => {
          const invite = JSON.parse((event as MessageEvent).data) as MeetingInvite;
          // EventSource callbacks run outside Angular — re-enter so signals update.
          this.zone.run(() => subscriber.next(invite));
        });
        return () => source.close();
      }).pipe(share());
      this.streams.set(spaceId, stream);
    }
    return stream;
  }
}
