// OURS, not a copy. Stands in for experiments/trigger-scan/v10_1/sonnet.js with the same exports and
// the same request: endpoint, headers, model, streaming parse, output_config, no prompt caching, and
// usage reported even when the stream ends early (so a caller settles its reservation with a real
// number). Differences, because this runs in a request:
//   * no `import '../common.js'` (dotenv): the key comes from the run context (context.js);
//   * fetch, abort signal and backoff sleep come from the run context;
//   * NO response body in any error message: the experiment put `anthropic 400: <600 chars of body>`
//     in the message, and an Anthropic error body quotes the request, which is subtitle lines.
import { runCtx } from '../context.js';
import { PRICES } from '../../pipeline/claude.js';

export { PRICES };

export function costUsd(model, u) {
  const [pIn, pOut] = PRICES[model];
  return ((u.input_tokens ?? 0) * pIn
    + (u.cache_creation_input_tokens ?? 0) * pIn * 1.25
    + (u.cache_read_input_tokens ?? 0) * pIn * 0.1
    + (u.output_tokens ?? 0) * pOut) / 1e6;
}

export class ClaudeCallError extends Error {
  constructor(message, { usage, stopReason, partialText, rejected = false, status = null } = {}) {
    super(message);
    this.rejected = rejected; // true = refused before generation, nothing billed
    this.usage = usage;
    this.stopReason = stopReason;
    this.status = status;
    this.partialChars = partialText?.length ?? 0;
  }
}

export async function callClaude({ model, system, user, schema, maxTokens, effort, onProgress }) {
  const ctx = runCtx();
  const apiKey = ctx.keys?.claude ?? process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new ClaudeCallError('CLAUDE_API_KEY is not configured', { usage: {}, rejected: true });
  for (let attempt = 0; ; attempt++) {
    if (ctx.signal?.aborted) throw new ClaudeCallError('cancelled before the call was sent', { usage: {}, rejected: true });
    const started = Date.now();
    let res;
    try {
      res = await ctx.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: ctx.signal ?? undefined,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream: true,
          system,
          output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: user }],
        }),
      });
    } catch {
      // No headers ever arrived: nothing says what this cost. The caller charges its reservation.
      throw new ClaudeCallError(ctx.signal?.aborted ? 'anthropic call cancelled' : 'anthropic did not answer', { usage: undefined });
    }
    if (!res.ok) {
      // Rejected before generation: nothing was billed. The body is drained and dropped.
      await res.text().catch(() => {});
      if ([429, 500, 529].includes(res.status) && attempt < 5) {
        await ctx.sleep((Number(res.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000);
        continue;
      }
      throw new ClaudeCallError(`anthropic ${res.status}`, { usage: {}, rejected: true, status: res.status });
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
          if (ev.type === 'error') throw new Error('anthropic stream error');
        }
      }
    } catch {
      // A stream cut before its final message_delta carries only message_start's usage (output_tokens 1):
      // the tokens generated so far are unknown, so no usage is reported and the caller settles at the
      // whole reservation (an upper bound), never at a figure that could be below the bill.
      throw new ClaudeCallError(ctx.signal?.aborted ? 'anthropic stream cancelled' : 'anthropic stream failed', { usage: stopReason ? usage : undefined, stopReason, partialText: text });
    }
    // no final message_delta (a clean EOF mid-answer): the output billed is unknown -> no usage, the caller
    // keeps the whole reservation
    if (stopReason !== 'end_turn') throw new ClaudeCallError(`unexpected stop_reason ${stopReason}`, { usage: stopReason ? usage : undefined, stopReason, partialText: text });
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ClaudeCallError('output did not parse', { usage, stopReason, partialText: text });
    }
    return { data, usage, stopReason, latencyMs: Date.now() - started };
  }
}

/**
 * Exact input token count from the free count_tokens endpoint (no generation, not billed); null when
 * it is unavailable, and callers fall back to a deliberately high character estimate. (verbatim)
 */
export async function countTokens({ model, system, user }) {
  const ctx = runCtx();
  try {
    const res = await ctx.fetchImpl('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.keys?.claude ?? process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      signal: ctx.signal ?? undefined,
      body: JSON.stringify({ model, system, messages: [{ role: 'user', content: user }] }),
    });
    if (!res.ok) { await res.text().catch(() => {}); return null; }
    const json = await res.json();
    return Number.isInteger(json.input_tokens) ? json.input_tokens : null;
  } catch {
    return null;
  }
}
