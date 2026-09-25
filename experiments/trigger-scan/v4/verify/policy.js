// Verifier: re-run select.js policy variants over saved Jev answers (pure code, no calls) and
// measure against the loader baseline. Prints to stdout only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRun, loadConfig } from '../select.js';
import * as L from '../../../../scene-api/load.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const V4 = path.resolve(here, '..'); const TS = path.resolve(V4, '..');
const ctx = await L.openExperiment(TS);
const v2map = L.buildV2Map(ctx.taxonomy);
const vocabIds = new Set(L.buildVocabulary(ctx.taxonomy).items.map((i) => i.id));
const ov = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const base0 = loadConfig(path.join(V4, 'thresholds.json'));
const NOT_SCARY_PRESENCE = ['monster_creature', 'animal_creature', 'mask', 'snake_reptile', 'doll_puppet', 'robot_machine_being'];
const WEAK_EVENTS = ['terrified', 'parent_searching', 'child_separated', 'jump_scare', 'slapstick', 'mocked', 'excluded', 'despair', 'abandoned', 'crying', 'unseen_threat', 'family_in_danger', 'dangerous_act'];
const variants = {
  asis: (c) => c,
  no_friendly_presence: (c) => ({ ...c, parents_care_presence: c.parents_care_presence.filter((x) => !NOT_SCARY_PRESENCE.includes(x)) }),
  events_085: (c) => ({ ...c, parents_care_presence: c.parents_care_presence.filter((x) => !NOT_SCARY_PRESENCE.includes(x)), overrides: Object.fromEntries(ALL_EVENTS.map((e) => [`e.${e}`, { act: 0.85 }])) }),
  nofriendly_strong_events: (c) => ({ ...c, parents_care_presence: c.parents_care_presence.filter((x) => !NOT_SCARY_PRESENCE.includes(x)), flag_events: ALL_EVENTS.filter((e) => !WEAK_EVENTS.includes(e)) }),
};
let ALL_EVENTS = [];
const sevGate = (min) => (s) => s.flagged && (s.severity?.['5-7']?.level ?? 0) >= min;
for (const slug of ['nemo', 'monsters-inc']) {
  const inputs = L.readFilmInputs(slug, ctx);
  const built = L.buildFilmFrom(inputs, { srt: ctx.srt, v2map, vocabIds });
  const base = built.scenes.map((s) => ({ id: s.id.split(':').pop(), s: s.start_ms, e: s.end_ms, sev: Math.max(s.severity_5_7, s.severity_8_10) }));
  const run = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.jev.r1.json`)));
  const seg = JSON.parse(fs.readFileSync(path.join(V4, 'out', `${slug}.segments.json`)));
  ALL_EVENTS = Object.keys(run.scenes[0].answers.e);
  const total = run.scenes.reduce((a, s) => a + s.end_ms - s.start_ms, 0);
  console.log(`\n== ${slug}: ${run.scenes.length} scenes, ${(total / 60000).toFixed(1)} min in scenes; baseline ${base.length} scenes (${base.filter((b) => b.sev >= 2).length} with sev>=2)`);
  const report = (name, flaggedScenes) => {
    const fl = flaggedScenes; const mins = fl.reduce((a, s) => a + s.end_ms - s.start_ms, 0) / 60000;
    const cov = (b) => fl.reduce((a, s) => a + ov(s.start_ms, s.end_ms_ext, b.s, b.e), 0) / (b.e - b.s);
    const covered = base.filter((b) => cov(b) >= 0.5);
    const coveredHi = base.filter((b) => b.sev >= 2 && cov(b) >= 0.5);
    const outside = fl.filter((s) => !base.some((b) => ov(s.start_ms, s.end_ms_ext, b.s, b.e) > 0));
    console.log(`${name.padEnd(34)} flagged ${String(fl.length).padStart(2)}  ${mins.toFixed(1).padStart(5)} min  base covered ${covered.length}/${base.length}  sev>=2 covered ${coveredHi.length}/${base.filter((b) => b.sev >= 2).length}  zero-overlap flags ${outside.length}`);
    return fl;
  };
  const withExt = (scenes) => scenes.map((s, i) => ({ ...s, end_ms_ext: scenes[i + 1]?.start_ms ?? s.end_ms }));
  for (const [name, f] of Object.entries(variants)) {
    const out = selectRun(run, f(structuredClone(base0)), seg);
    const sc = withExt(out.scenes);
    report(name, sc.filter((s) => s.flagged));
    if (name === 'asis' || name === 'no_friendly_presence') { report(name + '+sev5-7>=2', sc.filter(sevGate(2))); report(name + '+sev5-7>=3', sc.filter(sevGate(3))); }
  }
}
