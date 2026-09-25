// Offline policy simulation over saved Jev answers (r1). No model calls. Reads scene-api/load.js read-only (as compare.js does).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRun, loadPolicy } from '../select.js';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const TS = path.resolve(V5, '..');
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const variants = {
  as_run: (p) => p,
  plus_threatens_harm: (p) => { p.flag.strong_events.push('threatens_harm'); return p; },
  no_changes_threatens: (p) => p, // handled on items
  both: (p) => { p.flag.strong_events.push('threatens_harm'); return p; },
  no_retold_cancel: (p) => { p.modifier_act = 1.01; return p; },
  retold_strict_095_08: (p) => { p.modifier_act = 0.95; p.retold_cancel.danger_absent_mass = 0.8; return p; },
  no_retold_plus_threat: (p) => { p.modifier_act = 1.01; p.flag.strong_events.push('threatens_harm'); return p; },
};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const run = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.jev.r1.json`)));
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), title: s.title, a: s.start_ms, b: s.end_ms }));
  for (const [name, f] of Object.entries(variants)) {
    const pol = f(structuredClone(loadPolicy()));
    const r = structuredClone(run);
    if (name === 'no_changes_threatens' || name === 'both') r.film_items = r.film_items.filter((it) => !(it.type === 'threatens' && it.why === 'changes'));
    const out = selectRun(r, pol);
    const fl = out.scenes.filter((s) => s.flagged);
    const cov = base.filter((b) => fl.reduce((acc, s) => acc + ov(s.start_ms, s.end_ms, b.a, b.b), 0) / Math.max(1, b.b - b.a) >= 0.5);
    const outside = fl.filter((s) => base.reduce((acc, b) => acc + ov(s.start_ms, s.end_ms, b.a, b.b), 0) === 0).map((s) => s.id);
    const mins = fl.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / 60000;
    console.log(`${slug.padEnd(13)} ${name.padEnd(22)} flagged ${fl.length}/${out.scenes.length} ${mins.toFixed(1)} min | baseline covered(>=50% by flagged scenes) ${cov.length}/${base.length} | flagged w/ 0 baseline overlap: ${outside.join(',')}`);
    if (name !== 'as_run') {
      const asRun = selectRun(structuredClone(run), loadPolicy());
      const was = new Set(asRun.scenes.filter((s) => s.flagged).map((s) => s.id));
      const now = new Set(fl.map((s) => s.id));
      console.log(`      +[${[...now].filter((x) => !was.has(x)).join(',')}] -[${[...was].filter((x) => !now.has(x)).join(',')}]`);
    }
  }
}
