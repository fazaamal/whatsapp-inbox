#!/usr/bin/env node
// Turn the inbox on or off for WhatsApp groups, by name.
//
//   npm run groups                                  groups the inbox is on for
//   npm run groups -- list [name]                   every group you're in (or matching name)
//   npm run groups -- add "PV8 Futsal" [--project Personal] [--reply group|self|none]
//   npm run groups -- set "PV8 Futsal" --reply self       change a group's settings
//   npm run groups -- remove "PV8 Futsal"
//   npm run groups -- refresh                       re-read your groups from WhatsApp
//
// --reply: "group" answers in the group like the self-chat does (default),
// "self" sends answers only to your self-chat, "none" just files.
// When a name matches several groups, add --jid <id> from `list` to pick one.
// The running bot picks up changes by itself within a few seconds.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { REPO_DIR, loadConfig, paths } from '../src/config.js';
import { REPLY_MODES, loadKnownGroups, matchGroups } from '../src/groups.js';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const [, value] = argv.splice(i, 2);
  return value ?? null;
};
const project = flag('project');
const reply = flag('reply');
const jid = flag('jid');
const [command = 'enabled', ...rest] = argv;
const query = rest.join(' ').trim();

function readUserConfig() {
  loadConfig(); // creates config.json from the defaults if missing
  return JSON.parse(fs.readFileSync(paths.config, 'utf8'));
}

function writeUserConfig(user) {
  const tmp = paths.config + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(user, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, paths.config);
}

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

// Restart the bot and wait for it to write a fresh group list.
function refresh() {
  const before = loadKnownGroups().updatedAt;
  execFileSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'service.mjs'), 'restart'], { stdio: 'ignore' });
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    const now = loadKnownGroups().updatedAt;
    if (now && now !== before) return true;
  }
  return false;
}

// Find exactly one group the account is in. Refreshes the list once if the
// name isn't there (a group you just joined, or a renamed one).
function findOne(name) {
  if (!name && !jid) die('Give a group name, e.g. npm run groups -- add "PV8 Futsal"');
  let known = loadKnownGroups();
  let matches = jid ? known.groups.filter((g) => g.jid === jid) : matchGroups(name, known.groups);
  if (!matches.length) {
    console.error('Not in the saved group list; asking WhatsApp for a fresh one...');
    if (!refresh()) die('The bot did not answer. Is it running? Check with `npm run status` and `npm run logs`.');
    known = loadKnownGroups();
    matches = jid ? known.groups.filter((g) => g.jid === jid) : matchGroups(name, known.groups);
  }
  if (!matches.length) die(`No group you're in matches "${name || jid}". See them all with: npm run groups -- list`, 3);
  if (matches.length > 1) {
    console.error(`"${name}" matches ${matches.length} groups. Run again with --jid <id> for the one you mean:`);
    for (const g of matches) console.error(`  ${g.name}  (${g.size ?? '?'} people)  --jid ${g.jid}`);
    process.exit(2);
  }
  return matches[0];
}

function describeEntry(g) {
  return `${g.name}: replies ${g.reply === 'self' ? 'to your self-chat only' : g.reply === 'none' ? 'nowhere (just files)' : 'in the group'}${g.project ? `, project ${g.project}` : ''}${g.enabled === false ? ' (off)' : ''}`;
}

function checkOptions(cfg) {
  if (reply && !REPLY_MODES.includes(reply)) die(`--reply must be one of: ${REPLY_MODES.join(', ')}`);
  if (project && !cfg.projects.includes(project)) die(`--project must be one of: ${cfg.projects.join(', ')}`);
}

const user = readUserConfig();
const cfg = loadConfig();
user.groups ||= [];

if (command === 'enabled') {
  if (!user.groups.length) console.log('The inbox is on for no groups yet. Add one: npm run groups -- add "<group name>"');
  for (const g of user.groups) console.log(describeEntry(g));
} else if (command === 'list') {
  const known = loadKnownGroups();
  if (!known.updatedAt) die('No group list yet. Run: npm run groups -- refresh');
  const on = new Set(user.groups.map((g) => g.jid));
  const shown = query ? matchGroups(query, known.groups) : known.groups;
  for (const g of shown) console.log(`${on.has(g.jid) ? '[on] ' : '     '}${g.name}  (${g.size ?? '?'} people)  ${g.jid}`);
  console.log(`\n${shown.length} group(s); list from ${known.updatedAt}.`);
} else if (command === 'add' || command === 'on') {
  checkOptions(cfg);
  const g = findOne(query);
  const existing = user.groups.find((e) => e.jid === g.jid);
  const entry = existing || { name: g.name, jid: g.jid, project: null, reply: 'group', addedAt: new Date().toISOString() };
  entry.name = g.name;
  entry.enabled = true;
  if (project) entry.project = project;
  if (reply) entry.reply = reply;
  if (existing && existing.enabled === false) entry.addedAt = new Date().toISOString(); // don't file what was said while it was off
  if (!existing) user.groups.push(entry);
  writeUserConfig(user);
  console.log(`${existing ? 'Updated' : 'Turned on'}: ${describeEntry(entry)}`);
  console.log('New messages in it are filed from now on (older ones are left alone).');
} else if (command === 'set') {
  checkOptions(cfg);
  const g = findOne(query);
  const entry = user.groups.find((e) => e.jid === g.jid);
  if (!entry) die(`The inbox isn't on for ${g.name}. Use add instead.`);
  if (project) entry.project = project;
  if (reply) entry.reply = reply;
  writeUserConfig(user);
  console.log(`Updated: ${describeEntry(entry)}`);
} else if (command === 'remove' || command === 'off') {
  const matches = jid ? user.groups.filter((e) => e.jid === jid) : matchGroups(query, user.groups);
  if (!matches.length) die(`The inbox isn't on for any group matching "${query}".`, 3);
  if (matches.length > 1) die(`"${query}" matches ${matches.map((m) => m.name).join(', ')}. Be more specific or use --jid.`, 2);
  user.groups = user.groups.filter((e) => e !== matches[0]);
  writeUserConfig(user);
  console.log(`Turned off: ${matches[0].name}. Pages already filed stay in Notion.`);
} else if (command === 'refresh') {
  if (!refresh()) die('The bot did not answer. Is it running? Check with `npm run status` and `npm run logs`.');
  console.log(`Saved ${loadKnownGroups().groups.length} group(s).`);
} else {
  die('usage: groups.mjs [list [name] | add <name> | set <name> | remove <name> | refresh] [--project P] [--reply group|self|none] [--jid id]');
}
