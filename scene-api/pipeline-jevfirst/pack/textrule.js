// v10.4 WHAT A PARENT READS FOR A FLAGGED SCENE (pure code; no model call, no I/O).
//
// Two changes over v10.3, decided by the user on 2026-09-25:
//
// (a) TEXT RULE 'A0>C' (measured offline in v10_3/loosen: loosen.mjs, out/report.json; rounds 7-9, 8 films, 154
//     flagged scenes, blind Codex judge). Per flagged scene:
//       text   the STRICT text (v10.3's rule, 'A0') when any attempt passed it; otherwise the LOOSE text ('C'):
//              the sentences Jev's claim check put at p(supports) >= loose.min_supports (0.4) and p(contradicts) <
//              loose.max_contradicts (0.3);
//       title  likewise: the strict title when one passed, else a title at the same loose margin.
//     Everything else is unchanged and still applies under C: a text that Jev says CONTRADICTS the lines (verdict
//     'contradicts' at p >= claim_accept.contradict_min) is never shown; a plot-citing text must be PLACED in the
//     scene (claims.js placement); a 'X threatens Y' text must not be REVERSED (p(reverse) > p(forward)); the v10.2
//     plot path is the same test at the loose margin. Citations, the 8-word quote rule, lint and 'no code-built
//     text' are upstream and untouched: the only texts are ones Sonnet wrote from the verified sources.
//     Pooled (report.json): strict alone 79/154 scenes without text, 70 placeholder titles; A0>C 23/154 without text,
//     46 placeholders; texts shown 131 (accurate 75, partly 47, wrong 9) vs 75 (49 / 23 / 3).
//     The retry triggers stay STRICT (describe2.js retryScenes / titleScenes read the strict why), exactly as
//     measured: a scene whose attempt-1 text passes only loosely still gets the second attempt, and a strict text
//     from attempt 2 wins over a loose one from attempt 1.
//
// (b) EVERY FLAGGED SCENE SHOWS WHY: its flag reasons as plain tags (the reasons' own labels: 'Creature threatens ·
//     Child in danger'), ranked most concrete first (reasons.js rankReasons), each with which model's answer raised
//     it ('jev' / 'sonnet', select.js). These are the tags the flag already rests on, not new sentences: no text is
//     built from them (code_built_reasons stays false).
//
// The functions below take the rows check-describe.js stores per text (<slug>.why{,2,3}.<run>.json scenes[id].checked:
// p_supports, p_contradicts, cites, placement / p_fits / p_conflicts, direction {p_forward, p_reverse}, plot path
// p_w_supports / p_w_contradicts / p_neighbour_neither), so the rule is re-applied from Jev's stored answers.
import { rankReasons } from './reasons.js';

export const TEXTRULE_VERSION = 'textrule-v10.4.0';
export const TEXT_RULE = 'A0>C';
export const WHY_TAG_SEPARATOR = ' · ';
export const PLACEHOLDER_TITLE = 'Flagged scene';

const num = (x) => Number(x) || 0;

/** The thresholds this module needs, from policy.json. */
export function textRulePolicy(policy) {
  const ts = policy.text_safety;
  const ca = policy.claim_accept;
  const loose = ts.loose_accept ?? { min_supports: 0.4, max_contradicts: 0.3 };
  return {
    rule: ts.text_rule ?? TEXT_RULE,
    claim: { min: ca.min_supports, max: ca.max_contradicts },
    contradict_min: ca.contradict_min,
    strict: {
      text: { min: ts.accept.min_supports, max: ts.accept.max_contradicts },
      title: ts.title_accept ? { min: ts.title_accept.min_supports, max: ts.title_accept.max_contradicts } : { min: ts.accept.min_supports, max: ts.accept.max_contradicts },
    },
    loose: { text: { min: loose.min_supports, max: loose.max_contradicts }, title: { min: loose.min_supports, max: loose.max_contradicts } },
    neighbourMin: policy.fill.neighbour_min,
  };
}

/**
 * The status of one stored text row under the strict or the loose margin: 'verified' | 'contradicted' |
 * 'unverified' | 'unplaced' | 'reversed'. Mirrors check-describe.js (acceptSentence, placementOutcome,
 * directionReversed, plotPathOk); under 'strict' it reproduces the stored `final` of every row (test/v104-*.test.js).
 *   wAllowed  every W-sentence the text cites is one describe.js gave the scene (evidence_ids.w)
 */
export function textStatus(c, margin, pol, { wAllowed }) {
  const isTitle = String(c.key).endsWith('title');
  const acc = pol[margin][isTitle ? 'title' : 'text'];
  const ps = num(c.p_supports), pc = num(c.p_contradicts);
  const cites = c.cites ?? [];
  const wiki = cites.some((id) => id[0] === 'W');
  const wOnly = !cites.some((id) => id[0] === 'L');
  const hasPl = c.placement != null && c.placement !== 'not_checked';
  const fits = num(c.p_fits), conf = num(c.p_conflicts);
  const dirRev = c.direction ? num(c.direction.p_reverse) > num(c.direction.p_forward) : false;
  // the support check's own 'contradicted' (accept.js: verdict contradicts and p >= contradict_min)
  const argmax = Object.entries({ supports: ps, contradicts: pc, says_nothing: Math.max(0, 1 - ps - pc) }).sort((a, b) => b[1] - a[1])[0][0];
  const contradicted = argmax === 'contradicts' && pc >= pol.contradict_min;
  const st = contradicted ? 'contradicted' : ps >= acc.min && pc < acc.max ? 'verified' : 'unverified';
  const placed = !wiki ? true : !hasPl ? !wOnly : wOnly ? fits >= pol.claim.min && conf < pol.claim.max : conf < pol.contradict_min;
  const linesFinal = st !== 'verified' ? st : !placed ? 'unplaced' : dirRev ? 'reversed' : 'verified';
  if (linesFinal === 'verified') return 'verified';
  if (wiki) { // v10.2 plot path (textsafe.js plotPathOk) at the same margin
    const wOk = c.p_w_supports != null && num(c.p_w_supports) >= acc.min && num(c.p_w_contradicts) < acc.max;
    const nbOk = c.p_neighbour_neither != null && num(c.p_neighbour_neither) >= pol.neighbourMin;
    if (st !== 'contradicted' && wOk && wAllowed && nbOk && !dirRev) return 'verified';
  }
  return linesFinal;
}

/**
 * One attempt's text and title for a scene under a margin, from its stored rows (code-built reasons off):
 * the verified sentences in order, the verified title or the placeholder.
 *   scene  a why-file scene ({ checked: [...] }); wList  the W ids describe.js gave the scene
 */
export function attemptWhy(scene, margin, pol, wList = []) {
  const statuses = {};
  for (const c of scene.checked ?? []) statuses[c.key] = textStatus(c, margin, pol, { wAllowed: (c.cites ?? []).filter((x) => x[0] === 'W').every((w) => wList.includes(w)) });
  const title = (scene.checked ?? []).find((c) => String(c.key).endsWith('title'));
  const ok = (scene.checked ?? []).filter((c) => !String(c.key).endsWith('title') && statuses[c.key] === 'verified');
  const tOk = !!title && statuses[title.key] === 'verified';
  return { text: ok.length ? ok.map((c) => c.text).join(' ') : null, sentences: ok.map((c) => c.key), title: tOk ? title.text : PLACEHOLDER_TITLE, title_source: tOk ? 'sonnet_verified' : 'none', statuses };
}

/**
 * v10.3 MERGE of the checked attempts (describe2.js; moved here unchanged): text / sentences from the first attempt
 * with a verified text, else the second's; the first verified title of attempts 1, 2, 3; else the placeholder.
 */
export function mergeWhy(w1, w2, w3 = null) {
  const t1 = !!w1?.text; const t2 = !!w2?.text;
  const h1 = w1?.title_source === 'sonnet_verified'; const h2 = w2?.title_source === 'sonnet_verified'; const h3 = w3?.title_source === 'sonnet_verified';
  const text = t1 ? w1 : t2 ? w2 : null;
  const base = text ?? w1 ?? w2 ?? { source: 'no_verified_text', text: null, sentences: [] };
  const title = h1 ? { title: w1.title, title_source: 'sonnet_verified', title_attempt: 1 } : h2 ? { title: w2.title, title_source: 'sonnet_verified', title_attempt: 2 } : h3 ? { title: w3.title, title_source: 'sonnet_verified', title_attempt: 3 } : { title: PLACEHOLDER_TITLE, title_source: 'none', title_attempt: null };
  return { ...base, ...title, text_attempt: t1 ? 1 : t2 ? 2 : null, sentences: (text?.sentences ?? []).map((k) => (t1 || !t2 ? k : `a2:${k}`)) };
}

/**
 * A0>C: the strict merged why when it has a text (title), else the loose merged why's. `text_rule` / `title_rule`
 * say which margin the shown text / title passed ('strict' | 'loose' | null when nothing passed).
 */
export function tieredWhy(strict, loose) {
  const sText = !!strict?.text; const sTitle = strict?.title_source === 'sonnet_verified';
  const lText = !!loose?.text; const lTitle = loose?.title_source === 'sonnet_verified';
  const tx = sText ? strict : lText ? loose : null;
  const ti = sTitle ? strict : lTitle ? loose : null;
  const { states, p, best_p: bestP, statuses: _st, ...base } = strict ?? {}; // strict's reason-statement answers belong to strict sentences only
  return {
    ...base,
    source: sText ? strict.source : lText ? 'described_loose' : 'no_verified_text',
    text: tx?.text ?? null,
    sentences: tx?.sentences ?? [],
    text_attempt: tx?.text_attempt ?? null,
    text_rule: sText ? 'strict' : lText ? 'loose' : null,
    ...(sText && states !== undefined ? { states } : {}), ...(sText && p !== undefined ? { p } : {}), ...(sText && bestP !== undefined ? { best_p: bestP } : {}),
    title: ti ? ti.title : PLACEHOLDER_TITLE,
    title_source: ti ? 'sonnet_verified' : 'none',
    title_attempt: ti?.title_attempt ?? null,
    title_rule: sTitle ? 'strict' : lTitle ? 'loose' : null,
  };
}

/**
 * A flagged scene's parent text from its eligible attempts (describe2.js --merge decides eligibility: attempt 2 only
 * for a retried scene, attempt 3 only for a title-pass scene, each only when checked for the same flag reasons).
 *   attempts     [a1, a2, a3], each { scene: why-file scene, wList: describe evidence_ids.w } or null
 *   strictWhys   the stored strict whys ([w1, w2, w3], check-describe.js buildWhy); default: rebuilt from the rows
 *                (identical while text_safety.code_built_reasons is false; the tests check it on rounds 8-9)
 * Returns { why (A0>C), strict, loose }.
 */
export function sceneWhy(attempts, pol, { strictWhys = null } = {}) {
  const per = (margin) => attempts.map((a) => (a ? attemptWhy(a.scene, margin, pol, a.wList ?? []) : null));
  const sw = strictWhys ?? per('strict');
  const strict = mergeWhy(sw[0], sw[1], sw[2]);
  const lw = per('loose');
  const loose = mergeWhy(lw[0], lw[1], lw[2]);
  return { why: tieredWhy(strict, loose), strict, loose };
}

/**
 * (b) The WHY tags of a flagged scene from its flag reasons (select.js flag_reasons: { id, label, by, p, ... }):
 * ranked most concrete first, one tag per distinct label, each with the reason ids behind it, which model answered
 * ('jev' / 'sonnet') and the highest probability. `line` is the tags joined with ' · '.
 */
export function whyTags(flagReasons, items = []) {
  const tags = [];
  for (const r of rankReasons(flagReasons ?? [], items)) {
    const label = String(r.label ?? r.id).trim();
    if (!label) continue;
    const t = tags.find((x) => x.label.toLowerCase() === label.toLowerCase());
    if (t) {
      if (!t.ids.includes(r.id)) t.ids.push(r.id);
      if (r.by && !t.by.includes(r.by)) t.by.push(r.by);
      t.p = Math.max(t.p, num(r.p));
      continue;
    }
    tags.push({ label, ids: [r.id], by: r.by ? [r.by] : [], p: num(r.p), rule: r.rule ?? null, source: r.source ?? null });
  }
  return { tags, line: tags.map((t) => t.label).join(WHY_TAG_SEPARATOR) };
}
