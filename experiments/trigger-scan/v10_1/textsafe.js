// v10.1 PARENT TEXT SAFETY (pure code; check-describe.js sends the Jev requests built here).
//
// Round 6 (Good Dinosaur, parent's-eye verifier): (1) the code-built 'Flagged because ...' line printed reasons
// that were never checked against the scene and were false (S007 'skeletons or bones are shown': Jev's own check
// of that clause scored 0.02; S026 / S029 'a weapon is used on someone' with no weapon); (2) the claim check let
// through a title with the roles reversed at exactly 0.70 (S017 'The caveboy threatens to squeeze Arlo': Arlo
// threatens) and a misattributed sentence at 0.81 (S005).
//
// v10.1 rules for everything a parent reads:
//   REASON LINE  a flag reason may be STATED (in 'Flagged because ...' or as a plain title) only when
//                (a) its own answer is at act level -- the owner model's answer (Jev's combined probability for
//                    a Jev id, Sonnet's for a Sonnet id) at the concept's act threshold; and
//                (b) the reason, as a plain sentence ("In this scene, <phrase>."), passes JEV'S CLAIM CHECK
//                    against the scene (its subtitle lines + the plot sentences its verified summary cites) under
//                    the text accept rule below.
//                A reason that fails stays a tag and still flags; it is just not written as a fact.
//   TITLES AND   verified only at p(supports) >= text_safety.accept.min_supports and p(contradicts) <
//   SENTENCES    max_contradicts (calibrated on the dev labels: dev/calibrate-margin.mjs), plus
//   DIRECTION    a title or sentence of the form 'X threatens / attacks / chases ... Y' (or 'Y is attacked by
//                X') is also asked, over the scene's lines (+ cited plot sentences), which way it goes: a Jev CHOICE
//                forward 'X <verbs> Y' / reverse 'Y <verbs> X' / neither. It is REVERSED (dropped) when
//                p(reverse) > p(forward). (The Noul "Is it X who <verbs> Y, not the other way round?" was tried
//                first, dev/out101/dev why files: it did not separate the labelled reversals from accurate texts;
//                dev/direction-variants.mjs.)
// When nothing checked is left, the parent sees no invented text: title 'Flagged scene', no description.

import { parentPhrase } from './reasons.js';

export const TEXTSAFE_VERSION = 'textsafe-v10.1.0';

// ---- direction check -------------------------------------------------------------------------------------
const VERBS = {
  threaten: ['threaten', 'threatens', 'threatened', 'threatening'],
  attack: ['attack', 'attacks', 'attacked', 'attacking'],
  chase: ['chase', 'chases', 'chased', 'chasing'],
  bite: ['bite', 'bites', 'bit', 'bitten'],
  grab: ['grab', 'grabs', 'grabbed'],
  capture: ['capture', 'captures', 'captured'],
  trap: ['trap', 'traps', 'trapped'],
  kill: ['kill', 'kills', 'killed'],
  hurt: ['hurt', 'hurts'],
  strike: ['strike', 'strikes', 'struck'],
  hunt: ['hunt', 'hunts', 'hunted'],
  push: ['push', 'pushes', 'pushed'],
  corner: ['corner', 'corners', 'cornered'],
  ambush: ['ambush', 'ambushes', 'ambushed'],
  kidnap: ['kidnap', 'kidnaps', 'kidnapped'],
  pounce: ['pounces on', 'pounced on'],
  lunge: ['lunges at', 'lunged at'],
};
const PRESENT = { threaten: 'threatens', attack: 'attacks', chase: 'chases', bite: 'bites', grab: 'grabs', capture: 'captures', trap: 'traps', kill: 'kills', hurt: 'hurts', strike: 'strikes', hunt: 'hunts', push: 'pushes', corner: 'corners', ambush: 'ambushes', kidnap: 'kidnaps', pounce: 'pounces on', lunge: 'lunges at' };
const FORM = new Map(Object.entries(VERBS).flatMap(([base, forms]) => forms.map((f) => [f, base])));
const PASSIVE_FORMS = new Set(['threatened', 'attacked', 'chased', 'bitten', 'grabbed', 'captured', 'trapped', 'killed', 'hurt', 'struck', 'hunted', 'pushed', 'cornered', 'ambushed', 'kidnapped']);
const BOUNDARY = new Set([',', ';', ':', '.', 'and', 'but', 'while', 'as', 'when', 'then', 'before', 'after', 'so', 'until', 'because', 'who', 'which', 'that', 'if']);
const Y_STOP = new Set([',', ';', ':', '.', 'and', 'but', 'while', 'as', 'when', 'then', 'before', 'after', 'so', 'until', 'because', 'with', 'into', 'for', 'in', 'on', 'at', 'over', 'from', 'to', 'if', 'unless', 'who', 'which', 'that', 'by', 'again', 'out', 'off', 'away', 'down', 'up', 'through', 'across', 'around', 'toward', 'towards', 'during', 'about', 'under', 'onto', 'apart', 'along', 'alive', 'free', 'again', 'too', 'instead', 'first', 'twice']);
const LEAD_ADV = new Set(['also', 'again', 'then', 'suddenly', 'nearly', 'angrily', 'finally', 'soon', 'now', 'still', 'even', 'later', 'once', 'quickly', 'fiercely', 'openly', 'repeatedly']);
const EMBED = new Set(['to', 'will', 'would', 'can', 'could', 'may', 'might', 'must', 'should', 'shall', 'help', 'helps', 'has', 'have', 'had', 'not', "don't", "doesn't", "didn't", 'never']);
const DET = new Set(['the', 'a', 'an', 'his', 'her', 'their', 'its', 'my', 'your', 'our', 'this', 'that', 'these', 'those']);
// an agent phrase that holds a verb of its own is a clause, not a name: skip the check rather than ask nonsense
const CLAUSE_WORD = /^(announces|announced|declares|declared|vows|vowed|says|said|tells|told|reveal|reveals|revealed|claims|claiming|orders|ordered|urges|urged|leads|led|tries|tried|try|wants|plans|planned|decides|decided|means|asks|asked|is|are|was|were|has|have|had|ends|begins|admits|confesses|stays|joke|jokes|realize|realizes|believing|saved|saves|sees|finds|learns|hears)$/i;
const AGENT_START = /^([A-Z]|the$|a$|an$|two$|three$|several$|some$)/;
const PRONOUN = /^(he|she|they|it|him|her|them|his|its|their|someone|something|everyone|anyone|one|another|each other|himself|herself|themselves)$/i;
const tokenize = (s) => String(s).replace(/([,;:.!?])/g, ' $1 ').split(/\s+/).filter(Boolean);

/**
 * The agent / patient of the first 'X <aggression verb> Y' (or passive 'Y is <verbed> by X') in a text, or
 * null when there is none or either side is only a pronoun. Returns { agent, patient, verb (3rd person
 * present), passive }.
 */
export function parseDirection(text) {
  const t = tokenize(text);
  const low = t.map((w) => w.toLowerCase());
  for (let i = 1; i < t.length; i++) {
    const two = `${low[i]} ${low[i + 1] ?? ''}`;
    const base = FORM.get(two) ?? FORM.get(low[i]);
    if (!base) continue;
    const vlen = FORM.get(two) ? 2 : 1;
    // passive: '<be> [nearly] <participle> by Y'
    const beAt = low[i - 1] === 'nearly' ? i - 2 : i - 1;
    if (vlen === 1 && PASSIVE_FORMS.has(low[i]) && ['is', 'are', 'was', 'were', 'gets', 'get', 'got', 'being', 'been'].includes(low[beAt]) && low[i + 1] === 'by') {
      const patient = npBefore(t, low, beAt);
      const agent = npAfter(t, low, i + 2);
      if (agent && patient) return { agent, patient, verb: PRESENT[base], passive: true };
      continue;
    }
    if (['is', 'are', 'was', 'were', 'be', 'been', 'being'].includes(low[i - 1])) continue; // other passives / adjectives
    // not a finite verb of its own clause: an infinitive or modal ('plans to kill', 'will kidnap'), a perfect
    // ('has badly hurt'), or a noun / adjective ('the trapped fish', "Arlo's trap")
    const prev = low[i - 1]; const prev2 = low[i - 2];
    if (EMBED.has(prev) || (/ly$/.test(prev) && EMBED.has(prev2)) || DET.has(prev) || /'s$/.test(prev)) continue;
    const agent = npBefore(t, low, LEAD_ADV.has(prev) || /ly$/.test(prev) ? i - 1 : i);
    let j = i + vlen;
    if (low[j] === 'to' && t[j + 1]) { j += 2; if (low[j] === 'the' && low[j + 1] === 'life' && low[j + 2] === 'out' && low[j + 3] === 'of') j += 4; }
    const patient = npAfter(t, low, j);
    if (agent && patient) return { agent, patient, verb: PRESENT[base], passive: false };
  }
  return null;
}
function npBefore(t, low, end) {
  let a = end - 1;
  while (a >= 0 && LEAD_ADV.has(low[a])) a--;
  const words = [];
  while (a >= 0 && !BOUNDARY.has(low[a]) && words.length < 6) { words.unshift(t[a]); a--; }
  while (words.length && LEAD_ADV.has(words[0].toLowerCase())) words.shift();
  if (words.some((w) => CLAUSE_WORD.test(w)) || !words.length || !AGENT_START.test(words[0]) || PRONOUN.test(words[0])) return null;
  const np = words.join(' ').replace(/^(before|after|during|then)\s+\w+ing\s+/i, '').trim();
  return np && !PRONOUN.test(np) ? np : null;
}
function npAfter(t, low, start) {
  const words = [];
  for (let k = start; k < t.length && !Y_STOP.has(low[k]) && words.length < 6; k++) words.push(t[k]);
  const np = words.join(' ').trim();
  return np && !PRONOUN.test(np) && AGENT_START.test(words[0]) && !/ing$/.test(words[0]) ? np : null;
}

/** The direction Noul for a parsed text. */
export function directionQuestion(d) {
  return {
    type: 'noul',
    instructions: `In \`scene\`, is it ${d.agent} who ${d.verb} ${d.patient}, not the other way round? Judge only from \`scene.lines\` and \`plot\`. The lines are subtitle dialogue and sound captions in order; the speaker is usually not named.`,
    criteria: {
      true: `The lines or plot show ${d.agent} doing this to ${d.patient} in this scene.`,
      false: `It is the other way round (${d.patient} ${d.verb} ${d.agent}), someone else does it, or the lines and plot do not show it.`,
    },
  };
}
/**
 * The direction as a CHOICE between the two explicit directions (and neither): rejects a text only when the
 * lines show it the other way round, not when they simply do not say who did it.
 */
export function directionChoice(d) {
  return {
    type: 'choice',
    instructions: `In \`scene\`, which of these happens? Judge only from \`scene.lines\` and \`plot\`. The lines are subtitle dialogue and sound captions in order; the speaker is usually not named.`,
    criteria: {
      forward: `${d.agent} ${d.verb} ${d.patient}.`,
      reverse: `${d.patient} ${d.verb} ${d.agent}.`,
      neither: `Neither: someone else does it, or the lines and plot do not show who does it.`,
    },
  };
}
export function directionChoiceBody({ film, lines, plot, d, model }) {
  return { model, state: { film: { title: film.title }, scene: { lines }, plot }, questions: { direction: directionChoice(d) } };
}

/** Request body for one direction check: the scene's lines and the plot sentences the text cites. */
export function directionBody({ film, lines, plot, d, model }) {
  return { model, state: { film: { title: film.title }, scene: { lines }, plot }, questions: { direction: directionQuestion(d) } };
}

// ---- accept rules ------------------------------------------------------------------------------------------
/** Text accept rule (margin) over a claim-check verdict ({ probabilities }). */
export function textAccepted(verdict, accept) {
  const ps = Number(verdict?.probabilities?.supports) || 0;
  const pc = Number(verdict?.probabilities?.contradicts) || 0;
  return ps >= accept.min_supports && pc < accept.max_contradicts;
}

/** Parent phrases that are noun phrases, not clauses ('a dangerous storm'): checked as 'there is <phrase>'. */
const NP_REASONS = new Set(['fire', 'explosion', 'storm', 'heights', 'dangerous_machine', 'vehicle_crash']);
/** The claim sentence a reason is checked as. */
export const reasonClaim = (reason, items) => {
  const ph = parentPhrase(reason, items).replace(/^(The|A|An) /, (m) => m.toLowerCase());
  return NP_REASONS.has(reason.id) ? `In this scene, there is ${ph}.` : `In this scene, ${ph}.`;
};

/**
 * Is a flag reason's OWN answer at act level? `reason` carries p (the owner model's probability, select.js) and
 * the scene's tags carry the same p; a flag reason exists only at act, so this re-checks it against the tag's
 * level (defensive: a context or cancelled reason is never stated).
 */
export const reasonAtAct = (reason, sceneTags) => (sceneTags ?? []).some((t) => t.id === reason.id && t.level === 'act');

/** v10.1 direction rule: a text is REVERSED when Jev puts more probability on the other direction than on its own. */
export const directionReversed = (a) => !!a && Number(a.p_reverse) > Number(a.p_forward);
