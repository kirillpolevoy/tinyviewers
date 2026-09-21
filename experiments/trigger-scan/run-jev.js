// Arm `jev-windowed`: code windows the SRT, Jev answers one yes/no per category + a severity
// score + a "which line is the peak" choice for every window. Raw probabilities are saved so
// thresholds can be retuned without calling the API again.
//
//   node run-jev.js --track sdh                 full run
//   node run-jev.js --track sdh --only W003,W012 --print   smoke test on a few windows
import fs from 'node:fs';
import { CATEGORIES, SEVERITY_QUESTION, SEVERITY_LEVELS, AUDIENCE } from './taxonomy.js';
import { buildWindows } from './srt.js';
import { loadTrack, glossary, cueLine, previousLines, parseArgs, pool, postJson, saveRun } from './common.js';

const MODEL = 'jev-1.13.0'; // pinned; `jev-latest` moves
const PRICE_PER_MTOK = 0.042; // input tokens only, output is free

const args = parseArgs();
const SCOPE = args['no-prev'] ? 'Judge the lines in `scene.lines`.' : 'Judge only the lines in `scene.lines`; `previous_lines` is background for who is speaking and what just happened.';
const track = args.track ?? 'sdh';
const loaded = loadTrack(track);
// Ablation switches (see ABLATIONS.md): --variant <name> --no-prev --no-glossary --plain --win <minSec,maxSec>
const variant = args.variant;
if (args.win) {
  const [minS, maxS] = args.win.split(',').map(Number);
  loaded.windows = buildWindows(loaded.cues, { minMs: minS * 1000, maxMs: maxS * 1000, gapMs: 2000 });
}
const lineOf = args.plain ? (c) => c.text : cueLine;
// --scenes-from <claude whole run>: Jev labels the scenes another analyzer found, instead of fixed windows.
const windows = args['scenes-from']
  ? JSON.parse(fs.readFileSync(args['scenes-from'], 'utf8')).events.filter((e) => e.validCues).map((e) => ({ id: e.id, title: e.title, startMs: e.startMs, endMs: e.endMs, cues: loaded.cues.filter((c) => c.startMs >= e.startMs && c.endMs <= e.endMs) }))
  : loaded.windows;
const selected = args.only ? windows.filter((w) => args.only.split(',').includes(w.id)) : windows;

function buildRequest(w, i) {
  const questions = {};
  for (const c of CATEGORIES) {
    questions[c.id] = { type: 'noul', instructions: `${c.question} ${SCOPE}`, criteria: { true: c.yes, false: c.no } };
  }
  questions.severity = { type: 'score', instructions: `${SEVERITY_QUESTION} ${SCOPE}`, criteria: SEVERITY_LEVELS };
  if (!args.plain) questions.peak = {
    type: 'choice',
    instructions: `Which single line in \`scene.lines\` is the most frightening or upsetting moment for ${AUDIENCE}? Each option is the id at the start of a line.`,
    criteria: { ...Object.fromEntries(w.cues.map((c) => [c.id, null])), none: 'No line in `scene.lines` is frightening or upsetting.' },
  };
  return {
    model: MODEL,
    state: {
      ...(args['no-glossary'] ? {} : { movie: glossary }),
      ...(args['no-prev'] || args['scenes-from'] ? {} : { previous_lines: previousLines(windows, i) }),
      scene: { lines: w.cues.map(lineOf) },
    },
    questions,
  };
}

const startedAt = new Date().toISOString();
const results = await pool(selected, 8, async (w) => {
  const i = windows.indexOf(w);
  const { json, latencyMs } = await postJson(
    'https://api.typesafe.ai/v1/systemone',
    { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` },
    buildRequest(w, i),
  );
  const a = json.answers;
  return {
    windowId: w.id,
    startMs: w.startMs,
    endMs: w.endMs,
    cueIds: [w.cues[0].id, w.cues[w.cues.length - 1].id],
    categories: Object.fromEntries(CATEGORIES.map((c) => [c.id, a[c.id].noul])),
    severity: a.severity.score,
    severityConfidence: a.severity.confidence,
    peakCue: a.peak?.choice ?? null,
    peakConfidence: a.peak?.confidence ?? null,
    model: json.model,
    usage: json.usage,
    latencyMs,
  };
});

const inputTokens = results.reduce((s, r) => s + r.usage.input_tokens, 0);
const run = {
  arm: args['scenes-from'] ? 'sonnet-finds+jev-labels' : variant ? `jev:${variant}` : 'jev-windowed',
  from: args['scenes-from'],
  track,
  label: args.label,
  model: results[0]?.model ?? MODEL,
  startedAt,
  wallMs: Date.now() - Date.parse(startedAt),
  calls: results.length,
  inputTokens,
  outputTokens: results.reduce((s, r) => s + r.usage.output_tokens, 0),
  costUsd: (inputTokens / 1e6) * PRICE_PER_MTOK,
  windows: results,
};

if (args.print) {
  for (const r of results) {
    const w = windows.find((x) => x.id === r.windowId);
    console.log(`\n${r.windowId} ${w.cues[0].id}-${w.cues.at(-1).id}  severity=${r.severity.toFixed(2)}  peak=${r.peakCue}  "${w.cues[0].text.slice(0, 50)}..."`);
    for (const [id, p] of Object.entries(r.categories)) console.log(`  ${p >= 0.5 ? '*' : ' '} ${id.padEnd(26)} ${p.toFixed(2)}`);
  }
}
if (!args.only) console.log('saved', saveRun(run, variant ? 'ablations' : 'runs'));
console.log(`${run.calls} calls, ${run.inputTokens} input tokens, $${run.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)}s wall, model ${run.model}`);
