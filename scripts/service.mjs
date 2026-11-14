#!/usr/bin/env node
// Keep the bot running in the background with launchd: starts at login,
// restarts if it crashes.
//
//   node scripts/service.mjs install | uninstall | restart | status | logs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_DIR, ensureDirs, paths } from '../src/config.js';

const LABEL = 'com.fazasophian.whatsapp-inbox';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const DOMAIN = `gui/${process.getuid()}`;
const OUT_LOG = path.join(paths.logs, 'bot.log');
const ERR_LOG = path.join(paths.logs, 'bot.err.log');

const launchctl = (...args) => {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return err.stdout || '';
  }
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function install() {
  ensureDirs();
  const nodeBin = process.execPath;
  const pathDirs = [path.dirname(nodeBin), path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(nodeBin)}</string>
    <string>${esc(path.join(REPO_DIR, 'src', 'index.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(REPO_DIR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(pathDirs.join(':'))}</string>
    <key>HOME</key><string>${esc(os.homedir())}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(OUT_LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(ERR_LOG)}</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  launchctl('bootout', `${DOMAIN}/${LABEL}`);
  fs.writeFileSync(PLIST, plist);
  launchctl('bootstrap', DOMAIN, PLIST);
  console.log(`Installed and started ${LABEL}. Logs: ${OUT_LOG}`);
}

function uninstall() {
  launchctl('bootout', `${DOMAIN}/${LABEL}`);
  fs.rmSync(PLIST, { force: true });
  console.log(`Stopped and removed ${LABEL}.`);
}

function status() {
  const out = launchctl('print', `${DOMAIN}/${LABEL}`);
  if (!out) return console.log('Not installed (run `npm run service:install`).');
  const pick = (re) => out.match(re)?.[1];
  console.log(`state: ${pick(/\n\s*state = (\S+)/) || '?'}  pid: ${pick(/\n\s*pid = (\d+)/) || '-'}  last exit: ${pick(/last exit code = (.+)/) || '-'}`);
}

function logs() {
  for (const file of [OUT_LOG, ERR_LOG]) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-25);
    console.log(`== ${file}\n${lines.join('\n')}\n`);
  }
}

const command = process.argv[2];
const actions = { install, uninstall, status, logs, restart: () => launchctl('kickstart', '-k', `${DOMAIN}/${LABEL}`) || console.log('restarted') };
if (!actions[command]) {
  console.error('usage: service.mjs install | uninstall | restart | status | logs');
  process.exit(1);
}
actions[command]();
