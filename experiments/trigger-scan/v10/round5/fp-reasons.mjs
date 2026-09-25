#!/usr/bin/env node
// Round-5 diagnostic (evaluation only): for each v9 flagged scene, whether its skip contains >= 50% of any
// mapped should_flag human key item (hit) or not (miss); tallies flag reasons and who answered them.
import fs from 'node:fs';
import path from 'node:path';
import { union, shareInside } from '../refscore.js';
import { HELD } from './spend.mjs';
const V9 = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tally = {}; const scenes = [];
for (const slug of HELD) {
  const key = rj(path.join(V9, '..', 'refs', `${slug}.key.json`));
  const items = key.items.filter((i) => i.source !== 'codex-rules' && i.mappable && Number.isFinite(i.start_ms));
  const tags = rj(path.join(V9, 'out', `${slug}.tags.r1.json`));
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
const by = (b) => { const x = scenes.filter((s) => s.by === b); return `${x.filter((s) => s.hit).length}/${x.length} hit, ${x.filter((s) => !s.hit).reduce((a, s) => a + s.min, 0).toFixed(1)} min in misses`; };
console.log('flagged scenes by who flagged:', JSON.stringify({ jev_only: by('jev'), sonnet_only: by('sonnet'), both: by('both') }));
console.log('misses:'); for (const s of scenes.filter((x) => !x.hit)) console.log(' ', s.slug, s.id, s.min, 'min', s.tagOnly ? '(tag_only item inside)' : '', s.reasons.join(' '));
console.log('reason tally (hit/miss), sorted by misses:'); for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].miss - a[1].miss)) console.log(' ', k, v.hit, v.miss);
