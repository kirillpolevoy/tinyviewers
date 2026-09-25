// v10.2 fixes: (1) the tier-A gate in select.js, (2) rule-2 crying needs Jev's child answer, (3) the resolution
// guard, (4) the plot path for parent text and the wider plot supply; rule 1's question (measured, disabled).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { loadPolicy, selectScene, selectRun, withJevThresholds, passesGate, conceptMap, conceptOf, guardCancels, rule1Reason, modifiersOf, sceneTags } from '../select.js';
import { loadSplit } from '../split.js';
import { GUARD_QS, R1_Q, guardScenes } from '../resolve.js';
import { lintNoul } from '../lint.js';
import { plotPathOk, reasonSayable } from '../textsafe.js';
import { sceneW } from '../describe.js';
import { anchorsOf } from '../fill.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V102 = path.resolve(here, '..');
const TS = path.resolve(V102, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const POLICY = loadPolicy(path.join(V102, 'policy.json'));
const CFG = withJevThresholds(POLICY);
const SPLIT = loadSplit();
const CMAP = conceptMap(SPLIT);
const SONNET = new Set(SPLIT.sonnet_used);
const byOf = (id) => (SONNET.has(id) ? 'sonnet' : 'jev');
const base = (extra = {}) => ({ c: {}, e: {}, s: { laughs: { score: 0 }, danger: { score: 3 } }, mod: {}, ...extra });
const scene = (answers, opts = {}) => selectScene(answers, CFG, { byOf, conceptByV9: CMAP, ...opts });

// ---- fix 1 -------------------------------------------------------------------------------------------------
test('fix 1: the gate lists are the pre-registered ones and match split.json tiers / owners', () => {
  const preF = path.join(TS, 'v10', 'prereg-tierA-gating.json');
  const pre = rj(preF);
  const G = POLICY.flag.gating;
  assert.deepEqual(G.tier_a_jev_concepts, pre.tierA_jev_concepts);
  assert.deepEqual(G.sonnet_concepts, pre.sonnet_concepts);
  assert.equal(G.prereg_sha256, crypto.createHash('sha256').update(fs.readFileSync(preF)).digest('hex'));
  const tierA = Object.entries(SPLIT.concepts).filter(([, d]) => d.owner === 'jev' && d.evidence?.tier === 'A').map(([k]) => k).sort();
  assert.deepEqual([...G.tier_a_jev_concepts].sort(), tierA);
  const son = Object.entries(SPLIT.concepts).filter(([, d]) => d.owner === 'sonnet').map(([k]) => k).sort();
  assert.deepEqual([...G.sonnet_concepts].sort(), son);
});

test('fix 1: tier-A Jev and Sonnet reasons flag; tier-B/C Jev reasons stay tags (gated_reasons)', () => {
  const tierB = scene(base({ c: { threatens_harm: 0.9 } }));
  assert.equal(tierB.flagged, false);
  assert.deepEqual(tierB.gated_reasons.map((r) => [r.id, r.concept]), [['threatens_harm', 'threatens_harm']]);
  assert.ok(tierB.tags.some((t) => t.id === 'threatens_harm' && t.level === 'act'), 'still a tag');
  const tierA = scene(base({ c: { chased: 0.95, threatens_harm: 0.9 } }));
  assert.deepEqual(tierA.flag_reasons.map((r) => r.id), ['chased']);
  assert.deepEqual(tierA.gated_reasons.map((r) => r.id), ['threatens_harm']);
  // Sonnet-owned captured (v9 ids cage_net_trap / restraints / captured) flags
  const son = scene(base({ e: { captured: 0.8 } }));
  assert.deepEqual(son.flag_reasons.map((r) => [r.id, r.by]), [['captured', 'sonnet']]);
  // the gate is severity-neutral for unflagged scenes: severity is built from the gated reasons only
  assert.equal(tierB.severity['5-7'].content, 0);
  // concepts: film items by type, v9 ids by split.json, the kind-gate parent as itself
  const items = [{ id: 'C01_in_danger', type: 'child_in_danger' }, { id: 'V01_threatens', type: 'threatens' }];
  assert.equal(conceptOf({ id: 'C01_in_danger' }, items, CMAP), 'film:child_in_danger');
  assert.equal(conceptOf({ id: 'cage_net_trap' }, items, CMAP), 'captured');
  assert.equal(conceptOf({ id: 'animal_creature' }, items, CMAP), 'animal_creature');
  assert.equal(passesGate({ id: 'C01_in_danger', by: 'jev' }, POLICY.flag.gating, CMAP, items), true);
  assert.equal(passesGate({ id: 'V01_threatens', by: 'jev' }, POLICY.flag.gating, CMAP, items), false);
  assert.equal(passesGate({ id: 'animal_creature', by: 'jev' }, POLICY.flag.gating, CMAP, items), false);
  assert.equal(passesGate({ id: 'threatens_harm', by: 'jev', rule: 'rule1_question' }, POLICY.flag.gating, CMAP, items), true);
  // no gating block = v10.1 behaviour
  assert.equal(passesGate({ id: 'threatens_harm', by: 'jev' }, null, CMAP, items), true);
});

// Frozen / Zootopia (seen since round 7) through the v10.2 select path on their v10.1 as-run answers
const V101OUT = path.join(TS, 'v10_1', 'out101');
const DEVRES = path.join(V102, 'out102', 'dev');
const runFilm = (slug, extra = {}) => {
  const run = rj(path.join(V101OUT, `${slug}.jev.r1.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const rv = path.join(DEVRES, `${slug}.resolve.r1.json`);
  return selectRun(run, POLICY, { cues, sonnet: rj(path.join(V101OUT, `${slug}.sonnetq.r1.json`)), used: SPLIT.sonnet_used, childcry: rj(path.join(V101OUT, `${slug}.childcry.r1.json`)), resolve: fs.existsSync(rv) ? rj(rv) : null, split: SPLIT, ...extra });
};
const haveFZ = fs.existsSync(path.join(V101OUT, 'frozen.jev.r1.json')) && fs.existsSync(path.join(DEVRES, 'frozen.resolve.r1.json'));
test('fix 1 on Frozen / Zootopia: no flag reason from a tier-B/C Jev concept; round 7\'s gated-out reasons are tags', { skip: !haveFZ && 'needs v10_1/out101 and out102/dev resolve answers' }, () => {
  const G = POLICY.flag.gating;
  for (const slug of ['frozen', 'zootopia']) {
    const out = runFilm(slug);
    const items = out.film_items;
    for (const s of out.scenes.filter((x) => x.flagged)) for (const r of s.flag_reasons) {
      const c = conceptOf(r, items, CMAP);
      assert.ok(r.by === 'sonnet' ? G.sonnet_concepts.includes(c) : G.tier_a_jev_concepts.includes(c), `${slug} ${s.id} ${r.id} (${c}, ${r.by})`);
    }
  }
});

// ---- fix 2 -------------------------------------------------------------------------------------------------
test('fix 2: crying flags only with Jev child >= 0.5; Zootopia S005 (Stu) and S040 are not flagged for crying', { skip: !haveFZ && 'needs stored answers' }, () => {
  assert.deepEqual(POLICY.flag.requires.crying, { child: { jev_min: 0.5 } });
  const z = runFilm('zootopia');
  for (const id of ['S005', 'S040']) {
    const s = z.scenes.find((x) => x.id === id);
    assert.ok(!s.flag_reasons.some((r) => r.id === 'crying'), `${id} crying`);
    assert.ok(s.tags.some((t) => t.id === 'crying' && t.level === 'act'), `${id} crying stays a tag`);
  }
  // every crying flag reason carries Jev's child answer, so 'a child cries' is sayable only then
  for (const s of z.scenes.filter((x) => x.flagged)) for (const r of s.flag_reasons.filter((x) => x.id === 'crying')) assert.equal(r.child, 'jev_child');
  assert.equal(reasonSayable({ id: 'crying', child: 'jev_child' }), true);
  assert.equal(reasonSayable({ id: 'crying', child: 'cast_child' }), false);
  assert.equal(reasonSayable({ id: 'crying' }), false);
  assert.equal(reasonSayable({ id: 'dies' }), true);
});

// ---- fix 3 -------------------------------------------------------------------------------------------------
test('fix 3: guard questions are one-condition Nouls; the guard cancels only the Sonnet reasons it names', () => {
  for (const q of [...Object.values(GUARD_QS), R1_Q]) assert.deepEqual(lintNoul(q), []);
  const G = POLICY.flag.resolution_guard;
  assert.deepEqual(G.cancels, { captured: ['arrest', 'celebrate'], cage_net_trap: ['arrest', 'celebrate'], restraints: ['arrest', 'celebrate'], weapon_used: ['celebrate'] });
  assert.equal(G.min_p, 0.5);
  const arrested = scene(base({ e: { captured: 0.95 }, x: { guard_arrest: 0.92 } }));
  assert.equal(arrested.flagged, false);
  assert.deepEqual(arrested.guard_cancelled.map((r) => [r.id, r.by_guard]), [['captured', ['arrest']]]);
  // a Jev tier-A danger in the same scene keeps it flagged
  const fight = scene(base({ e: { captured: 0.95 }, c: { chased: 0.9 }, x: { guard_arrest: 0.92 } }));
  assert.deepEqual(fight.flag_reasons.map((r) => r.id), ['chased']);
  // celebrate cancels weapon_used, never crying; arrest never cancels weapon_used
  const party = scene(base({ e: { weapon_used: 0.8, crying: 0.8 }, x: { guard_celebrate: 0.9, guard_arrest: 0.9, crying_child: 0.9 } }));
  assert.deepEqual(party.flag_reasons.map((r) => r.id), ['crying']);
  assert.deepEqual(party.guard_cancelled.map((r) => r.id), ['weapon_used']);
  assert.deepEqual(guardCancels({ id: 'captured', by: 'jev' }, { x: { guard_arrest: 1 } }, G), [], 'never a Jev reason');
  assert.deepEqual(guardCancels({ id: 'captured', by: 'sonnet' }, { x: { guard_arrest: 0.49 } }, G), []);
  // the guard is asked where Sonnet's guarded ids are at act
  const seg = { scenes: [{ id: 'S001', start_cue: 1, end_cue: 2 }, { id: 'S002', start_cue: 3, end_cue: 4 }] };
  const cues = [1, 2, 3, 4].map((i) => ({ index: i, startMs: i * 1000, endMs: i * 1000 + 500, text: `Hi ${i}.` }));
  assert.deepEqual(guardScenes({ seg, sonnet: { scenes: { S001: { captured: { p: 0.8 } }, S002: { crying: { p: 0.95 } } } }, cues, act: () => 0.7, ids: Object.keys(G.cancels) }), [{ id: 'S001', ids: ['captured'] }]);
});

test('fix 3 on round 7\'s misfires: Frozen S054 / S055 and Zootopia S033 / S046 unflagged; Tangled-style real captures kept', { skip: !haveFZ && 'needs stored answers' }, () => {
  const f = runFilm('frozen'); const z = runFilm('zootopia');
  for (const [out, id, why] of [[f, 'S054', 'weapon_used'], [f, 'S055', 'captured'], [z, 'S033', 'captured'], [z, 'S046', 'captured']]) {
    const s = out.scenes.find((x) => x.id === id);
    assert.equal(s.flagged, false, id);
    assert.ok(s.guard_cancelled.some((r) => r.id === why), `${id} ${why}`);
  }
  // Frozen S039 (Elsa chained in the dungeon: Sonnet captured + restraints, a should_flag moment) still flags
  assert.equal(f.scenes.find((x) => x.id === 'S039').flagged, true);
});

// ---- rule 1 --------------------------------------------------------------------------------------------------
test('rule 1: the rule-1 question failed tier A on the seen films, so it is disabled; enabled it adds a gate-passing threatens_harm', () => {
  assert.equal(POLICY.flag.rule1_question.enabled, false);
  const a = base({ x: { r1_threat: 0.95 } });
  const tags = sceneTags(a, CFG).tags;
  assert.equal(rule1Reason(a, CFG, modifiersOf(a, CFG), tags), null);
  const on = structuredClone(CFG); on.flag.rule1_question = { enabled: true, min_p: 0.7, reason_id: 'threatens_harm' };
  const s = selectScene(a, on, { byOf, conceptByV9: CMAP });
  assert.deepEqual(s.flag_reasons.map((r) => [r.id, r.rule]), [['threatens_harm', 'rule1_question']]);
  const imagined = selectScene(base({ x: { r1_threat: 0.95 }, mod: { imagined: 0.9 } }), on, { byOf, conceptByV9: CMAP });
  assert.equal(imagined.flagged, false, 'cancelled like threatens_harm (imagined)');
});

// ---- fix 4 -------------------------------------------------------------------------------------------------
test('fix 4: the plot path needs plot support, the scene\'s own plot sentence, the neighbour test and no contradiction', () => {
  const acc = { accept: POLICY.text_safety.accept, neighbourMin: POLICY.fill.neighbour_min };
  const ws = (s, c) => ({ probabilities: { supports: s, contradicts: c } });
  const ok = { status: 'unverified', wsupport: ws(0.95, 0.01), wAllowed: true, neighbour: { p_neither: 0.9 }, dirOk: true };
  assert.deepEqual(plotPathOk(ok, acc), { ok: true, failed: [] });
  assert.deepEqual(plotPathOk({ ...ok, status: 'contradicted' }, acc).failed, ['lines_contradict']);
  assert.deepEqual(plotPathOk({ ...ok, wsupport: ws(0.74, 0) }, acc).failed, ['plot_support']);
  assert.deepEqual(plotPathOk({ ...ok, wsupport: ws(0.9, 0.2) }, acc).failed, ['plot_support']);
  assert.deepEqual(plotPathOk({ ...ok, wAllowed: false }, acc).failed, ['plot_not_for_scene']);
  assert.deepEqual(plotPathOk({ ...ok, neighbour: { p_neither: 0.79 } }, acc).failed, ['neighbour']);
  assert.deepEqual(plotPathOk({ ...ok, dirOk: false }, acc).failed, ['direction']);
});

const GDSEG = path.join(TS, 'v10_1', 'round7', 'gd-out', 'good-dinosaur.segments.json');
test('fix 4: a wide order window supplies the plot sentences near the scene\'s position (Good Dinosaur S015 gets W7, the flood)', { skip: !fs.existsSync(GDSEG) && 'needs round-7 gd-out' }, () => {
  const seg = rj(GDSEG); const src = rj(path.join(TS, 'v10', 'sources', 'good-dinosaur.json'));
  const i = seg.scenes.findIndex((s) => s.id === 'S015');
  const w = sceneW(seg, i, anchorsOf(seg), src.wikipedia.sentences.length);
  assert.ok(w.includes(7), JSON.stringify(w));
  assert.ok(w.length <= 7);
  // a narrow window is unchanged (Frozen S031: W15, W16)
  const fseg = rj(path.join(V101OUT, 'frozen.segments.json')); const fsrc = rj(path.join(TS, 'v10', 'sources', 'frozen.json'));
  const j = fseg.scenes.findIndex((s) => s.id === 'S031');
  assert.deepEqual(sceneW(fseg, j, anchorsOf(fseg), fsrc.wikipedia.sentences.length), [15, 16]);
});

test('code-built reasons off: no reason line and no plain title; only verified Sonnet text, else Flagged scene', async () => {
  assert.equal(POLICY.text_safety.code_built_reasons, false);
  assert.deepEqual(POLICY.text_safety.title_accept, { min_supports: 0.7, max_contradicts: 0.15 });
  const { buildWhy } = await import('../check-describe.js');
  const reasons = [{ id: 'chased', group: 'peril', p: 0.9 }];
  const none = buildWhy({ title: { text: 'X', final: 'unverified' }, sentences: [], states: [], reasons, items: [], minP: 0.6, stated: [] });
  assert.deepEqual([none.source, none.title, none.title_source, none.text], ['no_verified_text', 'Flagged scene', 'none', null]);
  const d = buildWhy({ title: { text: 'Kid is chased', final: 'verified' }, sentences: [{ key: 'S1.d1', text: 'A wolf chases the kid.', final: 'verified' }], states: [], reasons, items: [], minP: 0.6, stated: [] });
  assert.deepEqual([d.source, d.title, d.text], ['described_only', 'Kid is chased', 'A wolf chases the kid.']);
});
