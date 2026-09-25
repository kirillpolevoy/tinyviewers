// v10 LINT-FIX VARIANTS: the smallest edits that make a measured tournament phrasing pass lint.js, so the
// variant can be measured (fixrun/run.mjs) and compete on its own numbers. Nothing else in the wording
// changes. Two kinds:
//
//  V+  v9 event wording + EXPLICIT criteria. v9 asked most events with a no-criterion only (or none). The
//      question text and v9's no-cases are kept verbatim; a yes-criterion that restates the event as a
//      shown-now condition (from v9's own moment clause) is added, and a neutral no-criterion where v9
//      had none. Same state as v9 (V9C = v9 contextState). Skipped: badly_hurt, discrimination, betrayal
//      (their question text itself fails the lint: degree / two conditions / presupposition).
//  C+ / A+  Claude / Astra phrasings whose ONLY lint failure is a seen-film name or thing in the criteria
//      (e.g. "Gramma Tala's spirit appears", "Nemo! Nemo!", "a character called Boo"). The example is
//      replaced by a generic one; everything else is kept. Same state as in the tournament.
//
// Keys: 'V+:e.<id>@V9C', 'C+:<sub>@<state>', 'A+:<sub>@<state>' (the tournament's key shape with a '+').
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS, buildQuestions } from '../../../v9/questions.js';
import { lintNoul } from '../../lint.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const { pool: POOL } = JSON.parse(fs.readFileSync(path.resolve(here, '../../jevfirst/tournament/pool.json'), 'utf8'));

// ---- V+ -----------------------------------------------------------------------------------------------
const V_SKIP = new Set(['badly_hurt', 'discrimination', 'betrayal']);
export const V_NO_DEFAULT = 'The lines and the summary do not show it.';
export const vPlusYes = (moment) => `The lines or the summary show that ${moment} in this scene, now.`;

// ---- C+ / A+ : [src, sub, [[field, from, to], ...]] -----------------------------------------------------
const NO_BOO = [['false', ' (for example a character called Boo)', '']];
export const SCRUB = [
  ['C', 'monster_creature.a', [['true', 'A dragon, an ogre, a demon, a giant crab, a lava monster count.', 'A dragon, an ogre, a demon, a sea monster count.']]],
  ['C', 'monster_creature.b', [['true', 'a dragon, an ogre, a demon, a giant crab, a lava monster, a sea monster.', 'a dragon, an ogre, a demon, a sea monster.']]],
  ['C', 'ghost_spirit.a', [
    ['true', '"Gramma Tala\'s spirit appears to comfort her"', '"her grandmother\'s spirit appears to comfort her"'],
    ['false', 'living as an ordinary resident of a land of the dead is a no', 'living as an ordinary resident of an afterlife world is a no'],
    ['false', ' (for example a character called Boo)', ''],
  ]],
  ['C', 'ghost_spirit.b', [...NO_BOO, ['false', 'Shouting "Boo!" to startle someone is a no.', 'Shouting a scary word to startle someone is a no.']]],
  ['C', 'shark.a', NO_BOO],
  ['C', 'large_predator.a', [['true', 'a crocodile or alligator', 'a crocodile']]],
  ['C', 'large_predator.b', NO_BOO],
  ['C', 'witch_sorcerer.a', [['instructions', 'sorcerer, voodoo practitioner, or other magic user?', 'sorcerer, or other magic user?'], ['true', 'witch doctor, voodoo man or queen, or says', 'witch doctor, or says']]],
  ['C', 'dark_magic.a', [['true', '"transforms Naveen into a frog using a talisman"', '"turns the prince into a frog with a charm"']]],
  ['C', 'alien.a', NO_BOO],
  ['C', 'scary_appearance.a', [['false', 'a scar, or a limp', 'a mark on the skin, or a limp']]],
  ['C', 'needle_medical.a', [['true', 'a drill at the dentist', 'a dental drill']]],
  ['C', 'graveyard_funeral.a', [['false', 'A land of the dead that is the world of the story is a no.', 'An afterlife world that is the setting of the story is a no.']]],
  ['C', 'cannot_breathe.a', [['false', 'A cough, sneeze, hiccup, gasp', 'A cough, sneeze, gasp']]],
  ['C', 'cannot_breathe.b', [['false', 'A cough, sneeze, hiccup, gasp', 'A cough, sneeze, gasp']]],
  ['C', 'creature_threat.b', [['true', '("Te Ka attacks", "the dragon chases them")', '("the creature attacks", "the dragon chases them")']]],
  ['C', 'creature_threat.c', [['true', "a named creature's roar (TE KA ROARING)", "a named creature's roar (BEAST ROARING)"]]],
  ['C', 'swallowed.a', [['true', '"We\'re inside a whale!"', '"We\'re inside its belly!"']]],
  ['C', 'dies.a', [['true', '"Manolo passed away"', '"Grandpa passed away"']]],
  ['C', 'believed_dead.a', [['true', '"Manolo passed away"', '"Grandpa passed away"']]],
  ['C', 'loved_one_dies.b', [['true', '("Gramma Tala ... before dying", "his father is killed")', '("her grandmother ... before dying", "his father is killed")']]],
  ['C', 'pet_dies.b', [['true', '"Sparky\'s dead"', '"The dog\'s dead"']]],
  ['C', 'child_taken.b', [['true', '"My baby!", "Nemo!" shouted', '"My baby!", the child\'s name shouted']]],
  ['C', 'child_separated.a', [['true', '("Nemo is taken to a fish tank far from his father", "lost in the crowd")', '("the boy is taken far away from his father", "lost in the crowd")']]],
  ['C', 'parent_searching.a', [['true', '"Nemo! Nemo!"', 'the child\'s name called again and again']]],
  ['C', 'transforms.a', [['true', '("transforms Naveen into a frog", "she turns into a frog herself")', '("turns the prince into a frog", "she turns into a frog herself")']]],
  ['C', 'appears_suddenly.a', [['false', 'A name or nickname that only contains or sounds like "boo" (for example a character called Boo) is a no.', 'A name or nickname that only sounds like a scary word is a no.']]],
  ['C', 'afraid_for_safety.a', [['true', '"Chakal is here!"', '"He\'s here!"']]],
  ['C', 'despair.a', [['false', 'a game, a crush, a date', 'a game, a date']]],
  ['C', 'despair.b', [['true', '("Moana despairs... and loses hope")', '("she despairs and loses hope")']]],
  ['C', 'animal_in_danger.a', [['true', '("Heihei falls overboard", "the dog is hit by a car")', '("the rooster falls overboard", "the dog is hit by a car")']]],
  ['C', 'animal_in_danger.b', [['true', '"Heihei, no!"', '"No, the chicken!"']]],
  ['A', 'ghost_spirit.a', [['false', "the name Boo; the exclamation 'boo';", 'a name that sounds like a ghost word; a scary word shouted to startle someone;']]],
  ['A', 'shark.a', [['false', 'Sharkbait or another name containing \'shark\'', 'a name or nickname containing \'shark\'']]],
  ['A', 'clown.a', [['false', 'An insult, clownfish, a name containing', 'An insult, a fish or animal named after clowns, a name containing']]],
  ['A', 'alien.a', [['false', "Boo or another human called 'it'", "a human called 'it'"]]],
  ['A', 'medical_care.a.treatment', [['true', 'A doctor, nurse, dentist, or vet', 'A doctor, nurse, or vet (teeth included)']]],
];

function applyEdits(q, edits, label) {
  const out = structuredClone(q);
  for (const [field, from, to] of edits) {
    const obj = field === 'instructions' ? out : out.criteria;
    const k = field === 'instructions' ? 'instructions' : field;
    if (!obj[k].includes(from)) throw new Error(`${label}: '${from}' not found in ${field}`);
    obj[k] = obj[k].split(from).join(to);
  }
  return out;
}

/** Every fix variant: [{ key, fixes (the original key), src, sub, state, concept, q }]. Throws if any fails lint. */
export function buildFixes() {
  const out = [];
  const v9 = buildQuestions({ channels: ['e'] });
  for (const e of EVENTS) {
    if (V_SKIP.has(e.id)) continue;
    const q0 = v9[`e.${e.id}`];
    const hasYes = !!q0.criteria?.true; const hasNo = !!q0.criteria?.false;
    if (hasYes && hasNo) continue; // already explicit (child_frightened)
    const q = { type: 'noul', instructions: q0.instructions, criteria: { true: q0.criteria?.true ?? vPlusYes(e.moment), false: q0.criteria?.false ?? V_NO_DEFAULT } };
    out.push({ key: `V+:e.${e.id}@V9C`, fixes: `V:e.${e.id}@V9C`, src: 'V+', sub: `e.${e.id}`, state: 'V9C', concept: null, v9_id: e.id, q });
  }
  for (const [src, sub, edits] of SCRUB) {
    const xs = POOL.filter((x) => x.src === src && x.sub === sub);
    if (!xs.length) throw new Error(`fixes: no pooled ${src}:${sub}`);
    for (const x of xs) {
      const q = applyEdits(x.q, edits, `${src}:${sub}@${x.state}`);
      out.push({ key: `${src}+:${sub}@${x.state}`, fixes: `${src}:${sub}@${x.state}`, src: `${src}+`, sub, state: x.state, concept: x.concept, q });
    }
  }
  for (const f of out) { const l = lintNoul(f.q); if (l.length) throw new Error(`fix ${f.key} still fails lint: ${l.join(', ')}`); }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const f = buildFixes();
  console.log(`${f.length} fix variants: V+ ${f.filter((x) => x.src === 'V+').length}, C+ ${f.filter((x) => x.src === 'C+').length}, A+ ${f.filter((x) => x.src === 'A+').length}`);
  console.log([...new Set(f.map((x) => x.state))].join(', '));
}
