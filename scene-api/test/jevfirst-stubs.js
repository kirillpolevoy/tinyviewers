// Stubs shaped like the real APIs the Jev-first pipeline calls, for tests and local dry runs. They
// answer every request with real `Response` objects (so the streaming parse runs for real), and every
// answer is a deterministic function of the request, so a run is reproducible.
//
//   jevAnswer(body)      a TypeSafe System One response: one answer per question, by type
//   claudeStream(data)   an Anthropic streaming Messages response carrying `data` as its JSON text
//   makeFetch(handlers)  a fetch that routes by URL, counts calls per service
import crypto from 'node:crypto';

const h = (s) => crypto.createHash('sha256').update(s).digest();
/** A deterministic number in [0, 1) from a string. */
export const unit = (s) => h(s).readUInt32BE(0) / 2 ** 32;

/** Answer one System One request. `bias(key, q)` may return a probability to force for a question. */
export function jevAnswer(body, { bias = () => null } = {}) {
  const answers = {};
  const stateKey = JSON.stringify(body.state).slice(0, 2000);
  for (const [k, q] of Object.entries(body.questions ?? {})) {
    const u = unit(`${stateKey}|${k}|${q.instructions}`);
    const forced = bias(k, q);
    if (q.type === 'noul') answers[k] = { noul: forced ?? Math.round((u ** 3) * 1000) / 1000 };
    else if (q.type === 'choice') {
      const opts = Object.keys(q.criteria ?? {});
      const pick = opts[Math.floor(u * opts.length)] ?? opts[0];
      const probabilities = Object.fromEntries(opts.map((o) => [o, o === pick ? 0.7 : 0.3 / Math.max(1, opts.length - 1)]));
      answers[k] = { choice: pick, confidence: 0.7, probabilities };
    } else if (q.type === 'score') {
      const levels = Array.isArray(q.criteria) ? q.criteria.length : Object.keys(q.criteria ?? {}).length || 4;
      const lv = Math.floor(u * levels);
      const probabilities = Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), i === lv ? 0.7 : 0.3 / Math.max(1, levels - 1)]));
      answers[k] = { score: lv, confidence: 0.7, probabilities };
    }
  }
  const input = Math.ceil(JSON.stringify(body).length / 3.5);
  return { model: body.model, answers, usage: { input_tokens: input, output_tokens: 5 } };
}

export const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

/** A streaming Messages response whose text is JSON.stringify(data). */
export function claudeStream(data, { input = 1000, output = 500, stop = 'end_turn' } = {}) {
  const text = JSON.stringify(data);
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: input, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...[0, 1, 2].map((i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(Math.floor((i * text.length) / 3), Math.floor(((i + 1) * text.length) / 3)) } })),
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: output } },
    { type: 'message_stop' },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A fetch routed by URL. `handlers` maps a service to (url, init, body) => Response|Promise<Response>. */
export function makeFetch(handlers) {
  const calls = { jev: 0, anthropic: 0, count_tokens: 0, tmdb: 0, wiki: 0, wikidata: 0, opensubtitles: 0, other: 0, continue: 0 };
  const f = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? (() => { try { return JSON.parse(init.body); } catch { return init.body; } })() : null;
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    let service = 'other';
    if (u.startsWith('https://api.typesafe.ai/')) service = 'jev';
    else if (u.includes('/v1/messages/count_tokens')) service = 'count_tokens';
    else if (u.startsWith('https://api.anthropic.com/')) service = 'anthropic';
    else if (u.startsWith('https://api.themoviedb.org/')) service = 'tmdb';
    else if (u.startsWith('https://en.wikipedia.org/')) service = 'wiki';
    else if (u.startsWith('https://www.wikidata.org/')) service = 'wikidata';
    else if (u.includes('opensubtitles')) service = 'opensubtitles';
    else if (u.includes('/continue')) service = 'continue';
    calls[service]++;
    const fn = handlers[service];
    if (!fn) throw new Error(`no stub for ${service}: ${u}`);
    return fn(u, init, body);
  };
  f.calls = calls;
  return f;
}
