// Workstream 3 (fair comparisons), part B: matched-input labelling test.
//
// "Jev cannot label" was concluded from Jev answering per 8-line beat with no context, versus Sonnet
// labelling merged stretches that also carried six context lines each side, the film title and Jev's
// guesses. Several things differed at once. Here the UNIT is fixed for everyone: the reference scenes
// and calm controls from gold/<slug>.json, bounds given, labels hidden. Every model sees the same
// lines, the same 6 context lines each side, the same film title/year, and the same 53 attribute
// definitions INCLUDING each attribute's `no` boundary from taxonomy-v2.js.
//
//   node run-matched.js --film lion-king
//
// Three arms per unit:
//   sonnet       one call, JSON schema -> attribute ids + severity_5_7 + severity_8_10, no screener hints
//   jev_context  one Noul per attribute, P = `units[i].lines`, film title and context in the state
//   jev_bare     the same Nouls with NO context lines and NO film title (isolates context from unit)
//
// Writes runs-v3/matched-<slug>.json (raw probabilities and raw model output). Score with score-matched.js.
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS } from './taxonomy-v2.js';
import { here, loadFilm, cueLine, parseArgs, pool, postJson } from './common.js';
import { callClaude, costUsd } from './claude.js';

const args = parseArgs();
const FILM = args.film;
if (!FILM) throw new Error('--film <slug> is required');
const model = args.model ?? 'claude-sonnet-5';
const JEV_MODEL = 'jev-1.13.0';
const JEV_PRICE_PER_MTOK = 0.042;
const CONTEXT_LINES = 6;
const UNITS_PER_JEV_REQUEST = 5;

const FILMS = JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8'));
const title = `${FILMS[FILM].title} (${FILMS[FILM].year})`;
const { cues } = loadFilm(FILM);
const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold', `${FILM}.json`), 'utf8'));

// ---- the units: identical for every arm -------------------------------------------------------------
const units = gold.map((g) => {
  const from = cueIndex.get(g.start_cue);
  const to = cueIndex.get(g.end_cue);
  if (from == null || to == null) throw new Error(`${FILM} ${g.id}: unknown cue`);
  return {
    id: g.id,
    control: !!g.control,
    start_cue: g.start_cue,
    end_cue: g.end_cue,
    startMs: cues[from].startMs,
    endMs: cues[to].endMs,
    before: cues.slice(Math.max(0, from - CONTEXT_LINES), from).map(cueLine),
    lines: cues.slice(from, to + 1).map(cueLine),
    after: cues.slice(to + 1, to + 1 + CONTEXT_LINES).map(cueLine),
  };
});

// ---- the shared vocabulary: question AND `no` boundary, grouped ---------------------------------------
const VOCAB = Object.entries(GROUPS)
  .filter(([g]) => ATTRIBUTES.some((a) => a.group === g))
  .map(([g, label]) => `${label}:\n${ATTRIBUTES.filter((a) => a.group === g).map((a) => `  - ${a.id}: ${a.question.replace(/^In P, /, '').replace(/ in P\b/, '')}${a.no ? ` NO: ${a.no}` : ''}`).join('\n')}`)
  .join('\n');

const SYSTEM = `You label one scene of a film for a database that parents of 5 to 10 year-olds filter by what frightens or upsets their own child. You work from subtitle lines only. Each line is "<cue id> [<time>] <text>"; text in (PARENTHESES) is a sound caption.

You are given ONE scene, with its exact boundaries already decided, plus a few lines of context before and after it so you can tell what is going on. Judge the scene itself, not the context lines.

Return:
- attributes: every attribute id below that truly applies AT THIS MOMENT in the scene. Read each question literally and respect its NO boundary. Only use ids from the list. Return an empty list if none apply.
- severity_5_7 and severity_8_10 (0-3): 0 none, 1 mild and brief, 2 sustained fear or sadness a sensitive child would need a parent for, 3 intense threat to life, a death, or deep grief. Rate the two ages separately. Children of 5-7 are most affected by frightening creatures, the dark, loud sudden events, and separation from a parent, and are NOT reassured by comedy, by the story being fantasy, or by a happy ending later. Children of 8-10 are more affected by things that could really happen (death, injury, abduction, harm to family, humiliation) and are reassured by comic tone and quick rescue.

Attribute ids:
${VOCAB}`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SEV = { type: 'integer', enum: [0, 1, 2, 3] };
const SCHEMA = obj({
  attributes: { type: 'array', items: { type: 'string', enum: ATTRIBUTES.map((a) => a.id) } },
  severity_5_7: SEV,
  severity_8_10: SEV,
});

const userFor = (u) => `Film: ${title}

Lines just before (context only):
${u.before.join('\n') || '(start of film)'}

THE SCENE:
${u.lines.join('\n')}

Lines just after (context only):
${u.after.join('\n') || '(end of film)'}`;

// ---- arm 1: Sonnet, one call per unit ------------------------------------------------------------------
const startedAt = new Date().toISOString();
const sonnetUsages = [];
const sonnet = await pool(units, 5, async (u) => {
  const { data, usage, latencyMs } = await callClaude({ model, system: SYSTEM, user: userFor(u), schema: SCHEMA, maxTokens: 4000, effort: 'low' });
  sonnetUsages.push(usage);
  return { unit: u.id, attributes: data.attributes, severity_5_7: data.severity_5_7, severity_8_10: data.severity_8_10, latencyMs };
});

// ---- arms 2 and 3: Jev, one Noul per attribute per unit -------------------------------------------------
const headers = { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` };
const chunks = [];
for (let i = 0; i < units.length; i += UNITS_PER_JEV_REQUEST) chunks.push(units.slice(i, i + UNITS_PER_JEV_REQUEST));

async function jevArm(withContext) {
  let inputTokens = 0;
  const out = {};
  await pool(chunks, 4, async (chunk) => {
    const state = withContext
      ? { film: title, units: chunk.map((u) => ({ context_before: u.before, lines: u.lines, context_after: u.after })) }
      : { units: chunk.map((u) => ({ lines: u.lines })) };
    const questions = {};
    chunk.forEach((_, i) => {
      for (const a of ATTRIBUTES) {
        questions[`u${i}.${a.id}`] = {
          type: 'noul',
          instructions: a.question.replace(/\bP\b/, `\`units[${i}].lines\``),
          ...(a.no ? { criteria: { false: a.no } } : {}),
        };
      }
    });
    const { json } = await postJson('https://api.typesafe.ai/v1/systemone', headers, { model: JEV_MODEL, state, questions });
    inputTokens += json.usage.input_tokens;
    chunk.forEach((u, i) => {
      out[u.id] = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, json.answers[`u${i}.${a.id}`].noul]));
    });
  });
  return { p: out, inputTokens, costUsd: (inputTokens / 1e6) * JEV_PRICE_PER_MTOK };
}

const jevContext = await jevArm(true);
const jevBare = await jevArm(false);

// ---- save -----------------------------------------------------------------------------------------------
const sonnetCost = costUsd(model, sonnetUsages);
const out = {
  arm: 'matched',
  film: FILM,
  movie: FILMS[FILM],
  taxonomy: 'taxonomy-v2',
  started_at: startedAt,
  wall_s: (Date.now() - Date.parse(startedAt)) / 1000,
  context_lines: CONTEXT_LINES,
  units: units.map((u) => ({ id: u.id, control: u.control, start_cue: u.start_cue, end_cue: u.end_cue, startMs: u.startMs, endMs: u.endMs, n_lines: u.lines.length, n_before: u.before.length, n_after: u.after.length })),
  sonnet: {
    model,
    calls: units.length,
    input_tokens: sonnetUsages.reduce((s, u) => s + (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), 0),
    output_tokens: sonnetUsages.reduce((s, u) => s + (u.output_tokens ?? 0), 0),
    cost_usd: sonnetCost,
    results: sonnet,
  },
  jev_context: { model: JEV_MODEL, with_context: true, calls: chunks.length, input_tokens: jevContext.inputTokens, cost_usd: jevContext.costUsd, probabilities: jevContext.p },
  jev_bare: { model: JEV_MODEL, with_context: false, calls: chunks.length, input_tokens: jevBare.inputTokens, cost_usd: jevBare.costUsd, probabilities: jevBare.p },
  cost_usd: sonnetCost + jevContext.costUsd + jevBare.costUsd,
};
fs.mkdirSync(path.join(here, 'runs-v3'), { recursive: true });
const file = path.join(here, 'runs-v3', `matched-${FILM}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`matched ${FILM}: ${units.length} units (${units.filter((u) => u.control).length} controls) | sonnet $${sonnetCost.toFixed(3)}, jev $${(jevContext.costUsd + jevBare.costUsd).toFixed(4)} | ${out.wall_s.toFixed(0)}s -> ${path.relative(here, file)}`);
