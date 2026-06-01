import {
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  type Guild,
  MessageFlags,
  REST,
  Routes,
  type SendableChannels,
  SlashCommandBuilder,
} from 'discord.js';
import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { config } from '../config.js';
import { DocuVaultClient } from '../docuvault.js';
import { MeetingSession } from '../session.js';
import { DiscordRecorder } from './recorder.js';

interface ActiveMeeting {
  token: string;
  session: MeetingSession;
  recorder: DiscordRecorder;
  textChannel: SendableChannels;
  voiceChannelId: string;
  safetyTimer: NodeJS.Timeout;
  startedAt: number;
}

/** Auto-stop ignored within this many ms of the meeting starting — guards
 *  against the bot's own voice-join event firing before the human user is
 *  reflected in the voice-state cache. */
const AUTO_STOP_GRACE_MS = 10_000;

/** One meeting per guild — keyed by guild id. */
const meetings = new Map<string, ActiveMeeting>();

const commands = [
  new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('DocuVault tritt deinem Voice-Channel bei und transkribiert das Meeting.')
    .addStringOption((option) =>
      option
        .setName('token')
        .setDescription('Meeting-Token aus DocuVault (beginnt mit dvm_)')
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Aufnahme beenden, Transkript verarbeiten und in DocuVault ablegen.')
    .toJSON(),
];

export function startBot(): void {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  client.once(Events.ClientReady, async (ready) => {
    console.log(`DocuVault meeting bot ready as ${ready.user.tag}`);
    await registerCommands(ready.user.id, ready.guilds.cache.map((g) => g.id));
  });

  client.on(Events.GuildCreate, async (guild) => {
    if (client.user) await registerCommands(client.user.id, [guild.id]);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === 'transcribe') await handleTranscribe(interaction);
      else if (interaction.commandName === 'stop') await handleStop(interaction);
    } catch (err) {
      console.error(`Command /${interaction.commandName} failed:`, err);
      const message = `⚠️ Fehler: ${(err as Error).message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  // Auto-stop once every human has left the recorded voice channel.
  client.on(Events.VoiceStateUpdate, async (oldState) => {
    const meeting = meetings.get(oldState.guild.id);
    if (!meeting) return;
    if (Date.now() - meeting.startedAt < AUTO_STOP_GRACE_MS) return;
    const channel = oldState.guild.channels.cache.get(meeting.voiceChannelId);
    if (channel?.isVoiceBased()) {
      const humans = channel.members.filter((m) => !m.user.bot).size;
      if (humans === 0) {
        await finishMeeting(oldState.guild.id, 'Alle Teilnehmer haben den Call verlassen.');
      }
    }
  });

  void client.login(config.discordToken);
}

async function registerCommands(appId: string, guildIds: string[]): Promise<void> {
  const rest = new REST().setToken(config.discordToken);
  for (const guildId of guildIds) {
    await rest
      .put(Routes.applicationGuildCommands(appId, guildId), { body: commands })
      .catch((err) => console.error(`Slash-command registration failed for ${guildId}:`, err));
  }
}

async function handleTranscribe(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer immediately so we don't blow Discord's 3-second interaction window
  // while we hit the DocuVault API and the Discord voice gateway.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.guild) {
    await interaction.editReply('Nutze diesen Befehl in einem Server.');
    return;
  }
  const guildId = interaction.guild.id;

  if (meetings.has(guildId)) {
    await interaction.editReply(
      'In diesem Server läuft bereits eine Aufnahme. Beende sie zuerst mit `/stop`.',
    );
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;
  if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.editReply(
      'Tritt zuerst einem Voice-Channel bei und führe den Befehl dann erneut aus.',
    );
    return;
  }

  const token = interaction.options.getString('token', true).trim();
  if (!token.startsWith('dvm_')) {
    await interaction.editReply(
      'Das ist kein gültiges DocuVault-Meeting-Token (erwartet wird `dvm_…`).',
    );
    return;
  }

  const textChannel = interaction.channel;
  if (!textChannel?.isSendable()) {
    await interaction.editReply(
      'Ich kann in diesem Channel keine Nachrichten posten — fehlende Berechtigung.',
    );
    return;
  }

  const client = new DocuVaultClient(token);
  const claim = await client.claim(`Discord: ${voiceChannel.name}`);

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });
  connection.on('stateChange', (oldS, newS) =>
    console.log(`[voice ${guildId}] ${oldS.status} → ${newS.status}`),
  );
  connection.on('error', (err) => console.error(`[voice ${guildId}] error:`, err));
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  const session = new MeetingSession(client, claim.label, claim.spaceName, claim.inboxUrl, claim.language);
  await session.init();
  const recorder = new DiscordRecorder(connection, interaction.guild, session);
  recorder.start();

  const safetyTimer = setTimeout(
    () => void finishMeeting(guildId, `Maximale Meeting-Länge (${config.maxMeetingMinutes} min) erreicht.`),
    config.maxMeetingMinutes * 60_000,
  );

  meetings.set(guildId, {
    token,
    session,
    recorder,
    textChannel,
    voiceChannelId: voiceChannel.id,
    safetyTimer,
    startedAt: Date.now(),
  });

  await setRecordingNickname(interaction.guild, true);
  void client.progress('RECORDING', { message: 'Aufnahme läuft' });

  // Public announcement to the channel so everyone in the call sees it.
  await textChannel.send(
    '🔴 **Dieses Meeting wird transkribiert.**\n' +
      `Das Protokoll landet in der DocuVault-Inbox von **${claim.spaceName}** — „${claim.label}".\n` +
      'Wer nicht aufgenommen werden möchte, kann den Voice-Channel jetzt verlassen.\n' +
      'Aufnahme beenden mit `/stop`.',
  );
  // Private confirmation to the command issuer.
  await interaction.editReply(`✅ Aufnahme gestartet (${voiceChannel.name}).`);
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guild?.id;
  if (!guildId || !meetings.has(guildId)) {
    await interaction.editReply('Hier läuft gerade keine Aufnahme.');
    return;
  }
  await finishMeeting(guildId, undefined, interaction);
}

/**
 * Ends a meeting: stops recording, leaves the channel, transcribes, and files
 * notes. Shared by /stop, the auto-stop watcher, and the safety timer.
 */
async function finishMeeting(
  guildId: string,
  reason?: string,
  interaction?: ChatInputCommandInteraction,
): Promise<void> {
  const meeting = meetings.get(guildId);
  if (!meeting) return;
  meetings.delete(guildId);
  clearTimeout(meeting.safetyTimer);
  meeting.recorder.stop();
  void new DocuVaultClient(meeting.token).progress('PROCESSING', {
    message: 'Aufnahme wird beendet…',
  });

  // Status updates that only the /stop invoker needs to see go via editReply.
  const ack = async (message: string): Promise<void> => {
    if (interaction) await interaction.editReply(message).catch(() => {});
  };
  // The final outcome (including the inbox link) is posted publicly so everyone
  // in the call sees where the notes ended up.
  const announce = async (message: string): Promise<void> => {
    await meeting.textChannel.send(message).catch(() => {});
  };

  // Let in-flight utterances flush past the silence window before disconnecting.
  await delay(config.silenceMs + 600);
  getVoiceConnection(guildId)?.destroy();

  const guild = meeting.textChannel.isDMBased() ? undefined : meeting.textChannel.guild;
  if (guild) await setRecordingNickname(guild, false);

  if (meeting.session.utteranceCount === 0) {
    await meeting.session.cleanup();
    await new DocuVaultClient(meeting.token).fail('Leeres Meeting — keine Audioaufnahme.');
    await ack('Aufnahme beendet — keine Audio aufgezeichnet.');
    await announce('⏹️ Aufnahme beendet — es wurde nichts gesprochen, keine Notiz erstellt.');
    return;
  }

  await ack(`Verarbeite ${meeting.session.utteranceCount} Wortbeiträge…`);
  await announce(
    `⏹️ Aufnahme beendet${reason ? ` (${reason})` : ''}. ` +
      `Transkribiere ${meeting.session.utteranceCount} Wortbeiträge — einen Moment…`,
  );

  try {
    const noteCount = await meeting.session.finishAndSubmit();
    await ack('Fertig ✅');
    await announce(
      `✅ Fertig. ${noteCount} Notizen liegen jetzt in der DocuVault-Inbox von ` +
        `**${meeting.session.spaceName}**.\n` +
        `🔗 ${meeting.session.inboxUrl}`,
    );
  } catch (err) {
    console.error('Meeting processing failed:', err);
    await new DocuVaultClient(meeting.token).fail((err as Error).message);
    await ack(`Fehler: ${(err as Error).message}`);
    await announce(`⚠️ Verarbeitung fehlgeschlagen: ${(err as Error).message}`);
  }
}

/** Marks the bot visibly as recording via its server nickname. Best-effort. */
async function setRecordingNickname(guild: Guild, recording: boolean): Promise<void> {
  try {
    const me = await guild.members.fetchMe();
    await me.setNickname(recording ? `🔴 ${me.user.username} REC` : null);
  } catch {
    // Missing "Change Nickname" permission — non-fatal.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
