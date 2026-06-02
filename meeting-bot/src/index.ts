import { config } from './config.js';
import { startBot } from './discord/bot.js';
import { startTeamsDispatcher } from './teams/dispatcher.js';

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
if (!config.discordToken && !config.dispatchToken) {
  console.error(
    'No meeting adapter configured. Set DISCORD_TOKEN and/or MEETING_BOT_DISPATCH_TOKEN.',
  );
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
