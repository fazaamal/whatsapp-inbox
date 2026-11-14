// Hand one message to Claude Code in headless mode (`claude -p`), the same
// way the Claude GitHub Action does for a PR: a prompt in, tools limited to
// an allowlist, a result out. The standing instructions live in
// agent/CLAUDE.md, which Claude reads because it runs with agent/ as cwd.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { paths } from './config.js';

function describeEarlier(h) {
  const parts = [`[${h.at}] ${h.kind}`];
  if (h.title) parts.push(`filed as "${h.title}"${h.project ? ` (${h.project})` : ''}`);
  if (h.pageUrl) parts.push(`page: ${h.pageUrl}`);
  if (h.text) parts.push(`text: ${JSON.stringify(h.text)}`);
  if (h.transcript) parts.push(`transcript: ${JSON.stringify(h.transcript)}`);
  if (h.url) parts.push(`link: ${h.url}`);
  if (h.file) parts.push(`file: ${h.file}`);
  if (h.reply) parts.push(`you replied: ${JSON.stringify(h.reply)}`);
  return parts.join(' | ');
}

export function buildPrompt(item, cfg, context = {}) {
  const lines = [
    'A new message arrived in my WhatsApp self-chat. Handle it as agent/CLAUDE.md describes.',
    '',
    `- Message ID: ${item.id}`,
    `- Received: ${item.receivedIso} (${cfg.timezone})`,
    `- Kind: ${item.kind}`,
  ];
  if (item.text) lines.push('- Text I typed:', '"""', item.text, '"""');
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
    `Notion data source: ${cfg.notionDataSource}`,
    `Projects to choose from: ${cfg.projects.join(', ')}`,
    `To upload a local file to Notion, run exactly: node ${paths.uploadHelper} --file <path> --url <upload_url> --headers '<upload_headers JSON>'`,
    '',
    'Finish with the JSON object only, as specified in CLAUDE.md.',
  );
  return lines.join('\n');
}

export function runClaude(prompt, cfg, logger) {
  if (!cfg.claudeBin) return Promise.reject(new Error('claude CLI not found; set "claudeBin" in ~/.whatsapp-inbox/config.json'));
  const allowed = [...cfg.allowedTools, `Bash(node ${paths.uploadHelper}:*)`];
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', allowed.join(','), '--add-dir', paths.media];
  if (cfg.model) args.push('--model', cfg.model);

  return new Promise((resolve, reject) => {
    const child = spawn(cfg.claudeBin, args, { cwd: paths.agentDir, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`claude timed out after ${cfg.claudeTimeoutMinutes} min`));
    }, cfg.claudeTimeoutMinutes * 60 * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code} without JSON: ${(err || out).slice(0, 500)}`));
      }
      if (envelope.is_error) return reject(new Error(`claude error: ${String(envelope.result).slice(0, 500)}`));
      logger.info({ cost: envelope.total_cost_usd, turns: envelope.num_turns, ms: envelope.duration_ms }, 'claude finished');
      resolve(parseResult(envelope.result));
    });
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
