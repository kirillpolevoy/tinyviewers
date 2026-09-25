#!/usr/bin/env node
// v9 SPLIT, STAGE B: Jev vs Sonnet on IDENTICAL scenes, per question, human keys (pure code, no calls).
//
//   node split/stage-b.mjs [--films a,b,...]      -> split/stage-b.json (+ a table on stdout)
//
// Scenes: v8's segmentation of each film (v8/out/<slug>.tags.r1.json bounds; v9 reuses it unchanged).
// Jev: v8's answers (v8/out/<slug>.jev.r1.json: every question on every scene). Sonnet: v9's
// out/<slug>.sonnetq.r1.json (the contested questions, split.json sonnet_asked). Both are read as a
// probability per (scene, question): Jev presence = max(lines, summary) as select.js; Sonnet = the
// sonnet-questions.js map. A question FIRES in a scene at t = 0.7 (policy act) unless select.js would
// cancel it there: the SAME scene modifiers (v8's retold / imagined / comic peril, from Jev's scores)
// and the item's cancel set apply to both models, so only the answer differs.
// Key items (scorecard rules): refs/<slug>.key.json, human-written, mapped, >= 1 category in the 13
// groups; window = gap window; a scene overlaps an item when they share > 0 ms.
//   recall(q)    = items in q's group with an overlapping scene where q fires / items in q's group
//   precision(q) = fired scenes overlapping an item in q's group / fired scenes (same scenes for both
//                  models, so the raw proxy is fair here; the scorecard's long-scene caveat is gone)
//   also: should_flag-only recall; the codex-rules items (model-written rule-1 / rule-2 moments) for
//   threatens_harm / plots_harm / child_frightened, reported apart.
// Group rows = the union of the group's ASKED questions for each model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, EVENTS, PRESENCE } from '../questions.js';
import { loadSplit } from '../split.js';
import { probOf, P_UNLISTED } from '../sonnet-questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '../..');
const V8OUT = path.join(TS, 'v8', 'out');
const V9OUT = path.resolve(here, '..', 'out');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ALL = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot', 'iron-giant', 'up', 'tangled', 'coco', 'how-to-train-your-dragon'];
const FILMS = opt('films', ALL.join(',')).split(',').filter((s) => fs.existsSync(path.join(V9OUT, `${s}.sonnetq.r1.json`)));
const GROUPS = new Set(['creatures_figures', 'objects_hazards', 'peril', 'violence', 'death', 'separation', 'injury', 'captivity', 'eerie', 'hostility', 'distress', 'animals', 'copyable']);
const ACT = 0.7;
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const div = (a, b) => (b ? r3(a / b) : null);
const overlaps = (s, w) => Math.min(s.end_ms, w[1]) - Math.max(s.start_ms, w[0]) > 0;
const split = loadSplit();
const ASKED = split.sonnet_asked;
const PRES = new Set(PRESENCE.map((p) => p.id));
const EVC = Object.fromEntries(EVENTS.map((e) => [e.id, e.cancel ?? {}]));
const RULE_Q = { threatens_harm: 'villain_threat', plots_harm: 'villain_threat', child_frightened: 'child_terrified' };

function keyItems(slug) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`));
  const prep = (i) => ({ id: i.id, sf: i.should_flag === true, marker: i.marker ?? null, laughs: !!i.played_for_laughs, cats: (i.categories ?? []).filter((c) => GROUPS.has(c)), w: [Number.isFinite(i.gap_start_ms) ? Math.min(i.start_ms, i.gap_start_ms) : i.start_ms, Number.isFinite(i.gap_end_ms) ? Math.max(i.end_ms, i.gap_end_ms) : i.end_ms] });
  const mapped = (i) => i.mappable && Number.isFinite(i.start_ms) && Number.isFinite(i.end_ms);
  return {
    human: k.items.filter((i) => i.source !== 'codex-rules' && i.human_written !== false && mapped(i)).map(prep).filter((i) => i.cats.length),
    codex: k.items.filter((i) => (i.source === 'codex-rules') && mapped(i)).map(prep),
  };
}

// per film: scenes with { p_jev[q], p_sonnet[q], blocked[q] }
function filmRows(slug) {
  const tags = rj(path.join(V8OUT, `${slug}.tags.r1.json`));
  const jev = new Map(rj(path.join(V8OUT, `${slug}.jev.r1.json`)).scenes.map((s) => [s.id, s.answers]));
  const son = rj(path.join(V9OUT, `${slug}.sonnetq.r1.json`));
  return tags.scenes.map((s) => {
    const a = jev.get(s.id) ?? {};
    const hasSummary = a.ps !== null && a.ps !== undefined;
    const mods = s.modifiers ?? {};
    const srow = son.scenes[s.id];
    const pj = {}; const ps = {}; const blocked = {};
    for (const q of ASKED) {
      pj[q] = PRES.has(q) ? Math.max(a.pl?.[q] ?? 0, hasSummary ? a.ps?.[q] ?? 0 : 0) : a.e?.[q] ?? 0;
      ps[q] = srow ? (srow[q] ? probOf(srow[q]) : P_UNLISTED) : null; // null = Sonnet has no answer for this scene
      blocked[q] = !PRES.has(q) && Object.keys(EVC[q] ?? {}).some((m) => EVC[q][m] && mods[m]?.on);
    }
    return { id: s.id, start_ms: s.start_ms, end_ms: s.end_ms, pj, ps, blocked };
  });
}

function score(sel, rowsByFilm, itemsByFilm, { itemFilter = () => true, groupOf = (q) => ITEMS[q].group } = {}) {
  // sel = list of questions (their union); model 'jev' | 'sonnet'
  const out = {};
  for (const model of ['jev', 'sonnet']) {
    let items = 0; let caught = 0; let itemsSf = 0; let caughtSf = 0; let fires = 0; let hits = 0;
    for (const slug of Object.keys(rowsByFilm)) {
      const rows = rowsByFilm[slug];
      const groups = new Set(sel.map(groupOf));
      const its = itemsByFilm[slug].filter((i) => itemFilter(i) && i.cats.some((g) => groups.has(g)));
      const firesIn = (r) => sel.filter((q) => { const p = model === 'jev' ? r.pj[q] : r.ps[q]; return p != null && !r.blocked[q] && p >= ACT; });
      for (const r of rows) {
        const f = firesIn(r);
        if (!f.length) continue;
        fires++;
        const fg = new Set(f.map(groupOf));
        if (its.some((i) => overlaps(r, i.w) && i.cats.some((g) => fg.has(g)))) hits++;
      }
      for (const i of its) {
        items++; if (i.sf) itemsSf++;
        const got = rows.some((r) => overlaps(r, i.w) && firesIn(r).some((q) => i.cats.includes(groupOf(q))));
        if (got) { caught++; if (i.sf) caughtSf++; }
      }
    }
    out[model] = { items, caught, recall: div(caught, items), items_sf: itemsSf, caught_sf: caughtSf, recall_sf: div(caughtSf, itemsSf), fires, hits, precision: div(hits, fires) };
  }
  return out;
}

const rowsByFilm = Object.fromEntries(FILMS.map((s) => [s, filmRows(s)]));
const keys = Object.fromEntries(FILMS.map((s) => [s, keyItems(s)]));
const human = Object.fromEntries(FILMS.map((s) => [s, keys[s].human]));

// "not worse" as the brief states it, with null handling: a model that never fires has no precision;
// then only recall decides (the other model's precision cannot be 'worse' than nothing, and a model
// that never fires cannot have better recall).
export function jevNotWorse(j, s) {
  const recallOk = (j.recall ?? 0) >= (s.recall ?? 0);
  const precOk = j.precision == null ? (s.fires === 0) : s.precision == null ? true : j.precision >= s.precision;
  return { recallOk, precOk, jev: recallOk && precOk };
}
const thin = (x) => Math.max(x.jev.caught, x.sonnet.caught) < 3 && Math.max(x.jev.fires, x.sonnet.fires) < 3;

const perQ = {};
for (const q of ASKED) {
  const x = score([q], rowsByFilm, human);
  const v = jevNotWorse(x.jev, x.sonnet);
  perQ[q] = { group: ITEMS[q].group, ...x, rule: v, thin: thin(x), verdict: v.jev ? 'jev' : 'sonnet' };
}
const byGroup = {};
for (const q of ASKED) (byGroup[ITEMS[q].group] ??= []).push(q);
const perG = {};
for (const [g, qs] of Object.entries(byGroup)) {
  const x = score(qs, rowsByFilm, human);
  const v = jevNotWorse(x.jev, x.sonnet);
  perG[g] = { questions: qs, ...x, rule: v, verdict: v.jev ? 'jev' : 'sonnet' };
}
// rule items (model-written codex-rules keys): rule-1 / rule-2 questions only
const codex = Object.fromEntries(FILMS.map((s) => [s, keys[s].codex.map((i) => ({ ...i, cats: [i.marker] }))]));
const ruleRows = {};
for (const [q, marker] of Object.entries(RULE_Q)) {
  if (!ASKED.includes(q)) continue;
  ruleRows[q] = score([q], rowsByFilm, codex, { itemFilter: (i) => i.marker === marker && !i.laughs, groupOf: () => marker });
}
const out = { generated_at: new Date().toISOString(), films: FILMS, act: ACT, asked: ASKED, questions: perQ, groups: perG, codex_rule_items: ruleRows };
fs.writeFileSync(path.join(here, 'stage-b.json'), JSON.stringify(out, null, 2));

const f = (m) => `${m.recall ?? '-'} (${m.caught}/${m.items}) sf ${m.recall_sf ?? '-'} | P ${m.precision ?? '-'} (${m.hits}/${m.fires})`;
console.log(`films: ${FILMS.join(', ')}`);
for (const [g, qs] of Object.entries(byGroup)) {
  const G = perG[g];
  console.log(`\n[${g}] GROUP  jev ${f(G.jev)}  ||  sonnet ${f(G.sonnet)}  -> ${G.verdict}`);
  for (const q of qs) { const x = perQ[q]; console.log(`  ${q.padEnd(21)} jev ${f(x.jev).padEnd(44)} || sonnet ${f(x.sonnet).padEnd(44)} -> ${x.verdict}${x.thin ? ' (thin)' : ''}`); }
}
for (const [q, x] of Object.entries(ruleRows)) console.log(`codex-rule ${q}: jev ${f(x.jev)} || sonnet ${f(x.sonnet)}`);
