// v10: split.json is written by assemble/build.mjs from assemble/decisions.json (the Jev-first owner rule of
// assemble/decide.mjs over the phrasing tournament). assign / sonnet_asked / sonnet_used keep v9's meaning;
// there is no shadow set. loadSplit also refuses a split.json that disagrees with jev-set.js: an id is 'jev'
// exactly when a Jev-set target tags it.
// v9: the question SPLIT (split.json) as the pipeline reads it. split.json is written by
// split/decide.mjs from the data (split/stage-a.json: v8 scorecard, Jev vs the live Sonnet pipeline per
// group; split/stage-b.json: Jev vs Sonnet on IDENTICAL scenes per question, human keys).
//   assign[q]     'jev' | 'sonnet' for every universal presence / event question (questions.js)
//   sonnet_asked  questions Sonnet is asked (sonnetq.js); sonnet_used = those assigned 'sonnet';
//                 the rest are shadow (measured, never used)
// Scores, modifiers, the kind Choice, mention questions and film-specific questions stay with Jev
// (not part of the split: the scorecard has no Sonnet counterpart for them; see split.json notes).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRESENCE, EVENTS, JEV_TARGET_IDS } from './questions.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPLIT_FILE = path.join(here, 'split.json');

export function loadSplit(file = SPLIT_FILE) {
  const raw = fs.readFileSync(file, 'utf8');
  const s = JSON.parse(raw);
  const universal = [...PRESENCE.map((p) => p.id), ...EVENTS.map((e) => e.id)];
  for (const q of universal) if (!['jev', 'sonnet'].includes(s.assign?.[q])) throw new Error(`split.json: no assignment for ${q}`);
  for (const q of Object.keys(s.assign)) if (!universal.includes(q)) throw new Error(`split.json: unknown question ${q}`);
  const used = universal.filter((q) => s.assign[q] === 'sonnet');
  for (const q of used) if (!s.sonnet_asked.includes(q)) throw new Error(`split.json: ${q} assigned to Sonnet but not asked`);
  const jevT = new Set(JEV_TARGET_IDS);
  for (const q of universal) if ((s.assign[q] === 'jev') !== jevT.has(q)) throw new Error(`split.json: ${q} is '${s.assign[q]}' but jev-set.js ${jevT.has(q) ? 'tags' : 'does not tag'} it`);
  return {
    ...s,
    sha256_12: crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12),
    sonnet_used: used,
    jev_presence: PRESENCE.filter((p) => s.assign[p.id] === 'jev').map((p) => p.id),
    jev_events: EVENTS.filter((e) => s.assign[e.id] === 'jev').map((e) => e.id),
    isSonnet: (q) => s.assign[q] === 'sonnet',
  };
}
