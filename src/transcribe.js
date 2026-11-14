// Voice notes -> text, locally, with whisper.cpp. Nothing leaves the Mac.
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findOnPath } from './config.js';

const run = promisify(execFile);

export async function transcribe(audioFile, cfg, logger) {
  const whisper = findOnPath('whisper-cli');
  const ffmpeg = findOnPath('ffmpeg');
  if (!whisper || !ffmpeg) {
    logger.warn('whisper-cli or ffmpeg not found; voice note left untranscribed');
    return null;
  }
  if (!fs.existsSync(cfg.whisperModel)) {
    logger.warn({ model: cfg.whisperModel }, 'whisper model missing; run `npm run setup`');
    return null;
  }
  const wav = audioFile.replace(/\.[^.]+$/, '') + '.16k.wav';
  try {
    await run(ffmpeg, ['-y', '-loglevel', 'error', '-i', audioFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
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
