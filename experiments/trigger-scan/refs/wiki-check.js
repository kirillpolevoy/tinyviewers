// Round 6 film choice: for each candidate, check the English Wikipedia article has a Plot section
// (MediaWiki API, action=parse&prop=sections) and read the IMDb id from Wikidata P345 (never memory).
//
//   node refs/wiki-check.js "Frozen (2013 film)" "The Good Dinosaur" ...
//
// Writes raw/wiki-check.json (git-ignored) and prints one line per article.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UA = 'TinyViewersResearch/0.1 (evaluating a parents\' scene guide against published content advisories; contact kpolevoy@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (url) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Api-User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

const out = [];
for (const page of process.argv.slice(2)) {
  const api = 'https://en.wikipedia.org/w/api.php';
  const info = await getJson(`${api}?action=query&format=json&redirects=1&prop=pageprops&titles=${encodeURIComponent(page)}`);
  const p = Object.values(info.query.pages)[0];
  await sleep(1000);
  const secs = await getJson(`${api}?action=parse&format=json&prop=sections&page=${encodeURIComponent(p.title)}`);
  const plot = secs.parse.sections.find((s) => /^(Plot|Synopsis)$/i.test(s.line));
  let plotWords = null;
  if (plot) {
    await sleep(1000);
    const wt = await getJson(`${api}?action=parse&format=json&prop=wikitext&section=${plot.index}&page=${encodeURIComponent(p.title)}`);
    plotWords = wt.parse.wikitext['*'].split(/\s+/).length;
  }
  const qid = p.pageprops?.wikibase_item;
  await sleep(1000);
  const wd = await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
  const ent = wd.entities[qid];
  const imdb = (ent.claims.P345 ?? []).map((c) => c.mainsnak.datavalue?.value);
  const date = (ent.claims.P577 ?? []).map((c) => c.mainsnak.datavalue?.value?.time).filter(Boolean);
  const directors = (ent.claims.P57 ?? []).map((c) => c.mainsnak.datavalue?.value?.id);
  const row = { query: page, title: p.title, pageid: p.pageid, wikidata: qid, imdb_p345: imdb, publication_dates: date.slice(0, 3), director_qids: directors,
    plot_section: plot ? { line: plot.line, index: plot.index, words: plotWords } : null, checked_at: new Date().toISOString() };
  out.push(row);
  console.log(`${p.title}: ${qid} P345=${imdb.join(',')} plot=${plot ? `${plot.line} (${plotWords} words)` : 'NONE'} dates=${date.slice(0, 2).join(',')}`);
  await sleep(1000);
}
const file = path.join(here, 'raw', 'wiki-check.json');
const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
fs.writeFileSync(file, JSON.stringify([...prev, ...out], null, 2));
