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
 *
 * @param language ISO-639-1 code pinned on the request. Pinning is what stops
 *   Whisper from auto-detecting (and mis-detecting) the language on short, quiet
 *   utterances — which is what produced spurious foreign-script lines.
 */
export async function transcribePcm(pcmPath: string, language: string): Promise<string> {
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
      language,
    });
    return result.text.trim();
  } finally {
    await fs.unlink(wavPath).catch(() => {});
  }
}
