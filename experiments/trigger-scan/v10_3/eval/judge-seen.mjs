#!/usr/bin/env node
// v10.3 SEEN-FILM TEXT JUDGE: v10.2's, on the 19 seen films, systems v103 (out103/seen: tags + whyfinal, the merged
// two-attempt text), v102 (v10.2's text: out102/seen, or out102 as run for the round-8 films) and live; SAME PROMPT
// TEXT as round 8 (v10_2/round8/judge.mjs == v10_2/eval/judge-seen.mjs == round 7). Cache labels/codex/
// v103-seen-describe-<slug>. Output eval/out/judge-seen.json. v10.2's text follows.
// v10.2 SEEN-FILM TEXT JUDGE (evaluation only; Codex CLI, no API spend). The round-7 blind judge (v10_1/round7/judge.mjs),
// SAME PROMPT TEXT (accurate / partly / wrong / generic against the scene's subtitle lines + the Wikipedia plot, no film
// memory) and the same flags (codex exec --ignore-user-config -m gpt-6-astra -c model_reasoning_effort="high"
// --sandbox read-only --ephemeral), on the 16 seen films. Notes judged per film, pooled in ONE call, shuffled
// (seeded) with neutral ids; scene blocks neutral (K01..) and in time order; the judge never learns there are systems:
//   v102   every v10.2 flagged scene: its parent text, its title (not the 'Flagged scene' placeholder), and every
//          code-built reason clause ('Flagged because <phrase>.') and plain title as its own note (code_built)
//   v101g  every v10.1-gated flagged scene with a v10.1 why (round 7's offline variant: kept scenes keep v10.1 text)
//   live   every live scene: its description and title (15 films; up has no live baseline)
// Segmentation scenes shared by v102 and v101g are one block (same stored segmentation). Cache: labels/codex/
// v102-seen-describe-<slug>. Output eval/out/judge-seen.json (notes cut by the 8-word rule).
//   node eval/judge-seen.mjs [--films a,b] [--parallel 4] [--size]
import fs from 'node:fs';
import path from 'node:path';
import { formatTime } from '../../srt.js';
import { runCodex, obj } from '../codex.js';
import { transcriptGrams, enforceQuoteRule } from '../validate.js';
import { sourcesFile } from '../env.js';
import { parentPhrase } from '../reasons.js';
import { FILMS as ALL, loadFilm, liveFor, v102Dir, rj, V103, TS } from './seen-lib.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const FILMS = opt('films', ALL.join(',')).split(',');
const PAR = Number(opt('parallel', '4'));
const TAG = opt('tag', null) ? `-${opt('tag', null)}` : '';
const MAX_LINES = 140;
const VERDICTS = ['accurate', 'partly', 'wrong', 'generic'];
const hms = (ms) => formatTime(ms).slice(0, 8);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const seedOf = (str) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const low = (p) => p.replace(/^(The|A|An) /, (x) => x.toLowerCase());
const SEEN = path.join(V103, 'out103', 'seen');

/** The flagged scenes + why of v103 (out103/seen whyfinal) and v102 for one film. */
export function systemsFor(slug) {
  const F = loadFilm(slug);
  const t3 = rj(path.join(SEEN, `${slug}.tags.r1.json`)); const w3 = rj(path.join(SEEN, `${slug}.whyfinal.r1.json`));
  const v103 = t3.scenes.filter((s) => s.flagged).map((s) => { const w = w3.scenes[s.id]; return { id: s.id, why: w && w.reasons.join() === s.flag_reasons.map((r) => r.id).join() ? w.why : null }; });
  const t2 = rj(path.join(v102Dir(slug), `${slug}.tags.r1.json`)); const w2 = rj(path.join(v102Dir(slug), `${slug}.why.r1.json`));
  const v102 = t2.scenes.filter((s) => s.flagged).map((s) => ({ id: s.id, why: w2.scenes[s.id]?.why ?? null }));
  return { F, v103, v102 };
}

/** Notes of one system's flagged scenes (text, title, code-built reason clauses and plain titles). */
function notesOf(sys, list, items) {
  const out = [];
  for (const s of list) {
    const w = s.why; if (!w) continue;
    if (w.text) out.push({ sys, kind: 'text', scene: s.id, skey: `seg:${s.id}`, text: w.text, source: w.source, ...(w.text_attempt ? { attempt: w.text_attempt } : {}) });
    if (w.title && w.title_source !== 'none') out.push({ sys, kind: 'title', scene: s.id, skey: `seg:${s.id}`, text: w.title, title_source: w.title_source, code_built: w.title_source === 'plain', ...(w.title_attempt ? { attempt: w.title_attempt } : {}) });
    const m = /Flagged because ([^.]+)\.$/.exec(w.text ?? '');
    if (m) {
      const phrases = [...new Set((w.stated_reasons ?? []).map((id) => low(parentPhrase({ id }, items))))].filter((ph) => m[1].includes(ph));
      for (const ph of (phrases.length ? phrases : [m[1]])) out.push({ sys, kind: 'reason', scene: s.id, skey: `seg:${s.id}`, text: `Flagged because ${ph}.`, code_built: true });
    }
  }
  return out;
}

export async function build(slug) {
  const { F, v103, v102 } = systemsFor(slug);
  const live = await liveFor(slug);
  const src = rj(sourcesFile(slug));
  const segBy = new Map(F.seg.scenes.map((s) => [s.id, s]));
  const items = [...notesOf('v103', v103, F.items), ...notesOf('v102', v102, F.items)];
  for (const s of live.scenes ?? []) {
    if (s.description) items.push({ sys: 'live', kind: 'text', scene: s.id, skey: `live:${s.id}`, text: s.description });
    if (s.title) items.push({ sys: 'live', kind: 'title', scene: s.id, skey: `live:${s.id}`, text: s.title });
  }
  const scenes = [];
  for (const k of new Set(items.map((x) => x.skey))) {
    if (k.startsWith('seg:')) { const sc = segBy.get(k.slice(4)); scenes.push({ key: k, start_ms: sc.start_ms, end_ms: sc.end_ms, lines: F.cues.slice(sc.start_cue - 1, sc.end_cue) }); }
    else { const s = live.scenes.find((x) => `live:${x.id}` === k); scenes.push({ key: k, start_ms: s.start_ms, end_ms: s.end_ms, lines: F.cues.filter((c) => c.startMs >= s.start_ms && c.startMs < s.end_ms) }); }
  }
  const r = rng(seedOf(`v103-seen:${slug}`));
  // a note shared verbatim by v103 and v102 on the same scene is judged once (both systems get its label)
  const uniq = new Map();
  for (const it of items) { const k = `${it.skey}|${it.kind}|${it.text}`; if (!uniq.has(k)) uniq.set(k, { ...it, systems: [it.sys] }); else uniq.get(k).systems.push(it.sys); }
  const order = [...uniq.values()].map((it) => [r(), it]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  order.forEach((it, k) => { it.id = `N${String(k + 1).padStart(3, '0')}`; });
  scenes.sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms || (r() - 0.5));
  scenes.forEach((s, k) => { s.label = `K${String(k + 1).padStart(2, '0')}`; });
  const blocks = scenes.map((sc) => {
    let lines = sc.lines;
    if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES / 2), ...lines.slice(-MAX_LINES / 2)];
    const notes = order.filter((it) => it.skey === sc.key).map((it) => `${it.id}: ${it.text}`);
    return [`### Scene ${sc.label} (${hms(sc.start_ms)}-${hms(sc.end_ms)})`, 'Subtitle lines:', ...lines.map((c) => `  [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}`), 'Notes to judge:', ...notes.map((n) => `  ${n}`)].join('\n');
  });
  // identical to v10_1/round7/judge.mjs's (= round6 / eval/judge-descriptions.mjs) prompt
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
  return { items: order, prompt, cues: F.cues, v103, v102 };
}

const schema = obj({ notes: { type: 'array', items: obj({ id: { type: 'string' }, verdict: { type: 'string', enum: VERDICTS }, why: { type: 'string' } }) } });

async function judge(slug) {
  const { items, prompt, cues } = await build(slug);
  if (argv.includes('--size')) return { slug, size: prompt.length, items: items.length };
  const r = await runCodex(`v103-seen-describe${TAG}-${slug}`, prompt, schema);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const by = new Map((r.answer.notes ?? []).map((n) => [n.id, n]));
  const rows = items.flatMap((it) => { const n = by.get(it.id); return it.systems.map((sys) => ({ ...it, sys, verdict: n?.verdict ?? null, why: n ? enforceQuoteRule(n.why ?? '', grams).text : null })); });
  return { slug, cached: !!r.cached, rows };
}
const tally = (rows) => Object.fromEntries([...VERDICTS, 'missing'].map((v) => [v, rows.filter((x) => (x.verdict ?? 'missing') === v).length]));
const share = (t) => { const n = t.accurate + t.partly + t.wrong + t.generic; return n ? Math.round((t.accurate / n) * 1000) / 1000 : null; };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(PAR, FILMS.length) }, async () => {
    while (next < FILMS.length) {
      const slug = FILMS[next++];
      try { const x = await judge(slug); results.push(x); if (argv.includes('--size')) console.log(JSON.stringify(x)); else { const f = (s, k) => JSON.stringify(tally(x.rows.filter((y) => y.sys === s && y.kind === k))); console.log(`${slug}${x.cached ? ' (cached)' : ''}: v103 text ${f('v103', 'text')} title ${f('v103', 'title')} | v102 text ${f('v102', 'text')} | live text ${f('live', 'text')}`); } }
      catch (err) { console.error(`${slug}: ${err.message.slice(0, 300)}`); results.push({ slug, error: err.message.slice(0, 300) }); }
    }
  }));
  if (argv.includes('--size')) process.exit(0);
  const ok = results.filter((x) => !x.error);
  const sum = (films, sys, kind, extra = () => true) => tally(ok.filter((x) => films.includes(x.slug)).flatMap((x) => x.rows.filter((y) => y.sys === sys && y.kind === kind && extra(y))));
  const groups = { all: ok.map((x) => x.slug), with_live: ok.map((x) => x.slug).filter((s) => s !== 'up'), round8: ['incredibles', 'big-hero-6', 'brave'], dev16: ok.map((x) => x.slug).filter((s) => !['incredibles', 'big-hero-6', 'brave'].includes(s)) };
  const summary = Object.fromEntries(Object.entries(groups).map(([g, films]) => {
    const o = {};
    for (const sys of ['v103', 'v102', 'live']) for (const kind of ['text', 'title']) { const t = sum(films, sys, kind); o[`${sys}_${kind}`] = { ...t, accurate_share: share(t) }; }
    o.v103_code_built = sum(films, 'v103', 'reason'); o.v103_plain_title = sum(films, 'v103', 'title', (y) => y.code_built);
    // v10.3: the second attempt's notes apart (text_attempt / title_attempt 2)
    o.v103_text_attempt2 = sum(films, 'v103', 'text', (y) => y.attempt === 2); o.v103_title_attempt2 = sum(films, 'v103', 'title', (y) => y.attempt === 2);
    o.v103_text_attempt1 = sum(films, 'v103', 'text', (y) => y.attempt === 1); o.v103_title_attempt1 = sum(films, 'v103', 'title', (y) => y.attempt === 1);
    return [g, o];
  }));
  const out = { generated_at: new Date().toISOString(), judge: 'codex exec --ignore-user-config -m gpt-6-astra -c model_reasoning_effort="high" --sandbox read-only --ephemeral (prompt identical to v10_2/round8/judge.mjs)', label: 'IN-SAMPLE seen films', summary, per_film: results };
  fs.mkdirSync(path.join(V103, 'eval', 'out'), { recursive: true });
  fs.writeFileSync(path.join(V103, 'eval', 'out', `judge-seen${TAG ? `.${TAG.slice(1)}` : ''}.json`), JSON.stringify(out, null, 2));
  for (const [g, o] of Object.entries(summary)) console.log(`${g}: v103 text ${JSON.stringify(o.v103_text)} | v102 text ${JSON.stringify(o.v102_text)} | live text ${JSON.stringify(o.live_text)} | v103 title ${JSON.stringify(o.v103_title)} | v102 title ${JSON.stringify(o.v102_title)} | v103 attempt-2 text ${JSON.stringify(o.v103_text_attempt2)} title ${JSON.stringify(o.v103_title_attempt2)}`);
}
