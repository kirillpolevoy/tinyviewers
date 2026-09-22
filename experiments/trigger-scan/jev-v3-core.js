// Jev v3 analysis core — the part of run-jev-v3.js that both the runner and the recorder need.
//
// Nothing here decides what to write to disk. `analyzeFilm` performs exactly the analysis
// run-jev-v3.js has always performed (same beats, same questions, same model, same concurrency,
// same request splitting) and reports, per window, the answers and the usage it saw. The caller
// passes its own `post`, which is how record-jev-run.js times every request without changing the
// work being done.
import { PRESENCE, EVENTS, MODIFIERS, SEVERITY_SCORES } from './taxonomy-v3.js';
import { loadFilm, pool, postJson } from './common.js';

export const API_URL = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-1.13.0';
export const PRICE_PER_MTOK = 0.042;
export const MAX_BEAT_CUES = 8;
export const BEAT_GAP_MS = 2000;
export const CONCURRENCY = 8;

// Jev accepts up to 64k tokens per request. Estimate conservatively (3.2 chars per token on this
// kind of English) and split a window's questions into several requests over the same state if the
// estimate goes above the ceiling. Splitting only ever changes how many requests are sent; the
// state, the beat paths and the question text stay identical.
export const TOKEN_LIMIT = 64_000;
export const TOKEN_CEILING = 44_000; // leave head-room for the estimate being wrong
export const CHARS_PER_TOKEN = 3.2;
export const estTokens = (body) => Math.ceil(JSON.stringify(body).length / CHARS_PER_TOKEN);

export const authHeaders = () => ({ Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}` });
export const captionsOf = (text) => text.match(/\([A-Z][A-Z '\-,]+\)/g) ?? [];

// ---- the flag rule and the excerpt policy ---------------------------------------------------------
// Stated here, once, so the recorder writes it into every recording and the verifier and any front
// end read the same number instead of inventing one.
export const FLAG_CHANNELS = ['presence', 'event'];
export const FLAG_THRESHOLD = 0.7;
export const FLAG_RULE = 'A beat is flagged when any presence probability or any event probability is >= 0.70. The mention, modifier and score channels never flag a beat.';
export const EXCERPT_MAX_LINES = 2;
export const EXCERPT_MAX_WORDS = 12;

// ---- question construction -----------------------------------------------------------------------
// One entry per (beat, item). Keys are `b<beat>.<channel>.<id>`; ids never reach the model.
export function questionsForBeat(i) {
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

export function cutBeats(cues) {
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
export function planRequests(state, questions) {
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

// The state and the questions for one subtitle window. Pure: same input, same request bodies.
export function planWindow(w) {
  const local = new Map(w.cues.map((c, i) => [c.id, `L${String(i + 1).padStart(2, '0')}`]));
  const beats = cutBeats(w.cues);
  const state = { beats: beats.map((b) => ({ lines: b.map((c) => `${local.get(c.id)}| ${c.text}`) })) };
  const questions = Object.assign({}, ...beats.map((_, i) => questionsForBeat(i)));
  return { beats, state, questions, plan: planRequests(state, questions) };
}

// Which beat indices a split part carries questions for, in order.
export const beatIndicesOf = (questions) => [...new Set(Object.keys(questions).map((k) => Number(k.slice(1, k.indexOf('.')))))].sort((a, b) => a - b);

// ---- the run --------------------------------------------------------------------------------------
// `post(body, ctx)` must behave like common.js postJson: resolve to { json, latencyMs, ... }.
// ctx describes what the request is for, which is all a recorder needs to label it.
export async function analyzeFilm({ slug, limit, concurrency = CONCURRENCY, post } = {}) {
  const headers = authHeaders();
  const send = post ?? ((body) => postJson(API_URL, headers, body));
  const all = loadFilm(slug).windows;
  const windows = limit ? all.slice(0, Number(limit)) : all;

  // ---- pass 1: sound captions (SDH tracks only) ---------------------------------------------------
  const distinct = [...new Set(windows.flatMap((w) => w.cues.flatMap((c) => captionsOf(c.text))))];
  const captionBody = {
    model: MODEL,
    state: { captions: distinct },
    questions: Object.fromEntries(distinct.map((_, i) => [`c${i}`, {
      type: 'noul',
      instructions: `Is the sound described by \`captions[${i}]\` a sudden loud noise such as a scream, roar, crash, or explosion?`,
      criteria: { true: 'A sudden loud noise.', false: 'Quiet, gradual, or ordinary sounds: laughing, sighing, gasping, sobbing, singing, music, mumbling.' },
    }])),
  };
  const captionRes = !distinct.length
    ? { json: { answers: {}, usage: { input_tokens: 0, output_tokens: 0 } }, latencyMs: 0 }
    : await send(captionBody, { kind: 'captions', questionCount: distinct.length, beatIndices: [] });
  const loudOf = Object.fromEntries(distinct.map((c, i) => [c, captionRes.json.answers[`c${i}`].noul]));

  // ---- pass 2: one (or more) requests per window, all three layers per beat ------------------------
  let calls = distinct.length ? 1 : 0;
  let splitWindows = 0;
  let maxEst = 0;
  const perWindow = await pool(windows, concurrency, async (w) => {
    const { beats, state, plan } = planWindow(w);
    if (plan.length > 1) splitWindows++;
    maxEst = Math.max(maxEst, ...plan.map((p) => p.est));

    const answers = {};
    const answeredBy = {}; // beat index -> ids of the requests that carried its questions
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    for (const [part_i, part] of plan.entries()) {
      const beatIndices = beatIndicesOf(part.questions);
      const res = await send(
        { model: MODEL, state, questions: part.questions },
        { kind: 'beats', windowId: w.id, part: part_i, parts: plan.length, estTokens: part.est, questionCount: Object.keys(part.questions).length, beatIndices },
      );
      Object.assign(answers, res.json.answers);
      inputTokens += res.json.usage.input_tokens;
      outputTokens += res.json.usage.output_tokens ?? 0;
      latencyMs += res.latencyMs;
      for (const i of beatIndices) (answeredBy[i] ??= []).push(res.requestId ?? null);
      calls++;
    }

    const rows = beats.map((b, i) => {
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
        requestIds: answeredBy[i] ?? [],
      };
    });
    return { window: w, cueBeats: beats, beats: rows, inputTokens, outputTokens, latencyMs, nRequests: plan.length };
  });

  return {
    windows,
    perWindow,
    loudOf,
    captionCount: distinct.length,
    captionUsage: captionRes.json.usage,
    calls,
    splitWindows,
    maxEst,
    inputTokens: perWindow.reduce((s, r) => s + r.inputTokens, 0) + (captionRes.json.usage.input_tokens ?? 0),
    outputTokens: perWindow.reduce((s, r) => s + r.outputTokens, 0) + (captionRes.json.usage.output_tokens ?? 0),
  };
}
