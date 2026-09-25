#!/usr/bin/env node
// v10.3 SEEN-FILM MOMENTS (Jev; the pipeline's moments.js request per scene, dev measurement on the 19 seen films).
// v10.3's flags (select.js + policy.json: mortal reasons, the co-occurrence rule) add reasons -- and so moment clauses
// -- the stored runs never asked, and flag scenes they never asked at all; respanScenes would fall back to the WHOLE
// scene for them, which is not what the pipeline does. This asks exactly the requests moments.js would make for
// those scenes (planMoments: every clause of the scene's reasons, wordless / too-long scenes get no call) and merges
// the answers into a copy of the stored moments file: a scene asked before keeps its stored answers for the clauses
// it had (so v10.2's spans do not move) and gains the new clauses; a new scene gets the whole new request.
// Writes out103/seen/<slug>.moments.r1.json (merged) and the spend to out103/seen/<slug>.spend.json.
//   node eval/moments-seen.mjs [films] [--cap-film 0.02] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import * as S103 from '../select.js';
import { loadSplit } from '../split.js';
import { planMoments, spansFromAnswers, scenesNeedingMoments } from '../moments.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from '../jev-client.js';
import { budget } from '../budget.js';
import { key } from '../env.js';
import { FILMS, loadFilm, runSystem, resolveFile, mortalFile, rj, V103 } from './seen-lib.mjs';
import { spent, CAP } from './spend.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const films = (argv.find((a) => !a.startsWith('--') && !['--cap-film'].includes(argv[argv.indexOf(a) - 1])) ?? FILMS.join(',')).split(',');
const CAP_FILM = Number(opt('cap-film', '0.02'));
const OUT = path.join(V103, 'out103', 'seen');
fs.mkdirSync(OUT, { recursive: true });
const SPLIT = loadSplit();
const P = S103.loadPolicy(path.join(V103, 'policy.json'));
const ledgerFile = (slug) => path.join(OUT, `${slug}.spend.json`);
function record(slug, entry) {
  const l = fs.existsSync(ledgerFile(slug)) ? rj(ledgerFile(slug)) : { entries: [] };
  l.entries.push({ at: new Date().toISOString(), ...entry, usd: +entry.usd.toFixed(6) });
  fs.writeFileSync(ledgerFile(slug), JSON.stringify(l, null, 2));
}
/** Merge new answers into a stored scene entry (see header). */
export function mergeScene(old, fresh) {
  if (!old) return fresh;
  if (!old.answers || !fresh.answers) return fresh; // an old v6-format entry (per_reason only) or a no-call fresh plan
  const have = new Set(old.answers.map((a) => a.clause));
  return { ...old, answers: [...old.answers, ...fresh.answers.filter((a) => !have.has(a.clause))], merged_v103: { added: fresh.answers.filter((a) => !have.has(a.clause)).map((a) => a.clause), request: fresh.request ?? null } };
}
for (const slug of films) {
  const F = loadFilm(slug);
  const file = path.join(OUT, `${slug}.moments.r1.json`);
  const base = fs.existsSync(file) ? rj(file) : JSON.parse(JSON.stringify(F.saved ?? { scenes: {} }));
  const T = runSystem(F, S103, P, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT, mortal: rj(mortalFile(slug)), saved: base });
  const need = scenesNeedingMoments({ tags: T.tags, saved: base, items: F.items, cfg: P });
  const cueByIndex = new Map(F.cues.map((c) => [c.index, c]));
  const plans = need.map((id) => { const s = T.tags.scenes.find((x) => x.id === id); return { s, plan: planMoments({ film: F.seg.film, scene: s, cues: F.cues.slice(s.start_cue - 1, s.end_cue), reasons: s.flag_reasons, items: F.items, cfg: P, cueByIndex }) }; });
  const calls = plans.filter((p) => p.plan.call);
  const reserve = calls.reduce((a, p) => a + p.plan.reserveUsd, 0);
  console.log(`${slug}: ${need.length} flagged scenes need moments (${calls.length} calls, worst case $${reserve.toFixed(5)}): ${need.join(',') || '-'}`);
  if (argv.includes('--dry') || !need.length) continue;
  const s0 = spent().total;
  if (s0 + Math.min(CAP_FILM, reserve) > CAP) { console.error(`REFUSED: v10.3 spend $${s0} + $${reserve.toFixed(4)} > cap $${CAP}`); process.exit(3); }
  const wallet = budget(CAP_FILM);
  const jobs = calls.map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { id: p.s.id, label: `${p.s.id}/moments` } }));
  const r = jobs.length ? await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [] };
  if (wallet.spent > 0) record(slug, { script: 'eval/moments-seen.mjs', kind: 'jev', usd: wallet.spent, note: `${jobs.length} moments requests (v10.3 seen)` });
  const bad = r.results.filter((x) => !x.ok);
  if (bad.length) { console.error(`${slug}: ${bad.length} requests failed (${bad[0].skipped ?? bad[0].error})`); process.exit(5); }
  const by = new Map(r.results.map((x) => [x.meta.id, x]));
  for (const { s, plan } of plans) {
    let fresh;
    if (!plan.call) fresh = { method: plan.method, why: plan.why, dialogue_per_min: plan.dialogue_per_min, spans: plan.spans, reasons: s.flag_reasons.map((x) => x.id) };
    else { const res = by.get(s.id); fresh = { ...spansFromAnswers(plan, res.json.answers, F.cues.slice(s.start_cue - 1, s.end_cue), s, P, cueByIndex), reasons: plan.reasons, dialogue_per_min: plan.dialogue_per_min, request: res.record }; }
    base.scenes[s.id] = mergeScene(base.scenes[s.id], fresh);
  }
  base.v103_seen = [...(base.v103_seen ?? []), { at: new Date().toISOString(), asked: need, requests: jobs.length, cost_usd: +wallet.spent.toFixed(8), note: 'stored moments + v10.3 requests for scenes / clauses the stored run never asked (eval/moments-seen.mjs)' }];
  fs.writeFileSync(file, JSON.stringify(base, null, 2));
  console.log(`  $${wallet.spent.toFixed(6)} -> ${path.relative(V103, file)}; total v10.3 spend $${spent().total}`);
}
