// COPY of the `--alone` arm of experiments/trigger-scan/run-sonnet-alone.js as of commit 5fe8fb5:
// one Sonnet call over the whole cue-tagged transcript, returning every scene a parent of a 5-10
// year-old would want flagged.
//
// What did NOT come across, and why:
//   - the `--checklist` arm. It feeds Jev's flagged stretches to Sonnet as hints; the films in this
//     database were built with the alone arm, so a live film must be built the same way or its
//     scene list is not comparable with theirs.
//   - the second run (`--label r2`). One run is what `confirmed_by_second_run` is measured against,
//     and a live film simply has no second run: its scenes carry null, which the API already means
//     "no second pass exists for this film".
// VOCAB, SYSTEM, ALONE_SYSTEM, SCHEMA and the post-processing are byte-identical, and so are the
// model, the medium effort and the streaming call underneath.
//
// Two deliberate differences. The script asks for 64k output tokens and this asks for 16k, and the
// cost cap it exports is enforced rather than decorative: see MAX_OUTPUT_TOKENS below. A scene list
// for a whole film is about 10k output tokens, so the ceiling the script used was never a ceiling on
// anything; here it has to fit inside a cap that the daily budget's reserve is built on. And the
// titles and descriptions that come back are checked against the transcript before they are
// returned, because nothing checks a live film after the fact the way test/load.test.js checks the
// six loaded ones. See the quotation rule near the bottom.
import { ATTRIBUTES, GROUPS } from './taxonomy-v2.js';
import { formatTime } from './srt.js';
import { fail } from './errors.js';
import { callClaude, costUsd, worstCaseUsd, PRICES } from './claude.js';
import { transcriptShingles, quotedRun, QUOTE_RUN } from './quotes.js';

export const MODEL = 'claude-sonnet-5';

/**
 * The most this one call may cost, and the output ceiling that keeps it under that.
 *
 * At Sonnet's $2/$10 per Mtok, 16k output tokens is $0.16, which leaves $0.44 — 220k input tokens —
 * for the transcript. A feature's subtitles are 15-25k tokens (33k at the deliberately pessimistic
 * 3 chars/token this refusal counts with), so a normal film uses about a fifth of the cap and no
 * film this pipeline can analyse (the subtitle stage needs >= 300 cues, and a 4-hour track is still
 * under 80k tokens) comes close to it. A transcript that somehow would is refused before the call
 * rather than after the bill, because `scenes_cap` is a sentence someone can act on and a surprise
 * $3 is not.
 */
export const COST_CAP_USD = 0.6;
export const MAX_OUTPUT_TOKENS = 16000;

const cueLine = (c) => `${c.id} [${formatTime(c.startMs)}] ${c.text}`;

// ---------------------------------------------------------------------------------------------------
// VOCAB / SYSTEM / SCHEMA below are copied verbatim from build-scenes.js (lines 42-84, 2026-09-20) so
// that this baseline has exactly the same rules, attribute vocabulary and JSON schema as the pipeline.
// ---------------------------------------------------------------------------------------------------
const VOCAB = Object.entries(GROUPS)
  .map(([g, label]) => `${label}:\n${ATTRIBUTES.filter((a) => a.group === g).map((a) => `  - ${a.id}: ${a.question.replace(/^In P, /, '').replace(/ in P\b/, '')}`).join('\n')}`)
  .join('\n');

const systemFor = (title, year) => `You prepare entries for a database of movie scenes that parents of 5 to 10 year-olds filter by what frightens or upsets their own child. You work from subtitle lines only. Each line is "<cue id> [<time>] <text>"; text in (PARENTHESES) is a sound caption.

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

Film: ${title} (${year})`;

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
export const aloneSystem = (title, year) => systemFor(title, year)
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

/**
 * One whole-transcript Sonnet pass.
 *
 * @param {object} opts
 * @param {{slug: string, title: string, year: number|null}} opts.film
 * @param {Array} opts.cues parsed cues, from srt.js parseSrt
 * @param {(usd: number) => void} [opts.onSpend] called once with what the call cost, the moment it
 *   returns. The orchestrator banks money as it is incurred rather than when a stage ends, so a run
 *   killed part-way through still counts against the day.
 * @returns {Promise<object>} the content of runs-v3/sonnet-alone-<slug>.json, which is what the
 *   loader reads as a film's scene list.
 * @throws {PipelineError} `scenes_cap` when this film's transcript cannot be read inside the cap.
 */
export async function findScenes({
  film, cues, model = MODEL, prices = PRICES[model], apiKey, fetchImpl, onSpend, signal,
  costCapUsd = COST_CAP_USD, maxTokens = MAX_OUTPUT_TOKENS,
} = {}) {
  const cueIndex = new Map(cues.map((c, i) => [c.id, i]));
  const transcript = cues.map(cueLine).join('\n');
  const system = aloneSystem(film.title, film.year);
  const user = `Full subtitle transcript:\n${transcript}\n\nGo through the whole film from start to finish and return every scene a parent of a 5-10 year-old would want flagged. Use what happens elsewhere in the film to understand each moment correctly (who is speaking, what creature or place this is).`;

  // Worst case, before anything is sent: the whole prompt as fresh input plus a full output buffer.
  // One call, so this reservation is the whole of this stage's budget arithmetic.
  const worst = worstCaseUsd({ system, user, maxTokens, prices });
  if (worst > costCapUsd) {
    throw fail('scenes_cap', `This film's subtitles are too long to read in one pass inside the $${costCapUsd} cap for this step (it would cost up to $${worst.toFixed(2)}).`);
  }

  const startedAt = new Date().toISOString();
  const { data, usage, latencyMs } = await callClaude({
    model, system, user, schema: SCHEMA, maxTokens, effort: 'medium',
    apiKey, fetchImpl, signal,
    // Banked as the response lands, not after it parses: a truncated or unparseable answer to a
    // 25k-token prompt costs the same as a good one.
    onUsage: (u) => onSpend?.(costUsd(model, [u], prices)),
  });

  // ---- assemble in the shape of scenes/<slug>.json (same post-processing as build-scenes.js) --------
  const byId = new Map(ATTRIBUTES.map((a) => [a.id, a]));
  const valid = data.scenes.filter((s) => cueIndex.has(s.start_cue) && cueIndex.has(s.end_cue) && cueIndex.get(s.start_cue) <= cueIndex.get(s.end_cue));
  const scenes = valid.map((s) => {
    const start = cues[cueIndex.get(s.start_cue)];
    const end = cues[cueIndex.get(s.end_cue)];
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
      attributes: s.attributes.map((id) => ({ id, group: byId.get(id).group, label: GROUPS[byId.get(id).group], source: model, screener_probability: null, confirmed_by_human: false })),
      keywords: s.keywords.map((k) => k.toLowerCase()),
      text_visibility: s.text_visibility,
      candidate: null,
    };
  });
  scenes.sort((a, b) => a.start_ms - b.start_ms);
  const rated = scenes.filter((s) => s.severity['5-7'] + s.severity['8-10'] > 0); // a 0/0 scene is not a flag
  const deduped = rated.filter((s, i) => !rated.slice(0, i).some((p) => Math.min(p.end_ms, s.end_ms) - Math.max(p.start_ms, s.start_ms) > 0.5 * (s.end_ms - s.start_ms)));

  // ---- the subtitle-storage policy, applied to text this model has just written ---------------
  // Nothing checks a live film after the fact the way test/load.test.js checks the six loaded ones,
  // so the same eight-word rule runs here, between the answer and the row. A quoting description is
  // dropped rather than failing the whole run: the scene, its time range and its labels are still
  // worth having. A quoting TITLE takes the scene with it — `scenes.title` is not null, and writing
  // an invented title in place of a quoted one would be worse than not having the scene.
  const fromFilm = transcriptShingles(cues);
  let redactedDescriptions = 0;
  const clean = deduped.filter((s) => {
    if (quotedRun(s.title, fromFilm)) return false;
    if (s.description && quotedRun(s.description, fromFilm)) {
      s.description = null;
      redactedDescriptions += 1;
    }
    return true;
  });
  clean.forEach((s, i) => (s.id = `S${String(i + 1).padStart(2, '0')}`));

  const cost = costUsd(model, [usage], prices);
  return {
    arm: 'sonnet-alone',
    film: film.slug,
    label: 'r1',
    movie: { title: film.title, year: film.year, imdb_id: film.imdb_id ?? null },
    model,
    taxonomy: 'taxonomy-v2',
    prompt: 'whole transcript, no Jev input of any kind',
    jev_run: null,
    jev_candidates: null,
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
    dropped_quoting_title: deduped.length - clean.length,
    redacted_descriptions: redactedDescriptions,
    quote_rule: `${QUOTE_RUN} consecutive words in common with one subtitle line`,
    scenes: clean,
  };
}
