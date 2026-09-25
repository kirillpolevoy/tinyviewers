// Verifier helper (NO model calls, POST-HOC): re-runs select.js's pure selectRun on the saved r1 Jev
// answers under policy variants. Lion King results here are post-hoc and are NOT held-out evidence.
import fs from 'node:fs';
import { selectRun, loadPolicy } from '../select.js';
const base = loadPolicy();
const clone = (o) => JSON.parse(JSON.stringify(o));
const variants = {
  as_run: (cfg, items) => [cfg, items],
  film_items_immune_to_retold: (cfg, items) => [cfg, items.map((it) => (it.cancel ? { ...it, cancel: { ...it.cancel, retold: false } } : it))],
  retold_off: (cfg, items) => { cfg.modifier_act = 1.01; return [cfg, items]; },
  plus_threatens_harm_strong: (cfg, items) => { cfg.flag.strong_events.push('threatens_harm'); return [cfg, items.map((it) => (it.cancel ? { ...it, cancel: { ...it.cancel, retold: false } } : it))]; },
};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const run = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.jev.r1.json`, import.meta.url)));
  const moments = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.moments.r1.json`, import.meta.url)));
  const saved = JSON.parse(fs.readFileSync(new URL(`../out/${slug}.tags.r1.json`, import.meta.url)));
  const savedIds = saved.scenes.filter((s) => s.flagged).map((s) => s.id);
  let ref = null;
  for (const [name, fn] of Object.entries(variants)) {
    const [cfg, items] = fn(clone(base), clone(run.film_items ?? []));
    const out = selectRun({ ...run, film_items: items }, cfg, { moments });
    const ids = out.scenes.filter((s) => s.flagged).map((s) => s.id);
    if (!ref) { ref = ids; console.log(`== ${slug}: as_run flagged ${ids.length}; matches saved tags.r1: ${JSON.stringify(ids) === JSON.stringify(savedIds)}`); continue; }
    const add = ids.filter((i) => !ref.includes(i)), drop = ref.filter((i) => !ids.includes(i));
    console.log(`   ${name}: flagged ${ids.length} (+${add.join(',') || '-'} / -${drop.join(',') || '-'})`);
  }
}
