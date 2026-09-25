// node --test test/  — reference-key scoring (refscore.js) on a synthetic key. No real key is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreKey, dtddAgreement, dtddTargets, momentClusters, shareInside, union, subtract, gapKey, sensitivity, compareSystems } from '../refscore.js';

const item = (id, start, end, should_flag, extra = {}) => ({ id, source: 'imdb', text: `item ${id}`, categories: ['peril'], policy: {}, should_flag, same_moment_as: [], mappable: start != null, start_ms: start, end_ms: end, ...extra });
const key = {
  items: [
    item('R01', 0, 10000, true, { policy: { villain_threat: true } }),
    item('R02', 20000, 30000, true, { same_moment_as: ['R03'] }),
    item('R03', 21000, 29000, true, { source: 'kim' }),
    item('R04', 50000, 60000, 'tag_only', { policy: { comic_peril: true } }),
    item('R05', 70000, 80000, false),
    item('R06', null, null, true, { wordless: true }),
    item('R07', 90000, 90000, true, { policy: { child_terrified: true } }),
  ],
  film_level: [
    { id: 'D01', source: 'doesthedogdie', text: 'Does someone die?', answer: 'no', categories: ['death'] },
    { id: 'D02', source: 'doesthedogdie', text: 'Is someone kidnapped?', answer: 'yes', categories: ['separation'] },
    { id: 'D03', source: 'doesthedogdie', text: 'Are there scenes of peril?', answer: 'yes', categories: ['peril'] },
    { id: 'D04', source: 'doesthedogdie', text: 'Are there spiders?', answer: 'yes', categories: ['creatures_figures'] },
    { id: 'D06', source: 'doesthedogdie', text: 'Does a pregnant person die?', answer: 'no', categories: ['death'] },
    { id: 'D05', source: 'imdb', text: 'Tense throughout.', categories: ['peril'] },
  ],
};

test('recall: >= 50% of the item span inside skip spans; same-moment clusters; unmappable apart; points', () => {
  const s = scoreKey(key, [[0, 6000], [24000, 40000], [85000, 95000]]);
  assert.deepEqual(s.recall_items, { found: 4, of: 4, share: 1 }); // R01 60%, R02 60%, R03 62.5%, R07 point
  assert.deepEqual(s.found.sort(), ['R01', 'R02', 'R03', 'R07']);
  assert.equal(s.recall_moments.of, 3); // {R01}, {R02,R03}, {R07}
  assert.equal(s.recall_moments.found, 3);
  assert.deepEqual(s.unmappable.map((u) => u.id), ['R06']);
  assert.deepEqual(s.recall_by_policy.villain_threat, { n: 1, found: 1 });
  assert.deepEqual(s.recall_by_policy.child_terrified, { n: 1, found: 1 });
  const miss = scoreKey(key, [[0, 4000]]);
  assert.equal(miss.recall_items.found, 0);
  assert.deepEqual(miss.missed.map((m) => m.id).sort(), ['R01', 'R02', 'R03', 'R07']);
});

test('tag-only (comic) items must not be flagged; precision counts only should_flag items; comic/false minutes are a cost', () => {
  const s = scoreKey(key, [[50000, 60000], [100000, 110000]], { liveDb: [[100000, 105000]] });
  assert.deepEqual([s.tag_only.items, s.tag_only.flagged, s.tag_only.flagged_ids], [1, 1, ['R04']]);
  assert.equal(s.precision_proxy_ref_only, 0, 'skipping the comic item R04 is not a hit');
  assert.equal(s.precision_proxy_any_item, 0.5, 'pre-fix definition kept for comparison');
  assert.equal(s.precision_proxy_ref_or_live_db, 0.25);
  assert.equal(s.skip_minutes_over_non_flag_items.tag_only, 0.167); // 10 s of R04
  const t = scoreKey(key, [[0, 10000], [70000, 80000]]);
  assert.equal(t.precision_proxy_ref_only, 0.5);
  assert.equal(t.skip_minutes_over_non_flag_items.should_flag_false, 0.167); // 10 s of R05
  assert.equal(s.should_not_flag_items_skipped.skipped, 0);
  assert.equal(scoreKey(key, [[75000, 80000]]).should_not_flag_items_skipped.skipped, 1);
});

test('helpers', () => {
  assert.deepEqual(union([[5, 10], [0, 6], [20, 30]]), [[0, 10], [20, 30]]);
  assert.equal(shareInside(0, 10, [[5, 20]]), 0.5);
  assert.equal(shareInside(7, 7, [[5, 20]]), 1);
  assert.equal(momentClusters(key.items).length, 6);
});

test('DTDD: only whole questions v6 can answer are scored, against specific tags; the group fallback is apart', () => {
  assert.deepEqual(dtddTargets(key.film_level[0]), { kind: 'tags', ids: ['dies'] });
  assert.deepEqual(dtddTargets(key.film_level[2]), { kind: 'groups', ids: ['peril'] });
  assert.equal(dtddTargets({ text: 'Does a pregnant person die?', categories: ['death'] }).kind, 'groups', 'over-specific questions are not scored');
  const act = [{ id: 'child_taken', group: 'separation' }, { id: 'chased', group: 'peril' }, { id: 'dies', group: 'death' }];
  const d = dtddAgreement(key, act);
  // scored: D01 (no, v6 yes: fp), D02 (yes, yes: tp), D04 (yes, no: fn)
  assert.deepEqual([d.topics, d.scored, d.agree, d.tp, d.tn, d.fp, d.fn, d.unscored], [5, 3, 1, 1, 0, 1, 1, 2]);
  assert.deepEqual([d.coarse_groups.scored, d.coarse_groups.agree], [2, 1]);
  const db = dtddAgreement(key, [{ id: 'spider_insect', group: 'creatures_figures' }], { toId: (id) => id });
  assert.equal(db.rows.find((r) => r.id === 'D04').agree, true);
});

test('gap window: items widen to gap_start_ms..gap_end_ms, never narrower than the span', () => {
  const k = { items: [item('G1', 10000, 12000, true, { gap_start_ms: 4000, gap_end_ms: 14000 }), item('G2', 30000, 32000, true, { gap_start_ms: 31000, gap_end_ms: 31500 })] };
  const g = gapKey(k);
  assert.deepEqual([g.items[0].start_ms, g.items[0].end_ms], [4000, 14000]);
  assert.deepEqual([g.items[1].start_ms, g.items[1].end_ms], [30000, 32000]);
  const skip = [[10000, 12000], [30000, 32000]];
  assert.equal(scoreKey(k, skip).recall_items.found, 2);
  assert.equal(scoreKey(k, skip, { window: 'gap' }).recall_items.found, 1, 'G1: 2 of 10 s of the window inside');
  assert.equal(scoreKey(k, [[4000, 9000]], { window: 'gap' }).recall_items.found, 1, 'wordless lead-in covers half the window');
});

test('subtract', () => {
  assert.deepEqual(subtract([[0, 10], [20, 30]], [[5, 22], [25, 26]]), [[0, 5], [22, 25], [26, 30]]);
  assert.deepEqual(subtract([[0, 10]], []), [[0, 10]]);
  assert.deepEqual(subtract([[0, 10]], [[0, 10]]), []);
});

test('sensitivity is deterministic; compareSystems calls a tie unless the conservative recall and >= 95% of runs agree', () => {
  const k = { items: Array.from({ length: 10 }, (_, i) => item(`J${i}`, i * 100000 + 40000, i * 100000 + 50000, true, { gap_start_ms: i * 100000 + 30000, gap_end_ms: i * 100000 + 60000 })) };
  const A = k.items.map((it) => [it.start_ms - 60000, it.end_ms + 60000]); // covers every item with room
  const B = k.items.slice(0, 5).map((it) => [it.start_ms, it.end_ms]); // half the items, tight
  const s1 = sensitivity(k, A, B, { runs: 50 });
  assert.deepEqual(s1, sensitivity(k, A, B, { runs: 50 }));
  const sc = (skip, window) => scoreKey(k, skip, { window });
  const v = compareSystems({ aStrict: sc(A), aGap: sc(A, 'gap'), bStrict: sc(B), bGap: sc(B, 'gap'), sens: sensitivity(k, A, B, { runs: 50 }) });
  assert.equal(v.recall, 'A');
  assert.deepEqual(v.conservative_recall, { a: 10, b: 0, of: 10 }); // B's tight skips cover 1/3 of each 30 s gap window
  const tie = compareSystems({ aStrict: sc(B), aGap: sc(B, 'gap'), bStrict: sc(B), bGap: sc(B, 'gap'), sens: sensitivity(k, B, B, { runs: 50 }) });
  assert.deepEqual([tie.recall, tie.precision, tie.overall], ['tie', 'tie', 'tie']);
});
