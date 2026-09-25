#!/usr/bin/env node
// v7 step 1: split the WHOLE film into all its scenes, from VERIFIED SOURCES ONLY (v6's prompt,
// unchanged for a whole-film call), then GATE the split (gate.js / check-split.js) and RETRY ONCE.
//
//   node segment.js <slug> [--cap 0.90] [--split-cap 0.05] [--effort low] [--dry] [--offline]
//                          [--attempt1-from <segments.raw.json>] [--no-retry] [--final-held-out-run]
//
// v7 (round-2 finding: Wild Robot's split broke -- 21 scenes for ~102 min, cue numbers past the last
// line, 70% of cited lines outside their own scene -- and nothing stopped it):
//   attempt 1   one whole-film Sonnet call (v6 prompt, byte-identical), or, with --attempt1-from, the
//               model output saved by an earlier run (no call; e.g. round 2's), replayed through the
//               same validation and gate
//   GATE        code checks + Jev as the validator (per-scene alignment, per-boundary Noul, probes);
//               limits in policy.json split_gate, set on the dev films' round-2 splits
//   attempt 2   only when attempt 1 fails: the film in two OVERLAPPING HALVES (one call each, same
//               prompt with a part rule), merged at a scene start the halves agree on inside the
//               overlap (gate.js mergeHalves); the gate runs again
//   FAIL        when attempt 2 fails too: <out>/<slug>.segments.error.json with both gate reports, exit
//               code 4, no segments file (nothing downstream can run on a split the gate rejected)
// The accepted attempt's per-scene / per-boundary Jev verdicts are written into the segments file
// (seg.split_check and scene.split_check), so the demo and film page can show the split was checked.
//
// v6 rules kept (see v6/segment.js): exactly three sources (subtitle lines, Wikipedia plot, TMDB
// cast), every fact cited, cites checked in code (a scene sentence may cite only lines of its own
// scene), coverage repair, word limits, the 8-word quotation rule on every stored model string,
// judgement words flagged. The per-scene `summary` is provisional; check-claims.js rebuilds it.
//
// Money: every Sonnet call reserves its worst case (input counted + schema margin, max_tokens of
// output) before it is sent; --cap is per film across reruns (ledger). The Jev split check has its
// own per-film cap (--split-cap) and reserves 3x the estimate per request.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { V7, TS, outDir as OUT_DIR, sourcesFile, heldOutGate } from './env.js';
import { spentSoFar, readLedger, record } from './ledger.js';
import { checkSegmentation, foldIntoSegments } from './check-split.js';
import { makePrompts } from './segment-prompt.js';
import { halves, mergeHalves, mergeCast, mergeDangers } from './gate.js';
import { budget as jevBudget } from './budget.js';
import { repairCoverage, assertCoverage, clampWords, wordCount, transcriptGrams, enforceQuoteRule, judgementWords } from './validate.js';
import { checkCites, sourcesOf, gateCastMember, wikiSpread, CAST_KINDS, TRI, DISPOSITIONS, DANGER_KINDS, GROUPS } from './cite.js';

const MODEL = 'claude-sonnet-5';
// v5.0: first verified-sources prompt (Nemo run). v5.1 adds CITATION DISCIPLINE after the Nemo claim
// check showed most unverified sentences added uncited detail ("distraught", "white boat", "huge",
// "along with krill") or cited 2-3 lines for a longer exchange, 5 W-sentences went uncited (one was
// the whale swallowing them), and kind 'child' was given to a young fish.
const PROMPT_VERSIONS = { v6: 'segment-v6.0-beats-and-cited-aliases' };
const PART_VERSION = 'part-rule-v7.0';

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
if (!slug) { console.error('usage: node segment.js <slug> [--cap 0.90] [--split-cap 0.05] [--effort low] [--attempt1-from <raw.json>] [--no-retry] [--dry]'); process.exit(2); }
// --final-held-out-run: the one-time final run on a held-out film, after all code is frozen.
heldOutGate(slug);
const CAP = Number(opt('cap', '0.90'));
const SPLIT_CAP = Number(opt('split-cap', '0.05'));
const ATTEMPT1_FROM = opt('attempt1-from', null);
const GATE_CFG = JSON.parse(fs.readFileSync(path.join(V7, 'policy.json'), 'utf8')).split_gate;
const RETRY = GATE_CFG.retry;
const EFFORT = opt('effort', 'low');
const PROMPT = opt('prompt', 'v6');
if (!PROMPT_VERSIONS[PROMPT]) throw new Error(`--prompt must be one of ${Object.keys(PROMPT_VERSIONS).join(', ')}`);
const PROMPT_VERSION = PROMPT_VERSIONS[PROMPT];
if (!(CAP > 0)) throw new Error('--cap must be a positive dollar amount');

// ---- sources ----------------------------------------------------------------------------------------
const srcFile = sourcesFile(slug);
if (!fs.existsSync(srcFile)) throw new Error(`no ${path.relative(V7, srcFile)}; run node sources.js ${slug} first`);
const SRC = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
const film = SRC.film;
const W = SRC.wikipedia.sentences;
const T = SRC.tmdb.cast;

const srtPath = path.join(TS, 'data', `${slug}.srt`);
const srtText = fs.readFileSync(srtPath, 'utf8');
const cues = parseSrt(srtText);
const N = cues.length;
const ctx = { nCues: N, wCount: W.length, tCount: T.length };


// ---- prompt (segment-prompt.js) ------------------------------------------------------------------
const { systemFor, userFor, SCHEMA } = makePrompts({ film, W, T, cues, SRC });

// ---- model calls: reserve the worst case before each call (v4 method) --------------------------------
const [pIn, pOut] = PRICES[MODEL];
const PRIOR = spentSoFar(slug, 'sonnet'); // the cap is per FILM across reruns
const wallet = budget(CAP - PRIOR);
const schemaMargin = Math.ceil(JSON.stringify(SCHEMA).length / 1.5) + 1000;
const outDir = OUT_DIR();
const runAt = new Date().toISOString();

/** One Sonnet call for lines first..last (part = null for the whole film). Throws after recording spend. */
async function callPart(first, last, part, { minOutput, maxOut }) {
  const system = systemFor(first, last, part);
  const user = userFor(first, last, part);
  const counted = flag('offline') ? null : await countTokens({ model: MODEL, system, user });
  const inWorst = counted != null ? Math.ceil(counted * 1.05) + schemaMargin : Math.ceil((system.length + user.length) / 1.5) + schemaMargin;
  const left = wallet.cap - wallet.spent - wallet.reserved;
  const affordableOut = Math.floor(((left - (inWorst * pIn) / 1e6) * 1e6) / pOut);
  const maxTokens = Math.min(maxOut, affordableOut);
  const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
  const label = part ? `part ${part.k}/${part.of} L${first}-L${last}` : 'whole film';
  console.log(`  ${label}: input ${counted != null ? `${counted} tok counted` : 'not counted'}, reserving ${inWorst}, max_tokens ${maxTokens}, effort ${EFFORT}, reserve $${worst.toFixed(3)} (left $${left.toFixed(3)} of cap $${CAP.toFixed(2)}; already spent on this film before this run $${PRIOR.toFixed(4)})`);
  if (maxTokens < minOutput) throw Object.assign(new Error(`cap leaves only ${maxTokens} output tokens (< ${minOutput}) for ${label}`), { refused: true });
  if (flag('dry')) return null;
  if (!wallet.reserve(worst)) throw Object.assign(new Error(`refused: worst case $${worst.toFixed(3)} breaks the cap`), { refused: true });
  const t0 = Date.now();
  let lastLog = 0;
  try {
    const r = await callClaude({ model: MODEL, system, user, schema: SCHEMA, maxTokens, effort: EFFORT, onProgress: (chars) => { if (Date.now() - lastLog > 15_000) { lastLog = Date.now(); console.log(`    ... ${Math.round((Date.now() - t0) / 1000)}s, ${chars} chars streamed`); } } });
    const cost = costUsd(MODEL, r.usage);
    wallet.settle(worst, cost);
    record(slug, { script: 'segment.js', kind: 'sonnet', usd: cost, note: `${PROMPT_VERSION}${part ? ` + ${PART_VERSION} ${label}` : ''} effort ${EFFORT}` });
    return { data: r.data, usage: r.usage, cost, wall_ms: Date.now() - t0, max_tokens: maxTokens, reserved_usd: +worst.toFixed(5), range: [first, last], part };
  } catch (err) {
    const u = err.usage ?? {};
    const known = err.rejected || u.output_tokens != null;
    const cost = err.rejected ? 0 : u.output_tokens != null ? costUsd(MODEL, u) : worst;
    wallet.settle(worst, cost);
    record(slug, { script: 'segment.js', kind: 'sonnet', usd: cost, note: `failed ${label}: ${err.message.slice(0, 100)}${known ? '' : ' (upper bound)'}` });
    throw Object.assign(err, { cost, cost_is_upper_bound: !known });
  }
}

const g9 = transcriptGrams(cues.map((c) => c.text), 9);
const quoteRule = (v) => (typeof v === 'string' ? enforceQuoteRule(v, g9).text : Array.isArray(v) ? v.map(quoteRule) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, quoteRule(x)])) : v);

/** Gate one model output (code checks + Jev). */
const splitWallet = jevBudget(SPLIT_CAP - readLedger(slug).entries.filter((e) => e.script === 'check-split.js' || (e.script === 'segment.js' && e.kind === 'jev')).reduce((a, e) => a + e.usd, 0));
async function gate(data, label) {
  const before = splitWallet.spent;
  try {
    return await checkSegmentation({ film, modelScenes: data.scenes, cues, ctx: { wCount: W.length, tCount: T.length }, cfg: GATE_CFG, wallet: splitWallet });
  } finally {
    const spent = splitWallet.spent - before;
    if (spent > 0) record(slug, { script: 'check-split.js', kind: 'jev', usd: spent, note: `split check of ${label} (via segment.js)` });
  }
}
const gateLine = (g) => `gate ${g.pass ? 'PASS' : 'FAIL'}${g.failed.length ? ` (${g.failed.join('; ')})` : ''}; code: ${g.code.metrics.scenes} scenes, ${g.code.metrics.scenes_per_10_min}/10 min, cited outside ${g.code.metrics.cited_outside_share}, dropped ${g.code.metrics.dropped_share}${g.jev ? `; jev: aligned ${g.jev.metrics.aligned_share}, unaligned scenes ${g.jev.metrics.unaligned_scene_share}, boundary AUC ${g.jev.metrics.boundary_auc}, ${g.jev.run.requests} requests $${g.jev.run.cost_usd} ${(g.jev.run.wall_ms / 1000).toFixed(1)} s` : ''}`;

console.log(`${slug}: "${film.title}" (${film.year ?? '?'}), ${N} cues, ${W.length} W, ${T.length} T; sonnet cap $${CAP.toFixed(2)} (spent before $${PRIOR.toFixed(4)}), split-check cap $${SPLIT_CAP}`);
const attempts = [];
let accepted = null;

// ---- attempt 1: whole film (or replayed) ---------------------------------------------------------------
{
  let a1;
  if (ATTEMPT1_FROM) {
    const raw = JSON.parse(fs.readFileSync(path.resolve(ATTEMPT1_FROM), 'utf8'));
    if (!raw.data?.scenes) throw new Error(`--attempt1-from ${ATTEMPT1_FROM}: no data.scenes`);
    a1 = { data: raw.data, usage: raw.usage ?? null, cost: 0, wall_ms: 0, replayed_from: path.relative(V7, path.resolve(ATTEMPT1_FROM)), replayed_run_at: raw.run_at ?? null, range: [1, N], part: null };
    record(slug, { script: 'segment.js', kind: 'sonnet', usd: 0, note: `attempt 1 replayed from ${a1.replayed_from} (its cost was paid by the run that made it)` });
    console.log(`attempt 1: replayed from ${a1.replayed_from} (no call)`);
  } else {
    console.log('attempt 1: whole film');
    try {
      a1 = await callPart(1, N, null, { minOutput: 24_000, maxOut: 48_000 });
    } catch (err) {
      a1 = { error: err.message, cost: err.cost ?? 0, refused: !!err.refused };
      console.error(`  attempt 1 failed: ${err.message}`);
    }
    if (flag('dry') && !ATTEMPT1_FROM) {
      const h = halves(N, RETRY.overlap_cues);
      console.log(`attempt 2 (only if attempt 1 fails the gate): halves L${h.a[0]}-L${h.a[1]} and L${h.b[0]}-L${h.b[1]}`);
      for (const [k, [f, l]] of [[1, h.a], [2, h.b]]) await callPart(f, l, { k, of: 2 }, { minOutput: 12_000, maxOut: 32_000 }).catch((e) => console.log(`  ${e.message}`));
      process.exit(0);
    }
  }
  const row = { attempt: 1, mode: ATTEMPT1_FROM ? 'replayed_whole_film' : 'whole_film', effort: ATTEMPT1_FROM ? null : EFFORT, cost_usd: a1.cost ?? 0, ...(a1.replayed_from ? { replayed_from: a1.replayed_from, replayed_run_at: a1.replayed_run_at } : {}), usage: a1.usage ?? null, wall_ms: a1.wall_ms ?? null };
  if (a1.data) {
    row.gate = await gate(a1.data, 'attempt 1');
    row.data = a1.data;
    console.log(`  attempt 1 ${gateLine(row.gate)}`);
    if (row.gate.pass) accepted = row;
  } else row.error = a1.error;
  attempts.push(row);
}

// ---- attempt 2: two overlapping halves ------------------------------------------------------------------
if (!accepted && !flag('no-retry')) {
  const h = halves(N, RETRY.overlap_cues);
  console.log(`attempt 2: two overlapping halves L${h.a[0]}-L${h.a[1]} and L${h.b[0]}-L${h.b[1]} (mid L${h.mid}, overlap ${h.overlap})`);
  const row = { attempt: 2, mode: 'halves', effort: EFFORT, halves: h, parts: [] };
  try {
    const A = await callPart(h.a[0], h.a[1], { k: 1, of: 2 }, { minOutput: 12_000, maxOut: 32_000 });
    row.parts.push({ range: A.range, usage: A.usage, cost_usd: A.cost, wall_ms: A.wall_ms, model_scenes: A.data.scenes.length });
    const B = await callPart(h.b[0], h.b[1], { k: 2, of: 2 }, { minOutput: 12_000, maxOut: 32_000 });
    row.parts.push({ range: B.range, usage: B.usage, cost_usd: B.cost, wall_ms: B.wall_ms, model_scenes: B.data.scenes.length });
    const m = mergeHalves(A.data.scenes, B.data.scenes, h);
    row.merge = { cut: m.cut, how: m.how, scenes_from_a: m.scenes.filter((s) => s.part === 'A').length, scenes_from_b: m.scenes.filter((s) => s.part === 'B').length };
    row.data = { cast: mergeCast(A.data.cast, B.data.cast), dangers: mergeDangers(A.data.dangers, B.data.dangers), scenes: m.scenes.map(({ part, ...s }) => s) };
    row.cost_usd = A.cost + B.cost;
    row.usage = { input_tokens: A.usage.input_tokens + B.usage.input_tokens, output_tokens: A.usage.output_tokens + B.usage.output_tokens };
    row.wall_ms = A.wall_ms + B.wall_ms;
    console.log(`  merged at L${m.cut} (${m.how}): ${row.merge.scenes_from_a} + ${row.merge.scenes_from_b} scenes`);
    row.gate = await gate(row.data, 'attempt 2');
    console.log(`  attempt 2 ${gateLine(row.gate)}`);
    if (row.gate.pass) accepted = row;
  } catch (err) {
    row.error = err.message;
    row.cost_usd = (row.parts.reduce((a, p) => a + p.cost_usd, 0)) + (err.cost ?? 0);
    console.error(`  attempt 2 failed: ${err.message}`);
  }
  attempts.push(row);
}

// the raw model output of every attempt, with the quotation rule applied to every string
const rawOut = { run_at: runAt, accepted_attempt: accepted?.attempt ?? null, attempts: attempts.map((a) => ({ ...a, accepted: a === accepted, gate: a.gate ? { pass: a.gate.pass, failed: a.gate.failed } : null, data: undefined, scenes: a.data ? quoteRule(a.data.scenes) : undefined, cast: a.data ? quoteRule(a.data.cast) : undefined, dangers: a.data ? quoteRule(a.data.dangers) : undefined })) };
if (accepted) rawOut.data = quoteRule(accepted.data);
fs.writeFileSync(path.join(outDir, `${slug}.segments.raw.json`), JSON.stringify(rawOut, null, 2));
const attemptSummary = attempts.map((a) => ({ attempt: a.attempt, mode: a.mode, effort: a.effort, cost_usd: +(a.cost_usd ?? 0).toFixed(5), ...(a.replayed_from ? { replayed_from: a.replayed_from } : {}), ...(a.halves ? { halves: a.halves, merge: a.merge } : {}), ...(a.error ? { error: a.error } : {}), gate: a.gate ? { pass: a.gate.pass, failed: a.gate.failed, code: a.gate.code.metrics, jev: a.gate.jev ? { metrics: a.gate.jev.metrics, run: a.gate.jev.run } : null } : null }));

if (!accepted) {
  const errFile = path.join(outDir, `${slug}.segments.error.json`);
  const segFile = path.join(outDir, `${slug}.segments.json`);
  if (fs.existsSync(segFile)) fs.renameSync(segFile, path.join(outDir, `${slug}.segments.rejected-${Date.now()}.json`));
  fs.writeFileSync(errFile, JSON.stringify({ film, run_at: runAt, error: 'segmentation rejected by the split gate on every attempt', attempts: attemptSummary, gate_reports: attempts.map((a) => a.gate ?? null), sonnet_spent_usd: +wallet.spent.toFixed(5), split_check_spent_usd: +splitWallet.spent.toFixed(6) }, null, 2));
  console.error(`\nSEGMENTATION REJECTED: ${slug} failed the split gate on ${attempts.length} attempt(s). No segments file written. -> ${path.relative(TS, errFile)}`);
  process.exit(4);
}

const data = accepted.data;
const { scenes, cast, dangers, stats, issues, dropped, repairs } = buildSegments(data);
const cost = attempts.reduce((a, x) => a + (x.cost_usd ?? 0), 0);
const wallMs = attempts.reduce((a, x) => a + (x.wall_ms ?? 0), 0);

// ---- validate and repair (v6's code, as a function of one model output) ----------------------------
function buildSegments(data) {
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


  return { scenes, cast, dangers, stats, issues, dropped, repairs, covered };
}

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
  usage: accepted.usage,
  cast,
  dangers,
  scenes,
  // --- beyond the contract: provenance, the split gate and what validation did ---
  prompt_version: accepted.mode === 'halves' ? `${PROMPT_VERSION} + ${PART_VERSION}` : PROMPT_VERSION,
  effort: accepted.effort,
  cap_usd: CAP,
  segmentation_attempts: attemptSummary,
  accepted_attempt: accepted.attempt,
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
foldIntoSegments(out, accepted.gate, { attempt: accepted.attempt, checked_at: new Date().toISOString() });
const file = path.join(outDir, `${slug}.segments.json`);
fs.writeFileSync(file, JSON.stringify(out, null, 2));
const v = out.validation;
console.log(`\n${slug}: accepted attempt ${accepted.attempt} (${accepted.mode}); ${scenes.length} scenes (model ${v.model_scene_count}), ${cast.length}/${v.cast_model} cast, ${dangers.length}/${v.dangers_model} dangers, sonnet $${cost.toFixed(4)}, ${(wallMs / 1000).toFixed(0)}s`);
console.log(`  sentences kept ${v.scene_sentences_kept}/${v.scene_sentences_model} (dropped uncited ${v.scene_sentences_dropped_uncited}; cites rejected ${JSON.stringify(v.scene_cites_rejected)}), settings->unknown ${v.settings_uncited_to_unknown}, cast fields demoted ${JSON.stringify(v.cast_fields_demoted_to_unknown)}, dangers dropped ${v.dangers_dropped_uncited}`);
console.log(`  repairs ${v.repairs_count} (${v.repaired_cues} cues), quotes shortened ${v.quote_violations_shortened}, trimmed s/set/notes ${v.sentences_trimmed}/${v.settings_trimmed}/${v.notes_trimmed}, judgement-word sentences ${v.sentences_with_judgement_words}`);
console.log(`  W cited ${v.wikipedia_spread.cited}/${W.length}, max scenes per W ${v.wikipedia_spread.max_scenes_per_sentence}; cues/scene median ${v.cues_per_scene.median}; minutes/scene median ${v.minutes_per_scene.median} max ${v.minutes_per_scene.max}`);
console.log(`  -> ${path.relative(TS, file)}`);
