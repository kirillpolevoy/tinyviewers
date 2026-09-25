#!/usr/bin/env node
// v8 fix (b): WORDLESS SCENES get their plot from Wikipedia, checked by Jev.
//
//   node fill.js <slug> [--cap 0.15] [--jev-cap 0.02] [--dry] [--offline] [--reuse <fill.json>]
//                       [--final-held-out-run]
//
// Round-3 finding: a scene with almost no dialogue gets no tags and no summary although verified
// Wikipedia sentences describe it (Up's married-life montage: one caption over 3.7 minutes, the
// miscarriage, the illness and Ellie's death in W5/W7; Iron Giant 8:31-11:27, the substation and the
// electrocution in W2/W3). Cause: the segmentation prompt lets a scene cite a W-sentence only when the
// scene's own lines show the event, and the claim check needs a Wikipedia-only sentence to 'fit' the
// scene's lines -- impossible when there are none.
//
// WORDLESS SCENE (policy fill): fewer than max_dialogue_per_min dialogue cues per minute (sound
// captions do not count) over the scene's extended bounds (policy scene_bounds: to the next scene's
// first line), and at least min_ms long.
//
// 1 ORDER WINDOW (code). Wikipedia's plot section is in story order. An ANCHOR is a W-sentence cited
//   by a verified sentence that also cites its scene's lines (so its place is known). A wordless
//   scene's CANDIDATES are the W-sentences strictly after the latest anchor before it and strictly
//   before the earliest anchor after it, minus every W-sentence anchored in another scene (it has a
//   known place). Exclusive on purpose: on the dev films (dev/calibrate-neighbour.mjs, simulated
//   wordless scenes) inclusive windows let 68/96 adjacent-scene and 45/96 two-scenes-away events
//   through, exclusive windows 0/192, at the cost of refusing W-sentences that span two scenes.
// 2 SONNET (one call per film, verified-sources rule): for each wordless scene, its few lines, the 8
//   lines before and after it, the neighbouring scenes' verified sentences and the W-sentences of its
//   window; it writes 0-3 short sentences for what happens DURING the scene, each citing the
//   W-sentences it rests on (and the scene's own lines when they show part of it). Code keeps only
//   cites of the window and the scene's own lines, needs >= 1 W cite, clamps to fill.max_words (35: the
//   prompt asks for <= 25, but a hard cut mid-clause is unreadable -- Up's W7 sentence lost 'dies' to
//   the ellipsis at 25), applies the 8-word quotation rule and flags judgement words.
// 3 JEV (jev-1.13.0), per sentence:
//   support    the claim check's citation_check (claims.js batchBody) over its cited evidence; the
//              claim_accept rule decides (accept.js, source 'claim')
//   own lines  the claim check's placement request over the scene's lines: rejected when
//              p(conflicts) >= contradict_min (the lines show something that cannot be this event)
//   neighbours NEW (neighbourBody): state {event, lines_before, lines_after} (the 8 lines on each
//              side); one Choice: do the lines before / after show this event happening, or neither?
//              Passes when p(neither) >= fill.neighbour_min (calibrated on the dev films,
//              dev/calibrate-neighbour.mjs). A first design asked WHEN the event happens (before /
//              during / after): Jev cannot order plot events beyond what the lines show (AUC 0.77
//              against the adjacent scene, 0.66 two scenes away; 'during' by default), so the order
//              comes from the exclusive window (1) and Sonnet's per-W decision (2), and Jev checks
//              what it can: that the neighbouring lines do not show the event.
//   A fill sentence is placed when the own-lines test and the neighbour test pass (the order test
//   holds by construction). accept.js then decides verified / unverified / unplaced like any sentence.
// Writes <out>/<slug>.fill.json (the model output, validation, every Jev answer) and folds the
// sentences into <out>/<slug>.segments.json (marked x.fill; re-runs replace them; the first run keeps
// <out>/<slug>.segments.prefill.json). Run refold.js afterwards (unified acceptance + summaries).
// Money: the Sonnet call reserves its worst case first (counted input + margin, max_tokens of output);
// every Jev request reserves 3x its estimate; per-film caps count earlier runs (ledger).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { key, outDir, sourcesFile, heldOutGate } from './env.js';
import { readLedger, record } from './ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from './jev-client.js';
import { sceneBounds, isCaptionOnly } from './spans.js';
import { checkCites } from './cite.js';
import { clampWords, transcriptGrams, enforceQuoteRule, judgementWords } from './validate.js';
import { batchBody, placementBody, verdictOf, evidenceIds, evidenceText, DEFAULT_RULE, MODEL as JEV_MODEL } from './claims.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FILL_VERSION = 'fill-v8.0';
export const SONNET_MODEL = 'claude-sonnet-5';
const r3 = (x) => Math.round(x * 1000) / 1000;
const hmsShort = (ms) => formatTime(ms).slice(0, 8);
const lineText = (c) => `L${c.index} [${hmsShort(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`;

// ---- 0 wordless scenes ----------------------------------------------------------------------------------
/** Scenes of `seg` that are wordless under policy fill, with their extended bounds. */
export function wordlessScenes(seg, cues, cfg) {
  const f = cfg.fill;
  const bounds = sceneBounds(seg.scenes.map((s) => ({ start_ms: s.start_ms, end_ms: s.end_ms })), cfg);
  const out = [];
  seg.scenes.forEach((s, i) => {
    const b = bounds[i];
    const ms = b.end_ms - b.start_ms;
    const sc = cues.slice(s.start_cue - 1, s.end_cue);
    const dialogue = sc.filter((c) => !isCaptionOnly(c.text)).length;
    const dpm = dialogue / Math.max(1 / 60, ms / 60000);
    if (dpm < f.max_dialogue_per_min && ms >= f.min_ms) out.push({ id: s.id, index: i, start_ms: b.start_ms, end_ms: b.end_ms, start_cue: s.start_cue, end_cue: s.end_cue, dialogue_per_min: r3(dpm), minutes: r3(ms / 60000) });
  });
  return out;
}

// ---- 1 order window -------------------------------------------------------------------------------------
/** W-number -> scene indices where a verified, line-citing sentence anchors it. */
export function anchorsOf(seg) {
  const a = [];
  seg.scenes.forEach((s, i) => {
    for (const x of s.sentences ?? []) {
      // the claim check's own status (accept.js keeps it as claim_status once the unified rule ran)
      if (x.fill || (x.check?.claim_status ?? x.check?.status) !== 'verified') continue;
      if (!x.cites.some((c) => c[0] === 'L')) continue;
      for (const c of x.cites) if (c[0] === 'W') a.push({ w: Number(c.slice(1)), scene: i });
    }
  });
  return a;
}

/**
 * The W-numbers a wordless scene at index i may draw on: strictly between the latest anchor before it
 * and the earliest anchor after it, and anchored in no other scene. Returns { bounds: [lo, hi] (the
 * exclusive anchor bounds; 0 / wCount+1 when a side has none), candidates: [w...] }.
 */
export function orderWindow(i, anchors, wCount) {
  const before = anchors.filter((a) => a.scene < i).map((a) => a.w);
  const after = anchors.filter((a) => a.scene > i).map((a) => a.w);
  const lo = before.length ? Math.max(...before) : 0;
  const hi = after.length ? Math.min(...after) : wCount + 1;
  const elsewhere = new Set(anchors.filter((a) => a.scene !== i).map((a) => a.w));
  const candidates = [];
  for (let w = lo + 1; w < hi; w++) if (w >= 1 && w <= wCount && !elsewhere.has(w)) candidates.push(w);
  return { bounds: [lo, hi], candidates };
}

// ---- 2 Sonnet ---------------------------------------------------------------------------------------------
export const SYSTEM = `You help build a reference database that parents use to decide which scenes of a film to skip. Some scenes have almost no dialogue, so their subtitle lines do not say what happens. You say what happens in those scenes, working ONLY from the numbered sources given to you:
  L-lines: subtitle lines, "L<cue> [<time>] <text>". Text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics.
  W-sentences: sentences of the plot section of the film's English Wikipedia article, "W<n> <sentence>", in story order.

THE SOURCE RULE. Use only what these sources say. Do NOT use your own knowledge or memory of this film, even if you are sure of it. Every sentence you write must cite the W-sentences that state what it says. If the sources do not say what happens in a scene, return no sentences for it: an empty answer is always better than a guess.

For each scene you are given its time, its own few lines, the lines just before it and just after it, what the scenes before and after it are about, and the W-sentences whose place in the story allows them to fall inside it.
First, for EVERY listed W-sentence, decide whether what it describes happens DURING this scene (after the lines before it and before the lines after it): "yes", "no" (the lines before or after show it happening elsewhere, or show it has not happened yet or is already over) or "unsure". A W-sentence can describe several events; answer "yes" when its main events fall inside the scene.
Then write 0 to 4 short sentences (each at most 25 words) saying what happens during the scene, covering every W-sentence you answered "yes", each with its cites:
- Cite only the W-sentences listed for that scene, plus the scene's own L-lines when a line shows part of the event.
- Leave out what the lines before or after the scene already show: those events belong to the neighbouring scenes.
- Each event happens once in the story: never describe the same event in two scenes. When several of these scenes share a list of W-sentences, give each event to the one scene where the surrounding lines show it must happen.
- A death, an illness, an injury or a loss that a W-sentence places inside the scene must be stated plainly: parents rely on it.
- Keep what the W-sentence states, and nothing more: who, what happens, to whom, and the outcome. When a W-sentence states a danger, an injury, an illness or a death with a strong verb (attacks, kills, dies, falls ill, is shot), keep it; do not soften it.
- Describe events, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic.
- Paraphrase; never copy more than eight words in a row from any source.`;

export function userPrompt({ film, scenes }) {
  const parts = [`Film: ${film.title}${film.year ? ` (${film.year})` : ''}.`, `Scenes with almost no dialogue: ${scenes.length}. Return an entry for every scene id below.`];
  for (const s of scenes) {
    parts.push(`\n=== ${s.id}: ${hmsShort(s.start_ms)} to ${hmsShort(s.end_ms)} (${s.minutes} minutes, ${s.lines.length} subtitle lines) ===`);
    parts.push(`Scene before (${s.prev?.id ?? 'none'}) is about: ${s.prev?.summary || 'unknown'}`);
    parts.push(`Lines just before this scene:\n${s.before.join('\n') || '(none)'}`);
    parts.push(`This scene's own lines:\n${s.lines.join('\n') || '(none)'}`);
    parts.push(`Lines just after this scene:\n${s.after.join('\n') || '(none)'}`);
    parts.push(`Scene after (${s.next?.id ?? 'none'}) is about: ${s.next?.summary || 'unknown'}`);
    parts.push(`W-sentences that may fall inside this scene:\n${s.W.join('\n') || '(none)'}`);
  }
  return parts.join('\n');
}

export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['scenes'],
  properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'decisions', 'sentences'], properties: { id: { type: 'string' }, decisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['w', 'during_this_scene'], properties: { w: { type: 'string' }, during_this_scene: { type: 'string', enum: ['yes', 'no', 'unsure'] } } } }, sentences: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'cites'], properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } } } } } } } },
};

/** Everything the prompt needs for one wordless scene. */
export function sceneContext(seg, ws, cues, W, anchors, k = 8) {
  const s = seg.scenes[ws.index];
  const { bounds, candidates } = orderWindow(ws.index, anchors, W.length);
  const prevS = seg.scenes[ws.index - 1];
  const nextS = seg.scenes[ws.index + 1];
  return {
    ...ws, window: bounds, candidates,
    prev: prevS ? { id: prevS.id, summary: prevS.summary ?? '' } : null,
    next: nextS ? { id: nextS.id, summary: nextS.summary ?? '' } : null,
    before: cues.slice(Math.max(0, s.start_cue - 1 - k), s.start_cue - 1).map(lineText),
    lines: cues.slice(s.start_cue - 1, s.end_cue).map(lineText),
    after: cues.slice(s.end_cue, s.end_cue + k).map(lineText),
    W: candidates.map((w) => `${W[w - 1].id} ${W[w - 1].text}`),
  };
}

/**
 * Validate the model's sentences for one scene: cites of the scene's lines and of its W window only,
 * at least one W cite, <= maxWords (policy fill.max_words), the 8-word quotation rule, judgement words
 * flagged.
 * Returns { kept: [{text, cites, judgement_words?, quote_violations?}], rejected: [{why, n}] }.
 */
export function validateScene(raw, ctx, { nCues, wCount, tCount, grams, maxWords = 25 }) {
  const kept = []; const rejected = [];
  for (const x of (raw?.sentences ?? []).slice(0, 4)) {
    const c = checkCites(x.cites, { nCues, wCount, tCount, range: [ctx.start_cue, ctx.end_cue] });
    const cites = c.ok.filter((id) => id[0] === 'L' || (id[0] === 'W' && ctx.candidates.includes(Number(id.slice(1)))));
    const outside = c.ok.length - cites.length + c.rejected.length;
    if (!cites.some((id) => id[0] === 'W')) { rejected.push({ why: 'no_w_cite_in_window', n: 1 }); continue; }
    let text = clampWords(String(x.text ?? '').trim(), maxWords).text;
    if (!text) { rejected.push({ why: 'empty', n: 1 }); continue; }
    const q = enforceQuoteRule(text, grams);
    text = q.text;
    const j = judgementWords(text);
    kept.push({ text, cites, ...(j.length ? { judgement_words: j } : {}), ...(q.violations.length ? { quote_violations: q.violations.map((v) => v.words) } : {}), ...(outside ? { cites_dropped: outside } : {}) });
  }
  return { kept, rejected };
}

// ---- 3 Jev --------------------------------------------------------------------------------------------------
export const NEIGHBOUR_CRITERIA = {
  before: 'A line in `lines_before` shows this event happening: dialogue or a sound caption that belongs to the event itself.',
  after: 'A line in `lines_after` shows this event happening: dialogue or a sound caption that belongs to the event itself.',
  neither: 'No line in `lines_before` or `lines_after` shows this event happening: they are about other things, or only lead up to it, mention it, or follow from it.',
};

/**
 * The neighbour placement request: do the lines just before or just after this scene show the event?
 * (A wordless scene's event must not be one its neighbours' lines show.) One Choice.
 */
export function neighbourBody({ film, event, before, after }) {
  return {
    model: JEV_MODEL,
    state: { film: { title: film.title }, event, lines_before: before, lines_after: after },
    questions: {
      shown: {
        type: 'choice',
        instructions: '`event` is one event of this film\'s plot. Do the subtitle lines in `lines_before` or in `lines_after` show this event happening? Judge only from these lines, not from outside knowledge of the film. Lines are "L<number> [time] text"; text in parentheses is a sound caption.',
        criteria: NEIGHBOUR_CRITERIA,
      },
    },
  };
}

/**
 * Placement of one fill sentence. The NEIGHBOUR test decides (p(neither) >= fill.neighbour_min: the
 * lines around the scene do not show the event). The own-lines placement answer is recorded, not gating
 * (policy fill.own_lines_gate false): a wordless scene's few lines cover seconds of minutes, and on the
 * dev films 'conflicts' fired when they showed ANOTHER beat of the same montage (Up W5, the
 * miscarriage, against the wedding captions: p(conflicts) 0.64-0.69).
 */
export function fillPlacement({ own, neighbour }, cfg, rule = DEFAULT_RULE) {
  const pConf = Number(own?.probabilities?.conflicts) || 0;
  const pNeither = Number(neighbour?.probabilities?.neither) || 0;
  const ownOk = pConf < rule.contradict_min;
  const neighbourOk = pNeither >= cfg.fill.neighbour_min;
  const placed = neighbourOk && (cfg.fill.own_lines_gate ? ownOk : true);
  return { placed, own_ok: ownOk, neighbour_ok: neighbourOk, p_conflicts: r3(pConf), p_neither: r3(pNeither) };
}

const compact = (a) => a && { choice: a.choice ?? null, confidence: r3(Number(a.confidence) || 0), probabilities: Object.fromEntries(Object.entries(a.probabilities ?? {}).map(([k, v]) => [k, r3(Number(v))])) };

/** Fold fill sentences into a copy of the segments (replacing earlier fill sentences). */
export function foldFill(seg, fill) {
  const out = structuredClone(seg);
  for (const s of out.scenes) s.sentences = (s.sentences ?? []).filter((x) => !x.fill);
  for (const f of fill.scenes) {
    const s = out.scenes.find((x) => x.id === f.id);
    for (const x of f.sentences) {
      s.sentences.push({ text: x.text, cites: x.cites, ...(x.judgement_words ? { judgement_words: x.judgement_words } : {}), fill: { version: FILL_VERSION, window: f.window, ...x.placement }, check: x.check ? { ...x.check } : { status: 'unchecked' } });
    }
  }
  return out;
}

// ---- CLI -----------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--cap', '--jev-cap', '--reuse'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node fill.js <slug> [--cap 0.15] [--jev-cap 0.02] [--dry] [--reuse <fill.json>]'); process.exit(2); }
  heldOutGate(slug);
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const RULE = { ...DEFAULT_RULE, ...cfg.claim_accept };
  const OUT = outDir();
  const segFile = path.join(OUT, `${slug}.segments.json`);
  const preFile = path.join(OUT, `${slug}.segments.prefill.json`);
  if (!fs.existsSync(preFile)) fs.copyFileSync(segFile, preFile);
  const seg = JSON.parse(fs.readFileSync(preFile, 'utf8'));
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.join(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const W = SRC.wikipedia.sentences;
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const anchors = anchorsOf(seg);
  const wordless = wordlessScenes(seg, cues, cfg);
  const ctxs = wordless.map((ws) => sceneContext(seg, ws, cues, W, anchors)).filter((c) => c.candidates.length);
  console.log(`${slug}: ${wordless.length} wordless scenes (< ${cfg.fill.max_dialogue_per_min} dialogue cues/min, >= ${cfg.fill.min_ms / 1000} s): ${wordless.map((w) => w.id).join(',') || 'none'}; ${anchors.length} anchors; with candidate W-sentences: ${ctxs.map((c) => `${c.id} ${c.minutes}min W[${c.candidates.join(',')}]`).join('; ') || 'none'}`);
  const started = Date.now();
  let modelOut = null; let sonnet = null;
  const reuse = opt('reuse', null);
  if (reuse) {
    const prev = JSON.parse(fs.readFileSync(path.resolve(reuse), 'utf8'));
    modelOut = prev.model_output; sonnet = { ...prev.sonnet, reused_from: path.relative(here, path.resolve(reuse)) };
  } else if (ctxs.length) {
    const user = userPrompt({ film, scenes: ctxs });
    const CAP = Number(opt('cap', '0.15'));
    const prior = readLedger(slug).entries.filter((e) => e.script === 'fill.js' && e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0);
    const [pIn, pOut] = PRICES[SONNET_MODEL];
    const counted = argv.includes('--offline') ? null : await countTokens({ model: SONNET_MODEL, system: SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((SYSTEM.length + user.length) / 2.5)) + 1500; // + schema margin
    const maxTokens = 6000;
    const EFFORT = opt('effort', cfg.fill.effort ?? 'medium');
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    console.log(`  sonnet: input ${counted ?? 'not counted'} tok, reserving ${inWorst} in + ${maxTokens} out = $${worst.toFixed(4)} (cap $${CAP}, spent before $${prior.toFixed(4)})`);
    if (argv.includes('--dry')) process.exit(0);
    const wallet = budget(CAP - prior);
    if (!wallet.reserve(worst)) { console.error(`REFUSED: worst case $${worst.toFixed(4)} breaks the cap`); process.exit(3); }
    let cost = worst;
    try {
      const r = await callClaude({ model: SONNET_MODEL, system: SYSTEM, user, schema: SCHEMA, maxTokens, effort: EFFORT });
      cost = costUsd(SONNET_MODEL, r.usage);
      modelOut = r.data;
      sonnet = { model: SONNET_MODEL, effort: EFFORT, usage: r.usage, cost_usd: +cost.toFixed(6), reserved_usd: +worst.toFixed(6), latency_ms: r.latencyMs };
    } catch (err) {
      cost = err.rejected ? 0 : err.usage ? costUsd(SONNET_MODEL, err.usage) : worst;
      throw err;
    } finally {
      wallet.settle(worst, cost);
      if (cost > 0) record(slug, { script: 'fill.js', kind: 'sonnet', usd: cost, note: `${FILL_VERSION} ${ctxs.length} wordless scenes` });
    }
  } else if (argv.includes('--dry')) process.exit(0);

  // validation
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const nC = { nCues: cues.length, wCount: W.length, tCount: SRC.tmdb.cast.length, grams, maxWords: cfg.fill.max_words ?? 25 };
  const scenes = ctxs.map((c) => {
    const raw = (modelOut?.scenes ?? []).find((x) => x.id === c.id);
    const v = validateScene(raw, c, nC);
    const decisions = Object.fromEntries((raw?.decisions ?? []).filter((d) => c.candidates.includes(Number(String(d.w).replace(/^W/i, '')))).map((d) => [String(d.w).toUpperCase(), d.during_this_scene]));
    const yes = Object.entries(decisions).filter(([, d]) => d === 'yes').map(([w]) => w);
    const uncovered = yes.filter((w) => !v.kept.some((x) => x.cites.includes(w)));
    return { id: c.id, window: c.window, candidates: c.candidates, minutes: c.minutes, dialogue_per_min: c.dialogue_per_min, decisions, uncovered_yes: uncovered, returned: raw?.sentences?.length ?? 0, rejected: v.rejected, sentences: v.kept };
  });

  // Jev: support, own-lines placement, neighbour placement
  const jobs = [];
  const job = (kind, meta, body) => { const sz = sizeRequest(body, `${kind}:${meta.id}`, { reserveXEst: 3.0 }); jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind, label: `${kind}:${meta.id}`, ...meta } }); };
  for (const f of scenes) {
    const c = ctxs.find((x) => x.id === f.id);
    const s = seg.scenes.find((x) => x.id === f.id);
    f.sentences.forEach((x, k) => {
      const id = `${f.id}.f${k + 1}`;
      const ids = evidenceIds(x.cites, { context: 2, range: [s.start_cue, s.end_cue], nCues: cues.length });
      job('support', { id, scene: f.id, k }, batchBody([{ claim: x.text, evidence: ids.map((e) => evidenceText(e, { cues, W, T: SRC.tmdb.cast })) }]));
      job('own', { id, scene: f.id, k }, placementBody(x.text, c.lines.length ? c.lines : ['(no subtitle lines)']));
      job('neighbour', { id, scene: f.id, k }, neighbourBody({ film, event: x.text, before: c.before, after: c.after }));
    });
  }
  const JCAP = Number(opt('jev-cap', '0.02'));
  const priorJ = readLedger(slug).entries.filter((e) => e.script === 'fill.js' && e.kind === 'jev').reduce((a, e) => a + e.usd, 0);
  const jw = budget(JCAP - priorJ);
  const { results, stopped } = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: jw, concurrency: MAX_CONCURRENCY, log: () => {} }) : { results: [], stopped: null };
  if (jw.spent > 0) record(slug, { script: 'fill.js', kind: 'jev', usd: jw.spent, note: `${FILL_VERSION} ${jobs.length} requests` });
  const failed = results.filter((r) => !r.ok);
  if (failed.length) { console.error(`Jev: ${failed.length}/${jobs.length} requests failed (${failed[0].skipped ?? failed[0].error})${stopped ? `; ${stopped.reason}` : ''}`); process.exit(5); }
  for (const r of results) {
    const x = scenes.find((f) => f.id === r.meta.scene).sentences[r.meta.k];
    if (r.meta.kind === 'support') x.check = verdictOf(r.json.answers.r0, RULE);
    if (r.meta.kind === 'own') x.own = compact(r.json.answers.placement);
    if (r.meta.kind === 'neighbour') x.neighbour = compact(r.json.answers.shown);
  }
  for (const f of scenes) for (const x of f.sentences) x.placement = fillPlacement({ own: x.own, neighbour: x.neighbour }, cfg, RULE);
  const out = {
    film: seg.film, version: FILL_VERSION, run_at: new Date(started).toISOString(), policy: cfg.fill, rule: RULE,
    anchors: anchors.length, wordless: wordless.length, sonnet, model_output: modelOut,
    jev: { model: JEV_MODEL, requests: results.length, cost_usd: +jw.spent.toFixed(6), input_tokens: results.reduce((a, r) => a + (r.record?.input_tokens ?? 0), 0) },
    scenes,
  };
  fs.writeFileSync(path.join(OUT, `${slug}.fill.json`), JSON.stringify(out, null, 2));
  const folded = foldFill(JSON.parse(fs.readFileSync(segFile, 'utf8')), out);
  folded.fill = { version: FILL_VERSION, run_at: out.run_at, wordless_scenes: wordless.map((w) => w.id), sentences: scenes.reduce((a, f) => a + f.sentences.length, 0), placed: scenes.reduce((a, f) => a + f.sentences.filter((x) => x.placement.placed).length, 0) };
  fs.writeFileSync(segFile, JSON.stringify(folded, null, 2));
  console.log(`  ${scenes.reduce((a, f) => a + f.sentences.length, 0)} fill sentences, Jev ${results.length} requests $${jw.spent.toFixed(5)}${sonnet ? `, Sonnet $${sonnet.cost_usd}` : ''}`);
  for (const f of scenes) for (const x of f.sentences) console.log(`  ${f.id} [W${f.window[0]}-${f.window[1]}] ${x.check?.status} ${x.placement.placed ? 'PLACED' : 'unplaced'} (neither ${x.placement.p_neither}, conflicts ${x.placement.p_conflicts}) ${x.cites.join(',')}${x.judgement_words ? ' JUDGEMENT' : ''}`);
}
