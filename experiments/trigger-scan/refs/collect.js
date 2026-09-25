// Step 1: collect HUMAN-WRITTEN content advisories for each film into raw/<slug>.json (git-ignored).
//
// Evaluation only. Nothing here may reach Sonnet, Jev, the question set or the policy.
//
// Web rules: a descriptive User-Agent on every request; each URL is fetched at most once per run and
// never re-fetched when a cached copy exists (raw/html/); a block (WAF / Cloudflare challenge / 403)
// is recorded as-is and never worked around - no browser UA spoofing, no archive mirrors, no headless
// browser. Sources are tried in the order the task gave (IMDb Parents Guide, DoesTheDogDie,
// Kids-In-Mind); after those, the two human-written parent guides that answered a plain request
// (Plugged In, Common Sense Media).
//
//   node refs/collect.js [slug...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(here, 'raw');
const HTML = path.join(RAW, 'html');
fs.mkdirSync(HTML, { recursive: true });

const UA = 'TinyViewersResearch/0.1 (evaluating a parents\' scene guide against published content advisories; contact kpolevoy@gmail.com)';

// Title, year and IMDb id from ../films.json (the loader input); Nemo's year/id are missing there.
export const FILMS = {
  nemo: { title: 'Finding Nemo', year: 2003, imdb: 'tt0266543', check: /Stanton/,
    kim: ['https://kids-in-mind.com/f/findingnemo.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/findingnemo/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/finding-nemo'] },
  'monsters-inc': { title: 'Monsters, Inc.', year: 2001, imdb: 'tt0198781', check: /Docter/,
    kim: ['https://kids-in-mind.com/m/monstersinc.htm', 'https://kids-in-mind.com/m/monsters-inc-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/monstersinc/', 'https://www.pluggedin.com/movie-reviews/monsters-inc/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/monsters-inc'] },
  'lion-king': { title: 'The Lion King', year: 1994, imdb: 'tt0110357', check: /Minkoff|Allers/,
    kim: ['https://kids-in-mind.com/l/lionking.htm', 'https://kids-in-mind.com/l/lion-king-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/l/lionking1994.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/lionking/', 'https://www.pluggedin.com/movie-reviews/the-lion-king/', 'https://www.pluggedin.com/movie-reviews/lion-king/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-lion-king-1994', 'https://www.commonsensemedia.org/movie-reviews/the-lion-king-0', 'https://www.commonsensemedia.org/movie-reviews/the-lion-king'] },
  frankenweenie: { title: 'Frankenweenie', year: 2012, imdb: 'tt1142977', check: /Burton/,
    kim: ['https://kids-in-mind.com/f/frankenweenie.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/frankenweenie/', 'https://www.pluggedin.com/movie-reviews/frankenweenie-2012/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/frankenweenie'] },
  'wild-robot': { title: 'The Wild Robot', year: 2024, imdb: 'tt29623480', check: /Sanders/,
    kim: ['https://kids-in-mind.com/w/wildrobot.htm', 'https://kids-in-mind.com/w/wild-robot-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-wild-robot-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/the-wild-robot/', 'https://www.pluggedin.com/movie-reviews/wild-robot/', 'https://www.pluggedin.com/movie-reviews/the-wild-robot-2024/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-wild-robot'] },
  // Round 3 held-out films. iron-giant is a library film; up is new to the library (refs/up.film.json).
  // Plugged In's Iron Giant page never prints 1999; it passes on director + exact page title instead.
  'iron-giant': { title: 'The Iron Giant', year: 1999, imdb: 'tt0129167', check: /Brad Bird/, piTitle: /^The Iron Giant - Plugged In$/,
    kim: ['https://kids-in-mind.com/i/irongiant.htm', 'https://kids-in-mind.com/i/iron-giant-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-iron-giant-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/irongiant/', 'https://www.pluggedin.com/movie-reviews/the-iron-giant/', 'https://www.pluggedin.com/movie-reviews/irongiantthe/', 'https://www.pluggedin.com/movie-reviews/iron-giant/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-iron-giant', 'https://www.commonsensemedia.org/movie-reviews/iron-giant'] },
  up: { title: 'Up', year: 2009, imdb: 'tt1049413', check: /Docter/,
    kim: ['https://kids-in-mind.com/u/up.htm', 'https://kids-in-mind.com/u/up-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/up/', 'https://www.pluggedin.com/movie-reviews/up-2009/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/up'] },
  // Round 4 held-out films (refs/<slug>.film.json says why each was chosen). The 2010 dragon film has a
  // 2025 live-action remake with the same title; Chris Sanders co-directed only the 2010 film.
  tangled: { title: 'Tangled', year: 2010, imdb: 'tt0398286', check: /Greno|Byron Howard/,
    kim: ['https://kids-in-mind.com/t/tangled.htm', 'https://kids-in-mind.com/t/tangled-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/tangled/', 'https://www.pluggedin.com/movie-reviews/tangled-2010/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/tangled'] },
  coco: { title: 'Coco', year: 2017, imdb: 'tt2380307', check: /Unkrich/,
    kim: ['https://kids-in-mind.com/c/coco.htm', 'https://kids-in-mind.com/c/coco-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/coco/', 'https://www.pluggedin.com/movie-reviews/coco-2017/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/coco'] },
  'how-to-train-your-dragon': { title: 'How to Train Your Dragon', year: 2010, imdb: 'tt0892769', check: /Sanders/,
    kim: ['https://kids-in-mind.com/h/howtotrainyourdragon.htm', 'https://kids-in-mind.com/h/how-to-train-your-dragon-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/howtotrainyourdragon/', 'https://www.pluggedin.com/movie-reviews/how-to-train-your-dragon/', 'https://www.pluggedin.com/movie-reviews/how-to-train-your-dragon-2010/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/how-to-train-your-dragon', 'https://www.commonsensemedia.org/movie-reviews/how-to-train-your-dragon-2010'] },
  // Round 5 held-out films (refs/<slug>.film.json says why each was chosen). The Little Mermaid (1989)
  // has a 2023 live-action remake and Moana (2016) a 2026 one, both with the same title; the year and
  // director checks below (Musker/Clements directed both animated films, not the remakes) keep them apart.
  'book-of-life': { title: 'The Book of Life', year: 2014, imdb: 'tt2262227', check: /Guti[eé]rrez/,
    kim: ['https://kids-in-mind.com/b/bookoflife.htm', 'https://kids-in-mind.com/b/book-of-life-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-book-of-life-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/book-of-life/', 'https://www.pluggedin.com/movie-reviews/the-book-of-life/', 'https://www.pluggedin.com/movie-reviews/bookoflife/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-book-of-life', 'https://www.commonsensemedia.org/movie-reviews/book-of-life'] },
  // little-mermaid was tried first as the villain film and dropped: Kids-In-Mind and Plugged In only
  // review the 2023 remake, so Common Sense Media was its one text source (raw/little-mermaid.json).
  'little-mermaid': { title: 'The Little Mermaid', year: 1989, imdb: 'tt0097757', check: /Musker|Clements/,
    kim: ['https://kids-in-mind.com/l/littlemermaid.htm', 'https://kids-in-mind.com/l/little-mermaid-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-little-mermaid-1989-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/littlemermaid/', 'https://www.pluggedin.com/movie-reviews/the-little-mermaid-1989/', 'https://www.pluggedin.com/movie-reviews/little-mermaid/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-little-mermaid', 'https://www.commonsensemedia.org/movie-reviews/the-little-mermaid-1989'] },
  'princess-and-the-frog': { title: 'The Princess and the Frog', year: 2009, imdb: 'tt0780521', check: /Musker|Clements/,
    kim: ['https://kids-in-mind.com/p/princessandthefrog.htm', 'https://kids-in-mind.com/p/princess-and-the-frog-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-princess-and-the-frog-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/princessandthefrog/', 'https://www.pluggedin.com/movie-reviews/the-princess-and-the-frog/', 'https://www.pluggedin.com/movie-reviews/princess-and-the-frog/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-princess-and-the-frog', 'https://www.commonsensemedia.org/movie-reviews/princess-and-the-frog'] },
  moana: { title: 'Moana', year: 2016, imdb: 'tt3521164', check: /Musker|Clements/,
    kim: ['https://kids-in-mind.com/m/moana.htm', 'https://kids-in-mind.com/m/moana-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/moana/', 'https://www.pluggedin.com/movie-reviews/moana-2016/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/moana', 'https://www.commonsensemedia.org/movie-reviews/moana-2016'] },
  // Round 6 held-out candidates (refs/<slug>.film.json says why the chosen ones were chosen). Titles, years
  // and IMDb ids come from refs/raw/wiki-check.json (Wikipedia + Wikidata P345). Frozen (2013) shares its
  // title with a 2010 live-action thriller; the year and director (Buck/Lee) checks keep them apart.
  frozen: { title: 'Frozen', year: 2013, imdb: 'tt2294629', check: /Chris Buck|Jennifer Lee/,
    kim: ['https://kids-in-mind.com/f/frozen2013.htm', 'https://kids-in-mind.com/f/frozen.htm', 'https://kids-in-mind.com/f/frozen-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/frozen-2013/', 'https://www.pluggedin.com/movie-reviews/frozen/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/frozen', 'https://www.commonsensemedia.org/movie-reviews/frozen-2013', 'https://www.commonsensemedia.org/movie-reviews/frozen-0'] },
  'good-dinosaur': { title: 'The Good Dinosaur', year: 2015, imdb: 'tt1979388', check: /Sohn/,
    kim: ['https://kids-in-mind.com/g/gooddinosaur.htm', 'https://kids-in-mind.com/t/thegooddinosaur.htm', 'https://kids-in-mind.com/g/good-dinosaur-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-good-dinosaur-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/the-good-dinosaur/', 'https://www.pluggedin.com/movie-reviews/gooddinosaur/', 'https://www.pluggedin.com/movie-reviews/good-dinosaur/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-good-dinosaur', 'https://www.commonsensemedia.org/movie-reviews/good-dinosaur'] },
  zootopia: { title: 'Zootopia', year: 2016, imdb: 'tt2948356', check: /Byron Howard|Rich Moore/,
    kim: ['https://kids-in-mind.com/z/zootopia.htm', 'https://kids-in-mind.com/z/zootopia-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/zootopia/', 'https://www.pluggedin.com/movie-reviews/zootopia-2016/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/zootopia'] },
  'kung-fu-panda': { title: 'Kung Fu Panda', year: 2008, imdb: 'tt0441773', check: /Osborne|Stevenson/,
    kim: ['https://kids-in-mind.com/k/kungfupanda.htm', 'https://kids-in-mind.com/k/kung-fu-panda-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/kungfupanda/', 'https://www.pluggedin.com/movie-reviews/kung-fu-panda/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/kung-fu-panda'] },
  // Round 8 held-out candidates (refs/<slug>.film.json says why the chosen ones were chosen). Titles, years
  // and IMDb ids from refs/raw/wiki-check.json (Wikipedia + Wikidata P345). Same-title films: Incredibles 2
  // (2018), Hercules (2014 live action), Brave (1997); the year and director checks keep them apart.
  incredibles: { title: 'The Incredibles', year: 2004, imdb: 'tt0317705', check: /Brad Bird/, piTitle: /^The Incredibles - Plugged In$/, // PI page never prints 2004; names Syndrome/Metroville
   
    kim: ['https://kids-in-mind.com/i/incredibles.htm', 'https://kids-in-mind.com/t/theincredibles.htm', 'https://kids-in-mind.com/i/incredibles-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-incredibles-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/incredibles/', 'https://www.pluggedin.com/movie-reviews/the-incredibles/', 'https://www.pluggedin.com/movie-reviews/incrediblesthe/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-incredibles', 'https://www.commonsensemedia.org/movie-reviews/incredibles'] },
  hercules: { title: 'Hercules', year: 1997, imdb: 'tt0119282', check: /Musker|Clements/,
    kim: ['https://kids-in-mind.com/h/hercules.htm', 'https://kids-in-mind.com/h/hercules1997.htm', 'https://kids-in-mind.com/h/hercules-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/hercules/', 'https://www.pluggedin.com/movie-reviews/hercules-1997/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/hercules', 'https://www.commonsensemedia.org/movie-reviews/hercules-1997'] },
  'big-hero-6': { title: 'Big Hero 6', year: 2014, imdb: 'tt2245084', check: /Don Hall|Chris Williams/,
    kim: ['https://kids-in-mind.com/b/bighero6.htm', 'https://kids-in-mind.com/b/big-hero-6-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/big-hero-6/', 'https://www.pluggedin.com/movie-reviews/bighero6/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/big-hero-6'] },
  brave: { title: 'Brave', year: 2012, imdb: 'tt1217209', check: /Mark Andrews|Brenda Chapman/,
    kim: ['https://kids-in-mind.com/b/brave.htm', 'https://kids-in-mind.com/b/brave-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/brave/', 'https://www.pluggedin.com/movie-reviews/brave-2012/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/brave'] },
  'ice-age': { title: 'Ice Age', year: 2002, imdb: 'tt0268380', check: /Wedge/,
    kim: ['https://kids-in-mind.com/i/iceage.htm', 'https://kids-in-mind.com/i/ice-age-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/iceage/', 'https://www.pluggedin.com/movie-reviews/ice-age/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/ice-age'] },
  // Round 9 fresh candidates (v10.3 test; refs/<slug>.film.json says why the chosen ones were chosen).
  // Titles, years and IMDb ids from refs/raw/wiki-check.json (Wikipedia + Wikidata P345). Kung Fu Panda
  // (above) was collected and split in round 6 but never chosen, so no pipeline has seen it. Same-title
  // films: The Croods: A New Age (2020) and Lilo & Stitch (2025 live action); year/director checks keep them apart.
  onward: { title: 'Onward', year: 2020, imdb: 'tt7146812', check: /Scanlon/,
    kim: ['https://kids-in-mind.com/o/onward.htm', 'https://kids-in-mind.com/o/onward-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/onward/', 'https://www.pluggedin.com/movie-reviews/onward-2020/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/onward'] },
  croods: { title: 'The Croods', year: 2013, imdb: 'tt0481499', check: /DeMicco|Chris Sanders/,
    kim: ['https://kids-in-mind.com/c/croods.htm', 'https://kids-in-mind.com/t/thecroods.htm', 'https://kids-in-mind.com/c/croods-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/t/the-croods-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/croods/', 'https://www.pluggedin.com/movie-reviews/the-croods/', 'https://www.pluggedin.com/movie-reviews/crudes/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/the-croods', 'https://www.commonsensemedia.org/movie-reviews/croods'] },
  'lilo-and-stitch': { title: 'Lilo & Stitch', year: 2002, imdb: 'tt0275847', check: /Sanders|DeBlois/,
    kim: ['https://kids-in-mind.com/l/liloandstitch.htm', 'https://kids-in-mind.com/l/lilo-and-stitch-parents-guide-movie-review-rating.htm', 'https://kids-in-mind.com/l/lilo-stitch-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/liloandstitch/', 'https://www.pluggedin.com/movie-reviews/lilo-and-stitch/', 'https://www.pluggedin.com/movie-reviews/lilo-stitch/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/lilo-stitch', 'https://www.commonsensemedia.org/movie-reviews/lilo-and-stitch'] },
  'toy-story-3': { title: 'Toy Story 3', year: 2010, imdb: 'tt0435761', check: /Unkrich/,
    kim: ['https://kids-in-mind.com/t/toystory3.htm', 'https://kids-in-mind.com/t/toy-story-3-parents-guide-movie-review-rating.htm'],
    pi: ['https://www.pluggedin.com/movie-reviews/toystory3/', 'https://www.pluggedin.com/movie-reviews/toy-story-3/'],
    csm: ['https://www.commonsensemedia.org/movie-reviews/toy-story-3'] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastKim = 0;
async function kimPace() { const wait = lastKim + 30_000 - Date.now(); if (wait > 0) await sleep(wait); lastKim = Date.now(); }

async function get(url, cacheName, extraHeaders = {}) {
  const cachePath = path.join(HTML, cacheName);
  const metaPath = `${cachePath}.meta.json`;
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return { ...meta, body: fs.existsSync(cachePath) ? fs.readFileSync(cachePath, 'utf8') : '', cached: true };
  }
  const fetched_at = new Date().toISOString();
  let status = 0; let headers = {}; let body = ''; let error = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US', ...extraHeaders }, redirect: 'follow' });
    status = res.status;
    headers = Object.fromEntries(['server', 'x-amzn-waf-action', 'cf-mitigated', 'content-type'].map((h) => [h, res.headers.get(h)]).filter(([, v]) => v));
    body = await res.text();
  } catch (e) { error = String(e?.message ?? e); }
  const title = (body.match(/<title>([^<]*)/) ?? [])[1] ?? null;
  let blocked = null;
  if (headers['x-amzn-waf-action']) blocked = `AWS WAF ${headers['x-amzn-waf-action']} (HTTP ${status}, empty body)`;
  else if (headers['cf-mitigated'] || /Just a moment|Attention Required/.test(title ?? '')) blocked = `Cloudflare ${headers['cf-mitigated'] ?? 'block'} page "${title}" (HTTP ${status})`;
  const meta = { url, fetched_at, status, headers, title, blocked, error };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  if (body && !blocked) fs.writeFileSync(cachePath, body);
  await sleep(1500);
  return { ...meta, body: blocked ? '' : body, cached: false };
}

const decode = (s) => s
  .replace(/&#0?39;|&#8217;|&rsquo;|&#8216;|&lsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/&#8212;|&mdash;/g, '--').replace(/&#8211;|&ndash;/g, '-')
  .replace(/&#8230;|&hellip;/g, '...')
  .replace(/&#038;|&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' ').replace(/&#124;/g, '|')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const toText = (html) => decode(html
  .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|h\d|li|div|section)>/g, '\n').replace(/<[^>]+>/g, ''))
  .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');

// Plugged In: one <h2>/<h3> per section; the review body repeats the heading after the jump menu.
function pluggedIn(html) {
  const text = toText(html);
  const heads = ['Positive Elements', 'Spiritual Elements', 'Sexual & Romantic Content', 'Violent Content',
    'Crude or Profane Language', 'Drug & Alcohol Content', 'Other Noteworthy Elements', 'Conclusion'];
  const lines = text.split('\n');
  const sections = {};
  // Take the LAST occurrence of each heading line (the first ones are the jump menu).
  const pos = Object.fromEntries(heads.map((h) => [h, lines.lastIndexOf(h)]));
  const starts = Object.values(pos).filter((i) => i >= 0).sort((a, b) => a - b);
  for (const h of heads) {
    const i = pos[h];
    if (i < 0) continue;
    const next = starts.find((s) => s > i) ?? Math.min(lines.length, i + 40);
    let body = lines.slice(i + 1, next);
    if (h === 'Conclusion') body = body.slice(0, body.findIndex((l) => /^(Pro-social Content|Objectionable Content|Summary Advisory|Latest Reviews|Recent Reviews)/.test(l)) >>> 0 || 6);
    sections[h] = body.join('\n');
  }
  // The plot synopsis between "Movie Review" and the first section: it often names the scary beats.
  const mr = lines.indexOf('Movie Review');
  if (mr >= 0 && starts.length) sections['Movie Review (synopsis)'] = lines.slice(mr + 1, starts[0]).join('\n');
  return sections;
}

// Common Sense Media: the category texts sit in the page in full inside the review markup.
function commonSense(html) {
  const text = toText(html);
  const sections = {};
  // The teaser version ends in an ellipsis; the full paragraph appears later. Keep the longest.
  const pntk = [...text.matchAll(/Parents need to know that[^\n]*(?:\n(?!Why Age|To stay in the loop|Violence & Scariness)[^\n]*){0,6}/g)]
    .map((m) => m[0].split('\n').filter((l) => !/^(Why Age|To stay|Did we miss)/.test(l)).join(' ').trim())
    .sort((a, b) => b.length - a.length)[0];
  if (pntk) sections['Parents Need to Know'] = pntk;
  // Full "Violence & Scariness" description: find the truncated teaser after the heading, then the
  // longest string in the raw HTML that starts with it.
  const lines = text.split('\n');
  const vi = lines.indexOf('Violence & Scariness');
  if (vi >= 0) {
    // Each category's full text sits HTML-escaped in a data-text="..." attribute.
    const teaser = lines[vi + 1].replace(/(\.\.\.|\u2026)$/, '').slice(0, 40);
    const candidates = [...html.matchAll(/data-text="([^"]*)"/g)].map((m) => toText(decode(m[1])))
      .filter((t) => t.startsWith(teaser));
    candidates.sort((x, y) => y.length - x.length);
    sections['Violence & Scariness'] = candidates[0] ?? lines[vi + 1];
  }
  const age = text.match(/age (\d+)\+/i);
  if (age) sections['age rating'] = `age ${age[1]}+`;
  return sections;
}

// DoesTheDogDie: one row per topic with Yes/No vote counts and community comments.
function dtddTopics(html) {
  const rows = html.split('<div class="topicRowContainer"').slice(1);
  const topics = [];
  for (const row of rows) {
    const id = (row.match(/data-topic-id="(\d+)"/) ?? [])[1];
    const name = decode((row.match(/<div class="name"><a[^>]*>([^<]*)<\/a>/) ?? [])[1] ?? '');
    const yes = +((row.match(/<div class="yes[^"]*">[\s\S]*?<div class="count">(\d+)<\/div>/) ?? [])[1] ?? 0);
    const no = +((row.match(/<div class="no[^"]*">[\s\S]*?<div class="count">(\d+)<\/div>/) ?? [])[1] ?? 0);
    // "VERIFIED" rows show only the winning side (no counts): yesNo--forced + <div class="yes winner">.
    const forced = /yesNo--forced/.test(row) ? ((row.match(/<div class="(yes|no) winner">/) ?? [])[1] ?? null) : null;
    const teaser = toText((row.match(/<span class="sceneAlertTeaserText">([\s\S]*?)<\/span>/) ?? [])[1] ?? '') || null;
    const comments = [...row.matchAll(/<div class="arrows"><i[^>]*><\/i><span>(-?\d+)<\/span>[\s\S]*?<div class="commentText"><span>([\s\S]*?)<\/span>/g)]
      .map((m) => ({ votes: +m[1], text: toText(m[2]) }));
    if (!name || (yes + no === 0 && !forced)) continue;
    topics.push({ topic_id: id, question: name, yes, no, verified: forced, when_teaser: teaser, comments });
  }
  return topics;
}

// Kids-In-Mind: take the VIOLENCE/GORE paragraph (the scary-scene descriptions live there).
function kidsInMind(html) {
  const text = toText(html);
  const out = {};
  // Older pages: "VIOLENCE/GORE 3 - ..."; newer ones: "<Title> VIOLENCE/GORE 3\n- ...".
  const v = text.match(/VIOLENCE\/GORE \d+\s*[-\u2013]\s*[\s\S]*?(?=\n(?:advertisement\n)?(?:[^\n]* )?LANGUAGE \d+)/);
  if (v) out['VIOLENCE/GORE'] = v[0].replace(/\nadvertisement/g, '').replace(/\s*\n[-\u2013]\s*/, ' - ').trim();
  const d = text.match(/DISCUSSION TOPICS\s*[-\u2013]\s*[^\n]*/);
  if (d) out['DISCUSSION TOPICS'] = d[0];
  return out;
}

async function collect(slug) {
  const f = FILMS[slug];
  const out = { film: slug, title: f.title, year: f.year, imdb_id: f.imdb, user_agent: UA, attempts: [], sources: [] };
  const attempt = (source, r, note) => out.attempts.push({ source, url: r.url, fetched_at: r.fetched_at, status: r.status, blocked: r.blocked, error: r.error, title: r.title, note: note ?? null });

  // 1. IMDb Parents Guide
  const imdb = await get(`https://www.imdb.com/title/${f.imdb}/parentalguide/`, `${slug}.imdb.html`);
  attempt('imdb_parents_guide', imdb, imdb.blocked ? 'refused by bot protection; not bypassed' : null);
  // 2. DoesTheDogDie: the site's own search box calls /search as an XHR; the media page is public.
  //    Timestamped "Scene Alerts" are a paid feature and are not fetched.
  const ds = await get(`https://www.doesthedogdie.com/search?q=${encodeURIComponent(f.title)}`, `${slug}.dtdd-search.html`, { 'X-Requested-With': 'XMLHttpRequest' });
  attempt('doesthedogdie', ds, ds.blocked ? 'refused by bot protection; not bypassed' : 'search');
  const hit = [...ds.body.matchAll(/data-item-id="(\d+)"[\s\S]*?class="name" href="\/media\/\d+">([^<]*)<\/a>[\s\S]*?<span class="type">([^<]*)<\/span>(?:<span class="releaseYear">&nbsp;• (\d{4}))?/g)]
    .map((m) => ({ id: m[1], name: decode(m[2]), type: m[3], year: +m[4] }))
    .find((m) => m.type === 'Movie' && m.year === f.year && m.name.toLowerCase().replace(/[^a-z]/g, '') === f.title.toLowerCase().replace(/[^a-z]/g, ''));
  if (hit) {
    const url = `https://www.doesthedogdie.com/media/${hit.id}`;
    const r = await get(url, `${slug}.dtdd.html`);
    attempt('doesthedogdie', r, r.blocked ? 'refused by bot protection; not bypassed' : null);
    if (r.status === 200 && !r.blocked) out.sources.push({ source: 'doesthedogdie', url, fetched_at: r.fetched_at, media_id: hit.id, topics: dtddTopics(r.body) });
  } else out.attempts.push({ source: 'doesthedogdie', note: 'no exact title+year match in search results' });
  // 3. Kids-In-Mind (robots.txt asks for Crawl-delay: 30, so uncached requests are spaced 30 s apart)
  for (const [i, url] of f.kim.entries()) {
    const cacheName = i === 0 ? `${slug}.kim.html` : `${slug}.kim${i}.html`;
    if (!fs.existsSync(path.join(HTML, `${cacheName}.meta.json`))) await kimPace();
    const kim = await get(url, cacheName);
    // Newer Kids-In-Mind pages (round 9: Onward) drop "[year]" from <title>; their <h1> reads "Title | year | rating".
    const kimOk = kim.status === 200 && !kim.blocked && (new RegExp(`\\[${f.year}\\]`).test(kim.title ?? '')
      || new RegExp(`<h1>[^<]*<span[^>]*>\\| ${f.year} \\|`).test(kim.body));
    attempt('kids_in_mind', kim, kim.blocked ? 'refused by bot protection; not bypassed' : (kim.status === 200 && !kimOk ? 'page is not this film (year check failed)' : null));
    if (kimOk) { out.sources.push({ source: 'kids_in_mind', url, fetched_at: kim.fetched_at, sections: kidsInMind(kim.body) }); break; }
    if (kim.blocked) break;
  }

  // 4. Plugged In (Focus on the Family) - reviewer-written "Violent Content" etc.
  for (const [i, url] of f.pi.entries()) {
    const r = await get(url, `${slug}.pi${i}.html`);
    const right = r.status === 200 && f.check.test(r.body)
      && (new RegExp(String(f.year)).test(r.body) || (f.piTitle && f.piTitle.test(r.title ?? '')));
    attempt('plugged_in', r, r.status === 200 && !right ? 'page is not this film (director/year check failed)' : null);
    if (right) {
      out.sources.push({ source: 'plugged_in', url, fetched_at: r.fetched_at, author_note: (toText(r.body).match(/\nReviewer\n([^\n]+)/) ?? [])[1] ?? null, sections: pluggedIn(r.body) });
      break;
    }
  }
  // 5. Common Sense Media - staff reviewer's "Violence & Scariness" and "Parents Need to Know".
  for (const [i, url] of f.csm.entries()) {
    const r = await get(url, `${slug}.csm${i}.html`);
    // CSM pages do not always name the director; the release year must appear at least 3 times.
    const right = r.status === 200 && (r.body.match(new RegExp(String(f.year), 'g')) ?? []).length >= 3
      && !/\bremake of\b/i.test(toText(r.body).match(/Parents need to know that[^\n]*/)?.[0] ?? '');
    attempt('common_sense_media', r, r.status === 200 && !right ? 'page is not this film (year check failed)' : null);
    if (right) { out.sources.push({ source: 'common_sense_media', url, fetched_at: r.fetched_at, sections: commonSense(r.body) }); break; }
  }
  fs.writeFileSync(path.join(RAW, `${slug}.json`), JSON.stringify(out, null, 2));
  const ok = out.sources.map((s) => `${s.source}(${s.topics ? `${s.topics.length} topics` : `${Object.keys(s.sections).length} sections`})`).join(', ') || 'none';
  console.log(`${slug}: sources ${ok}; refused: ${out.attempts.filter((a) => a.blocked).map((a) => a.source).join(', ') || 'none'}`);
}

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FILMS);
for (const s of slugs) await collect(s);
