// A film's GUIDE rows -- the tables web/lib/queries.ts reads (films, tracks, anchors, analysis_runs,
// scenes, scene_labels, time_mappings) -- as one document, so a rebuild can replace them atomically and
// put the old ones back.
//
//   snapshotGuide(tx, filmId)          every guide row of one film, as { film, tracks, anchors, ... }
//   backupGuide(tx, filmId, meta)      that snapshot into guide_backups; returns the backup id
//   replaceGuide(tx, filmId, built)    delete the film's track/scene/label/run rows and insert `built`'s
//                                      (the films row itself is kept: its id, slug, poster and synopsis,
//                                      and anything else that points at it, stay)
//   restoreGuide(db, backupId)         put a backup back, in one transaction, after backing up what it
//                                      replaces (so a restore can itself be undone)
//
// Every write is inside the caller's transaction (restoreGuide opens its own): a film is never seen
// half-replaced by the page.
import { insertRows } from '../load.js';
import { PipelineError } from '../pipeline/errors.js';

const parsed = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Every guide row of one film. Numeric columns come back as the driver gives them; insert takes them back. */
export async function snapshotGuide(tx, filmId) {
  const one = async (sql) => (await tx.query(sql, [filmId])).rows;
  const [film] = await one('select * from films where id = $1');
  if (!film) return null;
  return {
    film,
    tracks: await one('select * from tracks where film_id = $1 order by id'),
    anchors: await one('select a.* from anchors a join tracks t on t.id = a.track_id where t.film_id = $1 order by a.id'),
    time_mappings: await one('select m.* from time_mappings m join tracks t on t.id = m.track_id where t.film_id = $1 order by m.id'),
    analysis_runs: await one('select * from analysis_runs where film_id = $1 order by id'),
    scenes: await one('select * from scenes where film_id = $1 order by start_ms, id'),
    scene_labels: await one('select l.* from scene_labels l join scenes s on s.id = l.scene_id where s.film_id = $1 order by l.id'),
  };
}

export async function backupGuide(tx, filmId, { reason, jobId = null, pipelineVersion = null } = {}) {
  const snap = await snapshotGuide(tx, filmId);
  if (!snap) throw new PipelineError('no_such_film', 'There is no film with that id to back up.');
  const { rows } = await tx.query(
    `insert into guide_backups (film_id, slug, reason, job_id, pipeline_version, scene_count, doc)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb) returning id`,
    [filmId, snap.film.slug, reason, jobId, pipelineVersion, snap.scenes.length, JSON.stringify(snap)],
  );
  return Number(rows[0].id);
}

/** Delete one film's guide rows below the films row. Tracks cascade to anchors, time mappings, scenes and labels. */
async function clearGuide(tx, filmId) {
  await tx.query('delete from scenes where film_id = $1', [filmId]);
  await tx.query('delete from analysis_runs where film_id = $1', [filmId]);
  await tx.query('delete from tracks where film_id = $1', [filmId]);
}

/** Replace a film's guide with `built` (buildGuide's shape). The films row is kept, not rewritten. */
export async function replaceGuide(tx, filmId, built) {
  await clearGuide(tx, filmId);
  await insertRows(tx, 'tracks', [built.track]);
  await insertRows(tx, 'anchors', built.anchors);
  await insertRows(tx, 'analysis_runs', built.runs);
  await insertRows(tx, 'scenes', built.scenes);
  await insertRows(tx, 'scene_labels', built.labels);
}

const stripTs = (rows) => rows.map((r) => ({ ...r }));

/**
 * Put a backup back. The current guide is backed up first (reason 'before_restore'), then replaced by
 * the backup's rows. Returns { restored, backup_of_current }.
 */
export async function restoreGuide(db, backupId, { lock = null, unlock = null } = {}) {
  return db.withTransaction(async (tx) => {
    // `lock`: the caller's serialisation with rebuilds (lib/admin.js takes the one-live-job lock here),
    // inside this transaction, so it is held exactly as long as the restore and released with it.
    if (lock) await lock(tx);
    const { rows } = await tx.query('select id, film_id, doc from guide_backups where id = $1', [backupId]);
    const b = rows[0];
    if (!b) throw new PipelineError('no_such_backup', 'There is no guide backup with that id.');
    const doc = parsed(b.doc);
    const { rows: f } = await tx.query('select id from films where id = $1 for update', [b.film_id]);
    if (!f[0]) throw new PipelineError('no_such_film', 'The film this backup belongs to is no longer in the library.');
    const current = await backupGuide(tx, b.film_id, { reason: `before_restore_of_${b.id}` });
    await clearGuide(tx, b.film_id);
    await insertRows(tx, 'tracks', stripTs(doc.tracks));
    await insertRows(tx, 'anchors', stripTs(doc.anchors));
    await insertRows(tx, 'time_mappings', stripTs(doc.time_mappings ?? []));
    await insertRows(tx, 'analysis_runs', stripTs(doc.analysis_runs));
    await insertRows(tx, 'scenes', stripTs(doc.scenes));
    await insertRows(tx, 'scene_labels', stripTs(doc.scene_labels));
    await tx.query('update guide_backups set restored_at = now() where id = $1', [b.id]);
    if (unlock) await unlock(tx);
    return { restored: Number(b.id), film_id: b.film_id, scenes: doc.scenes.length, backup_of_current: current };
  });
}

export async function listBackups(db, filmId) {
  const { rows } = await db.query(
    'select id, film_id, slug, reason, job_id, pipeline_version, scene_count, taken_at, restored_at from guide_backups where film_id = $1 order by id desc',
    [filmId],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
