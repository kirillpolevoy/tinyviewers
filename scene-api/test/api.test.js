import test from 'node:test';
import assert from 'node:assert/strict';
import { films, film, scenes, vocabulary } from '../lib/endpoints.js';
import { HttpError } from '../lib/http.js';
import { loadedDb } from './helper.js';

const rejects = async (fn, status, matcher) => {
  await assert.rejects(fn, (err) => {
    assert.ok(err instanceof HttpError, `expected HttpError, got ${err}`);
    assert.equal(err.status, status, `status: ${err.message}`);
    if (matcher) assert.match(err.message, matcher);
    return true;
  });
};

// ------------------------------------------------------------------------------------------------
// films
// ------------------------------------------------------------------------------------------------

test('GET /api/films?q=nemo finds Finding Nemo', async () => {
  const db = await loadedDb();
  const out = await films(db, { q: 'nemo' });
  assert.equal(out.count, 1);
  assert.equal(out.films[0].slug, 'nemo');
  assert.equal(out.films[0].title, 'Finding Nemo');
  assert.equal(out.films[0].scene_count, 30);
});

test('film search is case-insensitive and matches inside the title', async () => {
  const db = await loadedDb();
  assert.equal((await films(db, { q: 'NEMO' })).count, 1);
  assert.equal((await films(db, { q: 'lion' })).films[0].slug, 'lion-king');
  assert.equal((await films(db, { q: 'monsters, inc' })).films[0].slug, 'monsters-inc');
  assert.equal((await films(db, {})).count, 6);
  const none = await films(db, { q: 'shrek' });
  assert.equal(none.count, 0);
  assert.match(none.note, /only a handful/i);
});

test('GET /api/films/{slug} carries the release, the anchors and the caveats', async () => {
  const db = await loadedDb();
  const out = await film(db, 'nemo');
  assert.equal(out.track.release_label, 'Finding.Nemo.2003.Bluray.Original.SDH');
  assert.equal(out.track.cue_count, 1575);
  assert.equal(out.anchors.lines.length, 3);
  assert.deepEqual(out.anchors.lines.map((a) => a.position), ['early', 'middle', 'late']);
  assert.equal(out.counts.scenes, 30);
  assert.equal(out.counts.scenes_human_reviewed, 0);
  assert.match(out.caveats.derived_from_subtitles_only, /flashing/);
  assert.match(out.caveats.human_review, /No scene .* has been checked by a human/);
  assert.match(out.caveats.complete_for_this_film, /complete rather than a sample/);
  assert.ok(out.analysis_runs.some((r) => r.role === 'presence' && r.model.startsWith('jev')));
  assert.ok(out.analysis_runs.some((r) => r.role === 'labeller'));
});

test('a slug is matched without regard to case', async () => {
  const db = await loadedDb();
  assert.equal((await film(db, 'NEMO')).film.slug, 'nemo');
  assert.equal((await scenes(db, 'Monsters-Inc', {})).film.slug, 'monsters-inc');
});

test('unknown film -> 404 listing every slug we do have', async () => {
  const db = await loadedDb();
  await rejects(() => film(db, 'the-incredibles'), 404, /No film with slug "the-incredibles"/);
  await rejects(() => scenes(db, 'the-incredibles'), 404);
  await assert.rejects(() => film(db, 'the-incredibles'), (err) => {
    assert.ok(err.extra.available.some((a) => a.startsWith('nemo')));
    return true;
  });
});

// ------------------------------------------------------------------------------------------------
// the monster question
// ------------------------------------------------------------------------------------------------

test('"monsters" broadens to the creatures group instead of the narrow item', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { presence: 'monsters' });
  assert.deepEqual(out.filters_applied.presence, [{
    you_asked: 'monsters',
    broadened_to_group: 'creatures_figures',
    how: 'broadened_to_group',
    note: '"monsters" -> group creatures_figures (any frightening creature or figure; ask for a specific one, e.g. shark or ghost, to narrow)',
  }]);
  assert.deepEqual(out.filters_applied.group, ['creatures_figures']);
  // The old behaviour returned nothing at all for this, because monster_creature excludes animals.
  assert.ok(out.scenes.length >= 8, `expected the barracuda, Bruce and the anglerfish, got ${out.scenes.length}`);
  const ids = new Set(out.scenes.flatMap((s) => s.present.map((p) => p.id)));
  assert.ok(ids.has('large_predator'), 'the barracuda');
  assert.ok(ids.has('shark'), 'Bruce');
  assert.ok(ids.has('monster_creature'), 'the anglerfish');
  assert.equal(out.nothing_matched, undefined);
});

test('the narrow item is still reachable by its id', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { presence: 'monster_creature' });
  assert.deepEqual(out.filters_applied.presence, [{ you_asked: 'monster_creature', matched: ['monster_creature'], how: 'exact' }]);
  assert.deepEqual(out.filters_applied.group, []);
  assert.equal(out.scenes.length, 1);
  assert.match(out.scenes[0].title, /Anglerfish/);
});

test('monsters-inc + "monsters": scenes in time order, both timelines, per-scene evidence', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'monsters-inc', { presence: 'monsters' });
  assert.ok(out.scenes.length >= 5, `expected several monster scenes, got ${out.scenes.length}`);
  const starts = out.scenes.map((s) => s.track_time.start_ms);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b), 'scenes must come back in time order');
  for (const s of out.scenes) {
    assert.match(s.track_time.start, /^\d+:\d{2}:\d{2}$/);
    assert.match(s.track_time.end, /^\d+:\d{2}:\d{2}$/);
    assert.ok(s.player_time, 'every scene carries a player timeline too');
    assert.equal(s.player_time.start_ms, s.track_time.start_ms, 'uncalibrated, so the two agree');
    const hit = s.present.find((p) => p.group === 'creatures_figures');
    assert.ok(hit, `${s.id} matched the group so it must carry a label from it`);
    assert.equal(hit.source, 'claude-sonnet-5', 'presence is asserted per scene, not per beat');
    assert.ok(['stated_in_lines', 'known_from_film'].includes(hit.evidence));
    assert.equal(typeof hit.both_sources_agree, 'boolean');
    assert.equal(hit.probability, undefined, 'an assertion carries no probability of its own');
    assert.ok(Array.isArray(s.not_assessed));
    assert.ok(Array.isArray(s.possibly_present));
    assert.equal(s.review_status, 'unreviewed');
  }
  // Monsters, Inc. is monsters all the way down.
  assert.ok(out.scenes.every((s) => s.present.some((p) => p.id === 'monster_creature')));
});

test('nemo + "Sharks": only the real shark scenes, in time order, in both timelines', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { presence: 'Sharks' });
  assert.deepEqual(out.filters_applied.presence, [{ you_asked: 'Sharks', matched: ['shark'], how: 'exact' }]);
  assert.equal(out.scenes.length, 4);
  const starts = out.scenes.map((s) => s.track_time.start_ms);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
  assert.ok(out.scenes.every((s) => s.present.some((p) => p.id === 'shark')));
  // The per-beat screener also called the barracuda, the divers and the pelican "shark". None of
  // those may appear here.
  const titles = out.scenes.map((s) => s.title).join(' | ');
  for (const wrong of ['Barracuda', 'Divers', 'Pelican']) assert.ok(!titles.includes(wrong), `${wrong} must not be a shark scene`);
});

test('include_possible surfaces the screener leads, and labels them as leads', async () => {
  const db = await loadedDb();
  const strict = await scenes(db, 'nemo', { presence: 'shark' });
  const loose = await scenes(db, 'nemo', { presence: 'shark', include_possible: 'true' });
  assert.equal(strict.filters_applied.include_possible, false);
  assert.equal(loose.filters_applied.include_possible, true);
  assert.match(loose.filters_applied.match_rule, /screener over-flags/);
  assert.ok(loose.scenes.length > strict.scenes.length, 'the leads should add scenes');
  const extra = loose.scenes.filter((s) => !strict.scenes.some((t) => t.id === s.id));
  for (const s of extra) {
    const lead = s.possibly_present.find((p) => p.id === 'shark');
    assert.ok(lead, `${s.title} was added by a lead, so it must list one`);
    assert.ok(lead.probability >= 0.7);
    assert.equal(lead.source, 'jev-1.13.0');
    assert.match(lead.note, /lead to check, not as a fact/);
    assert.ok(!s.present.some((p) => p.id === 'shark'), 'a lead is never also asserted');
  }
  assert.ok(extra.some((s) => s.title.includes('Barracuda')), 'the barracuda is the known false positive');
});

test('a text-blind item is never offered as possibly_present', async () => {
  const db = await loadedDb();
  const blind = new Set((await vocabulary(db, {})).groups.flatMap((g) => g.items).filter((i) => i.text_blind).map((i) => i.id));
  for (const slug of ['nemo', 'monsters-inc', 'frankenweenie']) {
    const out = await scenes(db, slug, { limit: '300' });
    for (const s of out.scenes) {
      for (const p of [...s.possibly_present, ...s.possibly_talked_about]) {
        assert.ok(!blind.has(p.id), `${slug} ${s.id}: ${p.id} is text-blind and must not be a lead`);
      }
    }
  }
});

test('the vocabulary matcher tolerates plurals, case, ids and everyday words', async () => {
  const db = await loadedDb();
  const resolve = async (term, key = 'presence') => (await scenes(db, 'monsters-inc', { [key]: term })).filters_applied[key][0];
  assert.deepEqual((await resolve('monster_creature')).matched, ['monster_creature']);
  assert.deepEqual((await resolve('Sharks')).matched, ['shark']);
  assert.deepEqual((await resolve('needles')).matched, ['needle_medical']);
  assert.deepEqual((await resolve('the dark')).matched, ['darkness']);
  assert.deepEqual((await resolve('guns')).matched, ['gun']);
  assert.deepEqual((await resolve('chased', 'event')).matched, ['chased']);
  assert.deepEqual((await resolve('kidnapping', 'event')).matched, ['child_taken']);
  // broad words
  for (const word of ['monsters', 'Monster', 'creatures', 'scary creature', 'beasts']) {
    assert.equal((await resolve(word)).broadened_to_group, 'creatures_figures', word);
  }
});

test('an unmatched filter word is a 400 with the nearest ids, not an empty list', async () => {
  const db = await loadedDb();
  await assert.rejects(() => scenes(db, 'nemo', { presence: 'velociraptor' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /no vocabulary item matches "velociraptor"/);
    assert.ok(err.extra.did_you_mean.length > 0);
    assert.equal(err.extra.vocabulary_url, '/api/vocabulary');
    return true;
  });
  // A presence word offered as an event is rejected, and told where it belongs.
  await rejects(() => scenes(db, 'nemo', { event: 'shark' }), 400, /it is a presence\. Use presence=shark instead/);
  await rejects(() => scenes(db, 'nemo', { presence: 'chased' }), 400, /it is an event\. Use event=chased instead/);
});

test('presence and event filters are ANDed; several values of one kind are ORed', async () => {
  const db = await loadedDb();
  const onlyShark = await scenes(db, 'nemo', { presence: 'shark' });
  const sharkAndChase = await scenes(db, 'nemo', { presence: 'shark', event: 'chased' });
  assert.ok(sharkAndChase.scenes.length <= onlyShark.scenes.length);
  for (const s of sharkAndChase.scenes) {
    assert.ok(s.present.some((p) => p.id === 'shark'));
    assert.ok(s.events.some((e) => e.id === 'chased'));
  }
  const either = await scenes(db, 'nemo', { presence: 'shark,darkness' });
  assert.ok(either.scenes.length >= onlyShark.scenes.length);
});

test('a group filter picks up a whole family', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'frankenweenie', { group: 'creatures_figures' });
  assert.ok(out.scenes.length > 0);
  assert.deepEqual(out.filters_applied.group, ['creatures_figures']);
  await rejects(() => scenes(db, 'nemo', { group: 'spooky things' }), 400, /no group matches/);
});

// ------------------------------------------------------------------------------------------------
// ages
// ------------------------------------------------------------------------------------------------

test('an age below 5 is answered with the 5-7 band and flagged as an understatement', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { age: '4', min_severity: '2' });
  assert.equal(out.filters_applied.age_band, '5-7');
  assert.match(out.filters_applied.age_band_note, /Age 4 was answered with the 5-7 band/);
  assert.match(out.filters_applied.age_band_note, /UNDERSTATE/);
  assert.ok(out.scenes.every((s) => s.severity['5-7'] >= 2));
});

test('age picks which severity column min_severity compares against', async () => {
  const db = await loadedDb();
  const young = await scenes(db, 'nemo', { age: '6', min_severity: '3' });
  const older = await scenes(db, 'nemo', { age: '9', min_severity: '3' });
  assert.equal(young.filters_applied.age_band, '5-7');
  assert.equal(older.filters_applied.age_band, '8-10');
  assert.ok(young.scenes.every((s) => s.severity['5-7'] >= 3));
  assert.ok(older.scenes.every((s) => s.severity['8-10'] >= 3));
  assert.notEqual(young.scenes.length, older.scenes.length);
  assert.equal((await scenes(db, 'nemo', { age: '5-7' })).filters_applied.age_band, '5-7');
  assert.equal((await scenes(db, 'nemo', { age: '8-10' })).filters_applied.age_band, '8-10');
  assert.equal((await scenes(db, 'nemo', {})).filters_applied.age_band, '5-7');
});

// ------------------------------------------------------------------------------------------------
// calibration
// ------------------------------------------------------------------------------------------------

test('no calibration: player_time mirrors track_time and the response says how to fix that', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { presence: 'shark' });
  assert.equal(out.calibration.applied, false);
  assert.equal(out.calibration.method, 'none');
  assert.match(out.calibration.how_to, /anchor_cue/);
  for (const s of out.scenes) assert.equal(s.player_time.start_ms, s.track_time.start_ms);
});

test('one anchor gives a constant offset', async () => {
  const db = await loadedDb();
  const detail = await film(db, 'nemo');
  const early = detail.anchors.lines.find((a) => a.position === 'early');
  const theirTime = early.our_time_ms + 28_299;             // their copy starts 28.3s later
  const out = await scenes(db, 'nemo', {
    presence: 'shark',
    anchor_cue: early.cue_id,
    observed_at: String(theirTime / 1000),
  });
  assert.equal(out.calibration.applied, true);
  assert.equal(out.calibration.method, 'one_anchor');
  assert.equal(out.calibration.offset_ms, 28_299);
  assert.equal(out.calibration.scale, 1);
  assert.match(out.calibration.assumption, /same speed/);
  for (const s of out.scenes) {
    assert.equal(s.player_time.start_ms, s.track_time.start_ms + 28_299);
    assert.equal(s.player_time.end_ms, s.track_time.end_ms + 28_299);
    assert.match(s.player_time.start, /^\d+:\d{2}:\d{2}$/);
  }
});

test('two anchors recover a PAL-style speed change as well as the offset', async () => {
  const db = await loadedDb();
  const detail = await film(db, 'nemo');
  const [early, , late] = detail.anchors.lines;

  // Their copy is a PAL transfer: a 24 fps master played at 25 fps, so it runs 25/24 faster and
  // every time is 24/25 = 0.96 of ours, plus a 30s difference at the front.
  const SCALE = 24 / 25;
  const OFFSET = 30_000;
  const theirs = (ms) => Math.round(ms * SCALE) + OFFSET;

  const out = await scenes(db, 'nemo', {
    presence: 'shark',
    anchor_cue: `${early.cue_id},${late.cue_id}`,
    observed_at: `${theirs(early.our_time_ms) / 1000},${theirs(late.our_time_ms) / 1000}`,
  });
  assert.equal(out.calibration.method, 'two_anchors');
  assert.ok(Math.abs(out.calibration.scale - SCALE) < 0.0001, `scale ${out.calibration.scale}`);
  assert.ok(Math.abs(out.calibration.offset_ms - OFFSET) < 200, `offset ${out.calibration.offset_ms}`);
  assert.match(out.calibration.speed_note, /faster/);
  for (const s of out.scenes) {
    assert.ok(Math.abs(s.player_time.start_ms - theirs(s.track_time.start_ms)) < 300,
      `${s.id}: ${s.player_time.start_ms} vs ${theirs(s.track_time.start_ms)}`);
  }
  // A single anchor would have been wrong by minutes by the end of the film.
  const oneAnchor = await scenes(db, 'nemo', {
    presence: 'shark', anchor_cue: early.cue_id, observed_at: String(theirs(early.our_time_ms) / 1000),
  });
  const lastTwo = out.scenes[out.scenes.length - 1].player_time.start_ms;
  const lastOne = oneAnchor.scenes[oneAnchor.scenes.length - 1].player_time.start_ms;
  assert.ok(Math.abs(lastOne - lastTwo) > 60_000, 'the one-anchor error should be minutes by the late scenes');
});

test('two anchors the other way round: a 25/24 slow-down', async () => {
  const db = await loadedDb();
  const detail = await film(db, 'nemo');
  const [early, , late] = detail.anchors.lines;
  const SCALE = 25 / 24;
  const theirs = (ms) => Math.round(ms * SCALE);
  const out = await scenes(db, 'nemo', {
    anchor_cue: `${early.cue_id},${late.cue_id}`,
    observed_at: `${theirs(early.our_time_ms) / 1000},${theirs(late.our_time_ms) / 1000}`,
    limit: '1',
  });
  assert.ok(Math.abs(out.calibration.scale - SCALE) < 0.0001);
  assert.match(out.calibration.speed_note, /slower/);
});

test('observed_at accepts H:MM:SS as well as seconds', async () => {
  const db = await loadedDb();
  const detail = await film(db, 'nemo');
  const early = detail.anchors.lines.find((a) => a.position === 'early');  // 0:04:43.701
  const out = await scenes(db, 'nemo', { anchor_cue: early.cue_id, observed_at: '0:05:12', limit: '1' });
  assert.equal(out.calibration.offset_ms, 312_000 - early.our_time_ms);
});

test('calibration inputs are validated with usable messages', async () => {
  const db = await loadedDb();
  await rejects(() => scenes(db, 'nemo', { anchor_cue: 'C0056' }), 400, /one observed_at per anchor_cue/);
  await rejects(() => scenes(db, 'nemo', { observed_at: '10:00' }), 400, /one observed_at per anchor_cue/);
  await rejects(() => scenes(db, 'nemo', { anchor_cue: 'C9999', observed_at: '10:00' }), 400, /is not an anchor line/);
  await rejects(() => scenes(db, 'nemo', { anchor_cue: 'C0056', observed_at: 'soon' }), 400, /is not a time/);
  await rejects(() => scenes(db, 'nemo', { platform: 'Disney+', anchor_cue: 'C0056', observed_at: '1:00' }), 400, /not both/);
  // No platform offsets have been measured, so platform must fail loudly and point at anchors.
  await rejects(() => scenes(db, 'nemo', { platform: 'Disney+' }), 400, /No time mappings have been measured/);
  // Two anchors that sit on top of each other cannot give a speed.
  const detail = await film(db, 'nemo');
  const cue = detail.anchors.lines[0].cue_id;
  await rejects(() => scenes(db, 'nemo', { anchor_cue: `${cue},${cue}`, observed_at: '1:00,1:01' }), 400, /at least 60s apart/);
});

test('a measured platform mapping is applied when one exists', async () => {
  const db = await loadedDb();
  await db.query(
    `insert into time_mappings (id, track_id, platform, offset_ms, scale, measured_how, confidence)
     values ('t1','nemo:opensubtitles','Disney+', 21100, 1.0, 'test fixture', 'low')
     on conflict (track_id, platform) do update set offset_ms = excluded.offset_ms`,
  );
  try {
    const out = await scenes(db, 'nemo', { presence: 'shark', platform: 'disney+' });
    assert.equal(out.calibration.method, 'platform');
    assert.equal(out.calibration.offset_ms, 21_100);
    assert.equal(out.calibration.confidence, 'low');
    assert.equal(out.scenes[0].player_time.start_ms, out.scenes[0].track_time.start_ms + 21_100);
    const detail = await film(db, 'nemo');
    assert.deepEqual(detail.calibration_platforms.available, ['Disney+']);
  } finally {
    await db.query("delete from time_mappings where id = 't1'");
  }
});

// ------------------------------------------------------------------------------------------------
// the rest of the contract
// ------------------------------------------------------------------------------------------------

test('only_confirmed keeps confirmed scenes and explains what a null removed', async () => {
  const db = await loadedDb();
  const all = await scenes(db, 'lion-king', {});
  const confirmed = await scenes(db, 'lion-king', { only_confirmed: 'true' });
  assert.ok(confirmed.scenes.length > 0);
  assert.ok(confirmed.scenes.length < all.scenes.length);
  assert.ok(confirmed.scenes.every((s) => s.confirmed_by_second_run === true));
  assert.equal(confirmed.filters_applied.only_confirmed_note, undefined);

  // Nemo has no second run at all, so only_confirmed empties it and must say why.
  const nemo = await scenes(db, 'nemo', { only_confirmed: 'yes' });
  assert.equal(nemo.scenes.length, 0);
  assert.match(nemo.filters_applied.only_confirmed_note, /no second analysis pass was run/);
});

test('every scene lists what was not assessed, and separates "there" from "talked about"', async () => {
  const db = await loadedDb();
  const out = await scenes(db, 'nemo', { limit: '30' });
  assert.equal(out.scenes.length, 30);
  const blind = new Set((await vocabulary(db, {})).groups.flatMap((g) => g.items).filter((i) => i.text_blind).map((i) => i.id));
  for (const s of out.scenes) {
    for (const n of s.not_assessed) assert.ok(blind.has(n.id), `${n.id} is not text-blind`);
    // nothing can be both present and only-talked-about
    const present = new Set(s.present.map((p) => p.id));
    for (const t of s.talked_about_only) assert.ok(!present.has(t.id));
  }
  const withMentions = out.scenes.filter((s) => s.talked_about_only.length);
  assert.ok(withMentions.length > 0, 'the mention channel should fire somewhere in this film');
});

test('GET /api/vocabulary describes every filter value', async () => {
  const db = await loadedDb();
  const out = await vocabulary(db, {});
  assert.equal(out.taxonomy_version, 'v3');
  assert.equal(out.counts.presence, 29);
  assert.equal(out.counts.event, 37);
  assert.equal(out.counts.items, 66);
  assert.equal(out.counts.text_blind, 11);
  assert.equal(out.counts.groups, 13);
  const monster = out.groups.flatMap((g) => g.items).find((i) => i.id === 'monster_creature');
  assert.equal(monster.filter, 'presence=monster_creature');
  assert.ok(!monster.also_known_as.includes('monsters'), '"monsters" is a broad word, not an alias of the narrow item');
  assert.equal(out.broad_words.terms.monster.group, 'creatures_figures');
  assert.ok(out.counts.broad_words >= 5);
  assert.match(out.text_blind_meaning, /never assessed/);
  // modifiers are not filterable and must not be offered
  assert.ok(!out.groups.flatMap((g) => g.items).some((i) => i.layer === 'modifier'));
});

test('bad parameters are 400s with an explanation', async () => {
  const db = await loadedDb();
  await rejects(() => scenes(db, 'nemo', { age: 'toddler' }), 400, /age "toddler" is not understood/);
  await rejects(() => scenes(db, 'nemo', { min_severity: '9' }), 400, /min_severity must be at most 3/);
  await rejects(() => scenes(db, 'nemo', { min_severity: 'high' }), 400, /must be a whole number/);
  await rejects(() => scenes(db, 'nemo', { only_confirmed: 'maybe' }), 400, /must be true or false/);
  await rejects(() => scenes(db, 'nemo', { limit: '5000' }), 400, /limit must be at most 300/);
  await rejects(() => scenes(db, 'nemo', { scary: 'yes' }), 400, /Unknown query parameter/);
  await rejects(() => scenes(db, 'nemo', { presence: 'a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y,z' }), 400, /at most 25 values/);
});

test('limit and offset page the scene list without reordering it', async () => {
  const db = await loadedDb();
  const all = await scenes(db, 'monsters-inc', {});
  const page1 = await scenes(db, 'monsters-inc', { limit: '5' });
  const page2 = await scenes(db, 'monsters-inc', { limit: '5', offset: '5' });
  assert.deepEqual(page1.scenes.map((s) => s.id), all.scenes.slice(0, 5).map((s) => s.id));
  assert.deepEqual(page2.scenes.map((s) => s.id), all.scenes.slice(5, 10).map((s) => s.id));
  assert.equal(page1.counts.scenes_in_film, all.counts.scenes_in_film);
});

// ------------------------------------------------------------------------------------------------
// Regressions from the code review
// ------------------------------------------------------------------------------------------------

test('an ambiguous everyday word resolves to EVERY item it could mean', async () => {
  const db = await loadedDb();
  // "shot" used to be an alias of needle_medical alone, so presence=shot on The Iron Giant — in
  // which a deer is shot with a rifle — answered "nothing matched" while presence=gun found three.
  const shot = await scenes(db, 'iron-giant', { presence: 'shot' });
  const gun = await scenes(db, 'iron-giant', { presence: 'gun' });
  const resolved = shot.filters_applied.presence[0];
  assert.deepEqual(resolved.matched.sort(), ['gun', 'needle_medical']);
  assert.equal(resolved.how, 'several_items');
  assert.match(resolved.note, /can mean more than one thing/);
  assert.ok(gun.scenes.length >= 3, `expected the rifle scenes, got ${gun.scenes.length}`);
  // Over-matching is the safe direction: "shot" must be a superset of "gun".
  const gunIds = new Set(gun.scenes.map((s) => s.id));
  assert.ok([...gunIds].every((id) => shot.scenes.some((s) => s.id === id)));
  assert.ok(shot.scenes.length >= gun.scenes.length);
  assert.equal(shot.nothing_matched, undefined);
});

test('the other shared everyday words also reach every plausible item', async () => {
  const db = await loadedDb();
  const resolve = async (term, key = 'presence') => {
    const hit = (await scenes(db, 'frankenweenie', { [key]: term })).filters_applied[key][0];
    return (hit.matched ?? []).sort();
  };
  assert.deepEqual(await resolve('shots'), ['gun', 'needle_medical']);
  assert.deepEqual(await resolve('shooting'), ['gun']);           // presence layer: only the weapon
  assert.deepEqual(await resolve('shooting', 'event'), ['weapon_used']);
  assert.deepEqual(await resolve('trap'), ['cage_net_trap']);
  assert.deepEqual(await resolve('trapped', 'event'), ['captured', 'trapped_struggling']);
  assert.deepEqual(await resolve('wound'), ['blood_wound']);
  assert.deepEqual(await resolve('wound', 'event'), ['injured']);
  assert.deepEqual(await resolve('cut'), ['blood_wound']);
  assert.deepEqual(await resolve('on fire'), ['fire']);
  assert.deepEqual(await resolve('on fire', 'event'), ['caught_in_hazard']);
  assert.deepEqual(await resolve('crash', 'event'), ['vehicle_accident']);
  assert.deepEqual(await resolve('bat'), ['rodent_bat']);
  assert.deepEqual(await resolve('bug'), ['spider_insect']);
  assert.deepEqual(await resolve('doll'), ['clown_doll_puppet']);
  assert.deepEqual(await resolve('dark'), ['darkness']);
  assert.deepEqual(await resolve('blood'), ['blood_wound']);
  assert.deepEqual(await resolve('fire'), ['fire']);
});

test('a calibration that puts the film before it begins is a 400, not a negative clock', async () => {
  const db = await loadedDb();
  // The late anchor is at 1:24:20; claiming it was heard at 10:00 implies the film started at
  // -1:14:20 on their player.
  await assert.rejects(() => scenes(db, 'nemo', { anchor_cue: 'C1420', observed_at: '600' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /do not describe a real copy of this film/);
    assert.match(err.message, /before the film begins/);
    assert.match(err.message, /check they timed the anchor line you named/);
    assert.equal(err.extra.anchors_you_used[0].cue_id, 'C1420');
    return true;
  });
  // ...and the other direction: an anchor claimed hours too late.
  await rejects(() => scenes(db, 'nemo', { anchor_cue: 'C0056', observed_at: '4:00:00' }), 400, /past where it should be/);
  // Two anchors that imply a backwards or absurd film are caught too.
  await rejects(() => scenes(db, 'nemo', { anchor_cue: 'C0056,C1420', observed_at: '0:05:12,0:06:30' }), 400, /do not describe a real copy|playback speed/);
});

test('no scene ever reports a negative player time', async () => {
  const db = await loadedDb();
  // A plausible calibration can still put the very first scene a little before zero.
  const detail = await film(db, 'nemo');
  const early = detail.anchors.lines[0];
  const out = await scenes(db, 'nemo', {
    anchor_cue: early.cue_id,
    observed_at: String((early.our_time_ms - 55_000) / 1000), // their copy runs 55s ahead of ours
  });
  assert.equal(out.calibration.applied, true);
  for (const s of out.scenes) {
    assert.ok(s.player_time.start_ms >= 0, `${s.id} start ${s.player_time.start_ms}`);
    assert.ok(s.player_time.end_ms >= 0);
    assert.ok(!s.player_time.start.startsWith('-'), `${s.id} shows ${s.player_time.start}`);
  }
  // Nemo's earliest scene is at 3:06, so a 55s shift does not actually reach zero here; the
  // pinning branch itself is exercised in unit.test.js against a scene near the start.
});

test('a group must be named, not guessed from a fragment', async () => {
  const db = await loadedDb();
  // "e" is a substring of "copyable" and used to select that group.
  await assert.rejects(() => scenes(db, 'nemo', { group: 'e' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /no group matches "e"/);
    assert.match(err.message, /not by a fragment/);
    assert.ok(err.extra.groups.length > 10);
    return true;
  });
  for (const fragment of ['e', 'a', 'ea', 'ril', 'creat']) {
    await rejects(() => scenes(db, 'nemo', { group: fragment }), 400, /group/);
  }
  // Real names still work: id, full label, and a unique whole word.
  assert.deepEqual((await scenes(db, 'nemo', { group: 'peril' })).filters_applied.group, ['peril']);
  assert.deepEqual((await scenes(db, 'nemo', { group: 'Creatures & figures on screen' })).filters_applied.group, ['creatures_figures']);
  assert.deepEqual((await scenes(db, 'nemo', { group: 'creatures' })).filters_applied.group, ['creatures_figures']);
});

test('repeated query parameters: list params merge, scalar params are a 400', async () => {
  const db = await loadedDb();
  // ?presence=shark&presence=gun used to keep only "shark".
  const merged = await scenes(db, 'iron-giant', { presence: ['shark', 'gun'] });
  assert.deepEqual(merged.filters_applied.presence.map((p) => p.you_asked), ['shark', 'gun']);
  assert.ok(merged.scenes.length > 0);
  const gunOnly = await scenes(db, 'iron-giant', { presence: 'gun' });
  assert.ok(merged.scenes.length >= gunOnly.scenes.length, 'the OR must not be narrower than one term');

  await rejects(() => scenes(db, 'nemo', { age: ['5-7', '8-10'] }), 400, /age was given 2 times/);
  await rejects(() => scenes(db, 'nemo', { limit: ['5', '10'] }), 400, /limit was given 2 times/);
  await rejects(() => films(db, { q: ['nemo', 'lion'] }), 400, /q was given 2 times/);
  // Order is preserved when anchors are repeated rather than comma-joined.
  const detail = await film(db, 'nemo');
  const [early, , late] = detail.anchors.lines;
  const two = await scenes(db, 'nemo', {
    anchor_cue: [early.cue_id, late.cue_id],
    observed_at: [String(early.our_time_ms / 1000), String(late.our_time_ms / 1000)],
  });
  assert.equal(two.calibration.method, 'two_anchors');
});

test('a parameter offered to the wrong endpoint is a 400 that names the right one', async () => {
  const db = await loadedDb();
  // /api/films?presence=shark used to ignore the filter and answer as if nothing was asked.
  await assert.rejects(() => films(db, { presence: 'shark' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /"presence" is not a parameter of GET \/api\/films/);
    assert.match(err.message, /It belongs to GET \/api\/films\/\{slug\}\/scenes/);
    assert.deepEqual(err.extra.use_instead, ['GET /api/films/{slug}/scenes']);
    return true;
  });
  await rejects(() => films(db, { age: '5' }), 400, /not a parameter of GET \/api\/films/);
  await rejects(() => film(db, 'nemo', { q: 'x' }), 400, /not a parameter of GET \/api\/films\/\{slug\}/);
  await rejects(() => vocabulary(db, { presence: 'shark' }), 400, /not a parameter of GET \/api\/vocabulary/);
  await rejects(() => scenes(db, 'nemo', { q: 'nemo' }), 400, /not a parameter of GET \/api\/films\/\{slug\}\/scenes/);
  // Each endpoint still accepts its own.
  assert.equal((await films(db, { q: 'nemo', limit: '5' })).count, 1);
});

test('the speed note states the size and the direction consistently', async () => {
  const db = await loadedDb();
  const detail = await film(db, 'nemo');
  const [early, , late] = detail.anchors.lines;
  const run = async (scale) => {
    const theirs = (ms) => Math.round(ms * scale);
    const out = await scenes(db, 'nemo', {
      anchor_cue: `${early.cue_id},${late.cue_id}`,
      observed_at: `${theirs(early.our_time_ms) / 1000},${theirs(late.our_time_ms) / 1000}`,
      limit: '1',
    });
    return out.calibration.speed_note;
  };
  // A PAL transfer: their copy is 4% SHORTER, so it runs faster, and the number printed must be
  // the positive 4.0 rather than the signed -4.0 the note used to show.
  const fast = await run(24 / 25);
  assert.match(fast, /runs 4\.0% faster than ours/);
  assert.ok(!/-\d/.test(fast), `the note must not print a signed percentage: ${fast}`);
  assert.ok(!fast.includes('slower'));
  const slow = await run(25 / 24);
  assert.match(slow, /runs 4\.2% slower than ours/);
  assert.ok(!/-\d/.test(slow), slow);
  assert.ok(!slow.includes('faster'));
  // Same speed: no percentage at all.
  assert.match(await run(1), /run at the same speed/);
});

test('min_severity=0 means no minimum and keeps every scene', async () => {
  const db = await loadedDb();
  const all = await scenes(db, 'nemo', { limit: '300' });
  const zero = await scenes(db, 'nemo', { min_severity: '0', limit: '300' });
  assert.equal(zero.scenes.length, all.scenes.length);
  assert.equal(zero.filters_applied.min_severity, 0);
  assert.match(zero.filters_applied.min_severity_note, /no minimum/);
  const one = await scenes(db, 'nemo', { min_severity: '1', limit: '300' });
  assert.ok(one.scenes.length <= zero.scenes.length);
});

test('counts.matching reports the whole match, and the caveat cannot be read as "this list is complete"', async () => {
  const db = await loadedDb();
  const page = await scenes(db, 'monsters-inc', { limit: '3' });
  assert.equal(page.counts.returned, 3);
  assert.equal(page.counts.matching, 16);
  assert.equal(page.counts.scenes_in_film, 16);
  assert.match(page.counts.more, /13 further scenes match/);
  assert.match(page.caveats.complete_for_this_film, /subset matching the filters and paging/);

  const filtered = await scenes(db, 'nemo', { presence: 'shark' });
  assert.equal(filtered.counts.returned, 4);
  assert.equal(filtered.counts.matching, 4);
  assert.equal(filtered.counts.scenes_in_film, 30);
  assert.equal(filtered.counts.more, undefined);
  assert.match(filtered.caveats.complete_for_this_film, /subset/);

  const whole = await scenes(db, 'nemo', { limit: '300' });
  assert.equal(whole.counts.returned, whole.counts.scenes_in_film);
  assert.ok(!whole.caveats.complete_for_this_film.includes('subset'));
});

test('/scenes reports the real human-review count, not a hardcoded zero', async () => {
  const db = await loadedDb();
  await db.query("update scenes set review_status = 'checked' where id = 'nemo:S01'");
  try {
    const out = await scenes(db, 'nemo', {});
    assert.match(out.caveats.human_review, /^1 of 30 scenes have review_status other than "unreviewed"/);
    const detail = await film(db, 'nemo');
    assert.equal(detail.counts.scenes_human_reviewed, 1);
    assert.equal(out.caveats.human_review, detail.caveats.human_review);
  } finally {
    await db.query("update scenes set review_status = 'unreviewed' where id = 'nemo:S01'");
  }
});

test('a talked-about label does not silently clear a text-blind item from not_assessed', async () => {
  const db = await loadedDb();
  const blind = new Set((await vocabulary(db, {})).groups.flatMap((g) => g.items).filter((i) => i.text_blind).map((i) => i.id));
  const out = await scenes(db, 'nemo', { limit: '300' });
  let checked = 0;
  for (const s of out.scenes) {
    for (const t of s.talked_about_only) {
      if (!blind.has(t.id)) continue;
      checked += 1;
      // It is talked about, which says nothing about whether it is ON SCREEN — so it is still
      // not assessed.
      assert.ok(s.not_assessed.some((n) => n.id === t.id),
        `${s.id}: ${t.id} is text-blind and only talked about, so it must stay in not_assessed`);
    }
  }
  assert.ok(checked > 0, 'nemo should have at least one text-blind mention to check');
});
