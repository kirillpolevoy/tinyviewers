#!/usr/bin/env node
// Dev-only: calibrate fill.js's NEIGHBOUR test (policy fill.neighbour_min) with Jev: "do the lines just
// before or just after this scene show this event happening?"
//
// Known placements: sentences the claim check verified that cite BOTH a W-sentence and their own
// scene's lines, in scene i. Per sentence, three requests:
//   positive   lines_before = the 8 lines before scene i, lines_after = the 8 lines after scene i (the
//              event's own scene is left out, as for a wordless scene): truth 'neither'
//   neg_after  lines_after = the event's own cited lines (from 2 before the first cited line, 8 lines):
//              truth 'after' -- the neighbour's lines show it
//   neg_before lines_before = the same stretch of the event's own lines: truth 'before'
// Reports p(neither) per kind, AUC positive vs negatives, TPR / FPR per threshold, and picks the lowest
// threshold with FPR <= 0.10. (The first design, a before / during / after ORDER question, is kept in
// calibration/neighbour-where-v1.json: Jev could not order events, AUC 0.77 / 0.66.)
//   node dev/calibrate-neighbour.mjs [--per-film 8] [--cap 0.03] [--dry] [--write]
import fs from 'node:fs';
import path from 'node:path';
import { parseSrt, formatTime } from '../../srt.js';
import { V8, TS, DEV_FILMS, key, outDir, sourcesFile } from '../env.js';
import { budget } from '../budget.js';
import { record } from '../ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from '../jev-client.js';
import { neighbourBody } from '../fill.js';
import { auc } from '../gate.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PER = Number(opt('per-film', '8'));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => Math.round(x * 1000) / 1000;
const hms = (ms) => formatTime(ms).slice(0, 8);
const lineText = (c) => `L${c.index} [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`;
function lcg(seed) { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }

const jobs = [];
for (const slug of DEV_FILMS) {
  const pre = path.join(outDir(), `${slug}.segments.prefill.json`);
  const seg = rj(fs.existsSync(pre) ? pre : path.join(outDir(), `${slug}.segments.json`));
  const SRC = rj(sourcesFile(slug));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const film = { title: SRC.film.title };
  const cand = [];
  seg.scenes.forEach((s, i) => {
    if (i < 1 || i > seg.scenes.length - 2) return;
    s.sentences.forEach((x, k) => {
      if (x.fill || (x.check?.claim_status ?? x.check?.status) !== 'verified') return;
      if (!x.cites.some((c) => c[0] === 'W') || !x.cites.some((c) => c[0] === 'L')) return;
      cand.push({ i, k, text: x.text, first: Math.min(...x.cites.filter((c) => c[0] === 'L').map((c) => Number(c.slice(1)))) });
    });
  });
  const rnd = lcg(4242 + slug.length);
  const picked = cand.map((c) => ({ c, r: rnd() })).sort((a, b) => a.r - b.r).slice(0, PER).map((x) => x.c);
  for (const p of picked) {
    const s = seg.scenes[p.i];
    const before = cues.slice(Math.max(0, s.start_cue - 1 - 8), s.start_cue - 1).map(lineText);
    const after = cues.slice(s.end_cue, s.end_cue + 8).map(lineText);
    const own = cues.slice(Math.max(0, p.first - 1 - 2), p.first - 1 + 6).map(lineText);
    for (const [kind, b, a] of [['positive', before, after], ['neg_after', before, own], ['neg_before', own, after]]) {
      const body = neighbourBody({ film, event: p.text, before: b, after: a });
      const sz = sizeRequest(body, `${slug}:${s.id}:${kind}`, { reserveXEst: 3.0 });
      jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { slug, scene: s.id, k: p.k, kind, label: `${slug}:${s.id}.s${p.k + 1}:${kind}` } });
    }
  }
}
const reserve = jobs.reduce((a, j) => a + j.reserveUsd, 0);
console.log(`${jobs.length} requests (${jobs.length / 3} sentences x 3), worst-case reserve $${reserve.toFixed(4)}`);
if (argv.includes('--dry')) process.exit(0);
const wallet = budget(Number(opt('cap', '0.03')));
const { results, stopped } = await runJobs(jobs, { key: key('TYPESAFE_API_KEY'), budget: wallet, concurrency: MAX_CONCURRENCY });
record('nemo', { script: 'dev/calibrate-neighbour', kind: 'jev', usd: wallet.spent, note: `${results.length} neighbour (shown) calibration requests over ${DEV_FILMS.length} dev films` });
if (stopped) console.log('STOPPED', stopped.reason);
const rows = results.filter((r) => r.ok).map((r) => ({ ...r.meta, p: r3(Number(r.json.answers.shown.probabilities?.neither) || 0), choice: r.json.answers.shown.choice }));
const pos = rows.filter((r) => r.kind === 'positive').map((r) => r.p);
const neg = rows.filter((r) => r.kind !== 'positive').map((r) => r.p);
const table = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((t) => ({ t, tpr: r3(pos.filter((p) => p >= t).length / pos.length), fpr: r3(neg.filter((p) => p >= t).length / neg.length) }));
const chosen = table.find((x) => x.fpr <= 0.10) ?? null;
const choices = rows.reduce((m, r) => { (m[r.kind] ??= {})[r.choice] = (m[r.kind][r.choice] ?? 0) + 1; return m; }, {});
const out = { generated_at: new Date().toISOString(), design: 'shown: do lines_before / lines_after show the event? (fill.js neighbourBody)', sentences: pos.length, cost_usd: +wallet.spent.toFixed(6), auc: auc(pos, neg), mean_p_neither: { positive: r3(pos.reduce((a, b) => a + b, 0) / pos.length), negative: r3(neg.reduce((a, b) => a + b, 0) / neg.length) }, choices, table, chosen, rows };
console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
if (argv.includes('--write')) { fs.writeFileSync(path.join(V8, 'calibration', 'neighbour.json'), JSON.stringify(out, null, 1)); console.log('-> calibration/neighbour.json'); }
