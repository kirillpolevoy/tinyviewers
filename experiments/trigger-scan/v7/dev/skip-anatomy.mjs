#!/usr/bin/env node
// Dev-only: where do a film's skip minutes come from, and which scene's span swallows each comic
// (tag_only) key item? Reads <out>/<slug>.tags.r1.json (+ moments) and refs/<slug>.key.json (dev keys).
// No model calls. Prints numbers and ids only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { union, total, inter } from '../refscore.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '../..');
const OUT = path.resolve(here, '..', process.argv[2] ?? 'out');
const films = (process.argv[3] ?? 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot').split(',');
const min = (ms) => +(ms / 60000).toFixed(2);
for (const slug of films) {
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.r1.json`), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(TS, 'refs', `${slug}.key.json`), 'utf8'));
  const mapped = key.items.filter((i) => i.mappable && Number.isFinite(i.start_ms));
  const trueU = union(mapped.filter((i) => i.should_flag === true).map((i) => [i.start_ms, i.end_ms]));
  const byMethod = {};
  const rows = [];
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const sp = union((s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms]));
    const ms = total(sp);
    const hit = inter(sp, trueU);
    const why = s.skip?.method === 'moments' ? 'moments' : (s.skip?.method ?? 'whole');
    const m = byMethod[why] ??= { n: 0, min: 0, over_true: 0 };
    m.n++; m.min += ms / 60000; m.over_true += hit / 60000;
    rows.push({ id: s.id, method: why, skip_s: Math.round(ms / 1000), scene_s: Math.round((s.end_ms - s.start_ms) / 1000), over_true_s: Math.round(hit / 1000), reasons: s.flag_reasons.map((r) => r.id).join(','), comic_peril: !!s.modifiers?.comic_peril?.on, lead_in: (s.skip?.spans ?? []).some((x) => x.lead_in) });
  }
  const U = union(tags.scenes.filter((x) => x.flagged).flatMap((s) => (s.skip?.spans ?? []).map((x) => [x.start_ms, x.end_ms])));
  console.log(`\n=== ${slug}: skip ${min(total(U))} min; over should_flag items ${min(inter(U, trueU))}`);
  for (const [k, v] of Object.entries(byMethod)) console.log(`  ${k.padEnd(12)} ${v.n} scenes ${v.min.toFixed(2)} min (over should_flag ${v.over_true.toFixed(2)})`);
  // comic items inside the skip: which flagged scene's span covers them
  for (const it of mapped.filter((i) => i.should_flag === 'tag_only')) {
    const share = inter([[it.start_ms, Math.max(it.end_ms, it.start_ms + 1)]], U) / Math.max(1, it.end_ms - it.start_ms);
    if (share < 0.5) continue;
    const cover = tags.scenes.filter((s) => s.flagged && (s.skip?.spans ?? []).some((x) => x.start_ms < it.end_ms && x.end_ms > it.start_ms));
    const home = tags.scenes.find((s) => s.start_ms <= it.start_ms && s.end_ms > it.start_ms);
    console.log(`  TAG_ONLY ${it.id} ${(it.start_ms / 1000).toFixed(0)}-${(it.end_ms / 1000).toFixed(0)}s in scene ${home?.id} (flagged ${home?.flagged}, comic_peril ${home?.modifiers?.comic_peril?.on}) covered by ${cover.map((s) => `${s.id}[${s.skip.method}${s.skip.spans.some((x) => x.lead_in) ? ',lead_in' : ''}; ${s.flag_reasons.map((r) => r.id).join('+')}]`).join(' ')}`);
  }
  for (const r of rows.sort((a, b) => b.skip_s - b.over_true_s - (a.skip_s - a.over_true_s)).slice(0, 12)) console.log(`  ${r.id} ${r.method} skip ${r.skip_s}s/${r.scene_s}s over_true ${r.over_true_s}s [${r.reasons}]${r.comic_peril ? ' COMIC_PERIL' : ''}`);
}
