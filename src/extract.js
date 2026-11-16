// Turn a raw Baileys message into something simple: what kind it is, its
// text, and (for media) a downloaded file on disk.
import fs from 'node:fs';
import path from 'node:path';
import { downloadMediaMessage, getContentType, normalizeMessageContent } from 'baileys';
import { paths } from './config.js';

const MEDIA_KINDS = {
  imageMessage: { kind: 'image', ext: 'jpg' },
  audioMessage: { kind: 'voice', ext: 'ogg' },
  videoMessage: { kind: 'video', ext: 'mp4' },
  documentMessage: { kind: 'document', ext: 'bin' },
  stickerMessage: null, // ignored
};

const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function messageTimestamp(msg) {
  const ts = msg.messageTimestamp;
  const seconds = typeof ts === 'number' ? ts : Number(ts?.toString?.() ?? ts ?? 0);
  return seconds * 1000;
}

// Returns null for things that aren't worth filing (reactions, edits,
// protocol messages, stickers, empty messages).
export function describe(msg) {
  const content = normalizeMessageContent(msg.message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type) return null;

  if (type === 'conversation' || type === 'extendedTextMessage') {
    const text = (content.conversation || content.extendedTextMessage?.text || '').trim();
    if (!text) return null;
    const url = text.match(URL_RE)?.[0] || null;
    return { kind: url ? 'link' : 'text', text, url, mediaType: null, ...replyContext(content.extendedTextMessage) };
  }

  if (!(type in MEDIA_KINDS) || MEDIA_KINDS[type] === null) return null;
  const node = content[type];
  const text = (node.caption || '').trim();
  // A video sent "as a document" (full quality) is still a video.
  const kind = type === 'documentMessage' && node.mimetype?.startsWith('video/') ? 'video' : MEDIA_KINDS[type].kind;
  return {
    kind,
    text,
    url: text.match(URL_RE)?.[0] || null,
    mediaType: type,
    mime: node.mimetype || null,
    fileName: node.fileName || null,
    isPtt: !!node.ptt,
    ...replyContext(node),
  };
}

// When you swipe-reply to an earlier message, WhatsApp says which one.
function replyContext(node) {
  const ctx = node?.contextInfo;
  if (!ctx?.stanzaId) return {};
  const quoted = normalizeMessageContent(ctx.quotedMessage);
  const quotedType = quoted && getContentType(quoted);
  const quotedText =
    quoted?.conversation || quoted?.extendedTextMessage?.text || (quotedType && quoted[quotedType]?.caption) || null;
  return { replyToId: ctx.stanzaId, quotedText, quotedKind: quotedType || null };
}

export async function downloadMedia(msg, info, sock, logger) {
  const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage });
  const ext = extensionFor(info);
  const stamp = new Date(messageTimestamp(msg) || Date.now()).toISOString().replace(/[:.]/g, '-');
  const base = info.fileName ? sanitise(info.fileName) : `${info.kind}.${ext}`;
  const file = path.join(paths.media, `${stamp}_${msg.key.id}_${base}`);
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  return file;
}

function extensionFor(info) {
  if (info.fileName && path.extname(info.fileName)) return path.extname(info.fileName).slice(1);
  const fromMime = info.mime?.split(';')[0].split('/')[1];
  if (fromMime && /^[a-z0-9]+$/i.test(fromMime)) return fromMime === 'jpeg' ? 'jpg' : fromMime;
  return MEDIA_KINDS[info.mediaType]?.ext || 'bin';
}

function sanitise(name) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
}
