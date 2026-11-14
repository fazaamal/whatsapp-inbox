#!/usr/bin/env node
// Install the whatsapp-inbox Claude skill on its own (no WhatsApp bot needed),
// by linking skills/whatsapp-inbox into ~/.claude/skills.
//
//   node scripts/skill.mjs install     link it (default)
//   node scripts/skill.mjs copy        copy it instead (if you'll delete this repo)
//   node scripts/skill.mjs uninstall   remove it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_DIR } from '../src/config.js';

const source = path.join(REPO_DIR, 'skills', 'whatsapp-inbox');
const skillsDir = path.join(os.homedir(), '.claude', 'skills');
const target = path.join(skillsDir, 'whatsapp-inbox');

function remove() {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat) return false;
  fs.rmSync(target, { recursive: stat.isDirectory() && !stat.isSymbolicLink(), force: true });
  return true;
}

const command = process.argv[2] || 'install';
if (command === 'install' || command === 'copy') {
  fs.mkdirSync(skillsDir, { recursive: true });
  remove();
  if (command === 'copy') fs.cpSync(source, target, { recursive: true });
  else fs.symlinkSync(source, target);
  console.log(`${command === 'copy' ? 'Copied' : 'Linked'} ${target} <- ${source}`);
  console.log('Start a new Claude Code session and ask: "what\'s in my inbox?"');
} else if (command === 'uninstall') {
  console.log(remove() ? `Removed ${target}` : 'Not installed.');
} else {
  console.error('usage: skill.mjs install | copy | uninstall');
  process.exit(1);
}
