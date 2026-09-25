#!/usr/bin/env node
// ROUND 8 (v10.2, fresh films): copy of v10_1/round7/judge.mjs. SAME PROMPT TEXT, labels, flags and judge (Codex CLI
// gpt-6-astra high, read-only, ephemeral, --ignore-user-config); changes: films/paths from round8/spend.mjs (v10.2 out102,
// live round8/live), the seed / cache name r8-describe-<slug>, output round8/out/descriptions.json.
// ROUND 7 (v10.1): copy of round6/judge.mjs; the judge, flags, labels and prompt text are unchanged. Changes:
// v10.1 outputs per film (spend.mjs outFor); the plot shown is the sources file v10.1 read (env.js sourcesFile =
// the pinned v10/sources); the placeholder title 'Flagged scene' and scenes with no verified text are not sent
// (counted as 'no text'); every CODE-BUILT REASON is ALSO sent as its own note (kind 'reason'): each clause of a
// 'Flagged because ...' line as 'Flagged because <phrase>.', and each plain title (title_source 'plain') is a
// title note flagged code_built. A code-built reason judged 'wrong' is a FALSE code-built reason. Cache
// labels/codex/r7-describe-<slug>. Output round7/out/descriptions.json.
// Round-6 DESCRIPTION-QUALITY CHECK (evaluation only). Same judge, prompt, labels and flags as
// eval/judge-descriptions.mjs (Codex CLI gpt-6-astra, high, read-only, ephemeral, --ignore-user-config):
// accurate / partly / wrong / generic per note, against the scene's subtitle lines + the Wikipedia plot.
// Notes judged, per held-out film:
//   v10    every FLAGGED scene: the parent text (why.text) and the title (why.title)
//   live  every live scene (live flags every scene it returns): its description and its title
// BLIND: both systems' notes are pooled in ONE call per film, shuffled (seeded) with neutral note ids
// (N001..); scene blocks are labelled neutrally (K01..) and ordered by time; the judge is never told
// which system wrote which note or that there are two systems. v10 scene lines = its segmentation's
// cues (as the dev judge); live scene lines = cues starting inside the live scene span.
// Answers cached in labels/codex/r6-describe-<slug>.answer.json; notes cut by the 8-word rule.
//   node round6/judge.mjs [--films a,b] [--parallel 3]  -> round6/out/descriptions.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';
import { FILMS as HELD, LIVE_OUT, outFor } from './spend.mjs';
import { sourcesFile } from '../env.js';
import { parentPhrase } from '../reasons.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..');
const TS = path.resolve(V9, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', HELD.join(',')).split(',');
const PAR = Number(opt('parallel', '3'));
const MAX_LINES = 140;
const VERDICTS = ['accurate', 'partly', 'wrong', 'generic'];
const hms = (ms) => formatTime(ms).slice(0, 8);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function build(slug) {
  const OUT = outFor(slug);
  const t9 = rj(path.join(OUT, `${slug}.tags.r1.json`));
  const seg = rj(path.join(OUT, `${slug}.segments.json`));
  const filmItems = rj(path.join(OUT, `${slug}.jev.r1.json`)).film_items ?? [];
  const built = rj(path.join(LIVE_OUT, `${slug}.built.json`));
  const src = rj(sourcesFile(slug));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const segBy = new Map(seg.scenes.map((s) => [s.id, s]));
  const scenes = []; const items = [];
  for (const s of t9.scenes.filter((x) => x.flagged && x.why && (x.why.text || x.why.title_source !== 'none'))) {
    const sc = segBy.get(s.id);
    scenes.push({ key: `v10:${s.id}`, start_ms: sc.start_ms, end_ms: sc.end_ms, lines: cues.slice(sc.start_cue - 1, sc.end_cue) });
    if (s.why.text) items.push({ sys: 'v10', kind: 'text', scene: s.id, skey: `v10:${s.id}`, text: s.why.text, source: s.why.source });
    if (s.why.title && s.why.title_source !== 'none') items.push({ sys: 'v10', kind: 'title', scene: s.id, skey: `v10:${s.id}`, text: s.why.title, title_source: s.why.title_source, code_built: s.why.title_source === 'plain' });
    // code-built reason clauses: the phrases of the stated reasons that the 'Flagged because' line contains
    const m = /Flagged because ([^.]+)\.$/.exec(s.why.text ?? '');
    if (m) {
      const phrases = [...new Set((s.why.stated_reasons ?? []).map((id) => parentPhrase({ id }, filmItems).replace(/^(The|A|An) /, (x) => x.toLowerCase())))].filter((ph) => m[1].includes(ph));
      const clauses = phrases.length ? phrases : [m[1]];
      for (const ph of clauses) items.push({ sys: 'v10', kind: 'reason', scene: s.id, skey: `v10:${s.id}`, text: `Flagged because ${ph}.`, reason_ids: (s.why.stated_reasons ?? []).filter((id) => parentPhrase({ id }, filmItems).replace(/^(The|A|An) /, (x) => x.toLowerCase()) === ph), code_built: true });
    }
  }
  for (const s of built.scenes) {
    const id = s.id.split(':').pop();
    scenes.push({ key: `live:${id}`, start_ms: s.start_ms, end_ms: s.end_ms, lines: cues.filter((c) => c.startMs >= s.start_ms && c.startMs < s.end_ms) });
    if (s.description) items.push({ sys: 'live', kind: 'text', scene: id, skey: `live:${id}`, text: s.description });
    if (s.title) items.push({ sys: 'live', kind: 'title', scene: id, skey: `live:${id}`, text: s.title });
  }
  const r = rng(seedOf(`r8:${slug}`));
  const order = items.map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  scenes.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms || (r() - 0.5));
  scenes.forEach((s, k) => { s.label = `K${String(k + 1).padStart(2, '0')}`; });
  const blocks = scenes.map((sc) => {
    let lines = sc.lines;
    if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.skey === sc.key).map((it) => `${it.id}: ${it.text}`);
    return [`### Scene ${sc.label} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Notes to judge:', ...notes.map((n) => `  ${n}`)].join('\n');
  });
  for (const it of order) it.scene_label = scenes.find((s) => s.key === it.skey).label;
  // identical to eval/judge-descriptions.mjs's prompt
  const prompt = `You are checking short notes written for parents in a scene guide for the children's film "${src.film.title}" (${src.film.year}). Each note belongs to one scene and should tell a parent what happens in that scene that might upset a young child. Some notes are titles, some are one or two sentences.

Judge every note ONLY against the scene's subtitle lines (dialogue and sound captions; speakers are rarely named) and the film's Wikipedia plot summary below. Do not use your own memory of the film. Label each note:
- accurate: every statement is backed by the lines or the plot, and it says what happens in this scene that a parent would want to know about;
- partly: mostly right, but one detail is unsupported or wrong, or it misses the scene's main concern while saying true things;
- wrong: it states something the lines or plot contradict, or something that does not happen in this scene;
- generic: true or not, it says nothing specific about this scene (only a category or a mood, e.g. "a character is in danger").
Give a short note (at most 20 words) on why; never copy more than 8 words in a row from the lines or the plot. Return one entry for every note id.

## Wikipedia plot summary
${src.wikipedia.sentences.map((w) => w.text).join(' ')}

## Scenes
${blocks.join('\n\n')}`;
  return { items: order, prompt, cues };
}

const schema = obj({ notes: { type: 'array', items: obj({ id: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, why: { type: 'string' } }) } });

async function judge(slug) {
  const { items, prompt, cues } = build(slug);
  if (argv.includes('--size')) return { slug, size: prompt.length, items: items.length };
  const r = await runCodex(`r8-describe-${slug}`, prompt, schema);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const by = new Map((r.answer.notes ?? []).map((n) => [n.id, n]));
  const rows = items.map((it) => { const n = by.get(it.id); return { ...it, verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null }; });
  const tally = (f) => Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, rows.filter((x) => f(x) && (x.verdict ?? 'missing') === v).length]));
  const t9 = rj(path.join(outFor(slug), `${slug}.tags.r1.json`)); const fl = t9.scenes.filter((x) => x.flagged);
  const noText = { flagged: fl.length, no_text: fl.filter((x) => !x.why?.text).map((x) => x.id), placeholder_title: fl.filter((x) => !x.why || x.why.title_source === 'none').map((x) => x.id) };
  return { slug, cached: !!r.cached, commands: r.commands ?? [], items: rows.length, no_text: noText, v10_reason: tally((x) => x.sys === 'v10' && x.kind === 'reason'), v10_plain_title: tally((x) => x.sys === 'v10' && x.kind === 'title' && x.code_built), false_code_built: rows.filter((x) => x.sys === 'v10' && x.code_built && x.verdict === 'wrong').map((x) => ({ scene: x.scene, kind: x.kind, text: x.text, why: x.why })), v10_text: tally((x) => x.sys === 'v10' && x.kind === 'text'), v10_title: tally((x) => x.sys === 'v10' && x.kind === 'title'), live_text: tally((x) => x.sys === 'live' && x.kind === 'text'), live_title: tally((x) => x.sys === 'live' && x.kind === 'title'), rows };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(PAR, FILMS.length) }, async () => {
  while (next < FILMS.length) {
    const slug = FILMS[next++];
    try { const r = await judge(slug); results.push(r); console.log(argv.includes('--size') ? JSON.stringify(r) : `${slug}: v10 text ${JSON.stringify(r.v10_text)} | live text ${JSON.stringify(r.live_text)} | v10 title ${JSON.stringify(r.v10_title)} | live title ${JSON.stringify(r.live_title)}${r.cached ? ' (cached)' : ''}`); }
    catch (err) { console.error(`${slug}: ${err.message.slice(0, 300)}`); results.push({ slug, error: err.message.slice(0, 300) }); }
  }
}));
if (argv.includes('--size')) process.exit(0);
const ok = results.filter((r) => !r.error);
const pool = (k) => Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, ok.reduce((a, r) => a + r[k][v], 0)]));
const bySource = {};
for (const r of ok) for (const x of r.rows.filter((y) => y.sys === 'v10' && y.kind === 'text')) { const k = x.source ?? 'none'; bySource[k] ??= Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, 0])); bySource[k][x.verdict ?? 'missing']++; }
const out = { generated_at: new Date().toISOString(), false_code_built: ok.flatMap((r) => r.false_code_built.map((x) => ({ slug: r.slug, ...x }))), v10_reason_pooled: pool('v10_reason'), v10_plain_title_pooled: pool('v10_plain_title'), no_text: Object.fromEntries(ok.map((r) => [r.slug, r.no_text])), judge: 'codex exec --ignore-user-config -m gpt-6-astra -c model_reasoning_effort="high" --sandbox read-only --ephemeral (round8/judge.mjs; prompt identical to v10_1/round7/judge.mjs, round6/judge.mjs and eval/judge-descriptions.mjs)', films: results.map((r) => r.slug), pooled: { v10_text: pool('v10_text'), live_text: pool('live_text'), v10_title: pool('v10_title'), live_title: pool('live_title') }, v10_text_by_source: bySource, per_film: results };
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'descriptions.json'), JSON.stringify(out, null, 2));
console.log(`POOLED v10 text ${JSON.stringify(out.pooled.v10_text)}\n       live text ${JSON.stringify(out.pooled.live_text)}\n       v10 title ${JSON.stringify(out.pooled.v10_title)}\n       live title ${JSON.stringify(out.pooled.live_title)}\n  v10 text by source ${JSON.stringify(bySource)}`);
