#!/usr/bin/env node
// VERIFIER (round 9, adapted from v10_2/verify/recount-desc.mjs): recount the blind-judge verdicts in round8/out/descriptions.json (the judge itself is not re-run: no model
// calls) and check that the judged v10.2 texts/titles are exactly the ones shown in out102 tags, and the judged live
// texts/titles are exactly live built descriptions/titles. Also the plot-path items and Brave S003. Writes out/recount-desc.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8')); const r3 = (x) => Math.round(x * 1000) / 1000;
const d = rj(path.join(V, 'round9', 'out', 'descriptions.json'));
const K = ['accurate', 'partly', 'wrong', 'generic'];
const out = { per_film: {}, pooled: {} }; const all = [];
for (const f of d.per_film) {
  const slug = f.slug; const tags = rj(path.join(V, 'out103', `${slug}.tags.r1.json`)); const built = rj(path.join(V, 'round9', 'live', `${slug}.built.json`));
  const fl = tags.scenes.filter((s) => s.flagged);
  const shownT = new Map(fl.filter((s) => s.why?.text).map((s) => [s.id, s.why.text]));
  const shownTi = new Map(fl.filter((s) => s.why?.title && s.why.title !== 'Flagged scene').map((s) => [s.id, s.why.title]));
  const rows = f.rows.map((r) => ({ ...r, slug })); all.push(...rows);
  const vT = rows.filter((r) => r.sys === 'v10' && r.kind === 'text'); const vTi = rows.filter((r) => r.sys === 'v10' && r.kind === 'title');
  const lT = rows.filter((r) => r.sys === 'live' && r.kind === 'text'); const lTi = rows.filter((r) => r.sys === 'live' && r.kind === 'title');
  const mism = [];
  for (const [id, t] of shownT) { const r = vT.find((x) => x.scene === id); if (!r || r.text !== t) mism.push(`text ${id}`); }
  for (const r of vT) if (shownT.get(r.scene) !== r.text) mism.push(`judged text not shown ${r.scene}`);
  for (const [id, t] of shownTi) { const r = vTi.find((x) => x.scene === id); if (!r || r.text !== t) mism.push(`title ${id}`); }
  for (const r of vTi) if (shownTi.get(r.scene) !== r.text) mism.push(`judged title not shown ${r.scene}`);
  const liveD = new Map(built.scenes.filter((s) => s.description?.trim()).map((s) => [s.id.split(':').pop(), s.description]));
  const liveTi = new Map(built.scenes.filter((s) => s.title?.trim()).map((s) => [s.id.split(':').pop(), s.title]));
  for (const r of lT) if (liveD.get(r.scene) !== r.text) mism.push(`live text ${r.scene}`);
  for (const r of lTi) if (liveTi.get(r.scene) !== r.text) mism.push(`live title ${r.scene}`);
  const tal = (l) => Object.fromEntries(K.map((k) => [k, l.filter((x) => x.verdict === k).length]));
  out.per_film[slug] = { v_text: tal(vT), v_title: tal(vTi), live_text: tal(lT), live_title: tal(lTi), v_acc: r3(vT.filter((x) => x.verdict === 'accurate').length / vT.length), live_acc: r3(lT.filter((x) => x.verdict === 'accurate').length / lT.length),
    shown_texts: shownT.size, judged_v_texts: vT.length, shown_titles: shownTi.size, judged_v_titles: vTi.length, live_desc: liveD.size, judged_live_texts: lT.length, live_titles: liveTi.size, judged_live_titles: lTi.length, mismatches: mism,
    wrong: rows.filter((r) => r.sys === 'v10' && r.verdict === 'wrong').map((r) => `${r.kind} ${r.scene} [${r.source ?? r.title_source}]`),
    sources: vT.reduce((o, r) => ((o[r.source] = (o[r.source] ?? 0) + 1), o), {}) };
}
const vT = all.filter((r) => r.sys === 'v10' && r.kind === 'text'), lT = all.filter((r) => r.sys === 'live' && r.kind === 'text'), vTi = all.filter((r) => r.sys === 'v10' && r.kind === 'title'), lTi = all.filter((r) => r.sys === 'live' && r.kind === 'title');
const tal = (l) => Object.fromEntries(K.map((k) => [k, l.filter((x) => x.verdict === k).length]));
out.pooled = { v_text: tal(vT), v_acc: r3(tal(vT).accurate / vT.length), live_text: tal(lT), live_acc: r3(tal(lT).accurate / lT.length), v_title: tal(vTi), live_title: tal(lTi), live_title_acc: `${tal(lTi).accurate}/${lTi.length}` };
fs.writeFileSync(path.join(here, 'out', 'recount-desc.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 1));
