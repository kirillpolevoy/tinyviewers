#!/usr/bin/env node
// v10.3 fix (d): THE SECOND DESCRIBE ATTEMPT (Sonnet) and the TEXT MERGE (code).
//
// Round 8: 29 of 54 flagged scenes showed no text and 30 of 54 the 'Flagged scene' placeholder title -- 14 of them at
// severity 3. Sonnet's first notes were mostly true, but they stated events the cited lines only hint at ("Nemo gets
// stuck in a pipe" citing "Daddy! Help me! - He's stuck."), so Jev's claim check (support >= 0.75 against the cited
// lines +- 2) could not confirm them and v10.2 showed nothing. Code-built reasons stay OFF (v10.2: 11 false of 187).
// v10.3 asks Sonnet ONCE MORE, only for flagged scenes whose first text or title failed the check, with the flagged
// reasons and a wider window of the scene's lines (the skip spans +- RETRY_PAD_LINES), and asks for notes a checker can
// confirm from the cited lines alone: say what the lines themselves say happens, name who the lines name, cite every
// line relied on; a short quote (<= 8 words) is allowed. Every new title and sentence then goes through the SAME check
// as the first attempt (check-describe.js --attempt 2: Jev support at the text / title margins, placement, the plot
// path, the direction check) -- nothing reaches a parent unchecked, and there is no code-built text.
// TITLE PASS (--titles, Sonnet, attempt 3): a flagged scene that now has a verified text but still no verified title
// gets one more request for a TITLE ONLY (<= 7 words) restating that confirmed text, given only the confirmed
// sentences and the sources they cite; checked by check-describe.js --attempt 3 like every title (Jev support at the
// title margin + the direction check). A title is a claim like any other: no code-built title exists.
// MERGE (--merge, code): per flagged scene, the first attempt's verified text if any, else the second attempt's; the
// first attempt's verified title if any, else the second's, else the title pass's; else no text / 'Flagged scene'.
//
//   node describe2.js <slug> [--run r1] [--cap 0.12] [--dry] [--final-held-out-run]   -> <out>/<slug>.describe2.<run>.json
//   node describe2.js <slug> --titles [--run r1] [--cap 0.04] [--dry] [--final-held-out-run] -> <out>/<slug>.describe3.<run>.json
//   node describe2.js <slug> --merge [--run r1] [--final-held-out-run]                  -> <out>/<slug>.whyfinal.<run>.json
// Money: one call per <= PER_CALL retried scenes; each reserves counted input + 2,000 schema margin + max_tokens of
// output against --cap minus this script's earlier spend on the film (ledger). The file is written after every call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt, formatTime } from '../srt.js';
import { callClaude, countTokens, costUsd, PRICES } from './sonnet.js';
import { budget } from './budget.js';
import { outDir, sourcesFile, heldOutGate } from './env.js';
import { readLedger, record } from './ledger.js';
import { transcriptGrams } from './validate.js';
import { anchorsOf } from './fill.js';
import { castForScene, verifiedSentences } from './questions.js';
import { parentPhrase, rankReasons } from './reasons.js';
import { SONNET_MODEL, MAX_LINES, PER_CALL, sceneW, schemaFor, validateScene } from './describe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESCRIBE2_VERSION = 'describe2-v10.3';
const SCRIPT = 'describe2.js';
export const RETRY_PAD_LINES = 8;
const hms = (ms) => formatTime(ms).slice(0, 8);

export const SYSTEM2 = `You write the short notes a parent reads in a scene guide for a children's film: for each listed scene, a TITLE and one or two sentences saying what happens, so the parent knows why the scene is on the guide's list.

An earlier note for each of these scenes could not be confirmed: a checker reads ONLY the sources a sentence cites (and the lines right next to them) and must find the sentence stated there. Write notes that pass that check.

THE SOURCE RULE. Use ONLY the numbered sources given for that scene:
  L-lines: its subtitle lines, "L<cue> [<time>] <text>"; text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics. Subtitles rarely name the speaker.
  W-sentences: sentences of the plot section of the film's English Wikipedia article that may belong to this scene, "W<n> <sentence>".
  T-entries: TMDB cast list entries of characters in the scene, "T<n> <character name>".
Do NOT use your own knowledge or memory of this film, even if you are sure of it.

HOW TO WRITE A NOTE THE CHECKER CAN CONFIRM:
- Say what the cited lines themselves say or show happening: who cries for help, who shouts that someone is stuck, who screams, who says they will hurt someone, what a sound caption says happens. Stay close to the lines' own words; a short quote of at most eight words is allowed.
- Every part of a sentence must be stated by a line it cites: do not add where someone is, how they look, what they feel, or why they act unless a cited line says so. A short, literal sentence that the lines fully state is better than a vivid one they only suggest.
- Cite EVERY line the sentence relies on, and only lines that say it (not lines that merely come before it). Cite a W-sentence only when your sentence says what that plot sentence says and the scene's lines show the same event.
- Name a character only when the cited lines or the cited plot sentence name them; otherwise describe them ("a woman shouts that a man will jump").
- "flagged for" says what the guide's checks found in the scene. If the lines show it, say it plainly (a death, an injury, a threat, a capture or a loss must be stated plainly). If they do not, write only what they do show about the danger or upset; never invent it. Return no sentences if the lines and plot sentences do not say what happens.
- Title: at most 7 words that restate the main event of one of your sentences (the same event, the same cites), naming who does what as the lines say it (e.g. "Nemo cries for help, stuck in a pipe"); not a mood, not a summary of the whole scene, nothing the cited lines do not state.
- If a scene lists a "confirmed note", that note already passed the check: write only a TITLE that restates its main event, with the lines it cites, and return no sentences for that scene.
- One or two sentences, each at most 25 words, each able to stand alone (name the character or describe them; no "he", "this" or "then" pointing at another sentence).
- Describe events, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic, menacing.
- Return one entry for EVERY scene id listed, even when you can give it no sentences.`;

/** The retry prompt: describe.js's format plus, for a scene whose first text passed, that confirmed note. */
export function userPrompt2(film, ctxs) {
  const parts = [`Film: ${film.title}${film.year ? ` (${film.year})` : ''}. Scenes on the guide's list: ${ctxs.length}. Return one entry per scene id: ${ctxs.map((c) => c.id).join(', ')}.`];
  for (const c of ctxs) {
    parts.push([
      `=== ${c.id} (${hms(c.start_ms)}-${hms(c.end_ms)}) ===`,
      `flagged for: ${c.flagged_for.join('; ')}`,
      ...(c.confirmed?.length ? [`confirmed note: ${c.confirmed.map((x) => `${x.text} [${x.cites.join(', ')}]`).join(' ')}`] : []),
      `T-entries: ${c.t.length ? c.t.map((x) => x.text).join(' | ') : 'none'}`,
      'W-sentences:', ...(c.w.length ? c.w.map((x) => x.text) : ['none']),
      'L-lines:', ...c.lines.map((x) => x.text),
    ].join('\n'));
  }
  return parts.join('\n\n');
}

/** Lines of a retried scene: its skip spans +- RETRY_PAD_LINES, at most MAX_LINES (densest around the middle). */
export function retryLines(scene, cues) {
  const sc = cues.slice(scene.start_cue - 1, scene.end_cue);
  const spans = scene.skip?.spans ?? [];
  let idx = sc.map((c, i) => (spans.some((s) => c.endMs > s.start_ms && c.startMs < s.end_ms) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) idx = sc.map((_, i) => i);
  const lo = Math.max(0, idx[0] - RETRY_PAD_LINES);
  const hi = Math.min(sc.length - 1, idx.at(-1) + RETRY_PAD_LINES);
  let pick = sc.slice(lo, hi + 1);
  if (pick.length > MAX_LINES) { const mid = Math.floor(pick.length / 2); pick = pick.slice(Math.max(0, mid - MAX_LINES / 2), Math.max(0, mid - MAX_LINES / 2) + MAX_LINES); }
  return pick;
}

/** Flagged scenes whose first attempt left no verified text or no verified title (why.r1.json). Pure. */
export function retryScenes(tags, why) {
  return tags.scenes.filter((s) => s.flagged).map((s) => ({ s, w: why?.scenes?.[s.id]?.why ?? null })).filter(({ w }) => !w || !w.text || w.title_source !== 'sonnet_verified').map(({ s, w }) => ({ id: s.id, need: [...(!w?.text ? ['text'] : []), ...(w?.title_source !== 'sonnet_verified' ? ['title'] : [])] }));
}

export function buildRetryContexts({ seg, tags, cues, src, items, ids, why = null }) {
  const anchors = anchorsOf(seg);
  const segIndex = new Map(seg.scenes.map((s, i) => [s.id, i]));
  return tags.scenes.filter((s) => s.flagged && ids.has(s.id)).map((t) => {
    const i = segIndex.get(t.id);
    const sseg = seg.scenes[i];
    const lines = retryLines({ ...sseg, skip: t.skip }, cues);
    const w = sceneW(seg, i, anchors, src.W.length);
    const cast = castForScene(seg.cast, verifiedSentences(sseg).join(' '), cues.slice(sseg.start_cue - 1, sseg.end_cue).map((c) => c.text));
    const tIds = [...new Set(cast.map((c) => c.tmdb).filter((x) => /^T\d+$/.test(x ?? '')))];
    const reasons = rankReasons(t.flag_reasons, items).slice(0, 3);
    // the first attempt's VERIFIED sentences of this scene (title-only retry): shown as the confirmed note, their
    // cited lines added to the lines the writer sees
    const w1 = why?.scenes?.[t.id];
    const confirmed = w1?.why?.text ? (w1.checked ?? []).filter((c) => !c.key.endsWith('title') && c.final === 'verified').map((c) => ({ text: c.text, cites: c.cites })) : [];
    const have = new Set(lines.map((c) => c.index));
    const extra = confirmed.flatMap((x) => x.cites.filter((id) => id[0] === 'L').map((id) => Number(id.slice(1)))).filter((n) => !have.has(n) && n >= sseg.start_cue && n <= sseg.end_cue).map((n) => cues[n - 1]);
    const allLines = [...lines, ...extra].sort((a, b) => a.index - b.index);
    return {
      id: t.id, start_ms: t.start_ms, end_ms: t.end_ms,
      flagged_for: [...new Set(reasons.map((r) => parentPhrase(r, items)))],
      reasons: reasons.map((r) => r.id),
      confirmed,
      lines: allLines.map((c) => ({ id: `L${c.index}`, text: `L${c.index} [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}` })),
      w: w.map((n) => ({ id: `W${n}`, text: `W${n} ${src.W[n - 1].text}` })),
      t: tIds.map((id) => ({ id, text: `${id} ${src.T[Number(id.slice(1)) - 1].character}` })),
    };
  });
}

/**
 * MERGE (pure): the parent text of one flagged scene from the first (w1) and second (w2) checked attempts.
 * text / sentences from the first attempt when it has a verified text, else the second's; the title likewise.
 */
export function mergeWhy(w1, w2, w3 = null) {
  const t1 = !!w1?.text; const t2 = !!w2?.text;
  const h1 = w1?.title_source === 'sonnet_verified'; const h2 = w2?.title_source === 'sonnet_verified'; const h3 = w3?.title_source === 'sonnet_verified';
  const text = t1 ? w1 : t2 ? w2 : null;
  const base = text ?? w1 ?? w2 ?? { source: 'no_verified_text', text: null, sentences: [] };
  const title = h1 ? { title: w1.title, title_source: 'sonnet_verified', title_attempt: 1 } : h2 ? { title: w2.title, title_source: 'sonnet_verified', title_attempt: 2 } : h3 ? { title: w3.title, title_source: 'sonnet_verified', title_attempt: 3 } : { title: 'Flagged scene', title_source: 'none', title_attempt: null };
  return { ...base, ...title, text_attempt: t1 ? 1 : t2 ? 2 : null, sentences: (text?.sentences ?? []).map((k) => (t1 || !t2 ? k : `a2:${k}`)) };
}

export const SYSTEM3 = `You write the TITLE of a note in a parent's scene guide for a children's film. Each scene below has a CONFIRMED NOTE: one or two sentences a checker has already confirmed against the numbered sources they cite (the sources are shown).

For each scene write a title of AT MOST 7 WORDS that restates the main event of its confirmed note: who does what, as the note and its sources say it (e.g. "Nemo cries for help, stuck in a pipe"). Use ONLY the confirmed note and the sources shown; do NOT use your own knowledge or memory of this film. Cite the source ids the title relies on (they must be among the note's). Name the event, never a mood: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic, menacing. Never copy more than eight words in a row from a source. Return one entry for EVERY scene id, with an empty sentences list.`;

/** Title-pass prompt: per scene only the confirmed note and the sources it cites. */
export function userPrompt3(film, ctxs) {
  const parts = [`Film: ${film.title}${film.year ? ` (${film.year})` : ''}. Scenes: ${ctxs.length}. Return one entry per scene id: ${ctxs.map((c) => c.id).join(', ')}.`];
  for (const c of ctxs) parts.push([`=== ${c.id} ===`, `confirmed note: ${c.confirmed.map((x) => `${x.text} [${x.cites.join(', ')}]`).join(' ')}`, 'sources:', ...[...c.lines, ...c.w, ...c.t].map((x) => x.text)].join('\n'));
  return parts.join('\n\n');
}

/** Flagged scenes with a verified text (attempt 1 or 2) and no verified title after attempts 1-2, with the checked
 * sentences that make up that text: [{ id, confirmed: [{ text, cites }] }]. Pure. */
export function titleScenes(tags, why1, why2) {
  const out = [];
  for (const s of tags.scenes.filter((x) => x.flagged)) {
    const a = why1?.scenes?.[s.id]; const b = why2?.scenes?.[s.id];
    const okB = b && a && b.reasons.join() === a.reasons.join();
    const m = mergeWhy(a?.why, okB ? b.why : null);
    if (!m.text || m.title_source === 'sonnet_verified') continue;
    const src = m.text_attempt === 1 ? a : b;
    const confirmed = (src.checked ?? []).filter((c) => !c.key.endsWith('title') && c.final === 'verified').map((c) => ({ text: c.text, cites: c.cites }));
    if (confirmed.length) out.push({ id: s.id, confirmed });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--effort'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node describe2.js <slug> [--run r1] [--cap 0.12] [--dry] | --merge'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
  const why1 = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.why.${runId}.json`), 'utf8'));
  if (argv.includes('--merge')) {
    const f2 = path.join(OUT, `${slug}.why2.${runId}.json`);
    const why2 = fs.existsSync(f2) ? JSON.parse(fs.readFileSync(f2, 'utf8')) : { scenes: {} };
    const d2f = path.join(OUT, `${slug}.describe2.${runId}.json`); const d3f = path.join(OUT, `${slug}.describe3.${runId}.json`); const f3 = path.join(OUT, `${slug}.why3.${runId}.json`);
    const retried = new Set(Object.keys(fs.existsSync(d2f) ? JSON.parse(fs.readFileSync(d2f, 'utf8')).scenes ?? {} : {}));
    const titled = new Set(Object.keys(fs.existsSync(d3f) ? JSON.parse(fs.readFileSync(d3f, 'utf8')).scenes ?? {} : {}));
    const why3 = fs.existsSync(f3) ? JSON.parse(fs.readFileSync(f3, 'utf8')) : { scenes: {} };
    const scenes = {};
    for (const [id, s1] of Object.entries(why1.scenes)) {
      const s2 = retried.has(id) ? why2.scenes?.[id] : null; const s3 = titled.has(id) ? why3.scenes?.[id] : null;
      // a later attempt counts only when it was checked for the SAME flag reasons
      const ok2 = s2 && s2.reasons.join() === s1.reasons.join(); const ok3 = s3 && s3.reasons.join() === s1.reasons.join();
      scenes[id] = { reasons: s1.reasons, attempt1: { text: s1.why.text, title_source: s1.why.title_source }, ...(ok2 ? { attempt2: { text: s2.why.text, title: s2.why.title, title_source: s2.why.title_source, checked: s2.checked } } : {}), ...(ok3 ? { attempt3: { title: s3.why.title, title_source: s3.why.title_source, checked: s3.checked } } : {}), why: mergeWhy(s1.why, ok2 ? s2.why : null, ok3 ? s3.why : null) };
    }
    const n = Object.values(scenes);
    const out = { film: why1.film, version: DESCRIBE2_VERSION, run: runId, merged_at: new Date().toISOString(), flagged: n.length, retried: retried.size, title_pass: titled.size, no_text: n.filter((x) => !x.why.text).length, placeholder_title: n.filter((x) => x.why.title_source !== 'sonnet_verified').length, text_from_attempt2: n.filter((x) => x.why.text_attempt === 2).length, title_from_attempt2: n.filter((x) => x.why.title_attempt === 2).length, title_from_attempt3: n.filter((x) => x.why.title_attempt === 3).length, scenes };
    fs.writeFileSync(path.join(OUT, `${slug}.whyfinal.${runId}.json`), JSON.stringify(out, null, 2));
    console.log(`${slug}: merged ${out.flagged} flagged (retried ${out.retried}, title pass ${out.title_pass}); text from attempt 2: ${out.text_from_attempt2}, titles from attempts 2 / 3: ${out.title_from_attempt2} / ${out.title_from_attempt3}; no text ${out.no_text}, placeholder title ${out.placeholder_title}`);
    process.exit(0);
  }
  const seg = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8')).film_items ?? [];
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const src = { W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const film = { title: SRC.film.title, year: SRC.film.year ?? seg.film.year ?? null };
  if (argv.includes('--titles')) {
    const f2 = path.join(OUT, `${slug}.why2.${runId}.json`);
    const why2 = fs.existsSync(f2) ? JSON.parse(fs.readFileSync(f2, 'utf8')) : { scenes: {} };
    const want3 = titleScenes(tags, why1, why2);
    const idsIn = (x) => [...new Set(x.flatMap((c) => c.cites))];
    const ctx3 = want3.map((x) => { const ids = idsIn(x.confirmed); const sc = tags.scenes.find((t) => t.id === x.id); const reasons = rankReasons(sc.flag_reasons, items).slice(0, 3);
      return { id: x.id, confirmed: x.confirmed, reasons: reasons.map((r) => r.id), flagged_for: [...new Set(reasons.map((r) => parentPhrase(r, items)))],
        lines: ids.filter((i) => i[0] === 'L').map((i) => { const c = cues[Number(i.slice(1)) - 1]; return { id: i, text: `${i} [${hms(c.startMs)}] ${String(c.text).replace(/\n/g, ' / ')}` }; }),
        w: ids.filter((i) => i[0] === 'W').map((i) => ({ id: i, text: `${i} ${src.W[Number(i.slice(1)) - 1].text}` })), t: ids.filter((i) => i[0] === 'T').map((i) => ({ id: i, text: `${i} ${src.T[Number(i.slice(1)) - 1].character}` })) }; });
    const outFile3 = path.join(OUT, `${slug}.describe3.${runId}.json`);
    const CAP3 = Number(opt('cap', '0.04'));
    const prior3 = readLedger(slug).entries.filter((e) => e.script === `${SCRIPT} --titles` && e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0);
    const wallet3 = budget(Math.max(0, CAP3 - prior3));
    const [pIn3, pOut3] = PRICES[SONNET_MODEL];
    const grams3 = transcriptGrams(cues.map((c) => c.text), 9);
    const scenes3 = {}; const calls3 = [];
    const save3 = () => fs.writeFileSync(outFile3, JSON.stringify({ film: seg.film, version: `${DESCRIBE2_VERSION} titles`, run: runId, model: SONNET_MODEL, run_at: new Date().toISOString(), calls: calls3, cost_usd: +calls3.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6), asked: ctx3.length, titles: Object.values(scenes3).filter((x) => x.title).length, missing: ctx3.filter((c) => !scenes3[c.id]?.returned).map((c) => c.id), scenes: scenes3 }, null, 2));
    console.log(`${slug}: title pass for ${ctx3.length} flagged scenes with a verified text and no verified title; cap $${CAP3} (spent before $${prior3.toFixed(4)})`);
    if (!ctx3.length) { save3(); process.exit(0); }
    const askT = async (chunk, k) => {
      const user = userPrompt3(film, chunk);
      const counted = argv.includes('--dry') ? null : await countTokens({ model: SONNET_MODEL, system: SYSTEM3, user });
      const worst = (((counted ?? Math.ceil((SYSTEM3.length + user.length) / 2.5)) + 2000) * pIn3 + Math.min(4000, 300 + chunk.length * 90) * pOut3) / 1e6;
      console.log(`  call ${k}: ${chunk.length} scenes, input ${counted ?? 'not counted'} tok, reserving $${worst.toFixed(4)}`);
      if (argv.includes('--dry')) return;
      if (!wallet3.reserve(worst)) { save3(); console.error(`REFUSED: worst case $${worst.toFixed(4)} breaks the cap`); process.exit(3); }
      let cost = worst; const row = { call: k, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
      try {
        const r = await callClaude({ model: SONNET_MODEL, system: SYSTEM3, user, schema: schemaFor(chunk.map((c) => c.id)), maxTokens: Math.min(4000, 300 + chunk.length * 90), effort: 'low' });
        cost = costUsd(SONNET_MODEL, r.usage); Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6) });
        for (const c of chunk) { const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null; if (!raw && scenes3[c.id]?.returned) continue; const v = validateScene(raw ? { ...raw, sentences: [] } : null, c, grams3); scenes3[c.id] = { reasons: c.reasons, flagged_for: c.flagged_for, confirmed: c.confirmed.map((x) => x.text), evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...v, sentences: [] }; }
      } catch (err) { cost = err.rejected ? 0 : err.usage && Object.keys(err.usage).length ? costUsd(SONNET_MODEL, err.usage) : worst; row.error = err.message; row.cost_usd = +cost.toFixed(6); console.error(`  call ${k} ERROR ${err.message.slice(0, 300)}`); }
      finally { wallet3.settle(worst, cost); if (cost > 0) record(slug, { script: `${SCRIPT} --titles`, kind: 'sonnet', usd: cost, note: `${DESCRIBE2_VERSION} titles call ${k} ${chunk.length} scenes` }); calls3.push(row); save3(); }
    };
    const ch3 = []; for (let k = 0; k < ctx3.length; k += 30) ch3.push(ctx3.slice(k, k + 30));
    for (const [k, c] of ch3.entries()) await askT(c, k + 1);
    const left3 = ctx3.filter((c) => !scenes3[c.id]?.returned);
    if (left3.length && !argv.includes('--dry')) { console.log(`  ${left3.length} scenes missing from the answer: asked once more`); await askT(left3, ch3.length + 1); }
    if (!argv.includes('--dry')) console.log(`  ${Object.values(scenes3).filter((x) => x.title).length}/${ctx3.length} titles kept by code; $${calls3.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6)}`);
    process.exit(0);
  }
  const want = retryScenes(tags, why1);
  const ctxs = buildRetryContexts({ seg, tags, cues, src, items, ids: new Set(want.map((x) => x.id)), why: why1 });
  const outFile = path.join(OUT, `${slug}.describe2.${runId}.json`);
  const CAP = Number(opt('cap', '0.12'));
  const EFFORT = opt('effort', 'low');
  const prior = readLedger(slug).entries.filter((e) => e.script === SCRIPT && e.kind === 'sonnet').reduce((a, e) => a + e.usd, 0);
  const wallet = budget(Math.max(0, CAP - prior));
  const [pIn, pOut] = PRICES[SONNET_MODEL];
  const chunks = [];
  for (let k = 0; k < ctxs.length; k += PER_CALL) chunks.push(ctxs.slice(k, k + PER_CALL));
  console.log(`${slug}: ${ctxs.length} flagged scenes to retry (${want.filter((x) => x.need.includes('text')).length} without text, ${want.filter((x) => x.need.includes('title')).length} without a title) in ${chunks.length} calls; cap $${CAP} (spent before $${prior.toFixed(4)})`);
  const grams = transcriptGrams(cues.map((c) => c.text), 9);
  const calls = []; const outScenes = {};
  const save = () => {
    const n = Object.values(outScenes);
    const o = { film: seg.film, version: DESCRIBE2_VERSION, run: runId, model: SONNET_MODEL, effort: EFFORT, run_at: new Date().toISOString(), calls, cost_usd: +calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0).toFixed(6), flagged: tags.scenes.filter((s) => s.flagged).length, retried: ctxs.length, need: Object.fromEntries(want.map((x) => [x.id, x.need])), returned: n.filter((x) => x.returned).length, sentences: n.reduce((a, x) => a + x.sentences.length, 0), rejected: n.reduce((a, x) => a + x.rejected.length, 0), titles: n.filter((x) => x.title).length, missing: ctxs.filter((c) => !outScenes[c.id]?.returned).map((c) => c.id), scenes: outScenes };
    fs.writeFileSync(outFile, JSON.stringify(o, null, 2));
    return o;
  };
  if (!ctxs.length) { save(); console.log('  nothing to retry'); process.exit(0); }
  const ask = async (chunk, k) => {
    const user = userPrompt2(film, chunk);
    const counted = argv.includes('--dry') ? null : await countTokens({ model: SONNET_MODEL, system: SYSTEM2, user });
    const inWorst = (counted ?? Math.ceil((SYSTEM2.length + user.length) / 2.5)) + 2000;
    const maxTokens = Math.min(8000, 400 + chunk.length * 300);
    const worst = (inWorst * pIn + maxTokens * pOut) / 1e6;
    console.log(`  call ${k}: ${chunk.length} scenes, input ${counted ?? 'not counted'} tok, reserving $${worst.toFixed(4)}`);
    if (argv.includes('--dry')) return;
    if (!wallet.reserve(worst)) { save(); console.error(`REFUSED: worst case $${worst.toFixed(4)} breaks the cap (answers so far saved)`); process.exit(3); }
    let cost = worst;
    const row = { call: k, scenes: chunk.map((c) => c.id), counted_input: counted, reserved_usd: +worst.toFixed(6) };
    try {
      const r = await callClaude({ model: SONNET_MODEL, system: SYSTEM2, user, schema: schemaFor(chunk.map((c) => c.id)), maxTokens, effort: EFFORT });
      cost = costUsd(SONNET_MODEL, r.usage);
      Object.assign(row, { usage: r.usage, cost_usd: +cost.toFixed(6), latency_ms: r.latencyMs });
      for (const c of chunk) {
        const raw = (r.data.scenes ?? []).find((x) => x.id === c.id) ?? null;
        if (!raw && outScenes[c.id]?.returned) continue;
        outScenes[c.id] = { flagged_for: c.flagged_for, reasons: c.reasons, confirmed: c.confirmed.map((x) => x.text), evidence_ids: { lines: c.lines.map((x) => x.id), w: c.w.map((x) => x.id), t: c.t.map((x) => x.id) }, ...validateScene(raw, c, grams) };
      }
    } catch (err) {
      cost = err.rejected ? 0 : err.usage && Object.keys(err.usage).length ? costUsd(SONNET_MODEL, err.usage) : worst;
      row.error = err.message; row.cost_usd = +cost.toFixed(6);
      console.error(`  call ${k} ERROR ${err.message.slice(0, 300)}`);
    } finally {
      wallet.settle(worst, cost);
      if (cost > 0) record(slug, { script: SCRIPT, kind: 'sonnet', usd: cost, note: `${DESCRIBE2_VERSION} call ${k} ${chunk.length} scenes` });
      calls.push(row);
      save();
    }
  };
  for (const [k, chunk] of chunks.entries()) await ask(chunk, k + 1);
  // scenes the model left out of its answer are asked once more, on their own call
  const left = ctxs.filter((c) => !outScenes[c.id]?.returned);
  if (left.length && !argv.includes('--dry')) { console.log(`  ${left.length} scenes missing from the answer: asked once more`); await ask(left, chunks.length + 1); }
  if (argv.includes('--dry')) process.exit(0);
  const out = save();
  console.log(`  ${out.returned}/${out.retried} scenes returned, ${out.sentences} sentences kept, ${out.rejected} rejected by code, ${out.titles} titles; $${out.cost_usd}${out.missing.length ? `; MISSING ${out.missing.join(',')}` : ''}`);
  if (out.missing.length || calls.some((c) => c.error)) process.exitCode = 1;
}
