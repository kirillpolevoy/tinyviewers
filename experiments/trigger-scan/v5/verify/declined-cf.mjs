// Offline counterfactual for the two DECLINED, Lion-King-derived candidates, on top of policy v5.1.
// Flag sets only (r1). Not adopted: no dev-film evidence; Lion King rows are post-hoc.
import fs from 'node:fs';
import { selectRun, loadPolicy } from '../select.js';
const V5 = new URL('..', import.meta.url);
const base = loadPolicy(new URL('policy.json', V5).pathname);
const C = {
  threatens_harm_strong: (p) => { p.flag.strong_events = [...p.flag.strong_events, 'threatens_harm']; },
  threatens_exempt_from_retold: (p) => { p.film_specific.cancel_exempt = { threatens: ['retold'] }; },
};
for (const slug of ['nemo', 'monsters-inc', 'lion-king']) {
  const jev = JSON.parse(fs.readFileSync(new URL(`out/${slug}.jev.r1.json`, V5)));
  const ref = selectRun(structuredClone(jev), base).scenes.filter((s) => s.flagged).map((s) => s.id);
  for (const [name, f] of Object.entries(C)) {
    const p = structuredClone(base); f(p);
    const ids = selectRun(structuredClone(jev), p).scenes.filter((s) => s.flagged).map((s) => s.id);
    console.log(`${slug.padEnd(13)} ${name.padEnd(29)} flagged ${ref.length} -> ${ids.length} (+${ids.filter((x) => !ref.includes(x)).join(',') || '-'} / -${ref.filter((x) => !ids.includes(x)).join(',') || '-'})`);
  }
}
