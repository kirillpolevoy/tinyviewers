// v8: ONE ACCEPTANCE RULE for a summary sentence, over the two Jev checks the pipeline already runs
// (round-3 finding: they disagreed on ~45% of sentences -- the split check said "the scene's lines
// show this", the claim check said "unverified" -- and only the claim check decided what parents see).
//
//   claim check (check-claims.js)  citation_check over the sentence's OWN cites (cited lines +- 2
//                                  neighbours, cited W-sentences, cited TMDB entries): supports /
//                                  contradicts / says_nothing. Strict: every part must be backed by
//                                  what was cited, so a sentence that cites 2 of the 5 lines it sums
//                                  up fails.
//   split check (check-split.js)   alignment over the WHOLE scene's lines (no Wikipedia): does the
//                                  scene show what the sentence describes? Lenient on detail, blind
//                                  to Wikipedia, and asked at supported_at 0.5.
//
// PRECEDENCE (policy.json sentence_accept), CALIBRATED on the dev films (dev/calibrate-accept.mjs,
// calibration/accept-rule.json): 199 sentences stratified by what the two checks said, labelled by an
// independent model (Codex, sources only), weighted back to all 607 dev sentences.
//   - The claim check alone: est. 295 verified, 94.6% acceptable for parents (event right; 75.9% when a
//     speaker's name inferred from context also counts against it).
//   - Split-supported but claim-unverified sentences: est. 43% acceptable. Every rule that lets the split
//     check PROMOTE them (split p >= 0.5-0.95 with claim p >= 0-0.65) lowers precision (0.69-0.93); as a
//     VETO of claim-verified sentences it removes acceptable ones (0.944-0.946).
//   So: CLAIM PRECEDENCE. 1 VETO: the claim check contradicts it -> 'contradicted'. 2 the claim check
//   verifies it -> 'verified'. 3 else 'unverified'. The split check's alignment is kept on every sentence
//   (check.split) but decides only the segmentation gate (gate.js), not sentence text. The rule keeps
//   the switches (split_promotes / split_vetoes) the calibration tested, off.
//   Placement stays a separate gate for sentences that cite Wikipedia (claims.js placementOutcome; v8
//   fill sentences carry fill.js's neighbour placement): a verified but unplaced sentence is 'unplaced'.
// Pure code; no model calls.

import { codeMetrics } from './gate.js';
import { withIds, modelScenesOf } from './check-split.js';
import { placementOutcome } from './claims.js';

const P = (probs, k) => Number(probs?.[k]) || 0;
const norm = (t) => String(t ?? '').trim();

/**
 * The split check's alignment verdict for every sentence of every scene, matched by TEXT (the checked
 * sentences are the model's, before validation dropped or edited some). `raw` = the model segmentation
 * the split check ran on; ctx = { wCount, tCount } as in check-split.js.
 * Returns Map sceneId -> [verdict | null per seg sentence].
 */
export function splitAlignmentBySentence(seg, raw, cues, ctx) {
  const { covered } = codeMetrics(modelScenesOf(raw), cues, ctx);
  const checked = new Map(withIds(covered).map((s) => [s.id, (s.sentences ?? []).map((x) => norm(x.text)).filter(Boolean)]));
  const out = new Map();
  for (const s of seg.scenes) {
    const al = s.split_check?.alignment?.sentences ?? null;
    const texts = checked.get(s.split_check?.checked_as) ?? null;
    out.set(s.id, s.sentences.map((x) => {
      if (!al || !texts) return null;
      const k = texts.indexOf(norm(x.text));
      if (k < 0) return null;
      return al.find((a) => a.k === k) ?? null;
    }));
  }
  return out;
}

/**
 * Status of one sentence under the unified rule.
 *   claim: the claim-check answer stored on the sentence (x.check: {verdict, probabilities, status});
 *   split: alignVerdict {p_supports, p_contradicts} or null; rule: policy sentence_accept + claim_accept.
 * Returns { status: 'verified'|'unverified'|'contradicted', by: 'claim'|'claim+split'|null }.
 */
export function acceptSentence(claim, split, rule) {
  const cp = claim?.probabilities ?? {};
  const cs = P(cp, 'supports');
  const cc = P(cp, 'contradicts');
  const claimContradicted = claim?.verdict === 'contradicts' && cc >= rule.contradict_min;
  const splitContradicted = !!rule.split_vetoes && !!split && Number(split.p_contradicts) >= rule.split_contradicts_max;
  if (claimContradicted || splitContradicted) return { status: 'contradicted', by: claimContradicted ? 'claim' : 'split' };
  if (cs >= rule.min_supports && cc < rule.max_contradicts) return { status: 'verified', by: 'claim' };
  if (rule.split_promotes && split && Number(split.p_supports) >= rule.split_min && cs >= rule.claim_floor && cc < rule.max_contradicts) return { status: 'verified', by: 'claim+split' };
  return { status: 'unverified', by: null };
}

/**
 * Re-apply the unified rule to a checked segments object (in place): every sentence's check.status
 * (the claim check's own status is kept as check.claim_status), placement for Wikipedia-citing
 * sentences, and each scene's summary. `alignment` = splitAlignmentBySentence(...).
 * Returns counts { sentences, verified, by_claim, by_claim_split, unplaced, contradicted, changed }.
 */
export function applyUnified(seg, alignment, rule, { judgement = (x) => !!x.judgement_words?.length } = {}) {
  const n = { sentences: 0, verified: 0, by_claim: 0, by_claim_split: 0, unplaced: 0, contradicted: 0, changed: 0, no_alignment: 0 };
  for (const s of seg.scenes) {
    const al = alignment.get(s.id) ?? [];
    s.sentences.forEach((x, i) => {
      if (!x.check || x.check.status === 'unchecked') return;
      n.sentences++;
      const before = x.check.status;
      x.check.claim_status ??= before;
      const split = al[i] ?? null;
      if (!split) n.no_alignment++;
      const r = acceptSentence(x.check, split, rule);
      let status = r.status;
      if (status === 'verified' && x.cites.some((id) => id[0] === 'W')) {
        const wOnly = !x.cites.some((id) => id[0] === 'L');
        // a fill sentence (fill.js) carries its own placement verdict; everything else uses claims.js
        if (x.fill) { if (!x.fill.placed) status = 'unplaced'; }
        else if (placementOutcome(x.check.placement?.choice === 'not_checked' ? null : x.check.placement, wOnly, rule) === 'unplaced') status = 'unplaced';
      }
      x.check.status = status;
      x.check.accepted_by = status === 'verified' ? r.by : null;
      if (split) x.check.split = { p_supports: split.p_supports, p_contradicts: split.p_contradicts };
      if (status === 'verified') { n.verified++; if (r.by === 'claim') n.by_claim++; else n.by_claim_split++; }
      if (status === 'unplaced') n.unplaced++;
      if (status === 'contradicted') n.contradicted++;
      if (status !== x.check.claim_status) n.changed++;
    });
    s.summary = s.sentences.filter((x) => x.check?.status === 'verified' && !judgement(x)).map((x) => x.text).join(' ');
    s.summary_sentences = { verified: s.sentences.filter((x) => x.check?.status === 'verified').length, total: s.sentences.length };
  }
  return n;
}
