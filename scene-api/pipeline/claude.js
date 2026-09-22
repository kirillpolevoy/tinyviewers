// COPY of experiments/trigger-scan/claude.js as of commit 5fe8fb5: the streaming Messages API call
// with structured JSON output, and the cost arithmetic that goes with it.
//
// Differences from the original, all forced by where this runs:
//   1. no `import './common.js'` — that import existed only to load ../../.env.local, and a Vercel
//      function already has its environment.
//   2. `fetchImpl` and `sleep` are injectable, so the pipeline tests can stub a whole run without a
//      network and without waiting out a backoff. The default is the real global fetch.
//   3. `onUsage` and `signal`. A script's failed call cost the person watching it nothing they had
//      to account for; here every response has to be charged against a daily cap the moment it
//      arrives — BEFORE anything about it is judged — and every call has to be abortable, because
//      a sibling call failing must not leave this one spending.
// The model, the prompt shape, the cache_control on the system prompt, the streaming parse and the
// prices are unchanged.

import { UpstreamError, requestIdOf } from './errors.js';

export const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5': [2, 10] }; // $/Mtok in, out

/**
 * Tokens in a piece of prompt text, rounded UP hard.
 *
 * 4 characters per token is the usual English average, and an average is the wrong tool here: this
 * number is only ever used to refuse a call or to reserve money against a cap, so being low is the
 * one failure that matters. 3 characters per token is below anything this prompt shape produces
 * (an all-caps sound caption, a name-heavy transcript, punctuation-dense subtitles) without being
 * so pessimistic that a real film is refused: a feature transcript comes out around 33k tokens
 * here against 25k measured, which is a fifth of the scene pass's cap either way.
 */
export const estimateTokens = (text) => Math.ceil(String(text).length / 3);

/**
 * The most one call could possibly cost: the whole prompt billed as fresh input (no cache read) at
 * the estimate above, plus a completely full output buffer.
 */
export function worstCaseUsd({ system, user, maxTokens, prices }) {
  const [pIn, pOut] = prices;
  return (estimateTokens(`${system}${user}`) * pIn + maxTokens * pOut) / 1e6;
}

/**
 * @param {(usage: object, estimated: boolean) => void} [opts.onUsage] called exactly once per call
 *   with what it cost, the moment the response has been read and before its content is judged. A
 *   response that stops at `max_tokens`, or whose JSON will not parse, was still billed in full;
 *   waiting for a valid result to bank it threw that money away. `estimated` is true when no
 *   response ever arrived and the charge is this request's own input estimate instead.
 * @param {AbortSignal} [opts.signal] from the pool this call belongs to: a sibling failing cancels
 *   this one rather than letting it run to completion against a job that is already lost.
 */
export async function callClaude({
  model, system, user, schema, maxTokens = 8000, effort,
  apiKey = process.env.CLAUDE_API_KEY,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  onUsage, signal,
}) {
  let banked = false;
  const bank = (usage, estimated = false) => {
    if (banked) return;
    banked = true;
    onUsage?.(usage, estimated);
  };
  // What we charge when nothing ever told us what this call cost. An aborted request can have been
  // served and billed in full; charging zero for it is the one answer we know to be wrong.
  const estimated = () => ({ input_tokens: estimateTokens(`${system}${user}`), output_tokens: 0 });

  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new UpstreamError({ service: 'anthropic', code: 'cancelled' });
    const started = Date.now();
    let res;
    try {
      res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          stream: true,
          // the system prompt (attribute vocabulary) is identical on every call, so cache it
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: user }],
        }),
      });
    } catch {
      // Headers never arrived, so nothing can say what this cost. Charge the estimate.
      bank(estimated(), true);
      throw new UpstreamError({ service: 'anthropic', code: signal?.aborted ? 'cancelled' : 'no_response' });
    }
    if (!res.ok) {
      // Drained and dropped: an Anthropic error body quotes the request, which here is subtitles.
      await res.text().catch(() => {});
      if ([429, 500, 529].includes(res.status) && attempt < 5) {
        await sleep((Number(res.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000);
        continue;
      }
      // A rejected request is not billed, so nothing is banked for it.
      throw new UpstreamError({ service: 'anthropic', status: res.status, requestId: requestIdOf(res.headers), code: 'http_error' });
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
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') text += ev.delta.text;
          if (ev.type === 'message_delta') {
            stopReason = ev.delta.stop_reason;
            usage.output_tokens = ev.usage.output_tokens;
          }
          if (ev.type === 'error') throw new UpstreamError({ service: 'anthropic', status: res.status, requestId: requestIdOf(res.headers), code: 'stream_error' });
        }
      }
    } catch (err) {
      if (!(err instanceof UpstreamError)) {
        throw new UpstreamError({ service: 'anthropic', status: res.status, requestId: requestIdOf(res.headers), code: signal?.aborted ? 'cancelled' : 'stream_failed' });
      }
      throw err;
    } finally {
      // Before `stop_reason` is looked at and before the JSON is parsed: whatever the stream said
      // it used was billed, and a truncated or unparseable answer is still a paid answer.
      if (Object.keys(usage).length) bank(usage);
      else bank(estimated(), true);
    }
    if (stopReason !== 'end_turn') {
      throw new UpstreamError({ service: 'anthropic', status: res.status, requestId: requestIdOf(res.headers), code: `stop_${stopReason ?? 'missing'}` });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UpstreamError({ service: 'anthropic', status: res.status, requestId: requestIdOf(res.headers), code: 'unparseable' });
    }
    return { data, usage, latencyMs: Date.now() - started };
  }
}

// Cost including cache writes (1.25x input) and cache reads (0.1x input).
// `prices` is injectable so a test can put this pipeline in front of a model that costs enough for
// a cap to bite without pretending a real price is something it is not.
export function costUsd(model, usages, prices = PRICES[model]) {
  const [pIn, pOut] = prices;
  return usages.reduce((s, u) => s + ((u.input_tokens ?? 0) * pIn + (u.cache_creation_input_tokens ?? 0) * pIn * 1.25 + (u.cache_read_input_tokens ?? 0) * pIn * 0.1 + (u.output_tokens ?? 0) * pOut) / 1e6, 0);
}
