#!/usr/bin/env node
// ROUND 9 (v10.3): copy of v10_2/round8/freeze-check.mjs; v10_3 paths (out103, parent = v10.2's out102 freeze), fresh films
// kung-fu-panda / onward / croods. 'onward' is also an English word, so slug hits are listed with the matching line for
// reading (a hit is not a leak by itself). Before any fresh output exists the timing fields are null.
// ROUND 8 freeze verification (own code, no model calls): v10.2's out102/freeze.json is intact (every listed sha256
// matches), its parent is v10.1's freeze, it was written before the first fresh-film output, no frozen file and no
// v10.2 top-level / shared file changed after the first fresh-film output, and no v10.2 code file names a fresh
// slug. Writes round8/out/freeze-check.json.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V102 = path.resolve(here, '..'); const TS = path.resolve(V102, '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); const mt = (f) => fs.statSync(f).mtime;
const FILMS = ['kung-fu-panda', 'onward', 'croods'];
const fzFile = path.join(V102, 'out103', 'freeze.json'); const fz = JSON.parse(fs.readFileSync(fzFile, 'utf8'));
const rows = Object.entries(fz.files).map(([rel, h]) => { const p = path.join(V102, rel); return { rel, ok: fs.existsSync(p) && sha(p) === h, mtime: fs.existsSync(p) ? mt(p).toISOString() : null }; });
const parent = path.join(TS, 'v10_2', 'out102', 'freeze.json');
const fresh = fs.readdirSync(path.join(V102, 'out103')).filter((f) => FILMS.some((s) => f.startsWith(`${s}.`))).map((f) => ({ f, m: mt(path.join(V102, 'out103', f)) })).sort((a, b) => a.m - b.m);
const srcs = FILMS.map((s) => path.join(V102, 'sources', `${s}.json`)).filter(fs.existsSync).map((f) => ({ f: path.relative(V102, f), m: mt(f) }));
const allF = [...fresh, ...srcs]; const first = allF.length ? Math.min(...allF.map((x) => x.m.getTime())) : Infinity;
const tops = fs.readdirSync(V102).filter((f) => /\.(js|json|mjs)$/.test(f)).map((f) => path.join(V102, f));
const shared = ['../taxonomy-v3.js', '../common.js', '../glossary.json', '../srt.js', '../claude.js'].map((f) => path.join(V102, f));
const after = [...tops, ...shared].filter((f) => mt(f).getTime() > first).map((f) => `${path.relative(V102, f)} ${mt(f).toISOString()}`);
const code = [...tops, ...['dev', 'eval', 'test'].flatMap((d) => fs.readdirSync(path.join(V102, d), { recursive: true }).map((x) => path.join(V102, d, x)).filter((p) => /\.(js|mjs|json)$/.test(p) && fs.statSync(p).isFile() && !p.includes('/out/')))];
const RX = /kung-fu-panda|kung fu panda|\bonward\b|croods/i;
const names = code.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [l, i]).filter(([l]) => RX.test(l)).map(([l, i]) => `${path.relative(V102, f)}:${i + 1}: ${l.trim().slice(0, 160)}`));
const out = { freeze: path.relative(TS, fzFile), sha256: sha(fzFile), frozen_at: fz.frozen_at, version: fz.version, files: rows.length, mismatched: rows.filter((r) => !r.ok).map((r) => r.rel), latest_frozen_file_mtime: rows.map((r) => r.mtime).sort().pop(), parent_freeze_matches: fz.parent_freeze?.sha256 === sha(parent), dev_films: fz.dev_films, fresh_in_dev_films: FILMS.filter((s) => fz.dev_films.includes(s)), first_fresh_output: Number.isFinite(first) ? new Date(first).toISOString() : null, frozen_before_first_fresh_output: new Date(fz.frozen_at).getTime() < first, frozen_files_modified_after_first_fresh_output: rows.filter((r) => new Date(r.mtime).getTime() > first).map((r) => r.rel), toplevel_or_shared_modified_after_first_fresh_output: after, v103_code_lines_naming_fresh_slugs: names, freeze_sha256_expected: 'edd7b622ed0e8a40aed23224269129f532391975f97de5cc66d7f7c3bee163f4' };
fs.writeFileSync(path.join(here, 'out', 'freeze-check.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
