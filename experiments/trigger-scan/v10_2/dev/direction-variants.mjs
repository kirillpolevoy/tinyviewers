#!/usr/bin/env node
// v10.1 DIRECTION-CHECK VARIANT (dev only). The Noul "Is it X who <verbs> Y, not the other way round?" (asked by
// check-describe.js into out101/dev/<slug>.why.r1.json) barely separated the labelled reversed texts from the
// accurate ones. This asks the same texts a CHOICE between the two explicit directions:
//   forward  "<X> <verbs> <Y>"      reverse  "<Y> <verbs> <X>"      neither  "someone else / not shown"
// over the same state (scene lines + cited plot sentences), so the rule can reject only texts the lines show
// the OTHER way round, and not texts whose lines simply do not say who did it.
//   node dev/direction-variants.mjs [--cap 0.01]    -> dev/out/direction-variants.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { budget } from '../budget.js';
import { key, sourcesFile, DEV_FILMS } from '../env.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from '../jev-client.js';
import { evidenceText, MODEL } from '../claims.js';
import { directionChoiceBody } from '../textsafe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const argv = process.argv.slice(2);
const CAP = Number(argv[argv.indexOf('--cap') + 1] ?? 0.01) || 0.01;
const margin = rj(path.join(here, 'out', 'margin.json'));
const label = new Map(margin.rows.map((r) => [`${r.slug}/${r.key}`, r.verdict]));
const jobs = [];
for (const slug of DEV_FILMS) {
  const why = rj(path.join(V101, 'out101', 'dev', `${slug}.why.r1.json`));
  const seg = rj(path.join(TS, slug === 'good-dinosaur' ? 'v10/out10' : 'v10/out', `${slug}.segments.json`));
  const S = rj(sourcesFile(slug));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const src = { cues, W: S.wikipedia.sentences, T: S.tmdb.cast };
  for (const [id, sc] of Object.entries(why.scenes)) {
    const s = seg.scenes.find((x) => x.id === id);
    const lines = cues.slice(s.start_cue - 1, s.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
    for (const c of sc.checked.filter((x) => x.direction)) {
      const plot = c.cites.filter((x) => x[0] === 'W').map((x) => evidenceText(x, src));
      const body = directionChoiceBody({ film: seg.film, lines, plot, d: c.direction, model: MODEL });
      const sz = sizeRequest(body, `dir:${slug}/${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { slug, key: c.key, label: `${slug}/${c.key}`, noul: c.direction.p, status: c.status, verdict: label.get(`${slug}/${c.key}`) ?? null, agent: c.direction.agent, patient: c.direction.patient } });
    }
  }
}
const wallet = budget(CAP);
console.log(`${jobs.length} direction Choice requests, worst case $${jobs.reduce((a, j) => a + j.reserveUsd, 0).toFixed(5)} (cap $${CAP})`);
const r = await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY });
const bad = r.results.filter((x) => !x.ok);
if (bad.length) { console.error(`${bad.length} failed: ${bad[0].error ?? bad[0].skipped}`); process.exit(5); }
const rows = r.results.map((x) => { const pr = x.json.answers.direction.probabilities ?? {}; return { ...x.meta, choice: x.json.answers.direction.choice, p_forward: +(pr.forward ?? 0).toFixed(3), p_reverse: +(pr.reverse ?? 0).toFixed(3), p_neither: +(pr.neither ?? 0).toFixed(3) }; });
fs.writeFileSync(path.join(here, 'out', 'direction-variants.json'), JSON.stringify({ generated_at: new Date().toISOString(), cost_usd: +wallet.spent.toFixed(6), rows }, null, 2));
rows.sort((a, b) => b.p_reverse - a.p_reverse);
for (const x of rows) console.log(`rev ${x.p_reverse.toFixed(2)} fwd ${x.p_forward.toFixed(2)} nei ${x.p_neither.toFixed(2)} noul ${x.noul}  ${String(x.verdict ?? '-').padEnd(8)} ${x.status.padEnd(12)} ${x.slug} ${x.key}  ${x.agent} -> ${x.patient}`);
console.log(`$${wallet.spent.toFixed(6)}`);
