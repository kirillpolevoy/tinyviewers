#!/usr/bin/env node
// v10.2 (fixes 1, 2, 4): (1) the reasons checked and stated are the scene's flag reasons after the tier-A gate and
// the resolution guard (select.js), so a gated-out reason is never written; (2) the crying reason is stated only
// when Jev said the one who cries is a child (reason.child 'jev_child'); (4) the PLOT PATH: a title or sentence that
// cites a Wikipedia plot sentence and fails the lines-based check is still shown when
//   (a) Jev's claim check supports it against THAT plot sentence alone (evidence = only its cited W-sentences;
//       the text margin text_safety.accept), and its lines-based check did not contradict it;
//   (b) v8's placement places it in this scene (fill.js): every cited W-sentence is one describe.js gave this
//       scene (its anchors / verified cites / exclusive order window), and the neighbour test -- do the 8 lines
//       before or after the scene show this event? -- says neither at p >= fill.neighbour_min (0.8). As in v8's fill,
//       the own-lines placement answer is recorded, not gating (a wordless key moment has no lines to show it);
//   (c) the direction check (if it parses as 'X threatens Y') is not reversed.
// Wordless key moments (Good Dinosaur S015 Poppa's death, Frozen's heart strikes) are true in the plot but not in
// the lines; v10.1 deleted every such sentence.
// v10.2 CODE-BUILT REASONS OFF (policy text_safety.code_built_reasons false): no 'Flagged because ...' line and no
// plain title is ever built from a flag reason. On the 16 seen films the blind truth judge found 11 false code-built
// reasons among v10.2's 187 (9 lines, 2 plain titles) although each had passed Jev's claim check at the margin: the
// errors are the flag's own (an event of the scene before, another character), so a check on the same evidence cannot
// catch them, and a placement check removed only 2 of 11. With them off, what a parent reads is only Sonnet's cited,
// Jev-verified title and sentences (else 'Flagged scene' and no text; the tags still list what was found).
// v9 PARENT TEXT, step 2 (Jev + code): every sentence (and the title) describe.js wrote for a flagged
// scene is claim-checked by Jev BEFORE a parent sees it; code rebuilds the text from what passed.
// v10.1 adds the PARENT TEXT SAFETY layer (textsafe.js): a code-built reason is stated only when it passes its
// own Jev claim check against the scene; titles and sentences need a margin; 'X threatens Y' texts a direction
// check.
//
//   node check-describe.js <slug> [--run r1] [--cap 0.08] [--dry] [--in <dir>] [--reuse-why <why.json>]
//                          [--final-held-out-run]
// --in: read segments / tags / describe / jev from <dir> instead of the output directory (dev measurement on
//       saved v9 / v10 outputs). --reuse-why: take the support / placement answers of an earlier check of the
//       SAME texts (same key and text) instead of asking again (so a before/after differs only by v10.1's rules).
//
// Jev (jev-1.13.0):
//   1 SUPPORT   claims.js batchBody: {claim, evidence = its OWN cites (+-2 neighbouring lines inside
//               the scene), cited W-sentences, cited TMDB entries}; Choice supports / contradicts /
//               says_nothing. v10.1: verified at p(supports) >= text_safety.accept.min_supports and
//               p(contradicts) < text_safety.accept.max_contradicts (calibrated margin), not the 0.70 / 0.15
//               claim rule.
//   2 PLACEMENT a sentence citing Wikipedia: claims.js placementBody against the scene's own lines;
//               claims.js placementOutcome (unchanged). A verified but unplaced sentence is dropped.
//   3 DIRECTION v10.1: a title / sentence of the form 'X threatens / attacks / chases ... Y' (textsafe.js
//               parseDirection) is asked a Jev Choice over the scene's lines + the plot sentences it cites:
//               forward 'X <verbs> Y' / reverse 'Y <verbs> X' / neither; 'reversed' (dropped) when
//               p(reverse) > p(forward) (textsafe.js directionReversed).
//   4 REASONS   v10.1: every flag reason whose own answer is at act (the top text_safety.max_reasons_checked by
//               reasons.js rankReasons) is claim-checked as "In this scene, <plain phrase>." against the scene's
//               lines + the plot sentences its verified summary cites, same margin rule. Only reasons that pass
//               may be written ('Flagged because ...' or a plain title); the others stay tags (and still flag).
//   5 STATES WHY reasons.js planReasons over the VERIFIED sentences: one Noul per (flag reason,
//               sentence) "does the sentence say that <the reason's moment clause>?"; states when
//               p >= policy reasons.min_p (0.6, v8's audit-calibrated threshold).
// Code builds what parents see (why):
//   title        the verified title, else a plain title from the top CHECKED reason, else 'Flagged scene'
//   description  the verified, placed, direction-checked sentences in order
//   source       'described'          >= 1 verified sentence states a flag reason
//                'described+reason'   verified sentences, none states a reason: the checked plain reason is added
//                'described_only'     verified sentences, none states a reason, no reason passed its check
//                'plain_reason'       no verified sentence: 'Flagged because <checked reason phrases>.'
//                'no_verified_text'   nothing passed: no description (the tags still say what was found)
// Writes out/<slug>.why.<run>.json (every Jev answer, statuses, the final why per scene).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir, sourcesFile, heldOutGate } from './env.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from './jev-client.js';
import { batchBody, placementBody, verdictOf, evidenceIds, evidenceText, placementOutcome, DEFAULT_RULE, MODEL } from './claims.js';
import { acceptSentence } from './accept.js';
import { planReasons, parentPhrase, rankReasons } from './reasons.js';
import { verified } from './questions.js';
import { parseDirection, directionChoiceBody, directionReversed, reasonClaim, reasonAtAct, reasonSayable, reasonPlaced, textAccepted, plotPathOk, TEXTSAFE_VERSION } from './textsafe.js';
import { neighbourBody } from './fill.js';
import { formatTime } from '../srt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHECK_DESCRIBE_VERSION = 'check-describe-v10.2';
const r3 = (x) => Math.round(x * 1000) / 1000;
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'Flagged because a and b.' from the top two distinct reason phrases. */
export function plainReason(reasons, items) {
  const ph = [...new Set(rankReasons(reasons, items).map((r) => parentPhrase(r, items).replace(/^(The|A|An) /, (m) => m.toLowerCase())))].slice(0, 2);
  return ph.length ? `Flagged because ${ph.join(' and ')}.` : null;
}
export const plainTitle = (reasons, items) => { const r = rankReasons(reasons, items)[0]; return r ? cap1(parentPhrase(r, items)) : 'Flagged scene'; };

/**
 * Final parent text for one scene from the checked parts. Pure.
 * v10.1: `stated` = the ids of the flag reasons that passed their own claim check (undefined = v9 behaviour:
 * every reason may be stated). Only those reach the plain reason line or a plain title.
 */
export function buildWhy({ title, sentences, states, reasons, items, minP, stated }) {
  const ok = sentences.filter((s) => s.final === 'verified');
  const best = states.reduce((b, x) => (!b || x.p > b.p ? x : b), null);
  const sayable = stated ? reasons.filter((r) => stated.includes(r.id)) : reasons;
  const plain = plainReason(sayable, items);
  const titleOk = title?.final === 'verified';
  const t = titleOk ? title.text : sayable.length ? plainTitle(sayable, items) : 'Flagged scene';
  const titleSource = titleOk ? 'sonnet_verified' : sayable.length ? 'plain' : 'none';
  const extra = stated ? { stated_reasons: sayable.map((r) => r.id), unstated_reasons: reasons.filter((r) => !stated.includes(r.id)).map((r) => r.id) } : {};
  if (!ok.length) return plain ? { source: 'plain_reason', title: t, title_source: titleSource, text: plain, sentences: [], ...extra } : { source: 'no_verified_text', title: t, title_source: titleSource, text: null, sentences: [], ...extra };
  const desc = ok.map((s) => s.text).join(' ');
  if (best && best.p >= minP) return { source: 'described', title: t, title_source: titleSource, text: desc, states: best.reason, p: r3(best.p), sentences: ok.map((s) => s.key), ...extra };
  if (!plain) return { source: 'described_only', title: t, title_source: titleSource, text: desc, sentences: ok.map((s) => s.key), ...(best ? { best_p: r3(best.p) } : {}), ...extra };
  return { source: 'described+reason', title: t, title_source: titleSource, text: `${desc} ${plain}`, sentences: ok.map((s) => s.key), ...(best ? { best_p: r3(best.p) } : {}), ...extra };
}

/** A stored check of an earlier why file (p_supports / p_contradicts / placement) as verdicts. */
function reusedVerdicts(c, RULE) {
  const ps = Number(c.p_supports) || 0; const pc = Number(c.p_contradicts) || 0; const pn = Math.max(0, 1 - ps - pc);
  const probs = { supports: ps, contradicts: pc, says_nothing: +pn.toFixed(4) };
  const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  const support = verdictOf({ choice, confidence: probs[choice], probabilities: probs }, RULE);
  const placement = c.placement ? { choice: c.placement, confidence: null, probabilities: { fits: c.p_fits ?? 0, conflicts: c.p_conflicts ?? 0 } } : null;
  return { support, placement };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap', '--in', '--reuse-why'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node check-describe.js <slug> [--run r1] [--cap 0.08] [--dry] [--in <dir>] [--reuse-why <file>]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const IN = path.resolve(opt('in', OUT));
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const RULE = { ...DEFAULT_RULE, ...(cfg.claim_accept ?? {}) }; delete RULE._about;
  const TS_CFG = cfg.text_safety;
  // v10.1: titles and sentences are verified under the text margin (the placement rule stays RULE)
  const ACC = { ...RULE, ...(cfg.sentence_accept ?? {}), min_supports: TS_CFG.accept.min_supports, max_contradicts: TS_CFG.accept.max_contradicts };
  const ACC_T = { ...ACC, min_supports: TS_CFG.title_accept.min_supports, max_contradicts: TS_CFG.title_accept.max_contradicts };
  const seg = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.segments.json`), 'utf8'));
  const tags = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.tags.${runId}.json`), 'utf8'));
  const desc = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.describe.${runId}.json`), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(IN, `${slug}.jev.${runId}.json`), 'utf8')).film_items ?? [];
  const reuseFile = opt('reuse-why', null);
  const reuse = reuseFile ? JSON.parse(fs.readFileSync(path.resolve(reuseFile), 'utf8')) : null;
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const segById = new Map(seg.scenes.map((s) => [s.id, s]));
  const flagged = tags.scenes.filter((s) => s.flagged);
  const sceneLines = (sc) => cues.slice(sc.start_cue - 1, sc.end_cue).map((q) => evidenceText(`L${q.index}`, src));
  const plainLines = (sc) => cues.slice(sc.start_cue - 1, sc.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', ''));
  const summaryW = (sc) => [...new Set((sc.sentences ?? []).filter((x) => verified(x.check) && !x.judgement_words?.length).flatMap((x) => x.cites.filter((c) => c[0] === 'W')))];
  // v10.2 plot path: the 8 lines on each side of the scene (fill.js's neighbour test, same line format)
  const lineText = (q) => `L${q.index} [${formatTime(q.startMs).slice(0, 8)}] ${String(q.text).replace(/\n/g, ' / ')}`;
  const neighbours = (sc) => ({ before: cues.slice(Math.max(0, sc.start_cue - 1 - 8), sc.start_cue - 1).map(lineText), after: cues.slice(sc.end_cue, sc.end_cue + 8).map(lineText) });

  // phase 1: support + placement + direction for every sentence and title; the reason claims
  const claims = [];
  for (const s of flagged) {
    const d = desc.scenes[s.id];
    if (!d) continue;
    const sc = segById.get(s.id);
    const range = [sc.start_cue, sc.end_cue];
    const add = (k, x) => {
      const ids = evidenceIds(x.cites, { context: 2, range, nCues: cues.length });
      const wCites = x.cites.filter((c) => c[0] === 'W');
      claims.push({ scene: s.id, key: `${s.id}.${k}`, text: x.text, cites: x.cites, evidence: ids.map((id) => evidenceText(id, src)), wiki: wCites.length > 0, wOnly: !x.cites.some((c) => c[0] === 'L'), sceneLines: plainLines(sc), direction: parseDirection(x.text), wCites, wAllowed: wCites.every((id) => (d.evidence_ids?.w ?? []).includes(id)), nb: neighbours(sc) });
    };
    d.sentences.forEach((x, i) => add(`d${i + 1}`, x));
    if (d.title) add('title', d.title);
  }
  const reasonClaims = [];
  for (const s of flagged) {
    const sc = segById.get(s.id);
    const W = summaryW(sc);
    const evidence = [...sceneLines(sc), ...W.map((id) => evidenceText(id, src))];
    // v10.2: with text_safety.code_built_reasons false no reason is ever written, so none is checked
    if (TS_CFG.code_built_reasons === false) continue;
    for (const r of rankReasons(s.flag_reasons, items).filter((x) => reasonAtAct(x, s.tags) && reasonSayable(x)).slice(0, TS_CFG.max_reasons_checked)) {
      reasonClaims.push({ scene: s.id, reason: r.id, key: `${s.id}.reason.${r.id}`, claim: reasonClaim(r, items), evidence, sceneLines: plainLines(sc) });
    }
  }
  const jobs = [];
  const reused = new Map();
  const reusedExtra = new Map();
  for (const c of claims) {
    const old = reuse?.scenes?.[c.scene]?.checked?.find((x) => x.key === c.key && x.text === c.text);
    if (old) reused.set(c.key, reusedVerdicts(old, RULE));
    else {
      const body = batchBody([{ claim: c.text, evidence: c.evidence }]);
      const sz = sizeRequest(body, `support:${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind: 'support', key: c.key, label: `support:${c.key}` } });
      if (c.wiki) {
        const pb = placementBody(c.text, c.sceneLines);
        const pz = sizeRequest(pb, `placement:${c.key}`, { reserveXEst: 3.0 });
        jobs.push({ body: pb, est: pz.est, reserveUsd: pz.reserveUsd, meta: { kind: 'placement', key: c.key, label: `placement:${c.key}` } });
      }
    }
    // v10.2 plot path: support against the cited plot sentences ALONE + v8's neighbour placement test
    // (--reuse-why: an earlier v10.2 check of the SAME text keeps its plot-path and direction answers too)
    const ow = old && old.p_w_supports != null && old.p_neighbour_neither != null ? old : null;
    if (ow) {
      const probs = { supports: Number(ow.p_w_supports) || 0, contradicts: Number(ow.p_w_contradicts) || 0 };
      reusedExtra.set(c.key, { wsupport: { probabilities: probs }, neighbour: { p_neither: Number(ow.p_neighbour_neither) } });
    } else if (c.wiki) {
      const wb = batchBody([{ claim: c.text, evidence: c.wCites.map((id) => evidenceText(id, src)) }]);
      const wz = sizeRequest(wb, `wsupport:${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body: wb, est: wz.est, reserveUsd: wz.reserveUsd, meta: { kind: 'wsupport', key: c.key, label: `wsupport:${c.key}` } });
      const nb = neighbourBody({ film: seg.film, event: c.text, before: c.nb.before, after: c.nb.after });
      const nz = sizeRequest(nb, `neighbour:${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body: nb, est: nz.est, reserveUsd: nz.reserveUsd, meta: { kind: 'neighbour', key: c.key, label: `neighbour:${c.key}` } });
    }
    if (c.direction && old?.direction?.p_forward != null && old.direction.agent === c.direction.agent && old.direction.patient === c.direction.patient) {
      reusedExtra.set(c.key, { ...(reusedExtra.get(c.key) ?? {}), direction: { choice: old.direction.choice ?? null, p_forward: old.direction.p_forward, p_reverse: old.direction.p_reverse, p_neither: old.direction.p_neither } });
    } else if (c.direction) {
      const plot = c.cites.filter((id) => id[0] === 'W').map((id) => evidenceText(id, src));
      const db = directionChoiceBody({ film: seg.film, lines: c.sceneLines, plot, d: c.direction, model: MODEL });
      const dz = sizeRequest(db, `direction:${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body: db, est: dz.est, reserveUsd: dz.reserveUsd, meta: { kind: 'direction', key: c.key, label: `direction:${c.key}` } });
    }
  }
  for (const rc of reasonClaims) {
    const oldR = reuse?.scenes?.[rc.scene]?.reason_checks?.find((x) => x.reason === rc.reason && x.claim === rc.claim && x.p_supports != null);
    // v10.2: a stated reason must also be PLACED in the scene: claims.js's placement Choice over the scene's own lines
    // (text_safety.reason_placement); reused from an earlier v10.2 check of the same claim when --reuse-why has it
    if (TS_CFG.reason_placement) {
      if (oldR?.p_fits != null) reusedExtra.set(`${rc.key}#place`, { place: { choice: oldR.placement ?? null, probabilities: { fits: Number(oldR.p_fits) || 0, conflicts: Number(oldR.p_conflicts) || 0 } } });
      else {
        const pb = placementBody(rc.claim, rc.sceneLines);
        const pz = sizeRequest(pb, `rplace:${rc.key}`, { reserveXEst: 3.0 });
        jobs.push({ body: pb, est: pz.est, reserveUsd: pz.reserveUsd, meta: { kind: 'rplace', key: rc.key, label: `rplace:${rc.key}` } });
      }
    }
    if (oldR) { reusedExtra.set(rc.key, { reasonReused: { probabilities: { supports: Number(oldR.p_supports) || 0, contradicts: Number(oldR.p_contradicts) || 0 }, verdict: oldR.verdict } }); continue; }
    const body = batchBody([{ claim: rc.claim, evidence: rc.evidence }]);
    const sz = sizeRequest(body, `reason:${rc.key}`, { reserveXEst: 3.0 });
    jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind: 'reason', key: rc.key, label: `reason:${rc.key}` } });
  }
  const CAP = Number(opt('cap', '0.08'));
  const wallet = budget(CAP);
  const reserve1 = jobs.reduce((a, j) => a + j.reserveUsd, 0);
  const kinds = jobs.reduce((m, j) => ({ ...m, [j.meta.kind]: (m[j.meta.kind] ?? 0) + 1 }), {});
  console.log(`${slug}: ${flagged.length} flagged, ${claims.length} texts to check (${claims.filter((c) => c.key.endsWith('title')).length} titles, ${claims.filter((c) => c.direction).length} with a direction), ${reasonClaims.length} reasons; ${jobs.length} Jev requests ${JSON.stringify(kinds)}${reuse ? `, ${reused.size} support answers reused` : ''}; worst-case reserve $${reserve1.toFixed(5)} (cap $${CAP})`);
  if (argv.includes('--dry')) process.exit(0);
  const K = key('TYPESAFE_API_KEY');
  const r1 = jobs.length ? await runJobs(jobs, { key: K, budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  const bad1 = r1.results.filter((r) => !r.ok);
  if (bad1.length) { if (wallet.spent > 0) record(slug, { script: 'check-describe.js', kind: 'jev', usd: wallet.spent, note: 'phase 1 (failed)' }); console.error(`Jev phase 1: ${bad1.length} failed (${bad1[0].skipped ?? bad1[0].error})`); process.exit(5); }
  const ans = {};
  for (const r of r1.results) {
    const k = r.meta.kind;
    const a = (ans[r.meta.key] ??= {});
    if (k === 'support' || k === 'reason') a.support = verdictOf(r.json.answers.r0, RULE);
    else if (k === 'placement') a.placement = { choice: r.json.answers.placement.choice, confidence: r.json.answers.placement.confidence, probabilities: r.json.answers.placement.probabilities };
    else if (k === 'direction') { const pr = r.json.answers.direction?.probabilities ?? {}; a.direction = { choice: r.json.answers.direction?.choice ?? null, p_forward: r3(Number(pr.forward) || 0), p_reverse: r3(Number(pr.reverse) || 0), p_neither: r3(Number(pr.neither) || 0) }; }
    else if (k === 'wsupport') a.wsupport = verdictOf(r.json.answers.r0, RULE);
    else if (k === 'rplace') a.place = { choice: r.json.answers.placement.choice, probabilities: r.json.answers.placement.probabilities };
    else if (k === 'neighbour') { const pr = r.json.answers.shown?.probabilities ?? {}; a.neighbour = { choice: r.json.answers.shown?.choice ?? null, p_before: r3(Number(pr.before) || 0), p_after: r3(Number(pr.after) || 0), p_neither: r3(Number(pr.neither) || 0) }; }
  }
  for (const [k, v] of reused) Object.assign((ans[k] ??= {}), v, { reused: true });
  for (const [k, v] of reusedExtra) { const a = (ans[k] ??= {}); if (v.wsupport) a.wsupport = v.wsupport; if (v.neighbour) a.neighbour = v.neighbour; if (v.direction) a.direction = v.direction; if (v.reasonReused) a.support = v.reasonReused; }
  for (const [k, v] of reusedExtra) if (v.place) (ans[k.replace('#place', '')] ??= {}).place = v.place;
  for (const c of claims) {
    const a = ans[c.key];
    // v10.2 fix 4: a TITLE is verified at the claim rule (text_safety.title_accept) -- the direction check, not the
    // margin, now guards against reversed titles; sentences keep the margin
    const isTitle = c.key.endsWith('title');
    const st = acceptSentence(a.support, null, isTitle ? ACC_T : ACC).status;
    const placed = c.wiki ? placementOutcome(a.placement, c.wOnly, RULE) === 'placed' : true;
    const dirOk = c.direction ? !directionReversed(a.direction) : true;
    const linesFinal = st !== 'verified' ? st : !placed ? 'unplaced' : !dirOk ? 'reversed' : 'verified';
    // v10.2 plot path (textsafe.js plotPathOk), only for a text the lines-based path did not verify
    const plot = c.wiki && linesFinal !== 'verified' ? plotPathOk({ status: st, wsupport: a.wsupport, wAllowed: c.wAllowed, neighbour: a.neighbour, dirOk }, { accept: isTitle ? TS_CFG.title_accept : TS_CFG.accept, neighbourMin: cfg.fill.neighbour_min }) : null;
    c.check = { support: a.support, ...(a.placement ? { placement: a.placement } : {}), ...(c.direction ? { direction: { ...c.direction, ...a.direction, ok: dirOk } } : {}), ...(a.reused ? { support_reused: true } : {}), ...(a.wsupport ? { wsupport: a.wsupport } : {}), ...(a.neighbour ? { neighbour: a.neighbour } : {}), ...(plot ? { plot_path: plot } : {}), status: st, placed, lines_final: linesFinal, via: linesFinal === 'verified' ? 'lines' : plot?.ok ? 'plot' : null, final: linesFinal === 'verified' || plot?.ok ? 'verified' : linesFinal };
  }
  for (const rc of reasonClaims) {
    const v = ans[rc.key].support;
    const pl = ans[rc.key].place ?? null;
    const placedOk = TS_CFG.reason_placement ? reasonPlaced(pl, TS_CFG.reason_placement) : true;
    rc.check = { verdict: v.verdict, p_supports: v.probabilities?.supports ?? null, p_contradicts: v.probabilities?.contradicts ?? null, ...(pl ? { placement: pl.choice, p_fits: Number(pl.probabilities?.fits) || 0, p_conflicts: Number(pl.probabilities?.conflicts) || 0 } : {}), supported: textAccepted(v, TS_CFG.accept), placed: placedOk, pass: textAccepted(v, TS_CFG.accept) && placedOk };
  }

  // phase 2: does a verified sentence state a flag reason?
  const plans = [];
  for (const s of flagged) {
    const ok = claims.filter((c) => c.scene === s.id && !c.key.endsWith('title') && c.check.final === 'verified');
    const plan = planReasons({ film: seg.film, scene: s, sentences: ok.map((c) => c.text), reasons: s.flag_reasons, items, cfg });
    if (plan) plans.push({ s, ok, plan });
  }
  // --reuse-why: a scene whose verified sentences and reasons are the same as in the earlier check keeps its answers
  const statesReused = {};
  for (const p of plans) {
    const old = reuse?.scenes?.[p.s.id]?.states ?? null;
    const want = p.plan.reasons.flatMap((rid) => p.ok.map((c) => `${rid}|${c.key}`));
    if (old && want.length && want.every((k) => old.some((x) => `${x.reason}|${x.sentence}` === k))) statesReused[p.s.id] = old.filter((x) => want.includes(`${x.reason}|${x.sentence}`));
  }
  const jobs2 = plans.filter((p) => !statesReused[p.s.id]).map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { id: p.s.id, label: `${p.s.id}/states` } }));
  const r2 = jobs2.length ? await runJobs(jobs2, { key: K, budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: 'check-describe.js', kind: 'jev', usd: wallet.spent, note: `${CHECK_DESCRIBE_VERSION} ${jobs.length} + ${jobs2.length} requests` });
  const bad2 = r2.results.filter((r) => !r.ok);
  if (bad2.length) { console.error(`Jev phase 2: ${bad2.length} failed (${bad2[0].skipped ?? bad2[0].error})`); process.exit(5); }
  const statesBy = { ...statesReused };
  for (const r of r2.results) {
    const p = plans.find((x) => x.s.id === r.meta.id);
    statesBy[r.meta.id] = p.plan.reasons.flatMap((rid, k) => p.ok.map((c, j) => ({ reason: rid, sentence: c.key, p: r3(Number(r.json.answers[`r${k}.s${j}`]?.noul) || 0) })));
  }

  const scenes = {};
  for (const s of flagged) {
    const cs = claims.filter((c) => c.scene === s.id);
    const title = cs.find((c) => c.key.endsWith('title'));
    const sentences = cs.filter((c) => !c.key.endsWith('title'));
    const rcs = reasonClaims.filter((x) => x.scene === s.id);
    const stated = TS_CFG.code_built_reasons === false ? [] : rcs.filter((x) => x.check.pass).map((x) => x.reason);
    const why = buildWhy({ title: title && { text: title.text, final: title.check.final }, sentences: sentences.map((c) => ({ key: c.key, text: c.text, final: c.check.final })), states: statesBy[s.id] ?? [], reasons: s.flag_reasons, items, minP: cfg.reasons.min_p, stated });
    scenes[s.id] = {
      reasons: s.flag_reasons.map((r) => r.id),
      checked: cs.map((c) => ({ key: c.key, text: c.text, cites: c.cites, status: c.check.status, placed: c.check.placed, final: c.check.final, via: c.check.via, ...(c.check.wsupport ? { p_w_supports: c.check.wsupport.probabilities?.supports ?? null, p_w_contradicts: c.check.wsupport.probabilities?.contradicts ?? null } : {}), ...(c.check.neighbour ? { p_neighbour_neither: c.check.neighbour.p_neither } : {}), ...(c.check.plot_path ? { plot_path: c.check.plot_path } : {}), p_supports: c.check.support.probabilities?.supports ?? null, p_contradicts: c.check.support.probabilities?.contradicts ?? null, ...(c.check.support_reused ? { support_reused: true } : {}), ...(c.check.placement ? { placement: c.check.placement.choice, p_fits: c.check.placement.probabilities?.fits ?? null, p_conflicts: c.check.placement.probabilities?.conflicts ?? null } : {}), ...(c.check.direction ? { direction: c.check.direction } : {}) })),
      reason_checks: rcs.map((x) => ({ reason: x.reason, claim: x.claim, ...x.check })),
      states: statesBy[s.id] ?? [],
      why,
    };
  }
  const n = Object.values(scenes);
  const cnt = (k) => n.filter((x) => x.why.source === k).length;
  const texts = n.flatMap((x) => x.checked.filter((c) => !c.key.endsWith('title')));
  const rcAll = n.flatMap((x) => x.reason_checks);
  const out = {
    film: seg.film, version: CHECK_DESCRIBE_VERSION, textsafe: TEXTSAFE_VERSION, run: runId, input_dir: path.relative(here, IN), ...(reuse ? { support_reused_from: path.relative(here, path.resolve(reuseFile)) } : {}),
    policy: { claim_accept: RULE, text_accept: TS_CFG.accept, title_accept: TS_CFG.title_accept, direction: TS_CFG.direction, max_reasons_checked: TS_CFG.max_reasons_checked, reasons_min_p: cfg.reasons.min_p }, run_at: new Date().toISOString(),
    requests: jobs.length + jobs2.length, cost_usd: +wallet.spent.toFixed(6),
    flagged: n.length, sentences: texts.length, verified: texts.filter((c) => c.final === 'verified').length, contradicted: texts.filter((c) => c.final === 'contradicted').length, unplaced: texts.filter((c) => c.final === 'unplaced').length, reversed: n.flatMap((x) => x.checked).filter((c) => c.final === 'reversed').length,
    titles_verified: n.filter((x) => x.why.title_source === 'sonnet_verified').length,
    verified_via_plot: n.flatMap((x) => x.checked).filter((c) => c.via === 'plot').map((c) => c.key),
    reasons_checked: rcAll.length, reasons_passed: rcAll.filter((x) => x.pass).length,
    why: { described: cnt('described'), described_plus_reason: cnt('described+reason'), described_only: cnt('described_only'), plain_reason: cnt('plain_reason'), no_verified_text: cnt('no_verified_text') },
    scenes,
  };
  fs.writeFileSync(path.join(OUT, `${slug}.why.${runId}.json`), JSON.stringify(out, null, 2));
  console.log(`  plot path verified ${out.verified_via_plot.length} texts${out.verified_via_plot.length ? ` (${out.verified_via_plot.join(', ')})` : ''}`);
  console.log(`  sentences verified ${out.verified}/${out.sentences} (contradicted ${out.contradicted}, unplaced ${out.unplaced}, reversed ${out.reversed}); titles verified ${out.titles_verified}/${out.flagged}; reasons passed ${out.reasons_passed}/${out.reasons_checked}; why: ${JSON.stringify(out.why)}; $${out.cost_usd}`);
}
