#!/usr/bin/env node
// v9 SPLIT, STAGE A (pure code over ../../v8/scorecard/scorecard.json; no model calls).
// Per v3 GROUP, pooled over all ten films (the scorecard's held-out 3 + dev 7; all ten are dev films for
// v9), Jev (v8 act tags) vs the LIVE Sonnet pipeline's asserted labels, on the HUMAN keys:
//   recall   = answered / items (counts summed over films)
//   precision= overlapping tagged scenes / tagged scenes (summed; the scorecard's strict proxy)
//   lift     = precision / the system's own base rate (scene-weighted over films). The scorecard notes
//              the raw proxy favours long scenes (live scenes are 1-2x longer and cover 19-46% of a
//              film); lift is its correction, so BOTH are reported and the rule uses BOTH.
// Rule (the brief): a group stays with Jev only if Jev's recall is not below live's AND Jev's
// precision is not below live's. "Not below" on precision = raw proxy not below OR lift not below
// (either correction); every other group is CONTESTED and goes to the same-scene measurement
// (stage B), where precision is compared on identical scenes and the raw proxy is fair.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SC = JSON.parse(fs.readFileSync(path.resolve(here, '../../v8/scorecard/scorecard.json'), 'utf8'));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const groups = Object.keys(SC.held_out.groups.jev.pooled);
const pooled = (sys, g) => {
  let items = 0, answered = 0, tagged = 0, hits = 0, baseNum = 0, baseDen = 0;
  for (const part of ['held_out', 'dev']) {
    for (const [slug, row] of Object.entries(SC[part].groups[sys].per_film ?? {})) {
      const x = row[g]; if (!x) continue;
      if (!SC[part].groups.live.per_film?.[slug]) continue; // pool only films both systems have (up has no live)
      const cov = SC.coverage[slug];
      const scenes = sys === 'jev' ? cov.jev_scenes : cov.live_scenes;
      if (!Number.isFinite(scenes)) continue;
      items += x.items; answered += x.answered; tagged += x.tagged_scenes;
      hits += Math.round((x.precision_proxy ?? 0) * x.tagged_scenes);
      if (Number.isFinite(x.base_rate)) { baseNum += x.base_rate * scenes; baseDen += scenes; }
    }
  }
  const precision = tagged ? hits / tagged : null; const base = baseDen ? baseNum / baseDen : null;
  return { items, answered, recall: items ? r3(answered / items) : null, tagged, hits, precision: r3(precision), base: r3(base), lift: precision != null && base ? r3(precision / base) : null };
};
const rows = groups.map((g) => {
  const j = pooled('jev', g); const l = pooled('live', g);
  const recallOk = (j.recall ?? 0) >= (l.recall ?? 0);
  const precRawOk = l.precision == null || (j.precision ?? 0) >= l.precision;
  const precLiftOk = l.lift == null || (j.lift ?? 0) >= l.lift;
  const verdict = recallOk && (precRawOk || precLiftOk) ? 'jev' : 'contested';
  return { group: g, jev: j, live: l, recall_ok: recallOk, precision_raw_ok: precRawOk, precision_lift_ok: precLiftOk, stage_a: verdict };
});
const out = { generated_at: new Date().toISOString(), source: 'v8/scorecard/scorecard.json (generated ' + SC.generated_at + ')', note: 'pooled over the 9 films both systems have (up has no live baseline)', rows };
fs.writeFileSync(path.join(here, 'stage-a.json'), JSON.stringify(out, null, 2));
console.log('group             | Jev rec (n)      | live rec (n)     | Jev prec / lift  | live prec / lift | stage A');
for (const r of rows) console.log(`${r.group.padEnd(17)} | ${String(r.jev.recall).padEnd(5)} (${r.jev.answered}/${r.jev.items})`.padEnd(38) + `| ${r.live.recall} (${r.live.answered}/${r.live.items})`.padEnd(19) + `| ${r.jev.precision} / ${r.jev.lift}`.padEnd(19) + `| ${r.live.precision} / ${r.live.lift}`.padEnd(19) + `| ${r.stage_a}`);
