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
  state.history ||= [];
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

// A short memory of recent messages, so a follow-up like "summarise that"
// knows what "that" is. Each Claude run is otherwise a fresh session.
const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || null);

export function addHistory(item, result) {
  const s = loadState();
  s.history = s.history.filter((h) => h.id !== item.id);
  s.history.push({
    id: item.id,
    at: item.receivedIso,
    kind: item.kind,
    text: clip(item.text, 500),
    transcript: clip(item.transcript, 800),
    url: item.url || null,
    file: item.file || null,
    title: result?.title || null,
    project: result?.project || null,
    pageUrl: result?.pageUrl || null,
    reply: clip(result?.reply, 500),
  });
  if (s.history.length > 50) s.history = s.history.slice(-50);
  save();
}

export function recentHistory({ maxItems, windowHours, excludeId }) {
  const since = Date.now() - windowHours * 3_600_000;
  return loadState()
    .history.filter((h) => h.id !== excludeId && Date.parse(h.at) >= since)
    .slice(-maxItems);
}

export const findInHistory = (id) => loadState().history.find((h) => h.id === id) || null;
