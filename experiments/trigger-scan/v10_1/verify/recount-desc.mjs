#!/usr/bin/env node
// VERIFIER: recount description / title / code-built-reason tallies from the judge rows (round7/out/descriptions.json,
// reasons-truth.json) and the shown text straight from the tags (no-text scenes, 'Flagged scene' titles), as run and
// under my own tier-A gating (verify/recompute.mjs logic). Also checks the judged rows match the text actually on the
// tags (a row judged but not shown, or shown but not judged). No model calls. Writes verify/out/recount-desc.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const V101 = path.resolve(here, '..'); const TS = path.resolve(V101, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const outFor = (slug) => (slug === 'good-dinosaur' ? path.join(V101, 'round7', 'gd-out') : path.join(V101, 'out101'));
const pre = rj(path.join(TS, 'v10', 'prereg-tierA-gating.json')); const TA = new Set(pre.tierA_jev_concepts);
const D = rj(path.join(V101, 'round7', 'out', 'descriptions.json'));
const T = rj(path.join(V101, 'round7', 'out', 'reasons-truth.json'));
const K = ['accurate', 'partly', 'wrong', 'generic'];
const tally = (rows) => Object.fromEntries([...K, 'missing'].map((k) => [k, rows.filter((r) => (r.verdict ?? 'missing') === k).length]));
const share = (t) => +(t.accurate / (t.accurate + t.partly + t.wrong + t.generic)).toFixed(3);

const films = ['frozen', 'zootopia', 'good-dinosaur'];
const res = {};
for (const slug of films) {
  const tags = rj(path.join(outFor(slug), `${slug}.tags.r1.json`));
  const fi = tags.film_items ?? [];
  const concept = (r) => { const it = fi.find((x) => x.id === r.id); return it ? `film:${it.type}` : r.id; };
  const flagged = tags.scenes.filter((s) => s.flagged);
  const gated = new Set(flagged.filter((s) => s.flag_reasons.some((r) => r.by === 'sonnet' || (r.by === 'jev' && TA.has(concept(r))))).map((s) => s.id));
  const asrun = new Set(flagged.map((s) => s.id));
  const rows = D.per_film.find((f) => f.slug === slug).rows;
  const truth = T.per_film.find((f) => f.slug === slug).rows;
  // consistency: every v10 text shown on the tags is judged, and vice versa
  const shownText = flagged.filter((s) => s.why?.text).map((s) => s.id);
  const judgedText = rows.filter((r) => r.sys === 'v10' && (r.kind === 'text' || r.kind === 'reason')).map((r) => r.scene);
  const notJudged = shownText.filter((id) => !judgedText.includes(id));
  const judgedNotShown = [...new Set(judgedText)].filter((id) => !shownText.includes(id));
  const out = {};
  for (const [name, set] of [['asrun', asrun], ['gated', gated]]) {
    const v = rows.filter((r) => r.sys === 'v10' && set.has(r.scene));
    const txt = tally(v.filter((r) => r.kind === 'text')); const ttl = tally(v.filter((r) => r.kind === 'title'));
    const sc = flagged.filter((s) => set.has(s.id));
    out[name] = {
      flagged: sc.length, no_text: sc.filter((s) => !s.why?.text).map((s) => s.id), flagged_scene_title: sc.filter((s) => (s.why?.title ?? s.title ?? '') === 'Flagged scene' || !s.why?.title).map((s) => s.id),
      text: txt, text_accurate_share: share(txt), title: ttl,
      reasons_desc_judge: tally(v.filter((r) => r.kind === 'reason')),
      truth: Object.fromEntries(['true', 'false', 'unclear'].map((k) => [k, truth.filter((x) => set.has(x.scene) && x.verdict === k).length])),
      false_code_built: truth.filter((x) => set.has(x.scene) && x.verdict === 'false').map((x) => `${x.scene} [${x.kind}] ${x.text}`),
      wrong_titles: v.filter((r) => r.kind === 'title' && r.verdict === 'wrong').map((r) => r.scene), wrong_texts: v.filter((r) => r.kind === 'text' && r.verdict === 'wrong').map((r) => r.scene),
    };
  }
  const lt = tally(rows.filter((r) => r.sys === 'live' && r.kind === 'text')); const ltt = tally(rows.filter((r) => r.sys === 'live' && r.kind === 'title'));
  res[slug] = { ...out, live_text: lt, live_text_accurate_share: share(lt), live_title: ltt, consistency: { shown_text_not_judged: notJudged, judged_not_shown: judgedNotShown } };
}
const sumT = (sl, v, k) => sl.reduce((a, s) => { const t = res[s][v][k]; for (const x of Object.keys(t)) a[x] = (a[x] ?? 0) + t[x]; return a; }, {});
const pooled = {};
for (const [n, sl] of [['pair', ['frozen', 'zootopia']], ['all', films]]) for (const v of ['asrun', 'gated']) {
  const t = sumT(sl, v, 'text'); const lt = sl.reduce((a, s) => { for (const x of Object.keys(res[s].live_text)) a[x] = (a[x] ?? 0) + res[s].live_text[x]; return a; }, {});
  const ti = sumT(sl, v, 'title'); const lti = sl.reduce((a, s) => { for (const x of Object.keys(res[s].live_title)) a[x] = (a[x] ?? 0) + res[s].live_title[x]; return a; }, {});
  pooled[`${n}_${v}`] = { text: t, share: share(t), live_text: lt, live_share: share(lt), title: ti, live_title: lti, no_text: sl.reduce((a, s) => a + res[s][v].no_text.length, 0), flagged: sl.reduce((a, s) => a + res[s][v].flagged, 0), flagged_scene_title: sl.reduce((a, s) => a + res[s][v].flagged_scene_title.length, 0), false_code_built: sl.flatMap((s) => res[s][v].false_code_built.map((x) => `${s}:${x}`)) };
}
fs.writeFileSync(path.join(here, 'out', 'recount-desc.json'), JSON.stringify({ per_film: res, pooled }, null, 2));
console.log(JSON.stringify(pooled, null, 1));
for (const s of films) console.log(s, JSON.stringify({ asrun: { ...res[s].asrun }, gated: { text: res[s].gated.text, share: res[s].gated.text_accurate_share, false: res[s].gated.false_code_built }, live: res[s].live_text, live_title: res[s].live_title, consistency: res[s].consistency }));
