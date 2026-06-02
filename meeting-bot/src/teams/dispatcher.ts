import { config } from '../config.js';
import { listPendingTeamsInvites } from '../docuvault.js';
import { TeamsMeeting } from './bot.js';

/**
 * Standing Teams adapter. Unlike Discord (which is triggered from inside a call
 * over a gateway), a browser bot has to be told where to go — so it polls
 * DocuVault for pending Teams invites and dispatches a headless Chromium guest
 * into each meeting. Claiming flips the invite ACTIVE, so a meeting already
 * being joined won't be picked up twice; the in-memory map guards the window
 * between dispatch and claim.
 */
const active = new Map<string, TeamsMeeting>();

export function startTeamsDispatcher(): void {
  const dispatchToken = config.dispatchToken;
  if (!dispatchToken) throw new Error('MEETING_BOT_DISPATCH_TOKEN is required for the Teams adapter');

  console.log(
    `Teams dispatcher polling ${config.docuvaultApiUrl} every ${config.teamsPollMs}ms ` +
      `(max ${config.maxConcurrentTeams} concurrent)`,
  );

  const tick = async (): Promise<void> => {
    let pending;
    try {
      pending = await listPendingTeamsInvites(dispatchToken);
    } catch (err) {
      console.error('Teams dispatch poll failed:', (err as Error).message);
      return;
    }
    for (const invite of pending) {
      if (active.has(invite.inviteId)) continue;
      if (active.size >= config.maxConcurrentTeams) {
        console.warn(
          `At capacity (${config.maxConcurrentTeams}); deferring „${invite.label}" to a later poll.`,
        );
        break;
      }
      console.log(`Dispatching Teams bot for „${invite.label}" (${invite.inviteId})`);
      const meeting = new TeamsMeeting(invite, dispatchToken);
      active.set(invite.inviteId, meeting);
      void meeting
        .run()
        .catch((err) => console.error(`[teams ${invite.inviteId}] crashed:`, err))
        .finally(() => active.delete(invite.inviteId));
    }
  };

  void tick();
  setInterval(() => void tick(), config.teamsPollMs);
}
