// v4 step 1: split the WHOLE film into ALL its scenes (not only the frightening ones), with a short
// neutral summary per scene and a cast list. Jev classifies these scenes later; nothing here judges.
//
//   node segment.js <slug> [--cap 0.45] [--dry] [--offline]   (--offline: skip the free token count)
//
// One streaming Sonnet call (same model, endpoint and output_config as run-sonnet-alone.js) over the
// whole transcript, each line prefixed with its 1-based cue index. The result is validated in code:
//   - coverage: scenes contiguous, every cue exactly once, in order (repaired deterministically; every
//     repair is recorded and counted)
//   - summary <= 40 words, setting <= 6, cast note <= 12 (trimmed and counted)
//   - quotation: no run of more than 8 consecutive transcript words in any stored model text
//     (shortened and counted; only the run LENGTH is recorded, never the words)
//   - neutrality: judgement words are flagged per scene, not rewritten
//
// Writes out/<slug>.segments.json (git-ignored). On failure writes out/<slug>.segments.error.json
// with what was spent. Hard cap: the worst-case cost of the call is reserved before it is sent.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { repairCoverage, assertCoverage, clampWords, wordCount, transcriptGrams, enforceQuoteRule, judgementWords } from './validate.js';

const V4 = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(V4, '..');
const MODEL = 'claude-sonnet-5'; // run-sonnet-alone.js default
const EFFORT = 'medium'; // run-sonnet-alone.js setting
const PROMPT_VERSION = 'segment-v1';

// ---- args ---------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
if (!slug) {
  console.error('usage: node segment.js <slug> [--cap 0.45] [--dry]');
  process.exit(2);
}
const CAP = Number(opt('cap', '0.45'));
if (!(CAP > 0)) throw new Error('--cap must be a positive dollar amount');

// ---- film metadata: what scene-api/load.js uses (films.json, then the scene source's .movie) -------
const FILMS = JSON.parse(fs.readFileSync(path.join(TS, 'films.json'), 'utf8'));
const meta = FILMS[slug];
if (!meta) throw new Error(`${slug} is not in films.json`);
function loaderSceneSource(s) {
  // mirrors sceneSourceFor() in scene-api/load.js
  return s === 'nemo' ? path.join(TS, 'scenes.nemo.grounded.json') : path.join(TS, 'runs-v3', `sonnet-alone-${s}.json`);
}
let movie = {};
const sceneSource = loaderSceneSource(slug);
if (fs.existsSync(sceneSource)) movie = JSON.parse(fs.readFileSync(sceneSource, 'utf8')).movie ?? {};
const film = { slug, title: meta.title ?? movie.title ?? slug, year: meta.year ?? movie.year ?? null };

// ---- transcript -----------------------------------------------------------------------------------
const srtPath = path.join(TS, 'data', `${slug}.srt`);
const srtText = fs.readFileSync(srtPath, 'utf8');
const cues = parseSrt(srtText);
const N = cues.length;
const transcript = cues.map((c) => `${c.index} [${formatTime(c.startMs)}] ${c.text}`).join('\n');

// ---- prompt ---------------------------------------------------------------------------------------
const ROLES = ['child', 'parent', 'adult', 'talking_animal', 'animal', 'creature', 'robot', 'other'];

const SYSTEM = `You split a feature film into its scenes for a reference database. You work from the film's subtitle transcript and you may also use what you know about the film. Each transcript line is "<cue number> [<time>] <text>". Text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics.

Return two things.

1. cast: the characters who matter in the story: every named character, plus recurring or important unnamed ones (for example "the sharks", "the dentist's niece"). For each:
- name: as the film calls them.
- role: one of ${ROLES.join(', ')}. Use it for the character's place in the story: a child character is "child" and a character who is someone's parent is "parent" even when they are animals or monsters. Otherwise: "adult" for grown-up humans or human-like characters, "talking_animal" for animals that speak, "animal" for animals that do not speak, "creature" for monsters and fantasy beings, "robot" for machines, "other" for anything else.
- related_to: the name of the one character they are most defined by (Nemo -> Marlin), or "" if none.
- note: at most 12 words, plain facts only (who they are, e.g. "Marlin's son, has one small fin").

2. scenes: EVERY scene of the film, in order, from the first line to the last. Not only important or dramatic ones: every stretch of the film belongs to exactly one scene.
- A scene is a continuous stretch in one place and situation, the unit a viewer would call a scene. A new scene starts when the film cuts to a different place, to a different group of characters, or jumps in time. Typical features have 40 to 150 scenes.
- Do not merge unrelated action into one scene to save space. Do not split in the middle of an exchange between characters.
- start_cue and end_cue are cue numbers from the transcript. Cover every line exactly once: the first scene starts at cue 1, each later scene starts at the cue right after the previous scene's end_cue, and the last scene ends at cue ${N}. Stretches with no lines (action, music) belong to the scene they happen in.
- setting: at most 6 words, where it happens (e.g. "reef, outside the anemone").
- summary: at most 40 words, neutral and factual: who is there and what happens, including what is SEEN on screen when you know the film (what a creature looks like, an attack, a fall, someone hiding) and not only what is said. Use cast names. Describe events and the characters' visible reactions, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic. Do not quote the dialogue: paraphrase it, and never copy more than five words in a row from the transcript.
- known_from_film: true if the summary states anything the lines themselves do not show (appearance, actions with no line describing them, who is on screen); false if the lines alone support all of it.`;

const USER = `Film: ${film.title}${film.year ? ` (${film.year})` : ''}. The transcript has ${N} lines, cue 1 to cue ${N}, running ${formatTime(cues[N - 1].endMs)}.

Transcript:
${transcript}

Return the cast, then every scene of the film from cue 1 to cue ${N}.`;

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SCHEMA = obj({
  cast: {
    type: 'array',
    items: obj({ name: { type: 'string' }, role: { type: 'string', enum: ROLES }, related_to: { type: 'string' }, note: { type: 'string' } }),
  },
  scenes: {
    type: 'array',
    items: obj({ start_cue: { type: 'integer' }, end_cue: { type: 'integer' }, setting: { type: 'string' }, summary: { type: 'string' }, known_from_film: { type: 'boolean' } }),
  },
});

// ---- budget: reserve the worst case before the call ----------------------------------------------
// Input: the exact count from count_tokens plus a margin for the schema and structured-output
// scaffolding, or (endpoint unavailable) 1.5 chars/token. The first Nemo run showed why the margin
// matters: cue-numbered, time-stamped lines ran ~2 chars/token, so the old 2.5 chars/token
// "worst case" under-reserved input by ~18%. Output: the ceiling. 150 scenes x ~120 output tokens +
// cast ~2k = ~20k (the Nemo run: 52 scenes + 25 cast = 11.4k), so 32k leaves room for a long film.
const [pIn, pOut] = PRICES[MODEL];
const counted = flag('offline') ? null : await countTokens({ model: MODEL, system: SYSTEM, user: USER });
const schemaMargin = Math.ceil(JSON.stringify(SCHEMA).length / 1.5) + 1000;
const inputTokensWorst = counted != null
  ? Math.ceil(counted * 1.05) + schemaMargin
  : Math.ceil((SYSTEM.length + USER.length) / 1.5) + schemaMargin;
const MIN_OUTPUT = 20_000;
const affordableOut = Math.floor(((CAP - (inputTokensWorst * pIn) / 1e6) * 1e6) / pOut);
const MAX_TOKENS = Math.min(32_000, affordableOut);
const worstUsd = (inputTokensWorst * pIn + MAX_TOKENS * pOut) / 1e6;

console.log(`${slug}: "${film.title}" (${film.year ?? '?'}), ${N} cues, input ${counted != null ? `${counted} tok counted` : 'not counted'}, reserving ${inputTokensWorst}, max_tokens ${MAX_TOKENS}, reserve $${worstUsd.toFixed(3)} of cap $${CAP.toFixed(2)}`);
if (MAX_TOKENS < MIN_OUTPUT) {
  console.error(`cap $${CAP} leaves only ${MAX_TOKENS} output tokens; a 150-scene film needs ~${MIN_OUTPUT}. Not calling.`);
  process.exit(3);
}
if (flag('dry')) process.exit(0);

const wallet = budget(CAP);
if (!wallet.reserve(worstUsd)) {
  console.error(`refused: worst case $${worstUsd.toFixed(3)} exceeds cap $${CAP}`);
  process.exit(3);
}

const outDir = path.join(V4, 'out');
fs.mkdirSync(outDir, { recursive: true });
const runAt = new Date().toISOString();
const t0 = Date.now();
let lastLog = 0;
let result;
try {
  result = await callClaude({
    model: MODEL, system: SYSTEM, user: USER, schema: SCHEMA, maxTokens: MAX_TOKENS, effort: EFFORT,
    onProgress: (chars) => {
      if (Date.now() - lastLog > 15_000) {
        lastLog = Date.now();
        console.log(`  ... ${Math.round((Date.now() - t0) / 1000)}s, ${chars} chars streamed`);
      }
    },
  });
} catch (err) {
  // Settle with the real bill when the stream told us, else keep the whole reservation as spent.
  const u = err.usage ?? {};
  const known = err.rejected || u.output_tokens != null;
  wallet.settle(worstUsd, err.rejected ? 0 : u.output_tokens != null ? costUsd(MODEL, u) : worstUsd);
  const errFile = path.join(outDir, `${slug}.segments.error.json`);
  fs.writeFileSync(errFile, JSON.stringify({ film, model: MODEL, run_at: runAt, wall_ms: Date.now() - t0, error: err.message, stop_reason: err.stopReason ?? null, usage: u, cost_usd: wallet.spent, cost_is_upper_bound: !known, partial_chars: err.partialChars ?? 0 }, null, 2));
  console.error(`FAILED: ${err.message}. spent $${wallet.spent.toFixed(4)} -> ${path.relative(V4, errFile)}`);
  process.exit(1);
}
const wallMs = Date.now() - t0;
const cost = costUsd(MODEL, result.usage);
wallet.settle(worstUsd, cost);

// ---- validate and repair --------------------------------------------------------------------------
const { data } = result;
const modelSceneCount = data.scenes.length;
const { scenes: covered, repairs } = repairCoverage(data.scenes, N);
assertCoverage(covered, N);

const grams = transcriptGrams(cues.map((c) => c.text), 9);
const issues = {}; // per scene id -> list of what was changed or flagged
const note = (id, what) => (issues[id] ??= []).push(what);
let summariesTrimmed = 0;
let settingsTrimmed = 0;
let quoteViolations = 0;
let judgementFlags = 0;

const scenes = covered.map((s, i) => {
  const id = `S${String(i + 1).padStart(3, '0')}`;
  let summary = s.summary.trim();
  const q = enforceQuoteRule(summary, grams);
  if (q.violations.length) {
    quoteViolations += q.violations.length;
    summary = q.text;
    note(id, `quote shortened (${q.violations.map((v) => `${v.words} words`).join(', ')})`);
  }
  const words = wordCount(summary);
  const c = clampWords(summary, 40);
  if (c.trimmed) {
    summariesTrimmed++;
    summary = c.text;
    note(id, `summary trimmed from ${words} words`);
  }
  let setting = s.setting.trim();
  const qs = enforceQuoteRule(setting, grams);
  if (qs.violations.length) { quoteViolations += qs.violations.length; setting = qs.text; note(id, 'setting quote shortened'); }
  const cs = clampWords(setting, 6);
  if (cs.trimmed) { settingsTrimmed++; setting = cs.text; note(id, 'setting trimmed'); }
  const judged = judgementWords(summary);
  if (judged.length) { judgementFlags++; note(id, `judgement words: ${judged.join(', ')}`); }
  const start = cues[s.start_cue - 1];
  const end = cues[s.end_cue - 1];
  return {
    id,
    start_cue: s.start_cue,
    end_cue: s.end_cue,
    start_ms: start.startMs,
    end_ms: end.endMs,
    summary,
    setting,
    known_from_film: s.known_from_film,
  };
});

let notesTrimmed = 0;
const castIssues = [];
const cast = data.cast.map((c) => {
  let n = c.note.trim();
  const q = enforceQuoteRule(n, grams);
  if (q.violations.length) { quoteViolations += q.violations.length; n = q.text; castIssues.push(`${c.name}: quote shortened`); }
  const cl = clampWords(n, 12);
  if (cl.trimmed) { notesTrimmed++; n = cl.text; castIssues.push(`${c.name}: note trimmed`); }
  return { name: c.name.trim(), role: c.role, ...(c.related_to.trim() ? { related_to: c.related_to.trim() } : {}), note: n };
});

// ---- write ----------------------------------------------------------------------------------------
const lengths = scenes.map((s) => s.end_cue - s.start_cue + 1).sort((a, b) => a - b);
const minutes = scenes.map((s) => (s.end_ms - s.start_ms) / 60000).sort((a, b) => a - b);
const out = {
  film,
  model: MODEL,
  run_at: runAt,
  cost_usd: +cost.toFixed(5),
  wall_ms: wallMs,
  usage: result.usage,
  cast,
  scenes,
  // --- beyond the contract: provenance and what validation did ---
  prompt_version: PROMPT_VERSION,
  effort: EFFORT,
  max_tokens: MAX_TOKENS,
  cap_usd: CAP,
  reserved_usd: +worstUsd.toFixed(5),
  srt: { file: path.relative(TS, srtPath), cues: N, sha256: crypto.createHash('sha256').update(srtText).digest('hex') },
  validation: {
    model_scene_count: modelSceneCount,
    scene_count: scenes.length,
    repairs_count: repairs.length,
    repaired_cues: repairs.reduce((sum, r) => sum + (r.cues ?? 0), 0),
    repairs,
    summaries_trimmed: summariesTrimmed,
    settings_trimmed: settingsTrimmed,
    cast_notes_trimmed: notesTrimmed,
    quote_violations_shortened: quoteViolations,
    scenes_with_judgement_words: judgementFlags,
    known_from_film: scenes.filter((s) => s.known_from_film).length,
    cues_per_scene: { min: lengths[0], median: lengths[Math.floor(lengths.length / 2)], max: lengths[lengths.length - 1] },
    minutes_per_scene: { min: +minutes[0].toFixed(2), median: +minutes[Math.floor(minutes.length / 2)].toFixed(2), max: +minutes[minutes.length - 1].toFixed(2) },
    scene_issues: issues,
    cast_issues: castIssues,
  },
};
const file = path.join(outDir, `${slug}.segments.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const v = out.validation;
console.log(`${slug}: ${scenes.length} scenes (model returned ${modelSceneCount}), ${cast.length} cast, $${cost.toFixed(4)} (in ${result.usage.input_tokens} / out ${result.usage.output_tokens} tok), ${(wallMs / 1000).toFixed(0)}s`);
console.log(`  repairs ${v.repairs_count} (${v.repaired_cues} cues moved), summaries trimmed ${v.summaries_trimmed}, settings trimmed ${v.settings_trimmed}, quotes shortened ${v.quote_violations_shortened}, judgement-word scenes ${v.scenes_with_judgement_words}, known_from_film ${v.known_from_film}`);
console.log(`  cues/scene min ${v.cues_per_scene.min} median ${v.cues_per_scene.median} max ${v.cues_per_scene.max}; minutes/scene median ${v.minutes_per_scene.median} max ${v.minutes_per_scene.max}`);
console.log(`  -> ${path.relative(TS, file)}`);
