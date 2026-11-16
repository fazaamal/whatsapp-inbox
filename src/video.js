// Videos -> still frames Claude can look at, plus the spoken audio as text.
// Frames come from bin/video-frames.swift (macOS AVFoundation, no ffmpeg),
// compiled once into ~/.whatsapp-inbox/bin; the audio goes through the same
// whisper.cpp path as voice notes (afconvert reads the audio out of an mp4).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DATA_DIR, REPO_DIR, findOnPath } from './config.js';
import { transcribe } from './transcribe.js';

const run = promisify(execFile);
const SOURCE = path.join(REPO_DIR, 'bin', 'video-frames.swift');
const TOOL = path.join(DATA_DIR, 'bin', 'video-frames');

// Rebuild when the Swift source is newer than the compiled tool.
async function frameTool(logger) {
  const built = fs.existsSync(TOOL) && fs.statSync(TOOL).mtimeMs >= fs.statSync(SOURCE).mtimeMs;
  if (built) return TOOL;
  const swiftc = findOnPath('swiftc');
  if (!swiftc) {
    logger.warn('swiftc not found; videos filed without frames (xcode-select --install)');
    return null;
  }
  fs.mkdirSync(path.dirname(TOOL), { recursive: true, mode: 0o700 });
  try {
    await run(swiftc, ['-O', SOURCE, '-o', TOOL], { timeout: 5 * 60 * 1000 });
    logger.info({ tool: TOOL }, 'built video frame tool');
    return TOOL;
  } catch (err) {
    logger.error({ err: err.message.split('\n')[0] }, 'could not build video frame tool');
    return null;
  }
}

// Returns { duration, width, height, frames: [{file, at}], transcript }.
// Frames land next to the video in "<video>.frames/", inside the media
// folder, so Claude can Read them and later follow-ups can look again.
export async function analyseVideo(videoFile, cfg, logger) {
  const result = { duration: null, width: null, height: null, frames: [], transcript: null };
  const tool = await frameTool(logger);
  let hasAudio = true;
  if (tool) {
    const outDir = videoFile.replace(/\.[^.]+$/, '') + '.frames';
    try {
      const { stdout } = await run(tool, [videoFile, outDir, String(cfg.videoMaxFrames || 8)], { timeout: 2 * 60 * 1000 });
      const info = JSON.parse(stdout);
      Object.assign(result, { duration: info.duration, width: info.width, height: info.height, frames: info.frames });
      hasAudio = info.hasAudio;
    } catch (err) {
      logger.error({ err: err.message.split('\n')[0] }, 'could not read video frames');
    }
  }
  if (hasAudio) result.transcript = await transcribe(videoFile, cfg, logger);
  return result;
}
