import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { EndBehaviorType, type VoiceConnection } from '@discordjs/voice';
import type { Guild } from 'discord.js';
import prism from 'prism-media';
import { config } from '../config.js';
import type { MeetingSession } from '../session.js';

/**
 * Discord platform adapter: subscribes to per-speaker audio on a voice
 * connection and feeds discrete utterances into the meeting session.
 *
 * Discord delivers a separate Opus stream per speaking user, so speaker
 * attribution is exact — no diarization model needed.
 */
export class DiscordRecorder {
  /** Users currently being recorded — prevents overlapping subscriptions. */
  private readonly recording = new Set<string>();
  private stopped = false;

  constructor(
    private readonly connection: VoiceConnection,
    private readonly guild: Guild,
    private readonly session: MeetingSession,
  ) {}

  start(): void {
    this.connection.receiver.speaking.on('start', (userId) => {
      if (this.stopped || this.recording.has(userId)) return;
      this.recording.add(userId);
      void this.recordUtterance(userId).finally(() => this.recording.delete(userId));
    });
  }

  /** Stops accepting new utterances. In-flight ones still flush to disk. */
  stop(): void {
    this.stopped = true;
  }

  private async recordUtterance(userId: string): Promise<void> {
    const speaker = await this.displayName(userId);
    const startMs = Date.now() - this.session.startedAt;
    const pcmPath = join(this.session.dir, `${Date.now()}-${userId}.pcm`);

    const opusStream = this.connection.receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: config.silenceMs },
    });
    const decoder = new prism.opus.Decoder({ rate: 48_000, channels: 2, frameSize: 960 });
    const output = createWriteStream(pcmPath);

    await new Promise<void>((resolve) => {
      opusStream.pipe(decoder).pipe(output);
      output.on('finish', () => resolve());
      output.on('error', () => resolve());
      opusStream.on('error', () => resolve());
    });

    this.session.addUtterance({ speaker, startMs, pcmPath });
  }

  private async displayName(userId: string): Promise<string> {
    try {
      const member = await this.guild.members.fetch(userId);
      return member.displayName;
    } catch {
      return `Teilnehmer-${userId.slice(0, 6)}`;
    }
  }
}
