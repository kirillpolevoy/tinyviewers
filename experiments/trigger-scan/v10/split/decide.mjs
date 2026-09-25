#!/usr/bin/env node
// v9 SPLIT DECISION: writes ../split.json from split/stage-a.json and split/stage-b.json (pure code).
//
//   node split/decide.mjs
//
// THE RULE (the brief): a question goes to Jev only if, on the human keys, Jev's recall and precision
// are not worse than Sonnet's for that question / group; otherwise Sonnet.
//
// 1 Questions NOT contested (stage A: the v8 scorecard, Jev vs the live Sonnet pipeline pooled over the
//   9 films both have; Jev's recall >= live's AND its precision proxy or lift >= live's; and no earlier
//   evidence for Sonnet) stay with Jev. Their evidence is the group row of stage A.
// 2 CONTESTED questions (stage-A groups where live was not worse: objects_hazards, death, captivity;
//   plus the groups the earlier identical-scene measurement favoured Sonnet on: grief, crying /
//   despair, bullying, captivity, guns; plus separation and the relationship questions the brief
//   names; plus the flag-policy rule questions threatens_harm / plots_harm / child_frightened as a
//   check) were answered by BOTH models on IDENTICAL scenes of all ten dev films (stage B).
//   "Worse" is operationalised with a ONE-COUNT tolerance, so a single scene's answer cannot decide:
//     recall worse     Jev's caught items + 1 < Sonnet's caught items          (same denominator)
//     precision worse  (Jev's hits + 1) / Jev's fires < Sonnet's hits / fires  (Jev never firing is
//                      not worse: no false positives)
//   Jev iff neither is worse; else Sonnet. A question with THIN evidence (both models caught < 3 items
//   and fired < 3 times) takes its GROUP's verdict (same rule on the union of the group's contested
//   questions). The zero-tolerance ("strict") verdict is stored beside every decision.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, ITEMS } from '../questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export function worse(j, s, tol = 1) {
  const recall = j.caught + tol < s.caught;
  const jp = j.fires ? (j.hits + tol) / j.fires : null;
  const sp = s.fires ? s.hits / s.fires : null;
  const precision = jp != null && sp != null && jp < sp;
  return { recall, precision };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const A = JSON.parse(fs.readFileSync(path.join(here, 'stage-a.json'), 'utf8'));
const B = JSON.parse(fs.readFileSync(path.join(here, 'stage-b.json'), 'utf8'));
const prev = JSON.parse(fs.readFileSync(path.join(here, '..', 'split.json'), 'utf8'));

const verdictOf = (j, s, tol) => { const w = worse(j, s, tol); return { ...w, model: !w.recall && !w.precision ? 'jev' : 'sonnet' }; };
const thin = (x) => Math.max(x.jev.caught, x.sonnet.caught) < 3 && Math.max(x.jev.fires, x.sonnet.fires) < 3;
const brief = (m) => ({ caught: m.caught, items: m.items, recall: m.recall, recall_should_flag: m.recall_sf, hits: m.hits, fires: m.fires, precision: m.precision });

const groupVerdict = {};
for (const [g, x] of Object.entries(B.groups)) groupVerdict[g] = { ...verdictOf(x.jev, x.sonnet, 1), strict: verdictOf(x.jev, x.sonnet, 0).model, jev: brief(x.jev), sonnet: brief(x.sonnet) };

const assign = {}; const evidence = {};
const stageA = Object.fromEntries(A.rows.map((r) => [r.group, r]));
for (const q of [...PRESENCE.map((p) => p.id), ...EVENTS.map((e) => e.id)]) {
  const g = ITEMS[q].group;
  const x = B.questions[q];
  if (!x) {
    const a = stageA[g];
    assign[q] = 'jev';
    evidence[q] = { stage: 'A', group: g, why: `not contested: stage A ${g} Jev recall ${a.jev.recall} (${a.jev.answered}/${a.jev.items}) vs live ${a.live.recall} (${a.live.answered}/${a.live.items}); precision ${a.jev.precision} vs ${a.live.precision}, lift ${a.jev.lift} vs ${a.live.lift}` };
    continue;
  }
  const v = verdictOf(x.jev, x.sonnet, 1);
  const strict = verdictOf(x.jev, x.sonnet, 0).model;
  const isThin = thin(x);
  const model = isThin ? groupVerdict[g].model : v.model;
  assign[q] = model;
  evidence[q] = {
    stage: 'B', group: g, thin: isThin, question_verdict: v.model, strict_verdict: strict, group_verdict: groupVerdict[g].model,
    jev_worse_recall: v.recall, jev_worse_precision: v.precision,
    jev: brief(x.jev), sonnet: brief(x.sonnet),
    why: isThin ? `thin evidence (max caught ${Math.max(x.jev.caught, x.sonnet.caught)}, max fires ${Math.max(x.jev.fires, x.sonnet.fires)}): group ${g} -> ${groupVerdict[g].model}`
      : `Jev caught ${x.jev.caught} vs Sonnet ${x.sonnet.caught} of ${x.jev.items}; precision ${x.jev.hits}/${x.jev.fires} vs ${x.sonnet.hits}/${x.sonnet.fires} -> ${v.recall ? 'Jev recall worse' : ''}${v.recall && v.precision ? ', ' : ''}${v.precision ? 'Jev precision worse' : ''}${!v.recall && !v.precision ? 'Jev not worse' : ''}`,
  };
}
const sonnetUsed = Object.keys(assign).filter((q) => assign[q] === 'sonnet');
const out = {
  version: 'split-v9.1',
  decided_at: new Date().toISOString(),
  status: 'DECIDED from data (split/stage-a.json, split/stage-b.json) by split/decide.mjs; the rule is in that file.',
  rule: 'Jev keeps a question only if its recall and precision are not worse than Sonnet\'s on the human keys (one-count tolerance; thin evidence -> group verdict); otherwise Sonnet. Non-contested groups: stage A (v8 scorecard, Jev vs live Sonnet pipeline).',
  data: { stage_a: 'split/stage-a.json (from v8/scorecard/scorecard.json ' + A.source + ')', stage_b: `split/stage-b.json (${B.films.length} films, ${B.generated_at})`, dev_bias: 'all ten films are dev films: the split is chosen on the same films v9 is evaluated on; the held-out run is the real test' },
  not_split: 'Scores (danger, harm, distress, share, resolution, laughs), modifiers (retold, imagined), the kind Choice, mention questions (m.*), film-specific questions (fpl/fps/fe), the split gate, the claim checks, the moment finder and the why check stay with Jev: they have no Sonnet counterpart in the scorecard, and the round-4 evidence (split gate, claim check, concrete questions) favours Jev.',
  sonnet_asked: prev.sonnet_asked,
  sonnet_used: sonnetUsed,
  shadow: prev.sonnet_asked.filter((q) => assign[q] === 'jev'),
  assign,
  evidence,
  groups_stage_b: groupVerdict,
  groups_stage_a: A.rows.map((r) => ({ group: r.group, verdict: r.stage_a, jev: { recall: r.jev.recall, answered: r.jev.answered, items: r.jev.items, precision: r.jev.precision, lift: r.jev.lift }, live: { recall: r.live.recall, answered: r.live.answered, items: r.live.items, precision: r.live.precision, lift: r.live.lift } })),
  codex_rule_items_stage_b: B.codex_rule_items,
  scorecard_verify_crosscheck: (() => {
    // the scorecard's own verification (v8/scorecard/verify/verify.json, held-out 3 films): recall on
    // de-duplicated moment clusters, and recall INSIDE the live pipeline's footprint (live labels exist
    // only on the scenes it chose, so outside it live recall is 0 by construction)
    const f = path.resolve(here, '../../v8/scorecard/verify/verify.json');
    if (!fs.existsSync(f)) return null;
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    return {
      file: 'v8/scorecard/verify/verify.json',
      clusters: v.dedup, inside_live_footprint: v.footprint?.inside_live_footprint ?? null,
      reading: 'Groups where live is ahead on clusters or inside its footprint: objects_hazards, death, captivity, distress (all contested and measured in stage B) and PERIL inside the footprint (Jev 78% vs live 87%, n=46; clusters tie 76% vs 76%). Peril questions were NOT in the stage-B Sonnet pass (stage A pooled over 9 films had Jev not worse; the earlier identical-scene measurement favoured Jev on terrified / monster threatens / physical violence), so they stay with Jev in v9 without a same-scene test: the main open question of this split.',
    };
  })(),
};
fs.writeFileSync(path.join(here, '..', 'split.json'), JSON.stringify(out, null, 2));
console.log(`split.json: Sonnet answers ${sonnetUsed.length} questions: ${sonnetUsed.join(', ')}`);
console.log(`shadow (asked of Sonnet, Jev decides): ${out.shadow.join(', ')}`);
const flips = Object.entries(evidence).filter(([, e]) => e.stage === 'B' && e.strict_verdict !== assign[Object.keys(evidence).find((k) => evidence[k] === e)]);
console.log(`strict (zero-tolerance) verdict differs for: ${Object.entries(evidence).filter(([q, e]) => e.stage === 'B' && !e.thin && e.strict_verdict !== assign[q]).map(([q]) => q).join(', ') || 'none'}`);
}
