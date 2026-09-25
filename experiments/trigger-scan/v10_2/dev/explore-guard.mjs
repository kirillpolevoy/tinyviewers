#!/usr/bin/env node
// v10.2 DEV exploration (seen films only, stored answers, no model calls): under the pre-registered tier-A gating
// of v10.1's select, every flagged scene with a Sonnet-owned reason (captured / weapon_used / crying / ...), whether
// its skip holds a should_flag human key item (hit), and Jev's stored Scores (danger / resolution / distress /
// laughs) -- to see what separates resolution / celebration misfires from real moments.
//   node dev/explore-guard.mjs  -> dev/out/explore-guard.json + a table
import fs from 'node:fs';
import path from 'node:path';
import * as S101 from '../../v10_1/select.js';
import { respanScenes } from '../moments.js';
import { loadSplit } from '../split.js';
import { union, shareInside } from '../refscore.js';
import { FILMS, loadFilm, V101, rj } from '../eval/seen-lib.mjs';

const P101 = S101.loadPolicy(path.join(V101, 'policy.json'));
const SPLIT = loadSplit();
const pre = rj(path.resolve(V101, '..', 'v10', 'prereg-tierA-gating.json'));
const TIER_A = new Set(pre.tierA_jev_concepts);
const out = [];
for (const slug of FILMS) {
  const f = loadFilm(slug);
  const tags = S101.selectRun({ film: { slug }, run: 'x', film_items: f.items, scenes: f.rows }, P101, { cues: f.cues, sonnet: f.sonnet, used: SPLIT.sonnet_used, childcry: f.childcry });
  const concept = (r) => { const it = f.items.find((x) => x.id === r.id); return it ? `film:${it.type}` : r.id; };
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    s.flag_reasons = s.flag_reasons.filter((r) => r.by === 'sonnet' || TIER_A.has(concept(r)));
    if (!s.flag_reasons.length) s.flagged = false;
  }
  const sp = respanScenes({ tags, saved: f.saved, cues: f.cues, items: f.items, cfg: P101 });
  const items = f.key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms));
  const row = f.rows;
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const son = s.flag_reasons.filter((r) => r.by === 'sonnet');
    if (!son.length) continue;
    const U = union((sp[s.id]?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const inside = items.filter((i) => shareInside(i.start_ms, i.end_ms, U) >= 0.5);
    const a = row.find((r) => r.id === s.id).answers;
    const sc = (k) => (a.s?.[k] ? Number(a.s[k].score).toFixed(2) : '-');
    out.push({ slug, id: s.id, sonnet: son.map((r) => `${r.id}:${r.p}`), jev: s.flag_reasons.filter((r) => r.by === 'jev').map((r) => r.id), hit: inside.some((i) => i.should_flag === true), tag_only: inside.some((i) => i.should_flag === 'tag_only'), danger: sc('danger'), resolution: sc('resolution'), distress: sc('distress'), laughs: sc('laughs'), key: inside.filter((i) => i.should_flag === true).map((i) => i.id).slice(0, 4) });
  }
}
fs.mkdirSync(path.resolve('dev/out'), { recursive: true });
fs.writeFileSync('dev/out/explore-guard.json', JSON.stringify(out, null, 2));
for (const r of out) console.log(`${r.slug.padEnd(24)} ${r.id} ${r.hit ? 'HIT ' : 'miss'}${r.tag_only ? '(to)' : '    '} d ${r.danger} res ${r.resolution} dis ${r.distress} lg ${r.laughs} | S ${r.sonnet.join(' ')} | J ${r.jev.join(',') || '-'}`);
const onlyS = out.filter((r) => !r.jev.length);
console.log(`sonnet-only flagged scenes ${onlyS.length}, hit ${onlyS.filter((r) => r.hit).length}; with jev too ${out.length - onlyS.length}`);
