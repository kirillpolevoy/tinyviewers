// v10.1 fix 1: end credits (credits.js) in the split gate and in selection; per-attempt segment caps (budget.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { creditsSpan, cueKind, isCreditsScene, nonCreditMinutes } from '../credits.js';
import { codeMetrics, gateResult } from '../gate.js';
import { attemptCaps, budget } from '../budget.js';
import { loadPolicy, selectRun } from '../select.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..');
const TS = path.resolve(V101, '..');
const POLICY = JSON.parse(fs.readFileSync(path.join(V101, 'policy.json'), 'utf8'));
const cuesOf = (slug) => parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));

// the rule was set on these 14 dev SRTs; each film's span (or none) is pinned here
const DEV_SPANS = {
  nemo: null, 'monsters-inc': null, 'iron-giant': null, 'good-dinosaur': null,
  // (a run of lyric lines with no spoken line is found by both rules; the label says 'music_run' then)
  'lion-king': [1301, 1359, 'music_run'], frankenweenie: [968, 1009, 'music_run'], 'wild-robot': [1734, 1795, 'music_run'],
  up: [1169, 1185, 'music_run'], tangled: [1217, 1253, 'music_run'], coco: [1698, 1724, 'music_run_from_subtitle_credit_line'],
  'how-to-train-your-dragon': [868, 869, 'trailing_credit_lines'], 'book-of-life': [1882, 1943, 'song_block'],
  'princess-and-the-frog': [1617, 1667, 'music_run'], moana: [1327, 1336, 'music_run'],
};
test('credits: the span found on every dev film SRT (the films the rule was set on)', () => {
  for (const [slug, want] of Object.entries(DEV_SPANS)) {
    const sp = creditsSpan(cuesOf(slug), POLICY.credits);
    if (!want) { assert.equal(sp, null, `${slug}: no captioned credits`); continue; }
    assert.deepEqual([sp.start_cue, sp.end_cue, sp.how], want, slug);
  }
});

const mk = (texts, { startMs = 60 * 60_000, step = 3000, gapAt = {} } = {}) => {
  let t = startMs;
  return texts.map((text, i) => { t += gapAt[i] ?? step; return { index: i + 1, startMs: t, endMs: t + 2000, text }; });
};
test('credits: cue kinds (lyric = unpunctuated / marked / repeated; speaker labels and dashes are speech)', () => {
  assert.equal(cueKind('♪ Let it go ♪'), 'music');
  assert.equal(cueKind('* I will be there *'), 'music');
  assert.equal(cueKind('(UPBEAT SONG PLAYING)'), 'music');
  assert.equal(cueKind('Subtitles by someone'), 'credit');
  assert.equal(cueKind('(DOOR SLAMS)'), 'caption');
  assert.equal(cueKind('Where are you going?'), 'speech');
  assert.equal(cueKind('ANNA: Wait for me'), 'speech');
  assert.equal(cueKind('- Come on - Okay'), 'speech');
  assert.equal(cueKind('Under the open sky'), 'lyric');
  assert.equal(cueKind('We are free.', true), 'lyric');
});
test('credits: a film that ends on dialogue has none; a song followed by more film is not credits', () => {
  const pre = Array.from({ length: 300 }, (_, i) => `Line ${i}.`);
  assert.equal(creditsSpan(mk(pre)), null);
  const song = Array.from({ length: 40 }, (_, i) => `under the sky number ${i % 5}`);
  const after = Array.from({ length: 60 }, (_, i) => `We talk again ${i}.`);
  assert.equal(creditsSpan(mk([...pre, ...song, ...after])), null, 'a song with 60 spoken lines after it is part of the film');
});
test('credits: sparse music captions after the last dialogue, then a short post-credits gag', () => {
  const pre = Array.from({ length: 300 }, (_, i) => `Line ${i}.`);
  const roll = ['(SONG PLAYING)', '(SONG PLAYING)', '(SONG PLAYING)', '(SONG PLAYING)', '(SONG PLAYING)'];
  const post = ['(GRUNTS)', 'Hey!', '(LAUGHS)'];
  const cues = mk([...pre, ...roll, ...post], { gapAt: { 300: 60_000, 301: 120_000, 302: 120_000, 303: 120_000, 304: 120_000, 305: 150_000 } });
  const sp = creditsSpan(cues);
  assert.ok(sp, 'found');
  assert.equal(sp.how, 'music_run');
  assert.deepEqual([sp.start_cue, sp.end_cue, sp.post_cues], [301, 305, 3]);
});
test('credits: scene minutes outside the span; credits scenes by share', () => {
  const cues = mk(Array.from({ length: 100 }, (_, i) => `x${i}.`), { step: 60_000 });
  const span = { start_cue: 51, end_cue: 90 };
  assert.equal(Math.round(nonCreditMinutes({ start_cue: 41, end_cue: 100 }, cues, span)), 9); // 91..100 = 9 min + 2 s
  assert.equal(Math.round(nonCreditMinutes({ start_cue: 51, end_cue: 90 }, cues, span)), 0);
  assert.equal(isCreditsScene({ start_cue: 41, end_cue: 90 }, span), true); // 40 of 50
  assert.equal(isCreditsScene({ start_cue: 20, end_cue: 60 }, span), false); // 10 of 41
});
test('gate: max_scene_minutes ignores the credits; the other code limits are unchanged', () => {
  // 60 spoken lines 5 s apart (5 min), then a 40-cue credits song 15 s apart (10 min); the last scene holds
  // 30 spoken lines + the whole song: 12.5 min with the credits, 2.5 min without
  const gapAt = Object.fromEntries(Array.from({ length: 40 }, (_, k) => [60 + k, 15_000]));
  const cues = mk([...Array.from({ length: 60 }, (_, i) => `Line ${i}.`), ...Array.from({ length: 40 }, () => '(SONG PLAYING)')], { step: 5000, gapAt });
  const scenes = [{ start_cue: 1, end_cue: 30, sentences: [] }, { start_cue: 31, end_cue: 100, sentences: [] }];
  const cr = creditsSpan(cues, POLICY.credits);
  assert.deepEqual([cr.start_cue, cr.end_cue], [61, 100]);
  const withC = codeMetrics(scenes, cues, { credits: cr }).metrics;
  const without = codeMetrics(scenes, cues, {}).metrics;
  assert.ok(without.max_scene_minutes > 12 && without.max_scene_minutes < 13, `without ${without.max_scene_minutes}`);
  assert.ok(withC.max_scene_minutes < 3, `with ${withC.max_scene_minutes}`);
  assert.equal(withC.max_scene_minutes_with_credits, without.max_scene_minutes);
  const cfg = { ...POLICY.split_gate, jev_optional: true };
  assert.ok(gateResult(without, null, cfg).failed.some((f) => f.startsWith('max_scene_minutes')));
  assert.ok(!gateResult(withC, null, cfg).failed.some((f) => f.startsWith('max_scene_minutes')));
});
test('gate replay: Frozen / Zootopia round-6 attempts now PASS; round-2 Wild Robot still FAILS; every dev split passes', () => {
  const r = spawnSync(process.execPath, [path.join(V101, 'dev', 'replay-gate.mjs')], { cwd: V101, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /all as expected: true/);
  assert.match(r.stdout, /frozen\s+round-6 attempt 1 \(whole film\)\s+v10 FAIL -> v10\.1 PASS/);
  assert.match(r.stdout, /zootopia\s+round-6 attempt 1 \(whole film\)\s+v10 FAIL -> v10\.1 PASS/);
  assert.match(r.stdout, /wild-robot\s+round-2 split\s+v10 FAIL -> v10\.1 FAIL/);
});
test('select: a credits scene gets no tags and no flags even when it has answers', () => {
  const cues = mk(Array.from({ length: 400 }, (_, i) => (i < 360 ? `Line ${i}.` : `(SONG PLAYING)`)), { step: 15_000 });
  const answers = { c: { dies: 0.95 }, s: { laughs: { score: 0 }, danger: { score: 3 } }, mod: {} };
  const row = (id, a, b) => ({ id, start_cue: a, end_cue: b, start_ms: cues[a - 1].startMs, end_ms: cues[b - 1].endMs, answers });
  const out = selectRun({ film: { slug: 't' }, scenes: [row('S001', 1, 359), row('S002', 360, 400)] }, loadPolicy(path.join(V101, 'policy.json')), { cues });
  assert.equal(out.scenes[0].flagged, true);
  assert.equal(out.scenes[1].flagged, false);
  assert.equal(out.scenes[1].credits, true);
  assert.deepEqual(out.summary.credits_scenes, ['S002']);
});

test('segment caps: attempt 2 is set aside first, so attempt 1 can never starve the halves retry', () => {
  const c0 = attemptCaps({ cap: 1.05, prior: 0, a1: 0.45, a2: 0.6 });
  assert.deepEqual([c0.a1_cap, c0.a2_cap], [0.45, 0.6]);
  assert.ok(c0.a1_cap + c0.a2_cap <= c0.film_left + 1e-12);
  assert.equal(c0.a2_after(0.45), 0.6); // attempt 1 spent its whole cap: attempt 2 still has its own
  const c1 = attemptCaps({ cap: 1.05, prior: 0.25, a1: 0.45, a2: 0.6 }); // a rerun after an earlier attempt 1
  assert.ok(Math.abs(c1.a1_cap - 0.2) < 1e-9 && c1.a2_cap === 0.6);
  const c2 = attemptCaps({ cap: 1.05, prior: 0.9, a1: 0.45, a2: 0.6 });
  assert.equal(c2.a1_cap, 0);
  assert.ok(Math.abs(c2.a2_cap - 0.15) < 1e-9);
  // round 6 as it was: one $0.45 cap for both attempts left attempt 2 nothing after a $0.45 reservation
  const old = budget(0.45); assert.equal(old.reserve(0.45), true); assert.equal(old.reserve(0.18), false);
});
test('segment.js --dry: attempt 1 reserves inside its own $0.45; each half of attempt 2 inside the $0.60 set aside', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v101-seg-'));
  const r = spawnSync(process.execPath, [path.join(V101, 'segment.js'), 'nemo', '--dry', '--offline'], { cwd: V101, encoding: 'utf8', env: { ...process.env, V101_OUT: tmp } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /attempt 1 cap \$0\.450, attempt 2 cap \$0\.600 set aside/);
  assert.match(r.stdout, /whole film: .* reserve \$0\.450 .* this attempt's cap \$0\.450/);
  assert.match(r.stdout, /attempt-2 cap \$0\.600/);
  const parts = [...r.stdout.matchAll(/part \d\/2 .* reserve \$(\d\.\d+)/g)].map((m) => Number(m[1]));
  assert.equal(parts.length, 2);
  assert.ok(parts[0] <= 0.3 + 1e-9, 'half 1 keeps half of the attempt-2 cap free for half 2');
  const rf = fs.readFileSync(path.join(V101, 'run-film.js'), 'utf8');
  assert.match(rf, /\['segment', 'segment\.js', \['--cap', '1\.05', '--attempt1-cap', '0\.45', '--attempt2-cap', '0\.60'/);
});
