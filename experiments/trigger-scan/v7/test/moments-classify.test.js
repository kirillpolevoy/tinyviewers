// node --test test/  — moments.js pure parts, and classify.js planning/unpacking/budget with a fake Jev.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCaptionOnly, dialoguePerMin, spanFor, unionSpans, planMoments, momentQuestions, clauseFor, spansFromAnswers } from '../moments.js';
import { planScene, unpackAnswers, checkSegments } from '../classify.js';
import { runJobs } from '../jev-client.js';
import { budget } from '../budget.js';
import { loadPolicy } from '../select.js';
import { filmItems, MODEL } from '../questions.js';

const cfg = loadPolicy();

test('caption-only cues and dialogue density', () => {
  assert.equal(isCaptionOnly('( door creaking )'), true);
  assert.equal(isCaptionOnly('[thunder rumbling]'), true);
  assert.equal(isCaptionOnly('( whispering ): Hello?'), false);
  assert.equal(isCaptionOnly('- ( phones ringing ) - Please hold.'), false);
  assert.equal(isCaptionOnly('BOY: Mama!'), false);
  assert.equal(isCaptionOnly('♪ ♪'), true);
  const cues = [{ text: '( wind )' }, { text: 'Hey!' }, { text: '( howling )' }];
  assert.equal(dialoguePerMin(cues, { start_ms: 0, end_ms: 60000 }), 1);
});

const lineIds = ['L10', 'L11', 'L12', 'L13', 'L14'];
const cues = lineIds.map((id, i) => ({ index: Number(id.slice(1)), startMs: 10000 + i * 10000, endMs: 12000 + i * 10000, text: `line ${i}` }));
const cuesById = new Map(cues.map((c) => [`L${c.index}`, c]));
const scene = { id: 'S001', start_ms: 10000, end_ms: 52000, start_cue: 10, end_cue: 14 };
const choice = (probs) => ({ choice: Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0], confidence: 0.7, probabilities: Object.fromEntries(lineIds.map((id) => [id, probs[id] ?? 0])) });

test('spanFor: earliest strong begin, latest strong end, padded and clamped; fallbacks', () => {
  const r = spanFor({ begin: choice({ L11: 0.6, L12: 0.35 }), end: choice({ L12: 0.5, L13: 0.45 }), exists: 0.9 }, lineIds, cuesById, scene, cfg);
  assert.equal(r.begin.line, 'L11'); // L12 at 0.35 < 0.5 x 0.6
  assert.equal(r.end.line, 'L13'); // L13 at 0.45 >= 0.5 x 0.5, later than L12
  // v6 begin side (no reaction): pad back 15 s, clamped to the scene
  assert.deepEqual(r.span, { start_ms: scene.start_ms, end_ms: 42000 + 5000 });
  const wide = { ...scene, start_ms: 0 };
  assert.deepEqual(spanFor({ begin: choice({ L12: 1 }), end: choice({ L12: 1 }), exists: 0.9 }, lineIds, cuesById, wide, cfg).span, { start_ms: 30000 - cfg.wordless.pad_back_ms, end_ms: 32000 + 5000 });
  const gapCues = new Map(cuesById); gapCues.set('L11', { ...cuesById.get('L11'), endMs: 12500 }); gapCues.set('L12', { ...cuesById.get('L12'), startMs: 40000, endMs: 41000 });
  // a plain line pads back pad_back_ms (v7: 20 s; v5.1 ran back over the whole gap, unbounded)
  assert.equal(spanFor({ begin: choice({ L12: 1 }), end: choice({ L12: 1 }), exists: 0.9 }, lineIds, gapCues, wide, cfg).span.start_ms, 40000 - cfg.wordless.pad_back_ms);
  // a line that reacts to action takes the silence before it (27.5 s here)
  gapCues.set('L12', { ...gapCues.get('L12'), text: '( screams )' });
  const react = spanFor({ begin: choice({ L12: 1 }), end: choice({ L12: 1 }), exists: 0.9 }, lineIds, gapCues, wide, cfg);
  assert.equal(react.span.start_ms, 12500);
  assert.equal(react.span.lead_in, true);
  // ... bounded at 60 s
  gapCues.set('L12', { ...gapCues.get('L12'), startMs: 100000, endMs: 101000 });
  assert.equal(spanFor({ begin: choice({ L12: 1 }), end: choice({ L12: 1 }), exists: 0.9 }, lineIds, gapCues, { ...wide, end_ms: 200000 }, cfg).span.start_ms, 40000);
  const edge = spanFor({ begin: choice({ L10: 1 }), end: choice({ L14: 1 }), exists: 0.9 }, lineIds, cuesById, scene, cfg);
  assert.deepEqual(edge.span, { start_ms: scene.start_ms, end_ms: scene.end_ms });
  const swapped = spanFor({ begin: choice({ L13: 1 }), end: choice({ L11: 1 }), exists: 0.9 }, lineIds, cuesById, scene, cfg);
  assert.ok(swapped.span.start_ms < swapped.span.end_ms);
  assert.equal(swapped.begin.line, 'L11');
  assert.equal(swapped.end.line, 'L13');
  assert.equal(spanFor({ begin: choice({ L11: 1 }), end: choice({ L11: 1 }), exists: 0.2 }, lineIds, cuesById, scene, cfg).fallback, 'not_in_lines');
});

test('unionSpans merges overlapping and touching spans', () => {
  assert.deepEqual(unionSpans([{ start_ms: 50000, end_ms: 60000 }, { start_ms: 0, end_ms: 10000 }, { start_ms: 5000, end_ms: 20000 }, null]), [{ start_ms: 0, end_ms: 20000 }, { start_ms: 50000, end_ms: 60000 }]);
  assert.deepEqual(unionSpans([{ start_ms: 0, end_ms: 10000 }, { start_ms: 10500, end_ms: 12000 }]), [{ start_ms: 0, end_ms: 12000 }]);
});

test('planMoments: wordless scenes fall back without a call; otherwise one request, 3 questions per clause', () => {
  const wordless = planMoments({ film: { title: 'F' }, scene: { ...scene, end_ms: 10000 + 5 * 60000 }, cues, reasons: [{ id: 'chased', rule: 'strong_event' }], items: [], cfg });
  assert.equal(wordless.call, false);
  assert.equal(wordless.why, 'wordless');
  const p = planMoments({ film: { title: 'F' }, scene, cues, reasons: [{ id: 'chased', rule: 'strong_event' }, { id: 'monster_creature', rule: 'presence_with_creature_threat' }, { id: 'creature_threat', rule: 'strong_event' }], items: [], cfg });
  assert.equal(p.call, true);
  assert.deepEqual(Object.keys(p.body.state), ['film', 'scene']);
  assert.deepEqual(Object.keys(p.body.state.scene), ['lines']);
  assert.equal(p.clauses.length, 2, 'monster presence with a creature threat searches for the threat, deduplicated');
  assert.equal(Object.keys(p.body.questions).length, 6);
  assert.deepEqual(Object.keys(p.body.questions['begin.0'].criteria), lineIds);
  assert.equal(p.body.model, MODEL);
  assert.equal(clauseFor({ id: 'C01_threatens' }, [{ id: 'C01_threatens', moment: 'Vera threatens, chases, or attacks someone' }]), 'Vera threatens, chases, or attacks someone');
  const q = momentQuestions(['a character is chased or hunted'], lineIds);
  assert.match(q['exists.0'].instructions, /moment when a character is chased or hunted/);
});

test('spansFromAnswers (v7): a reason not shown in the lines gets its best-guess span, never the whole scene', () => {
  const plan = { clauses: ['a', 'b'], lineIds };
  const ans = { 'begin.0': choice({ L11: 1 }), 'end.0': choice({ L12: 1 }), 'exists.0': { noul: 0.9 }, 'begin.1': choice({ L13: 1 }), 'end.1': choice({ L13: 1 }), 'exists.1': { noul: 0.9 } };
  const both = spansFromAnswers(plan, ans, cues, scene, cfg);
  assert.equal(both.method, 'moments');
  assert.equal(both.spans.length, 1); // overlapping spans merge
  assert.equal(both.answers.length, 2, 'raw answers are kept for offline re-spans');
  const miss = spansFromAnswers(plan, { ...ans, 'exists.1': { noul: 0.1 } }, cues, scene, cfg);
  assert.equal(miss.method, 'moments');
  assert.deepEqual(miss.not_shown, ['not_in_lines: b']);
  assert.deepEqual(miss.spans, both.spans, 'best guess from its own begin/end lines (policy not_shown best_guess)');
  assert.ok(miss.spans[0].end_ms - miss.spans[0].start_ms < scene.end_ms - scene.start_ms);
});

// ---- classify ------------------------------------------------------------------------------------------

const ok = { verdict: 'supports', confidence: 0.9 };
const seg = {
  film: { slug: 'x', title: 'Film', year: 2000 },
  cast: [{ id: 'C01', name: 'Vera', aliases: [], kind: 'person', is_child: false, looks_frightening: 'unknown', disposition: 'villain', disposition_note: 'wants the machine', check: { disposition: ok } }],
  dangers: [],
  scenes: [
    { id: 'S001', start_cue: 10, end_cue: 12, start_ms: 10000, end_ms: 32000, setting: 'a room', sentences: [{ text: 'Vera talks.', cites: ['L10'], check: ok }] },
    { id: 'S002', start_cue: 13, end_cue: 14, start_ms: 40000, end_ms: 52000, setting: 'a hall', sentences: [{ text: 'Unchecked.', cites: ['L13'], check: { verdict: 'says_nothing', confidence: 0.9 } }] },
  ],
};

test('planScene: two requests; lines request never sees summary or cast; empty summary drops ps/fps', () => {
  const items = filmItems(seg);
  const p1 = planScene({ seg, scene: seg.scenes[0], cues: cues.slice(0, 3), items });
  assert.deepEqual(p1.reqs.map((r) => r.part), ['lines', 'context']);
  const [lines, context] = p1.reqs;
  assert.deepEqual(Object.keys(lines.body.state), ['film', 'scene']);
  assert.ok(!JSON.stringify(lines.body.state).includes('Vera talks'));
  assert.ok(Object.keys(lines.body.questions).every((k) => /^(pl|m|fpl)\./.test(k)));
  assert.ok(Object.keys(context.body.questions).every((k) => k === 'kind' || /^(ps|e|mod|s|fps|fe)\./.test(k)));
  assert.ok('fe.C01_threatens' in context.body.questions && 'fpl.C01_present' in lines.body.questions);
  const p2 = planScene({ seg, scene: seg.scenes[1], cues: cues.slice(3), items });
  assert.equal(p2.summaryEmpty, true);
  assert.ok(!Object.keys(p2.reqs[1].body.questions).some((k) => /^(ps|fps)\./.test(k)));
  assert.equal(p2.reqs[1].body.state.scene.summary, '');
});

test('checkSegments: coverage and contiguity unless the file is a partial fixture', () => {
  assert.throws(() => checkSegments(seg, 20), /cover/);
  assert.doesNotThrow(() => checkSegments({ ...seg, fixture: { partial: true } }, 20));
  const gap = { ...seg, scenes: [seg.scenes[0], { ...seg.scenes[1], start_cue: 14 }] };
  assert.throws(() => checkSegments(gap, 14), /contiguous/);
});

test('unpackAnswers: every asked question must come back', () => {
  const qs = { 'e.chased': { type: 'noul' }, 's.laughs': { type: 'score' }, kind: { type: 'choice' } };
  const a = unpackAnswers(qs, { 'e.chased': { noul: 0.2 }, 's.laughs': { score: 1.2, confidence: 0.5, probabilities: { 0: 0.1, 1: 0.6, 2: 0.3, 3: 0 } }, kind: { choice: 'none', confidence: 1, probabilities: { none: 1 } } });
  assert.equal(a.e.chased, 0.2);
  assert.equal(a.s.laughs.top, 3);
  assert.equal(a.kind.choice, 'none');
  assert.throws(() => unpackAnswers(qs, { 'e.chased': { noul: 0.2 } }), /missing answer/);
});

test('runJobs: reserves before dispatch, stops at the cap, records HTTP statuses, keeps upper bound on network errors', async () => {
  const b = budget(0.00025);
  const calls = [];
  const post = async (body) => {
    calls.push(body.n);
    if (body.n === 1) throw Object.assign(new Error('jev 400: bad'), { attempts: [{ status: 400, ms: 1 }] });
    if (body.n === 2) throw Object.assign(new Error('network: reset'), { attempts: [{ status: null, ms: 1 }] });
    return { json: { model: 'jev-1.13.0', answers: {}, usage: { input_tokens: 1000, output_tokens: 5 } }, attempts: [{ status: 429, ms: 1 }, { status: 200, ms: 2 }], latencyMs: 2 };
  };
  const jobs = [0, 1, 2, 3, 4, 5].map((n) => ({ body: { n, questions: { a: {} } }, est: 100, reserveUsd: 0.0001, meta: { label: `j${n}` } }));
  const { results, stopped } = await runJobs(jobs, { key: 'k', budget: b, concurrency: 1, post });
  assert.equal(results[0].ok, true);
  assert.deepEqual(results[0].record.attempts.map((a) => a.status), [429, 200]);
  assert.equal(results[0].record.retries, 1);
  assert.equal(results[1].record.cost_usd, 0); // refused: nothing billed
  assert.equal(results[2].record.cost_is_upper_bound, true);
  assert.ok(stopped, 'the cap stops the run');
  assert.ok(results.some((r) => r.skipped === 'cap'));
  assert.ok(b.spent + b.reserved <= b.cap + 1e-12);
  assert.ok(!calls.includes(5));
});

test('respanScenes: offline re-span keeps only the current reasons, falls back when a scene or reason was never asked', async () => {
  const { respanScenes, clauseFor: cf } = await import('../moments.js');
  const cA = cf({ id: 'attacked' }, []);
  const cB = cf({ id: 'chased' }, []);
  const saved = { scenes: {
    S001: { method: 'whole_scene', why: 'not_in_lines: x', per_reason: [
      { clause: cA, exists: 0.9, begin: { line: 'L12' }, end: { line: 'L12' }, span: { start_ms: 25000, end_ms: 37000 } },
      { clause: cB, exists: 0.2, span: null, fallback: 'not_in_lines' },
    ], request: { cost_usd: 1e-5 } },
  } };
  const tags = { scenes: [
    { id: 'S001', flagged: true, start_cue: 10, end_cue: 14, start_ms: 0, end_ms: 52000, flag_reasons: [{ id: 'attacked', rule: 'strong_event' }] },
    { id: 'S002', flagged: true, start_cue: 15, end_cue: 15, start_ms: 52000, end_ms: 60000, flag_reasons: [{ id: 'attacked', rule: 'strong_event' }] },
    { id: 'S003', flagged: false, start_cue: 16, end_cue: 16, start_ms: 60000, end_ms: 70000, flag_reasons: [] },
  ] };
  const allCues = [...Array(9).fill(null).map((_, i) => ({ index: i + 1, startMs: 0, endMs: 0, text: '' })), ...cues];
  const out = respanScenes({ tags, saved, cues: allCues, items: [], cfg });
  assert.equal(out.S001.method, 'moments'); // chased (not in lines) is no longer a reason
  assert.deepEqual(out.S001.spans, [{ start_ms: 30000 - cfg.wordless.pad_back_ms, end_ms: 32000 + 5000 }]);
  assert.deepEqual(out.S001.per_reason[0].span_asrun, { start_ms: 25000, end_ms: 37000 });
  assert.equal(out.S002.method, 'whole_scene');
  assert.match(out.S002.why, /^not_asked/);
  assert.equal(out.S003, undefined);
});
