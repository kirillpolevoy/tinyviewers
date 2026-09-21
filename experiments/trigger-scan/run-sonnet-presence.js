// Presence labels (taxonomy-v3 Layer A) from Claude, one call per SCENE.
//
//   node run-sonnet-presence.js --film nemo
//   node run-sonnet-presence.js --all
//   node run-sonnet-presence.js --all --dry-run     # print the prompts and the cost estimate, call nothing
//
// Why this exists: rolling Jev's per-beat maximum up to a scene accumulates its false positives. On
// Finding Nemo that made the barracuda, the divers and the pelican all "shark", the minefield and the
// anglerfish "clown_doll_puppet", and Darla "reanimated_dead". Jev answers a narrow question about 8
// subtitle lines; a scene is 20-200 lines and a parent's question is about the scene.
//
// This asks one model, once per scene, about the whole scene with context either side, and separates
// what the LINES show from what the model KNOWS about the film, because only the first is evidence
// from our own data.
//
// Writes runs-v3/sonnet-presence-<slug>.json. Reads the same scene lists scene-api/load.js reads.
// Does not edit or write any other file.
import fs from 'node:fs';
import path from 'node:path';
import { PRESENCE, PRESENT_YES, PRESENT_NO } from './taxonomy-v3.js';
import { here, loadFilm, cueLine, parseArgs, pool } from './common.js';
import { callClaude, costUsd } from './claude.js';

const args = parseArgs();
const MODEL = args.model ?? 'claude-sonnet-5';
const CONTEXT_LINES = 6;
const CONCURRENCY = 5;
const COST_CAP_USD = 3.0;          // hard stop, as instructed
const COST_TARGET_USD = 1.5;       // expected

const FILMS = JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8'));
const SLUGS = args.all ? Object.keys(FILMS) : [args.film ?? 'nemo'];

// The same scene lists scene-api/load.js uses.
function sceneFileFor(slug) {
  return slug === 'nemo'
    ? path.join(here, 'scenes.nemo.grounded.json')
    : path.join(here, 'runs-v3', `sonnet-alone-${slug}.json`);
}

// ---------------------------------------------------------------------------------------------
// System prompt: the 29 presence items, once, cached.
// ---------------------------------------------------------------------------------------------

// taxonomy-v3 builds `no` as `${PRESENT_NO} ${noExtra}`. The shared half is stated once below, so
// only the item-specific half is repeated per item.
const extraNo = (item) => (item.no ?? '').replace(PRESENT_NO, '').trim();

// `noun` reads well inside a list; the three items with a custom question do not have one.
const describe = (item) => (item.noun ?? item.question.replace(/^In P,\s*/, '').replace(/\?$/, ''));

const VOCAB = PRESENCE.map((item) => {
  const lines = [`- ${item.id} — ${item.label}: ${describe(item)}.`];
  const no = extraNo(item);
  if (no) lines.push(`    Not: ${no}`);
  if (item.textBlind) lines.push('    (Subtitles rarely show this one. Use what you know about the film and say known_from_film.)');
  return lines.join('\n');
}).join('\n');

const SYSTEM_BASE = `You label one scene of a children's film for a database that parents of 5 to 10 year-olds use to filter scenes by what frightens their own child. Your job here is ONE layer only: what is PRESENT in the scene. Not how bad it is, not what happens to the characters — just what is there.

WHAT "PRESENT" MEANS
${PRESENT_YES}
${PRESENT_NO}
Imagined, dreamed, remembered-as-a-flashback and pretended count as present if a child watching sees them on screen. Something a character merely names, warns about, plans around, or compares to, while it is not there, is NOT present — put it in talked_about_only instead.

EVIDENCE: two kinds, and you must keep them apart
- "stated_in_lines": the subtitle lines you were given show it. Somebody names it, speaks as it, or the characters plainly react to it in the dialogue or in a (SOUND CAPTION).
- "known_from_film": it is on screen in this scene and you know that from knowing the film, but these lines do not show it. The anglerfish in Finding Nemo is the example: almost nothing is said, and the creature is still there.
Use "known_from_film" only when you are confident the moment is the one you are thinking of, judging by the scene title, the lines and where it falls. If you are unsure, leave the item out. Never guess an item into the list to be safe: a wrong label sends a parent to the wrong minute of the film.

RULES THAT CATCH THE MISTAKES WE KEEP SEEING
- A fish or other sea animal that hunts, chases, or attacks is large_predator — a barracuda, an eel, a giant squid, an anglerfish, a killer whale. It is NOT monster_creature and it is certainly not shark.
- NEVER use shark unless the creature is actually a shark. Not "a big scary fish". Not a whale.
- monster_creature is a frightening creature that is neither an ordinary animal nor a person. An animal is not a monster however dangerous it is, and however much it talks. A robot is not a monster.
- Friendly, comic and heroic instances count. In Monsters, Inc. nearly every character is a monster, so nearly every scene has monster_creature present.
- Do not label a character's name: a character called Boo is not a ghost; a character nicknamed after an animal is not that animal.
- If the scene has nothing from the list in it, return empty lists. That is a normal answer.

THE ITEMS (use these ids and no others)
${VOCAB}`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const IDS = PRESENCE.map((p) => p.id);
const SCHEMA = obj({
  present: {
    type: 'array',
    description: 'Everything from the list that is there in the scene.',
    items: obj({
      id: { type: 'string', enum: IDS },
      confidence: { type: 'string', enum: ['stated_in_lines', 'known_from_film'] },
    }),
  },
  talked_about_only: {
    type: 'array',
    description: 'Items the dialogue brings up while they are NOT there in the scene.',
    items: { type: 'string', enum: IDS },
  },
});

// ---------------------------------------------------------------------------------------------
// Per film
// ---------------------------------------------------------------------------------------------

function filmSystem(slug) {
  const meta = FILMS[slug];
  let out = `${SYSTEM_BASE}\n\nTHE FILM: ${meta.title}${meta.year ? ` (${meta.year})` : ''}`;
  const contextFile = path.join(here, 'data', `${slug}.context.json`);
  if (fs.existsSync(contextFile)) {
    const ctx = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
    out += `\n\nOUTSIDE PLOT SUMMARY (${ctx.source ?? 'external'}). Use it to recognise which moment a scene is, and to answer known_from_film. It is about the whole film, so never label something from it that does not belong to THIS scene.\n${ctx.plot}`;
    if (ctx.cast) out += `\n\nVOICE CAST\n${ctx.cast}`;
  }
  return out;
}

function userFor(scene, cues, cueIndex) {
  const a = cueIndex.get(scene.start_cue);
  const b = cueIndex.get(scene.end_cue);
  const before = cues.slice(Math.max(0, a - CONTEXT_LINES), a).map(cueLine);
  const body = cues.slice(a, b + 1).map(cueLine);
  const after = cues.slice(b + 1, b + 1 + CONTEXT_LINES).map(cueLine);
  return [
    `SCENE: ${scene.title}`,
    `Lines ${scene.start_cue} to ${scene.end_cue}.`,
    '',
    ...(before.length ? ['--- the lines just before, for context only ---', ...before, ''] : []),
    '--- the scene ---',
    ...body,
    ...(after.length ? ['', '--- the lines just after, for context only ---', ...after] : []),
    '',
    'What from the list is present in the scene (not in the context lines)?',
  ].join('\n');
}

async function runFilm(slug, budget) {
  const sceneFile = sceneFileFor(slug);
  if (!fs.existsSync(sceneFile)) throw new Error(`missing scene file ${sceneFile}`);
  const scenes = JSON.parse(fs.readFileSync(sceneFile, 'utf8')).scenes;
  const { cues } = loadFilm(slug);
  const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
  const system = filmSystem(slug);

  const usable = scenes.filter((s) => cueIndex.has(s.start_cue) && cueIndex.has(s.end_cue));
  if (usable.length !== scenes.length) {
    console.log(`  ${scenes.length - usable.length} scene(s) skipped: cues not in the track`);
  }
  if (!usable.length) {
    console.error(`${slug}: no scene in ${path.relative(here, sceneFile)} has cues that exist in the track; nothing to ask about.`);
    return null;
  }

  const usages = [];
  const started = Date.now();
  // The cap is checked here, inside the worker, so a run stops part-way through a film instead of
  // only between films. `pool` keeps calling the worker; once `stopped` is set it returns at once.
  let stopped = null;
  const spentSoFar = () => budget.spent + costUsd(MODEL, usages);
  const ask = async (scene) => {
    if (stopped) return null;
    if (spentSoFar() > COST_CAP_USD) {
      stopped ??= `cost cap $${COST_CAP_USD} reached at $${spentSoFar().toFixed(4)}`;
      return null;
    }
    const { data, usage, latencyMs } = await callClaude({
      model: MODEL, system, user: userFor(scene, cues, cueIndex), schema: SCHEMA, maxTokens: 4000, effort: 'low',
    });
    usages.push(usage);
    return {
      id: scene.id,
      title: scene.title,
      start_cue: scene.start_cue,
      end_cue: scene.end_cue,
      start_ms: scene.start_ms,
      end_ms: scene.end_ms,
      present: data.present ?? [],
      talked_about_only: data.talked_about_only ?? [],
      latency_ms: latencyMs,
    };
  };

  // One call first so the system prompt is written to the cache once instead of CONCURRENCY times.
  const first = await ask(usable[0]);
  const rest = await pool(usable.slice(1), CONCURRENCY, ask);
  const out = [first, ...rest].filter(Boolean);
  if (stopped) {
    console.error(`STOPPING mid-film: ${stopped}. ${slug} has ${out.length} of ${usable.length} scenes; the file written is incomplete.`);
  }
  if (!out.length) return null;

  const cost = costUsd(MODEL, usages);
  budget.spent += cost;
  const run = {
    arm: 'sonnet-presence',
    film: slug,
    track: slug,
    taxonomy: 'v3',
    layer: 'presence',
    model: MODEL,
    prompt: 'one call per scene; scene lines + 6 context lines each side; outside plot summary where one exists',
    context_lines: CONTEXT_LINES,
    startedAt: new Date(started).toISOString(),
    wall_s: (Date.now() - started) / 1000,
    scenes_asked: out.length,
    input_tokens: usages.reduce((n, u) => n + (u.input_tokens ?? 0), 0),
    cache_creation_input_tokens: usages.reduce((n, u) => n + (u.cache_creation_input_tokens ?? 0), 0),
    cache_read_input_tokens: usages.reduce((n, u) => n + (u.cache_read_input_tokens ?? 0), 0),
    output_tokens: usages.reduce((n, u) => n + (u.output_tokens ?? 0), 0),
    cost_usd: cost,
    scenes: out.sort((x, y) => x.start_ms - y.start_ms),
  };
  const file = path.join(here, 'runs-v3', `sonnet-presence-${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(run, null, 2));
  return { run, file };
}

// ---------------------------------------------------------------------------------------------

if (args['dry-run']) {
  const slug = SLUGS[0];
  const system = filmSystem(slug);
  const scenes = JSON.parse(fs.readFileSync(sceneFileFor(slug), 'utf8')).scenes;
  const { cues } = loadFilm(slug);
  const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
  console.log('=== SYSTEM ===\n');
  console.log(system);
  console.log('\n=== USER (first scene) ===\n');
  console.log(userFor(scenes[0], cues, cueIndex));
  const est = (s) => Math.ceil(s.length / 3.6);
  let total = 0;
  for (const s of SLUGS) {
    const n = JSON.parse(fs.readFileSync(sceneFileFor(s), 'utf8')).scenes.length;
    const sys = est(filmSystem(s));
    total += (sys * 1.25 * 2 + (n - 1) * sys * 0.2 + n * 400 * 2 + n * 120 * 10) / 1e6;
  }
  console.log(`\n=== estimate: $${total.toFixed(3)} for ${SLUGS.join(', ')} (cap $${COST_CAP_USD}) ===`);
  process.exit(0);
}

const budget = { spent: 0 };
for (const slug of SLUGS) {
  if (budget.spent > COST_CAP_USD) {
    console.error(`STOPPING: spent $${budget.spent.toFixed(3)}, over the $${COST_CAP_USD} cap. ${slug} and later films were not run.`);
    process.exit(1);
  }
  const result = await runFilm(slug, budget);
  if (!result) continue; // nothing to ask about, or the cap stopped it; runFilm said why
  const { run, file } = result;
  const stated = run.scenes.reduce((n, s) => n + s.present.filter((p) => p.confidence === 'stated_in_lines').length, 0);
  const known = run.scenes.reduce((n, s) => n + s.present.filter((p) => p.confidence === 'known_from_film').length, 0);
  const mentions = run.scenes.reduce((n, s) => n + s.talked_about_only.length, 0);
  console.log(`${slug.padEnd(14)} ${String(run.scenes_asked).padStart(3)} scenes  present ${String(stated + known).padStart(3)} (${stated} from the lines, ${known} from knowing the film)  talked-about ${String(mentions).padStart(3)}  $${run.cost_usd.toFixed(4)}  ${run.wall_s.toFixed(0)}s  -> ${path.relative(here, file)}`);
}
console.log(`\ntotal $${budget.spent.toFixed(4)} (target about $${COST_TARGET_USD}, cap $${COST_CAP_USD})`);
