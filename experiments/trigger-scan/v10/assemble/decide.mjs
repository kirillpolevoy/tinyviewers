#!/usr/bin/env node
// v10 ASSEMBLY, step 1: pick the owner and the Jev phrasing of every concept from the phrasing tournament
// (jevfirst/tournament/results.json, pool.json). Pure code over stored files; no model calls.
//
//   node assemble/decide.mjs   ->  assemble/decisions.json  (+ a table on stdout)
//
// ELIGIBILITY (the brief's question rules, lint.js): a candidate is eligible only when EVERY Jev question
// it asks passes lintNoul (one question, explicit yes AND no criteria, one condition, no presupposition,
// no degree, no indirection, no seen-film entity). Scores against the keys decide only among eligible
// candidates. v9 event wordings with no yes-criterion are therefore not eligible; v9 presence wordings
// (PL_YES / PL_NO criteria) are.
//
// OWNER RULE (Jev first; the user: "with questions rewritten we would rely on Jev more"; Sonnet is the
// fallback only where it is measurably better). Precision = the tournament's lower bound (keys list
// notable moments), recall = key items of the concept group caught; thresholds 0.6 / 0.7 / 0.8; Sonnet
// at 0.7 on its stored v9 answers.
//   A  RELIABLE  some eligible candidate has precision >= 0.70 on >= 4 fires, magic films (coco,
//                book-of-life, princess-and-the-frog) >= 0.60 or no fire there, and, where Sonnet was
//                measured (>= 4 fires), recall >= Sonnet's - 0.05  ->  Jev, the one with the highest
//                recall (then precision, then fewer questions).
//   S  SONNET    Sonnet measured (>= 4 fires) and no eligible candidate ties it (>= 4 fires, precision
//                >= Sonnet's - 0.05 AND recall >= Sonnet's - 0.05)  ->  Sonnet (the fallback).
//   B  TIES      Sonnet measured and an eligible candidate ties or beats it  ->  Jev, the tying candidate
//                with the highest recall (then precision).
//   C  NO SONNET Sonnet never asked, or < 4 Sonnet fires (nothing to fall back to)  ->  Jev. Reference =
//                the v9 wording at 0.7 as v9 ran it. Among eligible candidates with >= 4 fires and recall
//                >= reference - 0.05: the highest Wilson lower bound of precision (then recall). If none
//                keeps the recall: the eligible candidate with the highest recall. If no eligible
//                candidate fires 4 times: the eligible one with the most hits (then fewest fires).
// Multi-id concepts: Sonnet takes only the v9 ids it was measured on (vehicle_crash: not vehicle_accident).
// CAVEAT (unchanged from the tournament): all 13 films are seen films; the winners are picked on the same
// data they are scored on, so every number here is optimistic until a frozen held-out run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintNoul } from '../lint.js';
import { keysOf } from '../combine.js';
import { loadData, score, sonnetSpec, fixrunComplete } from './score-lib.mjs';
import { buildFixes } from './fixrun/fixes.mjs';
import { buildQuestions, filmQuestions, PRESENCE, EVENTS, DERIVED } from '../../v9/questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T = path.resolve(here, '../jevfirst/tournament');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const R = rj(path.join(T, 'results.json'));
const { pool: POOL, concepts: CONCEPTS } = rj(path.join(T, 'pool.json'));
const CLAUDE = rj(path.resolve(here, '../jevfirst/claude-concepts.json'));
const ASTRA = rj(path.resolve(here, '../jevfirst/astra-concepts.json'));
const RULE = { minFires: 4, minPrec: 0.7, minMagicPrec: 0.6, tol: 0.05 };
const TH = ['0.6', '0.7', '0.8'];
const PRES = new Set(PRESENCE.map((p) => p.id));
const EVS = new Set(EVENTS.map((e) => e.id));

// ---------------------------------------------------------------------------------------------
// Question definitions: every Jev question a candidate asks, keyed as the tournament answers are keyed
// ---------------------------------------------------------------------------------------------
const qkey = (x) => `${x.src}:${x.sub}@${x.state}`;
const DEF = new Map(); // key -> { key, src, state, q, film, concept }
for (const x of POOL) DEF.set(qkey(x), { key: qkey(x), src: x.src, state: x.state, q: x.q, film: x.film ?? null, concept: x.concept, sub: x.sub, n: x.n ?? null, channel: x.channel });
// v9 wording (the control): pl.<id> on the lines state (L), ps.<id> / e.<id> on v9's context state (V9C)
const V9Q = buildQuestions({ channels: ['pl', 'ps', 'e'] });
for (const [k, q] of Object.entries(V9Q)) {
  const key = k.startsWith('pl.') ? `V:${k}@L` : `V:${k}@V9C`;
  if (!DEF.has(key)) DEF.set(key, { key, src: 'V', state: k.startsWith('pl.') ? 'L' : 'V9C', q, film: null, concept: null, sub: k });
}
const V9FILM = filmQuestions([{ id: '{item}', type: 'threatens', who: '<name>', name: '<name>' }, { id: '{item}', type: 'child_in_danger', who: '<name>', name: '<name>' }, { id: '{item}', type: 'danger', who: '<name>', name: '<name>' }], { channels: ['fe'] });

// ---------------------------------------------------------------------------------------------
// Candidate -> expression over question keys (film templates keep '#{item}' in the key)
// ---------------------------------------------------------------------------------------------
const Q = (key) => ({ q: key });
const MAX = (...a) => ({ max: a });
const MIN = (...a) => ({ min: a });
const tmplKey = (x) => `${x.src}:${x.sub}#{item}@${x.state}`;
const FILM_TYPE = { 'film:threatens': 'threatens', 'film:child_in_danger': 'child_in_danger', 'film:danger': 'danger' };

function v9Expr(id) {
  if (PRES.has(id)) return MAX(Q(`V:pl.${id}@L`), Q(`V:ps.${id}@V9C`));
  if (EVS.has(id)) return Q(`V:e.${id}@V9C`);
  throw new Error(`v9 id ${id}?`);
}
const cq = (sub) => { const x = POOL.find((y) => y.src === 'C' && y.sub === sub && !y.film); if (!x) throw new Error(`no Claude phrasing ${sub}`); return Q(qkey(x)); };
const claudeIds = (concept) => POOL.filter((x) => x.src === 'C' && x.concept === concept && !x.film).map((x) => x.sub);
const DIES = () => ({ max: [cq('dies.a'), cq('dies.b'), cq('dead_body.a'), cq('dead_body.b'), { gate: MAX(cq('dies.a'), cq('dies.b'), cq('seriously_ill.a')), at: 0.4, then: cq('dies.c') }] });
const CLAUDE_BUNDLE = {
  witch_sorcerer: () => cq('witch_sorcerer.a'),
  dies: DIES,
  loved_one_dies: () => ({ gate: DIES(), at: 0.4, then: MAX(cq('loved_one_dies.a'), cq('loved_one_dies.b')) }),
  parent_death_learned: () => MAX(cq('parent_death_learned.a'), { gate: DIES(), at: 0.4, then: cq('parent_death_learned.b') }),
  grieving: () => MAX(cq('grieving.a'), cq('grieving.b'), { gate: MAX(DIES(), cq('believed_dead.a'), cq('believed_dead.b')), at: 0.4, then: cq('crying.a') }),
  child_taken: () => MAX(cq('child_taken.a'), cq('child_taken.b')),
  afraid_for_safety: () => MAX(cq('afraid_for_safety.a'), cq('afraid_for_safety.b'), { score: 'danger', at: 2, then: cq('afraid_for_safety.c') }),
  creature_threat: () => MAX(cq('creature_threat.a'), cq('creature_threat.b'), cq('ghost_spirit.c'), cq('spider_insect.b'), MIN(cq('creature_threat.c'), cq('afraid_for_safety.a')), { each: { type: 'danger', group: 'creatures_figures' }, of: Q('C:film_danger.a#{item}@LSnl') }),
  child_in_danger: () => MAX(cq('child_in_danger.a'), { each: { type: 'child_in_danger' }, of: Q('C:film_child_in_danger.a#{item}@LSnl') }),
  appears_suddenly: () => MIN(cq('appears_suddenly.a'), cq('startled.a')),
};

// Astra combine expressions (score.mjs parseExpr, same grammar); a sub folded into the wording = true
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
const astraSubKeys = (sub) => POOL.filter((x) => x.src === 'A' && x.sub === sub).map((x) => (x.film ? tmplKey(x) : qkey(x)));
function astraBundle(astraConcept) {
  const a = ASTRA.concepts.find((c) => c.concept === astraConcept);
  const ph = a.phrasings[0];
  const subs = POOL.filter((x) => x.src === 'A' && x.id === ph.id);
  const byN = new Map();
  for (const x of subs) { if (!byN.has(x.n)) byN.set(x.n, []); byN.get(x.n).push(x.film ? tmplKey(x) : qkey(x)); }
  const conv = (e) => (e.n != null ? (byN.has(e.n) ? MAX(...byN.get(e.n).map(Q)) : { one: 1 }) : e.and ? MIN(...e.and.map(conv)) : MAX(...e.or.map(conv)));
  return conv(parseExpr(ph.combine));
}

function exprOf(cd, concept) {
  const id = cd.id;
  const film = FILM_TYPE[concept] ?? null;
  const wrapFilm = (e) => e; // film concepts are evaluated per generated item (score-lib instances)
  if (id.startsWith('V:')) {
    const rest = id.slice(2);
    if (rest === 'jump_scare') return MIN(v9Expr('appears_suddenly'), v9Expr('startled'));
    if (rest.startsWith('or:')) { const c = CONCEPTS.find((x) => x.key === rest.slice(3)); return MAX(...c.v9_ids.map(v9Expr)); }
    if (rest.startsWith('film:')) return Q('V:fe.{item}@V9C');
    if (DEF.has(id)) return Q(id); // the 19 v9 ids asked in the tournament (V:pl.x@L, V:ps.x@V9C, V:e.x@V9C)
    return v9Expr(rest);
  }
  if (id.startsWith('C:bundle:')) {
    const k = id.slice(9);
    if (k === 'film:threatens') return null; // uses v9 film presence answers + two universal questions; not carried into v10
    return CLAUDE_BUNDLE[k]();
  }
  if (id.startsWith('C:or:')) {
    const k = id.slice(5);
    if (k === 'film:threatens') return wrapFilm(MAX(Q('C:film_threatens.a#{item}@S'), Q('C:film_threatens.b#{item}@L')));
    return MAX(...claudeIds(k).map(cq));
  }
  if (id.startsWith('A:bundle:')) return wrapFilm(astraBundle(id.slice(9)));
  if (/^[CA]:pruned@/.test(id)) {
    const list = cd.desc.split(': ').slice(1).join(': ').split(', ');
    const src = id[0];
    return wrapFilm(MAX(...list.map((s) => {
      const [sub, state] = s.split('@');
      if (state === 'max') return MAX(...astraSubKeys(sub).map(Q));
      const x = POOL.find((y) => y.src === src && y.sub === sub && y.state === state);
      return Q(x.film ? tmplKey(x) : qkey(x));
    })));
  }
  if (id.startsWith('A:') && id.endsWith('@max')) return wrapFilm(MAX(...astraSubKeys(id.slice(2, -4)).map(Q)));
  // single pooled phrasing
  const x = POOL.find((y) => qkey(y) === id);
  if (!x) throw new Error(`unknown candidate ${id}`);
  return wrapFilm(Q(x.film ? tmplKey(x) : id));
}

// ---------------------------------------------------------------------------------------------
// Lint of a candidate; lint-fix variants (fixrun/fixes.mjs) substituted for failing keys
// ---------------------------------------------------------------------------------------------
const FIXES = buildFixes();
const FIX_OF = new Map(FIXES.map((f) => [f.fixes, f]));
for (const f of FIXES) DEF.set(f.key, { key: f.key, src: f.src, state: f.state, q: f.q, film: null, concept: f.concept, sub: f.sub, fix_of: f.fixes });

/** The question definition of a key (film templates: the template, '#{item}' in its key). */
export function defOf(key) {
  if (DEF.has(key)) return DEF.get(key);
  if (key === 'V:fe.{item}@V9C') return { key, src: 'V', state: 'V9C', q: V9FILM['fe.{item}'], template: true };
  if (key.includes('#{item}')) {
    const plain = key.replace('#{item}', '');
    if (DEF.has(plain)) return { ...DEF.get(plain), key, template: true };
  }
  return null;
}
export const SLOTS = ['<name>', '<danger>', '<villain>', '<child>', '{NAME}', '{DANGER}'];
function lintKeys(keys) {
  const fails = {};
  for (const k of keys) { const d = defOf(k); const f = d ? lintNoul(d.q, { slots: SLOTS }) : ['unknown_question']; if (f.length) fails[k] = f; }
  return fails;
}
const subst = (e, map) => {
  if (!e || typeof e !== 'object') return e;
  if (e.q !== undefined) return map.has(e.q) ? { q: map.get(e.q) } : e;
  const o = { ...e };
  for (const k of ['max', 'min']) if (o[k]) o[k] = o[k].map((x) => subst(x, map));
  for (const k of ['gate', 'then', 'of']) if (o[k]) o[k] = subst(o[k], map);
  return o;
};

// ---------------------------------------------------------------------------------------------
// Score every candidate (and its lint-fix variant) with score-lib; verify score-lib reproduces the
// tournament's own numbers for every original candidate
// ---------------------------------------------------------------------------------------------
const FIX_MODE = process.argv.includes('--strict') ? 'none' : fixrunComplete() ? 'measured' : 'proxy';
const DATA = loadData({ fix: FIX_MODE });
const CK = Object.fromEntries(CONCEPTS.map((c) => [c.key, c]));
const specOf = (concept, expr) => ({ expr, film: FILM_TYPE[concept] ?? null, group: CK[concept].group });
const same = (a, b) => a.fires === b.fires && a.hits === b.hits && a.items === b.items && a.caught === b.caught;
const mismatches = [];
const cands = [];
for (const cd of R.all_candidates) {
  const expr = exprOf(cd, cd.concept);
  if (!expr) { cands.push({ ...cd, expr: null, keys: [], fails: { '(not expressible)': ['reads v9 film-presence answers'] }, eligible: false, res: cd.res, variant: null }); continue; }
  const ts = cd.id.includes(':pruned@') ? [cd.id.split(':pruned@')[1].split(':')[0]] : TH;
  const res = {};
  for (const t of ts) {
    res[t] = score(specOf(cd.concept, expr), Number(t), DATA);
    if (cd.res[t] && (!same(res[t].all, cd.res[t].all) || !same(res[t].magic, cd.res[t].magic))) mismatches.push(`${cd.id}@${t}: tournament ${JSON.stringify(cd.res[t].all)} vs ${JSON.stringify(res[t].all)}`);
  }
  const keys = [...keysOf(expr)];
  const fails = lintKeys(keys);
  cands.push({ id: cd.id, concept: cd.concept, src: cd.src, kind: cd.kind, desc: cd.desc, expr, keys, fails, eligible: !Object.keys(fails).length, res, measured: true });
  // lint-fix variant: every failing key has a fix and the fixed keys pass
  if (Object.keys(fails).length && Object.keys(fails).every((k) => FIX_OF.has(k)) && FIX_MODE !== 'none') {
    const map = new Map(Object.keys(fails).map((k) => [k, FIX_OF.get(k).key]));
    const e2 = subst(expr, map);
    const k2 = [...keysOf(e2)];
    const f2 = lintKeys(k2);
    if (!Object.keys(f2).length) {
      const r2 = {};
      for (const t of ts) r2[t] = score(specOf(cd.concept, e2), Number(t), DATA);
      cands.push({ id: `${cd.id}+fix`, concept: cd.concept, src: `${cd.src}+`, kind: cd.kind, desc: `${cd.desc} [lint-fixed: ${[...map.values()].join(', ')}]`, expr: e2, keys: k2, fails: {}, eligible: true, res: r2, measured: FIX_MODE === 'measured', fixed: [...map.entries()].map(([a, b]) => ({ from: a, to: b })) });
    }
  }
}
if (mismatches.length) { console.error(`score-lib does NOT reproduce the tournament for ${mismatches.length} candidate-thresholds:\n${mismatches.slice(0, 20).join('\n')}`); process.exit(1); }

// ---------------------------------------------------------------------------------------------
// Owner rule
// ---------------------------------------------------------------------------------------------
const wilson = (k, n, z = 1.96) => { if (!n) return -1; const p = k / n; const d = 1 + (z * z) / n; const c = p + (z * z) / (2 * n); const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)); return (c - m) / d; };
const reliable = (o) => o.all.fires >= RULE.minFires && o.all.precision >= RULE.minPrec && (!o.magic.fires || o.magic.precision >= RULE.minMagicPrec);
const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);
const fmt = (a) => (a ? `${a.hits}/${a.fires}${a.fires ? ` = ${pct(a.precision)}` : ''}` : '-');
const brief = (a) => a && { fires: a.fires, hits: a.hits, items: a.items, caught: a.caught, precision: a.precision == null ? null : +a.precision.toFixed(4), recall: a.recall == null ? null : +a.recall.toFixed(4) };

function choose(row, pool) {
  const concept = row.concept;
  const opts = pool.flatMap((c) => Object.entries(c.res).map(([t, r]) => ({ c, t: Number(t), all: r.all, magic: r.magic, w: wilson(r.all.hits, r.all.fires), n: c.keys.length })));
  const son = row.sonnet ? score(sonnetSpec(row.sonnet.ids, CK[concept].group), 0.7, DATA) : null;
  const S = son?.all ?? null;
  const sonM = !!S && S.fires >= RULE.minFires;
  const byRecall = (a, b) => b.all.recall - a.all.recall || b.all.precision - a.all.precision || a.n - b.n || (a.c.measured === b.c.measured ? 0 : a.c.measured ? -1 : 1);
  const A = opts.filter((o) => reliable(o) && (!sonM || o.all.recall >= S.recall - RULE.tol)).sort(byRecall);
  const ties = sonM ? opts.filter((o) => o.all.fires >= RULE.minFires && o.all.precision >= S.precision - RULE.tol && o.all.recall >= S.recall - RULE.tol).sort(byRecall) : [];
  let tier; let pick = null; let ref = null;
  if (A.length) { tier = 'A'; pick = A[0]; }
  else if (sonM && !ties.length) tier = 'S';
  else if (sonM) { tier = 'B'; pick = ties[0]; }
  else {
    tier = 'C';
    const refId = concept === 'appears_suddenly' ? 'V:jump_scare' : FILM_TYPE[concept] ? `V:${concept}` : `V:${row.v9_ids.at(-1)}`;
    const rc = cands.find((c) => c.id === refId);
    ref = rc ? { id: refId, all: rc.res['0.7'].all, magic: rc.res['0.7'].magic } : null;
    const four = opts.filter((o) => o.all.fires >= RULE.minFires);
    const keep = four.filter((o) => !ref || o.all.recall >= ref.all.recall - RULE.tol).sort((a, b) => b.w - a.w || b.all.recall - a.all.recall || a.n - b.n);
    pick = keep[0] ?? [...four].sort(byRecall)[0] ?? [...opts].sort((a, b) => b.all.hits - a.all.hits || a.all.fires - b.all.fires || a.n - b.n)[0] ?? null;
  }
  return { tier, pick, ref, son };
}

const defsOf = (keys) => Object.fromEntries(keys.map((k) => { const d = defOf(k); return [k, { state: d.state, src: d.src, template: !!d.template || k.includes('{item}'), ...(d.fix_of ? { fix_of: d.fix_of } : {}), q: d.q }]; }));
const decisions = [];
for (const row of R.rows) {
  const concept = row.concept;
  const all = cands.filter((c) => c.concept === concept);
  // appears_suddenly is the derived jump_scare = AND(appears_suddenly, startled) (questions.js DERIVED, select.js,
  // test/v10-questions.test.js); its two v9 component events are Jev-tagged from the pick's own keys
  // (targets.mjs), so a pick must contain an e.<id> key for BOTH components. Structural, not a tuning choice:
  // without it the measured run picked C:startled.a alone (one half), leaving both component ids untagged
  // (split.js refuses that). Added 2026-09-25 with the measured lint-fix run, before the freeze.
  const needKeys = concept === 'appears_suddenly' ? row.v9_ids : [];
  const el = all.filter((c) => c.eligible && needKeys.every((id) => c.keys.some((k) => k.includes(`e.${id}@`))));
  const main = choose(row, el);
  const strict = choose(row, el.filter((c) => c.measured)); // measured wordings only (no lint-fix proxies)
  const { tier, pick, ref, son } = main;
  const sonIds = new Set(row.sonnet?.ids ?? []);
  const ids = row.v9_ids.length ? row.v9_ids : [concept];
  const idOwner = Object.fromEntries(ids.map((id) => [id, tier === 'S' ? (sonIds.has(id) ? 'sonnet' : 'jev_v9') : 'jev']));
  const tb = cands.find((c) => c.id === row.best?.id);
  decisions.push({
    concept, group: row.group, v9_ids: row.v9_ids, film: FILM_TYPE[concept] ?? null, v9_owner: row.v9_owner, tournament_owner: row.owner,
    tier, owner: tier === 'S' ? 'sonnet' : 'jev', id_owner: idOwner,
    jev: pick && { id: pick.c.id, src: pick.c.src, kind: pick.c.kind, desc: pick.c.desc, t: pick.t, all: brief(pick.all), magic: brief(pick.magic), wilson_lo: +pick.w.toFixed(3), measured: pick.c.measured, fixed: pick.c.fixed ?? null, questions: pick.c.keys, expr: pick.c.expr, question_defs: defsOf(pick.c.keys) },
    reference_v9_at_07: ref && { id: ref.id, all: brief(ref.all), magic: brief(ref.magic) },
    sonnet: son && { ids: row.sonnet.ids, partial: row.sonnet.partial, at_07: brief(son.all), magic: brief(son.magic) },
    strict_measured_only: { tier: strict.tier, owner: strict.tier === 'S' ? 'sonnet' : 'jev', jev: strict.pick && { id: strict.pick.c.id, t: strict.pick.t, all: brief(strict.pick.all), magic: brief(strict.pick.magic) } },
    tournament_best: tb && { id: tb.id, t: row.best.t, all: brief(row.best.all), eligible: tb.eligible, lint_fails: tb.fails },
    eligible_candidates: el.length, candidates: all.length,
  });
}
// v9 ids of a Sonnet concept that Sonnet was never measured on stay with Jev at their v9 wording
for (const d of decisions) {
  for (const [id, o] of Object.entries(d.id_owner)) {
    if (o !== 'jev_v9') continue;
    let c = cands.find((x) => x.id === `V:${id}+fix`) ?? cands.find((x) => x.id === `V:${id}`);
    d.extra_jev = [...(d.extra_jev ?? []), { v9_id: id, id: c.id, t: 0.7, all: brief(c.res['0.7'].all), magic: brief(c.res['0.7'].magic), measured: c.measured, eligible: c.eligible, questions: c.keys, expr: c.expr, question_defs: defsOf(c.keys) }];
  }
}

const out = { generated_at: new Date().toISOString(), rule: RULE, fix_mode: FIX_MODE, fix_note: FIX_MODE === 'proxy' ? 'The lint-fix variants (assemble/fixrun/fixes.mjs) were NOT measured: the run on 2026-09-25 got HTTP 402 (no TypeSafe credits) on every request and spent $0. A variant scores with its original wording\'s stored answers (a PROXY); decisions that rest on a proxy say measured:false. strict_measured_only is the same rule over measured wordings only.' : FIX_MODE === 'measured' ? 'lint-fix variants measured (assemble/fixrun/out)' : 'lint-fix variants excluded (--strict)', verified: `score-lib reproduced the tournament's fires/hits/items/caught for all ${R.all_candidates.length} candidates at every threshold`, source: { results: 'jevfirst/tournament/results.json', generated_at: R.generated_at }, decisions };
fs.writeFileSync(path.join(here, FIX_MODE === 'none' ? 'decisions.strict.json' : 'decisions.json'), JSON.stringify(out, null, 1));
const count = (t) => decisions.filter((d) => d.tier === t).length;
for (const d of decisions) {
  const j = d.jev;
  console.log(`${d.concept.padEnd(22)} ${d.tier} ${d.owner.padEnd(6)} ${j ? `${j.id}${j.measured ? '' : ' (PROXY)'} @${j.t} P ${fmt(j.all)} R ${pct(j.all.recall)} magic ${fmt(j.magic)}` : ''}${d.sonnet ? ` | S ${fmt(d.sonnet.at_07)} R ${pct(d.sonnet.at_07.recall)}` : ''}${d.reference_v9_at_07 ? ` | v9@0.7 ${fmt(d.reference_v9_at_07.all)} R ${pct(d.reference_v9_at_07.all.recall)}` : ''} [${d.eligible_candidates}/${d.candidates}]${d.strict_measured_only.owner !== d.owner || d.strict_measured_only.jev?.id !== j?.id ? ` {strict: ${d.strict_measured_only.owner} ${d.strict_measured_only.jev?.id ?? ''}}` : ''}${d.extra_jev ? ` +${d.extra_jev.map((x) => `${x.v9_id}:${x.id}`).join(',')}` : ''}`);
}
console.log(out.verified);
console.log({ fix_mode: FIX_MODE, A: count('A'), B: count('B'), C: count('C'), S: count('S'), jev: decisions.filter((d) => d.owner === 'jev').length, sonnet: decisions.filter((d) => d.owner === 'sonnet').length, strict_jev: decisions.filter((d) => d.strict_measured_only.owner === 'jev').length, proxies_used: decisions.filter((d) => d.jev && !d.jev.measured).length });
