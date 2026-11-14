// One message in, one Notion page (and maybe a reply) out. Used by the
// WhatsApp bot and by `npm run simulate`.
import { buildPrompt, runClaude } from './claude.js';
import { transcribe } from './transcribe.js';

export async function processItem(item, cfg, logger) {
  if (item.kind === 'voice' && item.file && item.transcript === undefined) {
    item.transcript = await transcribe(item.file, cfg, logger);
  }
  const prompt = buildPrompt(item, cfg);
  try {
    return await runClaude(prompt, cfg, logger);
  } catch (err) {
    logger.warn({ err: err.message, id: item.id }, 'claude failed, retrying once');
    return await runClaude(prompt, cfg, logger);
  }
}
