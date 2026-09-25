#!/usr/bin/env node
// v10.2 CODE-BUILT REASON TRUTH CHECK on the 16 seen films (evaluation only; Codex CLI, same model / flags; no API
// spend). The round-7 prompt (v10_1/round7/judge-reasons.mjs), unchanged: every code-built reason a parent would see
// -- each clause of a 'Flagged because ...' line and each plain title (title_source 'plain') -- is TRUE of the scene,
// FALSE, or UNCLEAR, against the scene's subtitle lines and the Wikipedia plot. Statements of v10.2 and of the
// v10.1-gated variant are pooled per film, shuffled, neutral ids (a statement both systems show on the same scene is
// asked once). A FALSE code-built reason is the bar's 'false reason' (target 0).
// Cache labels/codex/v102-seen-reasons-<slug>. Output eval/out/judge-reasons-seen.json.
//   node eval/judge-reasons-seen.mjs [--films a,b] [--parallel 4] [--size]
import fs from 'node:fs';
import path from 'node:path';
import { formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';
import { sourcesFile } from '../env.js';
import { parentPhrase } from '../reasons.js';
import { systemsFor } from './judge-seen.mjs';
import { FILMS as ALL, rj, V102 } from './seen-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', ALL.join(',')).split(',');
const PAR = Number(opt('parallel', '4'));
const hms = (ms) => formatTime(ms).slice(0, 8);
const MAX_LINES = 140;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const low = (p) => p.replace(/^(The|A|An) /, (x) => x.toLowerCase());

function statements(sys, list, fi) {
  const out = [];
  for (const s of list) {
    const w = s.why; if (!w) continue;
    const m = /Flagged because ([^.]+)\.$/.exec(w.text ?? '');
    if (m) {
      const ph = [...new Set((w.stated_reasons ?? []).map((id) => low(parentPhrase({ id }, fi))))].filter((p) => m[1].includes(p));
      for (const p of (ph.length ? ph : [m[1]])) out.push({ sys, kind: 'reason', scene: s.id, text: `Flagged because ${p}.`, reason_ids: (w.stated_reasons ?? []).filter((id) => low(parentPhrase({ id }, fi)) === p) });
    }
    if (w.title_source === 'plain') out.push({ sys, kind: 'plain_title', scene: s.id, text: w.title });
  }
  return out;
}

function build(slug) {
  const { F, v102, v101g } = systemsFor(slug);
  const src = rj(sourcesFile(slug));
  const segBy = new Map(F.seg.scenes.map((s) => [s.id, s]));
  const uniq = new Map();
  for (const it of [...statements('v102', v102, F.items), ...statements('v101g', v101g, F.items)]) { const k = `${it.scene}|${it.kind}|${it.text}`; if (!uniq.has(k)) uniq.set(k, { ...it, systems: [it.sys] }); else uniq.get(k).systems.push(it.sys); }
  const items = [...uniq.values()];
  const scenes = [...new Set(items.map((x) => x.scene))].map((id) => { const sc = segBy.get(id); return { id, start_ms: sc.start_ms, end_ms: sc.end_ms, lines: F.cues.slice(sc.start_cue - 1, sc.end_cue) }; });
  const r = rng(seedOf(`v102-reasons:${slug}`));
  const order = items.map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  scenes.sort((a, b) => a.start_ms - b.start_ms); scenes.forEach((s, k) => { s.label = `K${String(k + 1).padStart(2, '0')}`; });
  const blocks = scenes.map((sc) => {
    let lines = sc.lines; if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.scene === sc.id).map((it) => `  ${it.id}: ${it.text}`);
    return [`### Scene ${sc.label} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Statements to check:', ...notes].join('\n');
  });
  // identical to v10_1/round7/judge-reasons.mjs's prompt
  const prompt = `You are fact-checking short statements in a scene guide for parents for the children's film "${src.film.title}" (${src.film.year}). Each statement belongs to one scene and claims that something happens in that scene (for example "Flagged because a character is chased." or "A child is in danger").

Judge every statement ONLY against the scene's subtitle lines (dialogue and sound captions; speakers are rarely named) and the film's Wikipedia plot summary below. Do not use your own memory of the film. A statement's claim may be loosely worded; judge whether the thing it names really happens in THIS scene. Label each:
- true: the lines or the plot show that it happens in this scene;
- false: the lines or plot contradict it, or it plainly does not happen in this scene (for example the wrong kind of event, or no child/weapon/creature where one is claimed);
- unclear: the lines and plot neither show nor rule it out (for example it could happen on screen without dialogue).
Give a short note (at most 20 words) on why; never copy more than 8 words in a row from the lines or the plot. Return one entry for every statement id.

## Wikipedia plot summary
${src.wikipedia.sentences.map((w) => w.text).join(' ')}

## Scenes
${blocks.join('\n\n')}`;
  return { items: order, prompt, cues: F.cues };
}
const schema = obj({ notes: { type: 'array', items: obj({ id: { type: 'string' }, verdict: { type: 'string', enum: ['true', 'false', 'unclear'] }, why: { type: 'string' } }) } });
const tally = (rows) => Object.fromEntries(['true', 'false', 'unclear', 'missing'].map((v) => [v, rows.filter((x) => (x.verdict ?? 'missing') === v).length]));
const results = []; let next = 0;
await Promise.all(Array.from({ length: Math.min(PAR, FILMS.length) }, async () => {
  while (next < FILMS.length) {
    const slug = FILMS[next++];
    try {
      const { items, prompt, cues } = build(slug);
      if (argv.includes('--size')) { results.push({ slug, size: prompt.length, items: items.length }); continue; }
      if (!items.length) { results.push({ slug, rows: [] }); continue; }
      const r = await runCodex(`v102-seen-reasons-${slug}`, prompt, schema);
      const grams = transcriptGrams(cues.map((c) => c.text), 9);
      const by = new Map((r.answer.notes ?? []).map((n) => [n.id, n]));
      const rows = items.flatMap((it) => { const n = by.get(it.id); return it.systems.map((sys) => ({ ...it, sys, verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null })); });
      results.push({ slug, cached: !!r.cached, rows });
      console.log(`${slug}: v102 ${JSON.stringify(tally(rows.filter((x) => x.sys === 'v102')))} v101g ${JSON.stringify(tally(rows.filter((x) => x.sys === 'v101g')))}`);
    } catch (err) { console.error(`${slug}: ${err.message.slice(0, 300)}`); results.push({ slug, error: err.message.slice(0, 300) }); }
  }
}));
if (argv.includes('--size')) { console.log(JSON.stringify(results)); process.exit(0); }
const ok = results.filter((x) => !x.error);
const R7 = ['frozen', 'zootopia', 'good-dinosaur'];
const grp = { all: ok.map((x) => x.slug), round7: R7, pair: ['frozen', 'zootopia'], dev13: ok.map((x) => x.slug).filter((s) => !R7.includes(s)) };
const summary = Object.fromEntries(Object.entries(grp).map(([g, films]) => { const rows = ok.filter((x) => films.includes(x.slug)).flatMap((x) => x.rows.map((y) => ({ ...y, slug: x.slug }))); return [g, { v102_reason: tally(rows.filter((x) => x.sys === 'v102' && x.kind === 'reason')), v102_plain_title: tally(rows.filter((x) => x.sys === 'v102' && x.kind === 'plain_title')), v101g_reason: tally(rows.filter((x) => x.sys === 'v101g' && x.kind === 'reason')), v101g_plain_title: tally(rows.filter((x) => x.sys === 'v101g' && x.kind === 'plain_title')), v102_false: rows.filter((x) => x.sys === 'v102' && x.verdict === 'false').map((x) => `${x.slug}:${x.scene} [${x.kind}] ${x.text} -- ${x.why}`), v101g_false: rows.filter((x) => x.sys === 'v101g' && x.verdict === 'false').map((x) => `${x.slug}:${x.scene} [${x.kind}] ${x.text} -- ${x.why}`) }]; }));
fs.mkdirSync(path.join(V102, 'eval', 'out'), { recursive: true });
fs.writeFileSync(path.join(V102, 'eval', 'out', 'judge-reasons-seen.json'), JSON.stringify({ generated_at: new Date().toISOString(), judge: 'codex exec gpt-6-astra high read-only ephemeral (prompt identical to v10_1/round7/judge-reasons.mjs)', label: 'IN-SAMPLE seen films', summary, per_film: results }, null, 2));
for (const [g, o] of Object.entries(summary)) { console.log(`${g}: v102 reason ${JSON.stringify(o.v102_reason)} plain title ${JSON.stringify(o.v102_plain_title)} | v101g reason ${JSON.stringify(o.v101g_reason)} plain title ${JSON.stringify(o.v101g_plain_title)}`); if (g === 'all') { for (const x of o.v102_false) console.log('  v102 FALSE', x); for (const x of o.v101g_false) console.log('  v101g FALSE', x); } }
