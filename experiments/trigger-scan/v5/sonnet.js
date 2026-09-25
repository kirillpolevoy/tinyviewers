// Streaming Messages API call with structured JSON output. Same endpoint, headers, model, streaming
// parser and output_config as ../claude.js (the client run-sonnet-alone.js uses), with two changes a
// hard budget needs:
//   - it never throws away usage: a stream that ends early (max_tokens, stream error) still reports
//     the tokens it was billed for, so the caller can settle its reservation with a real number;
//   - no prompt caching (a one-off call pays 1.25x to write a cache it never reads).
// Prices come from ../claude.js so there is one price table.
import '../common.js'; // loads ../../.env.local with dotenv (parsed in Node, never shell-sourced)
import { PRICES } from '../claude.js';

export { PRICES };

export function costUsd(model, u) {
  const [pIn, pOut] = PRICES[model];
  return ((u.input_tokens ?? 0) * pIn
    + (u.cache_creation_input_tokens ?? 0) * pIn * 1.25
    + (u.cache_read_input_tokens ?? 0) * pIn * 0.1
    + (u.output_tokens ?? 0) * pOut) / 1e6;
}

export class ClaudeCallError extends Error {
  constructor(message, { usage, stopReason, partialText, rejected = false } = {}) {
    super(message);
    this.rejected = rejected; // true = refused before generation, nothing billed
    this.usage = usage;
    this.stopReason = stopReason;
    this.partialChars = partialText?.length ?? 0;
  }
}

export async function callClaude({ model, system, user, schema, maxTokens, effort, onProgress }) {
  if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY is not set in .env.local');
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system,
        output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      // Rejected before generation: nothing was billed, so a retry spends nothing extra.
      const body = await res.text();
      if ([429, 500, 529].includes(res.status) && attempt < 5) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000));
        continue;
      }
      throw new ClaudeCallError(`anthropic ${res.status}: ${body.slice(0, 600)}`, { usage: {}, rejected: true });
    }
    let text = '';
    let buffer = '';
    let stopReason = null;
    const usage = {};
    try {
      for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'message_start') Object.assign(usage, ev.message.usage);
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            text += ev.delta.text;
            onProgress?.(text.length);
          }
          if (ev.type === 'message_delta') {
            stopReason = ev.delta.stop_reason;
            usage.output_tokens = ev.usage.output_tokens;
          }
          if (ev.type === 'error') throw new Error(`anthropic stream error: ${JSON.stringify(ev.error)}`);
        }
      }
    } catch (err) {
      throw new ClaudeCallError(err.message, { usage, stopReason, partialText: text });
    }
    if (stopReason !== 'end_turn') throw new ClaudeCallError(`unexpected stop_reason ${stopReason}`, { usage, stopReason, partialText: text });
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new ClaudeCallError(`output did not parse: ${err.message}`, { usage, stopReason, partialText: text });
    }
    return { data, usage, stopReason, latencyMs: Date.now() - started };
  }
}

/**
 * Exact input token count from the free count_tokens endpoint (no generation, not billed). The JSON
 * schema is not part of that request, so callers add their own margin for it. Returns null when the
 * endpoint is unavailable; callers then fall back to a deliberately high character estimate.
 */
export async function countTokens({ model, system, user }) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Number.isInteger(json.input_tokens) ? json.input_tokens : null;
  } catch {
    return null;
  }
}
