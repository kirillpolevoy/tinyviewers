#!/usr/bin/env node
// v5 step 2: the Jev CLAIM CHECK of every cited fact in out/<slug>.segments.json.
//
//   node check-claims.js <slug> [--cap 0.05] [--batch 12] [--context 2] [--concurrency 4] [--probe 24] [--dry]
//
// For every scene sentence, scene setting, cast field (name, kind, is_child, looks_frightening,
// disposition) and danger: state = {claim, evidence: [only that claim's cited lines, each with up to
// --context neighbouring lines of the same scene (the cookbook's "quote in its context"), cited
// Wikipedia sentences, cited TMDB entries]}, one Choice supports / contradicts / says_nothing
// (docs.typesafe.ai/cookbooks/citation_check). supports at confidence >= 0.8 = verified;
// contradicts = dropped; says_nothing or supports < 0.8 = unverified (kept, marked, and left out of
// the summary Jev classifies later). Each scene's summary is rebuilt from its verified sentences.
//
// Several claims share one request as claims[i] with path-referenced questions; batches take claims
// with a stride across the film. Two leakage probes measure whether batching changes verdicts:
//   singles   --probe claims re-asked alone; agreement with their batched verdict
//   swap      claims that were 'supports' re-asked with ANOTHER claim's evidence, (a) alone and
//             (b) in a batch right next to the same claim with its true evidence. A swapped claim
//             judged 'supports' only in (b) is leakage.
// Wikipedia-only sentences (no L cite) also get a separate placement request against the scene's own
// lines (placement != fits -> status 'unplaced', out of the summary).
//
// The pre-check segments file is kept once as out/<slug>.segments.precheck.json and every run starts
// from it, so reruns are idempotent. Per-claim answers -> out/<slug>.claims.json (no evidence text).
// Money: each request reserves its worst case before dispatch; the per-film Jev cap counts earlier runs.
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../srt.js';
import { V5, TS } from './env.js';
import { budget } from './budget.js';
import { spentSoFar, record } from './ledger.js';
import { postJev, pool, reserveUsd, usd, checkLimits, MAX_CONCURRENCY } from './jev.js';
import { judgementWords } from './validate.js';
import { buildClaims, strideBatches, batchBody, placementBody, verdictOf, applyChecks, tally, MODEL, VERSION, AUTO_ACCEPT, evidenceText } from './claims.js';

const HELD_OUT = new Set(['lion-king']);
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
if (!slug) { console.error('usage: node check-claims.js <slug> [--cap 0.05] [--batch 12] [--probe 24] [--dry]'); process.exit(2); }
// --final-held-out-run: the one-time final run on the held-out film, after all code is frozen.
if (HELD_OUT.has(slug) && !argv.includes('--final-held-out-run')) { console.error(`${slug} is held out (pass --final-held-out-run only for the frozen final run).`); process.exit(2); }
const CAP = Number(opt('cap', '0.05'));
const BATCH = Number(opt('batch', '12'));
const PROBE = Number(opt('probe', '24'));
const CONTEXT = Number(opt('context', '2')); // neighbouring subtitle lines per cited line (same scene)
const CONC = Math.max(1, Math.min(MAX_CONCURRENCY, Number(opt('concurrency', '4'))));
const DRY = argv.includes('--dry');
// --refold: no Jev calls; re-apply the answers saved in out/<slug>.claims.json with the current fold rules.
const REFOLD = argv.includes('--refold');

// ---- inputs -------------------------------------------------------------------------------------------
const outDir = path.join(V5, 'out');
const segFile = path.join(outDir, `${slug}.segments.json`);
const preFile = path.join(outDir, `${slug}.segments.precheck.json`);
if (!fs.existsSync(preFile)) fs.copyFileSync(segFile, preFile);
const seg = JSON.parse(fs.readFileSync(preFile, 'utf8'));
const SRC = JSON.parse(fs.readFileSync(path.join(V5, 'sources', `${slug}.json`), 'utf8'));
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
if (cues.length !== seg.sources.srt.cues) throw new Error('SRT changed since segmentation');
const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };

const claims = buildClaims(seg, src, { context: CONTEXT });
const batches = strideBatches(claims, BATCH);
const jobs = batches.map((b, i) => ({ kind: 'batch', label: `batch${i}`, claims: b, body: batchBody(b) }));

// placement for Wikipedia-only sentences
const sceneById = Object.fromEntries(seg.scenes.map((s) => [s.id, s]));
for (const c of claims) {
  if (c.target.type !== 'sentence' || c.cites.some((id) => id[0] === 'L')) continue;
  const s = sceneById[c.target.scene];
  const lines = cues.slice(s.start_cue - 1, s.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
  jobs.push({ kind: 'placement', label: `place:${c.key}`, key: c.key, body: placementBody(c.claim, lines) });
}

// probes (built after the main pass, from its answers)
for (const j of jobs) checkLimits(j.body, j.label);
const estMain = jobs.reduce((s, j) => s + reserveUsd(j.body), 0);
const PRIOR = spentSoFar(slug, 'jev');
console.log(`${slug}: ${claims.length} claims (${claims.filter((c) => c.target.type === 'sentence').length} sentences, ${claims.filter((c) => c.target.type === 'setting').length} settings, ${claims.filter((c) => c.target.type === 'cast').length} cast fields, ${claims.filter((c) => c.target.type === 'danger').length} dangers) in ${batches.length} batches of <= ${BATCH}; ${jobs.filter((j) => j.kind === 'placement').length} placement checks; reserve ~$${estMain.toFixed(4)} (+ probes); cap $${CAP} (already spent on this film $${PRIOR.toFixed(4)})`);
if (DRY) process.exit(0);

let wallet = budget(CAP - PRIOR);
let inputTokens = 0;
let requests = [];
async function send(job) {
  const r = reserveUsd(job.body);
  if (!wallet.reserve(r)) throw new Error(`cap: ${job.label} would exceed $${CAP} (spent ${wallet.spent.toFixed(5)})`);
  let res;
  try {
    res = await postJev(job.body);
  } catch (err) {
    // An HTTP error status was not billed; a network failure or timeout may have been, so its
    // reservation is kept as spent (an upper bound), as jev-client.js runJobs does.
    const maybeBilled = ((err.attempts ?? []).at(-1)?.status ?? null) === null;
    wallet.settle(r, maybeBilled ? r : 0);
    requests.push({ label: job.label, ok: false, error: err.message, attempts: err.attempts, cost_is_upper_bound: maybeBilled });
    throw err;
  }
  const tok = res.json.usage?.input_tokens ?? 0;
  inputTokens += tok;
  wallet.settle(r, usd(tok));
  requests.push({ label: job.label, ok: true, ms: res.latencyMs, input_tokens: tok, attempts: res.attempts.length });
  return res.json;
}

let t0 = Date.now();
const checks = {};
const placements = {};
const raw = {};
let mainMs = 0;
let mainSpent = 0;
let probe = { singles: [], swap: [] };
if (REFOLD) {
  const prev = JSON.parse(fs.readFileSync(path.join(outDir, `${slug}.claims.json`), 'utf8'));
  const prevCC = JSON.parse(fs.readFileSync(segFile, 'utf8')).claim_check;
  if (prevCC.evidence_context_lines !== CONTEXT || prevCC.batch_size !== BATCH) throw new Error(`--refold needs the saved run's --context ${prevCC.evidence_context_lines} --batch ${prevCC.batch_size}`);
  const keys = new Set(claims.map((c) => c.key));
  for (const x of prev.claims) {
    if (!keys.has(x.key)) throw new Error(`--refold: saved claim ${x.key} is not in the current claim set`);
    checks[x.key] = verdictOf({ choice: x.verdict, confidence: x.confidence, probabilities: x.probabilities });
    raw[x.key] = { batch: x.batch, pos: x.pos, batch_size: x.batch_size };
    if (x.placement) placements[x.key] = x.placement;
  }
  if (Object.keys(checks).length !== claims.length) throw new Error('--refold: saved answers do not cover every claim');
  probe = prev.probe;
  requests = prev.requests;
  inputTokens = prevCC.input_tokens;
  t0 = Date.parse(prevCC.run_at);
  mainMs = prevCC.wall_ms_main;
  mainSpent = prevCC.main_pass_cost_usd;
  wallet = { spent: prevCC.cost_usd };
} else {
try {
  await pool(jobs, CONC, async (job) => {
    const json = await send(job);
    if (job.kind === 'batch') {
      job.claims.forEach((c, i) => {
        const a = json.answers?.[`r${i}`];
        if (!a) throw new Error(`${job.label}: missing answer r${i}`);
        checks[c.key] = verdictOf(a);
        raw[c.key] = { batch: job.label, pos: i, batch_size: job.claims.length };
      });
    } else {
      const a = json.answers?.placement;
      placements[job.key] = { choice: a.choice, confidence: +Number(a.confidence).toFixed(4), probabilities: a.probabilities };
    }
  });
} finally {
  record(slug, { script: 'check-claims.js', kind: 'jev', usd: wallet.spent, note: `${VERSION} main pass, ${requests.length} requests` });
}
mainMs = Date.now() - t0;
mainSpent = wallet.spent;

// ---- leakage probes ------------------------------------------------------------------------------------
const byKey = Object.fromEntries(claims.map((c) => [c.key, c]));
const pick = (arr, n) => { const step = Math.max(1, Math.floor(arr.length / n)); return arr.filter((_, i) => i % step === 0).slice(0, n); };
if (PROBE > 0) {
  const t1 = Date.now();
  const singles = pick(claims, PROBE);
  const supported = claims.filter((c) => checks[c.key]?.verdict === 'supports' && c.target.type === 'sentence');
  const swaps = pick(supported, Math.min(12, Math.floor(PROBE / 2))).map((c, i, arr) => {
    // evidence from a claim far away in the film (half the list away)
    const other = supported[(supported.indexOf(c) + Math.floor(supported.length / 2)) % supported.length];
    return { c, other };
  });
  const pjobs = [
    ...singles.map((c) => ({ kind: 'single', label: `single:${c.key}`, key: c.key, body: batchBody([c]) })),
    ...swaps.map(({ c, other }) => ({ kind: 'swap_alone', label: `swapA:${c.key}`, key: c.key, other: other.key, body: batchBody([{ ...c, evidence: other.evidence }]) })),
  ];
  // swap in a batch: [swapped X, true X] pairs, 6 pairs per request
  for (let i = 0; i < swaps.length; i += 6) {
    const group = swaps.slice(i, i + 6);
    const items = group.flatMap(({ c, other }) => [{ ...c, evidence: other.evidence }, c]);
    pjobs.push({ kind: 'swap_batch', label: `swapB${i}`, group, body: batchBody(items) });
  }
  for (const j of pjobs) checkLimits(j.body, j.label);
  const swapRes = {};
  try {
    await pool(pjobs, CONC, async (job) => {
      const json = await send(job);
      if (job.kind === 'single') {
        const v = verdictOf(json.answers.r0);
        probe.singles.push({ key: job.key, batched: checks[job.key].verdict, batched_conf: checks[job.key].confidence, single: v.verdict, single_conf: v.confidence, same_status: v.status === checks[job.key].status });
      } else if (job.kind === 'swap_alone') {
        (swapRes[job.key] ??= { key: job.key, evidence_from: job.other }).alone = verdictOf(json.answers.r0).verdict;
      } else {
        job.group.forEach(({ c, other }, gi) => {
          const e = (swapRes[c.key] ??= { key: c.key, evidence_from: other.key });
          e.in_batch_swapped = verdictOf(json.answers[`r${gi * 2}`]).verdict;
          e.in_batch_true = verdictOf(json.answers[`r${gi * 2 + 1}`]).verdict;
        });
      }
    });
  } finally {
    record(slug, { script: 'check-claims.js', kind: 'jev', usd: wallet.spent - mainSpent, note: `${VERSION} leakage probes` });
  }
  probe.swap = Object.values(swapRes);
  probe.ms = Date.now() - t1;
}
} // end of the live run
const agree = probe.singles.filter((p) => p.batched === p.single).length;
const probeSummary = {
  singles: probe.singles.length,
  singles_same_verdict: agree,
  singles_same_status: probe.singles.filter((p) => p.same_status).length,
  swaps: probe.swap.length,
  swapped_supports_alone: probe.swap.filter((p) => p.alone === 'supports').length,
  swapped_supports_in_batch: probe.swap.filter((p) => p.in_batch_swapped === 'supports').length,
  leak: probe.swap.filter((p) => p.in_batch_swapped === 'supports' && p.alone !== 'supports').length,
};

// ---- fold into the segments file ------------------------------------------------------------------------
// Judgement words are re-derived from the sentence text with the current rule (validate.js).
for (const s of seg.scenes) for (const x of s.sentences) { const j = judgementWords(x.text); if (j.length) x.judgement_words = j; else delete x.judgement_words; }
const { seg: checked, dropped } = applyChecks(seg, checks, placements);
const t = tally(checks);
const byType = {};
for (const c of claims) {
  const k = c.target.type === 'cast' ? `cast.${c.target.field}` : c.target.type;
  const s = checks[c.key];
  const row = (byType[k] ??= { n: 0, verified: 0, unverified: 0, contradicted: 0 });
  row.n++; row[s.status]++;
}
checked.claim_check = {
  version: VERSION,
  model: MODEL,
  run_at: new Date(t0).toISOString(),
  ...(REFOLD ? { refolded_at: new Date().toISOString() } : {}),
  auto_accept: AUTO_ACCEPT,
  batch_size: BATCH,
  evidence_context_lines: CONTEXT,
  claims: claims.length,
  requests: requests.length,
  input_tokens: inputTokens,
  cost_usd: +wallet.spent.toFixed(6),
  main_pass_cost_usd: +mainSpent.toFixed(6),
  wall_ms_main: mainMs,
  wall_ms_probes: probe.ms ?? 0,
  tally: t,
  by_type: byType,
  placement: Object.fromEntries(Object.entries(placements).map(([k, v]) => [k, `${v.choice} ${v.confidence}`])),
  dropped_by_check: dropped,
  leakage_probe: probeSummary,
  summaries: {
    scenes_with_verified_summary: checked.scenes.filter((s) => s.summary).length,
    scenes_with_empty_summary: checked.scenes.filter((s) => !s.summary).map((s) => s.id),
  },
};
fs.writeFileSync(segFile, JSON.stringify(checked, null, 2));
fs.writeFileSync(path.join(outDir, `${slug}.claims.json`), JSON.stringify({
  film: seg.film, version: VERSION, model: MODEL,
  claims: claims.map((c) => ({ key: c.key, target: c.target, claim: c.claim, cites: c.cites, evidence_ids: c.evidence_ids, ...checks[c.key], ...raw[c.key], ...(placements[c.key] ? { placement: placements[c.key] } : {}) })),
  probe, requests,
}, null, 2));

console.log(`${slug}: ${claims.length} claims, ${requests.length} requests, ${inputTokens} input tok, $${wallet.spent.toFixed(5)} (main $${mainSpent.toFixed(5)}), main ${(mainMs / 1000).toFixed(1)}s, probes ${((probe.ms ?? 0) / 1000).toFixed(1)}s`);
console.log(`  verdicts: supports ${t.supports} (${t.supports_below_0_8} below 0.8), contradicts ${t.contradicts}, says_nothing ${t.says_nothing} -> verified ${t.verified}, unverified ${t.unverified}, contradicted ${t.contradicted}`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k.padEnd(24)} n ${String(v.n).padStart(3)}  verified ${v.verified}  unverified ${v.unverified}  contradicted ${v.contradicted}`);
console.log(`  placement: ${JSON.stringify(checked.claim_check.placement)}`);
console.log(`  probe: singles same verdict ${agree}/${probe.singles.length}; swapped evidence -> supports alone ${probeSummary.swapped_supports_alone}/${probeSummary.swaps}, in batch ${probeSummary.swapped_supports_in_batch}/${probeSummary.swaps}, leak ${probeSummary.leak}`);
console.log(`  summaries: ${checked.claim_check.summaries.scenes_with_verified_summary}/${checked.scenes.length} scenes have a verified summary; empty: ${checked.claim_check.summaries.scenes_with_empty_summary.join(' ') || 'none'}`);
