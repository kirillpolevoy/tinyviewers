#!/usr/bin/env node
// ROUND 8 freeze verification (own code, no model calls): v10.2's out102/freeze.json is intact (every listed sha256
// matches), its parent is v10.1's freeze, it was written before the first fresh-film output, no frozen file and no
// v10.2 top-level / shared file changed after the first fresh-film output, and no v10.2 code file names a fresh
// slug. Writes round8/out/freeze-check.json.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V102 = path.resolve(here, '..'); const TS = path.resolve(V102, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); const mt = (f) => fs.statSync(f).mtime;
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const fzFile = path.join(V102, 'out102', 'freeze.json'); const fz = JSON.parse(fs.readFileSync(fzFile, 'utf8'));
const rows = Object.entries(fz.files).map(([rel, h]) => { const p = path.join(V102, rel); return { rel, ok: fs.existsSync(p) && sha(p) === h, mtime: fs.existsSync(p) ? mt(p).toISOString() : null }; });
const parent = path.join(TS, 'v10_1', 'out101', 'freeze.json');
const fresh = fs.readdirSync(path.join(V102, 'out102')).filter((f) => FILMS.some((s) => f.startsWith(`${s}.`))).map((f) => ({ f, m: mt(path.join(V102, 'out102', f)) })).sort((a, b) => a.m - b.m);
const srcs = FILMS.map((s) => path.join(V102, 'sources', `${s}.json`)).filter(fs.existsSync).map((f) => ({ f: path.relative(V102, f), m: mt(f) }));
const first = Math.min(...[...fresh, ...srcs].map((x) => x.m.getTime()));
const tops = fs.readdirSync(V102).filter((f) => /\.(js|json|mjs)$/.test(f)).map((f) => path.join(V102, f));
const shared = ['../taxonomy-v3.js', '../common.js', '../glossary.json', '../srt.js', '../claude.js'].map((f) => path.join(V102, f));
const after = [...tops, ...shared].filter((f) => mt(f).getTime() > first).map((f) => `${path.relative(V102, f)} ${mt(f).toISOString()}`);
const code = [...tops, ...['dev', 'eval', 'test'].flatMap((d) => fs.readdirSync(path.join(V102, d), { recursive: true }).map((x) => path.join(V102, d, x)).filter((p) => /\.(js|mjs|json)$/.test(p) && fs.statSync(p).isFile() && !p.includes('/out/')))];
const names = code.filter((f) => { const t = fs.readFileSync(f, 'utf8'); return /incredibles|big-hero-6|big hero 6|\bbrave\b/i.test(t); }).map((f) => path.relative(V102, f));
const out = { freeze: path.relative(TS, fzFile), sha256: sha(fzFile), frozen_at: fz.frozen_at, version: fz.version, files: rows.length, mismatched: rows.filter((r) => !r.ok).map((r) => r.rel), latest_frozen_file_mtime: rows.map((r) => r.mtime).sort().pop(), parent_freeze_matches: fz.parent_freeze?.sha256 === sha(parent), dev_films: fz.dev_films, fresh_in_dev_films: FILMS.filter((s) => fz.dev_films.includes(s)), first_fresh_output: new Date(first).toISOString(), frozen_before_first_fresh_output: new Date(fz.frozen_at).getTime() < first, frozen_files_modified_after_first_fresh_output: rows.filter((r) => new Date(r.mtime).getTime() > first).map((r) => r.rel), toplevel_or_shared_modified_after_first_fresh_output: after, v102_code_naming_fresh_slugs: names };
fs.writeFileSync(path.join(here, 'out', 'freeze-check.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
