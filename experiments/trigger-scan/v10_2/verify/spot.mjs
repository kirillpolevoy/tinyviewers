#!/usr/bin/env node
// VERIFIER spot checks against the SRT (no model calls). Prints (console only) short cue excerpts (<= 8 words) so the
// verifier can read them; stores only ids, cue numbers, times and the verdict notes. Usage: node spot.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ex = (t, n = 8) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
const mm = (ms) => `${(ms / 60000).toFixed(2)}m`;
const cuesOf = {}; const C = (slug) => (cuesOf[slug] ??= parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8')));
const TEXTS = [['incredibles', 'S028'], ['brave', 'S003'], ['big-hero-6', 'S016'], ['incredibles', 'S020'], ['brave', 'S030'], ['incredibles', 'S043']];
for (const [slug, id] of TEXTS) {
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`)); const sc = tags.scenes.find((s) => s.id === id); const why = rj(path.join(V, 'out102', `${slug}.why.r1.json`)).scenes[id];
  const src = rj(path.join(V, 'sources', `${slug}.json`)).wikipedia.sentences;
  console.log(`\n### ${slug} ${id} cues ${sc.start_cue}-${sc.end_cue} ${mm(sc.start_ms)}-${mm(sc.end_ms)} flagged ${sc.flagged} reasons ${sc.flag_reasons.map((r) => r.id)} | title "${sc.why.title}" (${sc.why.title_source})`);
  console.log(`  SHOWN: ${sc.why.text ? ex(sc.why.text, 30) : '(none)'}`);
  for (const c of why.checked.filter((c) => [...(sc.why.sentences ?? []), `${id}.title`].includes(c.key))) {
    console.log(`  ${c.key} via ${c.via} cites ${c.cites.join(',')} placement ${c.placement}`);
    for (const ci of c.cites) {
      if (ci[0] === 'L') { const n = Number(ci.slice(1)); const cue = C(slug)[n - 1]; console.log(`    ${ci} ${n >= sc.start_cue && n <= sc.end_cue ? 'IN scene' : 'OUT of scene'} ${mm(cue.startMs ?? cue.start_ms)}: ${ex(cue.text)}`); }
      if (ci[0] === 'W') { const w = src.find((x) => x.id === ci) ?? src[Number(ci.slice(1)) - 1]; console.log(`    ${ci}: ${ex(typeof w === 'string' ? w : w?.text ?? '', 25)}`); }
    }
  }
}
// spans: key items vs SRT and vs both systems' skips
const SPANS = [['incredibles', 'R116'], ['incredibles', 'R26'], ['big-hero-6', 'R15'], ['brave', 'R76'], ['brave', 'R91'], ['incredibles', 'R119']];
for (const [slug, id] of SPANS) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`)); const it = k.items.find((x) => x.id === id);
  const cues = C(slug).filter((c) => (c.endMs ?? c.end_ms) >= it.start_ms - 3000 && (c.startMs ?? c.start_ms) <= it.end_ms + 3000);
  const tags = rj(path.join(V, 'out102', `${slug}.tags.r1.json`)); const sc = tags.scenes.find((s) => (it.start_ms + it.end_ms) / 2 >= s.start_ms && (it.start_ms + it.end_ms) / 2 <= s.end_ms);
  const built = rj(path.join(V, 'round8', 'live', `${slug}.built.json`)); const ls = built.scenes.find((s) => (it.start_ms + it.end_ms) / 2 >= s.start_ms && (it.start_ms + it.end_ms) / 2 <= s.end_ms);
  console.log(`\n### ${slug} ${id} ${mm(it.start_ms)}-${mm(it.end_ms)} (${Math.round((it.end_ms - it.start_ms) / 1000)} s) wordless ${it.wordless} cues ${it.start_cue ?? ''}-${it.end_cue ?? ''}; v10.2 scene ${sc?.id} ${sc ? `${mm(sc.start_ms)}-${mm(sc.end_ms)}` : ''} flagged ${sc?.flagged} skip ${JSON.stringify((sc?.skip?.spans ?? []).map((x) => `${mm(x.start_ms)}-${mm(x.end_ms)}`))}; live scene ${ls?.id ?? 'none'} ${ls ? `${mm(ls.start_ms)}-${mm(ls.end_ms)}` : ''}`);
  console.log(`  key: ${ex(it.text, 20)}`);
  for (const c of cues.slice(0, 12)) console.log(`    ${mm(c.startMs ?? c.start_ms)}: ${ex(c.text)}`);
}
