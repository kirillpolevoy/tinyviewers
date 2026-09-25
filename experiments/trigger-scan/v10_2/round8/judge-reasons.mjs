#!/usr/bin/env node
// ROUND 8 (v10.2, fresh films): copy of v10_1/round7/judge-reasons.mjs, same prompt/judge; films/paths from round8/spend.mjs,
// seed / cache r8-reasons-<slug>, output round8/out/reasons-truth.json. A film with no code-built reason (v10.2 policy
// text_safety.code_built_reasons false) makes no Codex call and records 0 statements.
// Round-7 CODE-BUILT REASON TRUTH CHECK (evaluation only; Codex CLI, same model/flags as judge.mjs; no API spend).
// Why a second prompt: the round-5/6 description prompt labels a category-level note 'generic' "true or not", so
// in judge.mjs every code-built reason came back 'generic' (79/79) and it cannot say whether one is FALSE. This
// asks only that: for every code-built reason a parent would see on a v10.1 flagged scene -- each clause of a
// 'Flagged because ...' line, and each plain title (title_source 'plain') -- is it TRUE of this scene, FALSE, or
// UNCLEAR, judged only against the scene's subtitle lines and the Wikipedia plot. Notes are shuffled with neutral
// ids; the judge is not told who wrote them. Cache labels/codex/r7-reasons-<slug>. Output round7/out/reasons-truth.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';
import { FILMS, outFor } from './spend.mjs';
import { sourcesFile } from '../env.js';
import { parentPhrase } from '../reasons.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TS = path.resolve(here, '..', '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hms = (ms) => formatTime(ms).slice(0, 8);
const MAX_LINES = 140;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const low = (p) => p.replace(/^(The|A|An) /, (x) => x.toLowerCase());

function build(slug) {
  const OUT = outFor(slug);
  const tags = rj(path.join(OUT, `${slug}.tags.r1.json`)); const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const fi = rj(path.join(OUT, `${slug}.jev.r1.json`)).film_items ?? [];
  const src = rj(sourcesFile(slug)); const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const segBy = new Map(seg.scenes.map((s) => [s.id, s]));
  const items = []; const scenes = [];
  for (const s of tags.scenes.filter((x) => x.flagged && x.why)) {
    const mine = [];
    const m = /Flagged because ([^.]+)\.$/.exec(s.why.text ?? '');
    if (m) {
      const ph = [...new Set((s.why.stated_reasons ?? []).map((id) => low(parentPhrase({ id }, fi))))].filter((p) => m[1].includes(p));
      for (const p of (ph.length ? ph : [m[1]])) mine.push({ kind: 'reason', text: `Flagged because ${p}.`, reason_ids: (s.why.stated_reasons ?? []).filter((id) => low(parentPhrase({ id }, fi)) === p) });
    }
    if (s.why.title_source === 'plain') mine.push({ kind: 'plain_title', text: s.why.title });
    if (!mine.length) continue;
    const sc = segBy.get(s.id);
    scenes.push({ id: s.id, start_ms: sc.start_ms, end_ms: sc.end_ms, lines: cues.slice(sc.start_cue - 1, sc.end_cue) });
    for (const x of mine) items.push({ ...x, scene: s.id });
  }
  const r = rng(seedOf(`r8-reasons:${slug}`));
  const order = items.map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  scenes.sort((a, b) => a.start_ms - b.start_ms); scenes.forEach((s, k) => { s.label = `K${String(k + 1).padStart(2, '0')}`; });
  const blocks = scenes.map((sc) => {
    let lines = sc.lines; if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.scene === sc.id).map((it) => `  ${it.id}: ${it.text}`);
    return [`### Scene ${sc.label} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Statements to check:', ...notes].join('\n');
  });
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
  return { items: order, prompt, cues };
}
const schema = obj({ notes: { type: 'array', items: obj({ id: { type: 'string' }, verdict: { type: 'string', enum: ['true', 'false', 'unclear'] }, why: { type: 'string' } }) } });
const results = await Promise.all(FILMS.map(async (slug) => {
  const { items, prompt, cues } = build(slug);
  if (process.argv.includes('--size')) return { slug, size: prompt.length, items: items.length };
  if (!items.length) return { slug, cached: false, commands: [], no_code_built_reasons: true, reason: { true: 0, false: 0, unclear: 0, missing: 0 }, plain_title: { true: 0, false: 0, unclear: 0, missing: 0 }, false_rows: [], rows: [] };
  const r = await runCodex(`r8-reasons-${slug}`, prompt, schema);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const by = new Map((r.answer.notes ?? []).map((n) => [n.id, n]));
  const rows = items.map((it) => { const n = by.get(it.id); return { ...it, verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null }; });
  const tally = (f) => Object.fromEntries(['true', 'false', 'unclear', 'missing'].map((v) => [v, rows.filter((x) => f(x) && (x.verdict ?? 'missing') === v).length]));
  return { slug, cached: !!r.cached, commands: r.commands ?? [], reason: tally((x) => x.kind === 'reason'), plain_title: tally((x) => x.kind === 'plain_title'), false_rows: rows.filter((x) => x.verdict === 'false'), rows };
}));
if (process.argv.includes('--size')) { console.log(JSON.stringify(results)); process.exit(0); }
fs.writeFileSync(path.join(here, 'out', 'reasons-truth.json'), JSON.stringify({ generated_at: new Date().toISOString(), judge: 'codex exec gpt-6-astra high read-only ephemeral (round8/judge-reasons.mjs)', per_film: results }, null, 2));
for (const r of results) { console.log(r.slug, 'reason', JSON.stringify(r.reason), 'plain_title', JSON.stringify(r.plain_title), r.cached ? '(cached)' : ''); for (const x of r.false_rows) console.log('   FALSE', x.scene, x.kind, x.text, '--', x.why); }
