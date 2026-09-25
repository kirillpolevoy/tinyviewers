// PHRASING TOURNAMENT: the pooled question set.
//
// Pools, per concept, every phrasing of
//   C  = Claude's Jev-first proposal   (../claude-concepts.json, 173 phrasings)
//   A  = Astra's Jev-first proposal    (../astra-concepts.json; its multi-Noul bundles are split into
//        their numbered sub-Nouls, and every sub-Noul that reads `{source}` is asked on BOTH channels,
//        lines and summary, in separate minimal states, as Astra specified)
//   V  = the v9 wording as a control. Only the 19 ids that v9 gave to Sonnet (split.json sonnet_used)
//        are asked here: every other v9 id was asked of Jev by v9 itself with the identical wording, in
//        the identical states, on the identical scenes (v9/out/<slug>.jev.r1.json), and is reused.
// Identical (state, instructions, criteria) are deduped into one asked question.
//
// Not asked (not scorable against the human keys, or reused): mention templates (m.*), the retold /
// imagined gates, Astra's Scores / kind Choice, film presence (fpl/fps: v9's answers are reused for the
// "villain present" half of the film-threat bundles).
//
// STATES (one request set per scene per distinct state):
//   L    { film:{title}, scene:{lines} }                       numbered lines incl. sound captions
//   Lnl  same, lyric lines removed (Claude's non-threat [L] questions); merges with L when no lyric
//   S    { film:{title}, scene:{setting, summary} }            verified summary only
//   LS   { film:{title}, scene:{setting, summary, lines} }     (Lnl lines for Claude non-threat)
//   ...C adds { children: [verified child names + verified aliases] }
//   V9C  v9 contextState (cast, dangers, setting, summary, lines): the v9 control's ps.* / e.*
// Claude's [N] (one name) states are realised by writing the name (and its verified aliases) into the
// question text, as v9 did, over the matching L / S / LS state.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, buildQuestions, linesFor, contextState, verifiedSentences, verifiedSetting, verifiedField, castAliases, nameVerified, filmItems, MODEL } from '../../../v9/questions.js';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
const JF = path.resolve(HERE, '..');
const V9 = path.resolve(HERE, '../../../v9');
export { MODEL };

const claude = JSON.parse(fs.readFileSync(path.join(JF, 'claude-concepts.json'), 'utf8'));
const astra = JSON.parse(fs.readFileSync(path.join(JF, 'astra-concepts.json'), 'utf8'));
export const SPLIT = JSON.parse(fs.readFileSync(path.join(V9, 'split.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------
// Concepts scored in the tournament (Claude's concept list; mention / gates / film presence left out)
// ---------------------------------------------------------------------------------------------
const SKIP_CLAUDE = new Set(['mention (m.<presence id>)', 'retold (mod.retold)', 'imagined (mod.imagined)', 'film:presence (fpl/fps.<C>_present)']);
const FILM_CONCEPT = { 'film:threatens (fe.<C>_threatens)': 'film:threatens', 'film:child_in_danger (fe.<C>_in_danger)': 'film:child_in_danger', 'film:danger (fe.<D>_endangers)': 'film:danger' };
export const conceptKey = (c) => FILM_CONCEPT[c.v9_ids[0]] ?? (c.v9_ids.includes('captured') ? 'captured' : null) ?? c.v9_ids.filter((x) => !x.includes('(') && !x.startsWith('film:'))[0];

export const CONCEPTS = claude.concepts.filter((c) => !SKIP_CLAUDE.has(c.v9_ids[0])).map((c) => {
  const key = conceptKey(c);
  const v9 = c.v9_ids.filter((x) => !x.includes('(') && !x.startsWith('film:') && x !== 'jump_scare');
  return { key, label: c.concept, group: c.group, v9_ids: FILM_CONCEPT[c.v9_ids[0]] ? [] : v9, film: FILM_CONCEPT[c.v9_ids[0]] ?? null, derived_jump: c.v9_ids.includes('jump_scare') };
});
export const CONCEPT_BY_V9 = Object.fromEntries(CONCEPTS.flatMap((c) => c.v9_ids.map((id) => [id, c.key])));

// Astra concept id -> tournament concept key
const ASTRA_MAP = { captured: 'captured', cage_net_trap: 'captured', restraints: 'captured', vehicle_accident: 'vehicle_crash', startled: 'appears_suddenly', jump_scare: 'appears_suddenly', 'fe.threatens': 'film:threatens', 'fe.in_danger': 'film:child_in_danger', 'fe.endangers': 'film:danger' };
const ASTRA_SKIP = new Set(['m.*', 'mod.retold', 'mod.imagined', 's.danger', 's.harm', 's.distress', 's.share', 's.resolution', 's.laughs', 'kind', 'fpl.present', 'fps.present']);

// ---------------------------------------------------------------------------------------------
// Claude phrasings
// ---------------------------------------------------------------------------------------------
const THREAT_PREFIX = ['threatens_harm.', 'plots_harm.', 'film_threatens.'];
const stripTag = (q) => q.replace(/^\[[A-Z]+\]\s*/, '');

function claudeState(p) {
  const threat = THREAT_PREFIX.some((t) => p.id.startsWith(t));
  const s = p.state.replace('N', '');
  const lines = threat ? 'L' : 'Lnl';
  const base = s.startsWith('LS') ? (threat ? 'LS' : 'LSnl') : s.startsWith('L') ? lines : 'S';
  return base + (s.endsWith('C') ? 'C' : '');
}

// ---------------------------------------------------------------------------------------------
// Astra sub-Nouls: split, instantiate placeholders, pick channels
// ---------------------------------------------------------------------------------------------
// Placeholders are entity slots that Astra meant code to bind. With no per-entity enumeration in this
// run they are written as the generic referent; a code gate on the slot (verified_child(C)) becomes the
// words "a child" plus the verified children list in the state.
const ASTRA_SUBST = {
  _default: { C: 'a character', A: 'a character', B: 'another character', D: 'another character', X: 'something', R: 'a family member', P: 'their parent', noun: 'it' },
  scary_appearance: { C: 'someone' },
  child_in_danger: { C: 'a child', _children: true },
  creature_threat: { C: 'an animal or creature' },
  dies: { C: 'a character' },
  loved_one_dies: { D: 'the character who dies in this scene', C: 'another character' },
  pet_dies: { A: 'the animal that dies in this scene' },
  believed_dead: { C: 'a character', D: 'someone close to them' },
  parent_death_learned: { C: 'a child', P: 'their parent', _children: true },
  grieving: { C: 'a character', D: 'the person they miss' },
  child_taken: { C: 'a child', _children: true },
  child_separated: { C: 'a child', _children: true },
  abandoned: { C: 'a dependent character', A: 'their caregiver' },
  family_in_danger: { C: 'a character', R: 'the person in danger' },
  parents_argue: { A: 'one character', B: 'another character' },
  rages_at_child: { A: 'an adult', C: 'a child', _children: true },
  caregiver_cruelty: { A: 'a caregiver', C: 'a child in their care', _children: true },
  betrayal: { C: 'a child', A: 'an adult the child trusts', _children: true },
  child_frightened: { C: 'a child', _children: true },
  animal_in_danger: { A: 'an animal that does not talk' },
  dangerous_act: { C: 'a child', _children: true },
  runs_away: { C: 'a child', _children: true },
  goes_with_stranger: { C: 'a child', A: 'someone', _children: true },
  jump_scare: { X: 'something', C: 'a character' },
};
// whole-text overrides where plain substitution leaves a relational slot unreadable
const ASTRA_TEXT = {
  'loved_one_dies.a.death': 'Does scene.summary explicitly state that a character dies during this scene?',
  'loved_one_dies.a.family': 'Does the supplied evidence explicitly identify the character who dies in this scene as another character\'s family member?',
  'loved_one_dies.a.friend': 'Does the supplied evidence explicitly identify the character who dies in this scene as another character\'s close friend?',
  'pet_dies.a.death': 'Does scene.summary explicitly state that an animal dies during this scene?',
  'parent_death_learned.a.parent': null, // folded into the words "their parent" of (1) and (2)
  'grieving.a.dead': 'Does the supplied evidence explicitly state that the person a character says they miss has died?',
  'abandoned.a.dependent': 'Does the supplied evidence explicitly state that a character depends on another character for care?',
  'abandoned.a.refusal': 'Does a caregiver explicitly tell someone who depends on them that they will no longer care for them?',
  'abandoned.a.left': 'Does scene.summary explicitly state that a caregiver deliberately leaves someone who depends on them without care?',
  'family_in_danger.a.news': 'Does {source} explicitly state that a character learns here that someone faces physical harm?',
  'family_in_danger.a.relation': 'Does the supplied evidence explicitly identify the person in danger as that character\'s family member?',
  'parents_argue.a.argument': 'Does scene.summary explicitly describe two characters arguing angrily with each other now?',
  'parents_argue.a.parents': 'Does the supplied evidence identify the two arguing characters as parents of the same child?',
  'rages_at_child.a.anger': 'Does {source} explicitly describe the adult who shouts at a child as angry during that exchange?',
  'betrayal.a.trust': 'Does the supplied evidence explicitly state that a child trusts an adult?',
  'betrayal.a.attack': 'Does {source} describe an adult the child trusts deliberately attacking the child now?',
  'betrayal.a.handover': 'Does {source} describe an adult the child trusts deliberately handing the child over to an enemy now?',
  'betrayal.a.exposure': 'Does {source} describe an adult the child trusts revealing the child\'s hiding place to someone trying to capture the child?',
  'dangerous_act.a.action': 'Does {source} describe a child performing a risky physical action now?',
  'dangerous_act.a.choice': 'Does {source} explicitly state that the child chooses to perform that action?',
  'goes_with_stranger.a.unfamiliar': 'Does the supplied evidence explicitly state that the person the child leaves with is unfamiliar to the child?',
  'jump_scare.a.response': 'Does {source} explicitly describe a character flinching or jumping in response to something suddenly appearing in front of them?',
  'transforms.a.fear': 'Does {source} explicitly state that a character\'s change of form frightens a character?',
  'transforms.a.pain': 'Does {source} explicitly describe a character\'s change of form causing bodily pain?',
  'possessed.a.resistance': 'Does {source} explicitly state that a character resists another being\'s control of their body?',
  'unseen_threat.a.fear': 'Does a character explicitly say they fear something nearby that they cannot see?',
  'captured.a.held': 'Does {source} state that a captor prevents a caught character from leaving?',
  'fe.endangers.a.harm': 'Does {source} explicitly state that {DANGER} physically acting on a character exposes that character to bodily injury?',
};

/** Split an Astra phrasing into sub-Nouls: [{ sub, text, yes }]. */
function astraSubs(ph) {
  const parts = [...ph.question.matchAll(/\((\d+)\)\s*\[([^\]]+)\]\s*([^()]*?(?:\([^)]*\)[^()]*?)*)(?=\s*\(\d+\)\s*\[|$)/g)];
  const yesParts = {};
  const ym = [...ph.yes_criteria.matchAll(/\((\d+)(?:[–-](\d+))?(?:,(\d+))*\)\s*/g)];
  if (ym.length) {
    ym.forEach((m, i) => {
      const txt = ph.yes_criteria.slice(m.index + m[0].length, i + 1 < ym.length ? ym[i + 1].index : undefined).trim();
      const nums = m[0].replace(/[()\s]/g, '').split(',').flatMap((x) => { const [a, b] = x.split(/[–-]/).map(Number); return b ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [a]; });
      for (const n of nums) yesParts[n] = txt;
    });
  }
  if (!parts.length) return [{ n: 1, sub: ph.id, text: ph.question.trim(), yes: ph.yes_criteria }];
  return parts.map((m) => ({ n: Number(m[1]), sub: m[2], text: m[3].trim(), yes: yesParts[Number(m[1])] ?? ph.yes_criteria }));
}

/** Channel spec of each numbered sub from the combine text. Returns n -> 'both'|'L'|'S'|'LS'. */
function astraChannelSpec(combine) {
  const spec = {};
  for (const m of combine.matchAll(/\(([\d,–-]+)\)\s+(both channels|both|lines|summary|relevant[^;,(]*)/g)) {
    const nums = m[1].split(',').flatMap((x) => { const [a, b] = x.split(/[–-]/).map(Number); return b ? Array.from({ length: b - a + 1 }, (_, k) => a + k) : [a]; });
    const ch = m[2].startsWith('both') ? 'both' : m[2] === 'lines' ? 'L' : m[2] === 'summary' ? 'S' : 'LS';
    for (const n of nums) spec[n] = ch;
  }
  return spec;
}

function channelsFor(text, specCh) {
  if (/scene\.summary/.test(text)) return ['S'];
  if (/supplied (evidence|excerpt)/.test(text)) return ['LS'];
  if (text.includes('{source}')) {
    if (specCh === 'L') return ['L'];
    if (specCh === 'S') return ['S'];
    if (specCh === 'LS') return ['LS'];
    return ['L', 'S'];
  }
  if (/scene\.lines|sound caption|a line|dialogue|spoken|literally say|literally announce|say that|say they|says|tell|call/i.test(text)) return ['L'];
  return ['LS'];
}
const SOURCE_WORD = { L: '`scene.lines`', S: '`scene.summary`', LS: '`scene`' };
const fill = (s, map) => s.replace(/\{(C|A|B|D|X|R|P|noun)\}/g, (_, k) => map[k] ?? _);
const tick = (s) => s.replace(/(?<!`)scene\.summary(?!`)/g, '`scene.summary`').replace(/(?<!`)scene\.lines(?!`)/g, '`scene.lines`');

// ---------------------------------------------------------------------------------------------
// The universal pool: [{ src, concept, id, sub, channel, state, q:{type, instructions, criteria}, film? }]
// Film templates carry film: 'threatens'|'child_in_danger'|'danger' and placeholders {NAME}/{DANGER}.
// ---------------------------------------------------------------------------------------------
export function buildPool() {
  const pool = [];
  // Claude
  for (const c of claude.concepts) {
    if (SKIP_CLAUDE.has(c.v9_ids[0])) continue;
    const concept = conceptKey(c);
    for (const p of c.phrasings) {
      const film = FILM_CONCEPT[c.v9_ids[0]] ? FILM_CONCEPT[c.v9_ids[0]].slice(5) : null;
      pool.push({ src: 'C', concept, id: p.id, sub: p.id, channel: p.state, state: claudeState(p), film, combine: p.combine,
        q: { type: 'noul', instructions: stripTag(p.question), criteria: { true: p.yes_criteria, false: p.no_criteria } } });
    }
  }
  // Astra
  for (const a of astra.concepts) {
    if (ASTRA_SKIP.has(a.concept)) continue;
    const concept = ASTRA_MAP[a.concept] ?? a.concept;
    if (!CONCEPTS.some((c) => c.key === concept)) throw new Error(`astra concept ${a.concept} -> ${concept} has no tournament concept`);
    const film = a.concept.startsWith('fe.') ? { 'fe.threatens': 'threatens', 'fe.in_danger': 'child_in_danger', 'fe.endangers': 'danger' }[a.concept] : null;
    const sub = { ...ASTRA_SUBST._default, ...(ASTRA_SUBST[a.concept] ?? {}) };
    const children = !!sub._children;
    for (const ph of a.phrasings) {
      const spec = astraChannelSpec(ph.combine);
      for (const s of astraSubs(ph)) {
        const over = s.sub in ASTRA_TEXT ? ASTRA_TEXT[s.sub] : undefined;
        if (over === null) continue;
        const text0 = fill(over ?? s.text, sub);
        for (const ch of channelsFor(text0, spec[s.n])) {
          const text = tick(text0.replace('{source}', SOURCE_WORD[ch]));
          pool.push({ src: 'A', concept, id: ph.id, sub: s.sub, n: s.n, channel: ch, state: ch + (children ? 'C' : ''), film, combine: ph.combine,
            q: { type: 'noul', instructions: text, criteria: { true: tick(fill(s.yes, sub)), false: tick(fill(ph.no_criteria, sub)) } } });
        }
      }
    }
  }
  // v9 control: only the ids v9 gave to Sonnet (Jev never answered them in v9)
  const used = new Set(SPLIT.sonnet_used);
  const presIds = PRESENCE.filter((p) => used.has(p.id)).map((p) => p.id);
  const evIds = EVENTS.filter((e) => used.has(e.id)).map((e) => e.id);
  const vl = buildQuestions({ channels: ['pl'], presenceIds: presIds, eventIds: [] });
  const vc = buildQuestions({ channels: ['ps', 'e'], presenceIds: presIds, eventIds: evIds });
  for (const [k, q] of Object.entries(vl)) pool.push({ src: 'V', concept: CONCEPT_BY_V9[k.slice(3)], id: k, sub: k, channel: 'L', state: 'L', film: null, q });
  for (const [k, q] of Object.entries(vc)) pool.push({ src: 'V', concept: CONCEPT_BY_V9[k.slice(k.indexOf('.') + 1)], id: k, sub: k, channel: k.startsWith('ps.') ? 'S' : 'V9C', state: 'V9C', film: null, q });
  for (const x of pool) if (!x.concept) throw new Error(`no concept for ${x.src} ${x.id}`);
  return pool;
}

// ---------------------------------------------------------------------------------------------
// Film-template instantiation (per film item from v9 filmItems over the v9 segments)
// ---------------------------------------------------------------------------------------------
const nameWithAliases = (it, seg) => {
  const c = (seg.cast ?? []).find((x) => x.id === it.entity);
  const al = c ? castAliases(c).filter((a) => a.toLowerCase() !== c.name.toLowerCase()).slice(0, 3) : [];
  return al.length ? `${it.name} (also called ${al.join(', ')})` : it.name;
};
export function instantiateFilm(pool, seg) {
  const items = filmItems(seg);
  const out = [];
  for (const x of pool) {
    if (!x.film) { out.push(x); continue; }
    for (const it of items) {
      if (x.film === 'threatens' && it.type !== 'threatens') continue;
      if (x.film === 'child_in_danger' && it.type !== 'child_in_danger') continue;
      if (x.film === 'danger' && it.type !== 'danger') continue;
      const who = nameWithAliases(it, seg);
      const rep = (s) => s.replaceAll('<name>', who).replaceAll('<danger>', who).replaceAll('<villain>', who).replaceAll('<child>', who).replaceAll('{NAME}', who).replaceAll('{DANGER}', who);
      // the name inside criteria stays the plain name (short); the question carries the aliases
      const repC = (s) => s.replaceAll('<name>', it.name).replaceAll('<danger>', it.name).replaceAll('<villain>', it.name).replaceAll('<child>', it.name).replaceAll('{NAME}', it.name).replaceAll('{DANGER}', it.name);
      out.push({ ...x, item: it.id, item_group: it.group, id: `${x.id}#${it.id}`, sub: `${x.sub}#${it.id}`,
        q: { ...x.q, instructions: rep(x.q.instructions), criteria: { true: repC(x.q.criteria.true), false: repC(x.q.criteria.false) } } });
    }
  }
  return { questions: out, items };
}

// ---------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------
// Lyric lines: a cue with a music sign, or the run of cues after a (… SINGING …) / [singing] caption
// until the next caption or speaker label (capped at 8 cues so a caption never swallows dialogue).
const MUSIC = /[♪♫]|^#|#$/;
const SING_CAP = /[([][^)\]]*\bSING(?:ING|S)?\b[^)\]]*[)\]]/i;
const CAPTION = /^[([]|^[A-Z][A-Z .'-]+:/;
export function lyricCueIds(cues) {
  const out = new Set();
  let run = 0;
  for (const c of cues) {
    if (MUSIC.test(c.text)) { out.add(c.index); continue; }
    if (SING_CAP.test(c.text)) { run = 8; continue; }
    if (run > 0) { if (CAPTION.test(c.text)) { run = 0; continue; } out.add(c.index); run -= 1; }
  }
  return out;
}

export function childrenList(seg) {
  return (seg.cast ?? []).filter((c) => nameVerified(c) && verifiedField(c, 'is_child') === true).map((c) => {
    const al = castAliases(c).filter((a) => a.toLowerCase() !== c.name.toLowerCase());
    return al.length ? `${c.name} (also called ${al.join(', ')})` : c.name;
  });
}

/** All state bodies of one scene, keyed by state name. Summary-only states are null when the summary is empty. */
export function sceneStates({ seg, scene, cues }) {
  const lyr = lyricCueIds(cues);
  const lines = linesFor(cues);
  const linesNl = linesFor(cues.filter((c) => !lyr.has(c.index)));
  const summary = verifiedSentences(scene).join(' ');
  const setting = verifiedSetting(scene);
  const film = { title: seg.film.title };
  const kids = childrenList(seg);
  const st = {
    L: { film, scene: { lines } },
    Lnl: { film, scene: { lines: linesNl } },
    S: summary ? { film, scene: { setting, summary } } : null,
    LS: { film, scene: { setting, summary, lines } },
    LSnl: { film, scene: { setting, summary, lines: linesNl } },
    V9C: contextState({ seg, scene, cues }).state,
  };
  for (const k of ['L', 'Lnl', 'S', 'LS', 'LSnl']) st[`${k}C`] = st[k] ? { children: kids, ...st[k] } : null;
  return { states: st, lyricCues: lyr.size, summaryEmpty: !summary };
}

export const hashOf = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

// CLI: write pool.json + a summary
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = buildPool();
  const uniq = new Map();
  for (const x of pool) { const h = hashOf([x.state, x.q]); if (!uniq.has(h)) uniq.set(h, []); uniq.get(h).push(`${x.src}:${x.sub}@${x.state}`); }
  const count = (f) => pool.filter(f).length;
  const summary = {
    concepts: CONCEPTS.length,
    pooled: pool.length, unique_asked_universal_or_template: uniq.size,
    by_src: { C: count((x) => x.src === 'C'), A: count((x) => x.src === 'A'), V: count((x) => x.src === 'V') },
    film_templates: count((x) => x.film),
    by_state: pool.reduce((o, x) => ((o[x.state] = (o[x.state] ?? 0) + 1), o), {}),
    dup_groups: [...uniq.values()].filter((v) => v.length > 1),
  };
  fs.writeFileSync(path.join(HERE, 'pool.json'), JSON.stringify({ summary, concepts: CONCEPTS, pool }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
