import test from 'node:test';
import assert from 'node:assert/strict';
import { applySchema } from '../lib/db.js';
import { loadAll, buildFilm, buildVocabulary, buildV2Map, openExperiment, pickAnchors, isAnchorCandidate, anchorKey, fetchPosterUrl, fetchTmdbMeta, TMDB_IMAGE_BASE, SLUGS } from '../load.js';
import { freshDb, loadedDb } from './helper.js';

test('schema.sql applies twice cleanly', async () => {
  const db = await freshDb();
  await applySchema(db);
  await applySchema(db);            // would throw on a non-idempotent statement
  const { rows } = await db.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  assert.deepEqual(rows.map((r) => r.table_name), [
    'analysis_runs', 'anchors', 'films', 'groups', 'scene_labels', 'scenes', 'time_mappings', 'tracks', 'vocabulary',
  ]);
  await db.end();
});

test('applying schema.sql to a POPULATED database leaves the 4-column unique key in place', async () => {
  // The 4-column key lives inside `create table if not exists`, which is skipped on an existing
  // database — so on a second apply it has to be added by the explicit do-block, or the table is
  // left with no unique key at all and the loader can double-insert.
  const db = await freshDb();
  await loadAll(db, { tmdbApiKey: null });                         // creates and fills
  await applySchema(db);                         // the upgrade path over real rows
  await applySchema(db);                         // and again

  const constraint = async () => {
    const { rows } = await db.query(
      `select c.conname, array_agg(a.attname order by a.attname) as cols
         from pg_constraint c
         join unnest(c.conkey) k(attnum) on true
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.conrelid = 'scene_labels'::regclass and c.contype = 'u'
        group by c.conname`,
    );
    return rows;
  };
  const found = await constraint();
  assert.equal(found.length, 1, `expected exactly one unique key, got ${JSON.stringify(found)}`);
  assert.deepEqual(found[0].cols.sort(), ['channel', 'scene_id', 'source', 'vocabulary_id']);

  // And it actually bites.
  const { rows: one } = await db.query('select * from scene_labels limit 1');
  await assert.rejects(
    () => db.query(
      `insert into scene_labels (id, scene_id, vocabulary_id, channel, source, asserted)
       values ('dupe', $1, $2, $3, $4, false)`,
      [one[0].scene_id, one[0].vocabulary_id, one[0].channel, one[0].source],
    ),
    /duplicate key|unique/i,
  );
  // The data survived the re-apply.
  const { rows: still } = await db.query('select count(*)::int as n from scenes');
  assert.equal(still[0].n, 103);
  await db.end();
});

test('the loader is idempotent: loading twice leaves exactly the same rows', async () => {
  const db = await freshDb();
  const snapshot = async () => {
    const out = {};
    for (const t of ['films', 'tracks', 'anchors', 'analysis_runs', 'scenes', 'scene_labels', 'vocabulary', 'groups']) {
      const { rows } = await db.query(`select count(*)::int as n from ${t}`);
      out[t] = rows[0].n;
    }
    const { rows: digest } = await db.query(
      `select md5(string_agg(x, '|' order by x)) as d from (
         select id || ':' || start_ms || ':' || end_ms || ':' || coalesce(severity_5_7::text,'-') as x from scenes
       ) t`,
    );
    out.sceneDigest = digest[0].d;
    const { rows: ldigest } = await db.query(
      `select md5(string_agg(x, '|' order by x)) as d from (
         select id || ':' || coalesce(probability::text,'-') || ':' || asserted as x from scene_labels
       ) t`,
    );
    out.labelDigest = ldigest[0].d;
    return out;
  };

  await loadAll(db, { tmdbApiKey: null });
  const first = await snapshot();
  await loadAll(db, { tmdbApiKey: null });
  const second = await snapshot();
  assert.deepEqual(second, first);
  assert.equal(first.films, SLUGS.length);
  assert.ok(first.scenes > 90, `expected ~103 scenes, got ${first.scenes}`);
  assert.ok(first.scene_labels > 5000, `expected thousands of labels, got ${first.scene_labels}`);
  await db.end();
});

test('reloading one film replaces only that film, leaving the other five byte-identical', async () => {
  const db = await freshDb();
  await loadAll(db, { tmdbApiKey: null });

  // A total row count would not notice one film's rows being swapped for another's, so digest
  // each film separately.
  const perFilm = async () => {
    const { rows } = await db.query(
      `select s.film_id,
              count(*)::int as scenes,
              md5(string_agg(s.id || ':' || s.start_ms || ':' || s.end_ms || ':' || s.title, '|' order by s.id)) as scene_digest,
              (select md5(string_agg(l.id || ':' || coalesce(l.probability::text,'-') || ':' || l.asserted
                                     || ':' || coalesce(l.confidence_kind,'-') || ':' || coalesce(l.detail,'-'),
                                     '|' order by l.id))
                 from scene_labels l join scenes s2 on s2.id = l.scene_id where s2.film_id = s.film_id) as label_digest
         from scenes s group by s.film_id order by s.film_id`,
    );
    return Object.fromEntries(rows.map((r) => [r.film_id, r]));
  };

  const before = await perFilm();
  assert.equal(Object.keys(before).length, SLUGS.length);
  await loadAll(db, { slugs: ['nemo'] });
  const after = await perFilm();

  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const slug of SLUGS) {
    assert.deepEqual(after[slug], before[slug], `${slug} changed when only nemo was reloaded`);
  }
  await db.end();
});

test('every film gets three usable anchors: 4-12 words, unique, no sound captions or lyrics', async () => {
  const exp = await openExperiment();
  const { items } = buildVocabulary(exp.taxonomy);
  const ctx = {
    dir: exp.dir, srt: exp.srt, films: exp.films, tracksMeta: exp.tracksMeta,
    v2map: buildV2Map(exp.taxonomy), vocabIds: new Set(items.map((i) => i.id)),
  };
  for (const slug of SLUGS) {
    const built = buildFilm(slug, ctx);
    assert.equal(built.anchors.length, 3, `${slug} anchors`);
    assert.deepEqual(built.anchors.map((a) => a.position), ['early', 'middle', 'late']);
    for (const a of built.anchors) {
      const words = a.quote.split(/\s+/).filter(Boolean);
      assert.ok(words.length >= 4 && words.length <= 12, `${slug} ${a.position}: ${words.length} words`);
      assert.ok(!/[#♪]/.test(a.quote), `${slug} ${a.position} looks like a lyric`);
      assert.ok(!/[[(]/.test(a.quote), `${slug} ${a.position} looks like a sound caption`);
      assert.ok(a.start_ms > 0);
    }
    // early < middle < late, and they are spread across the film
    const t = built.anchors.map((a) => a.start_ms);
    assert.ok(t[0] < t[1] && t[1] < t[2], `${slug} anchors out of order`);
    assert.ok(t[2] - t[0] > 60_000, `${slug} anchors too close together`);
  }
});

test('anchor candidate rules reject captions, lyrics, speaker labels and repeated lines', () => {
  const counts = new Map([[anchorKey('Run away, Scar, and never return.'), 1], [anchorKey('Nemo! Nemo! Nemo! Nemo! Nemo!'), 3]]);
  const cue = (text) => ({ text });
  assert.equal(isAnchorCandidate(cue('Run away, Scar, and never return.'), counts), true);
  assert.equal(isAnchorCandidate(cue('Nemo! Nemo! Nemo! Nemo! Nemo!'), counts), false); // not unique
  assert.equal(isAnchorCandidate(cue('# Hakuna matata what a wonderful phrase #'), counts), false);
  assert.equal(isAnchorCandidate(cue('(geese honking in the distance)'), counts), false);
  assert.equal(isAnchorCandidate(cue('FINK: We should go there now.'), counts), false);
  assert.equal(isAnchorCandidate(cue('- Yes. - No, not at all.'), counts), false);
  assert.equal(isAnchorCandidate(cue('Too short.'), counts), false);
});

test('the two v2 ids with no v3 successor fold into `dies` and keep their detail', async () => {
  const db = await freshDb();
  const { reports } = await loadAll(db, { tmdbApiKey: null });
  const temporary = new Set(reports.flatMap((r) => Object.keys(r.temporary_v2_mapping)));
  assert.deepEqual([...temporary].sort(), ['loved_one_dies', 'pet_animal_dies']);

  const { rows } = await db.query(
    "select scene_id, detail from scene_labels where vocabulary_id = 'dies' and detail is not null order by scene_id",
  );
  assert.ok(rows.length >= 6, `expected the 9 folded attributes, got ${rows.length} rows`);
  for (const r of rows) assert.match(r.detail, /a pet or animal|a loved one/);
  // Nothing was dropped: every scene that had one of those attributes now has a `dies` label.
  const { rows: orphans } = await db.query(
    "select count(*)::int as n from scene_labels where detail is not null and vocabulary_id <> 'dies'",
  );
  assert.equal(orphans[0].n, 0);

  for (const r of reports) assert.equal(r.scenes_without_jev_beats.length, 0, `${r.slug} has scenes with no Jev beat`);
  for (const r of reports) assert.equal(r.scenes_without_presence_run.length, 0, `${r.slug} has scenes the presence run missed`);
  await db.end();
});

test('presence is asserted only by the per-scene run; the per-beat screener never asserts', async () => {
  const db = await freshDb();
  await loadAll(db, { tmdbApiKey: null });
  const { rows } = await db.query(
    `select source, channel, asserted, count(*)::int as n from scene_labels
      where channel in ('presence','mention') group by 1,2,3 order by 1,2,3`,
  );
  for (const r of rows) {
    if (r.source === 'jev-1.13.0') assert.equal(r.asserted, false, 'a per-beat probability must never assert');
    if (r.source === 'claude-sonnet-5') assert.equal(r.asserted, true);
  }
  // Both sources keep their own row for the same item, so agreement can be reported.
  const { rows: both } = await db.query(
    `select count(*)::int as n from scene_labels a join scene_labels b
       on a.scene_id = b.scene_id and a.vocabulary_id = b.vocabulary_id and a.channel = b.channel
      where a.source = 'claude-sonnet-5' and b.source = 'jev-1.13.0' and a.channel = 'presence'`,
  );
  assert.ok(both[0].n > 0, 'the two sources should overlap somewhere');
  // Every asserted presence label records how it knows.
  const { rows: kinds } = await db.query(
    "select distinct confidence_kind from scene_labels where channel = 'presence' and asserted order by 1",
  );
  assert.deepEqual(kinds.map((k) => k.confidence_kind), ['known_from_film', 'stated_in_lines']);
  await db.end();
});

test('nemo has no second run, so confirmed_by_second_run is null there and set elsewhere', async () => {
  const db = await freshDb();
  await loadAll(db, { tmdbApiKey: null });
  const nemo = await db.query('select distinct confirmed_by_second_run as c from scenes where film_id = $1', ['nemo']);
  assert.deepEqual(nemo.rows.map((r) => r.c), [null]);
  const lk = await db.query('select count(*)::int as n from scenes where film_id = $1 and confirmed_by_second_run is not null', ['lion-king']);
  assert.ok(lk.rows[0].n > 0);
  await db.end();
});

// Subtitles are copyrighted. The rule is that nothing but the three short anchor quotes per film
// may be verbatim, so this reads the actual stored strings and compares them against the actual
// subtitle text, rather than checking that no column is *named* "subtitle".
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const shingles = (list, n) => {
  const out = new Set();
  for (let i = 0; i + n <= list.length; i++) out.add(list.slice(i, i + n).join(' '));
  return out;
};

test('no verbatim subtitle text reaches the database beyond the anchor quotes', async () => {
  const RUN = 8; // a run of 8 consecutive words in common is a quotation, not a coincidence
  const db = await freshDb();
  await loadAll(db, { tmdbApiKey: null });
  const exp = await openExperiment();

  for (const slug of SLUGS) {
    const cues = exp.srt.parseSrt(
      (await import('node:fs')).readFileSync(`${exp.dir}/data/${slug}.srt`, 'utf8'),
    );
    // Every 8-word run that occurs consecutively inside one cue of this film.
    const fromFilm = new Set();
    for (const c of cues) for (const s of shingles(words(c.text), RUN)) fromFilm.add(s);

    const { rows } = await db.query(
      `select id, title, coalesce(description,'') as description from scenes where film_id = $1`, [slug],
    );
    const { rows: details } = await db.query(
      `select l.id, coalesce(l.detail,'') as detail from scene_labels l
         join scenes s on s.id = l.scene_id where s.film_id = $1 and l.detail is not null`, [slug],
    );

    const checkField = (where, text) => {
      for (const s of shingles(words(text), RUN)) {
        assert.ok(!fromFilm.has(s), `${where} quotes the subtitles verbatim: "${s}"`);
      }
    };
    for (const r of rows) {
      checkField(`${r.id}.title`, r.title);
      checkField(`${r.id}.description`, r.description);
    }
    for (const d of details) checkField(`${d.id}.detail`, d.detail);

    // Titles and details are short by construction; assert that too, so a future change that
    // started pasting lines into them would fail here as well as above.
    for (const r of rows) assert.ok(words(r.title).length <= 12, `${r.id} title is ${words(r.title).length} words`);
    for (const d of details) assert.ok(words(d.detail).length <= 8, `${d.id} detail is too long`);

    // The anchors ARE verbatim, deliberately, and capped at 12 words.
    const { rows: anchors } = await db.query(
      'select a.quote from anchors a join tracks t on t.id = a.track_id where t.film_id = $1', [slug],
    );
    assert.equal(anchors.length, 3);
    for (const a of anchors) assert.ok(words(a.quote).length <= 12, `anchor quote too long: ${a.quote}`);
    // Total verbatim text stored for a film: three short lines, nothing else.
    const verbatimWords = anchors.reduce((n, a) => n + words(a.quote).length, 0);
    assert.ok(verbatimWords <= 36, `${slug} stores ${verbatimWords} verbatim words`);
  }
  await db.end();
});

// ------------------------------------------------------------------------------------------------
// short_label: the 1-3 plain words a scene row shows instead of the full sentence label
// ------------------------------------------------------------------------------------------------

test('every presence and event item has a short_label, and modifiers have none', async () => {
  const exp = await openExperiment();
  const { items } = buildVocabulary(exp.taxonomy);

  const scannable = items.filter((i) => i.layer === 'presence' || i.layer === 'event');
  assert.equal(scannable.length, exp.taxonomy.PRESENCE.length + exp.taxonomy.EVENTS.length);
  for (const i of scannable) {
    assert.ok(i.short_label, `${i.id} has no short_label`);
    const wordCount = i.short_label.trim().split(/\s+/).length;
    assert.ok(wordCount >= 1 && wordCount <= 3, `${i.id} short_label "${i.short_label}" is ${wordCount} words`);
    // Sentence case: a capital first letter and no ALL-CAPS shouting.
    assert.match(i.short_label, /^[A-Z]/, `${i.id} short_label is not sentence case`);
    assert.doesNotMatch(i.short_label, /[.,;:!?()]/, `${i.id} short_label carries punctuation`);
    assert.notEqual(i.short_label, i.short_label.toUpperCase());
  }
  for (const i of items.filter((x) => x.layer === 'modifier')) {
    assert.equal(i.short_label, null, `${i.id} is a modifier and should have no short_label`);
  }
});

test('a taxonomy item with no short_label is a hard error, not a silent sentence in a scene row', async () => {
  const exp = await openExperiment();
  const taxonomy = {
    ...exp.taxonomy,
    PRESENCE: [...exp.taxonomy.PRESENCE, { id: 'brand_new_thing', layer: 'presence', group: 'objects_hazards', label: 'A brand new thing nobody has named yet' }],
  };
  assert.throws(() => buildVocabulary(taxonomy), /no short_label for taxonomy item "brand_new_thing"/);
});

test('short_label reaches the database, and the words the design uses are the words stored', async () => {
  const db = await loadedDb();
  const { rows } = await db.query(
    "select id, short_label from vocabulary where layer in ('presence','event') and short_label is null",
  );
  assert.deepEqual(rows, []);

  // The exact tags read off the film page in the design canvas.
  const expected = {
    shark: 'Shark',
    large_predator: 'Big predator',
    deep_dark_water: 'Deep water',
    believed_dead: 'Thought dead',
    jump_scare: 'Sudden scare',
    chased: 'Chase',
    terrified: 'Panic',
    darkness: 'Darkness',
    blood_wound: 'Blood',
    scary_appearance: 'Scary-looking character',
    child_taken: 'Child taken',
    family_in_danger: 'Family in danger',
    dangerous_machine: 'Machinery',
    needle_medical: 'Needles and medical',
  };
  const { rows: stored } = await db.query(
    'select id, short_label from vocabulary where id = any($1) order by id',
    [Object.keys(expected)],
  );
  assert.equal(stored.length, Object.keys(expected).length);
  for (const r of stored) assert.equal(r.short_label, expected[r.id], `${r.id}`);

  // A real scene's tag list is scannable: presence first, then events, all short.
  const { rows: tags } = await db.query(
    `select v.layer, v.short_label
       from scene_labels l join vocabulary v on v.id = l.vocabulary_id
      where l.scene_id = 'nemo:S01' and l.asserted and l.channel in ('presence','event')
      order by case v.layer when 'presence' then 0 else 1 end, v.short_label`,
  );
  assert.ok(tags.length > 0);
  for (const t of tags) assert.ok(t.short_label.split(/\s+/).length <= 3, t.short_label);
});

// ------------------------------------------------------------------------------------------------
// poster_url and overview: filled from TMDB by IMDb id when a key is present, null in every other
// case. One request carries both.
// ------------------------------------------------------------------------------------------------

test('fetchTmdbMeta returns the poster and the synopsis from one lookup', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        movie_results: [{ id: 12, poster_path: '/abc123.jpg', overview: '  A clownfish searches.  ' }],
      }),
    };
  };
  const meta = await fetchTmdbMeta('tt0266543', { apiKey: 'k', fetchImpl });
  assert.deepEqual(meta, {
    poster_url: `${TMDB_IMAGE_BASE}/abc123.jpg`,
    overview: 'A clownfish searches.',
  });
  assert.equal(calls, 1, 'the poster and the synopsis cost one request, not two');
});

test('fetchTmdbMeta returns nulls, never an invented synopsis, for every way the lookup can fail', async () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  const none = { poster_url: null, overview: null };
  assert.deepEqual(await fetchTmdbMeta('tt1', { apiKey: null, fetchImpl: ok({}) }), none, 'no api key');
  assert.deepEqual(await fetchTmdbMeta(null, { apiKey: 'k', fetchImpl: ok({}) }), none, 'no imdb id');
  assert.deepEqual(await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 404 }) }), none, 'http error');
  assert.deepEqual(await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [] }) }), none, 'no match');
  assert.deepEqual(await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } }), none, 'request threw');

  // TMDB answers with an empty string for a film it has no synopsis for, and the two fields fail
  // independently: a record can have a poster and no words, or words and no poster.
  const empty = await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [{ poster_path: '/p.jpg', overview: '   ' }] }) });
  assert.deepEqual(empty, { poster_url: `${TMDB_IMAGE_BASE}/p.jpg`, overview: null });
  const wordsOnly = await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [{ poster_path: null, overview: 'A robot.' }] }) });
  assert.deepEqual(wordsOnly, { poster_url: null, overview: 'A robot.' });
  const notAString = await fetchTmdbMeta('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [{ poster_path: '/p.jpg', overview: 42 }] }) });
  assert.equal(notAString.overview, null, 'a non-string overview is not a synopsis');
});

test('fetchPosterUrl returns an absolute TMDB URL for a film it finds', async () => {
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ movie_results: [{ id: 12, poster_path: '/abc123.jpg' }] }) };
  };
  const got = await fetchPosterUrl('tt0266543', { apiKey: 'k', fetchImpl });
  assert.equal(got, `${TMDB_IMAGE_BASE}/abc123.jpg`);
  assert.match(seen, /find\/tt0266543\?external_source=imdb_id/);
});

test('fetchPosterUrl returns null, never a guess, for every way the lookup can fail', async () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  assert.equal(await fetchPosterUrl('tt1', { apiKey: null, fetchImpl: ok({}) }), null, 'no api key');
  assert.equal(await fetchPosterUrl(null, { apiKey: 'k', fetchImpl: ok({}) }), null, 'no imdb id');
  assert.equal(await fetchPosterUrl('tt1', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 404 }) }), null, 'http error');
  assert.equal(await fetchPosterUrl('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [] }) }), null, 'no match');
  assert.equal(await fetchPosterUrl('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [{ poster_path: null }] }) }), null, 'match with no poster');
  assert.equal(await fetchPosterUrl('tt1', { apiKey: 'k', fetchImpl: ok({ movie_results: [{ poster_path: 'not-a-path' }] }) }), null, 'malformed path');
  assert.equal(await fetchPosterUrl('tt1', { apiKey: 'k', fetchImpl: async () => { throw new Error('offline'); } }), null, 'request threw');
});

test('the loader stores a poster and a synopsis when a key is present, and nulls when it is not', async () => {
  const fetchImpl = async (url) => {
    const imdb = /tt\d+/.exec(url)[0];
    return {
      ok: true,
      json: async () => ({ movie_results: [{ poster_path: `/${imdb}.jpg`, overview: `About ${imdb}.` }] }),
    };
  };

  const withKey = await freshDb();
  const res = await loadAll(withKey, { slugs: ['nemo', 'lion-king'], tmdbApiKey: 'test-key', fetchImpl });
  assert.equal(res.posters, 2);
  assert.equal(res.overviews, 2);
  const { rows } = await withKey.query('select slug, imdb_id, poster_url, overview from films order by slug');
  for (const r of rows) {
    assert.equal(r.poster_url, `${TMDB_IMAGE_BASE}/${r.imdb_id}.jpg`, r.slug);
    assert.equal(r.overview, `About ${r.imdb_id}.`, r.slug);
  }
  await withKey.end();

  const noKey = await freshDb();
  const res2 = await loadAll(noKey, { slugs: ['nemo'], tmdbApiKey: null, fetchImpl });
  assert.equal(res2.posters, 0);
  assert.equal(res2.overviews, 0);
  assert.equal(res2.postersLookedUp, false);
  const { rows: none } = await noKey.query('select poster_url, overview from films');
  assert.deepEqual(none, [{ poster_url: null, overview: null }]);
  await noKey.end();
});

test('a failed poster lookup is a note, not a failed load', async () => {
  const db = await freshDb();
  const res = await loadAll(db, {
    slugs: ['nemo'],
    tmdbApiKey: 'test-key',
    fetchImpl: async () => { throw new Error('TMDB is down'); },
  });
  assert.equal(res.posters, 0);
  assert.ok(res.reports[0].notes.some((n) => /no poster came back/.test(n)));
  const { rows } = await db.query('select title, poster_url from films');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].poster_url, null);
  await db.end();
});

test('a poster lookup that never finishes is abandoned, not waited on', async () => {
  // The failure this guards against: fetch resolves as soon as the headers arrive, so a deadline
  // on the request alone still leaves a body that never ends free to hang the whole load.
  let aborted = false;
  const fetchImpl = async (_url, { signal } = {}) => ({
    ok: true,
    json: () =>
      new Promise((_resolve, reject) => {
        // A body that never settles, exactly as a stalled connection behaves.
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }),
  });

  const started = Date.now();
  const got = await fetchPosterUrl('tt0266543', { apiKey: 'k', fetchImpl, timeoutMs: 50 });
  const elapsed = Date.now() - started;

  assert.equal(got, null, 'an abandoned lookup is a null poster, never a thrown load');
  assert.ok(aborted, 'the body read was aborted, not just the request');
  assert.ok(elapsed < 2000, `gave up in ${elapsed}ms`);
});

test('a slow lookup does not fail the film it belongs to', async () => {
  const db = await freshDb();
  const res = await loadAll(db, {
    slugs: ['nemo'],
    tmdbApiKey: 'test-key',
    timeoutMs: 40,
    fetchImpl: async (_url, { signal } = {}) => ({
      ok: true,
      json: () => new Promise((_r, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    }),
  });
  assert.equal(res.posters, 0);
  const { rows } = await db.query('select title, poster_url from films');
  assert.equal(rows.length, 1, 'the film still loaded');
  assert.equal(rows[0].poster_url, null);
  await db.end();
});
