// Workstream 3 (fair comparisons). Two whole-transcript Sonnet arms with the SAME output contract as
// build-scenes.js, so "does Jev add value as a scene finder?" can be asked at all:
//
//   --alone (default): Sonnet reads the whole cue-tagged transcript and gets NO Jev input of any kind.
//   --checklist <jev run file>: the existing build-scenes.js `--context whole` prompt, i.e. the whole
//     transcript PLUS Jev's flagged stretches and per-attribute guesses as a checklist.
//
//   node run-sonnet-alone.js --film lion-king [--label r2]
//   node run-sonnet-alone.js --film lion-king --checklist runs-films/2026-...-jev-v3-universal-lion-king.json
//
// Writes runs-v3/sonnet-alone-<slug>[-<label>].json / runs-v3/sonnet-checklist-<slug>.json.
// This file never writes to scenes/ or runs-films/ and never edits build-scenes.js.
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS } from './taxonomy-v2.js';
import { here, loadFilm, cueLine, parseArgs } from './common.js';
import { flaggedCategories } from './events.js';
import { formatTime } from './srt.js';
import { callClaude, costUsd } from './claude.js';

const args = parseArgs();
const model = args.model ?? 'claude-sonnet-5';
const FILM = args.film;
if (!FILM) throw new Error('--film <slug> is required');
const FILMS = JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8'));
const { cues } = loadFilm(FILM);
const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
const COST_CAP_USD = 0.6;

// ---------------------------------------------------------------------------------------------------
// VOCAB / SYSTEM / SCHEMA below are copied verbatim from build-scenes.js (lines 42-84, 2026-09-20) so
// that this baseline has exactly the same rules, attribute vocabulary and JSON schema as the pipeline.
// build-scenes.js itself is owned by another stream and is NOT edited.
// ---------------------------------------------------------------------------------------------------
const VOCAB = Object.entries(GROUPS)
  .map(([g, label]) => `${label}:\n${ATTRIBUTES.filter((a) => a.group === g).map((a) => `  - ${a.id}: ${a.question.replace(/^In P, /, '').replace(/ in P\b/, '')}`).join('\n')}`)
  .join('\n');
const SYSTEM = `You prepare entries for a database of movie scenes that parents of 5 to 10 year-olds filter by what frightens or upsets their own child. You work from subtitle lines only. Each line is "<cue id> [<time>] <text>"; text in (PARENTHESES) is a sound caption.

A cheap first-pass screener has marked a stretch of lines as possibly containing such a scene. It over-flags and its labels are often wrong. Decide for yourself.

Return zero, one, or several scenes for the stretch:
- Return none if nothing here would frighten or upset a child of 5-10 (calm talk, jokes, danger that is only being retold).
- Split the stretch if it contains separate scenes (for example the film cuts to other characters).
- Bound each scene tightly with start_cue and end_cue. They must be cue ids from the lines you were given.

For each scene:
- title: a few words.
- description: one or two plain sentences telling a parent what happens and what a child might find hard. It must identify the moment without relying on the clock, because timestamps differ between releases. No spoilers beyond this scene.
- attributes: every attribute id from the list below that truly applies at this moment in the story. Only use ids from the list. Be strict: a parent filtering on "monster_threatens" must not get a scene without one, and must not miss one that has it.
- keywords: 2-6 concrete lowercase words a parent might search for (creatures, objects, situations), e.g. "shark", "jellyfish", "dentist".
- severity_5_7 and severity_8_10 (0-3): 0 none, 1 mild and brief, 2 sustained fear or sadness a sensitive child would need a parent for, 3 intense threat to life, a death, or deep grief. Rate the two ages separately. Children of 5-7 are most affected by frightening creatures, the dark, loud sudden events, and separation from a parent, and are NOT reassured by comedy, by the story being fantasy, or by a happy ending later. Children of 8-10 are more affected by things that could really happen (death, injury, abduction, harm to family, humiliation) and are reassured by comic tone and quick rescue.
- text_visibility: "high" if the lines clearly show what happens, "low" if the scene is mostly visual and you are inferring from a few words or from knowing the film.

Attribute ids:
${VOCAB}

Film: ${FILMS[FILM].title} (${FILMS[FILM].year})`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SEV = { type: 'integer', enum: [0, 1, 2, 3] };
const SCHEMA = obj({
  scenes: {
    type: 'array',
    items: obj({
      title: { type: 'string' },
      start_cue: { type: 'string' },
      end_cue: { type: 'string' },
      description: { type: 'string' },
      attributes: { type: 'array', items: { type: 'string', enum: ATTRIBUTES.map((a) => a.id) } },
      keywords: { type: 'array', items: { type: 'string' } },
      severity_5_7: SEV,
      severity_8_10: SEV,
      text_visibility: { type: 'string', enum: ['high', 'low'] },
    }),
  },
});
// ------------------------------- end of the copy from build-scenes.js -------------------------------

// The screener paragraph and the "for the stretch" framing are the only things that mention Jev, so the
// alone arm rewrites exactly those two blocks and leaves every other rule, the vocabulary, the severity
// definitions and the schema byte-identical.
const ALONE_SYSTEM = SYSTEM
  .replace(
    'A cheap first-pass screener has marked a stretch of lines as possibly containing such a scene. It over-flags and its labels are often wrong. Decide for yourself.',
    'You are given the whole subtitle transcript of the film.',
  )
  .replace(
    `Return zero, one, or several scenes for the stretch:
- Return none if nothing here would frighten or upset a child of 5-10 (calm talk, jokes, danger that is only being retold).
- Split the stretch if it contains separate scenes (for example the film cuts to other characters).`,
    `Return every scene in the film that would frighten or upset a child of 5-10:
- Do not return calm talk, jokes, or danger that is only being retold.
- Return separate scenes separately (for example when the film cuts to other characters).`,
  );
// build-scenes.js --context whole makes exactly this substitution:
const CHECKLIST_SYSTEM = SYSTEM.replace('A cheap first-pass screener has marked a stretch of lines', 'You are given the whole transcript. A cheap first-pass screener has marked stretches of lines');

// ---- Jev candidates, only for the --checklist arm (same construction as build-scenes.js lines 27-39) --
const CONTEXT_LINES = 6; // unused here, kept so the copied block reads the same
const BRIDGE_MS = 20_000;
function jevCandidates(jev) {
  const beats = jev.windows;
  const flagged = beats.map((b) => flaggedCategories(b).length > 0);
  flagged.forEach((f, i) => {
    if (!f && flagged[i - 1] && flagged[i + 1] && beats[i].endMs - beats[i].startMs <= BRIDGE_MS) flagged[i] = 'bridge';
  });
  const candidates = [];
  beats.forEach((b, i) => {
    if (!flagged[i]) return;
    const prev = candidates[candidates.length - 1];
    if (prev && prev.lastBeat === i - 1) Object.assign(prev, { lastBeat: i, endCue: b.cueIds[1], beats: [...prev.beats, b] });
    else candidates.push({ id: `K${String(candidates.length + 1).padStart(2, '0')}`, lastBeat: i, startCue: b.cueIds[0], endCue: b.cueIds[1], beats: [b] });
  });
  return candidates;
}
const hintsOf = (k) => ATTRIBUTES.map((a) => [a.id, Math.max(...k.beats.map((b) => b.atoms[a.id]))]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]).slice(0, 8);

// ---- run --------------------------------------------------------------------------------------------
const CHECKLIST = typeof args.checklist === 'string';
const jev = CHECKLIST ? JSON.parse(fs.readFileSync(path.resolve(args.checklist), 'utf8')) : null;
if (jev && jev.film !== FILM) throw new Error(`checklist run is for ${jev.film}, not ${FILM}`);
const candidates = jev ? jevCandidates(jev) : [];

const transcript = cues.map(cueLine).join('\n');
const user = CHECKLIST
  // verbatim from build-scenes.js wholeTranscriptPass()
  ? `Full subtitle transcript:\n${transcript}\n\nThe screener flagged these stretches. Go through every one of them and either return the scene(s) in it or leave it out. Then add any scene the screener missed. Use what happens elsewhere in the film to understand each moment correctly (who is speaking, what creature or place this is).\n\n${candidates.map((k) => `${k.id}: ${k.startCue}-${k.endCue} [${formatTime(k.beats[0].startMs)}] guesses: ${hintsOf(k).map(([id, p]) => `${id} ${p.toFixed(2)}`).join(', ') || 'none'}`).join('\n')}`
  : `Full subtitle transcript:\n${transcript}\n\nGo through the whole film from start to finish and return every scene a parent of a 5-10 year-old would want flagged. Use what happens elsewhere in the film to understand each moment correctly (who is speaking, what creature or place this is).`;

if (args.dry) {
  console.log(`${FILM}: ${cues.length} cues, ~${Math.round((user.length + SYSTEM.length) / 4)} input tokens (rough)`);
  process.exit(0);
}

const startedAt = new Date().toISOString();
const { data, usage, latencyMs } = await callClaude({ model, system: CHECKLIST ? CHECKLIST_SYSTEM : ALONE_SYSTEM, user, schema: SCHEMA, maxTokens: 64000, effort: 'medium' });

// ---- assemble in the shape of scenes/<slug>.json (same post-processing as build-scenes.js) ------------
const byId = new Map(ATTRIBUTES.map((a) => [a.id, a]));
const valid = data.scenes.filter((s) => cueIndex.has(s.start_cue) && cueIndex.has(s.end_cue) && cueIndex.get(s.start_cue) <= cueIndex.get(s.end_cue));
const scenes = valid.map((s) => {
  const start = cues[cueIndex.get(s.start_cue)];
  const end = cues[cueIndex.get(s.end_cue)];
  const jevBeats = jev ? jev.windows.filter((b) => Math.min(b.endMs, end.endMs) - Math.max(b.startMs, start.startMs) > 0) : [];
  return {
    title: s.title,
    start_ms: start.startMs,
    end_ms: end.endMs,
    start: formatTime(start.startMs),
    end: formatTime(end.endMs),
    start_cue: s.start_cue,
    end_cue: s.end_cue,
    description: s.description,
    severity: { '5-7': s.severity_5_7, '8-10': s.severity_8_10 },
    attributes: s.attributes.map((id) => ({ id, group: byId.get(id).group, label: GROUPS[byId.get(id).group], source: model, screener_probability: jevBeats.length ? +Math.max(...jevBeats.map((b) => b.atoms[id])).toFixed(2) : null, confirmed_by_human: false })),
    keywords: s.keywords.map((k) => k.toLowerCase()),
    text_visibility: s.text_visibility,
    candidate: jev ? candidates.find((k) => cueIndex.get(k.startCue) <= cueIndex.get(s.end_cue) && cueIndex.get(k.endCue) >= cueIndex.get(s.start_cue))?.id ?? null : null,
  };
});
scenes.sort((a, b) => a.start_ms - b.start_ms);
const rated = scenes.filter((s) => s.severity['5-7'] + s.severity['8-10'] > 0); // a 0/0 scene is not a flag
const deduped = rated.filter((s, i) => !rated.slice(0, i).some((p) => Math.min(p.end_ms, s.end_ms) - Math.max(p.start_ms, s.start_ms) > 0.5 * (s.end_ms - s.start_ms)));
deduped.forEach((s, i) => (s.id = `S${String(i + 1).padStart(2, '0')}`));

const cost = costUsd(model, [usage]);
const arm = CHECKLIST ? 'sonnet-checklist' : 'sonnet-alone';
const out = {
  arm,
  film: FILM,
  label: args.label ?? 'r1',
  movie: FILMS[FILM],
  model,
  taxonomy: 'taxonomy-v2',
  prompt: CHECKLIST ? 'build-scenes.js --context whole (whole transcript + Jev checklist)' : 'whole transcript, no Jev input of any kind',
  jev_run: CHECKLIST ? path.basename(args.checklist) : null,
  jev_candidates: CHECKLIST ? candidates.length : null,
  started_at: startedAt,
  wall_s: (Date.now() - Date.parse(startedAt)) / 1000,
  latency_ms: latencyMs,
  usage,
  input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
  output_tokens: usage.output_tokens ?? 0,
  cost_usd: cost,
  returned_scenes: data.scenes.length,
  invalid_cues: data.scenes.length - valid.length,
  dropped_zero_severity: scenes.length - rated.length,
  dropped_duplicate: rated.length - deduped.length,
  scenes: deduped,
};
fs.mkdirSync(path.join(here, 'runs-v3'), { recursive: true });
const file = path.join(here, 'runs-v3', `${arm}-${FILM}${args.label && args.label !== 'r1' ? `-${args.label}` : ''}.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const minutes = deduped.reduce((s, x) => s + (x.end_ms - x.start_ms), 0) / 60000;
console.log(`${arm} ${FILM}${args.label ? ` ${args.label}` : ''}: ${deduped.length} scenes, ${minutes.toFixed(1)} flagged min, $${cost.toFixed(3)}, ${(out.wall_s).toFixed(0)}s -> ${path.relative(here, file)}`);
if (cost > COST_CAP_USD) {
  console.error(`COST CAP EXCEEDED: one run cost $${cost.toFixed(3)} > $${COST_CAP_USD}. Stopping.`);
  process.exit(3);
}
void CONTEXT_LINES;
