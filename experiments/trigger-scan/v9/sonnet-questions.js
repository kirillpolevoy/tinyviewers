// v9 SONNET QUESTION LAYER. The per-scene questions Sonnet answers, the prompt, the strict output schema
// and the mapping from Sonnet's typed answers to probabilities that select.js reads exactly like Jev's.
//
// WHICH questions: split.json (decided from data: split/stage-a.mjs over the v8 scorecard, then the
// same-scene measurement split/stage-b.mjs). split.json lists
//   sonnet_asked   every question Sonnet is asked: the CONTESTED set (its answers are the stage-B
//                  measurement, and on a held-out film they re-measure the split for free);
//   sonnet_used    the subset whose Sonnet answer REPLACES Jev's in select.js (split.json `assign`);
//   the rest of sonnet_asked is SHADOW: stored, compared, never read by select.js.
// Jev (classify.js) is asked only the questions assigned to it (split.json assign = 'jev').
//
// WORDING: each question is the SAME text Jev is asked (questions.js EVENTS[].q / .no / .yes; a
// presence item's noun, definition and no-cases), with "`scene`" -> "this scene", so a difference
// between the models is the model, not the wording. A presence item is ONE question over lines and
// summary together (Jev asks it on two channels; select.js takes the max of the two).
//
// ANSWERS: per scene Sonnet LISTS every question whose answer is yes, and every question whose
// answer is no but not confidently so, each typed { q, a: yes|no, c: high|medium|low }. A question it
// does not list is a confident no. (Listing only non-default answers keeps the output ~40 tokens per
// scene instead of ~5 per question per scene; the schema is strict and every listed q is an enum.)
// PROBABILITY MAP (so policy.json thresholds mean the same thing for both models: act >= 0.7,
// possible >= 0.4, never flags below act):
//   yes/high 0.95, yes/medium 0.8 (both act) · yes/low 0.6 (possible) · no/low 0.35, no/medium 0.2,
//   no/high or not listed 0.05 (no tag).
import { PRESENCE, EVENTS, ITEMS, verifiedSentences, verifiedSetting, castForScene, castView, dangerView, verified, linesFor } from './questions.js';

export const SONNET_Q_VERSION = 'sonnetq-v9.0';
export const SONNET_MODEL = 'claude-sonnet-5';
export const P_MAP = { yes: { high: 0.95, medium: 0.8, low: 0.6 }, no: { low: 0.35, medium: 0.2, high: 0.05 } };
export const P_UNLISTED = 0.05;
export const probOf = (a) => (a ? P_MAP[a.a]?.[a.c] ?? P_UNLISTED : P_UNLISTED);

const PRES = Object.fromEntries(PRESENCE.map((p) => [p.id, p]));
const EV = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
// The retelling rule questions.js repeats in many no-cases is stated ONCE in the prompt (RETOLD_NOTE)
// and marked [R] on the questions that carry it: same rule, fewer billed tokens per call.
const RETOLD_TEXT = 'A character telling about something that happened earlier or elsewhere, or that might happen, is a no.';
export const RETOLD_NOTE = `[R] on a question means: ${RETOLD_TEXT}`;
export const PRESENCE_NOTE = '[P] on a question means: yes when the lines or the summary show the thing is there now (a character sees it, uses it, touches it, speaks to it, or reacts to it, or a sound caption names it; friendly, funny, imagined and dangerous ones all count); no when characters only talk about it (remember it, warn about it, plan for it) or nothing shows it.';
const clean = (t) => String(t ?? '').replace(/`scene`/g, 'this scene').replace(/`cast`/g, 'the cast list').replace(/`scene\.lines`/g, 'the lines').replace(/`scene\.summary`/g, 'the summary');

/** { id, kind: 'event'|'presence', text, yes, no } for one question id (throws on an unknown id). */
export function questionDef(id) {
  if (EV[id]) {
    const e = EV[id];
    const retold = !!e.no && e.no.includes(RETOLD_TEXT);
    const no = e.no ? clean(e.no.replace(RETOLD_TEXT, '').trim()) : '';
    return { id, kind: 'event', group: e.group, text: clean(e.q), retold, ...(e.yes ? { yes: clean(e.yes) } : {}), ...(no ? { no } : {}) };
  }
  if (PRES[id]) {
    const p = PRES[id];
    const text = p.noun ? `Is this in the scene: ${p.noun}?` : clean(p.ps ?? p.pl);
    // the shared presence rule is stated once (PRESENCE_NOTE) and marked [P]
    return { id, kind: 'presence', group: p.group, text: `${text} [P]`, ...(p.def ? { yes: p.def } : {}), ...(p.noExtra ? { no: p.noExtra } : {}) };
  }
  throw new Error(`sonnet-questions: unknown question id ${id}`);
}

export const SYSTEM = `You help build a reference database that parents use to decide which scenes of a film to skip or talk about with their child. For each scene you answer a fixed list of yes/no questions.

THE SOURCE RULE. Judge ONLY from what is given for that scene: its numbered subtitle lines ("L<cue>| <text>"; text in (PARENTHESES) or [BRACKETS] is a sound caption, ♪ marks song lyrics), its verified summary (may be empty), its setting (or "unknown") and the verified cast notes of the characters in it. Do NOT use your own knowledge or memory of this film, even if you are sure of it. Judge each scene on its own: what happens in another scene of the list does not count for this one.

HOW TO ANSWER. For every scene, list:
- every question whose answer is YES, with your confidence: "high" (the scene clearly shows it), "medium" (it very probably happens), "low" (it may happen; the scene only hints at it);
- every question whose answer is NO but you are not confident of that ("low" or "medium" confidence no).
Do NOT list a question whose answer is a confident no: anything you leave out counts as a confident no. Most scenes have only a few listed questions; a calm scene may have none.
Answer each question literally, by its own yes and no rules. Subtitles rarely name the speaker; use the lines, the summary and the cast notes together to tell who is who. A death, a loss or a threat stated in the lines counts even when there are jokes around it.`;

/** The question block of the user prompt (numbered by id, with its yes / no rules). */
export function questionBlock(ids) {
  return ids.map((id) => {
    const d = questionDef(id);
    return `- ${id}: ${d.text}${d.retold ? ' [R]' : ''}${d.yes ? ` YES: ${d.yes}` : ''}${d.no ? ` NO: ${d.no}` : ''}`;
  }).join('\n') + `\n${RETOLD_NOTE}\n${PRESENCE_NOTE}`;
}

/** What Sonnet sees of one scene: exactly the state Jev's context request gets (verified parts only). */
export function sceneView({ seg, scene, cues }) {
  const summary = verifiedSentences(scene).join(' ');
  const cast = castForScene(seg.cast, summary, cues.map((c) => c.text)).map(castView);
  const dangers = (seg.dangers ?? []).filter((d) => verified(d.check)).map(dangerView);
  return { id: scene.id, setting: verifiedSetting(scene), summary, cast, dangers, lines: linesFor(cues) };
}

export function userPrompt({ film, scenes, ids }) {
  const parts = [
    `Film: ${film.title}${film.year ? ` (${film.year})` : ''}.`,
    `QUESTIONS (answer every one for every scene, by listing as the rules say):\n${questionBlock(ids)}`,
    `SCENES (${scenes.length}; return one entry per scene id: ${scenes.map((s) => s.id).join(', ')}):`,
  ];
  for (const s of scenes) {
    const cast = s.cast.length ? s.cast.map((c) => `${c.name}${c.also_called ? ` (also called ${c.also_called.join(', ')})` : ''}: ${['kind', 'is_child', 'disposition'].map((f) => `${f}=${c[f]}`).join(', ')}${c.note ? `; ${c.note}` : ''}`).join(' | ') : 'none identified';
    parts.push([
      `=== ${s.id} ===`,
      `setting: ${s.setting}`,
      `summary: ${s.summary || '(none verified)'}`,
      `cast in this scene: ${cast}`,
      ...(s.dangers.length ? [`film dangers: ${s.dangers.map((d) => `${d.name} (${d.kind})`).join('; ')}`] : []),
      'lines:',
      ...s.lines,
    ].join('\n'));
  }
  return parts.join('\n\n');
}

export function schemaFor(sceneIds, ids) {
  return {
    type: 'object', additionalProperties: false, required: ['scenes'],
    properties: {
      scenes: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'answers'],
          properties: {
            id: { type: 'string', enum: sceneIds },
            answers: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false, required: ['q', 'a', 'c'],
                properties: { q: { type: 'string', enum: ids }, a: { type: 'string', enum: ['yes', 'no'] }, c: { type: 'string', enum: ['high', 'medium', 'low'] } },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Model output -> per scene { id -> { q -> {a, c, p} } } plus problems. A scene listed twice keeps its
 * first entry; a question listed twice in a scene keeps the answer with the higher probability (the
 * conservative reading for a skip list); unknown ids are ignored and reported.
 */
export function parseAnswers(data, sceneIds, ids) {
  const want = new Set(sceneIds); const qs = new Set(ids);
  const out = {}; const problems = [];
  for (const s of data?.scenes ?? []) {
    if (!want.has(s.id)) { problems.push(`unknown scene ${s.id}`); continue; }
    if (out[s.id]) { problems.push(`${s.id} listed twice`); continue; }
    const row = {};
    for (const a of s.answers ?? []) {
      if (!qs.has(a.q)) { problems.push(`${s.id}: unknown question ${a.q}`); continue; }
      const p = probOf(a);
      if (!row[a.q] || p > row[a.q].p) row[a.q] = { a: a.a, c: a.c, p };
    }
    out[s.id] = row;
  }
  const missing = sceneIds.filter((id) => !out[id]);
  return { answers: out, missing, problems };
}

/** Probability per asked question for one scene (unlisted = P_UNLISTED). */
export const sceneProbs = (row, ids) => Object.fromEntries(ids.map((q) => [q, row?.[q]?.p ?? P_UNLISTED]));

/** Self-check: every id Sonnet may be asked resolves. */
export function checkIds(ids) {
  for (const id of ids) { questionDef(id); if (!ITEMS[id]) throw new Error(`sonnet-questions: ${id} not in questions.js ITEMS`); }
  return true;
}

/** Hash of everything that defines the Sonnet question prompt for a given asked list (system + block). */
import crypto from 'node:crypto';
export const promptHash = (ids) => crypto.createHash('sha256').update(`${SONNET_Q_VERSION}\n${SYSTEM}\n${questionBlock(ids)}`).digest('hex').slice(0, 12);
