// Jev v3 — the three-layer taxonomy (taxonomy-v3.js) asked over the same beat units as run-jev-v2.js.
//
//   node run-jev-v3.js --film nemo
//   node run-jev-v3.js --film monsters-inc --label r2
//   node run-jev-v3.js --all                 # every film in films.json
//
// Same request design as v2: one request per subtitle window, beats of at most 8 cues addressed by
// path (`beats[2].lines`), every question a narrow Noul or a single-dimension Score, all combination
// logic in code. What is new:
//   - Layer A presence questions (what is on screen, regardless of threat or tone)
//   - a parallel `mention` question per presence item (talked about while not there)
//   - Layer B events, Layer C modifiers + four Scores
//   - every raw probability is stored per beat; nothing is thresholded here
//   - requests are split when the estimated token count would approach the 64k request limit
//
// The analysis itself lives in jev-v3-core.js, which record-jev-run.js also uses so that a recorded
// run is the same run. This file only shapes the result into runs-v3/ output.
import fs from 'node:fs';
import path from 'node:path';
import { COUNTS } from './taxonomy-v3.js';
import { parseArgs, saveRun, here } from './common.js';
import { analyzeFilm, MODEL, PRICE_PER_MTOK, TOKEN_LIMIT, TOKEN_CEILING, CONCURRENCY } from './jev-v3-core.js';

const args = parseArgs();
const films = args.all
  ? Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8')))
  : [args.film ?? 'nemo'];

async function runFilm(slug) {
  const startedAt = new Date().toISOString();
  // --limit N: only the first N windows, for smoke tests and token measurement
  const a = await analyzeFilm({ slug, limit: args.limit, concurrency: CONCURRENCY });

  // Window-level usage and latency are reported on the window's first beat, as they always were.
  const beats = a.perWindow.flatMap((r) => r.beats.map(({ requestIds, ...b }, i) => ({
    ...b,
    usage: i === 0 ? { input_tokens: r.inputTokens, requests: r.nRequests } : { input_tokens: 0, requests: 0 },
    latencyMs: i === 0 ? r.latencyMs : 0,
  })));

  const inputTokens = a.inputTokens;
  const run = {
    arm: 'jev-v3-layers',
    taxonomy: 'v3',
    film: slug,
    track: slug,
    label: args.label,
    model: MODEL,
    startedAt,
    wallMs: Date.now() - Date.parse(startedAt),
    counts: { ...COUNTS, windows: a.windows.length, beats: beats.length },
    calls: a.calls,
    windowsSplitIntoSeveralRequests: a.splitWindows,
    tokenLimit: TOKEN_LIMIT,
    tokenCeilingPerRequest: TOKEN_CEILING,
    largestEstimatedRequestTokens: a.maxEst,
    inputTokens,
    outputTokens: 0,
    costUsd: (inputTokens / 1e6) * PRICE_PER_MTOK,
    captions: a.loudOf,
    beats,
  };
  const file = saveRun(run, args.dir ?? 'runs-v3');
  console.log(`${slug}: ${run.calls} calls (${a.splitWindows} windows split), ${beats.length} beats, ${COUNTS.questionsPerBeat} questions/beat, ${inputTokens} input tokens, $${run.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)}s, largest request ~${a.maxEst} tok`);
  console.log(`  saved ${file}`);
  return run;
}

const runs = [];
for (const slug of films) runs.push(await runFilm(slug));
if (runs.length > 1) {
  console.log(`\ntotal: $${runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} across ${runs.length} films, ${runs.reduce((s, r) => s + r.beats.length, 0)} beats`);
}
