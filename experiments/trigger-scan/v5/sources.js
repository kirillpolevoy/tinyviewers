#!/usr/bin/env node
// v5 step 0: fetch the only sources the segmenter may use, and record where they came from.
//
//   node sources.js <slug>
//
//   TMDB    IMDb id -> TMDB id (/find) -> /movie/{id}/credits. Keeps character, actor and billing order
//           for at most 40 cast members, numbered T1..Tn in billing order.
//   Wiki    English Wikipedia article for the film, resolved by candidate titles
//           ("<title> (<year> film)", "<title> (film)", "<title>", then a search) and ACCEPTED only
//           when its Wikidata item's IMDb id (P345) equals the film's IMDb id. The "Plot" section
//           (or "Plot summary"/"Synopsis"/"Story") of that revision, as plain text, split into
//           numbered sentences W1..Wn. Title, revision id, URL and permalink are recorded.
//
// Fails loudly (exit 1, nothing written) if the article cannot be verified or has no plot section.
// It never substitutes anything else. Writes sources/<slug>.json (git-ignored: it holds Wikipedia text).
// Free APIs, no model calls. The held-out film is refused.
import fs from 'node:fs';
import path from 'node:path';
import { V5, key, filmMeta } from './env.js';
import { plotSection, splitSentences, numberSentences } from './text.js';

export const HELD_OUT = new Set(['lion-king']);
const UA = 'TinyViewersResearch/0.5 (scene-safety research experiment; non-commercial)';
const TMDB = 'https://api.themoviedb.org/3';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
export const CAST_CAP = 40;

/**
 * TMDB credit rows -> { character, actor, order, voice }. Rows that name no character ("Additional
 * Voices", empty) say nothing about the story and are dropped (counted), before the cap is applied.
 * " (voice)" is split off the character name into `voice`.
 */
export function tmdbCastRows(rows) {
  const kept = [];
  let dropped = 0;
  for (const c of rows) {
    const raw = String(c.character ?? '').trim();
    const voice = /\(voice\)\s*$/i.test(raw);
    const character = raw.replace(/\s*\(voice\)\s*$/i, '').trim();
    if (!character || /^additional voices?$/i.test(character) || /^(himself|herself)$/i.test(character)) { dropped++; continue; }
    kept.push({ character, actor: c.name, order: c.order ?? null, voice });
  }
  return { kept, dropped };
}

async function getJson(url, { redact } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (res.ok) return res.json();
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); continue; }
    throw new Error(`GET ${redact ? redact(url) : url} -> ${res.status}`);
  }
}

// ---- TMDB -----------------------------------------------------------------------------------------
export async function fetchTmdb(film) {
  const apiKey = key('TMDB_API_KEY');
  const redact = (u) => u.replace(apiKey, '***');
  const q = (p) => `${TMDB}${p}${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}`;
  const found = await getJson(q(`/find/${film.imdb_id}?external_source=imdb_id`), { redact });
  const hit = found.movie_results?.[0];
  if (!hit?.id) throw new Error(`TMDB has no movie for ${film.imdb_id}`);
  const credits = await getJson(q(`/movie/${hit.id}/credits`), { redact });
  const all = (credits.cast ?? []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const { kept, dropped } = tmdbCastRows(all);
  const cast = kept.slice(0, CAST_CAP).map((c, i) => ({ id: `T${i + 1}`, ...c }));
  return {
    id: hit.id,
    title: hit.title,
    release_date: hit.release_date ?? null,
    fetched_at: new Date().toISOString(),
    cast_total: all.length,
    dropped_uncredited_roles: dropped,
    cast,
  };
}

// ---- Wikipedia --------------------------------------------------------------------------------------
const qs = (params) => new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();

async function wikiPage(title) {
  const j = await getJson(`${WIKI}?${qs({
    action: 'query', titles: title, redirects: '1',
    prop: 'pageprops|revisions|extracts|info', ppprop: 'wikibase_item', rvprop: 'ids|timestamp', inprop: 'url',
    explaintext: '1', exsectionformat: 'wiki',
  })}`);
  const page = j.query?.pages?.[0];
  if (!page || page.missing || page.invalid) return null;
  return page;
}

async function wikidataImdb(qid) {
  const j = await getJson(`${WIKIDATA}?${qs({ action: 'wbgetentities', ids: qid, props: 'claims' })}`);
  const claims = j.entities?.[qid]?.claims ?? {};
  return (claims.P345 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
}

export async function fetchWikipedia(film) {
  const tried = [];
  const candidates = [
    film.year ? `${film.title} (${film.year} film)` : null,
    `${film.title} (film)`,
    film.title,
  ].filter(Boolean);
  const search = await getJson(`${WIKI}?${qs({ action: 'query', list: 'search', srsearch: `${film.title} ${film.year ?? ''} film`, srlimit: '5' })}`);
  for (const r of search.query?.search ?? []) if (!candidates.includes(r.title)) candidates.push(r.title);

  for (const title of candidates) {
    const page = await wikiPage(title);
    if (!page) { tried.push({ title, result: 'missing' }); continue; }
    const qid = page.pageprops?.wikibase_item;
    if (!qid) { tried.push({ title: page.title, result: 'no wikidata item' }); continue; }
    const imdb = await wikidataImdb(qid);
    if (!imdb.includes(film.imdb_id)) { tried.push({ title: page.title, result: `wikidata ${qid} IMDb ${imdb.join(',') || 'none'} != ${film.imdb_id}` }); continue; }
    const plot = plotSection(page.extract ?? '');
    if (!plot) throw new Error(`${page.title} (${qid}) matches ${film.imdb_id} but has no Plot section. Refusing to substitute anything.`);
    const rev = page.revisions?.[0];
    const sentences = numberSentences(splitSentences(plot.text));
    return {
      title: page.title,
      pageid: page.pageid,
      wikidata: qid,
      verified_by: `wikidata ${qid} P345 = ${film.imdb_id}`,
      revision_id: rev?.revid ?? null,
      revision_timestamp: rev?.timestamp ?? null,
      url: page.fullurl,
      permalink: rev?.revid ? `https://en.wikipedia.org/w/index.php?oldid=${rev.revid}` : null,
      section: plot.heading,
      fetched_at: new Date().toISOString(),
      license: 'CC BY-SA 4.0 (Wikipedia text; kept in git-ignored sources/)',
      candidates_tried: tried,
      sentence_count: sentences.length,
      word_count: plot.text.split(/\s+/).length,
      sentences,
    };
  }
  throw new Error(`no Wikipedia article verified for ${film.title} (${film.imdb_id}); tried: ${JSON.stringify(tried)}`);
}

// ---- main -------------------------------------------------------------------------------------------
async function main() {
  const slug = process.argv[2];
  if (!slug) { console.error('usage: node sources.js <slug>'); process.exit(2); }
  // --final-held-out-run: the one-time final run on the held-out film, after all code is frozen.
  if (HELD_OUT.has(slug) && !process.argv.includes('--final-held-out-run')) { console.error(`${slug} is held out; not fetching its sources (pass --final-held-out-run only for the frozen final run).`); process.exit(2); }
  const film = filmMeta(slug);
  const [tmdb, wikipedia] = await Promise.all([fetchTmdb(film), fetchWikipedia(film)]);
  const out = { film: { ...film, tmdb_id: tmdb.id }, tmdb, wikipedia };
  fs.mkdirSync(path.join(V5, 'sources'), { recursive: true });
  const file = path.join(V5, 'sources', `${slug}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${slug}: TMDB ${tmdb.id} "${tmdb.title}" cast ${tmdb.cast.length}/${tmdb.cast_total}; Wikipedia "${wikipedia.title}" rev ${wikipedia.revision_id} (${wikipedia.verified_by}), section "${wikipedia.section}", ${wikipedia.sentence_count} sentences, ${wikipedia.word_count} words -> ${path.relative(V5, file)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
}
