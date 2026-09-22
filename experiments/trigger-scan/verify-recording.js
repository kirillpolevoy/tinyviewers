// verify-recording.js — assert that a recording is internally consistent and text-free.
//
//   node verify-recording.js nemo
//   node verify-recording.js            # every recording in recordings/
//
// Nothing here calls the API. It only reads recordings/<slug>.jev.json and checks that it says the
// same thing in every way it says it, so a front end can trust it without re-deriving anything.
import fs from 'node:fs';
import path from 'node:path';
import { here } from './common.js';
import { FLAG_THRESHOLD, FLAG_CHANNELS } from './jev-v3-core.js';

// A string in the tracked recording is safe only if it has no spaces: subtitle text has spaces, ids,
// slugs, model names, ISO dates and shas do not. The prose that states the flag rule is the one
// deliberate exception, and it is a fixed string this repo wrote.
const TEXT_FREE_EXEMPT = new Set(['thresholds.flag_rule']);
const SAFE_STRING = /^[\w.:+-]+$/;

function* strings(node, p = '') {
  if (typeof node === 'string') yield [p, node];
  else if (Array.isArray(node)) for (const [i, v] of node.entries()) yield* strings(v, `${p}[${i}]`);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) yield* strings(v, p ? `${p}.${k}` : k);
}

function verify(slug) {
  const file = path.join(here, 'recordings', `${slug}.jev.json`);
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { meta, requests, beats, timeline, thresholds } = rec;
  const fails = [];
  const ok = (cond, msg) => {
    if (!cond) fails.push(msg);
  };
  const close = (a, b, eps) => Math.abs(a - b) <= eps;

  // ---- 1. every beat answered exactly once ---------------------------------------------------------
  const byId = new Map(requests.map((r) => [r.id, r]));
  ok(new Set(beats.map((b) => b.id)).size === beats.length, 'beat ids are not unique');
  ok(beats.length === meta.beats, `meta.beats ${meta.beats} != ${beats.length} beat rows`);
  for (const b of beats) {
    ok(b.request_id !== null && byId.has(b.request_id), `${b.id}: request_id ${b.request_id} is not a recorded request`);
    ok(b.request_ids.length > 0 && b.request_ids.includes(b.request_id), `${b.id}: resolving request is not among request_ids`);
    ok(new Set(b.request_ids).size === b.request_ids.length, `${b.id}: duplicate request_ids`);
    const resolver = byId.get(b.request_id);
    ok(b.request_ids.every((id) => byId.get(id).received_ms <= resolver.received_ms), `${b.id}: a carrying request landed after the resolver`);
  }
  // exactly one resolving request per beat, and requests[].beats is the same relation seen sideways
  const resolveCount = new Map(beats.map((b) => [b.id, 0]));
  for (const b of beats) resolveCount.set(b.id, resolveCount.get(b.id) + 1);
  ok([...resolveCount.values()].every((n) => n === 1), 'some beat is resolved more than once');
  const carried = requests.flatMap((r) => r.beats);
  ok(carried.length === beats.reduce((s, b) => s + b.request_ids.length, 0), 'requests[].beats and beats[].request_ids disagree');
  ok(new Set(carried).size === beats.length, `requests cover ${new Set(carried).size} distinct beats, expected ${beats.length}`);
  for (const r of requests) ok(new Set(r.beats).size === r.beats.length, `${r.id}: lists a beat twice`);
  // beats are in film order
  ok(beats.every((b, i) => i === 0 || b.start_ms >= beats[i - 1].start_ms), 'beats are not in film order');

  // ---- 2. answer counts ---------------------------------------------------------------------------
  const qpb = meta.questions_per_beat;
  ok(meta.total_answers === beats.length * qpb, `meta.total_answers ${meta.total_answers} != beats x questions_per_beat ${beats.length * qpb}`);
  const carriedQuestions = requests.filter((r) => r.kind === 'beats').reduce((s, r) => s + r.questions, 0);
  ok(carriedQuestions === meta.total_answers, `requests carried ${carriedQuestions} beat questions, expected ${meta.total_answers}`);
  for (const b of beats) {
    const n = Object.values(b.answers).reduce((s, ch) => s + Object.keys(ch).length, 0);
    ok(n === qpb, `${b.id}: ${n} answers stored, expected ${qpb}`);
    for (const [ch, vals] of Object.entries(b.answers)) {
      if (ch === 'score') {
        for (const [id, s] of Object.entries(vals)) {
          ok(s.score >= 0 && s.score <= 3, `${b.id}.${id}: score out of range`);
          ok(close(Object.values(s.probabilities).reduce((x, y) => x + y, 0), 1, 0.02), `${b.id}.${id}: level probabilities do not sum to 1`);
        }
      } else {
        for (const [id, p] of Object.entries(vals)) ok(typeof p === 'number' && p >= 0 && p <= 1, `${b.id}.${ch}.${id}: ${p} is not a probability`);
      }
    }
  }

  // ---- 3. offsets monotonic and inside wall_ms ----------------------------------------------------
  ok(requests.length === meta.requests, `meta.requests ${meta.requests} != ${requests.length} rows`);
  ok(requests[0].sent_ms === 0, `first request sent_ms is ${requests[0].sent_ms}, expected 0 (run start)`);
  requests.forEach((r, i) => {
    ok(i === 0 || r.sent_ms >= requests[i - 1].sent_ms, `${r.id}: sent_ms goes backwards against send order`);
    ok(r.received_ms >= r.sent_ms, `${r.id}: received before sent`);
    ok(r.sent_ms >= 0 && r.received_ms <= meta.wall_ms, `${r.id}: [${r.sent_ms}, ${r.received_ms}] outside wall_ms ${meta.wall_ms}`);
    ok(r.status === 200, `${r.id}: status ${r.status}`);
    ok(r.retries >= 0, `${r.id}: negative retries`);
  });
  ok(close(Math.max(...requests.map((r) => r.received_ms)), meta.wall_ms, 0.001), 'wall_ms is not the last received_ms');

  // ---- 4. concurrency never exceeded -------------------------------------------------------------
  const events = requests.flatMap((r) => [{ t: r.sent_ms, d: 1 }, { t: r.received_ms, d: -1 }]).sort((a, b) => a.t - b.t || a.d - b.d);
  let live = 0;
  let peak = 0;
  for (const e of events) {
    live += e.d;
    peak = Math.max(peak, live);
  }
  ok(peak <= meta.concurrency, `${peak} requests in flight at once, concurrency is ${meta.concurrency}`);
  ok(timeline.every((e) => e.in_flight_after >= 0 && e.in_flight_after <= meta.concurrency), 'timeline in_flight_after is outside [0, concurrency]');

  // ---- 5. timeline counters end at the meta totals ------------------------------------------------
  ok(timeline.length === requests.length, `timeline has ${timeline.length} entries, ${requests.length} requests`);
  ok(timeline.every((e, i) => i === 0 || e.t_ms >= timeline[i - 1].t_ms), 'timeline is not sorted by t_ms');
  for (const k of ['answers_returned', 'input_tokens', 'beats_resolved_total', 'cost_usd']) {
    ok(timeline.every((e, i) => i === 0 || e[k] >= timeline[i - 1][k]), `timeline.${k} is not non-decreasing`);
  }
  const last = timeline[timeline.length - 1];
  ok(last.answers_returned === meta.total_answers, `timeline ends at ${last.answers_returned} answers, meta says ${meta.total_answers}`);
  ok(last.input_tokens === meta.input_tokens, `timeline ends at ${last.input_tokens} input tokens, meta says ${meta.input_tokens}`);
  ok(last.beats_resolved_total === beats.length, `timeline resolves ${last.beats_resolved_total} beats, ${beats.length} exist`);
  ok(close(last.cost_usd, meta.cost_usd, 1e-6), `timeline ends at $${last.cost_usd}, meta says $${meta.cost_usd}`);
  const tlIds = new Set(timeline.map((e) => e.request_id));
  ok(tlIds.size === requests.length && requests.every((r) => tlIds.has(r.id)), 'timeline and requests are not the same set');
  ok(timeline.flatMap((e) => e.resolves_beats).length === beats.length, 'timeline resolves a number of beats other than beats.length');
  for (const e of timeline) ok(close(e.t_ms, byId.get(e.request_id).received_ms, 0.001), `${e.request_id}: timeline t_ms != received_ms`);

  // ---- 6. cost = input tokens x price ------------------------------------------------------------
  ok(meta.input_tokens === requests.reduce((s, r) => s + r.input_tokens, 0), 'meta.input_tokens != sum of request input_tokens');
  ok(close(meta.cost_usd, (meta.input_tokens / 1e6) * meta.price_per_mtok, 1e-9), `cost_usd ${meta.cost_usd} != input_tokens x price`);

  // ---- 7. no subtitle text ----------------------------------------------------------------------
  for (const [p, s] of strings(rec)) {
    if (TEXT_FREE_EXEMPT.has(p)) continue;
    ok(s.length <= 80, `${p}: string of ${s.length} chars, longer than 80 (possible subtitle text)`);
    ok(SAFE_STRING.test(s), `${p}: "${s.slice(0, 40)}" contains spaces or punctuation — ids, slugs, dates and model names do not`);
  }

  // ---- 8. flagged beats match the rule ----------------------------------------------------------
  ok(thresholds.flag_threshold === FLAG_THRESHOLD, `recorded threshold ${thresholds.flag_threshold} != ${FLAG_THRESHOLD}`);
  ok(String(thresholds.flag_channels) === String(FLAG_CHANNELS), `recorded flag channels ${thresholds.flag_channels} != ${FLAG_CHANNELS}`);
  const expect = beats.filter((b) => [...Object.values(b.answers.presence), ...Object.values(b.answers.event)].some((p) => p >= thresholds.flag_threshold));
  ok(expect.length === thresholds.flagged.length, `rule flags ${expect.length} beats, thresholds lists ${thresholds.flagged.length}`);
  ok(thresholds.flagged_beats === thresholds.flagged.length, 'thresholds.flagged_beats != thresholds.flagged.length');
  ok(expect.every((b) => b.flagged), 'a beat matching the rule is not marked flagged');
  ok(beats.filter((b) => b.flagged).length === expect.length, 'a beat is marked flagged that the rule does not flag');
  const listed = new Map(thresholds.flagged.map((f) => [f.beat_id, f]));
  for (const b of expect) {
    const f = listed.get(b.id);
    ok(!!f, `${b.id} matches the rule but is not in thresholds.flagged`);
    if (!f) continue;
    ok(f.top.length === Math.min(3, Object.keys(b.answers.presence).length + Object.keys(b.answers.event).length), `${b.id}: top list is not three items`);
    ok(f.top.every((x, i) => i === 0 || x.p <= f.top[i - 1].p), `${b.id}: top items are not sorted by probability`);
    ok(f.top[0].p >= thresholds.flag_threshold, `${b.id}: top item is below the threshold`);
    for (const x of f.top) ok(b.answers[x.channel][x.id] === x.p, `${b.id}: top item ${x.channel}.${x.id} does not match the stored probability`);
    ok(close(f.t_ms, byId.get(b.request_id).received_ms, 0.001), `${b.id}: flagged t_ms != resolving request received_ms`);
  }

  return { slug, fails, meta, size: fs.statSync(file).size };
}

const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = slugs.length
  ? slugs
  : fs.readdirSync(path.join(here, 'recordings')).filter((f) => f.endsWith('.jev.json')).map((f) => f.replace('.jev.json', ''));

let bad = 0;
for (const slug of all) {
  const { fails, meta } = verify(slug);
  if (fails.length) {
    bad++;
    console.log(`FAIL ${slug}: ${fails.length} problems`);
    for (const f of fails.slice(0, 20)) console.log(`  - ${f}`);
    if (fails.length > 20) console.log(`  ... ${fails.length - 20} more`);
  } else {
    console.log(`ok   ${slug}: ${meta.beats} beats x ${meta.questions_per_beat} questions = ${meta.total_answers} answers, ${meta.requests} requests, ${(meta.wall_ms / 1000).toFixed(1)}s, $${meta.cost_usd.toFixed(4)}, ${meta.retries} retries`);
  }
}
if (bad) process.exitCode = 1;
