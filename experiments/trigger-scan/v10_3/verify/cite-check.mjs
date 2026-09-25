#!/usr/bin/env node
// VERIFIER (round 9, own code): every shown v10.3 sentence / title on the three fresh films is a Jev-verified check record
// from the attempt it came from (1: why/describe, 2: why2/describe2 ['a2:' keys], 3: why3/describe3 for titles), whose
// cites are all inside that attempt's evidence ids; shown text == concatenation of shown sentences; no code-built text;
// every 'L' cite is a cue inside the scene (or its stated evidence window). Writes out/cite-check.json.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const opt = (f) => (fs.existsSync(f) ? rj(f) : { scenes: {} });
const res = {};
for (const slug of ['kung-fu-panda', 'onward', 'croods']) {
  const O = path.join(V, 'out103');
  const tags = rj(path.join(O, `${slug}.tags.r1.json`));
  const desc = ['describe', 'describe2', 'describe3'].map((k) => opt(path.join(O, `${slug}.${k}.r1.json`)));
  const why = ['why', 'why2', 'why3'].map((k) => opt(path.join(O, `${slug}.${k}.r1.json`)));
  const bad = []; let sent = 0, titles = 0; const byAttempt = { text: {}, title: {} }; const lineCitesOut = [];
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const w = s.why ?? {};
    const E = (a) => { const ev = desc[a].scenes?.[s.id]?.evidence_ids ?? {}; return new Set([...(ev.lines ?? []), ...(ev.w ?? []), ...(ev.t ?? [])]); };
    const CK = (a) => new Map((why[a].scenes?.[s.id]?.checked ?? []).map((c) => [c.key, c]));
    const shown = (w.sentences ?? []).map((k) => { const a = k.startsWith('a2:') ? 1 : 0; const key = a ? k.slice(3) : k; return { k, a, c: CK(a).get(key), E: E(a) }; });
    for (const x of shown) {
      sent++; byAttempt.text[x.a + 1] = (byAttempt.text[x.a + 1] ?? 0) + 1;
      if (!x.c || x.c.final !== 'verified' || !x.c.cites?.length || !x.c.cites.every((ci) => x.E.has(ci))) bad.push(`${s.id}:${x.k} not verified/cited`);
      for (const ci of x.c?.cites ?? []) if (ci[0] === 'L') { const n = Number(ci.slice(1)); if (n < s.start_cue - 3 || n > s.end_cue + 3) lineCitesOut.push(`${s.id}:${x.k}:${ci} (scene cues ${s.start_cue}-${s.end_cue})`); }
    }
    if (w.text && w.text !== shown.map((x) => x.c?.text).join(' ')) bad.push(`${s.id}: text != sentences`);
    if (!w.text && shown.length) bad.push(`${s.id}: sentences but no text`);
    if (/Flagged because/i.test(w.text ?? '') || ['plain_reason', 'described+reason'].includes(w.source)) bad.push(`${s.id}: code-built text`);
    if (w.title_source === 'sonnet_verified') {
      titles++; const a = (w.title_attempt ?? 1) - 1; byAttempt.title[a + 1] = (byAttempt.title[a + 1] ?? 0) + 1;
      const t = CK(a).get(`${s.id}.title`); const Ea = E(a);
      if (!t || t.final !== 'verified' || t.text !== w.title || !t.cites?.length || !t.cites.every((x) => Ea.has(x))) bad.push(`${s.id}: title (attempt ${a + 1}) not verified/cited`);
    } else if (w.title && w.title !== 'Flagged scene') bad.push(`${s.id}: non-Sonnet title shown (${w.title_source})`);
  }
  res[slug] = { shown_sentences: sent, shown_titles: titles, by_attempt: byAttempt, problems: bad, line_cites_outside_scene: lineCitesOut };
}
fs.writeFileSync(path.join(here, 'out', 'cite-check.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 1));
