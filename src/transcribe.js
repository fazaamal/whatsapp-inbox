// Voice notes -> text, locally, with whisper.cpp. Nothing leaves the Mac.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findOnPath } from './config.js';

const run = promisify(execFile);

// whisper.cpp wants 16 kHz mono WAV. macOS's own afconvert decodes WhatsApp's
// Opus voice notes, so try it first; ffmpeg (Homebrew) is the fallback, since a
// brew upgrade can leave it broken.
const CONVERTERS = [
  { name: 'afconvert', args: (src, wav) => ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', src, wav] },
  { name: 'ffmpeg', args: (src, wav) => ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav] },
];

async function toWav(audioFile, wav, logger) {
  const errors = [];
  for (const c of CONVERTERS) {
    const bin = c.name === 'afconvert' ? (fs.existsSync('/usr/bin/afconvert') ? '/usr/bin/afconvert' : null) : findOnPath(c.name);
    if (!bin) continue;
    try {
      fs.rmSync(wav, { force: true });
      await run(bin, c.args(audioFile, wav), { timeout: 2 * 60 * 1000 });
      if (fs.existsSync(wav) && fs.statSync(wav).size > 44) return;
      errors.push(`${c.name}: no output`);
    } catch (err) {
      errors.push(`${c.name}: ${err.message.split('\n').slice(0, 2).join(' ')}`);
    }
  }
  logger.warn({ errors }, 'could not convert audio');
  throw new Error(errors.length ? errors.join(' | ') : 'no audio converter found (afconvert or ffmpeg)');
}

export async function transcribe(audioFile, cfg, logger) {
  const whisper = findOnPath('whisper-cli');
  if (!whisper) {
    logger.warn('whisper-cli not found; voice note left untranscribed (brew install whisper-cpp)');
    return null;
  }
  if (!fs.existsSync(cfg.whisperModel)) {
    logger.warn({ model: cfg.whisperModel }, 'whisper model missing; run `npm run setup`');
    return null;
  }
  const wav = audioFile.replace(/\.[^.]+$/, '') + '.16k.wav';
  try {
    await toWav(audioFile, wav, logger);
    const { stdout } = await run(
      whisper,
      ['-m', cfg.whisperModel, '-f', wav, '-l', cfg.whisperLanguage || 'auto', '-nt', '-np'],
      { maxBuffer: 10 * 1024 * 1024, timeout: 10 * 60 * 1000 },
    );
    return stdout.replace(/\s+/g, ' ').trim() || null;
  } catch (err) {
    logger.error({ err: err.message }, 'transcription failed');
    return null;
  } finally {
    fs.rmSync(wav, { force: true });
  }
}
