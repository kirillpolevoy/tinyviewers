// PARITY: the ported stages (pipeline-jevfirst/stages/*) produce what the frozen experiment (v10.4)
// produces, on a real film's stored outputs. No network, no keys, no model calls.
//
//   check_describe  the port, fed a Jev stub that REPLAYS the answers stored in round 9's why.r1.json,
//                   reaches the same per-text verdicts and the same why for every flagged scene as the
//                   experiment's own run did (v10.4's check-describe.js is v10.3's, byte for byte).
//   mergetext + select3  the port's text merge (A0>C) and final selection, from the stored stage outputs,
//                   equal the experiment's CLIs (describe2.js --merge, select.js) run on the same files:
//                   flags, flag reasons, severity, skip spans, the shown text and title, and why_tags.
//
// EXPLICITLY OPTIONAL: these are integration tests against real films' outputs, which cannot be committed
// (subtitles and Wikipedia text). Data: experiments/trigger-scan/v10_3/out103 (round 9: croods, onward,
// kung-fu-panda) and data/*.srt, from this worktree or the main checkout. Without them each test is skipped
// with a reason saying so; set JEVFIRST_REQUIRE_PARITY=1 (the pack sync / release check does) to make a
// missing fixture a FAILURE instead. Every mandatory contract (orchestration, demo, money, rebuild) is in
// jevfirst.test.js on committed synthetic fixtures and never skips.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_EXPERIMENT_DIR } from '../load.js';
import { parseSrt } from '../pipeline-jevfirst/srt.js';
import { budget } from '../pipeline-jevfirst/pack/budget.js';
import { withRun } from '../pipeline-jevfirst/context.js';
import { checkDescribeStage, mergeText, describe2Stage, titlesStage } from '../pipeline-jevfirst/stages/text.js';
import { selectStage, resolveStage, mortalStage } from '../pipeline-jevfirst/stages/answers.js';
import { guideRows } from '../pipeline-jevfirst/stages/ingest.js';
import { jsonResponse } from './jevfirst-stubs.js';

const MAIN_TS = path.resolve(DEFAULT_EXPERIMENT_DIR, '..', '..', '..', 'toddler-movies', 'experiments', 'trigger-scan');
const TS = [DEFAULT_EXPERIMENT_DIR, MAIN_TS].find((d) => fs.existsSync(path.join(d, 'v10_3', 'out103', 'croods.why.r1.json')) && fs.existsSync(path.join(d, 'v10_4', 'describe2.js')));
const FILMS = ['croods', 'onward', 'kung-fu-panda'];
const present = (slug) => Boolean(TS && fs.existsSync(path.join(TS, 'data', `${slug}.srt`)) && fs.existsSync(path.join(TS, 'v10_3', 'sources', `${slug}.json`)));
const REQUIRED = process.env.JEVFIRST_REQUIRE_PARITY === '1';
/** Present, or (when required) a loud failure rather than a quiet skip. */
const have = (slug) => {
  if (present(slug)) return true;
  if (REQUIRED) throw new Error(`JEVFIRST_REQUIRE_PARITY=1 but the round-9 outputs for ${slug} are not on this machine`);
  return false;
};

const read = (slug, suffix) => JSON.parse(fs.readFileSync(path.join(TS, 'v10_3', 'out103', `${slug}.${suffix}`), 'utf8'));

function stored(slug) {
  const files = {
    segments: 'segments.json', classify: 'jev.r1.json', sonnetq: 'sonnetq.r1.json', childcry: 'childcry.r1.json', resolve: 'resolve.r1.json',
    mortal: 'mortal.r1.json', moments: 'moments.r1.json', describe: 'describe.r1.json', describe2: 'describe2.r1.json', describe3: 'describe3.r1.json',
    why: 'why.r1.json', why2: 'why2.r1.json', why3: 'why3.r1.json', tags: 'tags.r1.json',
  };
  const d = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, read(slug, f)]));
  d.sources = JSON.parse(fs.readFileSync(path.join(TS, 'v10_3', 'sources', `${slug}.json`), 'utf8'));
  d.cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  return d;
}

/** A stage context over stored outputs (no database, no money beyond a budget). */
function ctxFor(d, out, fetchImpl = async () => { throw new Error('no network in this test'); }) {
  return {
    mode: 'add', cues: d.cues, film: d.segments.film,
    out: (id) => out[id] ?? null, has: (id) => id in out, stored: () => null, detail: () => {},
    wallet: (name, cap) => { const b = budget(cap); return { budget: b, cap, run: (fn) => withRun({ fetchImpl, keys: { typesafe: 'x' }, sleep: async () => {} }, fn) }; },
  };
}

/** A Jev stub that answers check-describe's requests from the answers stored in a why file. */
function replayJev(why) {
  const rows = Object.values(why.scenes).flatMap((s) => s.checked);
  const byText = new Map();
  for (const r of rows) if (!byText.has(r.text)) byText.set(r.text, r);
  const seen = new Map(); // identical support / wsupport bodies (a plot-only text): support is sent first
  const choice = (probs) => { const [k, v] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]; return { choice: k, confidence: v, probabilities: probs }; };
  const three = (a, b, names) => { const rest = Math.max(0, 1 - a - b); return { [names[0]]: a, [names[1]]: b, [names[2]]: +rest.toFixed(4) }; };
  const answer = (body) => {
    const q = body.questions;
    if (q.r0) {
      const { claim, evidence } = body.state.claims[0];
      const row = byText.get(claim);
      if (!row) throw new Error(`no stored row for ${claim}`);
      const onlyW = evidence.length > 0 && evidence.every((e) => /^W\d+ \(Wikipedia/.test(e));
      const hasL = evidence.some((e) => /^L\d+ \(subtitle/.test(e));
      const key = JSON.stringify(body);
      const nth = (seen.get(key) ?? 0) + 1;
      seen.set(key, nth);
      const w = onlyW && !hasL && row.p_w_supports != null && (row.cites.some((c) => c[0] === 'L') || nth > 1);
      return { r0: choice(three(Number(w ? row.p_w_supports : row.p_supports) || 0, Number(w ? row.p_w_contradicts : row.p_contradicts) || 0, ['supports', 'contradicts', 'says_nothing'])) };
    }
    if (q.placement) { const row = byText.get(body.state.event); return { placement: choice(three(Number(row.p_fits) || 0, Number(row.p_conflicts) || 0, ['fits', 'conflicts', 'cannot_tell'])) }; }
    if (q.shown) { const row = byText.get(body.state.event); const n = Number(row.p_neighbour_neither) || 0; const r = +((1 - n) / 2).toFixed(4); return { shown: choice({ neither: n, before: r, after: r }) }; }
    if (q.direction) {
      const row = rows.find((r) => r.direction && body.state && JSON.stringify(q.direction).includes(r.direction.agent ?? '\u0000'));
      const dd = row?.direction ?? { p_forward: 1, p_reverse: 0, p_neither: 0 };
      return { direction: choice({ forward: dd.p_forward, reverse: dd.p_reverse, neither: dd.p_neither }) };
    }
    // the states request: r<k>.s<j>, stored k-major in the scene whose verified sentences these are
    const sents = body.state.sentences;
    const scene = Object.values(why.scenes).find((s) => { const keys = [...new Set(s.states.map((x) => x.sentence))]; return keys.length === sents.length && keys.every((k, j) => s.checked.find((c) => c.key === k)?.text === sents[j]); });
    if (!scene) throw new Error('no stored states for these sentences');
    return Object.fromEntries(Object.keys(q).map((k) => { const [, rk, sj] = k.match(/^r(\d+)\.s(\d+)$/); return [k, { noul: scene.states[Number(rk) * sents.length + Number(sj)].p }]; }));
  };
  return async (url, init) => jsonResponse({ model: 'jev-1.13.0', answers: answer(JSON.parse(init.body)), usage: { input_tokens: 1000, output_tokens: 5 } });
}

for (const slug of FILMS) {
  test(`${slug}: the check_describe port reaches the experiment's verdicts and whys from the same Jev answers (attempts 1-3)`, { skip: !have(slug) && 'OPTIONAL parity fixture: no round-9 outputs on this machine (JEVFIRST_REQUIRE_PARITY=1 makes this fail)' }, async () => {
    const d = stored(slug);
    for (const [attempt, descKey, whyKey] of [[1, 'describe', 'why'], [2, 'describe2', 'why2'], [3, 'describe3', 'why3']]) {
      const want = d[whyKey];
      const out = { refold: { segments: d.segments }, select2: d.tags, [attempt === 3 ? 'titles' : descKey]: d[descKey], classify: d.classify, sources: d.sources };
      const got = await checkDescribeStage(ctxFor(d, out, replayJev(want)), attempt);
      const texts = Object.values(want.scenes).flatMap((x) => x.checked).length;
      if (texts) assert.ok(got.requests > 0, `${slug} attempt ${attempt} asked Jev`);
      assert.equal(got.verified, want.verified, `${slug} attempt ${attempt} verified`);
      assert.deepEqual(Object.keys(got.scenes).sort(), Object.keys(want.scenes).sort());
      for (const [id, w] of Object.entries(want.scenes)) {
        const g = got.scenes[id];
        assert.deepEqual(g.checked.map((c) => [c.key, c.final, c.via]), w.checked.map((c) => [c.key, c.final, c.via]), `${slug} attempt ${attempt} ${id} statuses`);
        assert.deepEqual({ ...g.why }, { ...w.why }, `${slug} attempt ${attempt} ${id} why`);
      }
    }
  });

  test(`${slug}: mergetext (A0>C) and select3 equal the experiment's describe2.js --merge and select.js`, { skip: !have(slug) && 'OPTIONAL parity fixture: no round-9 outputs on this machine (JEVFIRST_REQUIRE_PARITY=1 makes this fail)' }, async () => {
    const d = stored(slug);
    // the experiment's own CLIs, on copies of the same files, in a scratch output directory
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `v104-${slug}-`));
    for (const f of fs.readdirSync(path.join(TS, 'v10_3', 'out103')).filter((x) => x.startsWith(`${slug}.`))) fs.copyFileSync(path.join(TS, 'v10_3', 'out103', f), path.join(tmp, f));
    const run = (args) => { const r = spawnSync(process.execPath, args, { cwd: path.join(TS, 'v10_4'), env: { ...process.env, V104_OUT: tmp }, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
    run(['describe2.js', slug, '--merge', '--final-held-out-run']);
    run(['select.js', slug]);
    const wantFinal = JSON.parse(fs.readFileSync(path.join(tmp, `${slug}.whyfinal.r1.json`), 'utf8'));
    const wantTags = JSON.parse(fs.readFileSync(path.join(tmp, `${slug}.tags.r1.json`), 'utf8'));
    fs.rmSync(tmp, { recursive: true, force: true });

    // the scenes the second attempt and the title pass are asked about are the experiment's (retryScenes /
    // titleScenes on the strict why): in demo mode the port keeps exactly the stored answers for them
    const demo = (out) => ({ ...ctxFor(d, out), mode: 'demo', stored: (k) => d[k] ?? null });
    const d2 = await describe2Stage(demo({ select2: d.tags, check_describe: d.why }));
    assert.deepEqual(Object.keys(d2.scenes).sort(), Object.keys(d.describe2.scenes).sort());
    assert.deepEqual(d2.not_stored, []);
    const d3 = await titlesStage(demo({ select2: d.tags, check_describe: d.why, check_describe2: d.why2 }));
    assert.deepEqual(Object.keys(d3.scenes).sort(), Object.keys(d.describe3.scenes).sort());

    const merged = mergeText({ why1: d.why, why2: d.why2, why3: d.why3, describe: d.describe, describe2: d.describe2, describe3: d.describe3 });
    for (const k of ['flagged', 'retried', 'title_pass', 'no_text', 'placeholder_title', 'text_strict', 'text_loose', 'title_strict', 'title_loose']) assert.equal(merged[k], wantFinal[k], `${slug} merge ${k}`);
    assert.deepEqual(merged.strict_mismatch, []);
    for (const [id, w] of Object.entries(wantFinal.scenes)) assert.deepEqual(merged.scenes[id].why, w.why, `${slug} ${id} merged why`);

    const out = { classify: d.classify, sonnetq: d.sonnetq, childcry: d.childcry, resolve: d.resolve, mortal: d.mortal, moments: d.moments, mergetext: merged };
    const tags = selectStage(ctxFor(d, out), { moments: d.moments, why: merged });
    const pick = (t) => t.scenes.map((s) => ({ id: s.id, flagged: s.flagged, reasons: (s.flag_reasons ?? []).map((r) => `${r.id}:${r.by}`), sev: s.severity ? [s.severity['5-7'].level, s.severity['8-10'].level] : null, skip: s.skip?.spans ?? null, why: s.why ?? null, why_tags: s.why_tags ?? null }));
    assert.deepEqual(pick(tags), pick(wantTags));
    // every flagged scene says why, and the guide rows carry it
    const rows = guideRows(tags);
    assert.ok(rows.length > 0);
    for (const r of rows) { assert.ok(r.why.length > 0, `${slug} ${r.scene_id} has why tags`); assert.ok(r.why.every((t) => t.by.every((b) => b === 'jev' || b === 'sonnet'))); }
  });
}

for (const slug of FILMS) {
  test(`${slug}: resolve and mortal ask the same scenes the same questions as the experiment did`, { skip: !have(slug) && 'OPTIONAL parity fixture: no round-9 outputs on this machine (JEVFIRST_REQUIRE_PARITY=1 makes this fail)' }, async () => {
    const d = stored(slug);
    const asked = [];
    const fetchImpl = async (u, init) => { const b = JSON.parse(init.body); asked.push(b); return jsonResponse({ model: b.model, answers: Object.fromEntries(Object.keys(b.questions).map((k) => [k, { noul: 0.5 }])), usage: { input_tokens: 100, output_tokens: 1 } }); };
    const out = { refold: { segments: d.segments }, sonnetq: d.sonnetq };
    const rv = await resolveStage(ctxFor(d, out, fetchImpl));
    assert.equal(rv.requests, d.resolve.requests);
    assert.deepEqual(Object.keys(rv.scenes).sort(), Object.keys(d.resolve.scenes).sort());
    for (const [id, s] of Object.entries(d.resolve.scenes)) assert.deepEqual(Object.keys(rv.scenes[id].guard ?? {}).sort(), Object.keys(s.guard ?? {}).sort(), id);
    const mv = await mortalStage(ctxFor(d, out, fetchImpl));
    assert.equal(mv.requests, d.mortal.requests);
    assert.deepEqual(mv.asked, d.mortal.asked);
    assert.deepEqual(Object.keys(mv.scenes).sort(), Object.keys(d.mortal.scenes).sort());
    for (const [id, s] of Object.entries(d.mortal.scenes)) assert.deepEqual(Object.keys(mv.scenes[id]).sort(), Object.keys(s).sort(), id);
  });
}
