// v10 ASSEMBLY scoring library (dev only, never read by the pipeline). Pure code over stored files.
//
// Reproduces the phrasing tournament's per-concept method (jevfirst/tournament/score.mjs) for ANY
// expression over question keys (combine.js), so the tournament candidates, the lint-fix variants and
// the final v10 bundles are all scored by one function:
//   keys      refs/<slug>.key.json items: not codex-rules, human_written != false, mappable, finite start/end,
//             >= 1 category in the 13 groups; window = [min(start, gap_start), max(end, gap_end)]
//   fire      a scene fires at t when an instance p >= t (raw answers: no retold / imagined / comic gates)
//   hit       the firing scene overlaps (> 0 ms) a key item whose categories include a fired instance's group
//   recall    key items of the concept's group(s) caught by a firing overlapping scene / those items
//   magic     the same on coco, book-of-life, princess-and-the-frog
// Answers per scene = one flat map key -> p:
//   tournament answers (jevfirst/tournament/out), lint-fix answers (assemble/fixrun/out, keys 'V+:', 'C+:',
//   'A+:'), and the v9 wording's stored Jev answers (v9/out/<slug>.jev.r1.json) as 'V:pl.<id>@L',
//   'V:ps.<id>@V9C', 'V:e.<id>@V9C', 'V:fe.<item>@V9C' (the 19 ids v9 gave Sonnet come from the tournament's
//   own V:* answers, as in score.mjs); scores.danger = v9's danger Score.
// Sonnet: v9/out/<slug>.sonnetq.r1.json probabilities (unlisted 0.05).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evalExpr } from '../combine.js';
import { FILMS } from '../jevfirst/tournament/films.mjs';
import { buildFixes } from './fixrun/fixes.mjs';
const buildFixesSync = () => buildFixes();

const here = path.dirname(fileURLToPath(import.meta.url));
export const TS = path.resolve(here, '../..');
const V9OUT = path.join(TS, 'v9/out');
const TOUR = path.resolve(here, '../jevfirst/tournament/out');
const FIX = path.join(here, 'fixrun/out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const MAGIC = ['coco', 'book-of-life', 'princess-and-the-frog'];
export const G13 = new Set(['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable']);
export { FILMS };

const overlaps = (s, w) => Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0;
export function keyItems(slug) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`));
  return k.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false && i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms))
    .map((i) => ({ id: i.id, text: i.text, cats: (i.categories ?? []).filter((c) => G13.has(c)), w: [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms] }))
    .filter((i) => i.cats.length);
}

/** Flat answer map of one scene from the v9 Jev run (v9 wording keys). */
export function v9Flat(ans) {
  const a = {};
  if (!ans) return a;
  for (const [id, p] of Object.entries(ans.pl ?? {})) a[`V:pl.${id}@L`] = p;
  if (ans.ps) for (const [id, p] of Object.entries(ans.ps)) a[`V:ps.${id}@V9C`] = p;
  for (const [id, p] of Object.entries(ans.e ?? {})) a[`V:e.${id}@V9C`] = p;
  for (const [id, p] of Object.entries(ans.fe ?? {})) a[`V:fe.${id}@V9C`] = p;
  return a;
}

/** Are the lint-fix answers (assemble/fixrun/out) complete for all 13 films? */
export const fixrunComplete = () => FILMS.every((slug) => { const f = path.join(FIX, `${slug}.answers.json`); return fs.existsSync(f) && rj(f).complete === true; });

let CACHE = null;
/**
 * Per film: { slug, items (keys), filmItems, scenes: [{ id, start_ms, end_ms, a, scores, son, ov }] }.
 * fix = 'measured' (lint-fix answers from fixrun/out, must be complete) | 'proxy' (each lint-fix key gets its
 * ORIGINAL wording's answer: an unmeasured stand-in, labelled as such by the callers) | 'none'.
 */
export function loadData({ fix = 'none' } = {}) {
  if (CACHE && CACHE.fix === fix) return CACHE.data;
  const data = {};
  const proxies = fix === 'proxy' ? buildFixesSync() : [];
  for (const slug of FILMS) {
    const t = rj(path.join(TOUR, `${slug}.answers.json`));
    const fx = fix === 'measured' ? rj(path.join(FIX, `${slug}.answers.json`)) : null;
    if (fix === 'measured' && !fx.complete) throw new Error(`${slug}: lint-fix answers incomplete (assemble/fixrun/run.mjs)`);
    const v9 = rj(path.join(V9OUT, `${slug}.jev.r1.json`));
    const son = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
    const v9by = new Map(v9.scenes.map((s) => [s.id, s.answers]));
    const fxby = new Map((fx?.scenes ?? []).map((s) => [s.id, s.answers]));
    const items = keyItems(slug);
    const scenes = t.scenes.map((s) => {
      const v = v9by.get(s.id);
      // tournament answers first; v9's stored answers override the V:* keys they cover (score.mjs v9P order)
      const a = { ...s.answers, ...v9Flat(v), ...(fxby.get(s.id) ?? {}) };
      for (const f of proxies) if (a[f.fixes] !== undefined) a[f.key] = a[f.fixes];
      return { id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, a, v9: v, scores: { danger: Number(v?.s?.danger?.score ?? 0) }, son: son.scenes[s.id] ?? {}, ov: items.map((it, k) => (overlaps(s, it.w) ? k : -1)).filter((k) => k >= 0) };
    });
    data[slug] = { slug, items, filmItems: t.film_items, scenes, len: Math.max(...scenes.map((s) => s.end_ms)) };
  }
  CACHE = { fix, data };
  return data;
}

/**
 * Instances of a concept in one scene: [{ p, g }]. spec = { expr, film: type|null, group }.
 * Non-film: one instance with the concept's group (none when the group is not one of the 13).
 * Film template: one instance per generated item of that type, with the item's group.
 */
export function instances(spec, scene, film) {
  if (spec.film) return film.filmItems.filter((it) => it.type === spec.film).map((it) => ({ p: evalExpr(spec.expr, { a: scene.a, scores: scene.scores, items: film.filmItems, item: it }), g: it.group }));
  if (!G13.has(spec.group)) return [];
  return [{ p: spec.p ? spec.p(scene) : evalExpr(spec.expr, { a: scene.a, scores: scene.scores, items: film.filmItems }), g: spec.group }];
}

function evalFilm(spec, F, t) {
  const groups = new Set(instances(spec, F.scenes[0], F).map((x) => x.g));
  const items = F.items.filter((i) => i.cats.some((g) => groups.has(g)));
  let fires = 0; let hits = 0; const caught = new Set(); const fired = [];
  for (const s of F.scenes) {
    const g = new Set(instances(spec, s, F).filter((x) => x.p >= t).map((x) => x.g));
    if (!g.size) continue;
    fires += 1; fired.push(s.id);
    let hit = false;
    for (const k of s.ov) { const it = F.items[k]; if (it.cats.some((c) => g.has(c))) { hit = true; caught.add(it.id); } }
    if (hit) hits += 1;
  }
  return { fires, hits, items: items.length, caught: items.filter((i) => caught.has(i.id)).length, fired };
}

/** { all, magic } at threshold t over the 13 films (precision/recall null when undefined). */
export function score(spec, t, data = loadData()) {
  const acc = (films) => {
    const r = { fires: 0, hits: 0, items: 0, caught: 0 };
    for (const slug of films) { const e = evalFilm(spec, data[slug], t); r.fires += e.fires; r.hits += e.hits; r.items += e.items; r.caught += e.caught; }
    r.precision = r.fires ? r.hits / r.fires : null;
    r.recall = r.items ? r.caught / r.items : null;
    return r;
  };
  return { all: acc(FILMS), magic: acc(MAGIC) };
}

/** Sonnet's stored v9 answer for the concept's ids (max over the ids), as a spec. */
export const sonnetSpec = (ids, group) => ({ group, film: null, p: (s) => Math.max(...ids.map((id) => s.son?.[id]?.p ?? 0.05)) });
