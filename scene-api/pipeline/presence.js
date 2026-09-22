// COPY of experiments/trigger-scan/run-sonnet-presence.js as of commit 5fe8fb5: presence labels
// (taxonomy-v3 Layer A) from Claude, one call per SCENE.
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
// Differences from the script: it takes the scene list and the cues as values and returns the run
// instead of reading and writing runs-v3/, and there is no `data/<slug>.context.json` to fold into
// the system prompt — a film being added live has no hand-written outside plot summary, so the model
// answers known_from_film from its own knowledge alone. The cost cap is a real ceiling rather than a
// number to print: each call reserves its worst case before it goes out, and each response is
// charged against the day as it lands. SYSTEM_BASE, the item list, the schema, the per-scene user
// message, the model, the 6 context lines and the concurrency of 5 are unchanged.
import { PRESENCE, PRESENT_YES, PRESENT_NO } from './taxonomy-v3.js';
import { formatTime } from './srt.js';
import { pool } from './net.js';
import { callClaude, costUsd, worstCaseUsd, PRICES } from './claude.js';
import { budget } from './budget.js';

export const MODEL = 'claude-sonnet-5';
export const CONTEXT_LINES = 6;
export const CONCURRENCY = 5;
export const MAX_OUTPUT_TOKENS = 4000;

/**
 * The script's cap was $3.00, which for this stage is not a cap: a real film spends $0.05-$0.06
 * here (Gruffalo and Room on the Broom, measured live; the six-film experiment agrees), so $3 would
 * only ever have stopped a bug, and it would have let that bug spend fifty films' worth first. At
 * $1.00 a pathological film — hundreds of scenes, a huge track — still finishes, and the daily
 * budget's reserve in lib/jobs.js can be built out of a number that means something.
 */
export const COST_CAP_USD = 1.0;

const cueLine = (c) => `${c.id} [${formatTime(c.startMs)}] ${c.text}`;

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

export const filmSystem = (title, year) => `${SYSTEM_BASE}\n\nTHE FILM: ${title}${year ? ` (${year})` : ''}`;

export function userFor(scene, cues, cueIndex) {
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

/**
 * One Claude call per scene.
 *
 * @param {(usd: number) => void} [opts.onSpend] called after every priced call with what that one
 *   call cost. This stage makes one call per scene over a couple of minutes and a 400 on any of
 *   them throws out of the whole stage, so waiting until the stage ends to record the money means
 *   losing all of it — and the daily cap then admits runs as though the day were free.
 * @returns {Promise<object|null>} the content of runs-v3/sonnet-presence-<slug>.json, or null when
 *   no scene has cues that exist in the track (there is nothing to ask about). `stopped` on the
 *   returned run says so when the cost cap cut the film short, exactly as the script's stderr does.
 */
export async function labelPresence({
  film, cues, scenes, model = MODEL, prices = PRICES[model], apiKey, fetchImpl, onSpend,
  concurrency = CONCURRENCY, costCapUsd = COST_CAP_USD, maxTokens = MAX_OUTPUT_TOKENS,
} = {}) {
  const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
  const system = filmSystem(film.title, film.year);
  const usable = scenes.filter((s) => cueIndex.has(s.start_cue) && cueIndex.has(s.end_cue));
  if (!usable.length) return null;

  const usages = [];
  const started = Date.now();
  // The cap is enforced here, inside the worker, so a run stops part-way through a film instead of
  // only between films. `pool` keeps calling the worker; once `stopped` is set it returns at once.
  //
  // The worst case is RESERVED before the call goes out and settled against the real bill when it
  // comes back. Checking completed spending instead let five workers each see the same figure under
  // the cap and all five dispatch — which is how a $1.00 cap finished a film at $1.176.
  let stopped = null;
  const ledger = budget(costCapUsd);

  const sceneResult = (scene, { data, latencyMs }) => ({
    id: scene.id,
    title: scene.title,
    start_cue: scene.start_cue,
    end_cue: scene.end_cue,
    start_ms: scene.start_ms,
    end_ms: scene.end_ms,
    present: data.present ?? [],
    talked_about_only: data.talked_about_only ?? [],
    latency_ms: latencyMs,
  });

  const ask = async (scene, _i, signal) => {
    if (stopped) return null;
    const user = userFor(scene, cues, cueIndex);
    const worst = worstCaseUsd({ system, user, maxTokens, prices });
    if (!ledger.reserve(worst)) {
      stopped ??= `cost cap $${costCapUsd} reached at $${ledger.spent.toFixed(4)} spent with $${ledger.reserved.toFixed(4)} in flight`;
      return null;
    }
    let usage = null;
    try {
      const answer = await callClaude({
        model, system, user, schema: SCHEMA, maxTokens, effort: 'low',
        apiKey, fetchImpl, signal,
        // Banked as each response lands. A stage that makes thirty calls and then takes a 400 used
        // to record nothing at all, and the daily cap then admitted the next run as though the day
        // had been free.
        onUsage: (u) => {
          usage = u;
          usages.push(u);
          onSpend?.(costUsd(model, [u], prices));
        },
      });
      return sceneResult(scene, answer);
    } finally {
      ledger.settle(worst, usage ? costUsd(model, [usage], prices) : 0);
    }
  };

  // One call first so the system prompt is written to the cache once instead of CONCURRENCY times.
  const first = await ask(usable[0]);
  const rest = await pool(usable.slice(1), concurrency, ask);
  const out = [first, ...rest].filter(Boolean);
  if (!out.length) return null;

  return {
    arm: 'sonnet-presence',
    film: film.slug,
    track: film.slug,
    taxonomy: 'v3',
    layer: 'presence',
    model,
    prompt: 'one call per scene; scene lines + 6 context lines each side; no outside plot summary (a film added live has none)',
    context_lines: CONTEXT_LINES,
    startedAt: new Date(started).toISOString(),
    wall_s: (Date.now() - started) / 1000,
    scenes_asked: out.length,
    scenes_skipped: usable.length - out.length,
    stopped,
    input_tokens: usages.reduce((n, u) => n + (u.input_tokens ?? 0), 0),
    cache_creation_input_tokens: usages.reduce((n, u) => n + (u.cache_creation_input_tokens ?? 0), 0),
    cache_read_input_tokens: usages.reduce((n, u) => n + (u.cache_read_input_tokens ?? 0), 0),
    output_tokens: usages.reduce((n, u) => n + (u.output_tokens ?? 0), 0),
    cost_usd: costUsd(model, usages, prices),
    scenes: out.sort((x, y) => x.start_ms - y.start_ms),
  };
}
