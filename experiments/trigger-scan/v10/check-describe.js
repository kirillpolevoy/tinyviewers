#!/usr/bin/env node
// v9 PARENT TEXT, step 2 (Jev + code): every sentence (and the title) describe.js wrote for a flagged
// scene is claim-checked by Jev BEFORE a parent sees it; code rebuilds the text from what passed.
//
//   node check-describe.js <slug> [--run r1] [--cap 0.02] [--dry] [--final-held-out-run]
//
// Jev (jev-1.13.0), the same shapes v8 uses for summary sentences:
//   1 SUPPORT   claims.js batchBody: {claim, evidence = its OWN cites (+-2 neighbouring lines inside
//               the scene), cited W-sentences, cited TMDB entries}; Choice supports / contradicts /
//               says_nothing. Status by accept.js acceptSentence with claim precedence (policy
//               sentence_accept + claim_accept: verified at p(supports) >= 0.70 and p(contradicts) <
//               0.15; no split check exists for this text, so split = null).
//   2 PLACEMENT a sentence citing Wikipedia: claims.js placementBody against the scene's own lines;
//               claims.js placementOutcome (a W-only sentence must 'fit'; with lines it is unplaced
//               when p(conflicts) >= 0.5). A verified but unplaced sentence is dropped.
//   3 STATES WHY reasons.js planReasons over the VERIFIED sentences: one Noul per (flag reason,
//               sentence) "does the sentence say that <the reason's moment clause>?"; states when
//               p >= policy reasons.min_p (0.6, v8's audit-calibrated threshold).
// Code builds what parents see (why):
//   title        the verified title, else a plain title from the top flag reason
//   description  the verified, placed sentences in order (each stands alone by the prompt's rule)
//   source       'described'        >= 1 verified sentence states a flag reason
//                'described+reason' verified sentences, none states a reason: the plain reason is added
//                'plain_reason'     no verified sentence: 'Flagged because <reason phrases>.'
// Writes out/<slug>.why.<run>.json (every Jev answer, statuses, the final why per scene).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSrt } from '../srt.js';
import { budget } from './budget.js';
import { key, outDir, sourcesFile, heldOutGate } from './env.js';
import { record } from './ledger.js';
import { sizeRequest, runJobs, MAX_CONCURRENCY } from './jev-client.js';
import { batchBody, placementBody, verdictOf, evidenceIds, evidenceText, placementOutcome, DEFAULT_RULE } from './claims.js';
import { acceptSentence } from './accept.js';
import { planReasons, parentPhrase, rankReasons } from './reasons.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHECK_DESCRIBE_VERSION = 'check-describe-v9.0';
const r3 = (x) => Math.round(x * 1000) / 1000;
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** 'Flagged because a and b.' from the top two distinct reason phrases. */
export function plainReason(reasons, items) {
  const ph = [...new Set(rankReasons(reasons, items).map((r) => parentPhrase(r, items).replace(/^(The|A|An) /, (m) => m.toLowerCase())))].slice(0, 2);
  return ph.length ? `Flagged because ${ph.join(' and ')}.` : null;
}
export const plainTitle = (reasons, items) => { const r = rankReasons(reasons, items)[0]; return r ? cap1(parentPhrase(r, items)) : 'Flagged scene'; };

/** Final parent text for one scene from the checked parts. Pure. */
export function buildWhy({ title, sentences, states, reasons, items, minP }) {
  const ok = sentences.filter((s) => s.final === 'verified');
  const best = states.reduce((b, x) => (!b || x.p > b.p ? x : b), null);
  const plain = plainReason(reasons, items);
  const t = title?.final === 'verified' ? title.text : plainTitle(reasons, items);
  if (!ok.length) return { source: 'plain_reason', title: t, title_source: title?.final === 'verified' ? 'sonnet_verified' : 'plain', text: plain, sentences: [] };
  const desc = ok.map((s) => s.text).join(' ');
  if (best && best.p >= minP) return { source: 'described', title: t, title_source: title?.final === 'verified' ? 'sonnet_verified' : 'plain', text: desc, states: best.reason, p: r3(best.p), sentences: ok.map((s) => s.key) };
  return { source: 'described+reason', title: t, title_source: title?.final === 'verified' ? 'sonnet_verified' : 'plain', text: `${desc} ${plain}`, sentences: ok.map((s) => s.key), ...(best ? { best_p: r3(best.p) } : {}) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const slug = argv.find((a) => !a.startsWith('--') && !['--run', '--cap'].includes(argv[argv.indexOf(a) - 1]));
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  if (!slug) { console.error('usage: node check-describe.js <slug> [--run r1] [--cap 0.02] [--dry]'); process.exit(2); }
  heldOutGate(slug);
  const runId = opt('run', 'r1');
  const OUT = outDir();
  const cfg = JSON.parse(fs.readFileSync(path.join(here, 'policy.json'), 'utf8'));
  const RULE = { ...DEFAULT_RULE, ...(cfg.claim_accept ?? {}) }; delete RULE._about;
  const ACC = { ...RULE, ...(cfg.sentence_accept ?? {}) };
  const seg = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.segments.json`), 'utf8'));
  const tags = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.tags.${runId}.json`), 'utf8'));
  const desc = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.describe.${runId}.json`), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(OUT, `${slug}.jev.${runId}.json`), 'utf8')).film_items ?? [];
  const SRC = JSON.parse(fs.readFileSync(sourcesFile(slug), 'utf8'));
  const cues = parseSrt(fs.readFileSync(path.resolve(here, '..', 'data', `${slug}.srt`), 'utf8'));
  const src = { cues, W: SRC.wikipedia.sentences, T: SRC.tmdb.cast };
  const segById = new Map(seg.scenes.map((s) => [s.id, s]));
  const flagged = tags.scenes.filter((s) => s.flagged);

  // phase 1: support + placement for every kept sentence and title
  const claims = [];
  for (const s of flagged) {
    const d = desc.scenes[s.id];
    if (!d) continue;
    const sc = segById.get(s.id);
    const range = [sc.start_cue, sc.end_cue];
    const add = (k, x) => {
      const ids = evidenceIds(x.cites, { context: 2, range, nCues: cues.length });
      claims.push({ scene: s.id, key: `${s.id}.${k}`, text: x.text, cites: x.cites, evidence: ids.map((id) => evidenceText(id, src)), wiki: x.cites.some((c) => c[0] === 'W'), wOnly: !x.cites.some((c) => c[0] === 'L'), sceneLines: cues.slice(sc.start_cue - 1, sc.end_cue).map((q) => evidenceText(`L${q.index}`, src).replace(' (subtitle line)', '')) });
    };
    d.sentences.forEach((x, i) => add(`d${i + 1}`, x));
    if (d.title) add('title', d.title);
  }
  const jobs = [];
  for (const c of claims) {
    const body = batchBody([{ claim: c.text, evidence: c.evidence }]);
    const sz = sizeRequest(body, `support:${c.key}`, { reserveXEst: 3.0 });
    jobs.push({ body, est: sz.est, reserveUsd: sz.reserveUsd, meta: { kind: 'support', key: c.key, label: `support:${c.key}` } });
    if (c.wiki) {
      const pb = placementBody(c.text, c.sceneLines);
      const pz = sizeRequest(pb, `placement:${c.key}`, { reserveXEst: 3.0 });
      jobs.push({ body: pb, est: pz.est, reserveUsd: pz.reserveUsd, meta: { kind: 'placement', key: c.key, label: `placement:${c.key}` } });
    }
  }
  const CAP = Number(opt('cap', '0.02'));
  const wallet = budget(CAP);
  const reserve1 = jobs.reduce((a, j) => a + j.reserveUsd, 0);
  console.log(`${slug}: ${flagged.length} flagged, ${claims.length} texts to check (${claims.filter((c) => c.key.endsWith('title')).length} titles), ${jobs.length} Jev requests, reserve $${reserve1.toFixed(5)} (cap $${CAP})`);
  if (argv.includes('--dry')) process.exit(0);
  const K = key('TYPESAFE_API_KEY');
  const r1 = jobs.length ? await runJobs(jobs, { key: K, budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  const bad1 = r1.results.filter((r) => !r.ok);
  if (bad1.length) { if (wallet.spent > 0) record(slug, { script: 'check-describe.js', kind: 'jev', usd: wallet.spent, note: 'phase 1 (failed)' }); console.error(`Jev phase 1: ${bad1.length} failed (${bad1[0].skipped ?? bad1[0].error})`); process.exit(5); }
  const ans = {};
  for (const r of r1.results) (ans[r.meta.key] ??= {})[r.meta.kind] = r.meta.kind === 'support' ? verdictOf(r.json.answers.r0, RULE) : { choice: r.json.answers.placement.choice, confidence: r.json.answers.placement.confidence, probabilities: r.json.answers.placement.probabilities };
  for (const c of claims) {
    const a = ans[c.key];
    const st = acceptSentence(a.support, null, ACC).status;
    const placed = c.wiki ? placementOutcome(a.placement, c.wOnly, RULE) === 'placed' : true;
    c.check = { support: a.support, ...(a.placement ? { placement: a.placement } : {}), status: st, placed, final: st === 'verified' && placed ? 'verified' : st === 'verified' ? 'unplaced' : st };
  }

  // phase 2: does a verified sentence state a flag reason?
  const plans = [];
  for (const s of flagged) {
    const ok = claims.filter((c) => c.scene === s.id && !c.key.endsWith('title') && c.check.final === 'verified');
    const plan = planReasons({ film: seg.film, scene: s, sentences: ok.map((c) => c.text), reasons: s.flag_reasons, items, cfg });
    if (plan) plans.push({ s, ok, plan });
  }
  const jobs2 = plans.map((p) => ({ body: p.plan.body, est: p.plan.est, reserveUsd: p.plan.reserveUsd, meta: { id: p.s.id, label: `${p.s.id}/states` } }));
  const r2 = jobs2.length ? await runJobs(jobs2, { key: K, budget: wallet, concurrency: MAX_CONCURRENCY }) : { results: [], stopped: null };
  if (wallet.spent > 0) record(slug, { script: 'check-describe.js', kind: 'jev', usd: wallet.spent, note: `${CHECK_DESCRIBE_VERSION} ${jobs.length} + ${jobs2.length} requests` });
  const bad2 = r2.results.filter((r) => !r.ok);
  if (bad2.length) { console.error(`Jev phase 2: ${bad2.length} failed (${bad2[0].skipped ?? bad2[0].error})`); process.exit(5); }
  const statesBy = {};
  for (const r of r2.results) {
    const p = plans.find((x) => x.s.id === r.meta.id);
    statesBy[r.meta.id] = p.plan.reasons.flatMap((rid, k) => p.ok.map((c, j) => ({ reason: rid, sentence: c.key, p: r3(Number(r.json.answers[`r${k}.s${j}`]?.noul) || 0) })));
  }

  const scenes = {};
  for (const s of flagged) {
    const cs = claims.filter((c) => c.scene === s.id);
    const title = cs.find((c) => c.key.endsWith('title'));
    const sentences = cs.filter((c) => !c.key.endsWith('title'));
    const why = buildWhy({ title: title && { text: title.text, final: title.check.final }, sentences: sentences.map((c) => ({ key: c.key, text: c.text, final: c.check.final })), states: statesBy[s.id] ?? [], reasons: s.flag_reasons, items, minP: cfg.reasons.min_p });
    scenes[s.id] = {
      reasons: s.flag_reasons.map((r) => r.id),
      checked: cs.map((c) => ({ key: c.key, text: c.text, cites: c.cites, status: c.check.status, placed: c.check.placed, final: c.check.final, p_supports: c.check.support.probabilities?.supports ?? null, p_contradicts: c.check.support.probabilities?.contradicts ?? null, ...(c.check.placement ? { placement: c.check.placement.choice, p_fits: c.check.placement.probabilities?.fits ?? null, p_conflicts: c.check.placement.probabilities?.conflicts ?? null } : {}) })),
      states: statesBy[s.id] ?? [],
      why,
    };
  }
  const n = Object.values(scenes);
  const cnt = (k) => n.filter((x) => x.why.source === k).length;
  const texts = n.flatMap((x) => x.checked.filter((c) => !c.key.endsWith('title')));
  const out = {
    film: seg.film, version: CHECK_DESCRIBE_VERSION, run: runId, policy: { claim_accept: RULE, reasons_min_p: cfg.reasons.min_p }, run_at: new Date().toISOString(),
    requests: jobs.length + jobs2.length, cost_usd: +wallet.spent.toFixed(6),
    flagged: n.length, sentences: texts.length, verified: texts.filter((c) => c.final === 'verified').length, contradicted: texts.filter((c) => c.final === 'contradicted').length, unplaced: texts.filter((c) => c.final === 'unplaced').length,
    titles_verified: n.filter((x) => x.why.title_source === 'sonnet_verified').length,
    why: { described: cnt('described'), described_plus_reason: cnt('described+reason'), plain_reason: cnt('plain_reason') },
    scenes,
  };
  fs.writeFileSync(path.join(OUT, `${slug}.why.${runId}.json`), JSON.stringify(out, null, 2));
  console.log(`  sentences verified ${out.verified}/${out.sentences} (contradicted ${out.contradicted}, unplaced ${out.unplaced}); titles verified ${out.titles_verified}/${out.flagged}; why: described ${out.why.described}, +reason ${out.why.described_plus_reason}, plain ${out.why.plain_reason}; $${out.cost_usd}`);
}
