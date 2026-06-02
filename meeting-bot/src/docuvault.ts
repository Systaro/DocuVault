import { config } from './config.js';

export interface ClaimResult {
  spaceId: string;
  spaceName: string;
  label: string;
  /** ISO-639-1 spoken language to pin for speech-to-text and the meeting note. */
  language: string;
  /** Direct URL to the target space's inbox view. */
  inboxUrl: string;
}

/** Live transcription stage reported to DocuVault, mirrors the backend enum. */
export type MeetingPhase = 'RECORDING' | 'PROCESSING' | 'TRANSCRIBING' | 'SUMMARIZING';

export interface ProgressUpdate {
  current?: number;
  total?: number;
  message?: string;
}

/** A pending Teams invite the dispatcher should join, from the dispatch poll. */
export interface PendingTeamsInvite {
  inviteId: string;
  meetingUrl: string;
  label: string;
  /** ISO-639-1 spoken language to pin for the generated note. */
  language: string;
}

/**
 * Thin client for the DocuVault meeting-bot API, used per meeting for the
 * claim → progress → notes/fail lifecycle.
 *
 * Two credential models share these operations:
 *  • Discord — the per-invite dvm_ token against `/meetings/bot/*`.
 *  • Teams   — the service-level dispatch token against
 *    `/meetings/bot/teams/{inviteId}/*` (see {@link forTeamsInvite}).
 * Only the bearer token and the path prefix differ, so the operations below are
 * shared verbatim.
 */
export class DocuVaultClient {
  /**
   * @param token   bearer token sent on every request
   * @param opBase  path prefix the lifecycle operations hang off of
   */
  constructor(
    private readonly token: string,
    private readonly opBase: string = '/meetings/bot',
  ) {}

  /** Builds a client for a Teams invite, authenticated by the dispatch token
   *  and addressing the invite by id. */
  static forTeamsInvite(dispatchToken: string, inviteId: string): DocuVaultClient {
    return new DocuVaultClient(dispatchToken, `/meetings/bot/teams/${inviteId}`);
  }

  /** Tells DocuVault the bot has joined a call; returns the target space. */
  claim(meetingChannel: string): Promise<ClaimResult> {
    return this.post<ClaimResult>(`${this.opBase}/claim`, { meetingChannel });
  }

  /** Submits the finished notes (HTML) to the space inbox. */
  submitNotes(notes: string[], participants: string): Promise<unknown> {
    return this.post(`${this.opBase}/notes`, { notes, participants });
  }

  /**
   * Reports a live progress update so the DocuVault UI can show transcription
   * status in real time. Best-effort — progress reporting must never break the
   * actual transcription, so failures are swallowed.
   */
  async progress(phase: MeetingPhase, update: ProgressUpdate = {}): Promise<void> {
    try {
      await this.post(`${this.opBase}/progress`, { phase, ...update });
    } catch (err) {
      console.error('Failed to report progress to DocuVault:', err);
    }
  }

  /** Records an unrecoverable error against the invite. Never throws. */
  async fail(error: string): Promise<void> {
    try {
      await this.post(`${this.opBase}/fail`, { error });
    } catch (err) {
      console.error('Failed to report failure to DocuVault:', err);
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${config.docuvaultApiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`DocuVault ${path} → ${res.status} ${detail}`.trim());
    }
    return (await res.json()) as T;
  }
}

/**
 * Polls the Teams dispatch endpoint for invites the browser bot should join.
 * Authenticated by the service-level dispatch token (not a per-invite token).
 */
export async function listPendingTeamsInvites(
  dispatchToken: string,
): Promise<PendingTeamsInvite[]> {
  const res = await fetch(`${config.docuvaultApiUrl}/meetings/bot/teams/pending`, {
    headers: { Authorization: `Bearer ${dispatchToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`DocuVault /meetings/bot/teams/pending → ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as PendingTeamsInvite[];
}
