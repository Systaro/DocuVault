import { promises as fs } from 'node:fs';

/** Discord voice receive delivers 48 kHz, 16-bit stereo PCM. */
const SAMPLE_RATE = 48_000;

/**
 * Converts a raw stereo PCM dump into a mono WAV file. Mono halves the file
 * size with no quality loss for speech, keeping utterances comfortably under
 * the OpenAI transcription upload limit.
 *
 * @returns duration of the clip in seconds
 */
export async function pcmToMonoWav(pcmPath: string, wavPath: string): Promise<number> {
  const pcm = await fs.readFile(pcmPath);
  const frames = Math.floor(pcm.length / 4); // 4 bytes per stereo frame
  const mono = Buffer.alloc(frames * 2);

  for (let i = 0; i < frames; i++) {
    const left = pcm.readInt16LE(i * 4);
    const right = pcm.readInt16LE(i * 4 + 2);
    mono.writeInt16LE((left + right) >> 1, i * 2);
  }

  await fs.writeFile(wavPath, Buffer.concat([wavHeader(mono.length), mono]));
  return frames / SAMPLE_RATE;
}

function wavHeader(dataLength: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // audio format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate (mono 16-bit)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}
