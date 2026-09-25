// Offline, DEV FILMS ONLY (Nemo, Monsters, Inc.): each candidate select-only policy change, alone and
// combined, over the saved r1/r2 Jev answers. No model calls. Lion King is not read here: a change is
// adopted on this evidence and then applied unchanged to Lion King.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRun, loadPolicy } from '../select.js';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V5 = path.resolve(here, '..');
const ctx = await L.openExperiment(path.resolve(V5, '..'));
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const asrun = loadPolicy(path.join(V5, 'out/asrun/policy.asrun.json'));
const C = {
  retold: (p) => { p.retold_cancel.act = 0.95; p.retold_cancel.danger_absent_mass = 0.8; },
  threat_exempt: (p) => { p.film_specific = { ...(p.film_specific ?? {}), cancel_exempt: { threatens: ['retold'] } }; },
  drop_changes: (p) => { p.film_specific = { ...(p.film_specific ?? {}), drop_generated: { threatens: ['changes'] } }; },
  machine_gate: (p) => { p.flag.requires.dangerous_machine = { any: [{ event: 'caught_in_hazard' }, { source: ['summary', 'both'] }] }; },
  child_danger: (p) => { p.flag.requires.film_child_in_danger = { score: 'danger', min_expected: 2.0 }; },
  reanimated_danger: (p) => { p.flag.requires.reanimated_dead = { score: 'danger', min_expected: 2.0 }; },
  threatens_harm: (p) => { p.flag.strong_events = [...p.flag.strong_events, 'threatens_harm']; },
};
const combos = { ...Object.fromEntries(Object.keys(C).map((k) => [k, [k]])), all_but_threatens_harm: Object.keys(C).filter((k) => k !== 'threatens_harm') };
for (const slug of ['nemo', 'monsters-inc']) {
  const built = L.buildFilmFrom(L.readFilmInputs(slug, ctx), { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), title: s.title, a: s.start_ms, b: s.end_ms }));
  for (const runId of ['r1', 'r2']) {
    const run = JSON.parse(fs.readFileSync(path.join(V5, 'out', `${slug}.jev.${runId}.json`)));
    const flagged = (cfg) => selectRun(structuredClone(run), cfg).scenes.filter((s) => s.flagged);
    const cover = (fl) => base.filter((b) => fl.reduce((acc, s) => acc + ov(s.start_ms, s.end_ms, b.a, b.b), 0) / Math.max(1, b.b - b.a) >= 0.5).length;
    const ref = flagged(asrun);
    const refIds = new Set(ref.map((s) => s.id));
    console.log(`\n${slug} ${runId}: as-run flagged ${ref.length}, baseline covered by flagged scenes ${cover(ref)}/${base.length}`);
    for (const [name, keys] of Object.entries(combos)) {
      const p = structuredClone(asrun); keys.forEach((k) => C[k](p));
      const fl = flagged(p); const ids = new Set(fl.map((s) => s.id));
      const add = fl.filter((s) => !refIds.has(s.id)).map((s) => { const bs = base.filter((b) => ov(s.start_ms, s.end_ms, b.a, b.b) > 0).map((b) => `${b.id} ${b.title}`); return `${s.id}[${bs.join(' / ') || 'NO BASELINE'}]`; });
      const drop = ref.filter((s) => !ids.has(s.id)).map((s) => s.id);
      const reasonChanges = fl.filter((s) => refIds.has(s.id)).map((s) => { const r0 = ref.find((x) => x.id === s.id).flag_reasons.map((r) => r.id); const r1 = s.flag_reasons.map((r) => r.id); const lost = r0.filter((x) => !r1.includes(x)); const got = r1.filter((x) => !r0.includes(x)); return lost.length || got.length ? `${s.id}(${got.map((x) => '+' + x).concat(lost.map((x) => '-' + x)).join(' ')})` : null; }).filter(Boolean);
      console.log(`  ${name.padEnd(22)} flagged ${fl.length} covered ${cover(fl)}/${base.length} | add ${add.join('; ') || '-'} | drop ${drop.join(',') || '-'} | reasons ${reasonChanges.join(' ') || '-'}`);
    }
  }
}
