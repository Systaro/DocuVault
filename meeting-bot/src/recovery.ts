import { config } from './config.js';
import { DocuVaultClient } from './docuvault.js';
import { MeetingSession, type RecoveryDescriptor } from './session.js';

/** Max finalize attempts before a recording is declared unrecoverable and the
 *  invite is failed. Each boot that reaches finalize counts as one attempt, so a
 *  recording that repeatedly crashes the bot can't loop forever. */
const MAX_ATTEMPTS = 3;

/** Rebuilds the DocuVault client for a recovered session. Discord uses the
 *  stored one-time token; Teams re-reads the service dispatch token from the
 *  environment and addresses the invite by id (the token is never persisted). */
function buildClient(recovery: RecoveryDescriptor): DocuVaultClient | null {
  if (recovery.platform === 'TEAMS') {
    if (!config.dispatchToken) return null;
    return DocuVaultClient.forTeamsInvite(config.dispatchToken, recovery.inviteId);
  }
  return new DocuVaultClient(recovery.token);
}

/**
 * Finalizes meetings interrupted by a bot restart. Scans the recordings dir for
 * in-progress manifests and, for each, transcribes what was captured and files
 * the notes — so a deploy or crash mid-meeting resumes instead of losing the
 * recording. Runs once at startup, before the adapters accept new meetings.
 *
 * Best-effort and self-contained: any one recording failing never blocks the
 * others or startup.
 */
export async function runRecovery(): Promise<void> {
  const ids = await MeetingSession.listRecoverable();
  if (ids.length === 0) return;
  console.log(`Recovery: found ${ids.length} interrupted meeting(s) to finalize`);

  for (const id of ids) {
    try {
      const meta = await MeetingSession.readMeta(id);
      const client = buildClient(meta.recovery);
      if (!client) {
        // Can't rebuild the client (e.g. a Teams recording but no dispatch token
        // configured on this bot) — leave it for a bot that can.
        console.warn(`Recovery: skipping ${id} — client unavailable for ${meta.recovery.platform}`);
        continue;
      }

      if ((meta.attempts ?? 0) >= MAX_ATTEMPTS) {
        console.error(`Recovery: giving up on ${id} after ${meta.attempts} attempts`);
        await client.fail('Aufnahme konnte nach mehreren Neustarts nicht verarbeitet werden.');
        await MeetingSession.discard(id);
        continue;
      }

      // Count the attempt before trying, so a recording that crashes the bot
      // mid-finalize still advances toward the cap.
      const attempt = await MeetingSession.bumpAttempts(id);
      console.log(`Recovery: finalizing ${id} „${meta.label}" (attempt ${attempt}/${MAX_ATTEMPTS})`);

      const session = await MeetingSession.restore(client, id);
      if (session.utteranceCount === 0) {
        await client.fail('Aufnahme nach Neustart leer — kein Sprachinhalt erfasst.');
        await session.cleanup();
        continue;
      }
      const noteCount = await session.finishAndSubmit();
      console.log(`Recovery: ${id} done — ${noteCount} note(s) filed`);
    } catch (err) {
      // Leave the dir in place; the next boot retries until the attempt cap.
      console.error(`Recovery: failed to finalize ${id} (will retry next boot):`, err);
    }
  }
}
