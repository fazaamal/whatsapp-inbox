#!/usr/bin/env node
// Upload one local file to a Notion file-upload URL.
//
// Claude gets the URL and headers from the Notion MCP tool
// `notion-create-file-upload`, then runs this. It is the only command Claude
// is allowed to run, so it refuses anything outside the bot's media folder
// and anything that isn't a Notion URL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1];
}

function fail(message) {
  console.error(`notion-upload: ${message}`);
  process.exit(1);
}

const file = arg('file');
const url = arg('url');
const headersArg = arg('headers') || '{}';
if (!file || !url) fail('usage: notion-upload.mjs --file <path> --url <upload_url> --headers <json>');

const mediaDir = fs.realpathSync(path.join(process.env.WA_INBOX_HOME || path.join(os.homedir(), '.whatsapp-inbox'), 'media'));
let realFile;
try {
  realFile = fs.realpathSync(file);
} catch {
  fail(`no such file: ${file}`);
}
if (!realFile.startsWith(mediaDir + path.sep)) fail('file must be inside the WhatsApp inbox media folder');

let target;
try {
  target = new URL(url);
} catch {
  fail('invalid --url');
}
if (target.protocol !== 'https:' || !/(^|\.)notion\.(com|so)$/.test(target.hostname)) fail(`refusing non-Notion URL: ${target.hostname}`);

let headers;
try {
  headers = JSON.parse(headersArg);
} catch {
  fail('--headers must be JSON');
}
// fetch sets the multipart boundary itself; a copied Content-Type would break it.
for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-type') delete headers[key];

const form = new FormData();
form.append('file', new Blob([fs.readFileSync(realFile)]), path.basename(realFile).replace(/^[^_]+_[^_]+_/, ''));
const res = await fetch(target, { method: 'POST', headers, body: form });
const body = await res.text();
console.log(body);
if (!res.ok) process.exit(1);
