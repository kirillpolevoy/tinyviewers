// node --test test/  -- v7 skip-span discipline (moments.js sceneSpans / respanScenes, spans.js) and the
// comic carve-out (built, OFF by policy), plus the whole-film prompt being v6's byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sceneSpans, compactChoice, carveComic, subtractRanges, coreOf, wantsComic, comicQuestions, respanScenes, spansFromAnswers, COMIC_CLAUSE, planMoments } from '../moments.js';
import { loadPolicy } from '../select.js';
import { parseSrt, formatTime } from '../../srt.js';
import { makePrompts } from '../segment-prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = loadPolicy();
const withM = (m, w = {}) => ({ ...cfg, moments: { ...cfg.moments, ...m }, wordless: { ...cfg.wordless, ...w } });

// a 10-line scene, one line every 10 s from 100 s; the scene runs 95 s .. 200 s
const lineIds = Array.from({ length: 10 }, (_, i) => `L${i + 1}`);
const cues = lineIds.map((id, i) => ({ index: i + 1, startMs: 100000 + i * 10000, endMs: 102000 + i * 10000, text: `words ${i}` }));
const cuesById = new Map(cues.map((c) => [`L${c.index}`, c]));
const scene = { id: 'S001', start_ms: 95000, end_ms: 200000, start_cue: 1, end_cue: 10 };
const ch = (probs) => ({ choice: Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0], confidence: 0.8, probabilities: Object.fromEntries(lineIds.map((id) => [id, probs[id] ?? 0])) });
const clause = (name, exists, b, e) => ({ clause: name, exists, begin: ch({ [b]: 1 }), end: ch({ [e]: 1 }) });
const opts = (c, extra = {}) => ({ lineIds, cuesById, scene, cfg: c, cues, ...extra });
const len = (spans) => spans.reduce((a, x) => a + x.end_ms - x.start_ms, 0);

test('policy: the v7 span rule is what the dev films chose', () => {
  assert.equal(cfg.moments.not_shown, 'best_guess');
  assert.equal(cfg.moments.unshown, 'best_guess');
  assert.equal(cfg.moments.unshown_whole_max_ms, 90000);
  assert.equal(cfg.wordless.pad_back_ms, 20000);
  assert.equal(cfg.moments.comic_carve.enabled, false);
});

test('sceneSpans: shown reasons -> their spans only (never the whole scene)', () => {
  const r = sceneSpans([clause('a', 0.9, 'L3', 'L4')], opts(cfg));
  assert.equal(r.method, 'moments');
  assert.deepEqual(r.spans, [{ start_ms: 120000 - 20000, end_ms: 132000 + 5000 }]);
});

test('sceneSpans: a NOT-shown reason next to a shown one -> best-guess span (v7) / dropped / whole scene (v6)', () => {
  const rows = [clause('a', 0.9, 'L2', 'L2'), clause('b', 0.2, 'L8', 'L9')];
  const guess = sceneSpans(rows, opts(cfg));
  assert.equal(guess.method, 'moments');
  assert.deepEqual(guess.not_shown, ['not_in_lines: b']);
  assert.equal(guess.spans.length, 2, 'the not-shown reason keeps its own span from its begin/end lines');
  assert.deepEqual(guess.spans[1], { start_ms: 170000 - 20000, end_ms: 182000 + 5000 }, 'L8 (-20 s pad) .. L9 (+5 s)');
  const drop = sceneSpans(rows, opts(withM({ not_shown: 'drop' })));
  assert.equal(drop.spans.length, 1);
  const v6 = sceneSpans(rows, opts(withM({ not_shown: 'whole_scene' })));
  assert.equal(v6.method, 'whole_scene');
  assert.deepEqual(v6.spans.map((x) => [x.start_ms, x.end_ms]), [[95000, 200000]]);
  assert.ok(len(guess.spans) < len(v6.spans));
});

test('sceneSpans: NO reason shown -> best guess of the highest-exists reason; a short scene (<= 90 s) whole', () => {
  const rows = [clause('a', 0.3, 'L2', 'L3'), clause('b', 0.45, 'L6', 'L7')];
  const r = sceneSpans(rows, opts(cfg));
  assert.equal(r.method, 'moments_unshown');
  assert.match(r.why, /'b'/);
  assert.equal(r.spans.length, 1);
  assert.deepEqual(r.spans[0], { start_ms: 150000 - 20000, end_ms: 162000 + 5000 });
  const shortScene = { ...scene, end_ms: 95000 + 85000 };
  const s = sceneSpans(rows, { ...opts(cfg), scene: shortScene });
  assert.equal(s.method, 'whole_scene');
  const v6 = sceneSpans(rows, opts(withM({ unshown: 'whole_scene' })));
  assert.equal(v6.method, 'whole_scene');
});

test('compactChoice keeps choice, confidence and lines with p >= 0.005', () => {
  assert.deepEqual(compactChoice({ choice: 'L1', confidence: 0.61234, probabilities: { L1: 0.9, L2: 0.004, L3: 0.0961234 } }), { choice: 'L1', confidence: 0.612, probabilities: { L1: 0.9, L3: 0.0961 } });
  assert.equal(compactChoice(undefined), null);
});

test('spansFromAnswers keeps the raw answers; respanScenes re-applies any span rule offline from them', () => {
  const plan = { clauses: ['a', 'b'], lineIds };
  const answers = { 'begin.0': ch({ L2: 1 }), 'end.0': ch({ L3: 1 }), 'exists.0': { noul: 0.9 }, 'begin.1': ch({ L8: 0.7, L9: 0.3 }), 'end.1': ch({ L9: 1 }), 'exists.1': { noul: 0.3 } };
  const live = spansFromAnswers(plan, answers, cues, scene, cfg);
  assert.equal(live.answers.length, 2);
  const saved = { scenes: { S001: { ...live, reasons: ['x', 'y'] } } };
  const reasons = [{ id: 'x' }, { id: 'y' }];
  const items = [{ id: 'x', moment: 'a' }, { id: 'y', moment: 'b' }];
  const tags = { scenes: [{ ...scene, flagged: true, flag_reasons: reasons }] };
  const again = respanScenes({ tags, saved, cues, items, cfg });
  assert.deepEqual(again.S001.spans, live.spans, 'same policy, same spans');
  const v6 = respanScenes({ tags, saved, cues, items, cfg: withM({ not_shown: 'whole_scene' }) });
  assert.equal(v6.S001.method, 'whole_scene');
});

test('comic carve-out (off by policy): cuts the comic core, never the core lines of a shown flag reason', () => {
  assert.deepEqual(subtractRanges([{ start_ms: 0, end_ms: 100, lead_in: true }], [[20, 30], [90, 120]]), [{ start_ms: 0, end_ms: 20, lead_in: true }, { start_ms: 30, end_ms: 90 }]);
  assert.deepEqual(coreOf(clause('c', 0.9, 'L7', 'L5'), lineIds, cuesById), [140000, 162000], 'begin/end swapped when reversed');
  const on = withM({ comic_carve: { ...cfg.moments.comic_carve, enabled: true } });
  const spans = [{ start_ms: 95000, end_ms: 200000 }];
  const flag = [clause('a', 0.9, 'L2', 'L3')];
  const off = carveComic(spans, { comic: clause(COMIC_CLAUSE, 0.9, 'L6', 'L8'), perClause: flag, lineIds, cuesById, cfg });
  assert.equal(off.carved_ms, 0, 'disabled: nothing cut');
  const cut = carveComic(spans, { comic: clause(COMIC_CLAUSE, 0.9, 'L6', 'L8'), perClause: flag, lineIds, cuesById, cfg: on });
  assert.equal(cut.carved_ms, 172000 - 150000);
  const guarded = carveComic(spans, { comic: clause(COMIC_CLAUSE, 0.9, 'L2', 'L4'), perClause: flag, lineIds, cuesById, cfg: on });
  assert.deepEqual(guarded.comic.cuts, [[122000, 132000]], 'the flag reason core L2..L3 is protected; only L4 is cut');
  const low = carveComic(spans, { comic: clause(COMIC_CLAUSE, 0.2, 'L6', 'L8'), perClause: flag, lineIds, cuesById, cfg: on });
  assert.equal(low.carved_ms, 0, 'a comic moment not shown in the lines cuts nothing');
  assert.equal(wantsComic({ modifiers: { comic_peril: { p: 0.9 } } }, cfg), false, 'off: no comic question is asked');
  assert.equal(wantsComic({ modifiers: { comic_peril: { p: 0.9 } } }, on), true);
  assert.equal(wantsComic({ modifiers: { comic_peril: { p: 0.1 }, comic: { laughs: 0.2 } } }, on), false);
  assert.deepEqual(Object.keys(comicQuestions(lineIds)), ['begin.comic', 'end.comic', 'exists.comic']);
  const p = planMoments({ film: { title: 'F' }, scene: { ...scene, modifiers: { comic_peril: { p: 0.9 } } }, cues, reasons: [{ id: 'chased', rule: 'strong_event' }], items: [], cfg });
  assert.equal(p.comic, undefined);
  assert.equal(Object.keys(p.body.questions).length, 3);
});

test('spanFromLines: bounded padding (pad back 20 s, lead-in / trail <= 60 s); first_line_back is off', () => {
  assert.equal(cfg.wordless.lead_in.max_ms, 60000);
  assert.equal(cfg.wordless.trail_max_ms, 60000);
  assert.equal(cfg.wordless.first_line_back_ms, undefined);
});

// ---- prompt identity (needs git-ignored inputs: sources/nemo.json and data/nemo.srt) -----------------
const srcFile = path.join(here, '..', '..', 'v10', 'sources', 'nemo.json') // v10.1 reads v10's pinned sources;
const srtFile = path.join(here, '..', '..', 'data', 'nemo.srt');
const v6File = path.join(here, '..', '..', 'v6', 'segment.js');
test('segment prompt: the whole-film prompt is byte-identical to v6; a part adds PART RULES and only its lines', { skip: !(fs.existsSync(srcFile) && fs.existsSync(srtFile) && fs.existsSync(v6File)) && 'inputs not present' }, () => {
  const SRC = JSON.parse(fs.readFileSync(srcFile, 'utf8'));
  const cuesN = parseSrt(fs.readFileSync(srtFile, 'utf8'));
  const N = cuesN.length;
  const src = fs.readFileSync(v6File, 'utf8');
  const lit = (a, b) => src.slice(src.indexOf(a) + a.length - 1, src.indexOf(b) + 1);
  const ev = (body) => new Function('N', 'film', 'W', 'T', 'SRC', 'cues', 'formatTime', `return ${body};`)(N, SRC.film, SRC.wikipedia.sentences, SRC.tmdb.cast, SRC, cuesN, formatTime);
  const v6System = ev(lit('const SYSTEM = `', '`;\n\nconst USER'));
  const v6User = ev(lit('const USER = `', '`;\n\nconst obj'));
  const p = makePrompts({ film: SRC.film, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast, cues: cuesN, SRC });
  assert.equal(p.systemFor(1, N), v6System);
  assert.equal(p.userFor(1, N), v6User);
  const part = p.userFor(700, 900, { k: 2, of: 2 });
  assert.match(p.systemFor(700, 900, { k: 2, of: 2 }), /PART RULES\. You are given only lines L700 to L900/);
  assert.match(part, /\nL700 \[/);
  assert.ok(!part.includes('\nL699 [') && !part.includes('\nL901 ['));
});
