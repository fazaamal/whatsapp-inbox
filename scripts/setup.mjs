#!/usr/bin/env node
// One-time setup on a Mac. Safe to re-run; it skips what's already done.
//   1. checks claude, ffmpeg and whisper-cli (installs the last two with brew)
//   2. downloads the speech-to-text model for voice notes
//   3. checks Claude Code can reach Notion
//   4. links WhatsApp (QR code)
//   5. installs the background service so it keeps running
//   6. links the whatsapp-inbox skill into Claude Code (~/.claude/skills)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO_DIR, findOnPath, loadConfig, paths } from '../src/config.js';

// creds.json appears as soon as Baileys starts; it only counts once it has your account in it.
const isLinked = () => {
  try {
    return !!JSON.parse(fs.readFileSync(path.join(paths.auth, 'creds.json'), 'utf8')).me?.id;
  } catch {
    return false;
  }
};

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';
const step = (n, text) => console.log(`\n[${n}/6] ${text}`);
const cfg = loadConfig();

step(1, 'Checking tools');
if (!cfg.claudeBin) {
  console.error('Claude Code CLI not found. Install it (https://code.claude.com), sign in, then re-run.');
  process.exit(1);
}
console.log(`claude: ${cfg.claudeBin}`);
const missing = ['ffmpeg', 'whisper-cli'].filter((bin) => !findOnPath(bin));
if (missing.length) {
  const brew = findOnPath('brew');
  if (!brew) {
    console.error(`Missing ${missing.join(', ')} and Homebrew isn't installed. Install them, then re-run.`);
    process.exit(1);
  }
  const formulae = missing.map((bin) => (bin === 'whisper-cli' ? 'whisper-cpp' : bin));
  console.log(`Installing ${formulae.join(', ')} with Homebrew...`);
  execFileSync(brew, ['install', ...formulae], { stdio: 'inherit' });
} else {
  console.log('ffmpeg and whisper-cli found.');
}

step(2, 'Speech-to-text model for voice notes');
if (fs.existsSync(cfg.whisperModel)) {
  console.log(`Already downloaded: ${cfg.whisperModel}`);
} else {
  console.log(`Downloading ggml-small.bin (~466 MB) from Hugging Face (ggerganov/whisper.cpp)...`);
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = cfg.whisperModel + '.part';
  fs.mkdirSync(path.dirname(cfg.whisperModel), { recursive: true });
  const out = fs.createWriteStream(tmp);
  let done = 0;
  let lastPct = -1;
  for await (const chunk of res.body) {
    out.write(chunk);
    done += chunk.length;
    const pct = total ? Math.floor((done / total) * 100) : 0;
    if (pct !== lastPct && pct % 10 === 0) {
      process.stdout.write(`${pct}% `);
      lastPct = pct;
    }
  }
  await new Promise((resolve) => out.end(resolve));
  fs.renameSync(tmp, cfg.whisperModel);
  console.log('\nDone.');
}

step(3, 'Checking Claude Code can reach Notion');
const mcp = spawnSync(cfg.claudeBin, ['mcp', 'get', 'notion'], { encoding: 'utf8', cwd: REPO_DIR });
if (mcp.status !== 0) {
  console.log(`Notion isn't connected to Claude Code yet. Run:
  claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp
then start \`claude\`, type /mcp, choose notion and sign in. Then re-run this setup.`);
  process.exit(1);
}
console.log('Notion MCP is configured.');

step(4, 'Linking WhatsApp');
spawnSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'service.mjs'), 'uninstall'], { stdio: 'ignore' });
if (isLinked()) {
  console.log('Already linked. (To re-link: delete ~/.whatsapp-inbox/auth and re-run.)');
} else {
  const login = spawnSync(process.execPath, [path.join(REPO_DIR, 'src', 'index.js'), '--login'], { stdio: 'inherit' });
  if (login.status !== 0 || !isLinked()) {
    console.error('WhatsApp linking did not finish. Re-run `npm run setup` to try again.');
    process.exit(1);
  }
}

step(5, 'Installing the background service');
spawnSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'service.mjs'), 'install'], { stdio: 'inherit' });

step(6, 'Linking the whatsapp-inbox skill into Claude Code');
spawnSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'skill.mjs'), 'install'], { stdio: 'inherit' });

console.log(`
All set. Send anything to your own WhatsApp chat ("Message yourself").
  ⏳ = working, ✅ = filed in Notion, ❌ = failed (send /retry). Send /status to check on it.
  Notion inbox: ${cfg.notionDatabaseUrl}
  Logs: npm run logs`);
