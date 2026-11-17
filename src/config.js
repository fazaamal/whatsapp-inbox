// Paths and settings. Everything private (WhatsApp login, media, state, logs)
// lives in ~/.whatsapp-inbox, never in the repo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.WA_INBOX_HOME || path.join(os.homedir(), '.whatsapp-inbox');

export const paths = {
  auth: path.join(DATA_DIR, 'auth'),
  media: path.join(DATA_DIR, 'media'),
  models: path.join(DATA_DIR, 'models'),
  logs: path.join(DATA_DIR, 'logs'),
  state: path.join(DATA_DIR, 'state.json'),
  config: path.join(DATA_DIR, 'config.json'),
  groups: path.join(DATA_DIR, 'groups.json'),
  agentDir: path.join(REPO_DIR, 'agent'),
  uploadHelper: path.join(REPO_DIR, 'bin', 'notion-upload.mjs'),
};

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'config.example.json'), 'utf8'));

export function ensureDirs() {
  for (const dir of [DATA_DIR, paths.auth, paths.media, paths.models, paths.logs]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig() {
  ensureDirs();
  if (!fs.existsSync(paths.config)) {
    fs.writeFileSync(paths.config, JSON.stringify(DEFAULTS, null, 2) + '\n', { mode: 0o600 });
  }
  const user = JSON.parse(fs.readFileSync(paths.config, 'utf8'));
  const cfg = { ...DEFAULTS, ...user };
  cfg.whisperModel = expandHome(cfg.whisperModel);
  cfg.claudeBin = cfg.claudeBin || findOnPath('claude', [path.join(os.homedir(), '.local', 'bin')]);
  return cfg;
}

export function expandHome(p) {
  return p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function findOnPath(bin, extraDirs = []) {
  const dirs = [...extraDirs, ...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}
