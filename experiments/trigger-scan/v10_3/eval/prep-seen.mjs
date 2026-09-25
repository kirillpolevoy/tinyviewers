#!/usr/bin/env node
// v10.3 SEEN-FILM TEXT RUN, step 1 (no model calls): the v10.3 flags and skip spans of the 19 seen films (select.js +
// policy.json over the stored answers + out103/dev mortal answers + the merged moment answers of out103/seen, with the
// span bridge), written as a v10.3 run directory out103/seen/ that describe.js / check-describe.js / describe2.js read
// (V103_OUT=out103/seen): <slug>.segments.json and <slug>.jev.r1.json copied from the stored run, <slug>.tags.r1.json =
// the v10.3 selection.
// REUSE (saves Sonnet spend, changes nothing a parent would read): a flagged scene whose describe.js CONTEXT is the
// same as in v10.2's text run (same flagged-for phrases, same L / W / T source ids) gets v10.2's describe answer
// for it (same prompt, same inputs), re-checked by the v10.3 code checks (validate.js: the fixed quotation rule);
// every other flagged scene is asked by describe.js --resume. Seeds out103/seen/<slug>.describe.r1.json.
//   node eval/prep-seen.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as S103 from '../select.js';
import { loadSplit } from '../split.js';
import { buildContexts } from '../describe.js';
import { transcriptGrams, enforceQuoteRule, clampWords, judgementWords } from '../validate.js';
import { sourcesFile } from '../env.js';
import { FILMS, loadFilm, runSystem, resolveFile, mortalFile, v102Dir, rj, V103 } from './seen-lib.mjs';

const SPLIT = loadSplit();
const POLICY = S103.loadPolicy(path.join(V103, 'policy.json'));
const OUT = path.join(V103, 'out103', 'seen');
fs.mkdirSync(OUT, { recursive: true });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let reusedN = 0; let askN = 0;
for (const slug of FILMS) {
  const F = loadFilm(slug);
  const merged = rj(path.join(OUT, `${slug}.moments.r1.json`));
  const r = runSystem(F, S103, POLICY, { used: SPLIT.sonnet_used, resolve: rj(resolveFile(slug)), split: SPLIT, mortal: rj(mortalFile(slug)), saved: merged });
  for (const f of [`${slug}.segments.json`, `${slug}.jev.r1.json`]) fs.copyFileSync(path.join(F.dir, f), path.join(OUT, f));
  const tags = { ...r.tags, seen_run: { note: 'v10.3 select over the stored answers + out103/dev mortal answers (eval/prep-seen.mjs); skip spans respanned from the merged moment answers (out103/seen), span bridge applied', from: path.relative(V103, F.dir) } };
  fs.writeFileSync(path.join(OUT, `${slug}.tags.r1.json`), JSON.stringify(tags, null, 2));
  // describe reuse: identical contexts only
  const SRC = rj(sourcesFile(slug));
  const ctxs = buildContexts({ seg: F.seg, tags, cues: F.cues, src: { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast }, items: F.items });
  const old = rj(path.join(v102Dir(slug), `${slug}.describe.r1.json`));
  const grams = transcriptGrams(F.cues.map((c) => c.text), 9);
  const recheck = (x, maxWords) => {
    if (!x) return x;
    const q = enforceQuoteRule(x.text, grams); let t = q.text; const problems = [...(x.problems ?? [])];
    if (q.violations.length) problems.push(`quote_rule_v103:${q.violations.map((v) => v.words).join(',')}`);
    const c = clampWords(t, maxWords); if (c.trimmed) t = c.text;
    return { ...x, text: t, problems, judgement_words: judgementWords(t), ok: !!t && x.cites.length > 0 && !judgementWords(t).length };
  };
  const scenes = {};
  for (const c of ctxs) {
    const o = old.scenes?.[c.id];
    const ev = { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) };
    if (o?.returned && same(o.flagged_for, c.flagged_for) && same(o.reasons, c.reasons) && same(o.evidence_ids, ev)) {
      const sentences = o.sentences.map((x) => recheck(x, 30)).filter((x) => x.ok);
      const title = o.title ? recheck(o.title, 9) : null;
      scenes[c.id] = { ...o, title: title?.ok ? title : null, sentences, reused_from_v102: true };
    }
  }
  reusedN += Object.keys(scenes).length; askN += ctxs.length - Object.keys(scenes).length;
  fs.writeFileSync(path.join(OUT, `${slug}.describe.r1.json`), JSON.stringify({ film: F.seg.film, version: 'describe-v10.2 (reused, eval/prep-seen.mjs)', run: 'r1', calls: [], cost_usd: 0, flagged: ctxs.length, scenes }, null, 2));
  console.log(`${slug}: flagged ${r.flagged.length}/${r.tags.scenes.length}; describe reused ${Object.keys(scenes).length}, to ask ${ctxs.length - Object.keys(scenes).length}`);
}
console.log(`total: reused ${reusedN}, to ask ${askN}`);
