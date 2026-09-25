// v10 ASSEMBLY: a decision (decide.mjs) -> the targets select.js tags. Shared by build.mjs (the pipeline's
// jev-set.js) and eval/posthoc.mjs (the strict-measured-only variant), so both read decisions one way.
//   presence / event target: { layer, id (v9 id), expr, act }
//   derived target:          { layer: 'derived', id: 'jump_scare', expr, act }
//   film target:             { layer: 'film', type, expr (per item, '{item}' keys), act }
import { PRESENCE, EVENTS } from '../../v9/questions.js';
import { keysOf } from '../combine.js';

const PRES = new Set(PRESENCE.map((p) => p.id));
const EVS = new Set(EVENTS.map((e) => e.id));
const layerOf = (id) => (PRES.has(id) ? 'presence' : EVS.has(id) ? 'event' : null);

/** { targets, defs (question key -> def), assign (v9 id -> 'jev'|'sonnet') } of one decision. `jev` = the chosen Jev pick ({ expr, t, question_defs }). */
export function conceptTargets(d, jev = d.jev, owner = d.owner, extra = d.extra_jev ?? []) {
  const targets = []; const defs = {}; const assign = {};
  // a Jev concept with no eligible pick (only possible in decide.mjs --strict, e.g. appears_suddenly when the
  // lint-fixed wordings are excluded) has no targets; build.mjs still refuses it (every v9 id needs an owner)
  if (owner === 'jev' && jev) {
    Object.assign(defs, jev.question_defs ?? {});
    if (d.film) targets.push({ layer: 'film', type: d.film, expr: jev.expr, act: jev.t });
    else if (d.concept === 'appears_suddenly') {
      // the concept is the derived jump_scare; its two component events are tagged from their own Nouls (0.7)
      targets.push({ layer: 'derived', id: 'jump_scare', expr: jev.expr, act: jev.t });
      for (const id of d.v9_ids) {
        const k = [...keysOf(jev.expr)].find((x) => x.includes(`e.${id}@`));
        if (k) targets.push({ layer: 'event', id, expr: { q: k }, act: 0.7, component_of: 'jump_scare' });
      }
    } else for (const id of d.v9_ids) targets.push({ layer: layerOf(id), id, expr: jev.expr, act: jev.t });
  }
  if (owner === 'sonnet') {
    for (const x of extra) {
      Object.assign(defs, x.question_defs ?? {});
      targets.push({ layer: layerOf(x.v9_id), id: x.v9_id, expr: x.expr, act: x.t, note: 'v9 id of a Sonnet concept that Sonnet was never measured on: stays with Jev at its v9 wording (lint-fixed)', evidence: { candidate: x.id, measured: x.measured, precision: x.all ? `${x.all.hits}/${x.all.fires}` : null, recall: x.all ? `${x.all.caught}/${x.all.items}` : null } });
    }
  }
  for (const t of targets) if (t.layer === null) throw new Error(`targets: ${d.concept} id ${t.id} is neither presence nor event`);
  if (!d.film) {
    const sonIds = new Set(d.sonnet?.ids ?? []);
    for (const id of d.v9_ids) assign[id] = owner === 'sonnet' && sonIds.has(id) ? 'sonnet' : 'jev';
  }
  return { targets, defs, assign };
}
