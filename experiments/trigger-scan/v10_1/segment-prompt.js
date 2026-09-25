// The v7 segmentation prompt and schema (v6's prompt, moved into a module so tests can build it).
// makePrompts(...).systemFor(1, N) / userFor(1, N) are byte-identical to v6/segment.js SYSTEM / USER
// (test/segment-prompt.test.js); a part (attempt 2) adds the PART RULES and prints only its lines.
import { formatTime } from '../srt.js';
import { CAST_KINDS, TRI, DISPOSITIONS, DANGER_KINDS, GROUPS } from './cite.js';

// Prompt text is not indented inside the function on purpose: the template literals must stay
// byte-identical to v6's.
export function makePrompts({ film, W, T, cues, SRC }) {
const N = cues.length;
// ---- prompt -----------------------------------------------------------------------------------------
// systemFor(1, N) is byte-identical to v6's SYSTEM (test/segment-prompt.test.js); a part adds PART RULES.
const systemFor = (first, last, part = null) => `You split a feature film into its scenes for a reference database that parents use to decide which scenes to skip. You work ONLY from three numbered sources given to you:
  L-lines: the film's subtitle lines, "L<cue> [<time>] <text>". Text in (PARENTHESES) or [BRACKETS] is a sound caption; ♪ marks song lyrics.
  W-sentences: the plot section of the film's English Wikipedia article, "W<n> <sentence>".
  T-entries: the film's TMDB cast list, "T<n> <character name>".

THE SOURCE RULE. Use only what these sources say. Do NOT use your own knowledge or memory of this film, even if you are sure of it: no event, appearance, age, species, relationship, name or outcome that the sources do not state or directly imply. Every fact you write must cite the ids that support it (for example ["L412","L415"], ["W7"], ["T3"]). If no source supports something, leave it out, or write "unknown" where a field asks for a value. An omitted or "unknown" fact is always better than a guessed one. Code checks every citation against the cited text and discards what the text does not support.

What counts as support: the cited text states it, or it follows directly from it (a line "Tom! Where are you?" supports "someone calls for Tom"; it does not support "Tom's mother panics"). Subtitle lines rarely name the speaker: say who speaks only when the lines or the W-sentences make it clear. Sound captions such as "(DOG BARKING)" are evidence of what is heard.

Return three things.

1. cast: the characters who matter in the story (named ones, and important unnamed ones the sources mention, e.g. "the guards"). For each:
- name: as the sources call them. tmdb: the T id of their TMDB entry, or "" if none.
- aliases: other NAMES the sources use for this same character (a full name, a nickname), each as {"name", "cites"} where cites are the ids in which that name is used for this character. A description is not a name: never give "the kid", "the girl", "the king", "your majesty", "that thing" or similar as an alias. An alias without a cite is thrown away.
- kind: person (a grown-up human or human-like being), child (a human child), animal (a real animal species, talking or not), creature (a monster or fantasy being), robot, other, or unknown.
- is_child: "true" if the sources show they are a child or young (e.g. called a kid, a son or daughter, a toddler, a cub), "false" if they show an adult, else "unknown".
- looks_frightening: "true" only if the sources describe their appearance as frightening (e.g. a sound caption of a roar at someone, a character screaming at the sight of them, a line calling them a monster), "false" if the sources describe them as harmless-looking, else "unknown".
- disposition: villain (works against the heroes throughout), threat (dangerous in some scenes but not a plotting villain, e.g. a predator), ally, neutral, changes (turns from one to another), or unknown. disposition_note: at most 12 words, the cited reason, e.g. "plans to steal the town's water supply". Empty when unknown.
- group: which parent concern a question about this character belongs to: creatures_figures (their presence on screen), hostility (cruelty, threats, schemes), violence, peril (they are often in danger), separation, animals, or none.
- cites: for each of name, kind, is_child, looks_frightening, disposition, the ids that support that field. The name's cites must include the ids that NAME the character (their T entry, a W-sentence or line that uses the name): every other field is checked together with them, so a W-sentence that says "a young girl" supports "is a child" only when the name's cites show who that girl is. An empty list for a field makes that field "unknown".

2. dangers: things other than characters that recur or matter as dangers in this film: machines, places, objects, groups of creatures, situations (e.g. "a trap", "a flood", "a storm"). For each: name, kind (machine, place, object, creature_group, situation), note (at most 12 words, what the sources say it does), group (objects_hazards, peril, captivity, injury, creatures_figures, violence, death, eerie, or none), cites. Only dangers the sources mention.

3. scenes: EVERY scene of the film, in order, from the first line to the last.${part ? partRule(first, last, part) : ''}
- A scene is a continuous stretch of one situation: one place, the same characters, one line of action. Parents will skip whole moments by these boundaries, so cut where the situation changes:
  - Start a new scene when the place changes, and when WHO IS IN DANGER changes (a different character is now threatened, or a danger begins or ends).
  - Start a new scene at the onset of a danger (an attack, a chase, a fall, a storm, a capture), so the danger's first line is the first line of its scene.
  - Never put an unrelated comic beat in the same scene as a danger beat: a gag or joke between other characters before, between or after danger moments is its own scene.
  - Keep a flashback, a dream, a memory or a story being told as its own scene, apart from the present-day action before and after it; a danger inside a flashback is its own scene.
  - Do not split in the middle of an exchange of dialogue. Typical features have 50 to 150 scenes; do not merge unrelated action to save space.
- start_cue and end_cue are L numbers (just the number). Cover every line exactly once: the first scene starts at ${first}, each later scene starts right after the previous scene's end_cue, the last ends at ${last}.
- setting: at most 6 words, where it happens, only if a cited line or W-sentence names or shows the place; else "unknown". setting_cites: the ids.
- sentences: 1 to 4 short sentences (each at most 25 words) saying who is there and what happens, each with its own cites.
  - A sentence may cite L-lines ONLY from this scene's own range (start_cue..end_cue).
  - Cite a W-sentence only when this scene's own lines show that this is where that plot event happens; then cite those lines too.
  - Describe events and the characters' visible or audible reactions, never how the scene feels to a viewer: do not use words such as scary, frightening, sad, tense, intense, cute, funny, touching, dramatic.
  - When a W-sentence states a danger with a strong verb (attacks, kills, mauls, chases, traps, drowns, kidnaps), keep that verb; do not soften it.
  - Paraphrase; never copy more than five words in a row from the lines.
  - A scene whose lines are only songs or sound captions still gets a sentence, e.g. "A song plays." citing its lines.

CITATION DISCIPLINE. Each claim is later checked against ONLY the ids you cite (plus a couple of neighbouring lines); anything the cited text does not back is thrown away.
- Cite every line a sentence relies on, not a sample: when a sentence sums up an exchange, cite each line that carries the fact (usually 2 to 6 ids).
- Keep each sentence to what the cited text shows: who does or says what, to whom. Leave out adjectives, emotions, colours, sizes, motives and extra details unless a cited line or W-sentence states them.
- When a W-sentence describes an event of this scene, cite it together with the scene's lines that place the event here. Most W-sentences belong to some scene; try to use each one.
- kind: a talking animal, or a toy-sized or young animal, is "animal" (use is_child "true" for a young one); "child" is only for a human child; "creature" is only for monsters and fantasy beings, never for real animal species.`;

const userFor = (first, last, part = null) => `Film: ${film.title}${film.year ? ` (${film.year})` : ''}.

TMDB cast (${T.length} entries):
${T.map((t) => `${t.id} ${t.character}`).join('\n')}

Wikipedia plot, article "${SRC.wikipedia.title}" (${W.length} sentences):
${W.map((w) => `${w.id} ${w.text}`).join('\n')}

${part ? `Subtitle lines L${first} to L${last} of the film's ${N} lines (part ${part.k} of ${part.of}; running ${formatTime(cues[first - 1].startMs)} to ${formatTime(cues[last - 1].endMs)}):` : `Subtitle lines (${N} lines, L1 to L${N}, running ${formatTime(cues[N - 1].endMs)}):`}
${cues.slice(first - 1, last).map((c) => `L${c.index} [${formatTime(c.startMs)}] ${c.text}`).join('\n')}

${part ? `Return the cast, the dangers, then every scene of lines L${first} to L${last}. Use only these sources and cite every fact.` : `Return the cast, the dangers, then every scene of the film from L1 to L${N}. Use only these sources and cite every fact.`}`;

/** The part rule (attempt 2): only these lines; the film continues outside them. */
function partRule(first, last, part) {
  return `
  PART RULES. You are given only lines L${first} to L${last} of the film (part ${part.k} of ${part.of}), with the whole Wikipedia plot and the whole TMDB cast.
  - Return scenes for these lines only: the first scene starts at L${first} and the last ends at L${last}, even when the situation continued before L${first} or goes on after L${last}.
  - Cite only lines L${first} to L${last}. Many W-sentences describe events in other parts of the film: cite a W-sentence only when these lines show the event.
  - Use the exact L numbers printed before each line; never estimate or round a line number.
  - The cast and the dangers are those of these lines (with the W- and T-ids that name them).`;
}

const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ids = { type: 'array', items: { type: 'string' } };
const SCHEMA = obj({
  cast: {
    type: 'array',
    items: obj({
      name: { type: 'string' }, tmdb: { type: 'string' }, aliases: { type: 'array', items: obj({ name: { type: 'string' }, cites: ids }) },
      kind: { type: 'string', enum: CAST_KINDS }, is_child: { type: 'string', enum: TRI }, looks_frightening: { type: 'string', enum: TRI },
      disposition: { type: 'string', enum: DISPOSITIONS }, disposition_note: { type: 'string' }, group: { type: 'string', enum: GROUPS },
      cites: obj({ name: ids, kind: ids, is_child: ids, looks_frightening: ids, disposition: ids }),
    }),
  },
  dangers: {
    type: 'array',
    items: obj({ name: { type: 'string' }, kind: { type: 'string', enum: DANGER_KINDS }, note: { type: 'string' }, group: { type: 'string', enum: GROUPS }, cites: ids }),
  },
  scenes: {
    type: 'array',
    items: obj({
      start_cue: { type: 'integer' }, end_cue: { type: 'integer' }, setting: { type: 'string' }, setting_cites: ids,
      sentences: { type: 'array', items: obj({ text: { type: 'string' }, cites: ids }) },
    }),
  },
});
return { systemFor, userFor, partRule, SCHEMA };
}
