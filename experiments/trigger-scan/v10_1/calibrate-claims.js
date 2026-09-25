#!/usr/bin/env node
// Choose the claim-check acceptance rule from data (no model calls).
//
//   node calibrate-claims.js [--write]
//
// Data: v5's saved Jev claim-check answers for the dev films (../v5/out/<slug>.claims.json: verdict,
// confidence and the probability of each verdict) and the round-1 verifiers' judgements of named
// claims (calibration/verifier-labels.json: 'backed', 'wrong', 'minor').
//
// Rule family: verified when p(supports) >= T and p(contradicts) < 0.15 (the brief's principled
// form). The grid is T in 0.50..0.80. DECISION RULE (fixed before looking at the grid): the LOWEST T
// at which no labelled 'wrong' claim that v5 rejected becomes verified. Rationale: the verifiers
// judged v5's rejections too strict (about 14/25 rejected sentences and 12 rejected cast/danger
// claims were backed) and its acceptances accurate (75/78); loosen only as far as the known memory
// errors allow. 'minor' claims are reported, not used. With --write the chosen rule goes into
// policy.json claim_accept (the file claims.js / check-claims.js read).
//
// Writes calibration/claim-rule.json (keys and numbers only; no claim or evidence text).
import fs from 'node:fs';
import path from 'node:path';
import { V8, TS } from './env.js';
import { statusOf } from './claims.js';

const V5OUT = path.join(TS, 'v5', 'out');
const FILMS = ['nemo', 'monsters-inc', 'lion-king'];
const labels = JSON.parse(fs.readFileSync(path.join(V8, 'calibration', 'verifier-labels.json'), 'utf8'));
const claims = Object.fromEntries(FILMS.map((f) => [f, new Map(JSON.parse(fs.readFileSync(path.join(V5OUT, `${f}.claims.json`), 'utf8')).claims.map((c) => [c.key, c]))]));
const r3 = (x) => Math.round(x * 1000) / 1000;

const MAX_C = 0.15;
const CONTRADICT_MIN = 0.5;
const grid = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];
const v5Status = (c) => c.status; // as folded in round 1 (supports at confidence >= 0.8)

const rows = labels.labels.map((l) => {
  const c = claims[l.film].get(l.key);
  if (!c) throw new Error(`label ${l.film} ${l.key}: no such v5 claim`);
  return { ...l, verdict: c.verdict, confidence: c.confidence, p: c.probabilities, v5: v5Status(c), type: c.target.type };
});

const evalRule = (T) => {
  const rule = { min_supports: T, max_contradicts: MAX_C, contradict_min: CONTRADICT_MIN };
  const st = (r) => statusOf({ verdict: r.verdict, confidence: r.confidence, probabilities: r.p }, rule);
  const backed = rows.filter((r) => r.label === 'backed');
  const wrong = rows.filter((r) => r.label === 'wrong');
  const minor = rows.filter((r) => r.label === 'minor');
  const newlyWrong = wrong.filter((r) => r.v5 !== 'verified' && st(r) === 'verified');
  // share of all v5 claims per film / type verified under the rule
  const share = {};
  for (const f of FILMS) {
    const all = [...claims[f].values()];
    const by = {};
    for (const c of all) {
      const k = c.target.type === 'cast' ? `cast.${c.target.field}` : c.target.type;
      const row = (by[k] ??= { n: 0, v5: 0, rule: 0 });
      row.n++; if (c.status === 'verified') row.v5++; if (statusOf(c, rule) === 'verified') row.rule++;
    }
    share[f] = by;
  }
  return {
    T, rule,
    backed_verified: `${backed.filter((r) => st(r) === 'verified').length}/${backed.length}`,
    backed_verified_keys: backed.filter((r) => st(r) === 'verified').map((r) => `${r.film}:${r.key}`),
    wrong_verified: `${wrong.filter((r) => st(r) === 'verified').length}/${wrong.length}`,
    wrong_newly_verified: newlyWrong.map((r) => `${r.film}:${r.key}`),
    minor_verified: `${minor.filter((r) => st(r) === 'verified').length}/${minor.length}`,
    wrongly_contradicted_backed: backed.filter((r) => st(r) === 'contradicted').map((r) => `${r.film}:${r.key}`),
    share,
  };
};

const results = grid.map(evalRule);
const chosen = results.find((r) => r.wrong_newly_verified.length === 0);
const v5row = (() => {
  const backed = rows.filter((r) => r.label === 'backed');
  const wrong = rows.filter((r) => r.label === 'wrong');
  return { rule: 'v5: verdict supports at confidence >= 0.8; any contradicts = contradicted', backed_verified: `${backed.filter((r) => r.v5 === 'verified').length}/${backed.length}`, wrong_verified: `${wrong.filter((r) => r.v5 === 'verified').length}/${wrong.length}`, backed_contradicted: backed.filter((r) => r.v5 === 'contradicted').map((r) => `${r.film}:${r.key}`) };
})();

const out = {
  generated_at: new Date().toISOString(),
  data: { claims: 'v5/out/<slug>.claims.json (dev films; saved answers, no new calls)', labels: 'calibration/verifier-labels.json', labelled: rows.length },
  decision_rule: 'lowest T in the grid with p(contradicts) < 0.15 at which no labelled wrong claim that v5 rejected becomes verified',
  v5: v5row,
  grid: results.map(({ share, ...r }) => r),
  chosen: chosen ? { min_supports: chosen.T, max_contradicts: MAX_C, contradict_min: CONTRADICT_MIN } : null,
  verified_share_v5_claims: chosen ? Object.fromEntries(FILMS.map((f) => [f, Object.fromEntries(Object.entries(chosen.share[f]).map(([k, v]) => [k, `v5 ${v.v5}/${v.n} -> ${v.rule}/${v.n}`]))])) : null,
  labelled_rows: rows.map((r) => ({ film: r.film, key: r.key, label: r.label, type: r.type, verdict: r.verdict, confidence: r.confidence, p_supports: r.p?.supports ?? null, p_contradicts: r.p?.contradicts ?? null, v5_status: r.v5 })),
  caveat: 'Small labelled set (verifier-named claims only). v6 claims are atomic and entity-linked, so their probabilities differ from these v5 answers; the rule is calibrated on v5 claim wording.',
};
fs.writeFileSync(path.join(V8, 'calibration', 'claim-rule.json'), JSON.stringify(out, null, 2));
console.log(`v5 rule: backed verified ${v5row.backed_verified}, wrong verified ${v5row.wrong_verified}, backed contradicted ${v5row.backed_contradicted.join(',') || '-'}`);
for (const r of results) console.log(`T ${r.T.toFixed(2)}: backed verified ${r.backed_verified}, wrong verified ${r.wrong_verified} (newly: ${r.wrong_newly_verified.join(',') || '-'}), minor ${r.minor_verified}, backed contradicted ${r.wrongly_contradicted_backed.join(',') || '-'}`);
console.log(`chosen: ${JSON.stringify(out.chosen)}`);
if (chosen) for (const f of FILMS) console.log(`  ${f}: ${Object.entries(out.verified_share_v5_claims[f]).map(([k, v]) => `${k} ${v}`).join('; ')}`);
if (process.argv.includes('--write') && chosen) {
  const pf = path.join(V8, 'policy.json');
  const pol = JSON.parse(fs.readFileSync(pf, 'utf8'));
  pol.claim_accept = { ...out.chosen, _about: `Chosen by calibrate-claims.js (${out.decision_rule}) on v5's saved answers and the round-1 verifiers' named judgements; see calibration/claim-rule.json. verified: p(supports) >= min_supports and p(contradicts) < max_contradicts. contradicted: verdict 'contradicts' with p(contradicts) >= contradict_min (v5 dropped any 'contradicts' answer). A Wikipedia-only sentence also needs placement 'fits' under the same rule; a lines+Wikipedia sentence is unplaced when p(conflicts) >= contradict_min.` };
  fs.writeFileSync(pf, JSON.stringify(pol, null, 2));
  console.log('policy.json claim_accept written');
}
