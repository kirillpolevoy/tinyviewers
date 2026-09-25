#!/usr/bin/env node
// Round-7 PRE-REGISTERED ALTERNATIVE (v10/prereg-tierA-gating.json, registered before any round-6 held-out output
// was seen), scored OFFLINE on the same v10.1 answers (evaluation only; no model calls; frozen files untouched).
// Rule (verbatim intent): a scene may be FLAGGED only by a reason from a tier-A Jev concept or a Sonnet-owned
// concept; tier-B/C Jev concepts stay tags. Everything else (thresholds, modifiers, spans, descriptions) unchanged.
// Implementation: a flag reason is KEPT when r.by === 'sonnet', or r.by === 'jev' and its concept is tier A
// (universal id in tierA_jev_concepts; a film item as `film:<type>` of its film_items entry). A flagged scene with
// no kept reason is unflagged (skip and parent text removed); a kept scene keeps its v10.1 skip spans and parent
// text as they are (offline approximation: moment spans were chosen with all reasons present).
//   node round7/tierA.mjs [films]  -> round7/tierA/<slug>.tags.r1.json + round7/out/tierA-gating.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { outFor } from './spend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.resolve(here, '..', '..', 'v10', 'prereg-tierA-gating.json');
const pre = JSON.parse(fs.readFileSync(PRE, 'utf8'));
const TIER_A = new Set(pre.tierA_jev_concepts);
const SONNET = new Set(pre.sonnet_concepts);
const FILMS = (process.argv[2] ?? 'frozen,zootopia,good-dinosaur').split(',');
const OUT = path.join(here, 'tierA');
fs.mkdirSync(OUT, { recursive: true });
const report = { generated_at: new Date().toISOString(), prereg: { file: path.relative(path.resolve(here, '..'), PRE), sha256: crypto.createHash('sha256').update(fs.readFileSync(PRE)).digest('hex'), registered_at_utc: pre.registered_at_utc }, films: {} };
for (const slug of FILMS) {
  const dir = outFor(slug);
  const tags = JSON.parse(fs.readFileSync(path.join(dir, `${slug}.tags.r1.json`), 'utf8'));
  const items = tags.film_items ?? JSON.parse(fs.readFileSync(path.join(dir, `${slug}.jev.r1.json`), 'utf8')).film_items ?? [];
  const concept = (r) => { const it = items.find((x) => x.id === r.id); return it ? `film:${it.type}` : r.id; };
  const keep = (r) => r.by === 'sonnet' || (r.by === 'jev' && TIER_A.has(concept(r)));
  const rows = []; const sonnetOutside = new Set(); const unknownBy = [];
  for (const s of tags.scenes) {
    if (!s.flagged) continue;
    for (const r of s.flag_reasons) { if (r.by === 'sonnet' && !SONNET.has(r.id)) sonnetOutside.add(r.id); if (r.by !== 'sonnet' && r.by !== 'jev') unknownBy.push(`${s.id}:${r.id}:${r.by}`); }
    const kept = s.flag_reasons.filter(keep); const dropped = s.flag_reasons.filter((r) => !keep(r));
    rows.push({ id: s.id, kept: kept.map((r) => `${concept(r)}/${r.by}`), dropped: dropped.map((r) => `${concept(r)}/${r.by}`), unflagged: kept.length === 0, skip_min: +((s.skip?.ms ?? 0) / 60000).toFixed(2) });
    if (!kept.length) { s.gated_out = { was_reasons: s.flag_reasons, was_skip: s.skip ?? null }; s.flagged = false; s.flag_reasons = []; s.skip = null; s.why = null; } else if (dropped.length) { s.gated_dropped_reasons = dropped; s.flag_reasons = kept; }
  }
  tags.variant = { name: pre.name, prereg: report.prereg, note: 'offline re-score of the v10.1 answers; kept scenes keep their v10.1 spans and text' };
  fs.writeFileSync(path.join(OUT, `${slug}.tags.r1.json`), JSON.stringify(tags, null, 2));
  report.films[slug] = { flagged_asrun: rows.length, flagged_gated: rows.filter((r) => !r.unflagged).length, unflagged: rows.filter((r) => r.unflagged).map((r) => `${r.id} (${r.skip_min} min; ${r.dropped.join(' ')})`), reasons_dropped_in_kept_scenes: rows.filter((r) => !r.unflagged && r.dropped.length).length, sonnet_reasons_outside_prereg_list: [...sonnetOutside], unknown_by: unknownBy };
}
fs.writeFileSync(path.join(here, 'out', 'tierA-gating.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.films, null, 1));
