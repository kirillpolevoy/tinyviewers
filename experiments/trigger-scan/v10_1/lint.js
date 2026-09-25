// v10 QUESTION LINT: the TypeSafe rules for a Jev Noul, as code (pure; no model calls).
//
// Used twice, the same way:
//   1. assemble/decide.mjs: a tournament candidate is ELIGIBLE only when every Jev question it asks passes
//      (so v10 can only pick phrasings that meet the brief, not just phrasings that scored well);
//   2. test/v10-questions.test.js: every Jev question v10 actually asks must pass.
//
// Rules (docs: v4/verify/docs/clean/model-jaggedness_jev-1.13.md, primitives_noul.md; the v10 brief):
//   one_question     the instructions are one question: exactly one '?', at the end
//   yes_criteria     an explicit YES criterion (criteria.true, non-empty)
//   no_criteria      an explicit NO criterion (criteria.false, non-empty)
//   one_condition    no second condition chained onto the first ("followed by", "while", "and then",
//                    "after", "before", "because", "both", "as well as", a coordinated second verb
//                    "... and is/does/says ..."). A list of synonyms joined by "or" is ONE condition
//                    ("chased, pursued, or hunted"); "and" joining two predicates is two.
//   no_presupposition no referent the question assumes exists ("the two arguing characters",
//                    "the character who dies", "that action")
//   no_degree        no degree asked as yes/no ("very", "badly", "seriously", "how much")
//   no_indirection   no hypothetical or second-hand judgement ("would", "might", "seem", "likely",
//                    "a viewer", "the audience")
//   no_entity        no name or film-specific thing from a SEEN film (DENY below), in the instructions or
//                    the criteria. A film-template question's own <name> slot is filled in code per film.
//
// The one-condition rule is a lexical check: it catches the chained forms above, not every way to hide
// two judgements in one sentence. It is applied to the question text only (criteria may list cases).

// Seen-film entities: v9's test list (round 1-3 films, kept verbatim, including its generic words such as
// 'lion' and 'whale', which came from those films) + the eight films opened since (iron-giant, up,
// tangled, coco, how-to-train-your-dragon, book-of-life, princess-and-the-frog, moana): names, places and
// film-specific things. Plain words that are also ordinary English (ray, dean, papa, grandma, giant) are
// left out; their film-specific compounds are in.
export const DENY = [
  // v9 list (nemo, monsters-inc, lion-king, frankenweenie, wild-robot)
  'nemo', 'marlin', 'dory', 'coral', 'gill', 'bruce', 'crush', 'squirt', 'darla', 'nigel', 'bloat', 'peach', 'mr. ray', 'sydney', 'dentist',
  'sulley', 'sullivan', 'mike', 'wazowski', 'boo', 'randall', 'waternoose', 'celia', 'roz', 'fungus', 'yeti', 'kitty', 'scream extractor', 'monstropolis', 'door vault', 'cda',
  'simba', 'mufasa', 'scar', 'nala', 'timon', 'pumbaa', 'rafiki', 'zazu', 'sarabi', 'shenzi', 'banzai', 'pride rock', 'stampede', 'wildebeest', 'hyena', 'lion', 'elephant graveyard',
  'clownfish', 'barracuda', 'anglerfish', 'jellyfish', 'pelican', 'seagull', 'whale', 'fish tank', 'aquarium', 'short fin', 'sock', 'gator', 'alligator', 'snow cone',
  'frankenweenie', 'victor', 'sparky', 'frankenstein', 'rzykruski', 'van helsing', 'toshiaki', 'nassor', 'weird girl', 'mr. whiskers', 'new holland',
  'wild robot', 'rozzum', 'brightbill', 'fink', 'longneck', 'thorn', 'paddler', 'pinktail', 'vontra', 'gosling',
  // v10 additions: the other eight seen films
  'sharkbait', 'hogarth', 'mansley', 'iron giant', 'rogard', 'fredricksen', 'russell', 'muntz', 'dug', 'kevin', 'ellie', 'cone of shame',
  'rapunzel', 'flynn', 'gothel', 'maximus', 'pascal', 'stabbington', 'frying pan',
  'miguel', 'hector', 'héctor', 'ernesto', 'de la cruz', 'imelda', 'abuelita', 'mama coco', 'dante', 'pepita', 'chicharron', 'chicharrón', 'marigold', 'cenote', 'land of the dead', 'day of the dead', 'final death',
  'hiccup', 'toothless', 'stoick', 'gobber', 'astrid', 'snotlout', 'fishlegs', 'berk', 'red death', 'monstrous nightmare',
  'manolo', 'joaquin', 'xibalba', 'la muerte', 'chakal', 'posada', 'cave of souls', 'land of the remembered', 'land of the forgotten',
  'tiana', 'naveen', 'facilier', 'shadow man', 'mama odie', 'la bouff', 'evangeline', 'bayou', 'voodoo', 'talisman', 'mardi gras',
  'moana', 'maui', 'tamatoa', 'heihei', 'gramma tala', 'te ka', 'te kā', 'te fiti', 'kakamora', 'lalotai', 'realm of monsters', 'giant crab', 'lava monster', 'demigod', 'fishhook',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (hay, word) => new RegExp(`(^|[^a-zà-ÿ])${esc(word)}([^a-zà-ÿ]|$)`, 'i').test(hay);

const CHAIN = [
  /\bfollowed by\b/i, /\band then\b/i, /\bas well as\b/i, /\bwhile\b/i, /\bafter\b/i, /\bbefore\b/i, /\bbecause\b/i, /\bboth\b/i,
  /\bso that\b/i, /\bwhich (then|causes|makes)\b/i,
  // a second predicate coordinated onto the first
  /\band (is|are|was|were|does|do|did|has|have|says|said|tells|told|then|also|reacts|cries|screams|shows|gets|becomes|can(not|'t)?)\b/i,
  /\b(AND|OR)\b/, // combine-rule words leaking into a question
];
const PRESUPPOSE = [
  /\b(the|that|those) (two|other|same)\b/i,
  /\bthe (character|child|adult|animal|person|creature|caregiver|parent|villain|victim|speaker|one)s? (who|that|whom|whose)\b/i,
  /\bthat (action|character|child|adult|animal|person|creature|exchange|change|threat|danger)\b/i,
];
const DEGREE = [/\bvery\b/i, /\bbadly\b/i, /\bseriously\b/i, /\bextremely\b/i, /\breally\b/i, /\bhow (much|many|badly|scary|bad)\b/i, /\ba lot\b/i];
const INDIRECT = [/\bwould\b/i, /\bmight\b/i, /\bseems?\b/i, /\blikely\b/i, /\bprobably\b/i, /\bviewers?\b/i, /\baudience\b/i];

/**
 * Lint one Jev Noul { instructions, criteria:{true,false} }. `slots` = film-template placeholders or
 * filled names to ignore for the entity rule. Returns [] when it passes, else the failed rule names.
 */
export function lintNoul(q, { slots = [] } = {}) {
  const fails = [];
  const ins = String(q?.instructions ?? '');
  const t = q?.criteria?.true;
  const f = q?.criteria?.false;
  const qm = (ins.match(/\?/g) ?? []).length;
  if (qm !== 1 || !ins.trim().endsWith('?')) fails.push('one_question');
  if (typeof t !== 'string' || !t.trim()) fails.push('yes_criteria');
  if (typeof f !== 'string' || !f.trim()) fails.push('no_criteria');
  if (CHAIN.some((re) => re.test(ins))) fails.push('one_condition');
  if (PRESUPPOSE.some((re) => re.test(ins))) fails.push('no_presupposition');
  if (DEGREE.some((re) => re.test(ins))) fails.push('no_degree');
  if (INDIRECT.some((re) => re.test(ins))) fails.push('no_indirection');
  let hay = `${ins}\n${t ?? ''}\n${f ?? ''}`;
  for (const s of slots) hay = hay.split(s).join(' ');
  const hits = DENY.filter((w) => mentions(hay, w));
  if (hits.length) fails.push(`no_entity:${hits.join('|')}`);
  return fails;
}

export const passes = (q, opts) => lintNoul(q, opts).length === 0;
