#!/usr/bin/env node
// Round-6 diagnostic (evaluation only; copy of round5/fp-reasons.mjs, v10 in place of v9, plus a JSON file):
// for each v10 flagged scene, whether its skip contains >= 50% of any mapped should_flag human key item (hit)
// or not (miss); tallies flag reasons and who answered them (r.by: 'jev' or 'sonnet', set by select.js from
// merge.js provenance). Also the Jev share of flag reasons and the who-flags breakdown per film and pooled.
// Writes round6/out/who-flags.json.
import fs from 'node:fs';
import path from 'node:path';
import { union, shareInside } from '../refscore.js';
import { SCORED as HELD } from './spend.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const V10 = path.resolve(here, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tally = {}; const scenes = [];
for (const slug of HELD) {
  const key = rj(path.join(V10, '..', 'refs', `${slug}.key.json`));
  const items = key.items.filter((i) => i.source !== 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const tags = rj(path.join(V10, 'out10', `${slug}.tags.r1.json`));
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const U = union((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const inside = items.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= 0.5);
    const hit = inside.some((i) => i.should_flag === true);
    const tagOnly = inside.some((i) => i.should_flag === 'tag_only');
    const onlySonnet = s.flag_reasons.every((r) => r.by === 'sonnet'); const onlyJev = s.flag_reasons.every((r) => r.by === 'jev');
    scenes.push({ slug, id: s.id, hit, tagOnly, min: +((s.skip?.ms ?? 0) / 60000).toFixed(2), by: onlySonnet ? 'sonnet' : onlyJev ? 'jev' : 'both', reasons: s.flag_reasons.map((r) => `${r.id}/${r.by}`) });
    for (const r of s.flag_reasons) { const k = `${r.id}/${r.by}`; tally[k] ??= { hit: 0, miss: 0 }; tally[k][hit ? 'hit' : 'miss']++; }
  }
}
const byOf = (list, b) => { const x = list.filter((s) => s.by === b); return { scenes: x.length, hit: x.filter((s) => s.hit).length, hit_rate: x.length ? +(x.filter((s) => s.hit).length / x.length).toFixed(3) : null, skip_min: +x.reduce((a, s) => a + s.min, 0).toFixed(1), miss_min: +x.filter((s) => !s.hit).reduce((a, s) => a + s.min, 0).toFixed(1) }; };
const share = (list) => { const rs = list.flatMap((s) => s.reasons); const j = rs.filter((r) => r.endsWith('/jev')).length; return { reasons: rs.length, jev: j, sonnet: rs.length - j, jev_share: rs.length ? +(j / rs.length).toFixed(3) : null }; };
const summary = (list) => ({ flagged: list.length, hit: list.filter((s) => s.hit).length, reasons: share(list), jev_only: byOf(list, 'jev'), sonnet_only: byOf(list, 'sonnet'), both: byOf(list, 'both'), scenes_needing_jev: list.filter((s) => s.by !== 'sonnet').length });
const out = { generated_at: new Date().toISOString(), per_film: Object.fromEntries(HELD.map((slug) => [slug, summary(scenes.filter((s) => s.slug === slug))])), pooled: summary(scenes), reason_tally: tally, scenes };
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'who-flags.json'), JSON.stringify(out, null, 2));
console.log('pooled:', JSON.stringify(out.pooled));
for (const slug of HELD) console.log(slug, JSON.stringify(out.per_film[slug]));
console.log('misses:'); for (const s of scenes.filter((x) => !x.hit)) console.log(' ', s.slug, s.id, s.min, 'min', s.tagOnly ? '(tag_only item inside)' : '', s.reasons.join(' '));
console.log('reason tally (hit/miss), sorted by misses:'); for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].miss - a[1].miss)) console.log(' ', k, v.hit, v.miss);
