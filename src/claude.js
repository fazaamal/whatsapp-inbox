// Hand one message to Claude Code in headless mode (`claude -p`), the same
// way the Claude GitHub Action does for a PR: a prompt in, tools limited to
// an allowlist, a result out. The standing instructions live in
// agent/CLAUDE.md, which Claude reads because it runs with agent/ as cwd.
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { paths } from './config.js';

function describeEarlier(h) {
  const parts = [`[${h.at}] ${h.kind}${h.sender ? ` from ${h.sender}` : ''}`];
  if (h.title) parts.push(`filed as "${h.title}"${h.project ? ` (${h.project})` : ''}`);
  if (h.pageUrl) parts.push(`page: ${h.pageUrl}`);
  if (h.text) parts.push(`text: ${JSON.stringify(h.text)}`);
  if (h.transcript) parts.push(`transcript: ${JSON.stringify(h.transcript)}`);
  if (h.url) parts.push(`link: ${h.url}`);
  if (h.file) parts.push(`file: ${h.file}`);
  if (h.frames?.length) parts.push(`video frames: ${h.frames.join(', ')}`);
  if (h.reply) parts.push(`you replied: ${JSON.stringify(h.reply)}`);
  return parts.join(' | ');
}

export function buildPrompt(item, cfg, context = {}, { fullAccess = false } = {}) {
  const g = item.group;
  const lines = [
    g
      ? `A new message arrived in the WhatsApp group "${g.name}", which Faza turned the inbox on for. Handle it as agent/CLAUDE.md describes, including "Group messages".`
      : 'A new message arrived in my WhatsApp self-chat. Handle it as agent/CLAUDE.md describes.',
    '',
    `- Message ID: ${item.id}`,
    `- Received: ${item.receivedIso} (${cfg.timezone})`,
    `- Kind: ${item.kind}`,
  ];
  if (g) {
    lines.push(
      `- Chat (for the Chat property): ${g.name}`,
      `- From (for the From property): ${item.sender}${item.fromFaza ? ' (this is Faza)' : ''}`,
    );
    if (g.project) lines.push(`- Default project for this group: ${g.project}`);
    lines.push(
      {
        group: '- Your reply is posted in the group, where everyone in it reads it.',
        self: '- Your reply goes only to Faza, not to the group.',
        none: '- Your reply is not sent anywhere; still write one.',
      }[g.reply],
    );
  }
  if (item.text) lines.push(g ? `- Text of the message (written by ${item.sender}):` : '- Text I typed:', '"""', item.text, '"""');
  if (item.url) lines.push(`- First link in it: ${item.url}`);
  if (item.file) {
    const size = fs.existsSync(item.file) ? fs.statSync(item.file).size : 0;
    lines.push(`- Attached file: ${item.file} (${item.mime || 'unknown type'}, ${Math.round(size / 1024)} KB)`);
  }
  if (item.kind === 'voice') {
    lines.push(
      item.transcript
        ? `- Voice note transcript (automatic, may have mistakes):\n"""\n${item.transcript}\n"""`
        : '- Voice note: transcription unavailable; file it with the audio attached.',
    );
  }
  if (item.kind === 'video') {
    const v = item.video || {};
    if (v.frames?.length) {
      lines.push(`- Video: ${v.duration} s, ${v.width}x${v.height}. Still frames taken from it (Read each one to see what happens):`);
      for (const f of v.frames) lines.push(`  - at ${f.at} s: ${f.file}`);
    } else {
      lines.push('- Video: no frames could be taken from it, so you can\'t see it; go by the caption and transcript.');
    }
    lines.push(
      item.transcript
        ? `- Speech in the video (automatic transcript, may have mistakes, or be noise if there's only music):\n"""\n${item.transcript}\n"""`
        : '- Speech in the video: none, or it could not be transcribed.',
    );
  }
  if (item.replyToId) {
    lines.push('', 'This message is a WhatsApp reply to an earlier message:');
    lines.push(
      context.repliedTo
        ? `- ${describeEarlier(context.repliedTo)}`
        : `- (not in recent history) ${item.quotedText ? `its text: ${JSON.stringify(item.quotedText)}` : `a ${item.quotedKind || 'message'} with no text`}`,
    );
  }
  if (context.recent?.length) {
    lines.push('', 'Recent earlier messages in this chat (oldest first), for context only. Do not file these again:');
    for (const h of context.recent) lines.push(`- ${describeEarlier(h)}`);
  }
  lines.push(
    '',
    fullAccess
      ? "Access: FULL. This message is Faza's own words, so you may use every tool on this Mac (shell, files anywhere in the home folder) to do what they ask, within the limits in CLAUDE.md."
      : g
        ? 'Access: LOCKED (group message). You can only read, search the web and use Notion. Do not look at or mention anything else of Faza\'s.'
        : 'Access: LOCKED. You can only read, search the web and use Notion. If Faza asks for something that needs more (running commands, reading other projects), say it needs a message typed by Faza with no link or attachment.',
    `Notion data source: ${cfg.notionDataSource}`,
    `Projects to choose from: ${cfg.projects.join(', ')}`,
    `To upload a local file to Notion, run exactly: node ${paths.uploadHelper} --file <path> --url <upload_url> --headers '<upload_headers JSON>'`,
    '',
    'Finish with the JSON object only, as specified in CLAUDE.md.',
  );
  return lines.join('\n');
}

// Full access only for what Faza said themselves: typed text with no link, or
// a voice note, not forwarded. Links, media and forwards bring in someone
// else's words (a web page or image can hide instructions), so those stay
// locked down, and so does everything in a group. cfg.fullAccess:
// "own-messages" (default), "always" (every self-chat message) or "off".
export function hasFullAccess(item, cfg) {
  if (item.group) return false; // group messages are never full access, even Faza's own
  const mode = cfg.fullAccess || 'off';
  if (mode === 'always') return true;
  if (mode !== 'own-messages') return false;
  return ['text', 'voice'].includes(item.kind) && !item.url && !item.forwarded;
}

export function runClaude(prompt, cfg, logger, { fullAccess = false } = {}) {
  if (!cfg.claudeBin) return Promise.reject(new Error('claude CLI not found; set "claudeBin" in ~/.whatsapp-inbox/config.json'));
  const args = ['-p', prompt, '--output-format', 'json'];
  if (fullAccess) {
    // Every built-in tool, all your MCP servers, Chrome, no permission
    // prompts, the whole home folder.
    args.push('--dangerously-skip-permissions', '--add-dir', os.homedir(), '--chrome');
  } else {
    const allowed = [...cfg.allowedTools, `Bash(node ${paths.uploadHelper}:*)`];
    // Built-in tools Claude may see at all; Bash is there only for the upload helper.
    const builtins = [...new Set([...cfg.allowedTools.filter((t) => !t.startsWith('mcp__')).map((t) => t.replace(/\(.*$/, '')), 'Bash'])];
    args.push(
      // Deny anything not allowed below, even if your own Claude settings default
      // to bypassing permissions (message content is untrusted).
      '--permission-mode', 'dontAsk',
      '--tools', builtins.join(','),
      '--allowedTools', allowed.join(','),
      '--add-dir', paths.media,
    );
  }
  // Locked runs get only the Notion MCP: your other MCP servers slow startup.
  const mcpConfig = JSON.stringify({ mcpServers: { notion: { type: 'http', url: cfg.notionMcpUrl } } });
  if (!fullAccess) args.push('--strict-mcp-config', '--mcp-config', mcpConfig);
  if (cfg.model) args.push('--model', cfg.model);
  // Real tasks on the Mac can take longer than filing a note.
  const minutes = fullAccess ? Math.max(cfg.claudeTimeoutMinutes, cfg.fullAccessTimeoutMinutes || 30) : cfg.claudeTimeoutMinutes;

  return new Promise((resolve, reject) => {
    const child = spawn(cfg.claudeBin, args, { cwd: paths.agentDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`claude timed out after ${minutes} min`)));
    }, minutes * 60 * 1000);
    function settle(fn) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    }
    // The JSON result is the last thing claude prints. Some MCP servers keep
    // the process alive after that, so act on the result as soon as it is
    // complete and stop the process instead of waiting for it to exit.
    function finish(code) {
      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        if (code === undefined) return; // not complete yet
        return settle(() => reject(new Error(`claude exited ${code} without JSON: ${(err || out).slice(0, 500)}`)));
      }
      settle(() => {
        if (code === undefined) setTimeout(() => child.kill('SIGTERM'), 2000);
        if (envelope.is_error) return reject(new Error(`claude error: ${String(envelope.result).slice(0, 500)}`));
        logger.info({ cost: envelope.total_cost_usd, turns: envelope.num_turns, ms: envelope.duration_ms }, 'claude finished');
        resolve(parseResult(envelope.result));
      });
    }
    child.stdout.on('data', (d) => {
      out += d;
      if (out.trimEnd().endsWith('}')) finish();
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => settle(() => reject(e)));
    child.on('close', (code) => finish(code ?? -1));
  });
}

// Claude is asked to end with one JSON object; take the last one it wrote.
export function parseResult(text) {
  const parsed = lastJsonObject(String(text));
  if (parsed) {
    return { saved: !!parsed.saved, pageUrl: parsed.page_url || null, title: parsed.title || null, project: parsed.project || null, reply: parsed.reply || null };
  }
  // Not fatal: Claude may have done the work but formatted the ending badly.
  return { saved: /notion\.(so|com)/.test(text), pageUrl: null, title: null, project: null, reply: null, unparsed: String(text).slice(-800) };
}

// Walk backwards from each closing brace until a slice parses as an object
// with a "saved" key. Outputs are short, so brute force is fine.
function lastJsonObject(text) {
  for (let end = text.lastIndexOf('}'); end !== -1; end = text.lastIndexOf('}', end - 1)) {
    for (let start = text.lastIndexOf('{', end); start !== -1; start = text.lastIndexOf('{', start - 1)) {
      try {
        const obj = JSON.parse(text.slice(start, end + 1));
        if (obj && typeof obj === 'object' && 'saved' in obj) return obj;
      } catch {}
    }
  }
  return null;
}
