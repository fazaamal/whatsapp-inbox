// One message in, one Notion page (and maybe a reply) out. Used by the
// WhatsApp bot and by `npm run simulate`.
import { buildPrompt, runClaude } from './claude.js';
import { transcribe } from './transcribe.js';
import { addHistory, findInHistory, recentHistory } from './state.js';

// useHistory: read and write the recent-messages memory (off for `simulate`
// unless asked, so test runs don't leak into real conversations).
export async function processItem(item, cfg, logger, { useHistory = true } = {}) {
  if (item.kind === 'voice' && item.file && item.transcript === undefined) {
    item.transcript = await transcribe(item.file, cfg, logger);
  }
  const context = useHistory
    ? {
        recent: recentHistory({ maxItems: cfg.historyItems, windowHours: cfg.historyHours, excludeId: item.id }),
        repliedTo: item.replyToId ? findInHistory(item.replyToId) : null,
      }
    : {};
  const prompt = buildPrompt(item, cfg, context);
  let result;
  try {
    result = await runClaude(prompt, cfg, logger);
  } catch (err) {
    logger.warn({ err: err.message, id: item.id }, 'claude failed, retrying once');
    result = await runClaude(prompt, cfg, logger);
  }
  if (useHistory) addHistory(item, result);
  return result;
}
