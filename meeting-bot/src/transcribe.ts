import { createReadStream, promises as fs } from 'node:fs';
import OpenAI from 'openai';
import { config } from './config.js';
import { pcmToMonoWav } from './audio.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

/** Utterances shorter than this are dropped — clicks, breaths, join blips. */
const MIN_UTTERANCE_SECONDS = 0.4;

/**
 * Transcribes one raw PCM utterance. Returns an empty string for clips that are
 * too short to carry speech.
 */
export async function transcribePcm(pcmPath: string): Promise<string> {
  const wavPath = pcmPath.replace(/\.pcm$/, '.wav');
  const seconds = await pcmToMonoWav(pcmPath, wavPath);

  if (seconds < MIN_UTTERANCE_SECONDS) {
    await fs.unlink(wavPath).catch(() => {});
    return '';
  }

  try {
    const result = await openai.audio.transcriptions.create({
      file: createReadStream(wavPath),
      model: config.transcribeModel,
    });
    return result.text.trim();
  } finally {
    await fs.unlink(wavPath).catch(() => {});
  }
}
