// The bot. Stays connected to WhatsApp as a linked device, watches your own
// "message yourself" chat (plus any groups you turned on, see src/groups.js),
// and hands each new message to Claude.
//
//   node src/index.js --login   show the QR code once, link, then exit
//   node src/index.js           run the bot (launchd keeps this alive)
import fs from 'node:fs';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import makeWASocket, { Browsers, DisconnectReason, fetchLatestBaileysVersion, isJidGroup, jidDecode, jidNormalizedUser, useMultiFileAuthState } from 'baileys';
import { loadConfig, paths } from './config.js';
import { describe, downloadMedia, messageTimestamp } from './extract.js';
import { enabledGroup, loadKnownGroups, saveKnownGroups } from './groups.js';
import { processItem } from './pipeline.js';
import * as store from './state.js';

const LOGIN = process.argv.includes('--login');
const cfg = loadConfig();
// Pick up config changes (e.g. a group turned on with `npm run groups -- add`)
// without a restart.
fs.watchFile(paths.config, { interval: 2000 }, () => {
  try {
    Object.assign(cfg, loadConfig());
    logger.info({ groups: (cfg.groups || []).map((g) => g.name) }, 'config reloaded');
  } catch (err) {
    logger.warn({ err: err.message }, 'config.json changed but could not be read; keeping the old settings');
  }
});
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const waLogger = pino({ level: process.env.WA_LOG_LEVEL || 'warn' }); // Baileys is very chatty at info
const startedAt = Date.now();

let sock = null;
// Messages are worked on one at a time by default (so "summarise that" sees the
// link before it), up to cfg.concurrency at once; the rest wait their turn
// (they already have the ⏳ reaction, so you can see they arrived).
let running = 0;
const waiting = [];
const inFlight = new Set();
function runLimited(task) {
  return new Promise((resolve) => {
    waiting.push(async () => {
      running++;
      try { await task(); } catch (err) { logger.error({ err: err.message }, 'handler crashed'); }
      running--;
      resolve();
      waiting.shift()?.();
    });
    if (running < (cfg.concurrency || 1)) waiting.shift()();
  });
}
let reconnectDelay = 2000;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(paths.auth);
  const version = await fetchLatestBaileysVersion().then((v) => v.version).catch(() => undefined);
  sock = makeWASocket({
    auth: state,
    version,
    logger: waLogger,
    browser: Browsers.macOS('WhatsApp Inbox'),
    markOnlineOnConnect: false, // keep phone notifications working
    syncFullHistory: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', onConnectionUpdate);
  sock.ev.on('groups.upsert', () => refreshGroups());
  sock.ev.on('groups.update', () => refreshGroups());
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (LOGIN || (type !== 'notify' && type !== 'append')) return;
    for (const msg of messages) {
      logger.debug({ type, id: msg.key?.id, fromMe: msg.key?.fromMe, jid: msg.key?.remoteJid, alt: msg.key?.remoteJidAlt, me: [sock.user?.id, sock.user?.lid], hasMessage: !!msg.message }, 'upsert');
      const jid = msg.key?.remoteJid;
      const group = isJidGroup(jid) ? enabledGroup(cfg, jid) : null;
      if (!group && !(msg.key?.fromMe && isSelfChat(msg.key))) continue;
      handle(msg, group).catch((err) => logger.error({ err: err.message }, 'handler crashed'));
    }
  });
}

function onConnectionUpdate({ connection, lastDisconnect, qr }) {
  if (qr) {
    if (!LOGIN) {
      logger.error('Not linked to WhatsApp. Run `npm run login` and scan the QR code.');
      process.exit(0); // clean exit: launchd won't restart-loop
    }
    console.log('\nWhatsApp > Settings > Linked devices > Link a device, then scan:\n');
    qrcode.generate(qr, { small: true });
  }
  if (connection === 'open') {
    reconnectDelay = 2000;
    const me = sock.user?.id;
    if (LOGIN) {
      if (!store.loadState().linkedSince) store.setLinkedSince(Date.now());
      console.log(`\nLinked as ${me}. Login saved in ${paths.auth}.`);
      setTimeout(() => process.exit(0), 3000); // let creds finish writing
      return;
    }
    if (!store.loadState().linkedSince) store.setLinkedSince(Date.now());
    logger.info({ me }, 'connected to WhatsApp');
    refreshGroups();
  }
  if (connection === 'close') {
    const code = lastDisconnect?.error?.output?.statusCode;
    if (code === DisconnectReason.loggedOut) {
      logger.error('WhatsApp logged this device out. Run `npm run login` to link again.');
      fs.rmSync(paths.auth, { recursive: true, force: true });
      process.exit(0);
    }
    const delay = code === DisconnectReason.restartRequired ? 0 : reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    logger.warn({ code, delay }, 'connection closed, reconnecting');
    setTimeout(() => connect().catch((err) => logger.error({ err: err.message }, 'reconnect failed')), delay);
  }
}

// Your own chat can be addressed by phone number or by WhatsApp's newer
// "LID" id, so compare the user part of both against both of yours.
function isSelfChat(key) {
  const mine = [sock.user?.id, sock.user?.lid].filter(Boolean).map((j) => jidDecode(j)?.user);
  const theirs = [key.remoteJid, key.remoteJidAlt].filter(Boolean).map((j) => jidDecode(j)?.user);
  return theirs.some((u) => u && mine.includes(u));
}

// Write the names of every group this account is in to groups.json, so a
// group can be turned on by name.
let refreshTimer = null;
function refreshGroups() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const all = await sock.groupFetchAllParticipating();
      saveKnownGroups(Object.values(all).map((g) => ({ jid: g.id, name: g.subject || '(no name)', size: g.size || g.participants?.length || null })));
      logger.info({ count: Object.keys(all).length }, 'group list saved');
    } catch (err) {
      logger.warn({ err: err.message }, 'could not list groups');
    }
  }, 1500);
}

function groupName(group) {
  return group.name || loadKnownGroups().groups.find((k) => k.jid === group.jid)?.name || 'group';
}

const selfJid = () => jidNormalizedUser(sock.user?.id);

async function handle(msg, group = null) {
  const { id } = msg.key;
  if (store.isProcessed(id) || store.isSentByBot(id)) return;
  // Skip old history: anything from before the bot was linked, or before
  // the group was turned on.
  const since = Math.max(store.loadState().linkedSince || startedAt, Date.parse(group?.addedAt || 0) || 0);
  if (messageTimestamp(msg) < since - 60_000) return;

  // A message WhatsApp couldn't decrypt yet arrives empty; the readable copy
  // comes later under the same id, so don't mark it done.
  if (!msg.message) {
    logger.warn({ id, stub: msg.messageStubType, why: msg.messageStubParameters }, 'message not readable yet, waiting for WhatsApp to resend it');
    return;
  }

  const info = describe(msg);
  logger.info({ id, kind: info?.kind || null, keys: Object.keys(msg.message) }, 'message received');
  logger.debug({ id, raw: JSON.stringify(msg.message).slice(0, 2000) }, 'raw message');
  if (!info) return store.markProcessed(id);
  if (info.text?.startsWith(cfg.replyPrefix.trim())) return store.markProcessed(id); // our own reply echoing back

  const command = info.kind === 'text' && !group ? info.text.trim().toLowerCase() : null;
  if (command === '/status') return replyStatus(msg);
  if (command === '/retry') return retryFailed(msg);

  if (inFlight.has(id)) return; // same message delivered twice
  inFlight.add(id);
  if (!group || replyMode(group) === 'group') await react(msg.key, cfg.reactions.working); // instant "got it", before waiting for a slot
  await runLimited(() => work(msg, info, group)).finally(() => inFlight.delete(id));
}

// Where answers to a group's messages go: "group" (in the group, like the
// self-chat), "self" (only to your self-chat) or "none" (just filed).
const replyMode = (group) => (['group', 'self', 'none'].includes(group?.reply) ? group.reply : 'group');

function senderName(msg) {
  if (msg.key.fromMe) return 'Faza';
  const number = jidDecode(msg.key.participantAlt || msg.key.participant)?.user;
  return msg.pushName || (number ? `+${number}` : 'someone');
}

async function work(msg, info, group = null) {
  const { id } = msg.key;
  let item = null;
  try {
    item = {
      id,
      kind: info.kind,
      text: info.text,
      url: info.url,
      mime: info.mime,
      forwarded: info.forwarded || false,
      replyToId: info.replyToId || null,
      quotedText: info.quotedText || null,
      quotedKind: info.quotedKind || null,
      receivedIso: new Date(messageTimestamp(msg) || Date.now()).toISOString(),
      chat: group ? group.jid || msg.key.remoteJid : 'self',
      group: group ? { name: groupName(group), project: group.project || null, reply: replyMode(group) } : null,
      sender: group ? senderName(msg) : null,
      fromFaza: !!msg.key.fromMe,
    };
    if (info.mediaType) item.file = await downloadMedia(msg, info, sock, waLogger);
    await finish(msg.key, item, msg);
  } catch (err) {
    logger.error({ err: err.message, id }, 'failed to file message');
    store.markFailed({ id, key: msg.key, item, error: err.message });
    if (group) {
      // Failures go to your self-chat, not the group (/retry only works there).
      if (replyMode(group) === 'group') await react(msg.key, cfg.reactions.failed);
      await send(selfJid(), { text: `${cfg.replyPrefix}Couldn't save a message from ${senderName(msg)} in ${groupName(group)} (${err.message}). Send /retry to try again.` });
    } else {
      await react(msg.key, cfg.reactions.failed);
      await send(msg.key.remoteJid, { text: `${cfg.replyPrefix}Couldn't save this one (${err.message}). Send /retry to try again.` }, { quoted: msg });
    }
  }
}

async function finish(key, item, original = null) {
  const result = await processItem(item, cfg, logger);
  logger.info({ id: item.id, kind: item.kind, group: item.group?.name, ...result }, 'processed');
  if (item.group) return finishGroup(key, item, original, result);
  await react(key, result.saved ? cfg.reactions.saved : cfg.reactions.failed);
  // Always answer, like a normal chat: what was done, and a link to the page.
  let reply = result.reply;
  if (!reply) reply = result.saved ? `Saved${result.project ? ` to ${result.project}` : ''}${result.title ? `: ${result.title}` : ''}.` : "Couldn't save this one. Send /retry to try again.";
  const link = result.saved && result.pageUrl ? `\n${result.pageUrl.replace(/\?pvs=\d+$/, '')}` : '';
  await send(key.remoteJid, { text: cfg.replyPrefix + reply + link }, original ? { quoted: original } : undefined);
  if (result.saved) store.markProcessed(item.id);
  else store.markFailed({ id: item.id, key, item, error: result.reply || 'not saved' });
}

async function finishGroup(key, item, original, result) {
  const mode = item.group.reply;
  const link = result.saved && result.pageUrl ? `\n${result.pageUrl.replace(/\?pvs=\d+$/, '')}` : '';
  if (mode === 'group') await react(key, result.saved ? cfg.reactions.saved : cfg.reactions.failed);
  if (!result.saved) {
    await send(selfJid(), { text: `${cfg.replyPrefix}Couldn't save a message from ${item.sender} in ${item.group.name}. Send /retry to try again.` });
    return store.markFailed({ id: item.id, key, item, error: result.reply || 'not saved' });
  }
  if (mode === 'group') {
    // Everyone in the group reads this, so no Notion link (it's private anyway).
    const reply = result.reply || `Saved${result.title ? `: ${result.title}` : ''}.`;
    await send(key.remoteJid, { text: cfg.replyPrefix + reply }, original ? { quoted: original } : undefined);
  } else if (mode === 'self') {
    const reply = result.reply || `Saved${result.project ? ` to ${result.project}` : ''}${result.title ? `: ${result.title}` : ''}.`;
    await send(selfJid(), { text: `${cfg.replyPrefix}[${item.group.name} · ${item.sender}] ${reply}${link}` });
  }
  store.markProcessed(item.id);
}

async function retryFailed(msg) {
  store.markProcessed(msg.key.id);
  const failed = store.takeFailed();
  await send(msg.key.remoteJid, { text: `${cfg.replyPrefix}Retrying ${failed.length} failed message(s).` });
  for (const entry of failed) {
    if (!entry.item) continue; // failed before download; nothing to retry from
    try {
      await finish(entry.key, entry.item);
    } catch (err) {
      store.markFailed({ ...entry, error: err.message });
    }
  }
}

async function replyStatus(msg) {
  store.markProcessed(msg.key.id);
  const s = store.loadState();
  const hours = ((Date.now() - startedAt) / 3_600_000).toFixed(1);
  await send(msg.key.remoteJid, {
    text: `${cfg.replyPrefix}Running for ${hours} h. Filed ${s.processed.length} message(s), ${s.failed.length} failed (send /retry). Inbox: ${cfg.notionDatabaseUrl}`,
  });
}

async function react(key, emoji) {
  try {
    await send(key.remoteJid, { react: { text: emoji, key } });
  } catch (err) {
    logger.warn({ err: err.message }, 'reaction failed');
  }
}

async function send(jid, content, options) {
  const sent = await sock.sendMessage(jid, content, options);
  if (sent?.key?.id) store.rememberSent(sent.key.id);
  return sent;
}

connect().catch((err) => {
  logger.fatal({ err: err.message }, 'could not start');
  process.exit(1);
});
