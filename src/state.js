// Small persistent state: which messages are done, which failed, and the
// moment the bot was linked (so it never files your old chat history).
import fs from 'node:fs';
import { paths } from './config.js';

const MAX_IDS = 5000;
let state = null;

export function loadState() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  } catch {
    state = {};
  }
  state.processed ||= [];
  state.failed ||= [];
  state.sentByBot ||= [];
  return state;
}

function save() {
  const tmp = paths.state + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.state);
}

export function setLinkedSince(ts) {
  loadState().linkedSince = ts;
  save();
}

export const isProcessed = (id) => loadState().processed.includes(id);

export function markProcessed(id) {
  const s = loadState();
  s.processed.push(id);
  if (s.processed.length > MAX_IDS) s.processed = s.processed.slice(-MAX_IDS);
  s.failed = s.failed.filter((f) => f.id !== id);
  save();
}

export function markFailed(entry) {
  const s = loadState();
  s.failed = s.failed.filter((f) => f.id !== entry.id);
  s.failed.push({ ...entry, failedAt: new Date().toISOString() });
  save();
}

export function takeFailed() {
  const s = loadState();
  const failed = s.failed;
  s.failed = [];
  save();
  return failed;
}

// Replies the bot sends land in the same self-chat, so remember their ids
// and ignore them when they come back in.
export function rememberSent(id) {
  const s = loadState();
  s.sentByBot.push(id);
  if (s.sentByBot.length > 500) s.sentByBot = s.sentByBot.slice(-500);
  save();
}

export const isSentByBot = (id) => loadState().sentByBot.includes(id);
