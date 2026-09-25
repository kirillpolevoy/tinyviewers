#!/usr/bin/env node
// VERIFIER: every shown v10.2 sentence / title is a verified check record whose cites are all in the scene's evidence
// ids, the shown text is exactly the concatenation of the shown sentences, and no code-built text is shown. Also: which
// shown texts came through the plot path, and whether they passed v8's claims.js placement. Writes out/cite-check.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const res = {};
for (const slug of ['incredibles', 'big-hero-6', 'brave']) {
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`)); const why = rj(path.join(V, 'out102', `${slug}.why.r1.json`)); const desc = rj(path.join(V, 'out102', `${slug}.describe.r1.json`));
  const bad = []; const plot = []; let sent = 0, titles = 0;
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const w = s.why; const run = why.scenes[s.id]; const ev = desc.scenes[s.id]?.evidence_ids ?? {}; const E = new Set([...(ev.lines ?? []), ...(ev.w ?? []), ...(ev.t ?? [])]);
    const ck = new Map((run?.checked ?? []).map((c) => [c.key, c]));
    const shown = (w.sentences ?? []).map((k) => ck.get(k));
    shown.forEach((c, i) => { sent++; if (!c || c.final !== 'verified' || !c.cites?.length || !c.cites.every((x) => E.has(x))) bad.push(`${s.id}:${w.sentences[i]}`); if (c?.via === 'plot') plot.push(`${s.id}:${c.key} placement=${c.placement}`); });
    if (w.text && w.text !== shown.map((c) => c?.text).join(' ')) bad.push(`${s.id}: text != sentences`);
    if (/Flagged because/i.test(w.text ?? '')) bad.push(`${s.id}: code-built reason shown`);
    if (w.title_source === 'sonnet_verified') { titles++; const t = ck.get(`${s.id}.title`); if (!t || t.final !== 'verified' || t.text !== w.title || !t.cites.every((x) => E.has(x))) bad.push(`${s.id}: title`); if (t?.via === 'plot') plot.push(`${s.id}:title placement=${t.placement}`); }
    else if (w.title !== 'Flagged scene') bad.push(`${s.id}: non-Sonnet title shown (${w.title_source})`);
  }
  res[slug] = { shown_sentences: sent, shown_titles: titles, problems: bad, plot_path_shown: plot, verified_via_plot_all: why.verified_via_plot };
}
fs.writeFileSync(path.join(here, 'out', 'cite-check.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 1));
