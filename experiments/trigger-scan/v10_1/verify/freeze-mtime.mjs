#!/usr/bin/env node
// VERIFIER: freeze integrity (v10.1 and its parent v10) and a timeline check that no decision file changed after
// the first held-out (frozen/zootopia) pipeline output was written. Own code, no model calls. Writes verify/out/freeze-mtime.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..'); const TS = path.resolve(V101, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mt = (f) => fs.statSync(f).mtime;
const iso = (d) => d.toISOString();

function checkFreeze(file) {
  const fz = JSON.parse(fs.readFileSync(file, 'utf8'));
  const base = path.dirname(path.dirname(file));
  const rows = Object.entries(fz.files).map(([rel, h]) => { const p = path.join(base, rel); const ok = fs.existsSync(p) && sha(p) === h; return { rel, ok, mtime: fs.existsSync(p) ? iso(mt(p)) : null }; });
  return { file: path.relative(TS, file), sha256: sha(file), frozen_at: fz.frozen_at, n: rows.length, mismatched: rows.filter((r) => !r.ok).map((r) => r.rel), latest_file_mtime: rows.map((r) => r.mtime).sort().pop(), rows, parent: fz.parent_freeze ?? null, fz };
}
const v101 = checkFreeze(path.join(V101, 'out101', 'freeze.json'));
const v10 = checkFreeze(path.join(TS, 'v10', 'out10', 'freeze.json'));
const parentOk = v101.parent && v101.parent.sha256 === v10.sha256;

// earliest held-out output (any stage) and the first classification output per held-out film
const heldFiles = (slug) => fs.readdirSync(path.join(V101, 'out101')).filter((f) => f.startsWith(`${slug}.`)).map((f) => ({ f, m: mt(path.join(V101, 'out101', f)) })).sort((a, b) => a.m - b.m);
const held = {};
for (const slug of ['frozen', 'zootopia']) { const fs_ = heldFiles(slug); held[slug] = { first_any: `${fs_[0].f} ${iso(fs_[0].m)}`, jev: iso(mt(path.join(V101, 'out101', `${slug}.jev.r1.json`))), sonnetq: iso(mt(path.join(V101, 'out101', `${slug}.sonnetq.r1.json`))), all: fs_.map((x) => `${x.f} ${iso(x.m)}`) }; }
const firstHeld = Math.min(...['frozen', 'zootopia'].map((s) => heldFiles(s)[0].m.getTime()));

// every .js/.json at the v10.1 top level (frozen or not) and dev/, eval/: modified after the first held-out output?
const tops = fs.readdirSync(V101).filter((f) => /\.(js|json|mjs)$/.test(f)).map((f) => path.join(V101, f));
const extra = ['../taxonomy-v3.js', '../common.js', '../glossary.json', '../srt.js'].map((f) => path.join(V101, f)).filter((f) => fs.existsSync(f));
const after = [...tops, ...extra].filter((f) => mt(f).getTime() > firstHeld).map((f) => `${path.relative(V101, f)} ${iso(mt(f))}`);
const frozenAfter = v101.rows.filter((r) => r.mtime && new Date(r.mtime).getTime() > firstHeld).map((r) => `${r.rel} ${r.mtime}`);
const frozenLatest = v101.latest_file_mtime;

// prereg vs round-6 held-out output times
const pre = path.join(TS, 'v10', 'prereg-tierA-gating.json');
const r6 = ['good-dinosaur', 'frozen', 'zootopia'].flatMap((s) => { const d = path.join(TS, 'v10', 'out10'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith(`${s}.`)).map((f) => ({ f, m: mt(path.join(d, f)) })) : []; }).sort((a, b) => a.m - b.m);
const r6dirs = ['round6', 'verify/r6'].map((d) => path.join(TS, 'v10', d)).filter(fs.existsSync);
const r6files = r6dirs.flatMap((d) => fs.readdirSync(d, { recursive: true }).map((f) => path.join(d, f)).filter((f) => fs.statSync(f).isFile())).map((f) => ({ f: path.relative(TS, f), m: mt(f) })).sort((a, b) => a.m - b.m);
const prereg = { mtime: iso(mt(pre)), registered_at_utc: JSON.parse(fs.readFileSync(pre, 'utf8')).registered_at_utc, sha256: sha(pre), out10_heldout_first: r6[0] ? `${r6[0].f} ${iso(r6[0].m)}` : null, out10_heldout_before_prereg: r6.filter((x) => x.m < mt(pre)).map((x) => `${x.f} ${iso(x.m)}`), round6_reports_before_prereg: r6files.filter((x) => x.m < mt(pre) && /(headtohead|bar|judge|who|fp-reasons|descriptions)/.test(x.f)).map((x) => `${x.f} ${iso(x.m)}`), round6_first_report: r6files.find((x) => /(headtohead|bar)/.test(x.f)) ? `${r6files.find((x) => /(headtohead|bar)/.test(x.f)).f} ${iso(r6files.find((x) => /(headtohead|bar)/.test(x.f)).m)}` : null };

const out = { v101: { ...v101, rows: undefined, fz: undefined }, v10: { ...v10, rows: undefined, fz: undefined }, parent_matches_v10_freeze: parentOk, v101_frozen_at_before_first_held: new Date(v101.frozen_at).getTime() < firstHeld, first_held_output: iso(new Date(firstHeld)), held, frozen_files_modified_after_first_held_output: frozenAfter, frozen_latest_file_mtime: frozenLatest, any_toplevel_or_shared_modified_after_first_held_output: after, prereg };
fs.writeFileSync(path.join(here, 'out', 'freeze-mtime.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ...out, held: Object.fromEntries(Object.entries(held).map(([k, v]) => [k, { ...v, all: v.all.slice(0, 4) }])) }, null, 1));
