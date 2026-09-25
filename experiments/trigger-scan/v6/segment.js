#!/usr/bin/env node
// v6 step 1: split the WHOLE film into all its scenes, from VERIFIED SOURCES ONLY, with a cited
// neutral summary per scene, a cited cast (now with cited aliases) and the film's recurring dangers.
//
// Prompt v6 (round-1 finding (g), segmentation merged distinct beats: MI S035 blizzard + a comic gag +
// Boo in the extractor; the Nemo barracuda attack inside the flashback scene):
//   - a new scene at a change of PLACE or of WHO IS IN DANGER, and at the onset of a danger;
//   - never an unrelated comic beat in the same scene as a danger beat;
//   - flashbacks, dreams and stories told kept apart from present action;
//   - aliases are cited (checked at the claim check like any other claim); descriptions are not names;
//   - the plot's danger verbs (attacks, kills, mauls) are kept, not softened;
//   - no example in the prompt comes from a test film (round-1 verifier: the v5 prompt carried
//     Nemo / Monsters, Inc. phrases).
//   Default effort is 'low': at 'medium' a long film can need more output (thinking + JSON) than the
//   $0.45 cap leaves, and a max_tokens stop is billed in full.
//
//   node segment.js <slug> [--cap 0.45] [--dry] [--offline]   (--offline: skip the free token count)
//
// The model gets exactly three sources and is told to use nothing else, never its own memory of the
// film: (1) the numbered subtitle lines L1..Ln, (2) the numbered Wikipedia plot sentences W1..Wn,
// (3) the numbered TMDB cast T1..Tn (sources/<slug>.json from sources.js). Every summary sentence,
// cast field and danger must cite ids; code enforces it:
//   - cite ids must exist; a scene sentence may cite only lines inside its own scene (plus W/T ids)
//   - a scene sentence left with no valid cite is dropped (counted); a cast field left with no valid
//     cite becomes 'unknown' (counted); a cast member with no cite for the name and no TMDB entry is
//     dropped; a danger with no valid cite is dropped
//   - coverage: scenes contiguous, every cue exactly once (v4's deterministic repair, every repair recorded)
//   - lengths: sentence <= 25 words, setting <= 6, notes <= 12 (trimmed and counted)
//   - quotation: no run of more than 8 consecutive transcript words in any stored model text
//   - neutrality: judgement words flagged per sentence (check-claims.js keeps them out of the summary)
//   - how spread each Wikipedia sentence is across scenes is logged
// The per-scene `summary` written here is provisional (all surviving sentences); check-claims.js
// rebuilds it from the sentences Jev verifies.
//
// Writes out/<slug>.segments.json (git-ignored). On failure writes out/<slug>.segments.error.json with
// what was spent. Hard cap: the worst-case cost of the call is reserved before it is sent.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { V6, TS, outDir as OUT_DIR, sourcesFile, heldOutGate } from './env.js';
import { spentSoFar, record } from './ledger.js';
import { repairCoverage, assertCoverage, clampWords, wordCount, transcriptGrams, enforceQuoteRule, judgementWords } from './validate.js';
import { checkCites, sourcesOf, gateCastMember, wikiSpread, CAST_KINDS, TRI, DISPOSITIONS, DANGER_KINDS, GROUPS } from './cite.js';

const MODEL = 'claude-sonnet-5';
// v5.0: first verified-sources prompt (Nemo run). v5.1 adds CITATION DISCIPLINE after the Nemo claim
// check showed most unverified sentences added uncited detail ("distraught", "white boat", "huge",
// "along with krill") or cited 2-3 lines for a longer exchange, 5 W-sentences went uncited (one was
// the whale swallowing them), and kind 'child' was given to a young fish.
const PROMPT_VERSIONS = { v6: 'segment-v6.0-beats-and-cited-aliases' };

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
if (!slug) { console.error('usage: node segment.js <slug> [--cap 0.45] [--effort medium] [--dry]'); process.exit(2); }
// --final-held-out-run: the one-time final run on a held-out film, after all code is frozen.
heldOutGate(slug);
const CAP = Number(opt('cap', '0.45'));
const EFFORT = opt('effort', 'low');
const PROMPT = opt('prompt', 'v6');
if (!PROMPT_VERSIONS[PROMPT]) throw new Error(`--prompt must be one of ${Object.keys(PROMPT_VERSIONS).join(', ')}`);
const PROMPT_VERSION = PROMPT_VERSIONS[PROMPT];
if (!(CAP > 0)) throw new Error('--cap must be a positive dollar amount');

// ---- sources ----------------------------------------------------------------------------------------
const srcFile = sourcesFile(slug);
if (!fs.existsSync(srcFile)) throw new Error(`no ${path.relative(V6, srcFile)}; run node sources.js ${slug} first`);
const SRC = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
const film = SRC.film;
const W = SRC.wikipedia.sentences;
const T = SRC.tmdb.cast;

const srtPath = path.join(TS, 'data', `${slug}.srt`);
const srtText = fs.readFileSync(srtPath, 'utf8');
const cues = parseSrt(srtText);
const N = cues.length;
const ctx = { nCues: N, wCount: W.length, tCount: T.length };

// ---- prompt -----------------------------------------------------------------------------------------
const SYSTEM = `You split a feature film into its scenes for a reference database that parents use to decide which scenes to skip. You work ONLY from three numbered sources given to you:
  L-lines: the film's subtitle lines, "L<cue> [<time>] <text>". Text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics.
  W-sentences: the plot section of the film's English Wikipedia article, "W<n> <sentence>".
  T-entries: the film's TMDB cast list, "T<n> <character name>".

THE SOURCE RULE. Use only what these sources say. Do NOT use your own knowledge or memory of this film, even if you are sure of it: no event, appearance, age, species, relationship, name or outcome that the sources do not state or directly imply. Every fact you write must cite the ids that support it (for example ["L412","L415"], ["W7"], ["T3"]). If no source supports something, leave it out, or write "unknown" where a field asks for a value. An omitted or "unknown" fact is always better than a guessed one. Code checks every citation against the cited text and discards what the text does not support.

What counts as support: the cited text states it, or it follows directly from it (a line "Tom! Where are you?" supports "someone calls for Tom"; it does not support "Tom's mother panics"). Subtitle lines rarely name the speaker: say who speaks only when the lines or the W-sentences make it clear. Sound captions such as "(DOG BARKING)" are evidence of what is heard.

Return three things.

1. cast: the characters who matter in the story (named ones, and important unnamed ones the sources mention, e.g. "the guards"). For each:
- name: as the sources call them. tmdb: the T id of their TMDB entry, or "" if none.
- aliases: other NAMES the sources use for this same character (a full name, a nickname), each as {"name", "cites"} where cites are the ids in which that name is used for this character. A description is not a name: never give "the kid", "the girl", "the king", "your majesty", "that thing" or similar as an alias. An alias without a cite is thrown away.
- kind: person (a grown-up human or human-like being), child (a human child), animal (a real animal species, talking or not), creature (a monster or fantasy being), robot, other, or unknown.
- is_child: "true" if the sources show they are a child or young (e.g. called a kid, a son or daughter, a toddler, a cub), "false" if they show an adult, else "unknown".
- looks_frightening: "true" only if the sources describe their appearance as frightening (e.g. a sound caption of a roar at someone, a character screaming at the sight of them, a line calling them a monster), "false" if the sources describe them as harmless-looking, else "unknown".
- disposition: villain (works against the heroes throughout), threat (dangerous in some scenes but not a plotting villain, e.g. a predator), ally, neutral, changes (turns from one to another), or unknown. disposition_note: at most 12 words, the cited reason, e.g. "plans to steal the town's water supply". Empty when unknown.
- group: which parent concern a question about this character belongs to: creatures_figures (their presence on screen), hostility (cruelty, threats, schemes), violence, peril (they are often in danger), separation, animals, or none.
- cites: for each of name, kind, is_child, looks_frightening, disposition, the ids that support that field. The name's cites must include the ids that NAME the character (their T entry, a W-sentence or line that uses the name): every other field is checked together with them, so a W-sentence that says "a young girl" supports "is a child" only when the name's cites show who that girl is. An empty list for a field makes that field "unknown".

2. dangers: things other than characters that recur or matter as dangers in this film: machines, places, objects, groups of creatures, situations (e.g. "a trap", "a flood", "a storm"). For each: name, kind (machine, place, object, creature_group, situation), note (at most 12 words, what the sources say it does), group (objects_hazards, peril, captivity, injury, creatures_figures, violence, death, eerie, or none), cites. Only dangers the sources mention.

3. scenes: EVERY scene of the film, in order, from the first line to the last.
- A scene is a continuous stretch of one situation: one place, the same characters, one line of action. Parents will skip whole moments by these boundaries, so cut where the situation changes:
  - Start a new scene when the place changes, and when WHO IS IN DANGER changes (a different character is now threatened, or a danger begins or ends).
  - Start a new scene at the onset of a danger (an attack, a chase, a fall, a storm, a capture), so the danger's first line is the first line of its scene.
  - Never put an unrelated comic beat in the same scene as a danger beat: a gag or joke between other characters before, between or after danger moments is its own scene.
  - Keep a flashback, a dream, a memory or a story being told as its own scene, apart from the present-day action before and after it; a danger inside a flashback is its own scene.
  - Do not split in the middle of an exchange of dialogue. Typical features have 50 to 150 scenes; do not merge unrelated action to save space.
- start_cue and end_cue are L numbers (just the number). Cover every line exactly once: the first scene starts at 1, each later scene starts right after the previous scene's end_cue, the last ends at ${N}.
- setting: at most 6 words, where it happens, only if a cited line or W-sentence names or shows the place; else "unknown". setting_cites: the ids.
- sentences: 1 to 4 short sentences (each at most 25 words) saying who is there and what happens, each with its own cites.
  - A sentence may cite L-lines ONLY from this scene's own range (start_cue..end_cue).
  - Cite a W-sentence only when this scene's own lines show that this is where that plot event happens; then cite those lines too.
  - Describe events and the characters' visible or audible reactions, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic.
  - When a W-sentence states a danger with a strong verb (attacks, kills, mauls, chases, traps, drowns, kidnaps), keep that verb; do not soften it.
  - Paraphrase; never copy more than five words in a row from the lines.
  - A scene whose lines are only songs or sound captions still gets a sentence, e.g. "A song plays." citing its lines.

CITATION DISCIPLINE. Each claim is later checked against ONLY the ids you cite (plus a couple of neighbouring lines); anything the cited text does not back is thrown away.
- Cite every line a sentence relies on, not a sample: when a sentence sums up an exchange, cite each line that carries the fact (usually 2 to 6 ids).
- Keep each sentence to what the cited text shows: who does or says what, to whom. Leave out adjectives, emotions, colours, sizes, motives and extra details unless a cited line or W-sentence states them.
- When a W-sentence describes an event of this scene, cite it together with the scene's lines that place the event here. Most W-sentences belong to some scene; try to use each one.
- kind: a talking animal, or a toy-sized or young animal, is "animal" (use is_child "true" for a young one); "child" is only for a human child; "creature" is only for monsters and fantasy beings, never for real animal species.`;

const USER = `Film: ${film.title}${film.year ? ` (${film.year})` : ''}.

TMDB cast (${T.length} entries):
${T.map((t) => `${t.id} ${t.character}`).join('\n')}

Wikipedia plot, article "${SRC.wikipedia.title}" (${W.length} sentences):
${W.map((w) => `${w.id} ${w.text}`).join('\n')}

Subtitle lines (${N} lines, L1 to L${N}, running ${formatTime(cues[N - 1].endMs)}):
${cues.map((c) => `L${c.index} [${formatTime(c.startMs)}] ${c.text}`).join('\n')}

Return the cast, the dangers, then every scene of the film from L1 to L${N}. Use only these sources and cite every fact.`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ids = { type: 'array', items: { type: 'string' } };
const SCHEMA = obj({
  cast: {
    type: 'array',
    items: obj({
      name: { type: 'string' }, tmdb: { type: 'string' }, aliases: { type: 'array', items: obj({ name: { type: 'string' }, cites: ids }) },
      kind: { type: 'string', enum: CAST_KINDS }, is_child: { type: 'string', enum: TRI }, looks_frightening: { type: 'string', enum: TRI },
      disposition: { type: 'string', enum: DISPOSITIONS }, disposition_note: { type: 'string' }, group: { type: 'string', enum: GROUPS },
      cites: obj({ name: ids, kind: ids, is_child: ids, looks_frightening: ids, disposition: ids }),
    }),
  },
  dangers: {
    type: 'array',
    items: obj({ name: { type: 'string' }, kind: { type: 'string', enum: DANGER_KINDS }, note: { type: 'string' }, group: { type: 'string', enum: GROUPS }, cites: ids }),
  },
  scenes: {
    type: 'array',
    items: obj({
      start_cue: { type: 'integer' }, end_cue: { type: 'integer' }, setting: { type: 'string' }, setting_cites: ids,
      sentences: { type: 'array', items: obj({ text: { type: 'string' }, cites: ids }) },
    }),
  },
});

// ---- budget: reserve the worst case before the call (v4 method) -------------------------------------
const [pIn, pOut] = PRICES[MODEL];
const counted = flag('offline') ? null : await countTokens({ model: MODEL, system: SYSTEM, user: USER });
const schemaMargin = Math.ceil(JSON.stringify(SCHEMA).length / 1.5) + 1000;
const inputTokensWorst = counted != null ? Math.ceil(counted * 1.05) + schemaMargin : Math.ceil((SYSTEM.length + USER.length) / 1.5) + schemaMargin;
const MIN_OUTPUT = 24_000;
// The cap is per FILM across reruns: what earlier runs already spent on Sonnet for this film comes off it.
const PRIOR = spentSoFar(slug, 'sonnet');
const LEFT = CAP - PRIOR;
const affordableOut = Math.floor(((LEFT - (inputTokensWorst * pIn) / 1e6) * 1e6) / pOut);
const MAX_TOKENS = Math.min(48_000, affordableOut);
const worstUsd = (inputTokensWorst * pIn + MAX_TOKENS * pOut) / 1e6;

console.log(`${slug}: "${film.title}" (${film.year ?? '?'}), ${N} cues, ${W.length} W, ${T.length} T, input ${counted != null ? `${counted} tok counted` : 'not counted'}, reserving ${inputTokensWorst}, max_tokens ${MAX_TOKENS}, effort ${EFFORT}, reserve $${worstUsd.toFixed(3)} of cap $${CAP.toFixed(2)} (already spent on this film $${PRIOR.toFixed(4)})`);
if (MAX_TOKENS < MIN_OUTPUT) { console.error(`cap $${CAP} leaves only ${MAX_TOKENS} output tokens (< ${MIN_OUTPUT}). Not calling.`); process.exit(3); }
if (flag('dry')) process.exit(0);

const wallet = budget(LEFT);
if (!wallet.reserve(worstUsd)) { console.error(`refused: worst case $${worstUsd.toFixed(3)} exceeds cap $${CAP}`); process.exit(3); }

const outDir = OUT_DIR();
const runAt = new Date().toISOString();
const t0 = Date.now();
let lastLog = 0;
let result;
try {
  result = await callClaude({
    model: MODEL, system: SYSTEM, user: USER, schema: SCHEMA, maxTokens: MAX_TOKENS, effort: EFFORT,
    onProgress: (chars) => {
      if (Date.now() - lastLog > 15_000) { lastLog = Date.now(); console.log(`  ... ${Math.round((Date.now() - t0) / 1000)}s, ${chars} chars streamed`); }
    },
  });
} catch (err) {
  const u = err.usage ?? {};
  const known = err.rejected || u.output_tokens != null;
  wallet.settle(worstUsd, err.rejected ? 0 : u.output_tokens != null ? costUsd(MODEL, u) : worstUsd);
  const errFile = path.join(outDir, `${slug}.segments.error.json`);
  record(slug, { script: 'segment.js', kind: 'sonnet', usd: wallet.spent, note: `failed: ${err.message.slice(0, 120)}${known ? '' : ' (upper bound)'}` });
  fs.writeFileSync(errFile, JSON.stringify({ film, model: MODEL, run_at: runAt, wall_ms: Date.now() - t0, error: err.message, stop_reason: err.stopReason ?? null, usage: u, cost_usd: wallet.spent, cost_is_upper_bound: !known, partial_chars: err.partialChars ?? 0 }, null, 2));
  console.error(`FAILED: ${err.message}. spent $${wallet.spent.toFixed(4)} -> ${path.relative(V6, errFile)}`);
  process.exit(1);
}
const wallMs = Date.now() - t0;
const cost = costUsd(MODEL, result.usage);
wallet.settle(worstUsd, cost);
record(slug, { script: 'segment.js', kind: 'sonnet', usd: cost, note: `${PROMPT_VERSION} effort ${EFFORT}` });
// The raw model output is kept for auditing what code dropped, with the quotation rule applied to every string.
{
  const g9 = transcriptGrams(cues.map((c) => c.text), 9);
  const q = (v) => (typeof v === 'string' ? enforceQuoteRule(v, g9).text : Array.isArray(v) ? v.map(q) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, q(x)])) : v);
  fs.writeFileSync(path.join(outDir, `${slug}.segments.raw.json`), JSON.stringify({ run_at: runAt, usage: result.usage, data: q(result.data) }, null, 2));
}

// ---- validate and repair ------------------------------------------------------------------------------
const { data } = result;
const grams = transcriptGrams(cues.map((c) => c.text), 9);
const stats = {
  quote_violations_shortened: 0, sentences_trimmed: 0, settings_trimmed: 0, notes_trimmed: 0,
  scene_sentences_model: 0, scene_sentences_dropped_uncited: 0, scene_cites_rejected: { malformed: 0, unknown: 0, outside_scene: 0 },
  settings_uncited_to_unknown: 0,
  cast_model: data.cast.length, cast_dropped_uncited: 0, cast_fields_demoted_to_unknown: {}, cast_cites_rejected: 0,
  dangers_model: data.dangers.length, dangers_dropped_uncited: 0, danger_cites_rejected: 0,
  sentences_with_judgement_words: 0,
};
const issues = {};
const note = (id, what) => (issues[id] ??= []).push(what);
const dropped = { scene_sentences: [], cast: [], dangers: [] }; // what code rejected, by id (no text)

function clean(text, maxWords, where, counter) {
  let t = String(text ?? '').trim();
  const q = enforceQuoteRule(t, grams);
  if (q.violations.length) { stats.quote_violations_shortened += q.violations.length; t = q.text; note(where, `quote shortened (${q.violations.map((v) => `${v.words} words`).join(', ')})`); }
  const c = clampWords(t, maxWords);
  if (c.trimmed) { stats[counter]++; note(where, `${counter.replace(/_trimmed$/, '')} trimmed from ${wordCount(t)} words`); t = c.text; }
  return t;
}

// Scene sentence cites are checked against the MODEL's own range before coverage repair moves
// boundaries, and against the final range after it (a repair can move a boundary past a cite).
const modelScenes = data.scenes.map((s, i) => ({ ...s, _i: i }));
const { scenes: covered, repairs } = repairCoverage(modelScenes, N);
assertCoverage(covered, N);

const scenes = covered.map((s, i) => {
  const id = `S${String(i + 1).padStart(3, '0')}`;
  const range = [s.start_cue, s.end_cue];
  const sentences = [];
  s.sentences.forEach((x, k) => {
    stats.scene_sentences_model++;
    const r = checkCites(x.cites, { ...ctx, range });
    r.rejected.forEach((rj) => { stats.scene_cites_rejected[rj.why]++; });
    if (r.rejected.length) note(id, `sentence ${k + 1}: rejected cites ${r.rejected.map((rj) => `${rj.id}(${rj.why})`).join(' ')}`);
    if (!r.ok.length) {
      stats.scene_sentences_dropped_uncited++;
      dropped.scene_sentences.push({ scene: id, index: k + 1, words: wordCount(x.text), cites_given: (x.cites ?? []).length, rejected: r.rejected });
      return;
    }
    const text = clean(x.text, 25, id, 'sentences_trimmed');
    const judged = judgementWords(text);
    if (judged.length) { stats.sentences_with_judgement_words++; note(id, `sentence ${k + 1} judgement words: ${judged.join(', ')}`); }
    sentences.push({ text, cites: r.ok, ...(judged.length ? { judgement_words: judged } : {}) });
  });
  const sc = checkCites(s.setting_cites, { ...ctx, range });
  let setting = clean(s.setting, 6, id, 'settings_trimmed');
  let settingCites = sc.ok;
  if (setting.toLowerCase() !== 'unknown' && !settingCites.length) { stats.settings_uncited_to_unknown++; setting = 'unknown'; }
  if (setting.toLowerCase() === 'unknown') settingCites = [];
  const start = cues[s.start_cue - 1];
  const end = cues[s.end_cue - 1];
  return {
    id,
    start_cue: s.start_cue,
    end_cue: s.end_cue,
    start_ms: start.startMs,
    end_ms: end.endMs,
    setting,
    setting_cites: settingCites,
    sentences,
    summary: sentences.filter((x) => !x.judgement_words).map((x) => x.text).join(' '), // provisional; check-claims.js rebuilds it
    sources_used: sourcesOf(sentences.flatMap((x) => x.cites)),
  };
});

const cast = [];
data.cast.forEach((raw, i) => {
  const g = gateCastMember(raw, ctx);
  stats.cast_cites_rejected += g.rejected.length;
  if (!g.member) { stats.cast_dropped_uncited++; dropped.cast.push({ model_index: i, rejected: g.rejected }); return; }
  for (const f of g.demoted) stats.cast_fields_demoted_to_unknown[f] = (stats.cast_fields_demoted_to_unknown[f] ?? 0) + 1;
  const id = `C${String(cast.length + 1).padStart(2, '0')}`;
  const m = g.member;
  m.name = clean(m.name, 8, id, 'notes_trimmed');
  m.aliases = m.aliases.map((a) => (typeof a === 'string' ? clean(a, 8, id, 'notes_trimmed') : { ...a, name: clean(a.name, 8, id, 'notes_trimmed') }));
  m.disposition_note = clean(m.disposition_note, 12, id, 'notes_trimmed');
  cast.push({ id, ...m, ...(g.demoted.length ? { demoted_to_unknown: g.demoted } : {}) });
});

const dangers = [];
data.dangers.forEach((raw, i) => {
  const r = checkCites(raw.cites, ctx);
  stats.danger_cites_rejected += r.rejected.length;
  if (!r.ok.length) { stats.dangers_dropped_uncited++; dropped.dangers.push({ model_index: i, rejected: r.rejected }); return; }
  const id = `D${String(dangers.length + 1).padStart(2, '0')}`;
  dangers.push({ id, name: clean(raw.name, 8, id, 'notes_trimmed'), kind: raw.kind, note: clean(raw.note, 12, id, 'notes_trimmed'), group: GROUPS.includes(raw.group) ? raw.group : 'none', cites: r.ok });
});

// ---- write -------------------------------------------------------------------------------------------
const lengths = scenes.map((s) => s.end_cue - s.start_cue + 1).sort((a, b) => a - b);
const minutes = scenes.map((s) => (s.end_ms - s.start_ms) / 60000).sort((a, b) => a - b);
const med = (a) => a[Math.floor(a.length / 2)];
const spread = wikiSpread(scenes, W.length);
const out = {
  film: { slug: film.slug, title: film.title, year: film.year, imdb_id: film.imdb_id, tmdb_id: SRC.tmdb.id },
  sources: {
    tmdb: { id: SRC.tmdb.id, fetched_at: SRC.tmdb.fetched_at, cast_count: T.length },
    wikipedia: { title: SRC.wikipedia.title, revision_id: SRC.wikipedia.revision_id, url: SRC.wikipedia.url, permalink: SRC.wikipedia.permalink, fetched_at: SRC.wikipedia.fetched_at, sentence_count: W.length, verified_by: SRC.wikipedia.verified_by },
    srt: { file: path.relative(TS, srtPath), cues: N, sha256: crypto.createHash('sha256').update(srtText).digest('hex') },
  },
  model: MODEL,
  run_at: runAt,
  cost_usd: +cost.toFixed(5),
  wall_ms: wallMs,
  usage: result.usage,
  cast,
  dangers,
  scenes,
  // --- beyond the contract: provenance and what validation did ---
  prompt_version: PROMPT_VERSION,
  effort: EFFORT,
  max_tokens: MAX_TOKENS,
  cap_usd: CAP,
  reserved_usd: +worstUsd.toFixed(5),
  validation: {
    model_scene_count: data.scenes.length,
    scene_count: scenes.length,
    repairs_count: repairs.length,
    repaired_cues: repairs.reduce((sum, r) => sum + (r.cues ?? 0), 0),
    repairs,
    ...stats,
    scene_sentences_kept: scenes.reduce((n, s) => n + s.sentences.length, 0),
    scenes_with_no_sentence: scenes.filter((s) => !s.sentences.length).map((s) => s.id),
    scenes_by_sources: Object.fromEntries(['lines', 'wikipedia', 'tmdb'].map((k) => [k, scenes.filter((s) => s.sources_used.includes(k)).length])),
    wikipedia_spread: { cited: Object.keys(spread.perW).length, uncited: spread.uncited, max_scenes_per_sentence: spread.max, cited_by_several_scenes: spread.spread },
    cues_per_scene: { min: lengths[0], median: med(lengths), max: lengths[lengths.length - 1] },
    minutes_per_scene: { min: +minutes[0].toFixed(2), median: +med(minutes).toFixed(2), max: +minutes[minutes.length - 1].toFixed(2) },
    dropped,
    scene_issues: issues,
  },
};
const file = path.join(outDir, `${slug}.segments.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const v = out.validation;
console.log(`${slug}: ${scenes.length} scenes (model ${v.model_scene_count}), ${cast.length}/${v.cast_model} cast, ${dangers.length}/${v.dangers_model} dangers, $${cost.toFixed(4)} (in ${result.usage.input_tokens} / out ${result.usage.output_tokens} tok), ${(wallMs / 1000).toFixed(0)}s`);
console.log(`  sentences kept ${v.scene_sentences_kept}/${v.scene_sentences_model} (dropped uncited ${v.scene_sentences_dropped_uncited}; cites rejected ${JSON.stringify(v.scene_cites_rejected)}), settings->unknown ${v.settings_uncited_to_unknown}, cast fields demoted ${JSON.stringify(v.cast_fields_demoted_to_unknown)}, dangers dropped ${v.dangers_dropped_uncited}`);
console.log(`  repairs ${v.repairs_count} (${v.repaired_cues} cues), quotes shortened ${v.quote_violations_shortened}, trimmed s/set/notes ${v.sentences_trimmed}/${v.settings_trimmed}/${v.notes_trimmed}, judgement-word sentences ${v.sentences_with_judgement_words}`);
console.log(`  W cited ${v.wikipedia_spread.cited}/${W.length}, max scenes per W ${v.wikipedia_spread.max_scenes_per_sentence}; cues/scene median ${v.cues_per_scene.median}; minutes/scene median ${v.minutes_per_scene.median} max ${v.minutes_per_scene.max}`);
console.log(`  -> ${path.relative(TS, file)}`);
