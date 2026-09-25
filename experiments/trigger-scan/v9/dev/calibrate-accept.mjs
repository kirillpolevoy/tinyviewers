#!/usr/bin/env node
// Dev-only: calibrate the unified sentence acceptance rule (accept.js, policy sentence_accept) on the
// Codex labels (dev/label-sentences.mjs). No model calls.
//
// The labelled sample is stratified (film x category x claim-p bin), so every estimate here weights a
// labelled sentence by (sentences in its stratum) / (labelled sentences in its stratum): the numbers
// are estimates for ALL sentences of the seven dev films, not for the sample.
// Acceptable for parents = label 'backed' or 'minor'. For each candidate rule: estimated verified
// sentences, estimated precision (acceptable share of the verified), and the same for v7's claim-only
// rule. Chosen rule: the most verified sentences whose estimated precision is >= the claim-only rule's
// estimated precision (so the rule adds coverage without lowering precision), ties -> stricter.
//   node dev/calibrate-accept.mjs [--write]   (--write stores calibration/accept-rule.json and
//                                              policy.json sentence_accept)
import fs from 'node:fs';
import path from 'node:path';
import { V8, DEV_FILMS } from '../env.js';
import { loadAcceptInputs } from './accept-inputs.mjs';
import { acceptSentence } from '../accept.js';

const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const policy = rj(path.join(V8, 'policy.json'));
const labels = rj(path.join(V8, 'labels', 'sentence-labels.json')).labels;
const sample = rj(path.join(V8, 'labels', 'sentence-sample.json')).sample;
const P = (p, k) => Number(p?.[k]) || 0;
const r3 = (x) => Math.round(x * 1000) / 1000;

// population with the sampler's strata
const pop = [];
for (const slug of DEV_FILMS) {
  const { seg, alignment } = loadAcceptInputs(slug);
  for (const s of seg.scenes) {
    const al = alignment.get(s.id);
    s.sentences.forEach((x, i) => {
      const a = al[i];
      if (!a || !x.check?.probabilities || x.fill) return;
      const cs = P(x.check.probabilities, 'supports'); const cc = P(x.check.probabilities, 'contradicts');
      const claimOk = cs >= 0.7 && cc < 0.15; const splitOk = a.p_supports >= 0.5;
      const cat = claimOk && splitOk ? 'both' : claimOk ? 'claim_only' : splitOk ? 'split_only' : 'neither';
      const bin = cat === 'split_only' ? (cs < 0.3 ? 0 : cs < 0.5 ? 1 : 2) : -1;
      pop.push({ key: `${slug}:${s.id}.s${i + 1}`, stratum: `${slug}|${cat}|${bin}`, check: x.check, split: a, placementBad: x.check.status === 'unplaced' });
    });
  }
}
const labelled = new Map(sample.filter((r) => labels[r.key]).map((r) => [r.key, labels[r.key].label]));
const nPop = {}; const nLab = {};
for (const r of pop) { nPop[r.stratum] = (nPop[r.stratum] ?? 0) + 1; if (labelled.has(r.key)) nLab[r.stratum] = (nLab[r.stratum] ?? 0) + 1; }
// acceptable for parents: the event is right (backed, a minor detail, or only the speaker's name
// inferred); --strict counts only backed and minor
const OK = process.argv.includes('--strict') ? ['backed', 'minor'] : ['backed', 'minor', 'name_only'];
const L = pop.filter((r) => labelled.has(r.key)).map((r) => ({ ...r, w: nPop[r.stratum] / nLab[r.stratum], ok: OK.includes(labelled.get(r.key)), label: labelled.get(r.key) }));
const unlabelledStrata = Object.keys(nPop).filter((s) => !nLab[s]);

const baseRule = { ...policy.claim_accept };
function estimate(rule) {
  let wAcc = 0; let wOk = 0; let n = 0; let nOk = 0;
  for (const r of L) {
    const v = acceptSentence(r.check, r.split, rule);
    if (v.status !== 'verified') continue;
    wAcc += r.w; if (r.ok) wOk += r.w; n++; if (r.ok) nOk++;
  }
  return { est_verified: Math.round(wAcc), est_precision: wAcc ? r3(wOk / wAcc) : null, labelled_accepted: n, labelled_ok: nOk };
}
const CLAIM_ONLY = { ...baseRule, split_promotes: false, split_vetoes: false };
const claimOnly = estimate(CLAIM_ONLY);
const grid = [];
for (const split_min of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) for (const claim_floor of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65]) for (const split_contradicts_max of [0.3, 0.5]) {
  const rule = { ...baseRule, split_promotes: true, split_vetoes: true, split_min, claim_floor, split_contradicts_max };
  grid.push({ split_min, claim_floor, split_contradicts_max, ...estimate(rule) });
}
// the split check as a VETO only (it never promotes): does vetoing claim-verified sentences it sees
// contradicted raise precision?
const vetoes = [0.2, 0.3, 0.5].map((v) => ({ split_min: 2, claim_floor: 2, split_contradicts_max: v, ...estimate({ ...baseRule, split_promotes: false, split_vetoes: true, split_contradicts_max: v }) }));
const eligible = [...grid, ...vetoes].filter((g) => g.est_precision != null && g.est_precision >= claimOnly.est_precision && g.est_verified >= claimOnly.est_verified);
eligible.sort((a, b) => b.est_verified - a.est_verified || b.est_precision - a.est_precision);
// no candidate adds coverage at the claim-only precision -> CLAIM PRECEDENCE: the claim check decides,
// the split check neither promotes nor vetoes a sentence (split_min / split_contradicts_max > 1)
const chosen = eligible.find((g) => g.est_verified > claimOnly.est_verified) ?? { split_promotes: false, split_vetoes: false, ...claimOnly, rule: 'claim precedence' };
// label mix per category (weighted) for the record
const mix = {};
for (const r of L) { const c = r.stratum.split('|')[1]; mix[c] ??= {}; mix[c][r.label] = r3((mix[c][r.label] ?? 0) + r.w); }
console.log(`population ${pop.length} sentences, labelled ${L.length}; strata without labels: ${unlabelledStrata.length} (${unlabelledStrata.map((s) => `${s}:${nPop[s]}`).join(' ')})`);
console.log('weighted label mix by category', JSON.stringify(mix));
console.log(`claim-only rule (v7): est verified ${claimOnly.est_verified}, est precision ${claimOnly.est_precision}`);
for (const g of grid.filter((x) => x.split_contradicts_max === 0.5)) console.log(`  split>=${g.split_min} claim>=${g.claim_floor}: est verified ${g.est_verified}, precision ${g.est_precision} (labelled ${g.labelled_ok}/${g.labelled_accepted})`);
for (const v of vetoes) console.log(`  veto only, split p(contradicts) >= ${v.split_contradicts_max}: est verified ${v.est_verified}, precision ${v.est_precision}`);
console.log('chosen', JSON.stringify(chosen));
if (process.argv.includes('--write')) {
  const out = { generated_at: new Date().toISOString(), acceptable: OK, method: 'dev/calibrate-accept.mjs: Codex labels (labels/sentence-labels.json, sources-only), inverse-probability weighted to all dev sentences; chosen = most estimated verified sentences with estimated precision >= the claim-only rule', labels: L.length, population: pop.length, claim_only: claimOnly, chosen, vetoes, weighted_label_mix: mix, grid };
  fs.mkdirSync(path.join(V8, 'calibration'), { recursive: true });
  fs.writeFileSync(path.join(V8, 'calibration', 'accept-rule.json'), JSON.stringify(out, null, 2));
  console.log('-> calibration/accept-rule.json');
}
