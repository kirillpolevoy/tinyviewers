// The recorded Jev run, from the loader through the endpoint.
//
// The test that matters most here is the leakage one: the recording is served whole, to a browser,
// for a film we do not own the subtitles to. RECORDINGS.md states the rule that keeps that honest —
// every string in the file is an id, a slug, a model name, an ISO date or a sha, and dialogue has
// spaces — and this asserts it against what actually came out of the database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { applySchema } from '../lib/db.js';
import { recording } from '../lib/endpoints.js';
import { findRecording, writeRecording, SLUGS, DEFAULT_EXPERIMENT_DIR } from '../load.js';
import { freshDb, loadedDb } from './helper.js';

test('the loader put a recording in the database for every film that has one', async () => {
  const db = await loadedDb();
  const { rows } = await db.query('select film_id, recorded_at from recordings order by film_id');
  assert.equal(rows.length, SLUGS.length, `expected a recording per film, got ${rows.map((r) => r.film_id).join(', ')}`);
  for (const r of rows) assert.ok(r.recorded_at instanceof Date, `${r.film_id} has no recorded_at`);
});

test('recorded_at is the run\'s own started_at, not the moment the row was written', async () => {
  const db = await loadedDb();
  const onDisk = findRecording(DEFAULT_EXPERIMENT_DIR, 'nemo');
  const { rows } = await db.query('select recorded_at from recordings where film_id = $1', ['nemo']);
  assert.equal(new Date(rows[0].recorded_at).toISOString(), new Date(onDisk.recording.meta.started_at).toISOString());
});

test('GET /api/films/{slug}/recording returns the film, the run and the excerpts', async () => {
  const db = await loadedDb();
  const body = await recording(db, 'nemo');
  assert.deepEqual(Object.keys(body).sort(), ['excerpts', 'film', 'recording']);
  assert.deepEqual(body.film, { slug: 'nemo', title: 'Finding Nemo', year: 2003 });

  const rec = body.recording;
  assert.equal(rec.meta.film, 'nemo');
  assert.equal(rec.meta.model, 'jev-1.13.0');
  // The three arrays a replay needs, and the invariants RECORDINGS.md promises about them.
  assert.equal(rec.beats.length, rec.meta.beats);
  assert.equal(rec.requests.length, rec.meta.requests);
  assert.equal(rec.timeline.length, rec.requests.length);
  assert.equal(rec.requests[0].sent_ms, 0, 'run start is the first dispatch');
  assert.equal(Math.max(...rec.requests.map((r) => r.received_ms)), rec.meta.wall_ms);
  const last = rec.timeline[rec.timeline.length - 1];
  assert.equal(last.answers_returned, rec.meta.total_answers);
  assert.equal(last.input_tokens, rec.meta.input_tokens);
  assert.equal(last.beats_resolved_total, rec.beats.length);
  for (let i = 1; i < rec.timeline.length; i++) {
    assert.ok(rec.timeline[i].t_ms >= rec.timeline[i - 1].t_ms, 'timeline is sorted by arrival');
  }
});

test('the recording carries no subtitle text at all', async () => {
  const db = await loadedDb();
  const { recording: rec } = await recording(db, 'lion-king');
  // Ids, slugs, model names, ISO dates and shas have no spaces. Dialogue does.
  const SAFE = /^[\w.:+-]+$/;
  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (path === 'thresholds.flag_rule') return; // the one prose field, and it is ours
      assert.match(node, SAFE, `${path} looks like text, not an id: ${JSON.stringify(node.slice(0, 60))}`);
      return;
    }
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(rec, '');
});

test('excerpts exist for flagged beats only, within the policy', async () => {
  const db = await loadedDb();
  const { recording: rec, excerpts } = await recording(db, 'nemo');
  assert.ok(excerpts, 'nemo has an excerpt file on this machine');
  const flagged = new Set(rec.beats.filter((b) => b.flagged).map((b) => b.id));
  assert.equal(Object.keys(excerpts).length, flagged.size);
  for (const [beatId, lines] of Object.entries(excerpts)) {
    assert.ok(flagged.has(beatId), `${beatId} is not flagged but has excerpts`);
    assert.ok(lines.length >= 1 && lines.length <= 2, `${beatId} has ${lines.length} lines`);
    for (const line of lines) {
      assert.ok(line.line.replace(/\s+/g, ' ').trim().split(' ').length <= 12, `${beatId}: over 12 words`);
      assert.ok(line.why, `${beatId}: an excerpt must say why it was chosen`);
    }
  }
});

test('a film with no recorded run is a 404, not an empty replay', async () => {
  const db = await freshDb();
  await applySchema(db);
  await db.query("insert into films (id, slug, title) values ('x', 'x', 'X')");
  await assert.rejects(() => recording(db, 'x'), /no recorded analysis run/);
  await db.end();
});

test('writeRecording is idempotent and accepts a recording with no excerpts', async () => {
  const db = await freshDb();
  await applySchema(db);
  await db.query("insert into films (id, slug, title) values ('x', 'x', 'X')");
  const rec = { meta: { started_at: '2026-01-02T03:04:05.000Z' }, beats: [], requests: [], timeline: [], thresholds: {} };
  await writeRecording(db, 'x', { recording: rec });
  await writeRecording(db, 'x', { recording: rec });
  const body = await recording(db, 'x');
  assert.equal(body.excerpts, null, 'a film without an excerpt file still replays');
  const { rows } = await db.query('select count(*)::int as n from recordings');
  assert.equal(rows[0].n, 1);
  await db.end();
});

test('deleting a film takes its recording with it', async () => {
  const db = await freshDb();
  await applySchema(db);
  await db.query("insert into films (id, slug, title) values ('x', 'x', 'X')");
  await writeRecording(db, 'x', { recording: { meta: {} }, excerpts: { 'W001.1': [] } });
  await db.query("delete from films where id = 'x'");
  const { rows } = await db.query('select count(*)::int as n from recordings');
  assert.equal(rows[0].n, 0);
  await db.end();
});
