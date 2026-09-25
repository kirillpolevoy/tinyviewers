// PORT of experiments/trigger-scan/v10_1/sources.js: the ONLY sources Sonnet may use, with where they
// came from. TMDB cast by IMDb id; the English Wikipedia article whose Wikidata item carries the same
// IMDb id (P345), its Plot section split into numbered sentences W1..Wn. It never substitutes anything
// else: no verified article, or one with no plot section, and the run stops -- the verified-sources
// rule has nothing to stand on.
//
// Differences from the script: fetch comes from the run context (tests stub it), every request has a
// deadline, and an error names the service and status only (never a URL, which carries the TMDB key).
import { tmdbCastRows, CAST_CAP } from '../pack/sources.js';
import { plotSection, splitSentences, numberSentences } from '../pack/text.js';
import { runCtx } from '../context.js';
import { fail } from './common.js';

const UA = 'TinyViewers/1.0 (scene guides for parents; https://tinyviewers-scenes.vercel.app)';
const TMDB = 'https://api.themoviedb.org/3';
const WIKI = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const TIMEOUT_MS = 15_000;

async function getJson(url, service) {
  const ctx = runCtx();
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await ctx.fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ac.signal });
    } catch {
      clearTimeout(t);
      if (attempt < 3) { await ctx.sleep(1500 * 2 ** attempt); continue; }
      throw fail('sources_unavailable', `${service} did not answer, so the film's plot and cast could not be read.`);
    }
    clearTimeout(t);
    if (res.ok) return res.json();
    await res.text().catch(() => {});
    if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 3) { await ctx.sleep(1500 * 2 ** attempt); continue; }
    throw fail('sources_unavailable', `${service} answered ${res.status}, so the film's plot and cast could not be read.`);
  }
}

export async function fetchTmdb(film) {
  const apiKey = runCtx().keys?.tmdb ?? process.env.TMDB_API_KEY;
  if (!apiKey) throw fail('sources_unavailable', 'TMDB is not configured on this deployment, so the cast list cannot be read.');
  const q = (p) => `${TMDB}${p}${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}`;
  const found = await getJson(q(`/find/${film.imdb_id}?external_source=imdb_id`), 'TMDB');
  const hit = found.movie_results?.[0];
  if (!hit?.id) throw fail('sources_unavailable', 'TMDB has no film with this IMDb id, so there is no cast list to cite.');
  const credits = await getJson(q(`/movie/${hit.id}/credits`), 'TMDB');
  const all = (credits.cast ?? []).slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const { kept, dropped } = tmdbCastRows(all);
  const cast = kept.slice(0, CAST_CAP).map((c, i) => ({ id: `T${i + 1}`, ...c }));
  return { id: hit.id, title: hit.title, release_date: hit.release_date ?? null, fetched_at: new Date().toISOString(), cast_total: all.length, dropped_uncredited_roles: dropped, cast };
}

const qs = (params) => new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();

async function wikiPage(title) {
  const j = await getJson(`${WIKI}?${qs({ action: 'query', titles: title, redirects: '1', prop: 'pageprops|revisions|extracts|info', ppprop: 'wikibase_item', rvprop: 'ids|timestamp', inprop: 'url', explaintext: '1', exsectionformat: 'wiki' })}`, 'Wikipedia');
  const page = j.query?.pages?.[0];
  if (!page || page.missing || page.invalid) return null;
  return page;
}

async function wikidataImdb(qid) {
  const j = await getJson(`${WIKIDATA}?${qs({ action: 'wbgetentities', ids: qid, props: 'claims' })}`, 'Wikidata');
  const claims = j.entities?.[qid]?.claims ?? {};
  return (claims.P345 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
}

export async function fetchWikipedia(film) {
  const tried = [];
  const candidates = [film.year ? `${film.title} (${film.year} film)` : null, `${film.title} (film)`, film.title].filter(Boolean);
  const search = await getJson(`${WIKI}?${qs({ action: 'query', list: 'search', srsearch: `${film.title} ${film.year ?? ''} film`, srlimit: '5' })}`, 'Wikipedia');
  for (const r of search.query?.search ?? []) if (!candidates.includes(r.title)) candidates.push(r.title);
  for (const title of candidates) {
    const page = await wikiPage(title);
    if (!page) { tried.push({ title, result: 'missing' }); continue; }
    const qid = page.pageprops?.wikibase_item;
    if (!qid) { tried.push({ title: page.title, result: 'no wikidata item' }); continue; }
    const imdb = await wikidataImdb(qid);
    if (!imdb.includes(film.imdb_id)) { tried.push({ title: page.title, result: `wikidata ${qid} IMDb ${imdb.join(',') || 'none'} != ${film.imdb_id}` }); continue; }
    const plot = plotSection(page.extract ?? '');
    if (!plot) throw fail('no_verified_plot', `The Wikipedia article for this film has no plot section, and the scene guide uses no other plot source.`);
    const rev = page.revisions?.[0];
    const sentences = numberSentences(splitSentences(plot.text));
    return {
      title: page.title, pageid: page.pageid, wikidata: qid, verified_by: `wikidata ${qid} P345 = ${film.imdb_id}`,
      revision_id: rev?.revid ?? null, revision_timestamp: rev?.timestamp ?? null, url: page.fullurl,
      permalink: rev?.revid ? `https://en.wikipedia.org/w/index.php?oldid=${rev.revid}` : null,
      section: plot.heading, fetched_at: new Date().toISOString(), license: 'CC BY-SA 4.0 (Wikipedia text)',
      candidates_tried: tried, sentence_count: sentences.length, word_count: plot.text.split(/\s+/).length, sentences,
    };
  }
  throw fail('no_verified_plot', 'No English Wikipedia article could be verified as this film (by its IMDb id), and the scene guide uses no other plot source.');
}

export async function sourcesStage(S) {
  const film = { slug: S.film.slug, title: S.film.title, year: S.film.year ?? null, imdb_id: S.film.imdb_id };
  const [tmdb, wikipedia] = await Promise.all([fetchTmdb(film), fetchWikipedia(film)]);
  S.detail(`${wikipedia.sentence_count} plot sentences from Wikipedia, ${tmdb.cast.length} cast entries from TMDB`);
  return { film: { ...film, tmdb_id: tmdb.id }, tmdb, wikipedia };
}
