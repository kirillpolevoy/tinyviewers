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
// Reuses common.js and srt.js unchanged. Output goes to runs-v3/.
import fs from 'node:fs';
import path from 'node:path';
import { PRESENCE, EVENTS, MODIFIERS, SEVERITY_SCORES, COUNTS } from './taxonomy-v3.js';
import { loadFilm, parseArgs, pool, postJson, saveRun, here } from './common.js';

const MODEL = 'jev-1.13.0';
const PRICE_PER_MTOK = 0.042;
const MAX_BEAT_CUES = 8;
const BEAT_GAP_MS = 2000;

// Jev accepts up to 64k tokens per request. Estimate conservatively (3.2 chars per token on this
// kind of English) and split a window's questions into several requests over the same state if the
// estimate goes above the ceiling. Splitting only ever changes how many requests are sent; the
// state, the beat paths and the question text stay identical.
const TOKEN_LIMIT = 64_000;
const TOKEN_CEILING = 44_000; // leave head-room for the estimate being wrong
const CHARS_PER_TOKEN = 3.2;
const estTokens = (body) => Math.ceil(JSON.stringify(body).length / CHARS_PER_TOKEN);

const args = parseArgs();
const films = args.all
  ? Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'films.json'), 'utf8')))
  : [args.film ?? 'nemo'];

// ---- question construction -----------------------------------------------------------------------
// One entry per (beat, item). Keys are `b<beat>.<channel>.<id>`; ids never reach the model.
function questionsForBeat(i) {
  const P = `\`beats[${i}].lines\``;
  const sub = (s) => s.replace(/\bP\b/, P);
  const out = {};
  for (const item of PRESENCE) {
    out[`b${i}.presence.${item.id}`] = { type: 'noul', instructions: sub(item.question), criteria: { true: item.yes, false: item.no } };
    if (item.mention) out[`b${i}.mention.${item.id}`] = { type: 'noul', instructions: sub(item.mentionQuestion), criteria: { false: 'If it is there in the scene, the answer is no. If these lines do not bring it up, the answer is no.' } };
  }
  for (const item of EVENTS) {
    out[`b${i}.event.${item.id}`] = { type: 'noul', instructions: sub(item.question), ...(item.no ? { criteria: { false: item.no } } : {}) };
  }
  for (const [id, m] of Object.entries(MODIFIERS)) {
    out[`b${i}.modifier.${id}`] = { type: 'noul', instructions: sub(m.question), ...(m.no ? { criteria: { false: m.no } } : {}) };
  }
  for (const [id, s] of Object.entries(SEVERITY_SCORES)) {
    out[`b${i}.score.${id}`] = { type: 'score', instructions: sub(s.instructions), criteria: s.levels };
  }
  return out;
}

function cutBeats(cues) {
  const beats = [[]];
  for (const c of cues) {
    const cur = beats[beats.length - 1];
    if (cur.length && (cur.length >= MAX_BEAT_CUES || c.startMs - cur[cur.length - 1].endMs >= BEAT_GAP_MS)) beats.push([c]);
    else cur.push(c);
  }
  // fold a 1-2 cue fragment into its predecessor so a lone gasp is not judged without context
  return beats.reduce((out, b) => (out.length && b.length < 3 && out[out.length - 1].length + b.length <= MAX_BEAT_CUES + 2 ? (out[out.length - 1].push(...b), out) : [...out, b]), []);
}

// Split one window's questions into as few requests as fit under TOKEN_CEILING.
function planRequests(state, questions) {
  const entries = Object.entries(questions);
  const whole = { model: MODEL, state, questions };
  if (estTokens(whole) <= TOKEN_CEILING) return [{ questions, est: estTokens(whole) }];
  const stateTokens = estTokens({ model: MODEL, state, questions: {} });
  const budget = TOKEN_CEILING - stateTokens;
  const parts = [];
  let cur = {};
  let curTokens = 0;
  for (const [k, q] of entries) {
    const t = Math.ceil(JSON.stringify([k, q]).length / CHARS_PER_TOKEN);
    if (curTokens && curTokens + t > budget) {
      parts.push(cur);
      cur = {};
      curTokens = 0;
    }
    cur[k] = q;
    curTokens += t;
  }
  if (Object.keys(cur).length) parts.push(cur);
  return parts.map((p) => ({ questions: p, est: estTokens({ model: MODEL, state, questions: p }) }));
}

const headers = { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` };
const captionsOf = (text) => text.match(/\([A-Z][A-Z '\-,]+\)/g) ?? [];

async function runFilm(slug) {
  const startedAt = new Date().toISOString();
  const all = loadFilm(slug).windows;
  // --limit N: only the first N windows, for smoke tests and token measurement
  const windows = args.limit ? all.slice(0, Number(args.limit)) : all;

  // ---- pass 1: sound captions (SDH tracks only) ---------------------------------------------------
  const distinct = [...new Set(windows.flatMap((w) => w.cues.flatMap((c) => captionsOf(c.text))))];
  const captionRes = !distinct.length
    ? { json: { answers: {}, usage: { input_tokens: 0 } } }
    : await postJson('https://api.typesafe.ai/v1/systemone', headers, {
      model: MODEL,
      state: { captions: distinct },
      questions: Object.fromEntries(distinct.map((_, i) => [`c${i}`, {
        type: 'noul',
        instructions: `Is the sound described by \`captions[${i}]\` a sudden loud noise such as a scream, roar, crash, or explosion?`,
        criteria: { true: 'A sudden loud noise.', false: 'Quiet, gradual, or ordinary sounds: laughing, sighing, gasping, sobbing, singing, music, mumbling.' },
      }])),
    });
  const loudOf = Object.fromEntries(distinct.map((c, i) => [c, captionRes.json.answers[`c${i}`].noul]));

  // ---- pass 2: one (or more) requests per window, all three layers per beat ------------------------
  let calls = distinct.length ? 1 : 0;
  let splitWindows = 0;
  let maxEst = 0;
  const perWindow = await pool(windows, 8, async (w) => {
    const local = new Map(w.cues.map((c, i) => [c.id, `L${String(i + 1).padStart(2, '0')}`]));
    const beats = cutBeats(w.cues);
    const state = { beats: beats.map((b) => ({ lines: b.map((c) => `${local.get(c.id)}| ${c.text}`) })) };
    const questions = Object.assign({}, ...beats.map((_, i) => questionsForBeat(i)));

    const plan = planRequests(state, questions);
    if (plan.length > 1) splitWindows++;
    maxEst = Math.max(maxEst, ...plan.map((p) => p.est));

    const answers = {};
    let inputTokens = 0;
    let latencyMs = 0;
    for (const part of plan) {
      const { json, latencyMs: ms } = await postJson('https://api.typesafe.ai/v1/systemone', headers, { model: MODEL, state, questions: part.questions });
      Object.assign(answers, json.answers);
      inputTokens += json.usage.input_tokens;
      latencyMs += ms;
      calls++;
    }

    return beats.map((b, i) => {
      const pick = (channel, ids) => Object.fromEntries(ids.map((id) => [id, answers[`b${i}.${channel}.${id}`].noul]));
      const scores = Object.fromEntries(Object.keys(SEVERITY_SCORES).map((id) => {
        const a = answers[`b${i}.score.${id}`];
        return [id, { score: a.score, confidence: a.confidence, probabilities: a.probabilities }];
      }));
      return {
        beatId: `${w.id}.${i + 1}`,
        windowId: w.id,
        startMs: b[0].startMs,
        endMs: b[b.length - 1].endMs,
        cueIds: [b[0].id, b[b.length - 1].id],
        nCues: b.length,
        presence: pick('presence', PRESENCE.map((p) => p.id)),
        mention: pick('mention', PRESENCE.filter((p) => p.mention).map((p) => p.id)),
        events: pick('event', EVENTS.map((e) => e.id)),
        modifiers: pick('modifier', Object.keys(MODIFIERS)),
        scores,
        loudCaption: Math.max(0, ...b.flatMap((c) => captionsOf(c.text)).map((c) => loudOf[c])),
        usage: i === 0 ? { input_tokens: inputTokens, requests: plan.length } : { input_tokens: 0, requests: 0 },
        latencyMs: i === 0 ? latencyMs : 0,
      };
    });
  });

  const beats = perWindow.flat();
  const inputTokens = beats.reduce((s, r) => s + r.usage.input_tokens, 0) + captionRes.json.usage.input_tokens;
  const run = {
    arm: 'jev-v3-layers',
    taxonomy: 'v3',
    film: slug,
    track: slug,
    label: args.label,
    model: MODEL,
    startedAt,
    wallMs: Date.now() - Date.parse(startedAt),
    counts: { ...COUNTS, windows: windows.length, beats: beats.length },
    calls,
    windowsSplitIntoSeveralRequests: splitWindows,
    tokenLimit: TOKEN_LIMIT,
    tokenCeilingPerRequest: TOKEN_CEILING,
    largestEstimatedRequestTokens: maxEst,
    inputTokens,
    outputTokens: 0,
    costUsd: (inputTokens / 1e6) * PRICE_PER_MTOK,
    captions: loudOf,
    beats,
  };
  const file = saveRun(run, args.dir ?? 'runs-v3');
  console.log(`${slug}: ${run.calls} calls (${splitWindows} windows split), ${beats.length} beats, ${COUNTS.questionsPerBeat} questions/beat, ${inputTokens} input tokens, $${run.costUsd.toFixed(4)}, ${(run.wallMs / 1000).toFixed(1)}s, largest request ~${maxEst} tok`);
  console.log(`  saved ${file}`);
  return run;
}

const runs = [];
for (const slug of films) runs.push(await runFilm(slug));
if (runs.length > 1) {
  console.log(`\ntotal: $${runs.reduce((s, r) => s + r.costUsd, 0).toFixed(4)} across ${runs.length} films, ${runs.reduce((s, r) => s + r.beats.length, 0)} beats`);
}
