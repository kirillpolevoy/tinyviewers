#!/usr/bin/env node
// v6 step 2: the Jev CLAIM CHECK of every cited fact in <out>/<slug>.segments.json.
//
//   node check-claims.js <slug> [--cap 0.05] [--batch 1] [--context 2] [--concurrency 4] [--probe 0]
//                               [--reuse <claims.json>] [--refold] [--dry] [--final-held-out-run]
//
// Claims (claims.js): every scene sentence and setting; every cast field as ONE fact (name, kind,
// is_child, looks_frightening, disposition), the disposition note as its own claim, every alias
// ('<X> is also called <alias>'); every danger's existence and, separately, its note. A cast field's
// evidence = its own cites + the name's cites (entity link). state = {claim, evidence: [only that
// claim's cited lines, each with --context neighbouring lines of the same scene, cited Wikipedia
// sentences, cited TMDB entries]}, one Choice supports / contradicts / says_nothing
// (docs.typesafe.ai/cookbooks/citation_check).
//
// Status (policy.json claim_accept, chosen by calibrate-claims.js): verified when p(supports) >=
// min_supports and p(contradicts) < max_contradicts; contradicted when the verdict is contradicts
// with p(contradicts) >= contradict_min (field -> unknown, danger dropped); else unverified (kept,
// marked, never shown to Jev). Every sentence citing Wikipedia gets a placement request against its
// scene's own lines (claims.js placementOutcome). Each scene's summary is rebuilt from its verified,
// placed, judgement-free sentences.
//
// --batch 1 (default) sends each claim alone, so there is no batching leakage to probe (v5 measured
// it with --probe; still available). --reuse <file>: a claim whose text AND evidence ids equal a
// claim in that earlier claims.json takes its saved answer (no call); placements likewise by key and
// text. --refold: no calls; re-apply this film's saved answers with the current rule.
//
// The pre-check segments file is kept once as <out>/<slug>.segments.precheck.json and every run
// starts from it, so reruns are idempotent. Per-claim answers -> <out>/<slug>.claims.json (no evidence
// text). Money: each request reserves its worst case before dispatch (jev.js: 3.0 x the estimate for
// these Choice requests); --cap is per film for this script and counts its earlier runs (ledger).
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt } from '../srt.js';
import { V8, TS, outDir as OUT_DIR, sourcesFile, heldOutGate } from './env.js';
import { budget } from './budget.js';
import { readLedger, record } from './ledger.js';
import { postJev, pool, reserveUsd, usd, checkLimits, MAX_CONCURRENCY } from './jev.js';
import { judgementWords } from './validate.js';
import { buildClaims, strideBatches, batchBody, placementBody, verdictOf, applyChecks, tally, MODEL, VERSION, evidenceText, DEFAULT_RULE, adoptTmdbNames } from './claims.js';

const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt; };
if (!slug) { console.error('usage: node check-claims.js <slug> [--cap 0.05] [--batch 1] [--context 2] [--probe 0] [--reuse file] [--refold] [--dry]'); process.exit(2); }
heldOutGate(slug);
const CAP = Number(opt('cap', '0.05'));
const BATCH = Number(opt('batch', '1'));
const PROBE = Number(opt('probe', '0'));
const CONTEXT = Number(opt('context', '2'));
const CONC = Math.max(1, Math.min(MAX_CONCURRENCY, Number(opt('concurrency', '4'))));
const DRY = argv.includes('--dry');
const REFOLD = argv.includes('--refold');
const REUSE = opt('reuse', null);
const POLICY = JSON.parse(fs.readFileSync(path.join(V8, 'policy.json'), 'utf8'));
const RULE = { ...DEFAULT_RULE, ...(POLICY.claim_accept ?? {}) };
delete RULE._about;

// ---- inputs -------------------------------------------------------------------------------------------
const outDir = OUT_DIR();
const segFile = path.join(outDir, `${slug}.segments.json`);
const preFile = path.join(outDir, `${slug}.segments.precheck.json`);
// Run-phase fix: a segments file fresh from segment.js (no claim_check yet) always replaces the
// pre-check copy; before, a re-run of segment.js was silently ignored in favour of a stale copy.
if (!fs.existsSync(preFile) || !JSON.parse(fs.readFileSync(segFile, 'utf8')).claim_check) fs.copyFileSync(segFile, preFile);
const seg = JSON.parse(fs.readFileSync(preFile, 'utf8'));
const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
if (cues.length !== seg.sources.srt.cues) throw new Error('SRT changed since segmentation');
if (seg.sources.wikipedia?.revision_id && SRC.wikipedia.revision_id !== seg.sources.wikipedia.revision_id) throw new Error(`sources file is Wikipedia revision ${SRC.wikipedia.revision_id}, segments cite revision ${seg.sources.wikipedia.revision_id}`);
const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };

const claims = buildClaims(seg, src, { context: CONTEXT });
const refusedAliases = claims.refused_aliases ?? [];
const sceneById = Object.fromEntries(seg.scenes.map((s) => [s.id, s]));
const sceneLines = (s) => cues.slice(s.start_cue - 1, s.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
const placementWanted = claims.filter((c) => c.target.type === 'sentence' && c.cites.some((id) => id[0] === 'W'));

// ---- reuse ---------------------------------------------------------------------------------------------
const checks = {};
const placements = {};
const raw = {};
const reused = { claims: 0, placements: 0, from: REUSE ? path.relative(V8, path.resolve(REUSE)) : null };
if (REUSE && !REFOLD) {
  const prev = JSON.parse(fs.readFileSync(path.resolve(REUSE), 'utf8'));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const byKey = new Map(prev.claims.map((x) => [x.key, x]));
  for (const c of claims) {
    const x = byKey.get(c.key);
    if (x && x.claim === c.claim && same(x.evidence_ids, c.evidence_ids)) {
      checks[c.key] = verdictOf({ choice: x.verdict, confidence: x.confidence, probabilities: x.probabilities }, RULE);
      raw[c.key] = { reused: true };
      reused.claims++;
    }
    if (x?.placement && x.claim === c.claim && placementWanted.includes(c)) { placements[c.key] = x.placement; reused.placements++; }
  }
}

const todo = claims.filter((c) => !checks[c.key]);
const batches = strideBatches(todo, BATCH);
const jobs = batches.map((b, i) => ({ kind: 'batch', label: `batch${i}`, claims: b, body: batchBody(b) }));
for (const c of placementWanted) {
  if (placements[c.key]) continue;
  jobs.push({ kind: 'placement', label: `place:${c.key}`, key: c.key, body: placementBody(c.claim, sceneLines(sceneById[c.target.scene])) });
}
for (const j of jobs) checkLimits(j.body, j.label);
const estMain = jobs.reduce((s, j) => s + reserveUsd(j.body), 0);
// the cap is per film for THIS script across reruns (classify / moments spend has its own caps)
const PRIOR = readLedger(slug).entries.filter((e) => e.kind === 'jev' && e.script === 'check-claims.js').reduce((a, e) => a + e.usd, 0);
const count = (t) => claims.filter((c) => c.target.type === t).length;
console.log(`${slug}: ${claims.length} claims (${count('sentence')} sentences, ${count('setting')} settings, ${count('cast')} cast facts, ${count('alias')} aliases, ${count('danger')} dangers, ${count('danger_note')} danger notes); ${refusedAliases.length} aliases refused without a check; reused ${reused.claims} answers + ${reused.placements} placements; ${jobs.filter((j) => j.kind === 'batch').length} claim requests (batch ${BATCH}), ${jobs.filter((j) => j.kind === 'placement').length} placement requests; reserve ~$${estMain.toFixed(4)}; cap $${CAP} (already spent on this film $${PRIOR.toFixed(4)}); rule ${JSON.stringify(RULE)}`);
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
    // reservation is kept as spent (an upper bound).
    const maybeBilled = ((err.attempts ?? []).at(-1)?.status ?? null) === null;
    wallet.settle(r, maybeBilled ? r : 0);
    requests.push({ label: job.label, ok: false, error: err.message, attempts: err.attempts, cost_is_upper_bound: maybeBilled });
    throw err;
  }
  const tok = res.json.usage?.input_tokens ?? 0;
  inputTokens += tok;
  const cost = usd(tok);
  wallet.settle(r, cost);
  requests.push({ label: job.label, ok: true, ms: res.latencyMs, input_tokens: tok, attempts: res.attempts.length, reserve_usd: +r.toFixed(8), ...(cost > r ? { over_reserve: true } : {}) });
  return res.json;
}

let t0 = Date.now();
let mainMs = 0;
let mainSpent = 0;
let probe = { singles: [], swap: [] };
if (REFOLD) {
  const prev = JSON.parse(fs.readFileSync(path.join(outDir, `${slug}.claims.json`), 'utf8'));
  const prevCC = JSON.parse(fs.readFileSync(segFile, 'utf8')).claim_check;
  if (prevCC.evidence_context_lines !== CONTEXT) throw new Error(`--refold needs the saved run's --context ${prevCC.evidence_context_lines}`);
  const keys = new Set(claims.map((c) => c.key));
  for (const x of prev.claims) {
    if (!keys.has(x.key)) throw new Error(`--refold: saved claim ${x.key} is not in the current claim set`);
    checks[x.key] = verdictOf({ choice: x.verdict, confidence: x.confidence, probabilities: x.probabilities }, RULE);
    raw[x.key] = { batch: x.batch, pos: x.pos, batch_size: x.batch_size, ...(x.reused ? { reused: true } : {}) };
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
  Object.assign(reused, prevCC.reused ?? {});
} else {
  try {
    await pool(jobs, CONC, async (job) => {
      const json = await send(job);
      if (job.kind === 'batch') {
        job.claims.forEach((c, i) => {
          const a = json.answers?.[`r${i}`];
          if (!a) throw new Error(`${job.label}: missing answer r${i}`);
          checks[c.key] = verdictOf(a, RULE);
          raw[c.key] = { batch: job.label, pos: i, batch_size: job.claims.length };
        });
      } else {
        const a = json.answers?.placement;
        placements[job.key] = { choice: a.choice, confidence: +Number(a.confidence).toFixed(4), probabilities: Object.fromEntries(Object.entries(a.probabilities ?? {}).map(([k, v]) => [k, +Number(v).toFixed(4)])) };
      }
    });
  } finally {
    record(slug, { script: 'check-claims.js', kind: 'jev', usd: wallet.spent, note: `${VERSION} main pass, ${requests.length} requests` });
  }
  mainMs = Date.now() - t0;
  mainSpent = wallet.spent;

  // ---- optional leakage probes (only meaningful with --batch > 1) ---------------------------------
  if (PROBE > 0) {
    const t1 = Date.now();
    const pick = (arr, n) => { const step = Math.max(1, Math.floor(arr.length / n)); return arr.filter((_, i) => i % step === 0).slice(0, n); };
    const singles = pick(todo, PROBE);
    const pjobs = singles.map((c) => ({ kind: 'single', label: `single:${c.key}`, key: c.key, body: batchBody([c]) }));
    for (const j of pjobs) checkLimits(j.body, j.label);
    try {
      await pool(pjobs, CONC, async (job) => {
        const json = await send(job);
        const v = verdictOf(json.answers.r0, RULE);
        probe.singles.push({ key: job.key, batched: checks[job.key].verdict, single: v.verdict, same_status: v.status === checks[job.key].status });
      });
    } finally {
      record(slug, { script: 'check-claims.js', kind: 'jev', usd: wallet.spent - mainSpent, note: `${VERSION} singles probe` });
    }
    probe.ms = Date.now() - t1;
  }
}

// ---- fold into the segments file ------------------------------------------------------------------------
for (const s of seg.scenes) for (const x of s.sentences) { const j = judgementWords(x.text); if (j.length) x.judgement_words = j; else delete x.judgement_words; }
const namesByTmdb = adoptTmdbNames(seg, src, checks);
const { seg: checked, dropped } = applyChecks(seg, checks, placements, RULE);
const t = tally(checks);
const typeKey = (c) => (c.target.type === 'cast' ? `cast.${c.target.field}` : c.target.type);
const byType = {};
for (const c of claims) {
  const s = checks[c.key];
  const row = (byType[typeKey(c)] ??= { n: 0, verified: 0, unverified: 0, contradicted: 0 });
  row.n++; row[s.status]++;
}
const sent = checked.scenes.flatMap((s) => s.sentences);
const sceneMs = (s) => s.end_ms - s.start_ms;
checked.claim_check = {
  version: VERSION,
  model: MODEL,
  run_at: new Date(t0).toISOString(),
  ...(REFOLD ? { refolded_at: new Date().toISOString() } : {}),
  rule: RULE,
  batch_size: BATCH,
  evidence_context_lines: CONTEXT,
  claims: claims.length,
  requests: requests.length,
  reused,
  input_tokens: inputTokens,
  cost_usd: +wallet.spent.toFixed(6),
  main_pass_cost_usd: +mainSpent.toFixed(6),
  wall_ms_main: mainMs,
  wall_ms_probes: probe.ms ?? 0,
  tally: t,
  by_type: byType,
  aliases_refused_without_check: refusedAliases,
  names_from_tmdb: namesByTmdb,
  placement: Object.fromEntries(Object.entries(placements).map(([k, v]) => [k, `${v.choice} ${v.confidence}`])),
  unplaced_sentences: sent.filter((x) => x.check?.status === 'unplaced').length,
  dropped_by_check: dropped,
  probe: { singles: probe.singles.length, singles_same_status: probe.singles.filter((p) => p.same_status).length },
  summaries: {
    sentences_in_summary: `${sent.filter((x) => x.check?.status === 'verified' && !x.judgement_words).length}/${sent.length}`,
    scenes_with_verified_summary: checked.scenes.filter((s) => s.summary).length,
    minutes_with_verified_summary: +(checked.scenes.filter((s) => s.summary).reduce((a, s) => a + sceneMs(s), 0) / 60000).toFixed(3),
    scenes_with_empty_summary: checked.scenes.filter((s) => !s.summary).map((s) => s.id),
  },
};
fs.writeFileSync(segFile, JSON.stringify(checked, null, 2));
fs.writeFileSync(path.join(outDir, `${slug}.claims.json`), JSON.stringify({
  film: seg.film, version: VERSION, model: MODEL, rule: RULE,
  claims: claims.map((c) => ({ key: c.key, target: c.target, claim: c.claim, cites: c.cites, evidence_ids: c.evidence_ids, ...checks[c.key], ...raw[c.key], ...(placements[c.key] ? { placement: placements[c.key] } : {}) })),
  refused_aliases: refusedAliases,
  probe, requests,
}, null, 2));

console.log(`${slug}: ${claims.length} claims, ${requests.length} requests, ${inputTokens} input tok, $${wallet.spent.toFixed(5)}, main ${(mainMs / 1000).toFixed(1)}s`);
console.log(`  verdicts: supports ${t.supports} (${t.supports_not_verified} not verified by the rule), contradicts ${t.contradicts}, says_nothing ${t.says_nothing} -> verified ${t.verified}, unverified ${t.unverified}, contradicted ${t.contradicted}`);
for (const [k, v] of Object.entries(byType)) console.log(`  ${k.padEnd(24)} n ${String(v.n).padStart(3)}  verified ${v.verified}  unverified ${v.unverified}  contradicted ${v.contradicted}`);
console.log(`  aliases refused without a check: ${refusedAliases.map((a) => `${a.key} ${a.why}`).join(', ') || 'none'}; unplaced sentences ${checked.claim_check.unplaced_sentences}`);
console.log(`  summaries: ${checked.claim_check.summaries.sentences_in_summary} sentences in summaries; ${checked.claim_check.summaries.scenes_with_verified_summary}/${checked.scenes.length} scenes (${checked.claim_check.summaries.minutes_with_verified_summary} min) have a verified summary`);
