#!/usr/bin/env node
// PHRASING TOURNAMENT scorer. Pure code over files on disk; no model calls.
//
//   node score.mjs  ->  results.json, TOURNAMENT.md (../TOURNAMENT.md), CANDIDATES.md
//
// METHOD
//  Keys: refs/<slug>.key.json items with source != 'codex-rules' and human_written != false, mappable, finite
//   start/end, >= 1 category in the 13 v3 groups; window = gap window [min(start, gap_start), max(end, gap_end)]
//   (v8 scorecard). A scene overlaps an item when they share > 0 ms.
//  Scenes: v9 segmentation of the 13 seen films (v9/out/<slug>.segments.json), the same scenes Jev (this
//   run and v9) and Sonnet (v9/out/<slug>.sonnetq.r1.json) answered.
//  Candidate = one way to answer a concept with per-scene probabilities: a single pooled phrasing (Claude
//   phrasing; Astra sub-Noul on one channel, or max over its channels; v9 wording), or a bundle (Claude's
//   written combine rule; Astra's combine expression, gates on verified_child etc. realised in the wording
//   and state; OR of all of a source's phrasings; OR of the phrasings that survive Claude's own next-round
//   pruning rule: drop a phrasing firing >= 4 times at < 0.5 precision). Fuzzy logic: OR = max, AND = min.
//  Per the v8 scorecard per-question method: a candidate FIRES in a scene at threshold t when p >= t (raw
//   answers: no scene-level retold / imagined / comic gates, for Jev and Sonnet alike). A fire is a HIT when
//   the scene overlaps a key item whose categories include the concept's group (film templates: the group of
//   the fired instance). precision = hits / fires (a LOWER bound: keys list notable moments, not every scene
//   a thing is on screen); recall = key items in the group caught by a firing overlapping scene / key items
//   in the group. Thresholds 0.6 / 0.7 / 0.8.
//  Chance correction (v8 verify.mjs): circular shift of each film's fire pattern over K=200 offsets gives the
//   precision P0 and recall R0 expected by chance at the same fire count and footprint; lift = P / P0,
//   kappa = (R - R0) / (1 - R0).
//  Sonnet: its stored v9 answers (probability map yes/high .95, yes/medium .8, yes/low .6, no .35/.2/.05,
//   unlisted .05) on the v9 wording, for the 43 split.json sonnet_asked ids; a concept with several ids takes
//   the max over the ids Sonnet was asked. Reference threshold 0.7 (its flag threshold; 0.8 is identical).
//  OWNER RULE (Jev first): Jev owns a concept if some Jev candidate at some t in {0.6, 0.7, 0.8} has overall
//   precision >= 0.70 on >= 4 fires, precision >= 0.60 on the magic/afterlife films (coco, book-of-life,
//   princess-and-the-frog; 0 fires there = no misfire, passes, flagged), and, where Sonnet was measured,
//   precision >= Sonnet's - 0.05 and recall >= Sonnet's - 0.05. Otherwise Sonnet owns it. Among passing
//   candidates the best has the highest recall, then precision, then fewest questions.
//  CAVEAT: all 13 films are SEEN films and the best of ~20-40 candidates x 3 thresholds is chosen on the
//   same data, so the winners' numbers are optimistic; they are the candidates to freeze for a held-out run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FILMS } from './films.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(HERE, '../../..');
const V9OUT = path.join(TS, 'v9/out');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const MAGIC = ['coco', 'book-of-life', 'princess-and-the-frog'];
const TH = [0.6, 0.7, 0.8];
const SONNET_T = 0.7;
const BAND_LOW = 0.4;
const G13 = new Set(['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable']);
const RULE = { minFires: 4, minPrec: 0.7, minMagicPrec: 0.6, precTol: 0.05, recTol: 0.05 };

const { concepts: CONCEPTS, pool: POOL } = rj(path.join(HERE, 'pool.json'));
const SPLIT = rj(path.join(TS, 'v9/split.json'));
const CLAUDE = rj(path.join(HERE, '../claude-concepts.json'));
const ASTRA = rj(path.join(HERE, '../astra-concepts.json'));
const SONNET_ASKED = new Set(SPLIT.sonnet_asked);

// ---------------------------------------------------------------------------------------------
// Data per film
// ---------------------------------------------------------------------------------------------
const overlaps = (s, w) => Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0;
function keyFor(slug) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`));
  return k.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false && i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms))
    .map((i) => ({ id: i.id, text: i.text, cats: (i.categories ?? []).filter((c) => G13.has(c)), w: [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms] }))
    .filter((i) => i.cats.length);
}
const DATA = {};
for (const slug of FILMS) {
  const t = rj(path.join(HERE, 'out', `${slug}.answers.json`));
  if (!t.complete) throw new Error(`${slug}: tournament answers incomplete`);
  const v9 = rj(path.join(V9OUT, `${slug}.jev.r1.json`));
  const son = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
  const v9by = new Map(v9.scenes.map((s) => [s.id, s.answers]));
  if (v9.scenes.length !== t.scenes.length) throw new Error(`${slug}: scene count differs from v9`);
  const items = keyFor(slug);
  const scenes = t.scenes.map((s) => ({ id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, a: s.answers, v9: v9by.get(s.id), son: son.scenes[s.id] ?? {}, ov: items.map((it, k) => (overlaps(s, it.w) ? k : -1)).filter((k) => k >= 0) }));
  DATA[slug] = { slug, items, scenes, filmItems: t.film_items, len: Math.max(...scenes.map((s) => s.end_ms)) };
}

// ---------------------------------------------------------------------------------------------
// Candidates. fn(scene, film) -> [{ p, g }] (g = group of the instance)
// ---------------------------------------------------------------------------------------------
const CK = Object.fromEntries(CONCEPTS.map((c) => [c.key, c]));
const conceptGroups = (c) => (G13.has(c.group) ? [c.group] : []);
const ask = (s, k) => s.a[k] ?? 0; // unasked (empty summary) = 0
const poolBy = (f) => POOL.filter(f);
const qkey = (x) => `${x.src}:${x.sub}@${x.state}`;
const CANDS = [];
const cand = (c) => { CANDS.push(c); return c; };
const max = (...a) => Math.max(0, ...a);
const min = (...a) => (a.length ? Math.min(...a) : 0);

// film instances of a film template single question
const filmInst = (scene, film, type, fnItem) => film.filmItems.filter((it) => it.type === type).map((it) => ({ p: fnItem(it), g: it.group }));
const FILM_TYPE = { 'film:threatens': 'threatens', 'film:child_in_danger': 'child_in_danger', 'film:danger': 'danger' };

// --- singles: every pooled phrasing on its own
const text = {};
for (const x of POOL) {
  const k = qkey(x);
  text[k] = x.q.instructions;
  const c = CK[x.concept];
  if (x.film) {
    const type = FILM_TYPE[x.concept];
    cand({ id: k, src: x.src, concept: x.concept, kind: 'single', n: 1, desc: x.q.instructions, fn: (s, f) => filmInst(s, f, type, (it) => ask(s, `${x.src}:${x.sub}#${it.id}@${x.state}`)) });
  } else {
    cand({ id: k, src: x.src, concept: x.concept, kind: 'single', n: 1, desc: x.q.instructions, fn: (s) => conceptGroups(c).map((g) => ({ p: ask(s, k), g })) });
  }
}
// --- Astra sub-Nouls: max over the channels they were asked on
const astraSubs = new Map();
for (const x of poolBy((x) => x.src === 'A')) {
  const id = `A:${x.sub}`;
  if (!astraSubs.has(id)) astraSubs.set(id, { concept: x.concept, film: x.film, astraConcept: x.id, n: x.n, keys: [], descs: [] });
  const e = astraSubs.get(id);
  e.keys.push({ sub: x.sub, state: x.state });
  e.descs.push(x.q.instructions);
}
const astraSubP = (s, e, it) => max(...e.keys.map((k) => ask(s, it ? `A:${k.sub}#${it.id}@${k.state}` : `A:${k.sub}@${k.state}`)));
for (const [id, e] of astraSubs) {
  if (e.keys.length < 2) continue;
  const c = CK[e.concept];
  cand({ id: `${id}@max`, src: 'A', concept: e.concept, kind: 'single', n: e.keys.length, desc: `max over channels: ${e.descs[0].replace(/`scene\.(lines|summary)`/, '{lines|summary}')}`,
    fn: e.film ? (s, f) => filmInst(s, f, FILM_TYPE[e.concept], (it) => astraSubP(s, e, it)) : (s) => conceptGroups(c).map((g) => ({ p: astraSubP(s, e), g })) });
}

// --- Astra bundles: parse the combine expression (gates realised in wording/state -> true)
function parseExpr(str) {
  let s = str.split(';')[0].replace(/^tag if\s*/, '').replace(/for death evidence/, '').replace(/single per channel/, '(1)').replace(/,\s*separately.*$/, '');
  s = s.replace(/\w+\([A-Z,]+\)\s*AND\s*/g, '');
  const toks = s.match(/\(\d+\)|AND|OR|\(|\)/g);
  let i = 0;
  const prim = () => { const t = toks[i++]; if (/^\(\d+\)$/.test(t)) return { n: Number(t.slice(1, -1)) }; if (t === '(') { const e = orE(); i++; return e; } throw new Error(`parse ${str} at ${t}`); };
  const andE = () => { let l = prim(); while (toks[i] === 'AND') { i++; l = { and: [l, prim()] }; } return l; };
  const orE = () => { let l = andE(); while (toks[i] === 'OR') { i++; l = { or: [l, andE()] }; } return l; };
  return orE();
}
const evalExpr = (e, val) => (e.n != null ? val(e.n) : e.and ? min(...e.and.map((x) => evalExpr(x, val))) : max(...e.or.map((x) => evalExpr(x, val))));
const exprStr = (e) => (e.n != null ? `(${e.n})` : e.and ? `(${e.and.map(exprStr).join(' AND ')})` : `(${e.or.map(exprStr).join(' OR ')})`);
for (const a of ASTRA.concepts) {
  const subs = [...astraSubs.entries()].filter(([, e]) => e.astraConcept === a.phrasings[0].id);
  if (!subs.length) continue;
  const concept = subs[0][1].concept;
  const expr = parseExpr(a.phrasings[0].combine);
  const byN = Object.fromEntries(subs.map(([, e]) => [e.n, e]));
  const val = (s, it) => (n) => (byN[n] ? astraSubP(s, byN[n], it) : 1); // a sub folded into the wording counts as true
  const c = CK[concept];
  cand({ id: `A:bundle:${a.concept}`, src: 'A', concept, kind: 'bundle', n: subs.reduce((k, [, e]) => k + e.keys.length, 0), desc: `Astra ${a.concept}: ${exprStr(expr)} over ${subs.map(([id]) => id.slice(2)).join(', ')}`,
    fn: subs[0][1].film ? (s, f) => filmInst(s, f, FILM_TYPE[concept], (it) => evalExpr(expr, val(s, it))) : (s) => conceptGroups(c).map((g) => ({ p: evalExpr(expr, val(s)), g })) });
}

// --- Claude bundles (the combine rules written on the phrasings)
const cp = (s, id) => { // Claude phrasing p (its one state)
  const x = POOL.find((y) => y.src === 'C' && y.sub === id);
  return x ? ask(s, qkey(x)) : 0;
};
const claudeIds = (concept) => poolBy((x) => x.src === 'C' && x.concept === concept && !x.film).map((x) => x.sub);
const orAll = (s, ids) => max(...ids.map((id) => cp(s, id)));
const deadBody = (s) => max(cp(s, 'dead_body.a'), cp(s, 'dead_body.b'));
const diesP = (s) => max(cp(s, 'dies.a'), cp(s, 'dies.b'), deadBody(s), max(cp(s, 'dies.a'), cp(s, 'dies.b'), cp(s, 'seriously_ill.a')) >= BAND_LOW ? cp(s, 'dies.c') : 0);
const present = (s, it) => max(s.v9?.fpl?.[`${it.entity}_present`] ?? 0, s.v9?.fps?.[`${it.entity}_present`] ?? 0);
const CLAUDE_RULE = {
  witch_sorcerer: { f: (s) => cp(s, 'witch_sorcerer.a'), d: 'a (b alone is a no)' },
  dies: { f: diesP, d: 'max(a, b, dead_body) OR (c if max(a, b, seriously_ill.a) >= 0.4)' },
  loved_one_dies: { f: (s) => (diesP(s) >= BAND_LOW ? max(cp(s, 'loved_one_dies.a'), cp(s, 'loved_one_dies.b')) : 0), d: 'max(a, b) AND dies >= 0.4' },
  parent_death_learned: { f: (s) => max(cp(s, 'parent_death_learned.a'), diesP(s) >= BAND_LOW ? cp(s, 'parent_death_learned.b') : 0), d: 'max(a, b AND dies >= 0.4)' },
  grieving: { f: (s) => max(cp(s, 'grieving.a'), cp(s, 'grieving.b'), max(diesP(s), cp(s, 'believed_dead.a'), cp(s, 'believed_dead.b')) >= BAND_LOW ? cp(s, 'crying.a') : 0), d: 'max(a, b, crying.a AND (dies OR believed_dead) >= 0.4)' },
  child_taken: { f: (s) => max(cp(s, 'child_taken.a'), cp(s, 'child_taken.b')), d: 'max(a, b) (c is a threat flag)' },
  afraid_for_safety: { f: (s) => max(cp(s, 'afraid_for_safety.a'), cp(s, 'afraid_for_safety.b'), (s.v9?.s?.danger?.score ?? 0) >= 2 ? cp(s, 'afraid_for_safety.c') : 0), d: 'max(a, b, c AND v9 danger Score >= 2)' },
  creature_threat: { f: (s, f) => max(cp(s, 'creature_threat.a'), cp(s, 'creature_threat.b'), cp(s, 'ghost_spirit.c'), cp(s, 'spider_insect.b'), min(cp(s, 'creature_threat.c'), cp(s, 'afraid_for_safety.a')), ...f.filmItems.filter((it) => it.type === 'danger' && it.group === 'creatures_figures').map((it) => ask(s, `C:film_danger.a#${it.id}@LSnl`))), d: 'max(a, b, ghost_spirit.c, spider_insect.b, film creature dangers, c AND afraid_for_safety.a)' },
  child_in_danger: { f: (s, f) => max(cp(s, 'child_in_danger.a'), ...f.filmItems.filter((it) => it.type === 'child_in_danger').map((it) => ask(s, `C:film_child_in_danger.a#${it.id}@LSnl`))), d: 'max(a, film child_in_danger for every verified child)' },
  appears_suddenly: { f: (s) => min(cp(s, 'appears_suddenly.a'), cp(s, 'startled.a')), d: 'jump_scare = min(appears_suddenly.a, startled.a)' },
};
for (const c of CONCEPTS) {
  if (c.film) continue;
  const ids = claudeIds(c.key);
  if (!ids.length) continue;
  const r = CLAUDE_RULE[c.key];
  if (r) cand({ id: `C:bundle:${c.key}`, src: 'C', concept: c.key, kind: 'bundle', n: ids.length, desc: `Claude combine: ${r.d}`, fn: (s, f) => conceptGroups(c).map((g) => ({ p: r.f(s, f), g })) });
  if (ids.length > 1) cand({ id: `C:or:${c.key}`, src: 'C', concept: c.key, kind: 'or_all', n: ids.length, desc: `OR of Claude ${ids.join(', ')}`, fn: (s) => conceptGroups(c).map((g) => ({ p: orAll(s, ids), g })) });
}
// Claude film bundles
{
  const thr = (s, it) => max(ask(s, `C:film_threatens.a#${it.id}@S`), ask(s, `C:film_threatens.b#${it.id}@L`), present(s, it) >= 0.7 ? max(cp(s, 'threatens_harm.a'), cp(s, 'plots_harm.a')) : 0);
  cand({ id: 'C:bundle:film:threatens', src: 'C', concept: 'film:threatens', kind: 'bundle', n: 4, desc: 'Claude combine: max(a, b, (threatens_harm.a OR plots_harm.a) AND v9 present.<C> >= 0.7)', fn: (s, f) => filmInst(s, f, 'threatens', (it) => thr(s, it)) });
  cand({ id: 'C:or:film:threatens', src: 'C', concept: 'film:threatens', kind: 'or_all', n: 2, desc: 'OR of Claude film_threatens.a, .b', fn: (s, f) => filmInst(s, f, 'threatens', (it) => max(ask(s, `C:film_threatens.a#${it.id}@S`), ask(s, `C:film_threatens.b#${it.id}@L`))) });
}

// --- v9 control (Jev, v9 wording): reused v9 answers, or this run's V:* for the 19 sonnet_used ids
const v9P = (s, id) => {
  const ps = s.v9?.ps; const hasS = ps !== null && ps !== undefined;
  const fromRun = (k) => s.a[k];
  const pl = s.v9?.pl?.[id] ?? fromRun(`V:pl.${id}@L`);
  const psv = hasS ? (ps?.[id] ?? fromRun(`V:ps.${id}@V9C`)) : fromRun(`V:ps.${id}@V9C`);
  const e = s.v9?.e?.[id] ?? fromRun(`V:e.${id}@V9C`);
  if (pl !== undefined || psv !== undefined) return max(pl ?? 0, psv ?? 0);
  return e;
};
for (const c of CONCEPTS) {
  if (c.film) {
    const type = FILM_TYPE[c.key];
    cand({ id: `V:${c.key}`, src: 'V', concept: c.key, kind: 'v9', n: 1, desc: `v9 fe.<id> (${type})`, fn: (s, f) => filmInst(s, f, type, (it) => s.v9?.fe?.[it.id] ?? 0) });
    continue;
  }
  const ids = c.v9_ids;
  for (const id of ids) {
    cand({ id: `V:${id}`, src: 'V', concept: c.key, kind: 'v9', n: 1, desc: `v9 wording (${id})`, fn: (s) => conceptGroups(c).map((g) => ({ p: v9P(s, id) ?? 0, g })) });
  }
  if (ids.length > 1) cand({ id: `V:or:${c.key}`, src: 'V', concept: c.key, kind: 'v9', n: ids.length, desc: `v9 max(${ids.join(', ')})`, fn: (s) => conceptGroups(c).map((g) => ({ p: max(...ids.map((id) => v9P(s, id) ?? 0)), g })) });
  if (c.derived_jump) cand({ id: 'V:jump_scare', src: 'V', concept: c.key, kind: 'v9', n: 2, desc: 'v9 jump_scare = min(appears_suddenly, startled)', fn: (s) => conceptGroups(c).map((g) => ({ p: min(v9P(s, 'appears_suddenly') ?? 0, v9P(s, 'startled') ?? 0), g })) });
}
// sanity: every v9 id resolves to a number on every scene
for (const slug of FILMS) for (const s of DATA[slug].scenes) for (const c of CONCEPTS) for (const id of c.v9_ids) if (typeof v9P(s, id) !== 'number') throw new Error(`v9 control missing ${slug} ${s.id} ${id}`);

// --- Sonnet (stored v9 answers)
const sonP = (s, id) => s.son?.[id]?.p ?? 0.05;
const SONNET = {};
for (const c of CONCEPTS) {
  const ids = c.v9_ids.filter((id) => SONNET_ASKED.has(id));
  if (!ids.length) continue;
  SONNET[c.key] = { id: `S:${c.key}`, src: 'S', concept: c.key, kind: 'sonnet', n: ids.length, ids, partial: ids.length < c.v9_ids.length, desc: `Sonnet v9 max(${ids.join(', ')})`, fn: (s) => conceptGroups(c).map((g) => ({ p: max(...ids.map((id) => sonP(s, id))), g })) };
}

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------
function firesOf(cd, slug, t) {
  const F = DATA[slug];
  const out = [];
  for (const s of F.scenes) {
    const inst = cd.fn(s, F);
    const g = new Set(inst.filter((x) => x.p >= t).map((x) => x.g));
    if (g.size) out.push({ s, g });
  }
  return out;
}
function itemsFor(cd, slug) {
  const F = DATA[slug];
  const groups = new Set(cd.fn(F.scenes[0], F).map((x) => x.g));
  return { groups, items: F.items.filter((i) => i.cats.some((g) => groups.has(g))) };
}
function evalFilm(cd, slug, t) {
  const F = DATA[slug];
  const { items } = itemsFor(cd, slug);
  const fires = firesOf(cd, slug, t);
  let hits = 0;
  const caught = new Set();
  for (const { s, g } of fires) {
    let hit = false;
    for (const k of s.ov) { const it = F.items[k]; if (it.cats.some((c) => g.has(c))) { hit = true; caught.add(it.id); } }
    if (hit) hits += 1;
  }
  return { fires: fires.length, hits, items: items.length, caught: items.filter((i) => caught.has(i.id)).length, firesList: fires };
}
function evalSet(cd, films, t) {
  const r = { fires: 0, hits: 0, items: 0, caught: 0 };
  for (const slug of films) { const e = evalFilm(cd, slug, t); r.fires += e.fires; r.hits += e.hits; r.items += e.items; r.caught += e.caught; }
  r.precision = r.fires ? r.hits / r.fires : null;
  r.recall = r.items ? r.caught / r.items : null;
  return r;
}
function wilsonLo(k, n, z = 1.96) { if (!n) return null; const p = k / n; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return (c - m) / d; }
// circular-shift null (fire pattern shifted, items fixed)
function chance(cd, t, films = FILMS, K = 200) {
  let hits = 0, fires = 0, caught = 0, items = 0;
  for (const slug of films) {
    const F = DATA[slug];
    const { items: its } = itemsFor(cd, slug);
    const fl = firesOf(cd, slug, t);
    items += its.length;
    if (!fl.length) continue;
    const L = F.len;
    for (let k = 0; k < K; k++) {
      const o = ((k + 0.5) / K) * L;
      const got = new Set();
      for (const { s, g } of fl) {
        let a = s.start_ms + o, b = s.end_ms + o;
        if (a >= L) { a -= L; b -= L; }
        const spans = b <= L ? [[a, b]] : [[a, L], [0, b - L]];
        let hit = false;
        for (const it of its) if (it.cats.some((c) => g.has(c)) && spans.some(([x, y]) => Math.min(y, it.w[1]) - Math.max(x, it.w[0]) > 0)) { hit = true; got.add(it.id); }
        fires += 1 / K; if (hit) hits += 1 / K;
      }
      caught += got.size / K;
    }
  }
  return { P0: fires ? hits / fires : null, R0: items ? caught / items : null };
}
function auc(cd) {
  const pos = [], neg = [];
  for (const slug of FILMS) {
    const F = DATA[slug];
    for (const s of F.scenes) {
      const inst = cd.fn(s, F);
      const p = max(...inst.map((x) => x.p));
      const gs = new Set(inst.map((x) => x.g));
      (s.ov.some((k) => F.items[k].cats.some((c) => gs.has(c))) ? pos : neg).push(p);
    }
  }
  if (!pos.length || !neg.length) return null;
  let a = 0; for (const x of pos) for (const y of neg) a += x > y ? 1 : x === y ? 0.5 : 0;
  return a / (pos.length * neg.length);
}

// Claude's own pruning rule -> one more candidate per concept per source (C, A)
const RES = new Map();
const evalAll = (cd) => Object.fromEntries(TH.map((t) => [t, { all: evalSet(cd, FILMS, t), magic: evalSet(cd, MAGIC, t) }]));
for (const cd of CANDS) RES.set(cd.id, evalAll(cd));
for (const src of ['C', 'A']) {
  for (const c of CONCEPTS) {
    const singles = CANDS.filter((cd) => cd.concept === c.key && cd.src === src && cd.kind === 'single' && !(src === 'A' && cd.id.endsWith('@max')));
    if (singles.length < 2) continue;
    for (const t of TH) {
      const keep = singles.filter((cd) => { const r = RES.get(cd.id)[t].all; return !(r.fires >= 4 && r.precision < 0.5); });
      if (!keep.length || keep.length === singles.length) continue;
      const cd = cand({ id: `${src}:pruned@${t}:${c.key}`, src, concept: c.key, kind: 'pruned_or', n: keep.length, fixedT: t, desc: `OR of ${src === 'C' ? 'Claude' : 'Astra'} phrasings kept by the prune rule at ${t}: ${keep.map((k) => k.id.slice(2)).join(', ')}`,
        fn: (s, f) => { const out = new Map(); for (const k of keep) for (const x of k.fn(s, f)) out.set(x.g, max(out.get(x.g) ?? 0, x.p)); return [...out].map(([g, p]) => ({ g, p })); } });
      RES.set(cd.id, evalAll(cd));
    }
  }
}
const SRES = Object.fromEntries(Object.entries(SONNET).map(([k, cd]) => [k, evalAll(cd)]));

// ---------------------------------------------------------------------------------------------
// Owner rule
// ---------------------------------------------------------------------------------------------
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const frac = (r) => (r.fires ? `${r.hits}/${r.fires} (${pct(r.precision)})` : '0 fires');
const rfrac = (r) => (r.items ? `${r.caught}/${r.items} (${pct(r.recall)})` : 'no items');
const rows = [];
for (const c of CONCEPTS) {
  const son = SONNET[c.key] ? { at: SRES[c.key][SONNET_T].all, at06: SRES[c.key][0.6].all, magic: SRES[c.key][SONNET_T].magic, partial: SONNET[c.key].partial, ids: SONNET[c.key].ids } : null;
  const opts = [];
  for (const cd of CANDS.filter((x) => x.concept === c.key)) {
    for (const t of cd.fixedT ? [cd.fixedT] : TH) {
      const r = RES.get(cd.id)[t];
      const fails = [];
      if (r.all.fires < RULE.minFires) fails.push(`${r.all.fires} fires < 4`);
      if (r.all.precision == null || r.all.precision < RULE.minPrec) fails.push(`precision ${pct(r.all.precision)} < 70%`);
      if (r.magic.fires && r.magic.precision < RULE.minMagicPrec) fails.push(`magic films ${pct(r.magic.precision)} < 60%`);
      if (son && son.at.fires && r.all.precision != null && r.all.precision < son.at.precision - RULE.precTol) fails.push(`precision ${pct(r.all.precision)} < Sonnet ${pct(son.at.precision)} - 5`);
      if (son && son.at.items && r.all.recall < son.at.recall - RULE.recTol) fails.push(`recall ${pct(r.all.recall)} < Sonnet ${pct(son.at.recall)} - 5`);
      opts.push({ cd, t, r, fails, wlo: wilsonLo(r.all.hits, r.all.fires) });
    }
  }
  const pass = opts.filter((o) => !o.fails.length).sort((a, b) => b.r.all.recall - a.r.all.recall || b.r.all.precision - a.r.all.precision || a.cd.n - b.cd.n || (a.cd.kind === 'single' ? -1 : 1));
  const withFires = opts.filter((o) => o.r.all.fires >= RULE.minFires).sort((a, b) => b.wlo - a.wlo || b.r.all.recall - a.r.all.recall);
  const best = pass[0] ?? withFires[0] ?? opts.sort((a, b) => b.r.all.fires - a.r.all.fires)[0];
  const v9ctl = opts.filter((o) => o.cd.src === 'V').sort((a, b) => (b.fails.length === 0) - (a.fails.length === 0) || b.r.all.recall - a.r.all.recall)[0];
  const v9pass = opts.some((o) => o.cd.src === 'V' && !o.fails.length);
  const owner = pass.length ? 'jev' : 'sonnet';
  const rankOf = (list) => list.filter((o) => !o.fails.length).sort((a, b) => b.r.all.recall - a.r.all.recall || b.r.all.precision - a.r.all.precision)[0]
    ?? list.filter((o) => o.r.all.fires >= RULE.minFires).sort((a, b) => b.wlo - a.wlo || b.r.all.recall - a.r.all.recall)[0]
    ?? [...list].sort((a, b) => b.r.all.fires - a.r.all.fires)[0];
  const bySrc = Object.fromEntries(['C', 'A', 'V'].map((k) => { const o = rankOf(opts.filter((x) => x.cd.src === k)); return [k, o && { id: o.cd.id, desc: o.cd.desc, t: o.t, all: o.r.all, magic: o.r.magic, passes: !o.fails.length }]; }));
  // Jev ties or beats Sonnet (both tolerances, >= 4 fires), ignoring the absolute 0.70 / magic bars
  const tieSonnet = son && son.at.fires ? opts.filter((o) => o.r.all.fires >= RULE.minFires && o.r.all.precision >= son.at.precision - RULE.precTol && o.r.all.recall >= son.at.recall - RULE.recTol).sort((a, b) => b.r.all.recall - a.r.all.recall || b.r.all.precision - a.r.all.precision)[0] : null;
  const reason = owner === 'jev' ? 'rule passed' : !son ? 'Sonnet never asked; Jev below the absolute bar' : son.at.fires < RULE.minFires ? 'thin evidence: Sonnet < 4 fires; Jev below the absolute bar' : tieSonnet ? 'Jev ties/beats Sonnet (within 5 pts) but Jev below the absolute bar' : 'Sonnet (>= 4 fires) beats every Jev candidate beyond tolerance';
  const ch = best ? chance(best.cd, best.t) : null;
  const sch = SONNET[c.key] ? chance(SONNET[c.key], SONNET_T) : null;
  const v9owner = c.film ? 'jev' : c.v9_ids.every((id) => SPLIT.assign[id] === 'jev') ? 'jev' : c.v9_ids.every((id) => SPLIT.assign[id] === 'sonnet') ? 'sonnet' : 'mixed';
  rows.push({
    concept: c.key, label: c.label, group: c.group, v9_ids: c.v9_ids, v9_owner: v9owner, owner,
    best: best && { id: best.cd.id, src: best.cd.src, kind: best.cd.kind, desc: best.cd.desc, n: best.cd.n, t: best.t, all: best.r.all, magic: best.r.magic, wilson_lo: best.wlo, fails: best.fails, P0: ch?.P0, R0: ch?.R0, lift: ch?.P0 ? best.r.all.precision / ch.P0 : null, kappa: ch?.R0 != null && best.r.all.recall != null ? (best.r.all.recall - ch.R0) / (1 - ch.R0) : null, auc: auc(best.cd) },
    passing_candidates: pass.length, candidates: opts.length, by_source: bySrc, reason,
    jev_vs_sonnet_tie: tieSonnet && { id: tieSonnet.cd.id, t: tieSonnet.t, all: tieSonnet.r.all, magic: tieSonnet.r.magic },
    sonnet_meets_absolute_bar: son ? son.at.fires >= RULE.minFires && son.at.precision >= RULE.minPrec && (!son.magic.fires || son.magic.precision >= RULE.minMagicPrec) : null,
    v9_control: v9ctl && { id: v9ctl.cd.id, t: v9ctl.t, all: v9ctl.r.all, magic: v9ctl.r.magic, passes: v9pass },
    sonnet: son && { ...son, P0: sch?.P0, lift: sch?.P0 && son.at.precision != null ? son.at.precision / sch.P0 : null },
    top: opts.sort((a, b) => (a.fails.length ? 1 : 0) - (b.fails.length ? 1 : 0) || (b.wlo ?? -1) - (a.wlo ?? -1)).slice(0, 8).map((o) => ({ id: o.cd.id, t: o.t, all: o.r.all, magic: o.r.magic, fails: o.fails })),
  });
}

// ---------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------
const byOwner = (o) => rows.filter((r) => r.owner === o).map((r) => r.concept);
const idShare = (ownerOf) => { let j = 0, n = 0; for (const r of rows) for (const id of (r.v9_ids.length ? r.v9_ids : [r.concept])) { n += 1; if (ownerOf(r, id) === 'jev') j += 1; } return { jev: j, total: n }; };
const before = idShare((r, id) => (r.v9_ids.length ? SPLIT.assign[id] : 'jev'));
const after = idShare((r) => r.owner);
const conceptBefore = { jev: rows.filter((r) => r.v9_owner === 'jev').length, mixed: rows.filter((r) => r.v9_owner === 'mixed').length, sonnet: rows.filter((r) => r.v9_owner === 'sonnet').length };
const spend = fs.readFileSync(path.join(HERE, 'ledger.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.kind === 'actual').reduce((a, e) => a + e.usd, 0);
const tok = FILMS.reduce((a, s) => a + rj(path.join(HERE, 'out', `${s}.answers.json`)).input_tokens, 0);
const reqs = FILMS.reduce((a, s) => a + rj(path.join(HERE, 'out', `${s}.answers.json`)).requests.length, 0);
const METHOD = (() => { const ls = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n'); const a = ls.findIndex((l) => l.startsWith('// METHOD')); const b = ls.findIndex((l) => l.startsWith('import ')); return ls.slice(a, b).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'); })();

const result = { generated_at: new Date().toISOString(), method: METHOD, rule: RULE, thresholds: TH, sonnet_threshold: SONNET_T, magic_films: MAGIC, films: FILMS, spend_usd: spend, input_tokens: tok, requests: reqs, pooled_questions: POOL.length, candidates: CANDS.length, share: { before_ids: before, after_ids: after, concepts_before: conceptBefore, concepts_after: { jev: byOwner('jev').length, sonnet: byOwner('sonnet').length } }, rows,
  all_candidates: CANDS.map((cd) => ({ id: cd.id, concept: cd.concept, src: cd.src, kind: cd.kind, desc: cd.desc, res: RES.get(cd.id) })), sonnet: SRES };
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(result, null, 1));
export { result, rows, text };
console.log(JSON.stringify(result.share), 'spend', spend.toFixed(4), 'candidates', CANDS.length);
