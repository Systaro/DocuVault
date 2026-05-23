import { startBot } from './discord/bot.js';

startBot();

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
