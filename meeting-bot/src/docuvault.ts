import { config } from './config.js';

export interface ClaimResult {
  spaceId: string;
  spaceName: string;
  label: string;
  /** Direct URL to the target space's inbox view. */
  inboxUrl: string;
}

/**
 * Thin client for the DocuVault meeting-bot API. The meeting token is the only
 * credential — it is scoped to one space and one meeting, server-side.
 */
export class DocuVaultClient {
  constructor(private readonly token: string) {}

  /** Tells DocuVault the bot has joined a call; returns the target space. */
  claim(meetingChannel: string): Promise<ClaimResult> {
    return this.post<ClaimResult>('/meetings/bot/claim', { meetingChannel });
  }

  /** Submits the finished notes (HTML) to the space inbox. */
  submitNotes(notes: string[], participants: string): Promise<unknown> {
    return this.post('/meetings/bot/notes', { notes, participants });
  }

  /** Records an unrecoverable error against the invite. Never throws. */
  async fail(error: string): Promise<void> {
    try {
      await this.post('/meetings/bot/fail', { error });
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
