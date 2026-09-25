#!/usr/bin/env node
// Round-5 VERIFIER: freeze integrity, import closure of the pipeline vs the frozen list, timeline
// (freeze vs held-out outputs vs keys vs split files), and split.json provenance. No model calls.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const V9 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TS = path.resolve(V9, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const birth = (f) => { const t = execSync(`stat -f %B ${JSON.stringify(f)}`).toString().trim(); return new Date(Number(t) * 1000).toISOString(); };
const mtime = (f) => fs.statSync(f).mtime.toISOString();
const fz = rj(path.join(V9, 'out', 'freeze.json'));
const T0 = fz.frozen_at;
const out = { frozen_at: T0, n_files: Object.keys(fz.files).length, mismatch: [], modified_after_freeze: [], closure_not_frozen: [], held: {}, keys: {}, split: {} };
for (const [f, h] of Object.entries(fz.files)) {
  const p = path.join(V9, f);
  if (sha(p) !== h) out.mismatch.push(f);
  if (mtime(p) > T0) out.modified_after_freeze.push(`${f} ${mtime(p)}`);
}
// import closure from run-film.js and every stage script it spawns
const seen = new Set(); const frozen = new Set(Object.keys(fz.files).map((f) => path.resolve(V9, f)));
function walk(p) {
  if (seen.has(p) || !fs.existsSync(p)) return; seen.add(p);
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/(?:import[^'"]*from\s*|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) walk(path.resolve(path.dirname(p), m[1]));
  for (const m of src.matchAll(/['"]([a-z0-9-]+\.(?:js|mjs))['"]/g)) { const q = path.resolve(V9, m[1]); if (fs.existsSync(q)) walk(q); } // spawned stage scripts
}
walk(path.join(V9, 'run-film.js'));
out.closure = [...seen].map((p) => path.relative(V9, p));
out.closure_not_frozen = [...seen].filter((p) => !frozen.has(p)).map((p) => path.relative(V9, p));
out.closure_not_frozen_changed_after_freeze = [...seen].filter((p) => !frozen.has(p) && mtime(p) > T0).map((p) => `${path.relative(V9, p)} ${mtime(p)}`);
// held-out outputs: birth/mtime vs freeze; ledger first entry
for (const s of ['book-of-life', 'princess-and-the-frog', 'moana']) {
  const files = fs.readdirSync(path.join(V9, 'out')).filter((x) => x.startsWith(`${s}.`));
  const b = files.map((x) => [x, birth(path.join(V9, 'out', x))]).sort((a, c) => (a[1] < c[1] ? -1 : 1));
  const led = rj(path.join(V9, 'out', `${s}.spend.json`));
  const at = led.entries.map((e) => e.at).filter(Boolean).sort();
  const sources = path.join(V9, 'sources');
  const src = fs.existsSync(sources) ? fs.readdirSync(sources).filter((x) => x.includes(s)).map((x) => [x, birth(path.join(sources, x))]) : [];
  out.held[s] = { files: files.length, earliest_birth: b[0], before_freeze: b.filter((x) => x[1] < T0), ledger_first: at[0], ledger_last: at.at(-1), ledger_before_freeze: at.filter((x) => x < T0).length, sources_files: src, sources_before_freeze: src.filter((x) => x[1] < T0) };
  const kf = path.join(TS, 'refs', `${s}.key.json`); const sf = path.join(TS, 'data', `${s}.srt`);
  out.keys[s] = { key_sha: sha(kf), key_birth: birth(kf), key_mtime: mtime(kf), srt_sha: sha(sf), srt_birth: birth(sf), srt_mtime: mtime(sf) };
}
// live outputs
out.live = Object.fromEntries(fs.readdirSync(path.join(V9, 'round5', 'live')).map((x) => [x, birth(path.join(V9, 'round5', 'live', x))]));
// split provenance
for (const f of ['split.json', 'split.js', 'split/stage-a.mjs', 'split/stage-a.json', 'split/stage-b.mjs', 'split/stage-b.json', 'split/decide.mjs']) {
  const p = path.join(V9, f); out.split[f] = { birth: birth(p), mtime: mtime(p), before_freeze: mtime(p) < T0 };
}
// does any split-deciding script or its inputs mention a held-out slug?
const heldRe = /book-of-life|princess-and-the-frog|moana|book of life|princess and the frog/i;
out.split.mentions_held_out = ['split.json', 'split/stage-a.mjs', 'split/stage-a.json', 'split/stage-b.mjs', 'split/stage-b.json', 'split/decide.mjs'].filter((f) => heldRe.test(fs.readFileSync(path.join(V9, f), 'utf8')));
fs.writeFileSync(path.join(V9, 'verify', 'r5', 'out', 'freeze-audit.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
