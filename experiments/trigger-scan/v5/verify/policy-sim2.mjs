// Offline: candidate select-only fixes over saved r1/r2 answers. Monkey-patches flagRule behaviour by post-filtering reasons.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRun, loadPolicy, expected } from '../select.js';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const ctx = await L.openExperiment(path.resolve(V5, '..'));
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
function post(out, run, fixes) {
  const A = new Map(run.scenes.map((s) => [s.id, s.answers]));
  for (const s of out.scenes) {
    if (!s.flagged) continue;
    const a = A.get(s.id);
    const dangerExp = expected(a.s?.danger);
    s.flag_reasons = s.flag_reasons.filter((r) => {
      if (fixes.childNeedsDanger && r.rule === 'film_child_in_danger' && dangerExp < 2) return false;
      if (fixes.machineNeedsAct && r.id === 'dangerous_machine' && !(a.e.caught_in_hazard >= 0.7 || (a.ps?.dangerous_machine ?? 0) >= 0.7)) return false;
      if (fixes.reanimatedNeedsDanger && r.id === 'reanimated_dead' && dangerExp < 2) return false;
      return true;
    });
    s.flagged = s.flag_reasons.length > 0;
  }
  return out;
}
const fixes = { childNeedsDanger: true, machineNeedsAct: true, reanimatedNeedsDanger: true };
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), a: s.start_ms, b: s.end_ms }));
  for (const runId of ['r1', 'r2']) {
    const run = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.jev.${runId}.json`)));
    const variants = {
      as_run: () => selectRun(structuredClone(run), loadPolicy()),
      recommended: () => {
        const p = loadPolicy(); p.modifier_act = 0.95; p.retold_cancel.danger_absent_mass = 0.8;
        const r = structuredClone(run); r.film_items = r.film_items.filter((it) => !(it.type === 'threatens' && it.why === 'changes'));
        return post(selectRun(r, p), run, fixes);
      },
    };
    const res = {};
    for (const [name, fn] of Object.entries(variants)) {
      const out = fn();
      const fl = out.scenes.filter((s) => s.flagged);
      res[name] = new Set(fl.map((s) => s.id));
      const cov = base.filter((b) => fl.reduce((acc, s) => acc + ov(s.start_ms, s.end_ms, b.a, b.b), 0) / Math.max(1, b.b - b.a) >= 0.5);
      const outside = fl.filter((s) => base.reduce((acc, b) => acc + ov(s.start_ms, s.end_ms, b.a, b.b), 0) === 0).map((s) => s.id);
      console.log(`${slug.padEnd(13)} ${runId} ${name.padEnd(12)} flagged ${fl.length} ${(fl.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / 60000).toFixed(1)} min | baseline covered ${cov.length}/${base.length} | 0-overlap flags: ${outside.join(',')}`);
    }
    console.log(`      +[${[...res.recommended].filter((x) => !res.as_run.has(x))}] -[${[...res.as_run].filter((x) => !res.recommended.has(x))}]`);
  }
}
