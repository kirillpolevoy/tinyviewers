// Minimal streaming Messages API call with structured JSON output (same approach as run-claude.js).
import './common.js'; // loads .env.local

export const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5': [2, 10] }; // $/Mtok in, out

export async function callClaude({ model, system, user, schema, maxTokens = 8000, effort }) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
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
    if (!res.ok) {
      const body = await res.text();
      if ([429, 500, 529].includes(res.status) && attempt < 5) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 5 * 2 ** attempt) * 1000));
        continue;
      }
      throw new Error(`anthropic ${res.status}: ${body.slice(0, 600)}`);
    }
    let text = '';
    let buffer = '';
    let stopReason = null;
    const usage = {};
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
        if (ev.type === 'error') throw new Error(`anthropic stream error: ${JSON.stringify(ev.error)}`);
      }
    }
    if (stopReason !== 'end_turn') throw new Error(`unexpected stop_reason ${stopReason}`);
    return { data: JSON.parse(text), usage, latencyMs: Date.now() - started };
  }
}

// Cost including cache writes (1.25x input) and cache reads (0.1x input).
export function costUsd(model, usages) {
  const [pIn, pOut] = PRICES[model];
  return usages.reduce((s, u) => s + ((u.input_tokens ?? 0) * pIn + (u.cache_creation_input_tokens ?? 0) * pIn * 1.25 + (u.cache_read_input_tokens ?? 0) * pIn * 0.1 + (u.output_tokens ?? 0) * pOut) / 1e6, 0);
}
