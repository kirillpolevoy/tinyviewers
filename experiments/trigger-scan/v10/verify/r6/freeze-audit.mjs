#!/usr/bin/env node
// Round-6 VERIFIER: freeze integrity (own sha256 of every listed file), freeze.json sha256, import closure of
// run-film.js vs the frozen list, timeline (freeze < held-out subtitles < keys < held-out pipeline outputs),
// key hashes vs the key builder's report, split.json / decisions provenance (dev-only, pre-freeze), held-out
// names in pre-freeze v10 build inputs, and files changed after the freeze. No model calls, no network.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const V10 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS = path.resolve(V10, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const birth = (f) => new Date(Number(execSync(`stat -f %B ${JSON.stringify(f)}`).toString().trim()) * 1000).toISOString();
const mtime = (f) => fs.statSync(f).mtime.toISOString();
const HELD = ['frozen', 'zootopia', 'good-dinosaur'];
const fzFile = path.join(V10, 'out10', 'freeze.json');
const fz = rj(fzFile); const T0 = fz.frozen_at;
const out = { frozen_at: T0, freeze_json_sha256: sha(fzFile), freeze_json_birth: birth(fzFile), freeze_json_mtime: mtime(fzFile), n_files: Object.keys(fz.files).length, mismatch: [], modified_after_freeze: [] };
for (const [f, h] of Object.entries(fz.files)) { const p = path.join(V10, f); if (sha(p) !== h) out.mismatch.push(f); if (mtime(p) > T0) out.modified_after_freeze.push(`${f} ${mtime(p)}`); }
out.jev_set_sha = sha(path.join(V10, 'jev-set.js')); out.split_json_sha = sha(path.join(V10, 'split.json'));
out.decisions_sha = sha(path.join(V10, 'assemble', 'decisions.json')); out.decisions_sha12_matches_freeze = out.decisions_sha.slice(0, 12) === fz.decisions_sha256_12;
out.decisions_mtime = mtime(path.join(V10, 'assemble', 'decisions.json'));
// import closure (static imports, dynamic imports, spawned stage scripts, json reads by name)
const seen = new Set(); const frozen = new Set(Object.keys(fz.files).map((f) => path.resolve(V10, f)));
function walk(p) {
  if (seen.has(p) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return; seen.add(p);
  if (!/\.(m?js)$/.test(p)) return;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/(?:import[^'"]*from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.resolve(path.dirname(p), m[1]));
  for (const m of src.matchAll(/['"]([a-z0-9-]+\.(?:js|mjs|json))['"]/g)) { const q = path.resolve(V10, m[1]); if (fs.existsSync(q)) walk(q); }
}
walk(path.join(V10, 'run-film.js'));
out.closure = [...seen].map((p) => path.relative(V10, p));
out.closure_not_frozen = [...seen].filter((p) => !frozen.has(p)).map((p) => `${path.relative(V10, p)} mtime ${mtime(p)}`);
out.closure_not_frozen_changed_after_freeze = [...seen].filter((p) => !frozen.has(p) && mtime(p) > T0).map((p) => path.relative(V10, p));
// timeline per held-out film
const claimedKeys = { frozen: '5c1c560232716be94e8182bdebe39db0e30003f32fa7070250c0237a762801ce', zootopia: '11436a86e0a9913bddf7cc7aa6a093b1eb6e3d479608e36a476d1739c2b82a23', 'good-dinosaur': '6f39c200c67dfa5fbe0bf0cc9f0c4062d21615451750e5898aa0c868f6cbfda2' };
out.held = {};
const dirs = [path.join(V10, 'out10'), path.join(V10, 'out10', 'logs'), path.join(V10, 'round6', 'live'), path.join(V10, 'round6', 'out'), path.join(V10, 'round6', 'out', 'frozen-config'), path.join(V10, 'round6', 'out', 'logs'), path.join(V10, 'sources')];
for (const s of HELD) {
  const outs = dirs.flatMap((d) => fs.readdirSync(d).filter((x) => x.startsWith(`${s}.`)).map((x) => path.join(d, x)));
  const births = outs.map((p) => [path.relative(V10, p), birth(p)]).sort((a, b) => (a[1] < b[1] ? -1 : 1));
  const kf = path.join(TS, 'refs', `${s}.key.json`); const sf = path.join(TS, 'data', `${s}.srt`);
  const led = rj(path.join(V10, 'out10', `${s}.spend.json`)).entries.map((e) => e.at).filter(Boolean).sort();
  const liveLed = rj(path.join(V10, 'round6', 'live', `${s}.spend.json`)).entries.map((e) => e.at).filter(Boolean).sort();
  out.held[s] = {
    srt_birth: birth(sf), key_birth: birth(kf), key_mtime: mtime(kf), key_sha: sha(kf), key_sha_matches_report: sha(kf) === claimedKeys[s],
    pipeline_outputs: outs.length, earliest_pipeline_output: births[0], outputs_before_freeze: births.filter((x) => x[1] < T0),
    outputs_before_key_final: births.filter((x) => x[1] < mtime(kf)).map((x) => x[0]),
    v10_ledger_first: led[0], live_ledger_first: liveLed[0], srt_after_freeze: birth(sf) > T0,
  };
}
// refs/ files touched after the first held-out pipeline output
const firstOut = Object.values(out.held).map((h) => h.earliest_pipeline_output[1]).sort()[0];
out.first_heldout_output = firstOut;
const refsAfter = []; (function scan(d) { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) scan(p); else if (mtime(p) > firstOut) refsAfter.push(path.relative(TS, p)); } })(path.join(TS, 'refs'));
out.refs_modified_after_first_output = refsAfter;
// split/decisions provenance: before freeze; build inputs name only dev films
const heldRe = /zootopia|good[-_ ]dinosaur|frozen[-_ ]?2013|"frozen"|'frozen'|\bElsa\b|\bAnna\b|\bOlaf\b|\bArlo\b|\bJudy Hopps\b|\bNick Wilde\b/i;
out.split = {};
for (const f of ['split.json', 'jev-set.js', 'assemble/decisions.json', 'assemble/decide.mjs', 'assemble/build.mjs', 'assemble/targets.mjs', 'assemble/fixrun/run.mjs']) {
  const p = path.join(V10, f); if (!fs.existsSync(p)) { out.split[f] = 'missing'; continue; }
  const txt = fs.readFileSync(p, 'utf8');
  out.split[f] = { birth: birth(p), mtime: mtime(p), before_freeze: mtime(p) < T0, held_out_mentions: (txt.match(new RegExp(heldRe.source, 'gi')) ?? []).slice(0, 5) };
}
// fixrun answer files: which films
const fr = path.join(V10, 'assemble', 'fixrun', 'out');
out.fixrun_films = fs.existsSync(fr) ? [...new Set(fs.readdirSync(fr).map((x) => x.split('.')[0]))] : null;
out.fixrun_films_not_dev = (out.fixrun_films ?? []).filter((x) => !fz.dev_films.includes(x));
out.fixrun_latest_mtime = fs.existsSync(fr) ? fs.readdirSync(fr).map((x) => mtime(path.join(fr, x))).sort().at(-1) : null;
out.dev_films = fz.dev_films; out.dev_contains_held = fz.dev_films.filter((x) => HELD.includes(x));
// frozen files and every other v10 file changed after the freeze (outside run outputs)
const after = []; (function scan(d) { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); const r = path.relative(V10, p); if (/^(out10|round6|sources|verify|labels)\b/.test(r)) continue; if (fs.statSync(p).isDirectory()) scan(p); else if (mtime(p) > T0) after.push(`${r} ${mtime(p)}`); } })(V10);
out.v10_files_changed_after_freeze = after;
fs.writeFileSync(path.join(V10, 'verify', 'r6', 'out', 'freeze-audit.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
