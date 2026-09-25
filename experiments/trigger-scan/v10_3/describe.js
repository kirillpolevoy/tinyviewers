#!/usr/bin/env node
// v10.2 (fix 4): a flagged scene whose exclusive plot-order window is wide gets the window's plot sentences near its
// proportional position (sceneW), and the prompt lets a plot sentence describe a wordless key moment the lines lead
// into; check-describe.js's plot path decides whether such a sentence is shown. Otherwise v9's describe, unchanged.
// v9 PARENT TEXT, step 1 (Sonnet): a TITLE and a 1-2 sentence DESCRIPTION for every FLAGGED scene,
// from VERIFIED SOURCES ONLY, every sentence cited. Step 2 (check-describe.js) is Jev's claim check of
// every sentence; code then rebuilds what parents see from what passed.
//
//   node describe.js <slug> [--run r1] [--cap 0.15] [--resume] [--dry] [--final-held-out-run]
//
// Round-4 finding: 50 of 67 flagged held-out scenes showed parents a generated 'Heads-up: ...' line,
// several wrong. Here Sonnet writes the text, but only from what the pipeline can check:
//   L-lines   the scene's subtitle lines inside its skip spans (moments.js) +- 3 lines, at most
//             MAX_LINES (the flagged moment, not the whole scene);
//   W-sentences the Wikipedia plot sentences this scene's claim-verified sentences cite, plus its
//             EXCLUSIVE order window (fill.js orderWindow: strictly between the neighbouring scenes'
//             anchors, none anchored elsewhere) when that window is narrow (<= MAX_WINDOW);
//   T-entries the TMDB cast entries of the characters in the scene (questions.js castForScene).
// plus WHAT WAS FLAGGED (the flag reasons as plain phrases, reasons.js parentPhrase) so the text says
// why the scene is on the list when the sources show it. Model memory of the film is not allowed.
// Code checks (no model): every cite must be one of the ids given for THAT scene (others dropped; a
// sentence left with none is rejected), <= 25 words (clampWords at 30), the 8-word quotation rule
// (enforceQuoteRule over the whole transcript), judgement words flagged (the sentence is rejected).
// Money: one call per <= 18 flagged scenes; each reserves counted input + 2,000 schema margin +
// max_tokens of output against --cap minus this script's earlier spend on the film (ledger). The output
// file is written after every call; --resume asks only scenes not yet described.
// Writes out/<slug>.describe.<run>.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { outDir, sourcesFile, heldOutGate } from './env.js';
import { readLedger, record } from './ledger.js';
import { clampWords, transcriptGrams, enforceQuoteRule, judgementWords, wordCount } from './validate.js';
import { anchorsOf, orderWindow } from './fill.js';
import { castForScene, verifiedSentences } from './questions.js';
import { parentPhrase, rankReasons } from './reasons.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESCRIBE_VERSION = 'describe-v10.2';
export const SONNET_MODEL = 'claude-sonnet-5';
const SCRIPT = 'describe.js';
export const MAX_LINES = 80;
export const MAX_W = 10;
export const PAD_LINES = 3;
export const PER_CALL = 18;
const hms = (ms) => formatTime(ms).slice(0, 8);

export const SYSTEM = `You write the short notes a parent reads in a scene guide for a children's film: for each listed scene, a TITLE and one or two sentences saying what happens, so the parent knows why the scene is on the guide's list.

THE SOURCE RULE. Use ONLY the numbered sources given for that scene:
  L-lines: its subtitle lines, "L<cue> [<time>] <text>"; text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics. Subtitles rarely name the speaker.
  W-sentences: sentences of the plot section of the film's English Wikipedia article that may belong to this scene, "W<n> <sentence>".
  T-entries: TMDB cast list entries of characters in the scene, "T<n> <character name>".
Do NOT use your own knowledge or memory of this film, even if you are sure of it. Every sentence must cite the source ids that state what it says; a W-sentence describes the scene only when the scene's lines agree with it (they show part of the same event or lead straight into it, even when its key moment has no dialogue).

WHAT TO WRITE for each scene:
- "flagged for" says what the guide's checks found in the scene. Say what happens that matches it, plainly, when the sources show it (who, what happens, to whom, the outcome). A death, an injury, a threat, a capture or a loss must be stated plainly: parents rely on it. Do not soften a strong verb the sources use.
- If the sources do not show what was flagged, write only what they do show about the danger or upset in the scene; never invent it. Return no sentences if the sources do not say what happens.
- Title: at most 7 words, naming the event (e.g. "Nemo is taken by a diver"), not a mood; it must be backed by the same cites as the sentences.
- One or two sentences, each at most 25 words, each able to stand alone (name the character; no "he", "this" or "then" pointing at another sentence).
- Describe events, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic, menacing.
- Paraphrase; never copy more than eight words in a row from any source.`;

/** Lines of a flagged scene the writer sees: its skip spans +- PAD_LINES, at most MAX_LINES. */
export function flaggedLines(scene, cues) {
  const sc = cues.slice(scene.start_cue - 1, scene.end_cue);
  const spans = scene.skip?.spans ?? [];
  let idx = sc.map((c, i) => (spans.some((s) => c.endMs > s.start_ms && c.startMs < s.end_ms) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) idx = sc.map((_, i) => i);
  const lo = Math.max(0, idx[0] - PAD_LINES);
  const hi = Math.min(sc.length - 1, idx.at(-1) + PAD_LINES);
  let pick = sc.slice(lo, hi + 1);
  if (pick.length > MAX_LINES) {
    // keep the densest window of MAX_LINES around the spans' midpoint
    const mid = Math.floor(pick.length / 2);
    pick = pick.slice(Math.max(0, mid - MAX_LINES / 2), Math.max(0, mid - MAX_LINES / 2) + MAX_LINES);
  }
  return pick;
}

/**
 * The W-numbers a flagged scene may cite: the W-sentences its own claim-VERIFIED sentences cite (incl.
 * fill.js sentences), plus its exclusive order window (fill.js orderWindow) only when that window is
 * narrow (<= MAX_WINDOW sentences): a wide window means the scene's place in the plot is unknown, and
 * handing Sonnet plot sentences from elsewhere invites misplaced text.
 */
export const MAX_WINDOW = 4;
/**
 * v10.2 fix 4: when the exclusive order window is WIDER than MAX_WINDOW (the scene's place in the plot is only known
 * roughly: Good Dinosaur's first 16 plot sentences had no anchor, so S015, Poppa's death in the flood, got no plot
 * sentence at all), the scene gets the window's sentences within +-POSITION_HALF of its proportional position
 * (wCount x the scene's midpoint / the film's last scene end), still inside the exclusive window. Every sentence
 * Sonnet writes from them must pass check-describe.js (the plot path: Jev support against the cited plot sentence +
 * v8's placement, the neighbour test) before a parent sees it.
 */
export const POSITION_HALF = 3;
export function sceneW(seg, i, anchors, wCount) {
  const verifiedCites = (seg.scenes[i].sentences ?? []).filter((x) => (x.check?.claim_status ?? x.check?.status) === 'verified').flatMap((x) => x.cites.filter((c) => c[0] === 'W').map((c) => Number(c.slice(1))));
  const own = [...new Set([...anchors.filter((a) => a.scene === i).map((a) => a.w), ...verifiedCites])];
  const win = orderWindow(i, anchors, wCount).candidates;
  let fromWin = win.length <= MAX_WINDOW ? win : [];
  if (win.length > MAX_WINDOW) {
    const sc = seg.scenes[i]; const end = Math.max(...seg.scenes.map((x) => x.end_ms ?? 0));
    const pos = end > 0 && Number.isFinite(sc.start_ms) ? (wCount * ((sc.start_ms + sc.end_ms) / 2)) / end : null;
    fromWin = pos == null ? [] : win.filter((w) => Math.abs(w - pos) <= POSITION_HALF + 0.5);
  }
  return [...new Set([...own, ...fromWin])].filter((n) => n >= 1 && n <= wCount).sort((a, b) => a - b).slice(0, MAX_W);
}

export function buildContexts({ seg, tags, cues, src, items }) {
  const anchors = anchorsOf(seg);
  const segIndex = new Map(seg.scenes.map((s, i) => [s.id, i]));
  return tags.scenes.filter((s) => s.flagged).map((t) => {
    const i = segIndex.get(t.id);
    const sseg = seg.scenes[i];
    const lines = flaggedLines({ ...sseg, skip: t.skip }, cues);
    const w = sceneW(seg, i, anchors, src.W.length);
    const cast = castForScene(seg.cast, verifiedSentences(sseg).join(' '), cues.slice(sseg.start_cue - 1, sseg.end_cue).map((c) => c.text));
    const tIds = [...new Set(cast.map((c) => c.tmdb).filter((x) => /^T\d+$/.test(x ?? '')))];
    const reasons = rankReasons(t.flag_reasons, items).slice(0, 3);
    return {
      id: t.id, start_ms: t.start_ms, end_ms: t.end_ms,
      flagged_for: [...new Set(reasons.map((r) => parentPhrase(r, items)))],
      reasons: reasons.map((r) => r.id),
      lines: lines.map((c) => ({ id: `L${c.index}`, text: `L${c.index} [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}` })),
      w: w.map((n) => ({ id: `W${n}`, text: `W${n} ${src.W[n - 1].text}` })),
      t: tIds.map((id) => ({ id, text: `${id} ${src.T[Number(id.slice(1)) - 1].character}` })),
    };
  });
}

export function userPrompt(film, ctxs) {
  const parts = [`Film: ${film.title}${film.year ? ` (${film.year})` : ''}. Scenes on the guide's list: ${ctxs.length}. Return one entry per scene id: ${ctxs.map((c) => c.id).join(', ')}.`];
  for (const c of ctxs) {
    parts.push([
      `=== ${c.id} (${hms(c.start_ms)}-${hms(c.end_ms)}) ===`,
      `flagged for: ${c.flagged_for.join('; ')}`,
      `T-entries: ${c.t.length ? c.t.map((x) => x.text).join(' | ') : 'none'}`,
      'W-sentences:', ...(c.w.length ? c.w.map((x) => x.text) : ['none']),
      'L-lines:', ...c.lines.map((x) => x.text),
    ].join('\n'));
  }
  return parts.join('\n\n');
}

export function schemaFor(ids) {
  const sentence = { type: 'object', additionalProperties: false, required: ['text', 'cites'], properties: { text: { type: 'string' }, cites: { type: 'array', items: { type: 'string' } } } };
  return {
    type: 'object', additionalProperties: false, required: ['scenes'],
    properties: { scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'title', 'title_cites', 'sentences'], properties: { id: { type: 'string', enum: ids }, title: { type: 'string' }, title_cites: { type: 'array', items: { type: 'string' } }, sentences: { type: 'array', items: sentence } } } } },
  };
}

/** Code checks on one scene's output. Returns { title, sentences: [{text, cites, problems}], rejected: [...] }. */
export function validateScene(raw, ctx, grams) {
  const allowed = new Set([...ctx.lines, ...ctx.w, ...ctx.t].map((x) => x.id));
  const fix = (text, cites, maxWords) => {
    const problems = [];
    const kept = [...new Set((cites ?? []).map((c) => String(c).trim().toUpperCase()))].filter((c) => allowed.has(c));
    if (kept.length < (cites ?? []).length) problems.push('cite_outside_scene_dropped');
    let t = String(text ?? '').replace(/\s+/g, ' ').trim();
    const q = enforceQuoteRule(t, grams);
    if (q.violations.length) { t = q.text; problems.push(`quote_rule:${q.violations.map((v) => v.words).join(',')}`); }
    const c = clampWords(t, maxWords);
    if (c.trimmed) { t = c.text; problems.push('clamped'); }
    const jw = judgementWords(t);
    return { text: t, cites: kept, problems, judgement_words: jw, ok: !!t && kept.length > 0 && !jw.length };
  };
  const sentences = []; const rejected = [];
  for (const s of (raw?.sentences ?? []).slice(0, 2)) {
    const v = fix(s.text, s.cites, 30);
    (v.ok ? sentences : rejected).push(v);
  }
  if ((raw?.sentences ?? []).length > 2) rejected.push({ text: null, problems: [`extra_sentences:${raw.sentences.length - 2}`] });
  const title = raw ? fix(raw.title, raw.title_cites?.length ? raw.title_cites : sentences.flatMap((s) => s.cites), 9) : null;
  return { title: title && title.ok ? title : null, title_rejected: title && !title.ok ? title : null, sentences, rejected, returned: raw ? true : false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--effort'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node describe.js <slug> [--run r1] [--cap 0.15] [--resume] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const seg = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8')).film_items ?? [];
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const src = { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  const allCtxs = buildContexts({ seg, tags, cues, src, items });
  // --resume: keep the scenes an earlier run already described (same flag reasons) and ask the rest
  const outFile = path.join(OUT, `${slug}.describe.${runId}.json`);
  const prevRun = argv.includes('--resume') && fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : null;
  const keep = new Set(prevRun ? allCtxs.filter((c) => prevRun.scenes[c.id]?.returned && prevRun.scenes[c.id].reasons.join() === c.reasons.join()).map((c) => c.id) : []);
  const ctxs = allCtxs.filter((c) => !keep.has(c.id));
  const CAP = Number(opt('cap', '0.15'));
  const EFFORT = opt('effort', 'low');
  const prior = readLedger(slug).entries.filter((e) => e.script === SCRIPT && e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0);
  const wallet = budget(Math.max(0, CAP - prior));
  const [pIn, pOut] = PRICES[SONNET_MODEL];
  const chunks = [];
  for (let k = 0; k < ctxs.length; k += PER_CALL) chunks.push(ctxs.slice(k, k + PER_CALL));
  console.log(`${slug}: ${ctxs.length} flagged scenes in ${chunks.length} calls; cap $${CAP} (spent before $${prior.toFixed(4)})`);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const calls = [...(prevRun?.calls ?? [])]; const outScenes = Object.fromEntries([...keep].map((id) => [id, prevRun.scenes[id]]));
  // the file is (re)written after EVERY call, so a later refusal or failure never loses a paid answer
  const save = () => {
    const n = Object.values(outScenes);
    const o = {
      film: seg.film, version: DESCRIBE_VERSION, run: runId, model: SONNET_MODEL, effort: EFFORT, run_at: new Date().toISOString(),
      calls, cost_usd: +calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6),
      flagged: allCtxs.length, returned: n.filter((x) => x.returned).length, sentences: n.reduce((a, x) => a + x.sentences.length, 0), rejected: n.reduce((a, x) => a + x.rejected.length, 0), titles: n.filter((x) => x.title).length,
      missing: allCtxs.filter((c) => !outScenes[c.id]?.returned).map((c) => c.id),
      scenes: outScenes,
    };
    fs.writeFileSync(outFile, JSON.stringify(o, null, 2));
    return o;
  };
  for (const [k, chunk] of chunks.entries()) {
    const user = userPrompt(film, chunk);
    const counted = argv.includes('--dry') ? null : await countTokens({ model: SONNET_MODEL, system: SYSTEM, user });
    const inWorst = (counted ?? Math.ceil((SYSTEM.length + user.length) / 2.5)) + 2000;
    const maxTokens = Math.min(8000, 400 + chunk.length * 220);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    console.log(`  call ${k + 1}: ${chunk.length} scenes, input ${counted ?? 'not counted'} tok, reserving $${worst.toFixed(4)}`);
    if (argv.includes('--dry')) continue;
    if (!wallet.reserve(worst)) { save(); console.error(`REFUSED: worst case $${worst.toFixed(4)} breaks the cap (answers so far saved; --resume continues)`); process.exit(3); }
    let cost = worst;
    const row = { call: k + 1, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
    try {
      const r = await callClaude({ model: SONNET_MODEL, system: SYSTEM, user, schema: schemaFor(chunk.map((c) => c.id)), maxTokens, effort: EFFORT });
      cost = costUsd(SONNET_MODEL, r.usage);
      Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6), latency_ms: r.latencyMs });
      for (const c of chunk) {
        const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null;
        outScenes[c.id] = { flagged_for: c.flagged_for, reasons: c.reasons, evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...validateScene(raw, c, grams) };
      }
    } catch (err) {
      cost = err.rejected ? 0 : err.usage && Object.keys(err.usage).length ? costUsd(SONNET_MODEL, err.usage) : worst;
      row.error = err.message; row.cost_usd = +cost.toFixed(6);
      console.error(`  call ${k + 1} ERROR ${err.message.slice(0, 300)}`);
    } finally {
      wallet.settle(worst, cost);
      if (cost > 0) record(slug, { script: SCRIPT, kind: 'sonnet', usd: cost, note: `${DESCRIBE_VERSION} call ${k + 1} ${chunk.length} scenes` });
      calls.push(row);
      save();
    }
  }
  if (argv.includes('--dry')) process.exit(0);
  const out = save();
  console.log(`  ${out.returned}/${out.flagged} scenes returned, ${out.sentences} sentences kept, ${out.rejected} rejected by code, ${out.titles} titles; $${out.cost_usd}${out.missing.length ? `; MISSING ${out.missing.join(',')}` : ''}`);
  if (out.missing.length || calls.some((c) => c.error)) process.exitCode = 1;
}
