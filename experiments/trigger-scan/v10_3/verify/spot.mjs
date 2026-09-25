#!/usr/bin/env node
// VERIFIER spot checks against the SRT (round 9, no model calls). Prints (console only) short cue excerpts (<= 8 words)
// so the verifier can read them; the verdict notes are recorded by hand in the verifier's report, not here.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseSrt } from '../../srt.js';
const here = path.dirname(fileURLToPath(import.meta.url)); const V = path.resolve(here, '..'); const TS = path.resolve(V, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ex = (t, n = 8) => t.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ');
const mm = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const cuesOf = {}; const C = (slug) => (cuesOf[slug] ??= parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8')));
const opt = (f) => (fs.existsSync(f) ? rj(f) : { scenes: {} });
const TEXTS = (process.env.TEXTS ?? 'croods:S015,croods:S037,kung-fu-panda:S018,onward:S028,onward:S011,croods:S033').split(',').map((x) => x.split(':'));
for (const [slug, id] of TEXTS) {
  const O = path.join(V, 'out103');
  const tags = rj(path.join(O, `${slug}.tags.r1.json`)); const sc = tags.scenes.find((s) => s.id === id);
  const why = ['why', 'why2', 'why3'].map((k) => opt(path.join(O, `${slug}.${k}.r1.json`)).scenes[id]);
  const src = rj(path.join(V, 'sources', `${slug}.json`)).wikipedia.sentences;
  console.log(`\n### ${slug} ${id} cues ${sc.start_cue}-${sc.end_cue} ${mm(sc.start_ms)}-${mm(sc.end_ms)} flagged ${sc.flagged} reasons ${sc.flag_reasons.map((r) => r.id)} skip ${JSON.stringify((sc.skip?.spans ?? []).map((x) => `${mm(x.start_ms)}-${mm(x.end_ms)}`))}`);
  console.log(`  TITLE: "${sc.why?.title}" (${sc.why?.title_source}, attempt ${sc.why?.title_attempt})`);
  console.log(`  SHOWN: ${sc.why?.text ? ex(sc.why.text, 40) : '(none)'}`);
  const keys = [...(sc.why?.sentences ?? []), `${id}.title`];
  for (const k of keys) {
    const a = k.startsWith('a2:') ? 1 : k.endsWith('.title') ? (sc.why?.title_attempt ?? 1) - 1 : 0; const key = k.replace(/^a2:/, '');
    const c = (why[a]?.checked ?? []).find((x) => x.key === key); if (!c) continue;
    console.log(`  ${k} [attempt ${a + 1}] via ${c.via} final ${c.final} cites ${c.cites.join(',')}`);
    for (const ci of c.cites) {
      if (ci[0] === 'L') { const n = Number(ci.slice(1)); const cue = C(slug)[n - 1]; console.log(`    ${ci} ${n >= sc.start_cue && n <= sc.end_cue ? 'IN' : 'OUT'} ${mm(cue.startMs)}: ${ex(cue.text)}`); }
      if (ci[0] === 'W') { const w = src.find((x) => x.id === ci); console.log(`    ${ci}: ${ex(w?.text ?? '', 30)}`); }
    }
  }
  if (process.env.CUES) for (const c of C(slug).slice(sc.start_cue - 1, sc.end_cue)) console.log(`      ${c.index ?? ''} ${mm(c.startMs)} ${ex(c.text)}`);
}
const SPANS = (process.env.SPANS ?? 'onward:R07,onward:R08,croods:R22,croods:R08,croods:R109,kung-fu-panda:R13,kung-fu-panda:R25').split(',').map((x) => x.split(':'));
for (const [slug, id] of SPANS) {
  const k = rj(path.join(TS, 'refs', `${slug}.key.json`)); const it = k.items.find((x) => x.id === id);
  const cues = C(slug).filter((c) => c.endMs >= it.start_ms - 5000 && c.startMs <= it.end_ms + 5000);
  const tags = rj(path.join(V, 'out103', `${slug}.tags.r1.json`)); const mid = (it.start_ms + it.end_ms) / 2;
  const scs = tags.scenes.filter((s) => s.end_ms >= it.start_ms && s.start_ms <= it.end_ms);
  const built = rj(path.join(V, 'round9', 'live', `${slug}.built.json`)); const ls = built.scenes.filter((s) => s.end_ms >= it.start_ms && s.start_ms <= it.end_ms);
  console.log(`\n### ${slug} ${id} key ${mm(it.start_ms)}-${mm(it.end_ms)} (${Math.round((it.end_ms - it.start_ms) / 1000)} s) wordless ${it.wordless} should_flag ${it.should_flag} cue_range ${it.cue_range}`);
  for (const sc of scs) console.log(`  v10.3 ${sc.id} ${mm(sc.start_ms)}-${mm(sc.end_ms)} flagged ${sc.flagged} [${(sc.flag_reasons ?? []).map((r) => r.id)}] skip ${JSON.stringify((sc.skip?.spans ?? []).map((x) => `${mm(x.start_ms)}-${mm(x.end_ms)}`))} tags@act ${(sc.tags ?? []).filter((t) => t.level === 'act').map((t) => t.id).slice(0, 12)} modifiers ${JSON.stringify(sc.modifiers ?? sc.cancelled ?? '')}`);
  for (const s of ls) console.log(`  live ${s.id} ${mm(s.start_ms)}-${mm(s.end_ms)}`);
  console.log(`  key: ${ex(it.text, 25)}`);
  for (const c of cues.slice(0, 14)) console.log(`    ${mm(c.startMs)}: ${ex(c.text)}`);
}

