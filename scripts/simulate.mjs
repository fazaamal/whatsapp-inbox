#!/usr/bin/env node
// Run one fake message through the pipeline without WhatsApp, to test the
// Claude + Notion side. It files a real page (Message ID starts with SIM-).
//
//   npm run simulate -- --text "idea: ..."
//   npm run simulate -- --file ~/Desktop/shot.png --text "caption"
//   npm run simulate -- --file note.ogg --kind voice
//   add --with-history to use (and add to) the recent-messages memory,
//   and --reply-to <message id> to act as a swipe-reply to that message
//   --group "Name" [--sender "Ali"] [--reply group|self|none] [--project P]
//   to act as a message in a group (nothing is sent to WhatsApp)
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { loadConfig, paths } from '../src/config.js';
import { processItem } from '../src/pipeline.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
};

const cfg = loadConfig();
const logger = pino({ level: 'info' });
const id = `SIM-${Date.now()}`;
const text = arg('text') || '';
const url = text.match(/https?:\/\/[^\s<>"']+/i)?.[0] || null;
const item = { id, text, url, receivedIso: new Date().toISOString(), kind: arg('kind'), replyToId: arg('reply-to') };
if (arg('group')) {
  item.group = { name: arg('group'), project: arg('project'), reply: arg('reply') || 'group' };
  item.chat = `SIM-group:${arg('group')}`;
  item.sender = arg('sender') || 'Someone';
  item.fromFaza = item.sender === 'Faza';
}

const source = arg('file');
if (source) {
  const dest = path.join(paths.media, `${new Date().toISOString().replace(/[:.]/g, '-')}_${id}_${path.basename(source)}`);
  fs.copyFileSync(source, dest);
  item.file = dest;
  const ext = path.extname(source).toLowerCase();
  item.kind ||= ['.ogg', '.opus', '.m4a', '.mp3', '.wav'].includes(ext) ? 'voice' : ['.jpg', '.jpeg', '.png', '.webp', '.heic'].includes(ext) ? 'image' : ['.mp4', '.mov'].includes(ext) ? 'video' : 'document';
}
item.kind ||= url ? 'link' : 'text';

const useHistory = process.argv.includes('--with-history');
console.log(JSON.stringify({ id, ...(await processItem(item, cfg, logger, { useHistory })) }, null, 2));
