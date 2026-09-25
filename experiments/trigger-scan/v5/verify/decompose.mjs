// Offline: split each film's old -> new change into (1) the flag-policy changes and (2) the span
// changes (scene bounds over wordless gaps + begin-side padding). No model calls. Uses the saved
// r1 Jev answers and the as-run moment answers (out/asrun). Lion King rows are post-hoc.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
import { unionIntervals, totalLength, intersectLength } from '../../score.js';
import { selectRun, loadPolicy, usableFilmItems } from '../select.js';
import { respanScenes } from '../moments.js';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const ctx = await L.openExperiment(path.resolve(V5, '..'));
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const oldP = loadPolicy(path.join(V5, 'out/asrun/policy.asrun.json'));
const newP = loadPolicy(path.join(V5, 'policy.json'));
const flagsOld_spansNew = structuredClone(oldP); flagsOld_spansNew.scene_bounds = newP.scene_bounds; flagsOld_spansNew.moments = newP.moments;
const flagsNew_spansOld = structuredClone(newP); delete flagsNew_spansOld.scene_bounds; flagsNew_spansOld.moments = oldP.moments;
const variants = { as_run: oldP, span_changes_only: flagsOld_spansNew, flag_changes_only: flagsNew_spansOld, v5_1: newP };
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), a: s.start_ms, b: s.end_ms }));
  const jev = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.jev.r1.json`)));
  const saved = JSON.parse(fs.readFileSync(path.join(V5, 'out/asrun', `${slug}.moments.r1.json`)));
  const cues = parseSrt(fs.readFileSync(path.resolve(V5, '..', 'data', `${slug}.srt`), 'utf8'));
  console.log(`\n${slug}${slug === 'lion-king' ? ' (POST-HOC: held-out evidence is the as_run row only)' : ''}`);
  for (const [name, cfg] of Object.entries(variants)) {
    const t0 = selectRun(structuredClone(jev), cfg);
    const items = usableFilmItems(jev.film_items ?? [], cfg);
    const mom = { scenes: respanScenes({ tags: t0, saved, cues, items, cfg }) };
    const t = selectRun(structuredClone(jev), cfg, { moments: mom });
    const fl = t.scenes.filter((s) => s.flagged);
    const skipU = unionIntervals(fl.flatMap((s) => s.skip.spans.map((x) => ({ startMs: x.start_ms, endMs: x.end_ms }))));
    const flU = unionIntervals(fl.map((s) => ({ startMs: s.start_ms, endMs: s.end_ms })));
    const next = new Map(t.scenes.map((s, i) => [s.id, t.scenes[i + 1]?.start_ms ?? s.end_ms]));
    const flExt = unionIntervals(fl.map((s) => ({ startMs: s.start_ms, endMs: Math.max(s.end_ms, next.get(s.id)) })));
    const cov = (U) => base.filter((b) => intersectLength(U, [[b.a, b.b]]) / Math.max(1, b.b - b.a) >= 0.5).length;
    const notAsked = Object.entries(mom.scenes).filter(([, m]) => String(m.why ?? '').startsWith('not_asked')).map(([id]) => id);
    console.log(`  ${name.padEnd(18)} flagged ${String(fl.length).padStart(2)} | skip ${(totalLength(skipU) / 60000).toFixed(2)} of ${(totalLength(flU) / 60000).toFixed(2)} flagged-scene min | baseline covered by skip ${cov(skipU)}/${base.length}, by flagged ${cov(flExt)}/${base.length} | whole-scene ${Object.values(mom.scenes).filter((m) => m.method !== 'moments').length}${notAsked.length ? ` (not asked ${notAsked.join(',')})` : ''}`);
  }
}
