// The last stage of a Jev-first run: the flagged scenes into the tables the web already reads, and the
// run's documents into the per-film artifact tables (which the demo reads). ONE transaction: a film is
// either all there -- guide rows, artifacts, ledger -- or not there at all.
//
// Two modes, decided by the job:
//   add      a new film: a slug is claimed inside the transaction and the film row is written.
//   rebuild  an existing library film (job.film.rebuild_of = its films.id): the previous guide rows are
//            copied into guide_backups (restorable, pipeline-jevfirst/guide.js) and then REPLACED, in the
//            same transaction. The films row (slug, poster, synopsis) is kept.
//
// How a selected scene becomes a `scenes` row (what web/lib/queries.ts getFilmScenes reads, unchanged):
//   rows        the FLAGGED scenes only, in time order -- the guide lists what a parent may skip
//   start/end   the extent of the scene's skip spans (moments.js + the v10.3 span bridge), else its bounds
//   title       the shown title (mergetext, text rule A0>C: a Jev-verified Sonnet title, strict first,
//               else loose), else 'Flagged scene' -- never a title built by code
//   description the shown text under the same rule, or null when nothing passed -- never unchecked text
//   severity    select.js severity level per band (0-3)
//   why_tags    { line, tags: [{ label, by, p }] }: the flag reasons in order, for the page's "why" chips
//   labels      WHY THE SCENE IS FLAGGED, as chips: every why_tags tag (the flag reasons' own labels,
//               'Creature threatens', 'Child in danger'; a film-specific reason by its stable category,
//               'Character in danger', see FILM_REASON_CATEGORY) is an ASSERTED 'event' label on a
//               vocabulary row of its own ('reason:<label>', taxonomy_version 'reasons-v10.4'), one row per model that
//               raised it (source = jev-1.13.0 / claude-sonnet-5, detail = the reason ids). What is IN the
//               scene -- act-level taxonomy-v3 presence tags (shark, monster) -- stays an asserted
//               'presence' label. Act-level v3 EVENT tags that are not the flag's reasons are kept as
//               unasserted rows (never a chip), so the page's event chips are exactly the reasons; they
//               are marked (detail ACT_EVENT_DETAIL) and still match GET /api/films/{slug}/scenes?event=.
import crypto from 'node:crypto';
import { buildVocabulary, pickAnchors, ensureVocabulary, writeFilmRows } from '../../load.js';
import { invalidateVocabularyCache, ACT_EVENT_DETAIL } from '../../lib/data.js';
import { slugify } from '../../lib/tmdb.js';
import * as taxonomy from '../taxonomy-v3.js';
import { BY_ID as V3 } from '../taxonomy-v3.js';
import { writeArtifacts } from '../store.js';
import { backupGuide, replaceGuide } from '../guide.js';
import { fail, SONNET_MODEL, JEV_MODEL, quoteSafe, quoteGrams } from './common.js';
import { quoteRuns } from '../pack/validate.js';
import { strengthOf } from '../strength.js';

export const PIPELINE_VERSION = 'jevfirst-v10.4';
export const REASONS_VOCAB_VERSION = 'reasons-v10.4';
const SOUND_CAPTION = /[[(][^)\]]{1,60}[\])]/;
const vocabIds = new Set(buildVocabulary(taxonomy).items.map((i) => i.id));
const MODEL_OF = { jev: JEV_MODEL, sonnet: SONNET_MODEL };

/** The vocabulary id of a why tag's label: 'reason:creature-threatens'. Pure. */
export const reasonVocabId = (label) => `reason:${String(label).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flagged'}`;

/**
 * A film-specific flag reason's stable, parent-facing category. The reason's own label names the film's
 * character or danger ("The Iron Giant in danger", "Power substation electrocution endangers someone"):
 * true, but useless as a filter and noisy as a chip. The chip and the filter use the category; the
 * label stays as the detail inside the scene. Reasons that are not film-specific are their own category.
 */
export const FILM_REASON_CATEGORY = {
  film_child_in_danger: 'Character in danger',
  film_threatens: 'Villain or creature threatens',
  film_danger: 'Dangerous situation',
};
export const reasonCategory = (rule) => FILM_REASON_CATEGORY[rule] ?? null;

/**
 * The why tags of a flagged scene (select.js why_tags), in the demo's and the guide's shape:
 * { label, category, ids, by, p, rule }. `category` is null when the label is already general. Pure.
 */
export function whyTagsOf(s) {
  return (s.why_tags?.tags ?? []).map((t) => ({ label: t.label, category: reasonCategory(t.rule), ids: t.ids ?? [], by: (t.by ?? []).filter((b) => b === 'jev' || b === 'sonnet'), p: t.p ?? null, rule: t.rule ?? null }));
}

/**
 * The last gate before a parent reads a text, with the transcript's grams. What a parent reads is the
 * title and then the description, one after the other, so the rule is checked over that WHOLE text, not
 * over each piece alone: two five-word sentences that together copy ten subtitle words are a quote.
 *   1. a title, or a description sentence, that holds a run of more than eight subtitle words on its own
 *      is dropped;
 *   2. then the kept pieces are read together, in order; while a run still crosses from one piece into
 *      the next, the LATER piece it touches is dropped (the title and the earlier sentences are kept).
 * The rest of the description stays. Never repaired here -- a repaired text is not the text Jev checked.
 * Pure.
 */
export function quoteGate(title, description, grams) {
  if (!grams) return { title, description, dropped: 0 };
  const sentences = description ? description.split(/(?<=[.!?…]["')\]]?)\s+/).filter(Boolean) : [];
  const pieces = [...(title ? [{ title: true, text: title }] : []), ...sentences.map((text) => ({ title: false, text }))];
  const kept = pieces.filter((p) => quoteSafe(p.text, grams));
  for (;;) {
    const runs = quoteRuns(kept.map((p) => p.text).join(' '), grams);
    if (!runs.length) break;
    // the run's token range, mapped onto the pieces (quoteRuns counts whitespace tokens of the joined text)
    const [a, b] = runs[0];
    let tok = 0;
    let last = -1;
    kept.forEach((p, i) => {
      const n = p.text.split(/\s+/).filter(Boolean).length;
      if (tok <= b && tok + n - 1 >= a) last = i;
      tok += n;
    });
    kept.splice(last, 1);
  }
  const t = kept.find((p) => p.title)?.text ?? null;
  const d = kept.filter((p) => !p.title).map((p) => p.text);
  return { title: title ? t : title, description: description ? (d.length ? d.join(' ') : null) : description, dropped: pieces.length - kept.length };
}

/**
 * The guide rows of one selection (select3's output). Pure; also what a demo run's result lists.
 * `grams` (common.js quoteGrams of the film's cues): apply the quotation rule's final gate (quoteGate).
 */
export function guideRows(tags, { grams = null } = {}) {
  return tags.scenes.filter((s) => s.flagged).map((s) => {
    const spans = s.skip?.spans ?? [];
    const start = spans.length ? Math.min(...spans.map((x) => x.start_ms)) : s.start_ms;
    const end = spans.length ? Math.max(...spans.map((x) => x.end_ms)) : s.end_ms;
    const presence = [];
    const otherEvents = [];
    const seen = new Set();
    for (const t of s.tags ?? []) {
      if (t.level !== 'act' || !t.v3 || !vocabIds.has(t.v3) || seen.has(t.v3)) continue;
      const layer = V3[t.v3]?.layer;
      if (layer !== 'presence' && layer !== 'event') continue;
      seen.add(t.v3);
      (layer === 'presence' ? presence : otherEvents).push({ vocabulary_id: t.v3, channel: layer, by: t.by === 'sonnet' ? 'sonnet' : 'jev', p: t.p });
    }
    const why = whyTagsOf(s);
    const text = quoteGate(s.why?.title ?? null, s.why?.text ?? null, grams);
    return {
      scene_id: s.id, start_ms: start, end_ms: Math.max(end, start), start_cue: s.start_cue, end_cue: s.end_cue,
      title: text.title ?? 'Flagged scene', description: text.description ?? null, text_source: s.why?.source ?? null, quote_dropped: text.dropped,
      text_rule: s.why?.text_rule ?? null, title_rule: s.why?.title_rule ?? null,
      severity_5_7: strengthOf(s)['5-7'], severity_8_10: strengthOf(s)['8-10'],
      why, why_line: s.why_tags?.line ?? why.map((t) => t.label).join(' · '),
      reasons: (s.flag_reasons ?? []).map((r) => ({ id: r.id, label: r.label, by: r.by === 'sonnet' ? 'sonnet' : 'jev', p: r.p })),
      labels: presence,
      other_events: otherEvents,
    };
  });
}

/** The slug this film may have, decided inside the writing transaction (pipeline/ingest.js's rule). */
async function claimSlug(tx, film) {
  const { rows } = await tx.query('select id, slug, imdb_id from films');
  const imdbId = film.imdb_id ? String(film.imdb_id).toLowerCase() : null;
  if (imdbId && rows.some((r) => r.imdb_id && r.imdb_id.toLowerCase() === imdbId)) throw fail('exists', `${film.title} is already in the database — it was added while this run was going.`);
  const base = slugify(film.title, imdbId ?? film.slug ?? 'film');
  const taken = new Set(rows.flatMap((r) => [r.id, r.slug]));
  if (!taken.has(base)) return base;
  let slug = film.year ? `${base}-${film.year}` : base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

/** The reason chips' vocabulary rows (insert-only; a label already there is kept as it is). */
export async function ensureReasonVocabulary(tx, labels) {
  const byId = new Map();
  for (const l of labels) if (l && !byId.has(reasonVocabId(l))) byId.set(reasonVocabId(l), l);
  for (const [id, label] of byId) {
    await tx.query(
      `insert into vocabulary (id, layer, group_id, label, short_label, text_blind, taxonomy_version, aliases)
       values ($1, 'event', null, $2, $2, false, $3, '{}') on conflict (id) do nothing`,
      [id, label, REASONS_VOCAB_VERSION],
    );
  }
  return byId.size;
}

/**
 * Sonnet's own summary of a scene, as Jev checked it when the film was read (the claims stage): the
 * sentences a flagged scene's text would also be allowed to show (verified, or the A0>C loose bar:
 * supports >= 0.4 and contradicts < 0.3).
 */
function checkedSummary(seg) {
  const ok = (c) => c?.status === 'verified' || ((c?.probabilities?.supports ?? 0) >= 0.4 && (c?.probabilities?.contradicts ?? 1) < 0.3);
  const kept = (seg?.sentences ?? []).filter((x) => x?.text && ok(x.check)).map((x) => x.text.trim());
  return kept.length ? kept.join(' ') : null;
}

/**
 * A title for a scene that has none, cut from its checked summary: the first sentence if it is short,
 * else the longest leading clause that fits in 60 characters (cut before ", ", " and ", " while " ...). Jev checked the sentence; a leading
 * clause of it says less, never more. Null when no clause reads as a title (the page then names the
 * scene by its start time).
 */
export function titleFromSummary(text) {
  const first = String(text ?? '').split(/(?<=[.!?])\s+/)[0]?.trim().replace(/[.!?]+$/, '');
  if (!first) return null;
  if (first.length <= 60) return first;
  let best = null;
  for (const sep of [', ', ' and ', ' while ', ' as ', ' until ', ' before ', ' after ', ' but ', ' when ', ' so ', ' then ']) {
    for (let i = first.indexOf(sep); i !== -1 && i <= 60; i = first.indexOf(sep, i + 1)) {
      if (i >= 20 && (best === null || i > best)) best = i;
    }
  }
  if (best !== null) return first.slice(0, best).replace(/[,;:]+$/, '');
  // No clause break fits: cut at a word, and say so.
  const cut = first.slice(0, 58);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]+$/, '')}…`;
}

export function buildGuide({ slug, film, srt, cues, tags, costs, segments = null }) {
  const trackId = `${slug}:opensubtitles`;
  const track = {
    id: trackId, film_id: slug, source: 'opensubtitles', release_label: srt.release ?? null, language: 'en',
    has_sound_captions: cues.filter((c) => SOUND_CAPTION.test(c.text)).length >= 20,
    cue_count: cues.length, duration_ms: cues[cues.length - 1].endMs, sha256: srt.sha256,
  };
  const anchors = pickAnchors(cues).map((a) => ({ id: `${trackId}:${a.position}`, track_id: trackId, ...a }));
  const runs = [
    { id: `${slug}:finder`, film_id: slug, track_id: trackId, role: 'finder', model: SONNET_MODEL, taxonomy_version: null, script: `pipeline-jevfirst ${PIPELINE_VERSION} (segment, sonnetq, describe, describe2, titles)`, started_at: null, cost_usd: +costs.sonnet.toFixed(6), source_file: null },
    { id: `${slug}:labeller`, film_id: slug, track_id: trackId, role: 'labeller', model: JEV_MODEL, taxonomy_version: 'v3', script: `pipeline-jevfirst ${PIPELINE_VERSION} (split check, claims, classify, childcry, resolve, mortal, moments, text checks)`, started_at: null, cost_usd: +costs.jev.toFixed(6), source_file: null },
  ];
  const cueId = (i) => cues[i - 1]?.id ?? null;
  const scenes = [];
  const labels = [];
  const reasonLabels = [];
  const grams = quoteGrams(cues);
  const segById = new Map((segments ?? []).map((g) => [g.id, g]));
  // Every scene has a title. When no title passed Jev's check, in order: the lead of the scene's checked
  // description, of its checked summary, of any summary sentence Jev did not contradict, and last its
  // main reason ("Crying").
  const uncontradicted = (seg) => (seg?.sentences ?? []).filter((x) => x?.text && (x.check?.probabilities?.contradicts ?? 0) < 0.3).map((x) => x.text.trim()).join(' ') || null;
  const flaggedRows = guideRows(tags, { grams }).map((g) => {
    if (g.title && g.title !== 'Flagged scene') return g;
    const seg = segById.get(g.scene_id);
    for (const [text, rule] of [[g.description, 'description'], [checkedSummary(seg), 'summary'], [uncontradicted(seg), 'summary_unchecked']]) {
      const t = text ? quoteGate(titleFromSummary(text), null, grams).title : null;
      if (t) return { ...g, title: t, title_rule: rule };
    }
    const reason = g.why?.[0]?.label ?? g.reasons?.[0]?.label;
    return reason ? { ...g, title: reason, title_rule: 'reason' } : g;
  });
  const rows = flaggedRows;
  for (const g of rows) {
    const id = `${slug}:${g.scene_id}`;
    scenes.push({
      id, film_id: slug, track_id: trackId, run_id: `${slug}:labeller`, start_ms: g.start_ms, end_ms: g.end_ms,
      start_cue: cueId(g.start_cue), end_cue: cueId(g.end_cue), title: g.title, severity_5_7: g.severity_5_7, severity_8_10: g.severity_8_10,
      confirmed_by_second_run: null, text_visibility: null, review_status: 'unreviewed', description: g.description,
      // What the film page shows as "Why it's on the list" (schema-jevfirst: scenes.why_tags).
      why_tags: JSON.stringify({ line: g.why_line, tags: g.why.map((t) => ({ label: t.label, ...(t.category ? { category: t.category } : {}), by: t.by, p: t.p })) }),
    });
    const seen = new Set();
    const add = (row) => { if (seen.has(row.id)) return; seen.add(row.id); labels.push(row); };
    for (const l of g.labels) {
      add({ id: `${id}:${l.channel}:${l.vocabulary_id}:${l.by}`, scene_id: id, vocabulary_id: l.vocabulary_id, channel: l.channel, source: MODEL_OF[l.by], probability: l.p ?? null, asserted: true, confidence_kind: null, detail: null, review_status: 'unreviewed' });
    }
    for (const t of g.why) {
      // The filter and the chip are the stable category; the film-specific label is the detail.
      const chip = t.category ?? t.label;
      const vid = reasonVocabId(chip);
      reasonLabels.push(chip);
      for (const by of t.by.length ? t.by : ['jev']) {
        add({ id: `${id}:event:${vid}:${by}`, scene_id: id, vocabulary_id: vid, channel: 'event', source: MODEL_OF[by], probability: t.p ?? null, asserted: true, confidence_kind: null, detail: `flag reason: ${t.ids.join(', ')}`.slice(0, 500), review_status: 'unreviewed' });
      }
    }
    for (const l of g.other_events) {
      add({ id: `${id}:${l.channel}:${l.vocabulary_id}:${l.by}`, scene_id: id, vocabulary_id: l.vocabulary_id, channel: l.channel, source: MODEL_OF[l.by], probability: l.p ?? null, asserted: false, confidence_kind: null, detail: ACT_EVENT_DETAIL, review_status: 'unreviewed' });
    }
  }
  const filmRow = { id: slug, slug, title: film.title, year: film.year ?? null, imdb_id: film.imdb_id ?? null, poster_url: film.poster_url ?? null, overview: film.overview ?? null };
  return { film: filmRow, track, anchors, runs, scenes, labels, reasonLabels };
}

/** The run's documents, by artifact kind (store.js ARTIFACT_KINDS). */
export function runDocs(S, tags) {
  return {
    sources: S.out('sources'),
    segments_raw: S.out('segment_build').raw,
    segments_precheck: S.out('segment_build').segments,
    segments: S.out('refold').segments,
    claims: S.out('claims').claims,
    fill: S.out('fill').fill,
    jev: S.out('classify'),
    sonnetq: S.out('sonnetq'),
    childcry: S.out('childcry'),
    resolve: S.out('resolve'),
    mortal: S.out('mortal'),
    moments: S.out('moments'),
    describe: S.out('describe'),
    why: S.out('check_describe'),
    describe2: S.out('describe2'),
    why2: S.out('check_describe2'),
    describe3: S.out('titles'),
    why3: S.out('check_describe3'),
    whyfinal: S.out('mergetext'),
    tags,
  };
}

export async function ingestStage(S) {
  const film = S.job.film;
  const tags = S.out('select3');
  const rebuildOf = film.rebuild_of ?? null;
  if (!tags.scenes.some((s) => s.flagged)) {
    // Not a failure of the pipeline, and not a film with nothing in it: the guide would be an empty
    // list that reads as "nothing to worry about". Say so instead of writing it (a rebuild keeps the
    // guide it had).
    throw fail('no_flagged_scenes', 'The analysis finished and flagged no scene in this film, so there is no scene guide to write. That is not the same as saying nothing in it is upsetting.');
  }
  // Idempotent across a crash between the commit below and the stage's checkpoint: if this job's
  // transaction already committed (its artifacts carry the job id), the film is in -- report it.
  const { rows: already } = await S.db.query('select slug, scene_count from jevfirst_films where job_id = $1', [S.job.id]);
  if (already[0]) {
    const { rows: n } = await S.db.query('select count(*)::int as n from scenes where film_id = $1', [already[0].slug]);
    const { rows: bk } = rebuildOf ? await S.db.query('select id from guide_backups where job_id = $1 order by id desc limit 1', [S.job.id]) : { rows: [] };
    S.detail(`${n[0].n} scenes written (found already committed)`);
    return { slug: already[0].slug, scenes: n[0].n, resumed: true, ...(rebuildOf ? { rebuilt: true, backup_id: bk[0] ? Number(bk[0].id) : null } : {}), digest: crypto.createHash('sha256').update(JSON.stringify(guideRows(tags))).digest('hex').slice(0, 12) };
  }
  const ledger = S.ledger();
  const costs = { sonnet: ledger.filter((e) => e.model === 'sonnet').reduce((a, e) => a + e.usd, 0), jev: ledger.filter((e) => e.model === 'jev').reduce((a, e) => a + e.usd, 0) };
  const docs = runDocs(S, tags);
  let out;
  try {
    out = await S.db.withTransaction(async (tx) => {
      let slug;
      let backupId = null;
      if (rebuildOf) {
        const { rows } = await tx.query('select id, slug from films where id = $1 for update', [rebuildOf]);
        if (!rows[0]) throw fail('no_such_film', 'The film this rebuild was for is no longer in the library, so nothing was written.');
        slug = rows[0].id;
      } else {
        slug = await claimSlug(tx, film);
      }
      const built = buildGuide({ slug, film, srt: S.srt, cues: S.cues, tags, costs, segments: S.out('refold')?.segments?.scenes ?? null });
      await ensureVocabulary(tx, taxonomy);
      await ensureReasonVocabulary(tx, built.reasonLabels);
      if (rebuildOf) {
        backupId = await backupGuide(tx, slug, { reason: 'rebuild', jobId: S.job.id, pipelineVersion: PIPELINE_VERSION });
        await replaceGuide(tx, slug, built);
      } else {
        await writeFilmRows(tx, built, { replace: false });
      }
      await writeArtifacts(tx, { ...film, slug, title: film.title }, docs, { origin: rebuildOf ? 'rebuild' : 'add', pipelineVersion: PIPELINE_VERSION, jobId: S.job.id, ledger });
      return { slug, scenes: built.scenes.length, labels: built.labels.length, ...(rebuildOf ? { rebuilt: true, backup_id: backupId } : {}) };
    });
  } catch (err) {
    if (err?.code === '23505') throw fail('exists', `${film.title} is already in the database — it was added while this run was going.`);
    throw err;
  }
  invalidateVocabularyCache(S.db);
  S.detail(rebuildOf ? `${out.scenes} scenes written; the previous guide is kept as backup ${out.backup_id}` : `${out.scenes} scenes written`);
  return { ...out, digest: crypto.createHash('sha256').update(JSON.stringify(guideRows(tags))).digest('hex').slice(0, 12) };
}
