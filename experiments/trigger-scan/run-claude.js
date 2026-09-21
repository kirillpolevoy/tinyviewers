// Claude arms. Same taxonomy text as Jev; cue ids in, cue ids out (timestamps resolved in code).
//
//   node run-claude.js --mode windowed --model claude-haiku-4-5 --track sdh
//   node run-claude.js --mode whole    --model claude-sonnet-5  --track sdh
//   node run-claude.js --mode describe --model claude-haiku-4-5 --from runs/<jev run>.json
import fs from 'node:fs';
import { CATEGORIES, CATEGORY_IDS, SEVERITY_LEVELS, AUDIENCE } from './taxonomy.js';
import { loadTrack, glossary, cueLine, previousLines, parseArgs, pool, saveRun } from './common.js';
import { windowsToScenes } from './events.js';

const PRICES = { 'claude-haiku-4-5': [1, 5], 'claude-sonnet-5': [2, 10] }; // $/Mtok in, out

const args = parseArgs();
const mode = args.mode ?? 'windowed';
const model = args.model ?? 'claude-haiku-4-5';
const track = args.track ?? 'sdh';
const { cues, windows } = loadTrack(track);
const cueById = new Map(cues.map((c) => [c.id, c]));

const TAXONOMY_TEXT = CATEGORIES.map((c) => `- ${c.id}: ${c.question}\n  yes = ${c.yes}\n  no = ${c.no}`).join('\n');
const SEVERITY_TEXT = SEVERITY_LEVELS.map((l, i) => `${i} = ${l}`).join('\n');
const SYSTEM = `You flag moments in a movie that could frighten or upset ${AUDIENCE}, working only from subtitle lines.
Each line is "<cue id> [<time>] <text>". Text in (PARENTHESES) is a sound caption.

Categories (use only these ids; several can apply):
${TAXONOMY_TEXT}

Severity for ${AUDIENCE}:
${SEVERITY_TEXT}

Movie context: ${JSON.stringify(glossary)}`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SEVERITY = { type: 'integer', enum: [0, 1, 2, 3] };
const CATEGORY_LIST = { type: 'array', items: { type: 'string', enum: CATEGORY_IDS } };

const SCHEMAS = {
  windowed: obj({
    categories: obj(Object.fromEntries(CATEGORY_IDS.map((id) => [id, { type: 'boolean' }]))),
    severity: SEVERITY,
    peak_cue: { type: 'string', description: 'cue id of the most frightening line, or "none"' },
  }),
  whole: obj({
    events: {
      type: 'array',
      items: obj({ title: { type: 'string' }, start_cue: { type: 'string' }, end_cue: { type: 'string' }, categories: CATEGORY_LIST, severity: SEVERITY, evidence_cues: { type: 'array', items: { type: 'string' } } }),
    },
  }),
  describe: obj({
    description: { type: 'string', description: 'One or two plain sentences telling a parent what happens and why it may upset a 5-year-old. No spoilers beyond this scene.' },
    is_real_trigger: { type: 'boolean' },
    categories: CATEGORY_LIST,
    severity: SEVERITY,
  }),
};

// Streams the response so long whole-movie calls do not hit the HTTP header timeout.
async function callClaude(userText, schema, maxTokens) {
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: userText }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if ([429, 500, 529].includes(res.status) && attempt < 5) {
        const wait = Number(res.headers.get('retry-after')) || 5 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`anthropic ${res.status}: ${body.slice(0, 600)}`);
    }
    let text = '';
    let buffer = '';
    const usage = { input_tokens: 0, output_tokens: 0 };
    let stopReason = null;
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

const startedAt = new Date().toISOString();
const run = { arm: `${model.replace('claude-', '')}-${mode}`, track, label: args.label, model, startedAt };
let calls = [];

if (mode === 'windowed') {
  calls = await pool(windows, 4, async (w, i) => {
    const prev = previousLines(windows, i);
    const user = `${prev.length ? `Previous lines (background only, do not judge these):\n${prev.join('\n')}\n\n` : ''}Lines to judge:\n${w.cues.map(cueLine).join('\n')}\n\nFor each category answer true or false for these lines only, give one severity, and the cue id of the most frightening line (or "none").`;
    const { data, usage, latencyMs } = await callClaude(user, SCHEMAS.windowed, 1000);
    return {
      windowId: w.id,
      startMs: w.startMs,
      endMs: w.endMs,
      cueIds: [w.cues[0].id, w.cues[w.cues.length - 1].id],
      categories: Object.fromEntries(CATEGORY_IDS.map((id) => [id, data.categories[id] ? 1 : 0])),
      severity: data.severity,
      peakCue: data.peak_cue,
      usage,
      latencyMs,
    };
  });
  run.windows = calls;
}

if (mode === 'whole') {
  const user = `Full subtitle transcript:\n${cues.map(cueLine).join('\n')}\n\nList every scene that could frighten or upset ${AUDIENCE}. There is no minimum or maximum number. Bound each scene tightly with start_cue and end_cue (cue ids from the transcript), give all categories that apply, one severity (1-3), and 1-4 evidence cue ids. You may use what you know about this film to interpret the lines, but every scene must be anchored to cue ids that exist in the transcript.`;
  // Sonnet 5 thinks by default and thinking counts against max_tokens; 16k was not enough.
  const result = await callClaude(user, SCHEMAS.whole, 64000);
  calls = [result];
  run.events = result.data.events.map((e, i) => {
    const start = cueById.get(e.start_cue);
    const end = cueById.get(e.end_cue);
    return { id: `E${String(i + 1).padStart(2, '0')}`, ...e, validCues: Boolean(start && end), startMs: start?.startMs ?? null, endMs: end?.endMs ?? null };
  });
}

if (mode === 'describe') {
  const jev = JSON.parse(fs.readFileSync(args.from, 'utf8'));
  const scenes = windowsToScenes(jev.windows);
  run.arm = `jev+${model.replace('claude-', '')}-describe`;
  run.from = args.from;
  calls = await pool(scenes, 4, async (s) => {
    const lines = cues.filter((c) => c.startMs >= s.startMs && c.endMs <= s.endMs).map(cueLine);
    const user = `A first-pass screener flagged these lines for: ${Object.keys(s.categories).join(', ')}.\n\nLines:\n${lines.join('\n')}\n\nWrite the parent-facing description, say whether this really is something that could frighten or upset ${AUDIENCE} (is_real_trigger), and give your own categories and severity.`;
    const { data, usage, latencyMs } = await callClaude(user, SCHEMAS.describe, 1000);
    return { ...s, jevCategories: s.categories, claude: data, usage, latencyMs };
  });
  run.scenes = calls;
}

const tokensIn = calls.reduce((s, c) => s + c.usage.input_tokens, 0);
const tokensOut = calls.reduce((s, c) => s + c.usage.output_tokens, 0);
const [pIn, pOut] = PRICES[model] ?? [0, 0];
Object.assign(run, { wallMs: Date.now() - Date.parse(startedAt), calls: calls.length, inputTokens: tokensIn, outputTokens: tokensOut, costUsd: (tokensIn * pIn + tokensOut * pOut) / 1e6 });
console.log('saved', saveRun(run));
console.log(`${run.arm}: ${run.calls} calls, ${tokensIn} in / ${tokensOut} out tokens, $${run.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)}s wall`);
if (run.events) console.log(`${run.events.length} events, ${run.events.filter((e) => !e.validCues).length} with invalid cue ids`);
