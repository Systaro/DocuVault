import { config } from './config.js';
import { startBot } from './discord/bot.js';
import { runRecovery } from './recovery.js';
import { startTeamsDispatcher } from './teams/dispatcher.js';

if (!config.discordToken && !config.dispatchToken) {
  console.error(
    'No meeting adapter configured. Set DISCORD_TOKEN and/or MEETING_BOT_DISPATCH_TOKEN.',
  );
  process.exit(1);
}

// Finalize any meeting interrupted by the previous shutdown before accepting new
// ones, so a deploy/crash mid-meeting resumes and files its notes rather than
// stranding the recording. Best-effort — never blocks the adapters from starting.
await runRecovery().catch((err) => console.error('Recovery pass failed:', err));

// Each adapter is started only when its credential is configured, so a single
// image can run Discord, Teams, or both.
if (config.discordToken) {
  console.log('Starting Discord adapter');
  startBot();
}
if (config.dispatchToken) {
  console.log('Starting Teams adapter');
  startTeamsDispatcher();
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
