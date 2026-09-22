// excerpts.js — choose the most relevant subtitle lines for a flagged beat, and nothing else.
//
//   node excerpts.js                 # rebuild recordings/*.excerpts.json for every recording
//   node excerpts.js nemo lion-king  # just these
//
// No API calls. Everything comes from recordings/<slug>.jev.json (per-beat probabilities, beat cue
// ranges, which beats are flagged) plus data/<slug>.srt (the lines themselves).
//
// The problem this solves: Jev answers per beat, not per cue, so nothing in the recording says WHICH
// of a beat's eight lines is the reason `shark` came back at 0.94. We approximate it lexically. Each
// cue is scored on the evidence it carries for the beat's top three flagged items, weighted by each
// item's probability; the best two win. It is a heuristic and it is allowed to be wrong — the cost of
// being wrong is showing a parent a duller line from the same beat, not a wrong beat.
//
// Policy (owner): exactly two lines per flagged beat where the beat has two cues, at most 12 words
// each, in film order, flagged beats only. When fewer than two cues score above zero the remaining
// slot goes to the beat's longest cue, so a beat always gets its two lines.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS } from './taxonomy-v3.js';
import { here, loadFilm } from './common.js';
import { EXCERPT_MAX_LINES, EXCERPT_MAX_WORDS } from './jev-v3-core.js';

// ---- keywords ------------------------------------------------------------------------------------
// Three sources per taxonomy item:
//   1. the parent-facing alias table in scene-api/load.js (copied, not imported: that is another
//      package and it built the list for parents typing into a search box)
//   2. the item's own label words, minus stopwords
//   3. DIALOGUE below — what a character actually says while the thing is happening. "Someone is
//      being chased" never appears in a subtitle; "Swim! Go! He's right behind us!" does. This is the
//      source that does the real work, because subtitles are speech, not description.
// Over-matching is the safer error here, as it is in scene-api: a spurious match can only move the
// choice to another line of the same beat.

// From scene-api/load.js EXTRA_ALIASES, verbatim.
const ALIASES = {
  monster_creature: ['strange creature', 'bogeyman'],
  ghost_spirit: ['ghost', 'ghosts', 'spirit', 'haunting', 'haunted'],
  reanimated_dead: ['zombie', 'undead', 'brought back to life', 'resurrection'],
  skeleton_corpse: ['skeleton', 'bones', 'corpse', 'dead body'],
  shark: ['sharks', 'jaws'],
  spider_insect: ['spider', 'spiders', 'bug', 'bugs', 'insect', 'creepy crawly'],
  snake_reptile: ['snake', 'snakes', 'lizard', 'reptile'],
  large_predator: ['wolf', 'lion', 'bear', 'tiger', 'crocodile', 'predator', 'big cat', 'hyena'],
  rodent_bat: ['rat', 'rats', 'mouse', 'mice', 'bat', 'bats'],
  clown_doll_puppet: ['clown', 'doll', 'puppet', 'mask', 'mannequin', 'dummy'],
  robot_machine_being: ['robot', 'robots', 'machine'],
  witch_magic_villain: ['witch', 'wizard', 'magic', 'curse', 'sorcerer'],
  alien: ['aliens', 'extraterrestrial', 'ufo'],
  scary_appearance: ['scary face', 'ugly', 'disfigured', 'scary looking'],
  gun: ['guns', 'firearm', 'rifle', 'pistol', 'shooting', 'shot', 'shots', 'fired', 'gunfire', 'gunshot'],
  blade_weapon: ['knife', 'knives', 'sword', 'axe', 'weapon', 'blade', 'stabbing'],
  fire: ['fires', 'burning', 'flames', 'flame', 'on fire', 'blaze'],
  explosion: ['explosions', 'bomb', 'blast', 'blown up'],
  storm_lightning: ['storm', 'thunder', 'lightning', 'tornado', 'flood'],
  deep_dark_water: ['water', 'deep water', 'ocean', 'sea', 'underwater'],
  heights: ['height', 'cliff', 'ledge', 'high up', 'long drop'],
  darkness: ['dark', 'the dark', 'pitch black', 'night'],
  needle_medical: ['needle', 'needles', 'injection', 'shot', 'shots', 'syringe', 'dentist', 'jab', 'vaccine'],
  hospital_illness: ['hospital', 'doctor', 'illness', 'sick', 'nurse'],
  blood_wound: ['blood', 'bleeding', 'bloody', 'wound', 'wounded', 'gore', 'cut'],
  vehicle_crash: ['car crash', 'crash', 'plane crash', 'train crash', 'car accident'],
  cage_net_trap: ['cage', 'caged', 'net', 'trap', 'trapped', 'tied up', 'locked in', 'locked up'],
  graveyard_funeral: ['graveyard', 'cemetery', 'grave', 'funeral', 'tomb', 'burial'],
  dangerous_machine: ['machinery', 'saw', 'blades', 'electricity', 'electrocution'],
  chased: ['chase', 'chasing', 'hunted'],
  attacked: ['attack', 'attacks', 'mauled', 'bitten'],
  weapon_used: ['shot', 'shots', 'shooting', 'fired', 'stabbed'],
  falling: ['fall', 'falls', 'falling off'],
  drowning: ['drown', 'drowns', 'suffocating', 'underwater'],
  caught_in_hazard: ['on fire'],
  vehicle_accident: ['car accident', 'crashes', 'crash'],
  battle: ['war', 'battles', 'bombing'],
  captured: ['caught', 'captured', 'netted', 'kidnapped', 'caged', 'trapped'],
  trapped_struggling: ['trapped', 'trap', 'swallowed', 'buried', 'locked up', 'locked in'],
  injured: ['hurt', 'injury', 'wounded', 'wound', 'stung', 'burned', 'bitten', 'cut'],
  dies: ['death', 'dying', 'killed'],
  believed_dead: ['presumed dead'],
  parent_death_learned: ['loses a parent'],
  grieving: ['mourning', 'grief'],
  child_taken: ['kidnapping', 'taken', 'abducted', 'snatched'],
  child_lost: ['separated', 'missing child'],
  abandoned: ['abandonment', 'left behind', 'sent away'],
  family_in_danger: [],
  parents_fighting: ['parents arguing', 'divorce'],
  rages_at_child: ['yelling'],
  threatens_harm: ['threat', 'threats', 'threatening'],
  bullying: ['bully', 'bullies', 'mocked', 'teasing', 'excluded'],
  discrimination: ['racism', 'prejudice'],
  caregiver_cruelty: ['abuse', 'neglect'],
  betrayal: ['betrayed', 'tricked'],
  transformation: ['possessed'],
  nightmare: ['nightmares', 'bad dream'],
  unseen_threat: ['something watching', 'being followed'],
  jump_scare: ['startle'],
  terrified: ['terror', 'panic', 'screaming', 'scared'],
  sobbing_despair: ['crying', 'sobbing', 'despair'],
  animal_cruelty: ['animal abuse'],
  animal_in_danger: [],
  dangerous_act: ['dare'],
  runs_away: ['running away'],
  slapstick_violence: ['slapstick'],
};

// What the line itself says while it is happening. A trailing "!" is part of the keyword where the
// exclamation is the signal: "no!" is a cry, "no" is a refusal, and bare "no" would otherwise win
// almost every beat it appeared in.
const DIALOGUE = {
  monster_creature: ['monster', 'creature', 'thing', 'beast', 'it is coming', 'what is that', 'scary', 'growl', 'roar', 'look at it', 'behind you'],
  ghost_spirit: ['ghost', 'spirit', 'soul', 'haunt', 'possessed'],
  reanimated_dead: ['alive', 'alive again', 'back from the dead', 'reanimate'],
  skeleton_corpse: ['skull', 'skeleton', 'bone', 'body', 'remains'],
  shark: ['shark', 'fin', 'teeth', 'jaws', 'eat me', 'eat us', 'swim away', 'food', 'eat', 'hungry', 'feeding', 'frenzy', 'snack', 'bite', 'friends not food'],
  spider_insect: ['spider', 'web', 'bug', 'beetle', 'wasp', 'bee', 'sting', 'crawling'],
  snake_reptile: ['snake', 'hiss', 'lizard', 'gator', 'crocodile', 'scales'],
  large_predator: ['wolf', 'lion', 'bear', 'tiger', 'hyena', 'claws', 'growl', 'roar', 'fangs', 'pack', 'hunt', 'prey', 'stampede', 'herd', 'pounce', 'eat you', 'ate', 'kill'],
  rodent_bat: ['rat', 'mouse', 'mice', 'bat', 'vermin', 'squeak'],
  clown_doll_puppet: ['clown', 'doll', 'puppet', 'mask', 'toy'],
  robot_machine_being: ['robot', 'machine', 'circuit', 'metal', 'gears', 'unit', 'program', 'malfunction', 'power', 'system', 'activate', 'shut down', 'override', 'battery', 'mechanical', 'beep'],
  witch_magic_villain: ['witch', 'spell', 'magic', 'curse', 'potion', 'wand'],
  alien: ['alien', 'space', 'ship', 'planet', 'from another world', 'not from here', 'creature', 'landed', 'outer space'],
  scary_appearance: ['look at it', 'hideous', 'horrible', 'monstrous', 'face', 'ugly'],
  gun: ['gun', 'rifle', 'shoot', 'shoot him', 'trigger', 'bullet', 'aim', 'cock the'],
  blade_weapon: ['knife', 'sword', 'blade', 'axe', 'spear', 'stab', 'cut you'],
  fire: ['fire', 'burn', 'flame', 'smoke', 'hot', 'ash', 'torch'],
  explosion: ['bomb', 'blast', 'explode', 'blow', 'boom', 'detonate', 'fuse'],
  storm_lightning: ['storm', 'thunder', 'lightning', 'wind', 'rain', 'wave'],
  deep_dark_water: ['water', 'ocean', 'sea', 'deep', 'drop off', 'current', 'swim', 'sink', 'dive', 'tank'],
  heights: ['high', 'up there', 'down there', 'cliff', 'edge', 'ledge', 'jump', 'do not look down', 'fall'],
  darkness: ['dark', 'black', 'cannot see', 'no light', 'light', 'shadow', 'night'],
  needle_medical: ['needle', 'shot', 'injection', 'dentist', 'drill', 'operation'],
  hospital_illness: ['hospital', 'doctor', 'sick', 'ill', 'medicine', 'nurse', 'dying'],
  blood_wound: ['blood', 'bleeding', 'wound', 'cut', 'hurt', 'scar', 'smell'],
  vehicle_crash: ['crash', 'brake', 'out of control', 'swerve', 'hit', 'truck', 'car'],
  cage_net_trap: ['net', 'cage', 'trap', 'bag', 'hook', 'line', 'caught', 'bars', 'locked'],
  graveyard_funeral: ['grave', 'buried', 'cemetery', 'funeral', 'tomb', 'headstone'],
  dangerous_machine: ['machine', 'engine', 'blades', 'wires', 'current', 'saw', 'propeller', 'sparks', 'lever', 'crusher', 'conveyor', 'shredder', 'motor', 'gears', 'pull the'],
  chased: ['run', 'go go go', 'swim', 'faster', 'behind us', 'behind you', 'after us', 'coming', 'get away', 'hurry', 'move', 'come back', 'get you', 'catch me', 'follow'],
  attacked: ['bite', 'bit me', 'attack', 'grab', 'claws', 'teeth', 'let go', 'get off', 'he has got'],
  weapon_used: ['shoot', 'shot', 'stab', 'fire at', 'swing'],
  falling: ['fall', 'falling', 'slipping', 'let go', 'hold on', 'grab my', 'losing my grip'],
  drowning: ['breathe', 'air', 'cannot breathe', 'choking', 'water', 'sinking', 'gasp'],
  caught_in_hazard: ['stuck', 'pull me out', 'cannot get out', 'trapped'],
  vehicle_accident: ['crash', 'brake', 'look out', 'hold on'],
  battle: ['attack', 'charge', 'war', 'army', 'fight', 'retreat'],
  captured: ['caught', 'got him', 'got you', 'take him', 'grab him', 'net', 'hold him'],
  trapped_struggling: ['stuck', 'trapped', 'let me out', 'cannot move', 'help me', 'pull'],
  injured: ['hurt', 'ow', 'ouch', 'my arm', 'my leg', 'bleeding', 'broken', 'you okay'],
  dies: ['dead', 'die', 'died', 'dying', 'killed', 'gone', 'lost him', 'lost her'],
  believed_dead: ['gone', 'dead', 'lost', 'he is gone', 'she is gone', 'not coming back'],
  parent_death_learned: ['father', 'mother', 'dad', 'mum', 'mom', 'dead', 'gone', 'my fault'],
  grieving: ['miss him', 'miss her', 'gone', 'sorry', 'remember', 'forgive'],
  child_taken: ['take him', 'took him', 'took her', 'my son', 'my daughter', 'give him back', 'let go of'],
  child_lost: ['where are you', 'lost', 'my son', 'my daughter', 'come back', 'find him', 'find her', 'daddy', 'mommy', 'mummy'],
  abandoned: ['leave me', 'left me', 'go away', 'on your own', 'alone', 'do not want you'],
  family_in_danger: ['my son', 'my daughter', 'my family', 'help him', 'help her', 'get out of there', 'my boy', 'my brother', 'my sister', 'mother', 'father', 'save them', 'look out'],
  parents_fighting: ['your fault', 'do not shout', 'stop it', 'argue'],
  rages_at_child: ['how dare you', 'never', 'shut up', 'go to your room', 'do not you ever'],
  threatens_harm: ['i will kill', 'i will hurt', 'you are dead', 'or else', 'do not make me', 'warning', 'threat', 'kill', 'destroy', 'you are finished', 'i will get you', 'stay back', 'do not come', 'give me'],
  bullying: ['weird', 'freak', 'loser', 'stupid', 'laugh at', 'go away', 'nobody likes', 'idiot', 'shut up', 'baby', 'chicken', 'scaredy', 'weirdo', 'nobody wants'],
  discrimination: ['your kind', 'people like you', 'not welcome', 'different'],
  caregiver_cruelty: ['do as you are told', 'useless', 'worthless', 'punish'],
  betrayal: ['you lied', 'trusted you', 'how could you', 'traitor', 'liar', 'lie', 'promise', 'you said', 'i trusted', 'fool', 'set me up'],
  transformation: ['changing', 'turning into', 'what is happening to me', 'my body'],
  nightmare: ['dream', 'nightmare', 'wake up', 'not real'],
  unseen_threat: ['what was that', 'something out there', 'who is there', 'hello', 'is someone', 'behind you', 'watching', 'quiet', 'shh', 'did you hear', 'listen', 'wait', 'there is something', 'anybody', 'who are you', 'what is it', 'what is that', 'touch it', 'come back'],
  jump_scare: ['look out', 'watch out', 'behind you', 'boo', 'aah', 'gasp'],
  terrified: ['help!', 'no!', 'scared', 'afraid', 'terrified', 'aah', 'scream', 'please', 'panic', 'do not hurt', 'frightened'],
  sobbing_despair: ['crying', 'sob', 'please', 'cannot do it', 'hopeless', 'sorry', 'tears'],
  animal_cruelty: ['hurt him', 'kick', 'beat', 'cruel', 'poor thing'],
  animal_in_danger: ['help him', 'help her', 'poor thing', 'save him', 'save her', 'he is hurt', 'hurt', 'save', 'hunter', 'wounded', 'dying', 'get him out'],
  dangerous_act: ['do not', 'dare', 'watch this', 'touch it', 'do not touch', 'careful', 'stay away'],
  runs_away: ['running away', 'leaving', 'not coming back', 'go with him', 'stranger'],
  slapstick_violence: ['ow', 'ouch', 'oops', 'watch it', 'sorry about that'],
};

// A scream is spelled a hundred ways and stemming cannot help: "Aagghh!", "Aaah!", "Argh!", "Eek!".
// These are the loudest thing in a subtitle track and they are most of what jump_scare and terrified
// have to go on, so they get patterns rather than a word list.
const SPECIAL = {
  terrified: [/^a+[hgr]+h*$/, /^(eek|yikes|waah|whoa)$/],
  jump_scare: [/^a+[hgr]+h*$/, /^(boo|eek|yikes|whoa)$/],
  sobbing_despair: [/^(boo)?hoo+$/, /^wah+$/],
  injured: [/^(ow+|ouch|oof|argh)$/],
  slapstick_violence: [/^(ow+|ouch|oof|oops|whoa)$/],
};

const STOPWORDS = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'is', 'are', 'in', 'on', 'to', 'at', 'someone', 'something', 'who', 'that', 'into', 'from', 'for', 'just', 'with', 'looks', 'other', 'their', 'up', 'be', 'by', 'it', 'his', 'her', 'has', 'have']);

// Crude stemmer: enough to tie chase/chased/chasing together without a dependency.
const stem = (w) => (w.length < 4 ? w : w.replace(/ies$/, 'y').replace(/(ing|ed|es|s)$/, ''));

// Tokens keep a trailing "!" as a separate form, so "no!" and "no" are different keywords.
function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/n't\b/g, ' not')
    .replace(/'s\b/g, '')
    .split(/\s+/)
    .map((raw) => {
      const bang = /[!]/.test(raw);
      const bare = raw.replace(/[^a-z']/g, '');
      return bare ? { bare, stem: stem(bare), bang: bang ? `${bare}!` : null, raw: raw.replace(/^[^\w(\[]+|[^\w!)\]]+$/g, '') } : null;
    })
    .filter(Boolean);
}

// Normalised phrase form. Contractions are EXPANDED, not deleted: keywords are written the long way
// ("i will kill", "he is hurt"), and deleting the suffix instead would turn "I'll kill you" into
// "i kill you" and silently stop every such phrase from ever matching.
const CONTRACTIONS = [[/n't\b/g, ' not'], [/'ll\b/g, ' will'], [/'re\b/g, ' are'], [/'ve\b/g, ' have'], [/'m\b/g, ' am'], [/'d\b/g, ' would'], [/'s\b/g, ' is']];
const phraseForm = (text) => {
  let s = text.toLowerCase().replace(/[‘’]/g, "'");
  for (const [re, to] of CONTRACTIONS) s = s.replace(re, to);
  // "!" is kept as a word of its own, so a phrase can still match the end of "He's hurt!".
  return ` ${s.replace(/[^a-z!\s]/g, ' ').replace(/!/g, ' ! ').replace(/\s+/g, ' ').trim()} `;
};

function buildVocab() {
  const vocab = new Map();
  for (const item of [...PRESENCE, ...EVENTS]) {
    const raw = [
      ...item.label.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !STOPWORDS.has(w)),
      ...(ALIASES[item.id] ?? []),
      ...(DIALOGUE[item.id] ?? []),
    ];
    const words = new Map(); // stem -> the keyword it came from
    const bangs = new Map();
    const phrases = [];
    for (const kw of raw) {
      const k = kw.toLowerCase().trim();
      if (!k) continue;
      if (k.includes(' ')) phrases.push(k);
      else if (k.endsWith('!')) bangs.set(k, k);
      else words.set(stem(k.replace(/[^a-z']/g, '')), k);
    }
    vocab.set(item.id, { words, bangs, phrases, special: SPECIAL[item.id] ?? [] });
  }
  return vocab;
}
export const VOCAB = buildVocab();

// Every keyword that fires for one item on one cue, with the cue's own words for highlighting.
function matches(cueText, itemId) {
  const v = VOCAB.get(itemId);
  if (!v) return [];
  const hits = new Map(); // matched keyword -> word as it appears in the line
  for (const t of tokens(cueText)) {
    if (v.words.has(t.stem)) hits.set(v.words.get(t.stem), t.raw);
    if (t.bang && v.bangs.has(t.bang)) hits.set(t.bang, t.raw);
    for (const re of v.special) if (re.test(t.bare)) hits.set(`/${re.source}/`, t.raw);
  }
  const p = phraseForm(cueText);
  for (const ph of v.phrases) if (p.includes(` ${ph} `)) hits.set(ph, ph);
  return [...hits].map(([keyword, word]) => ({ keyword, word }));
}

const hasCaption = (text) => /\([A-Z][A-Z '\-,]+\)|\[[^\]]+\]/.test(text);
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

export const shortLine = (text) => {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  return words.length > EXCERPT_MAX_WORDS ? `${words.slice(0, EXCERPT_MAX_WORDS).join(' ')}…` : words.join(' ');
};

// ---- the choice ----------------------------------------------------------------------------------
// `top` is the beat's top three flagged items: [{ channel, id, p }]. Score a cue by the evidence it
// carries for those three, weighted by probability, so the item Jev was most sure about pulls hardest.
export function chooseExcerpts(cues, top, { maxLines = EXCERPT_MAX_LINES } = {}) {
  const scored = cues.map((c, i) => {
    const why = [];
    let score = 0;
    for (const item of top) {
      const m = matches(c.text, item.id);
      if (!m.length) continue;
      score += item.p * m.length;
      why.push({ channel: item.channel, id: item.id, p: item.p, words: m.map((x) => x.word) });
    }
    return { i, cue: c, score, why, caption: hasCaption(c.text), words: wordCount(c.text) };
  });

  // Best evidence first; sound captions break a tie because they are what Jev keyed on for the sound
  // items, then the longer line, then the earlier cue.
  const byRelevance = [...scored].sort((a, b) => b.score - a.score || Number(b.caption) - Number(a.caption) || b.words - a.words || a.i - b.i);
  const chosen = byRelevance.filter((s) => s.score > 0).slice(0, maxLines);

  // Two lines per flagged beat is the rule, so an unfilled slot goes to the longest remaining cue.
  if (chosen.length < maxLines) {
    const taken = new Set(chosen.map((s) => s.i));
    const byLength = [...scored].filter((s) => !taken.has(s.i)).sort((a, b) => b.words - a.words || Number(b.caption) - Number(a.caption) || a.i - b.i);
    chosen.push(...byLength.slice(0, maxLines - chosen.length));
  }

  return chosen
    .sort((a, b) => a.i - b.i)
    .map((s) => ({
      cue: s.cue.id,
      line: shortLine(s.cue.text),
      score: Math.round(s.score * 1000) / 1000,
      why: s.why.length
        ? { items: s.why.map((w) => ({ channel: w.channel, id: w.id, p: w.p })), words: [...new Set(s.why.flatMap((w) => w.words))] }
        : { items: [], words: [], fallback: 'longest_cue' },
    }));
}

// ---- one film ------------------------------------------------------------------------------------
const cueNum = (id) => Number(id.slice(1));

export function buildExcerpts(slug) {
  const rec = JSON.parse(fs.readFileSync(path.join(here, 'recordings', `${slug}.jev.json`), 'utf8'));
  const cues = loadFilm(slug).cues;
  const byId = new Map(cues.map((c) => [c.id, c]));
  const top = new Map(rec.thresholds.flagged.map((f) => [f.beat_id, f.top]));

  const out = {};
  for (const beat of rec.beats) {
    if (!beat.flagged) continue;
    const beatCues = [];
    for (let n = cueNum(beat.start_cue); n <= cueNum(beat.end_cue); n++) {
      const c = byId.get(`C${String(n).padStart(4, '0')}`);
      if (c) beatCues.push(c);
    }
    out[beat.id] = chooseExcerpts(beatCues, top.get(beat.id) ?? [], { maxLines: Math.min(EXCERPT_MAX_LINES, beatCues.length) });
  }

  const words = Object.values(out).flat().reduce((s, e) => s + wordCount(e.line), 0);
  const filmWords = cues.reduce((s, c) => s + wordCount(c.text), 0);
  const withEvidence = Object.values(out).flat().filter((e) => e.why.items.length).length;
  const lines = Object.values(out).flat().length;
  return { slug, excerpts: out, words, filmWords, lines, withEvidence, beats: Object.keys(out).length };
}

export function writeExcerpts(slug) {
  const b = buildExcerpts(slug);
  const file = path.join(here, 'recordings', `${slug}.excerpts.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(b.excerpts, null, 1));
  return { ...b, file };
}

// ---- CLI -----------------------------------------------------------------------------------------
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const all = slugs.length
    ? slugs
    : fs.readdirSync(path.join(here, 'recordings')).filter((f) => f.endsWith('.jev.json')).map((f) => f.replace('.jev.json', ''));
  for (const slug of all) {
    const b = writeExcerpts(slug);
    console.log(`${slug}: ${b.beats} flagged beats, ${b.lines} lines (${b.withEvidence} matched an item, ${b.lines - b.withEvidence} fell back to longest), ${b.words} words = ${((b.words / b.filmWords) * 100).toFixed(2)}% of ${b.filmWords} subtitle words`);
  }
}
