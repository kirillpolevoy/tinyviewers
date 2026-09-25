#!/usr/bin/env node
// Copy the Jev-first pipeline's experiment modules into pipeline-jevfirst/pack/, VERBATIM.
//
//   node scripts/sync-jevfirst-pack.mjs --from ../experiments/trigger-scan/v10_1 [--check]
//
// The pack is v10.4 (experiments/trigger-scan/v10_4, frozen 2026-09-25, out104/freeze.json):
//   node scripts/sync-jevfirst-pack.mjs --from ../experiments/trigger-scan/v10_4 [--check]
// v10.4 adds resolve.js, mortal.js, bridge.js, describe2.js and textrule.js to the copied set. The CLI
// bodies of the stage scripts (segment, check-claims, classify, sonnetq, childcry, resolve, mortal,
// moments, describe, check-describe, describe2 --titles/--merge) are ported in pipeline-jevfirst/stages/.
//
// Why a verbatim copy and not an import (the same reasons pipeline/README.md gives for pipeline/):
// the experiment is outside the Vercel project, and an experiment is allowed to move -- a live add
// run for a parent must not change because someone is tuning a threshold. A copy makes the change a
// decision with a diff. Verbatim (not edited) so that the v10.2 swap is a copy and a test run, and so
// test/jevfirst-pack.test.js can assert each file is byte-identical to the source it names.
//
// What is NOT copied, and why: the experiment's env.js / ledger.js / jev-client.js / jev.js /
// sonnet.js do file I/O, read .env.local, or put upstream error bodies (which echo subtitle lines) in
// their messages. pack/ holds OUR versions of those five under the same names and exports (see each
// file's header), so the copied modules import them unchanged. The CLIs segment.js and
// check-claims.js run their whole body at import time and cannot be imported at all; their logic is
// ported into pipeline-jevfirst/stages.js. `--check` compares without writing (exit 1 on a drift).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(here, '..', 'pipeline-jevfirst', 'pack');

/** Copied byte for byte. Every name the pipeline imports from the experiment is in this list. */
export const COPIED = [
  'accept.js', 'aliases.js', 'bridge.js', 'budget.js', 'check-describe.js', 'check-split.js', 'childcry.js',
  'cite.js', 'claims.js', 'classify.js', 'combine.js', 'credits.js', 'describe.js', 'describe2.js', 'fill.js',
  'gate.js', 'jev-set.js', 'merge.js', 'moments.js', 'mortal.js', 'questions.js', 'reasons.js', 'refold.js',
  'resolve.js', 'segment-prompt.js', 'select.js', 'sonnet-questions.js', 'sonnetq.js', 'sources.js', 'spans.js',
  'split.js', 'text.js', 'textrule.js', 'textsafe.js', 'validate.js', 'policy.json', 'split.json',
];
/** Ours, never overwritten by a sync (same names and exports as the experiment's). */
export const SHIMS = ['env.js', 'ledger.js', 'jev-client.js', 'jev.js', 'sonnet.js'];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--from');
  if (i < 0 || !argv[i + 1]) { console.error('usage: node scripts/sync-jevfirst-pack.mjs --from <experiments/trigger-scan/v10_x> [--check]'); process.exit(2); }
  const from = path.resolve(argv[i + 1]);
  const check = argv.includes('--check');
  const repoRel = from.includes('experiments/trigger-scan') ? from.slice(from.indexOf('experiments/trigger-scan')) : from;
  const manifest = { source: repoRel, synced_at: new Date().toISOString(), files: {} };
  let drift = 0;
  for (const f of COPIED) {
    const src = path.join(from, f);
    if (!fs.existsSync(src)) { console.error(`missing in source: ${f}`); process.exit(3); }
    const buf = fs.readFileSync(src);
    manifest.files[f] = sha(buf);
    const dst = path.join(PACK, f);
    const same = fs.existsSync(dst) && sha(fs.readFileSync(dst)) === manifest.files[f];
    if (!same) drift++;
    if (check) { if (!same) console.log(`DRIFT ${f}`); continue; }
    fs.writeFileSync(dst, buf);
  }
  // The source may import a module we neither copy nor shim; the pack would then fail to load.
  const names = new Set([...COPIED, ...SHIMS]);
  for (const f of COPIED.filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(from, f), 'utf8');
    for (const m of text.matchAll(/from '\.\/([\w.-]+)'/g)) if (!names.has(m[1])) { console.error(`${f} imports ./${m[1]}, which is neither copied nor shimmed: add it to COPIED or write a shim`); drift++; }
    for (const m of text.matchAll(/from '\.\.\/([\w.-]+)'/g)) if (!['srt.js', 'taxonomy-v3.js'].includes(m[1])) { console.error(`${f} imports ../${m[1]}: pipeline-jevfirst/ has no shim for it`); drift++; }
  }
  if (check) { console.log(drift ? `${drift} file(s) differ from ${from}` : `pack matches ${from}`); process.exit(drift ? 1 : 0); }
  fs.writeFileSync(path.join(PACK, 'SOURCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`copied ${COPIED.length} files from ${from} (${drift} changed) -> ${path.relative(process.cwd(), PACK)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
