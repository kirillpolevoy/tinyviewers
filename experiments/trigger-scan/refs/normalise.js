// Step 2: turn the collected advisories into items, using Codex (independent of the Claude pipeline)
// to split and paraphrase them and to apply the user's flag policy. Code validates every answer.
//
//   node refs/normalise.js [slug...]      -> codex/<slug>.items.json   (git-ignored: carries source quotes)
//   node refs/normalise.js --dtdd         -> codex/dtdd-topics.json    (topic question -> categories)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS } from '../taxonomy-v3.js';
import { runCodex, obj, CODEX_DIR } from './codex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CATEGORIES = Object.keys(GROUPS).filter((g) => !['severity', 'modifier'].includes(g)); // the 13 groups
export const POLICY_FLAGS = ['villain_threat', 'child_terrified', 'comic_peril'];

export const POLICY_TEXT = `THE FLAG POLICY (the product owner's, final). The product tells parents of young children (about 3-7) which scenes of a kids' film to skip.
- should_flag = "true": a moment a parent of a young child would want flagged: a character in real (not comic) danger - chased, attacked, falling, drowning, trapped, eaten or nearly eaten; a frightening creature or villain menacing someone; death, apparent death, a body, or a character learning of a death; a child taken or separated from a parent; serious injury; a battle or fight played straight; a frightening transformation, nightmare or jump scare; a child tormented or cruelly treated.
  Also "true", even with no physical action: (1) an explicit villain threat to kill or hurt (e.g. a villain's song about killing, henchmen ordered to kill); (2) a child character terrified or crying.
- should_flag = "tag_only": comic peril, slapstick, or hurt played for laughs. It is recorded so parents can filter on it, but it never flags.
- should_flag = "false": the advisory mentions it but it does not meet the bar above: friendly or comic presences (a friendly monster, a harmless creature), mild tension that resolves at once, grown-up sadness without distress, medical or dental procedures shown matter-of-factly, off-screen deaths only mentioned in passing.
- Friendly presences never flag.
Policy markers (true/false each): villain_threat = a villain or antagonist explicitly threatens to kill or hurt someone, or orders it; child_terrified = a child character (a child, a cub, a young animal, a toddler) is terrified, screaming in fear, or crying; comic_peril = the peril or hurt is played for laughs.`;

const CATEGORY_TEXT = CATEGORIES.map((c) => `${c}: ${GROUPS[c]}`).join('\n');

function paragraphs(raw) {
  const out = [];
  const add = (source, section, text) => {
    if (!text || text.length < 20 || /^None\.?$/.test(text)) return;
    const clean = text.replace(/&#9658;/g, '\n- ').replace(/\s*\n\s*/g, '\n').trim();
    out.push({ para: `P${out.length + 1}`, source, section, text: clean });
  };
  for (const s of raw.sources) {
    if (s.source === 'kids_in_mind') add(s.source, 'VIOLENCE/GORE', s.sections['VIOLENCE/GORE']);
    if (s.source === 'plugged_in') {
      const secs = ['Violent Content', 'Spiritual Elements', 'Other Noteworthy Elements'];
      for (const sec of secs) add(s.source, sec, s.sections[sec]);
      // Older Plugged In reviews (e.g. The Iron Giant) are short free text with empty section blocks;
      // then the review body (parsed as the synopsis) is the only advisory text.
      if (secs.every((sec) => !s.sections[sec])) add(s.source, 'Movie Review (synopsis)', s.sections['Movie Review (synopsis)']);
    }
    if (s.source === 'common_sense_media') for (const sec of ['Violence & Scariness', 'Parents Need to Know']) add(s.source, sec, s.sections[sec]);
  }
  return out;
}

const ITEM_SCHEMA = obj({
  items: {
    type: 'array',
    items: obj({
      para: { type: 'string' },
      source_quote: { type: 'string' },
      text: { type: 'string' },
      kind: { type: 'string', enum: ['moment', 'film_level'] },
      categories: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
      villain_threat: { type: 'boolean' },
      child_terrified: { type: 'boolean' },
      comic_peril: { type: 'boolean' },
      should_flag: { type: 'string', enum: ['true', 'false', 'tag_only'] },
      flag_reason: { type: 'string' },
      same_moment_as: { type: 'array', items: { type: 'integer' } },
    }),
  },
});

function itemPrompt(raw, paras) {
  return `You are building an evaluation answer key from HUMAN-WRITTEN parent content advisories for the film "${raw.title}" (${raw.year}).
Work only from the advisory text below. Do not run any shell commands and do not open any files: everything you need is in this prompt.

TASK: split the advisories into items. Return JSON matching the schema.

Rules for items:
1. One item per distinct on-screen moment or event. A sentence that lists several separate moments becomes several items. Keep separate moments separate even when they are in the same sequence, if the advisory describes them separately.
2. kind = "moment" when the advisory describes something that happens at a particular point in the film. kind = "film_level" when it is a general statement about the whole film or about many scenes ("throughout the film...", "the tone is dark", "many tense scenes", "the monsters are frightening-looking"), or a count/summary that cannot be pinned to one point.
3. Only include content about fright, danger, violence, death or loss, separation from family, injury, captivity, eerie or startling things, hostility or cruelty, character distress, animals in danger, frightening creatures or hazards on screen, or dangerous behaviour a child could copy. Skip language, potty humour, burps, romance, product placement, positive messages, and anything else.
4. para = the paragraph label (P1, P2...) the item comes from. source_quote = the exact words of the advisory the item comes from, at most 20 words (a shortened extract is fine).
5. text = YOUR OWN paraphrase, at most 25 words, in plain present tense, naming characters as the advisory does. Do not copy more than 6 consecutive words from the advisory. Do not add details the advisory does not give.
6. categories = one or more of these parent-facing groups (ids only):
${CATEGORY_TEXT}
7. same_moment_as = zero-based indexes of EARLIER items in your list that describe the same on-screen moment (usually from a different advisory source). Empty when none.
8. flag_reason = at most 12 words on why should_flag has its value.

${POLICY_TEXT}

ADVISORY TEXT (each paragraph labelled with its source):
${paras.map((p) => `[${p.para}] source=${p.source} section="${p.section}"\n${p.text}`).join('\n\n')}
`;
}

const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
export function longestSharedRun(a, b) {
  const A = words(a); const B = words(b);
  const pos = new Map();
  B.forEach((w, i) => { if (!pos.has(w)) pos.set(w, []); pos.get(w).push(i); });
  let best = 0;
  for (let i = 0; i < A.length; i++) for (const j of pos.get(A[i]) ?? []) {
    let k = 0; while (i + k < A.length && j + k < B.length && A[i + k] === B[j + k]) k++;
    if (k > best) best = k;
  }
  return best;
}

async function normaliseFilm(slug) {
  const raw = JSON.parse(fs.readFileSync(path.join(here, 'raw', `${slug}.json`), 'utf8'));
  const paras = paragraphs(raw);
  const { answer } = await runCodex(`${slug}.items`, itemPrompt(raw, paras), ITEM_SCHEMA);
  const problems = [];
  const byPara = Object.fromEntries(paras.map((p) => [p.para, p]));
  const items = answer.items.map((it, i) => {
    const p = byPara[it.para];
    if (!p) problems.push(`item ${i}: unknown para ${it.para}`);
    const n = words(it.text).length;
    if (n > 25) problems.push(`item ${i}: text has ${n} words`);
    const copied = p ? longestSharedRun(it.text, p.text) : 0;
    if (copied > 8) problems.push(`item ${i}: text copies ${copied} consecutive advisory words`);
    if (!it.categories.length) problems.push(`item ${i}: no categories`);
    const same = it.same_moment_as.filter((j) => Number.isInteger(j) && j >= 0 && j < i);
    return { idx: i, source: p?.source ?? null, section: p?.section ?? null, ...it, same_moment_as: same, copied_run: copied };
  });
  const out = { film: slug, paragraphs: paras.map(({ para, source, section }) => ({ para, source, section })), items, problems };
  fs.writeFileSync(path.join(CODEX_DIR, `${slug}.items.json`), JSON.stringify(out, null, 2));
  console.log(`${slug}: ${items.length} items (${items.filter((x) => x.kind === 'moment').length} moments); problems: ${problems.length ? problems.join('; ') : 'none'}`);
}

// DoesTheDogDie topic questions are film-independent, so their categories are mapped once.
const TOPIC_SCHEMA = obj({
  topics: {
    type: 'array',
    items: obj({
      topic_id: { type: 'string' },
      relevant: { type: 'boolean' },
      categories: { type: 'array', items: { type: 'string', enum: CATEGORIES } },
      villain_threat: { type: 'boolean' },
      child_terrified: { type: 'boolean' },
      comic_peril: { type: 'boolean' },
      should_flag_if_yes: { type: 'string', enum: ['true', 'false', 'tag_only'] },
    }),
  },
});

async function normaliseTopics(slugs) {
  const seen = new Map();
  for (const slug of slugs) {
    const raw = JSON.parse(fs.readFileSync(path.join(here, 'raw', `${slug}.json`), 'utf8'));
    for (const t of raw.sources.find((s) => s.source === 'doesthedogdie')?.topics ?? []) seen.set(t.topic_id, t.question);
  }
  const list = [...seen].map(([id, q]) => `${id}\t${q}`).join('\n');
  const prompt = `You are mapping the generic content-warning questions of the DoesTheDogDie website to the parent-facing groups of a kids' film scene guide. Do not run any shell commands or open files.
For EVERY topic below return: topic_id; relevant = true when a "yes" to the question is about fright, danger, violence, death or loss, separation from family, injury, captivity, eerie or startling things, hostility or cruelty, character distress, animals in danger, frightening creatures or hazards on screen, or dangerous behaviour a child could copy (false for things like language, sex, drugs, spoilers, credits, phobia-only items such as clowns are still relevant as creatures_figures); categories (empty when not relevant); the three policy markers as they would apply to a typical "yes"; should_flag_if_yes = the value a typical "yes" moment would get under the policy.

Groups:
${CATEGORY_TEXT}

${POLICY_TEXT}

TOPICS (id<TAB>question):
${list}
`;
  const { answer } = await runCodex('dtdd-topics', prompt, TOPIC_SCHEMA);
  const ids = new Set(seen.keys());
  const got = new Map(answer.topics.filter((t) => ids.has(t.topic_id)).map((t) => [t.topic_id, t]));
  const missing = [...ids].filter((id) => !got.has(id));
  fs.writeFileSync(path.join(CODEX_DIR, 'dtdd-topics.json'), JSON.stringify({ topics: Object.fromEntries([...got].map(([id, t]) => [id, { question: seen.get(id), ...t }])), missing }, null, 2));
  console.log(`dtdd topics: ${got.size} mapped, ${missing.length} missing, ${[...got.values()].filter((t) => t.relevant).length} relevant`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const args = isMain ? process.argv.slice(2) : null;
// --dtdd maps topics of the round-2 films; round-3 films (iron-giant, up) added no new topic ids.
const ALL = ['nemo', 'monsters-inc', 'lion-king', 'frankenweenie', 'wild-robot'];
if (!isMain) { /* imported for helpers */ } else if (args[0] === '--dtdd') await normaliseTopics(ALL);
else await Promise.all((args.length ? args : ALL).map((s) => normaliseFilm(s).catch((e) => console.error(s, e.message))));
