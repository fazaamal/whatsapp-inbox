// WhatsApp groups the bot also works in, besides your self-chat.
//
// The bot writes every group your account is in to ~/.whatsapp-inbox/groups.json
// (id + name), so a group can be turned on by name:
//   npm run groups -- add "PV8 Futsal"
// which adds it to "groups" in config.json. The running bot notices the config
// change by itself; no restart needed.
import fs from 'node:fs';
import { paths } from './config.js';

export const REPLY_MODES = ['group', 'self', 'none'];

export function saveKnownGroups(list) {
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const tmp = paths.groups + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), groups: sorted }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, paths.groups);
}

export function loadKnownGroups() {
  try {
    return JSON.parse(fs.readFileSync(paths.groups, 'utf8'));
  } catch {
    return { updatedAt: null, groups: [] };
  }
}

// Exact name first (ignoring case and emoji/punctuation), then names that
// contain the query. Returns every match so the caller can ask which one.
export function matchGroups(query, groups) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const q = norm(query);
  if (!q) return [];
  const exact = groups.filter((g) => norm(g.name) === q);
  if (exact.length) return exact;
  return groups.filter((g) => norm(g.name).includes(q));
}

// The enabled group for a chat id, or null. A group entered by hand with only
// a name is matched against the known groups.
export function enabledGroup(cfg, jid) {
  for (const g of cfg.groups || []) {
    if (g.enabled === false) continue;
    if (g.jid === jid) return g;
    if (!g.jid && g.name) {
      const known = loadKnownGroups().groups.find((k) => k.jid === jid);
      if (known && matchGroups(g.name, [known]).length) return g;
    }
  }
  return null;
}
