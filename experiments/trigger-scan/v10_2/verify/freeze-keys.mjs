#!/usr/bin/env node
// VERIFIER: freeze integrity + ordering, held-out hygiene (v10.2 code/dev/eval never names a fresh film), key blindness
// by time ordering and content, and the live baseline (scene-api import closure unchanged vs 53dcd9c; built.json
// re-derivable). Own code, no model calls. Writes out/freeze-keys.json.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..'); const ROOT = path.resolve(TS, '..', '..');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); const mt = (f) => fs.statSync(f).mtime.getTime(); const iso = (t) => new Date(t).toISOString();
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const FILMS = ['incredibles', 'big-hero-6', 'brave'];
const out = {};
// ---- freeze
const fzF = path.join(V, 'out102', 'freeze.json'); const fz = rj(fzF);
const rows = Object.entries(fz.files).map(([rel, h]) => { const p = path.join(V, rel); const ex = fs.existsSync(p); return { rel, ok: ex && sha(p) === h, m: ex ? mt(p) : null }; });
const fresh = fs.readdirSync(path.join(V, 'out102')).filter((f) => FILMS.some((s) => f.startsWith(`${s}.`))).map((f) => ({ f, m: mt(path.join(V, 'out102', f)) })).sort((a, b) => a.m - b.m);
const logs = fs.existsSync(path.join(V, 'out102', 'logs')) ? fs.readdirSync(path.join(V, 'out102', 'logs')).filter((f) => FILMS.some((s) => f.includes(s))).map((f) => ({ f: `logs/${f}`, m: mt(path.join(V, 'out102', 'logs', f)) })) : [];
const srcs = FILMS.map((s) => path.join(V, 'sources', `${s}.json`)).filter(fs.existsSync).map((f) => ({ f: path.relative(V, f), m: mt(f) }));
const first = Math.min(...[...fresh, ...logs, ...srcs].map((x) => x.m));
const parentF = path.join(TS, 'v10_1', 'out101', 'freeze.json');
out.freeze = { sha256: sha(fzF), frozen_at: fz.frozen_at, files: rows.length, mismatched: rows.filter((r) => !r.ok).map((r) => r.rel), parent_sha_matches: fz.parent_freeze?.sha256 === sha(parentF), parent_sha: fz.parent_freeze?.sha256,
  freeze_file_mtime: iso(mt(fzF)), first_fresh_artifact: `${[...fresh, ...logs, ...srcs].sort((a, b) => a.m - b.m)[0].f} ${iso(first)}`, frozen_before_first_fresh: Date.parse(fz.frozen_at) < first && mt(fzF) < first,
  frozen_files_changed_after_first_fresh: rows.filter((r) => r.m > first).map((r) => r.rel), dev_films: fz.dev_films, fresh_in_dev: FILMS.filter((s) => (fz.dev_films ?? []).includes(s)) };
// every v10.2 top-level code/config file is in the freeze list, unchanged
const tops = fs.readdirSync(V).filter((f) => /\.(js|mjs|json)$/.test(f));
out.freeze.toplevel_not_in_freeze = tops.filter((f) => !fz.files[f]);
out.freeze.toplevel_changed_after_first_fresh = tops.filter((f) => mt(path.join(V, f)) > first);
const shared = ['taxonomy-v3.js', 'common.js', 'glossary.json', 'srt.js', 'claude.js'].map((f) => path.join(TS, f)).filter(fs.existsSync);
out.freeze.shared_changed_after_first_fresh = shared.filter((f) => mt(f) > first).map((f) => path.relative(TS, f));
out.freeze.shared_git_dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...shared]).toString().trim().split('\n').filter(Boolean);
// ---- held-out hygiene: v10.2 code, dev and eval (incl. their outputs) and out102/dev,seen never name a fresh film
const walk = (d, acc = []) => { if (!fs.existsSync(d)) return acc; for (const x of fs.readdirSync(d)) { const p = path.join(d, x); const st = fs.statSync(p); if (st.isDirectory()) walk(p, acc); else acc.push(p); } return acc; };
const RE = /incredibles|big-hero-6|big hero 6|\bbrave\b|syndrome|merida|baymax/i;
const scanDirs = ['dev', 'eval', 'test', 'labels', 'sources', path.join('out102', 'dev'), path.join('out102', 'seen')].map((d) => path.join(V, d));
const files = [...tops.map((f) => path.join(V, f)), ...scanDirs.flatMap((d) => walk(d))].filter((p) => /\.(js|mjs|json|jsonl|log|txt)$/.test(p));
const named = files.filter((f) => { if (fs.statSync(f).size > 60e6) return false; return RE.test(fs.readFileSync(f, 'utf8')); }).map((f) => `${path.relative(V, f)} ${iso(mt(f))}${mt(f) > first ? ' (after first fresh output)' : ''}`);
out.holdout = { scanned_files: files.length, files_naming_fresh_film: named };
// ---- key blindness
const keyFiles = FILMS.flatMap((s) => [`refs/${s}.key.json`, `refs/${s}.film.json`, `data/${s}.srt`]).concat(['refs/audits.json', 'refs/ledger.jsonl', 'films.json']);
const led = fs.readFileSync(path.join(TS, 'refs', 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const r8 = led.filter((e) => FILMS.some((s) => String(e.call ?? '').includes(s)));
out.keys = {
  mtimes: Object.fromEntries(keyFiles.map((f) => [f, fs.existsSync(path.join(TS, f)) ? iso(mt(path.join(TS, f))) : null])),
  keys_before_freeze: FILMS.every((s) => mt(path.join(TS, 'refs', `${s}.key.json`)) < Date.parse(fz.frozen_at)),
  keys_before_first_fresh: FILMS.every((s) => mt(path.join(TS, 'refs', `${s}.key.json`)) < first),
  audits_before_first_fresh: mt(path.join(TS, 'refs', 'audits.json')) < first,
  last_fresh_ledger_entry: r8.map((e) => e.at).sort().pop(), fresh_ledger_entries: r8.length, ledger_commands_run: r8.reduce((a, e) => a + (e.commands?.length ?? 0), 0), ledger_usd: r8.reduce((a, e) => a + (e.usd ?? 0), 0),
  key_text_mentions_pipeline: FILMS.filter((s) => /v10_?2|out102|v10\.2|tags\.r1|round8/i.test(fs.readFileSync(path.join(TS, 'refs', `${s}.key.json`), 'utf8'))),
  refs_code_mentions_pipeline: ['collect.js', 'map.js', 'rules.js'].filter((f) => /out102|v10_2|round8|tags\.r1/.test(fs.readFileSync(path.join(TS, 'refs', f), 'utf8'))),
  counts: Object.fromEntries(FILMS.map((s) => { const k = rj(path.join(TS, 'refs', `${s}.key.json`)); const h = k.items.filter((i) => i.source !== 'codex-rules'); const cr = k.items.filter((i) => i.source === 'codex-rules'); return [s, { human: h.length, human_mappable: h.filter((i) => i.mappable).length, should_flag_mapped: h.filter((i) => i.mappable && Number.isFinite(i.start_ms) && i.should_flag === true).length, codex_rules: cr.length, villain: cr.filter((i) => i.marker === 'villain_threat').length, child: cr.filter((i) => i.marker === 'child_terrified').length, human_villain_policy: h.filter((i) => i.policy?.villain_threat).length, validation_problems: (k.validation_problems ?? []).length, held_out: k.held_out }]; })),
};
// ---- live baseline: import closure of run-live.mjs unchanged vs 53dcd9c and clean in the working tree
const closure = new Set(); const q = [path.join(V, 'round8', 'run-live.mjs')];
while (q.length) { const f = q.pop(); const src = fs.readFileSync(f, 'utf8'); for (const m of src.matchAll(/from '(\.[^']+)'/g)) { const p = path.resolve(path.dirname(f), m[1]); if (p.includes(`${path.sep}scene-api${path.sep}`) && !closure.has(p)) { closure.add(p); q.push(p); } } }
const rel = [...closure].map((p) => path.relative(ROOT, p)).sort();
const diff = execFileSync('git', ['-C', ROOT, 'diff', '--name-only', '53dcd9c', '--', ...rel]).toString().trim();
const status = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', ...rel]).toString().trim();
const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', ...rel]).toString().trim().split('\n').filter(Boolean);
out.live = { closure: rel, changed_vs_53dcd9c: diff ? diff.split('\n') : [], dirty: status ? status.split('\n') : [], untracked_in_closure: rel.filter((r) => !tracked.includes(r)),
  closure_mtimes_latest: iso(Math.max(...[...closure].map(mt))), live_outputs: Object.fromEntries(FILMS.map((s) => [s, ['scenes', 'presence', 'built', 'spend'].map((k) => `${k} ${iso(mt(path.join(V, 'round8', 'live', `${s}.${k}.json`)))}`)])) };
fs.writeFileSync(path.join(here, 'out', 'freeze-keys.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
