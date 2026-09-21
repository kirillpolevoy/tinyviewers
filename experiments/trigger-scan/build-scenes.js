// The product-shaped pipeline: Jev finds candidate scenes, Sonnet labels and describes only those.
// Output is a scene list in the shape of the planned scene database (scenes + attributes per scene).
//
//   node build-scenes.js --from runs/<jev-v3-universal run>.json [--model claude-sonnet-5] [--context whole]
//
// --context stretch (default): one call per flagged stretch, Sonnet sees only that stretch. Cheap per call but it
//   loses the plot: it described the pelican rescue as a shark and the whale swallowing them as a krill swarm.
// --context whole: one call, Sonnet reads the whole transcript and gets Jev's stretches as a checklist.
import fs from 'node:fs';
import path from 'node:path';
import { ATTRIBUTES, GROUPS } from './taxonomy-v2.js';
import { here, loadTrack, loadFilm, glossary, cueLine, parseArgs, pool, saveRun } from './common.js';
import { flaggedCategories } from './events.js';
import { formatTime } from './srt.js';
import { callClaude, costUsd } from './claude.js';

const args = parseArgs();
const model = args.model ?? 'claude-sonnet-5';
const jev = JSON.parse(fs.readFileSync(args.from, 'utf8'));
const FILM = jev.film; // set when the Jev run was made with --film <slug>
const FILMS = JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8'));
const { cues } = FILM ? loadFilm(FILM) : loadTrack(jev.track);
const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
const CONTEXT_LINES = 6;
// --synopsis <json with {plot, cast}>: ground the labeller in an outside plot summary and cast list
// (e.g. Wikipedia), so it knows who and what is on screen when the subtitle lines do not say.
const GROUNDING = args.synopsis ? JSON.parse(fs.readFileSync(args.synopsis, 'utf8')) : null;
const BRIDGE_MS = 20_000;

// ---- 1. candidates: consecutive flagged beats, bridging one short unflagged beat ------------------
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

// ---- 2. Sonnet: confirm, split, bound, label, rate per age band, describe ---------------------------
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

${FILM ? `Film: ${FILMS[FILM].title} (${FILMS[FILM].year})` : `Characters: ${JSON.stringify(glossary.characters)}`}${GROUNDING ? `\n\nPlot summary of the whole film, from an outside source. Use it to identify which moment of the story the lines belong to and who or what is present. Name characters and creatures as the summary and cast list do. Never describe a character, creature or event that neither the lines nor this summary support.\n${GROUNDING.plot}${GROUNDING.cast ? `\n\nCast:\n${GROUNDING.cast}` : ''}` : ''}`;

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

const startedAt = new Date().toISOString();
const WHOLE = args.context === 'whole';
const HAIKU = model.includes('haiku');
const TAG = HAIKU ? 'haiku' : 'sonnet';
const hintsOf = (k) => ATTRIBUTES.map((a) => [a.id, Math.max(...k.beats.map((b) => b.atoms[a.id]))]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]).slice(0, 8);

async function wholeTranscriptPass() {
  const checklist = candidates.map((k) => `${k.id}: ${k.startCue}-${k.endCue} [${formatTime(k.beats[0].startMs)}] guesses: ${hintsOf(k).map(([id, p]) => `${id} ${p.toFixed(2)}`).join(', ') || 'none'}`).join('\n');
  const user = `Full subtitle transcript:\n${cues.map(cueLine).join('\n')}\n\nThe screener flagged these stretches. Go through every one of them and either return the scene(s) in it or leave it out. Then add any scene the screener missed. Use what happens elsewhere in the film to understand each moment correctly (who is speaking, what creature or place this is).\n\n${checklist}`;
  const { data, usage, latencyMs } = await callClaude({ model, system: SYSTEM.replace('A cheap first-pass screener has marked a stretch of lines', 'You are given the whole transcript. A cheap first-pass screener has marked stretches of lines'), user, schema: SCHEMA, maxTokens: 64000, effort: 'medium' });
  const valid = data.scenes.filter((s) => cueIndex.has(s.start_cue) && cueIndex.has(s.end_cue) && cueIndex.get(s.start_cue) <= cueIndex.get(s.end_cue));
  // attach each scene to the candidate it overlaps most, if any, so screener probabilities can be shown
  return [{ usage, latencyMs, whole: true, scenes: valid }];
}

const results = WHOLE ? await wholeTranscriptPass() : await pool(candidates, 4, async (k) => {
  const from = cueIndex.get(k.startCue);
  const to = cueIndex.get(k.endCue);
  const before = cues.slice(Math.max(0, from - CONTEXT_LINES), from);
  const after = cues.slice(to + 1, to + 1 + CONTEXT_LINES);
  const inside = cues.slice(from, to + 1);
  // screener hints: strongest attributes anywhere in the stretch
  const hints = ATTRIBUTES.map((a) => [a.id, Math.max(...k.beats.map((b) => b.atoms[a.id]))]).filter(([, p]) => p >= 0.5).sort((x, y) => y[1] - x[1]).slice(0, 8);
  const user = `Lines just before (context):\n${before.map(cueLine).join('\n') || '(start of film)'}\n\nFLAGGED STRETCH:\n${inside.map(cueLine).join('\n')}\n\nLines just after (context):\n${after.map(cueLine).join('\n') || '(end of film)'}\n\nScreener's guesses (may be wrong): ${hints.map(([id, p]) => `${id} ${p.toFixed(2)}`).join(', ') || 'none'}\n\nA scene may start or end in the context lines if it clearly does.`;
  const { data, usage, latencyMs } = await callClaude({ model, system: SYSTEM, user, schema: SCHEMA, maxTokens: 8000, ...(HAIKU ? {} : { effort: 'low' }) });
  const allowed = new Set([...before, ...inside, ...after].map((c) => c.id));
  return { candidate: k, hints: Object.fromEntries(hints), scenes: data.scenes.filter((s) => allowed.has(s.start_cue) && allowed.has(s.end_cue) && cueIndex.get(s.start_cue) <= cueIndex.get(s.end_cue)), dropped: data.scenes.length, usage, latencyMs };
});

// ---- 3. assemble database-shaped output -------------------------------------------------------------
const byId = new Map(ATTRIBUTES.map((a) => [a.id, a]));
const scenes = [];
for (const r of results) {
  for (const s of r.scenes) {
    const start = cues[cueIndex.get(s.start_cue)];
    const end = cues[cueIndex.get(s.end_cue)];
    const jevBeats = (r.candidate?.beats ?? beats).filter((b) => Math.min(b.endMs, end.endMs) - Math.max(b.startMs, start.startMs) > 0);
    scenes.push({
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
      candidate: r.candidate?.id ?? candidates.find((k) => cueIndex.get(k.startCue) <= cueIndex.get(s.end_cue) && cueIndex.get(k.endCue) >= cueIndex.get(s.start_cue))?.id ?? null,
    });
  }
}
scenes.sort((a, b) => a.start_ms - b.start_ms);
// a scene rated 0 for both ages is not a flag
const notFlagged = scenes.filter((s) => s.severity['5-7'] + s.severity['8-10'] === 0);
for (const s of notFlagged) scenes.splice(scenes.indexOf(s), 1);
// the same moment can come back from two neighbouring candidates via their context lines
const deduped = scenes.filter((s, i) => !scenes.slice(0, i).some((p) => Math.min(p.end_ms, s.end_ms) - Math.max(p.start_ms, s.start_ms) > 0.5 * (s.end_ms - s.start_ms)));
deduped.forEach((s, i) => (s.id = `S${String(i + 1).padStart(2, '0')}`));

const usages = results.map((r) => r.usage);
const out = {
  movie: FILM ? FILMS[FILM] : { title: 'Finding Nemo', year: 2003, imdb_id: 'tt0266543' },
  release: FILM ? { subtitle_track: 'track stored in the app database' } : { subtitle_track: 'Finding.Nemo.2003.Bluray.Original.SDH', note: 'timestamps belong to this release; the track stored in Supabase runs 21.1 s earlier' },
  analysis_run: { started_at: startedAt, detector: jev.model, detector_run: path.basename(args.from), labeller: model, taxonomy: 'taxonomy-v2', candidates: candidates.length, context: WHOLE ? 'whole transcript' : 'flagged stretch only', rejected_candidates: candidates.filter((k) => !scenes.some((s) => s.candidate === k.id)).map((k) => `${k.id} ${formatTime(k.beats[0].startMs)}`), scenes_the_screener_missed: scenes.filter((s) => !s.candidate).map((s) => s.title), cost_usd: { detector: jev.costUsd, labeller: costUsd(model, usages) }, wall_s: (Date.now() - Date.parse(startedAt)) / 1000 },
  scenes: deduped,
};
if (FILM) fs.mkdirSync(path.join(here, 'scenes'), { recursive: true });
fs.writeFileSync(FILM ? path.join(here, 'scenes', `${FILM}${HAIKU ? '.haiku' : ''}.json`) : path.join(here, `scenes.nemo${WHOLE ? '' : '.stretch-only'}${HAIKU ? '.haiku' : ''}${GROUNDING ? '.grounded' : ''}.json`), JSON.stringify(out, null, 2));

// also save in the experiment's run format so compare.js can score it against the reference list
const legacyOf = (attrs) => [...new Set(attrs.map((a) => byId.get(a.id).legacy))];
saveRun({
  film: FILM,
  arm: (WHOLE ? `jev-checklist+${TAG}-whole` : `jev-finds+${TAG}-labels`) + (GROUNDING ? '+grounded' : ''), track: jev.track, model, from: args.from, startedAt, wallMs: Date.now() - Date.parse(startedAt), calls: results.length,
  inputTokens: usages.reduce((s, u) => s + (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), 0), outputTokens: usages.reduce((s, u) => s + u.output_tokens, 0), costUsd: costUsd(model, usages),
  events: deduped.map((s) => ({ id: s.id, title: s.title, start_cue: s.start_cue, end_cue: s.end_cue, validCues: true, startMs: s.start_ms, endMs: s.end_ms, categories: legacyOf(s.attributes), severity: Math.max(s.severity['5-7'], s.severity['8-10']), evidence_cues: [] })),
}, FILM ? 'runs-films' : 'runs');
console.log(`${candidates.length} candidates -> ${deduped.length} scenes (${out.analysis_run.rejected_candidates.length} candidates rejected) | labeller $${out.analysis_run.cost_usd.labeller.toFixed(3)}, ${out.analysis_run.wall_s.toFixed(0)} s | cache read tokens ${usages.reduce((s, u) => s + (u.cache_read_input_tokens ?? 0), 0)}`);
