#!/usr/bin/env node
// v9 DESCRIPTION-QUALITY CHECK (evaluation only; never read by the pipeline). An independent model
// (Codex CLI, gpt-6-astra, high, read-only, ephemeral: codex.js) judges the parent-facing text of
// every FLAGGED scene against the scene's subtitle lines and the film's Wikipedia plot:
//   accurate  every statement is backed by the lines / plot, and it says what happens in the scene
//             that a parent would want to know about;
//   partly    mostly right, but one detail is unsupported or wrong, or it misses the scene's main
//             concern while saying true things;
//   wrong     it states something the sources contradict, or something that does not happen here;
//   generic   true or not, it says nothing specific about this scene (a category label, a mood).
// BLIND: v8's text (tags.why.text), v9's description (why.text) and v9's title (why.title) are items
// with shuffled neutral ids (seeded per film); the judge is not told which system or kind wrote which.
// One Codex call per film. Answers cached in labels/codex/<name>.answer.json (git-ignored; prompts carry
// subtitle and Wikipedia text). Notes are cut by the 8-word quotation rule before they are stored here.
//   node eval/judge-descriptions.mjs [--films a,b] [--parallel 3]   -> out/eval/descriptions.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const V9 = path.resolve(here, '..');
const TS = path.resolve(V9, '..');
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', 'nemo,monsters-inc,lion-king,frankenweenie,wild-robot,iron-giant,up,tangled,coco,how-to-train-your-dragon').split(',');
const PAR = Number(opt('parallel', '3'));
const MAX_LINES = 140;
const VERDICTS = ['accurate', 'partly', 'wrong', 'generic'];
const hms = (ms) => formatTime(ms).slice(0, 8);

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

function build(slug) {
  const t8 = rj(path.join(TS, 'v8', 'out', `${slug}.tags.r1.json`));
  const t9 = rj(path.join(V9, 'out', `${slug}.tags.r1.json`));
  const seg = rj(path.join(V9, 'out', `${slug}.segments.json`));
  const src = rj(path.join(V9, 'sources', `${slug}.json`));
  const cues = parseSrt(fs.readFileSync(path.join(TS, 'data', `${slug}.srt`), 'utf8'));
  const segBy = new Map(seg.scenes.map((s) => [s.id, s]));
  const items = [];
  for (const s of t8.scenes.filter((x) => x.flagged && x.why?.text)) items.push({ sys: 'v8', kind: 'text', scene: s.id, text: s.why.text });
  for (const s of t9.scenes.filter((x) => x.flagged && x.why)) {
    if (s.why.text) items.push({ sys: 'v9', kind: 'text', scene: s.id, text: s.why.text });
    if (s.why.title) items.push({ sys: 'v9', kind: 'title', scene: s.id, text: s.why.title, title_source: s.why.title_source });
  }
  const r = rng(seedOf(slug));
  const order = items.map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  const scenes = [...new Set(order.map((it) => it.scene))].sort();
  const blocks = scenes.map((id) => {
    const sc = segBy.get(id);
    let lines = cues.slice(sc.start_cue - 1, sc.end_cue);
    if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.scene === id).map((it) => `${it.id}: ${it.text}`);
    return [`### Scene ${id} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Notes to judge:', ...notes.map((n) => `  ${n}`)].join('\n');
  });
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
  const r = await runCodex(`v9-describe-${slug}`, prompt, schema);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const by = new Map((r.answer.notes ?? []).map((n) => [n.id, n]));
  const rows = items.map((it) => { const n = by.get(it.id); return { ...it, verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null }; });
  const tally = (f) => Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, rows.filter((x) => f(x) && (x.verdict ?? 'missing') === v).length]));
  return { slug, cached: !!r.cached, items: rows.length, v8_text: tally((x) => x.sys === 'v8'), v9_text: tally((x) => x.sys === 'v9' && x.kind === 'text'), v9_title: tally((x) => x.sys === 'v9' && x.kind === 'title'), rows };
}

const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(PAR, FILMS.length) }, async () => {
  while (next < FILMS.length) {
    const slug = FILMS[next++];
    try { const r = await judge(slug); results.push(r); console.log(`${slug}: v8 ${JSON.stringify(r.v8_text)} | v9 text ${JSON.stringify(r.v9_text)} | v9 title ${JSON.stringify(r.v9_title)}${r.cached ? ' (cached)' : ''}`); }
    catch (err) { console.error(`${slug}: ${err.message.slice(0, 300)}`); results.push({ slug, error: err.message.slice(0, 300) }); }
  }
}));
const ok = results.filter((r) => !r.error);
const pool = (k) => Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, ok.reduce((a, r) => a + r[k][v], 0)]));
// v9 text by why source (described / described+reason / plain_reason)
const bySource = {};
for (const r of ok) {
  const t9 = rj(path.join(V9, 'out', `${r.slug}.tags.r1.json`));
  const src = new Map(t9.scenes.filter((s) => s.flagged).map((s) => [s.id, s.why?.source]));
  for (const x of r.rows.filter((y) => y.sys === 'v9' && y.kind === 'text')) { const k = src.get(x.scene) ?? 'none'; bySource[k] ??= Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, 0])); bySource[k][x.verdict ?? 'missing']++; }
}
const out = { generated_at: new Date().toISOString(), judge: 'codex exec gpt-6-astra high read-only ephemeral (eval/judge-descriptions.mjs)', films: results.map((r) => r.slug), pooled: { v8_text: pool('v8_text'), v9_text: pool('v9_text'), v9_title: pool('v9_title') }, v9_text_by_source: bySource, per_film: results };
fs.mkdirSync(path.join(V9, 'out', 'eval'), { recursive: true });
fs.writeFileSync(path.join(V9, 'out', 'eval', 'descriptions.json'), JSON.stringify(out, null, 2));
console.log(`POOLED v8 text ${JSON.stringify(out.pooled.v8_text)}\n       v9 text ${JSON.stringify(out.pooled.v9_text)}\n       v9 title ${JSON.stringify(out.pooled.v9_title)}\n  v9 text by source ${JSON.stringify(bySource)}`);
