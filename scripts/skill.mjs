#!/usr/bin/env node
// Install the Claude skills in skills/ (whatsapp-inbox, whatsapp-groups) on
// their own (no WhatsApp bot needed), by linking them into ~/.claude/skills.
//
//   node scripts/skill.mjs install     link them (default)
//   node scripts/skill.mjs copy        copy them instead (if you'll delete this repo)
//   node scripts/skill.mjs uninstall   remove them
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_DIR } from '../src/config.js';

const skillsDir = path.join(os.homedir(), '.claude', 'skills');
const names = fs.readdirSync(path.join(REPO_DIR, 'skills')).filter((n) => fs.existsSync(path.join(REPO_DIR, 'skills', n, 'SKILL.md')));

function remove(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return false;
  fs.rmSync(target, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
  return true;
}

const command = process.argv[2] || 'install';
if (command === 'install' || command === 'copy') {
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const name of names) {
    const source = path.join(REPO_DIR, 'skills', name);
    const target = path.join(skillsDir, name);
    remove(target);
    if (command === 'copy') fs.cpSync(source, target, { recursive: true });
    else fs.symlinkSync(source, target);
    console.log(`${command === 'copy' ? 'Copied' : 'Linked'} ${target} <- ${source}`);
  }
  console.log('Start a new Claude Code session and ask: "what\'s in my inbox?"');
} else if (command === 'uninstall') {
  for (const name of names) {
    const target = path.join(skillsDir, name);
    console.log(remove(target) ? `Removed ${target}` : `${name}: not installed.`);
  }
} else {
  console.error('usage: skill.mjs install | copy | uninstall');
  process.exit(1);
}
